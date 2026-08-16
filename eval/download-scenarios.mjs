#!/usr/bin/env node
/**
 * Populate eval/data/scenarios/ from the committed manifest.
 *
 * Public sources only: Wikimedia Commons, Lorem Picsum, OpenFake.
 * Reproducible. Does not train. Does not fit the SigLIP probe.
 *
 *   npm run eval:download:scenarios
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import sharp from "sharp";
import {
  MIN_PER_CATEGORY,
  REQUIRED_CATEGORIES,
  loadScenarioManifest,
  repoRoot,
} from "./chrome/scenarios.mjs";

const root = repoRoot();
const dataDir = join(root, "eval/data");
const UA =
  "GrainEvalHoldout/1.0 (https://github.com/jbelnick/chrome-ai-image-detector; diagnostic-eval)";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchOk(url, { tries = 8 } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "*/*" },
        redirect: "follow",
      });
      if (res.ok) return res;
      last = new Error(`${url} ${res.status}`);
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** i;
        await new Promise((r) => setTimeout(r, Math.min(30_000, retryAfter * 1000)));
        continue;
      }
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw last;
}

async function downloadTo(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetchOk(url);
  const file = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body), file);
}

async function commonsThumbUrl(title, width) {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width || 800),
    format: "json",
  });
  const api = `https://commons.wikimedia.org/w/api.php?${params}`;
  const data = await (await fetchOk(api)).json();
  const page = Object.values(data.query?.pages || {})[0];
  const info = (page?.imageinfo || [])[0];
  if (!info) throw new Error(`Commons has no imageinfo for ${title}`);
  return info.thumburl || info.url;
}

async function downloadCommons(img) {
  const dest = join(dataDir, img.path);
  if (await exists(dest)) return { id: img.id, skipped: true };
  const url = await commonsThumbUrl(img.download.title, img.download.width);
  const tmp = `${dest}.part`;
  await downloadTo(url, tmp);
  const ext = dest.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  if (ext === "png") {
    await sharp(tmp).png().toFile(dest);
  } else {
    await sharp(tmp).jpeg({ quality: 88 }).toFile(dest);
  }
  await writeFile(tmp, "");
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(tmp);
  } catch {
    /* ignore */
  }
  return { id: img.id, skipped: false };
}

async function downloadPicsum(img) {
  const dest = join(dataDir, img.path);
  if (await exists(dest)) return { id: img.id, skipped: true };
  const pid = img.download.id;
  const url = `https://picsum.photos/id/${pid}/960/640`;
  const tmp = `${dest}.part`;
  await downloadTo(url, tmp);
  const maxSide = img.download.max_side || 720;
  const quality = img.download.quality || 65;
  await sharp(tmp)
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(dest);
  const { unlink } = await import("node:fs/promises");
  await unlink(tmp).catch(() => {});
  return { id: img.id, skipped: false };
}

async function deriveThumb(img, byId) {
  const dest = join(dataDir, img.path);
  if (await exists(dest)) return { id: img.id, skipped: true };
  const src = byId.get(img.download.from);
  if (!src) throw new Error(`${img.id} derived_from missing ${img.download.from}`);
  const srcPath = join(dataDir, src.path);
  if (!(await exists(srcPath))) {
    return { id: img.id, skipped: false, missingSource: src.id };
  }
  const maxSide = img.download.max_side || 320;
  const quality = img.download.quality || 60;
  await mkdir(dirname(dest), { recursive: true });
  await sharp(srcPath)
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(dest);
  return { id: img.id, skipped: false };
}

function runPython() {
  const script = join(root, "eval/download_scenarios.py");
  return new Promise((resolve) => {
    const child = spawn("python3", [script], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const manifest = await loadScenarioManifest(root);
  const images = manifest.images;
  const byId = new Map(images.map((img) => [img.id, img]));
  const unverified = [...(manifest.unverified || [])];

  const commons = images.filter((img) => img.download?.kind === "commons");
  const picsum = images.filter((img) => img.download?.kind === "picsum");
  const derive = images.filter((img) => img.download?.kind === "derive");

  console.log(`scenario downloader: commons=${commons.length} picsum=${picsum.length} derive=${derive.length} openfake=rest`);

  for (const img of commons) {
    try {
      const r = await downloadCommons(img);
      console.log(`  commons ${img.id}${r.skipped ? " (exists)" : ""}`);
      if (!r.skipped) await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.error(`  FAIL commons ${img.id}: ${err.message || err}`);
      unverified.push({
        category: img.category,
        id: img.id,
        why: `Commons download failed: ${err.message || err}`,
      });
    }
  }

  for (const img of picsum) {
    try {
      const r = await downloadPicsum(img);
      console.log(`  picsum ${img.id} id=${img.download.id}${r.skipped ? " (exists)" : ""}`);
    } catch (err) {
      console.error(`  FAIL picsum ${img.id}: ${err.message || err}`);
      unverified.push({
        category: img.category,
        id: img.id,
        why: `Picsum download failed: ${err.message || err}`,
      });
    }
  }

  const openfakeJobs = images.filter(
    (img) => img.download?.kind === "openfake" || img.download?.kind === "openfake-filter",
  );
  let needOpenfake = 0;
  for (const img of openfakeJobs) {
    if (!(await exists(join(dataDir, img.path)))) needOpenfake += 1;
  }
  if (needOpenfake === 0) {
    console.log("OpenFake files already on disk — skipping stream");
  } else {
    const pyCode = await runPython();
    if (pyCode !== 0) {
      console.error("OpenFake helper exited", pyCode, "(continuing if files already landed)");
    }
  }
  const metaPath = join(dataDir, "scenarios/openfake-meta.json");
  if (await exists(metaPath)) {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    for (const gap of meta.unverified || []) unverified.push(gap);
  }

  for (const img of derive) {
    try {
      const r = await deriveThumb(img, byId);
      if (r.missingSource) {
        console.error(`  skip derive ${img.id}: source ${r.missingSource} not on disk`);
        continue;
      }
      console.log(`  derive ${img.id} from ${img.download.from}${r.skipped ? " (exists)" : ""}`);
    } catch (err) {
      console.error(`  FAIL derive ${img.id}: ${err.message || err}`);
    }
  }

  const landed = {};
  for (const cat of REQUIRED_CATEGORIES) landed[cat] = 0;
  for (const img of images) {
    if (await exists(join(dataDir, img.path))) landed[img.category] += 1;
  }

  const gaps = [];
  for (const cat of REQUIRED_CATEGORIES) {
    if (landed[cat] < MIN_PER_CATEGORY) {
      const why =
        unverified.find((g) => g.category === cat)?.why ||
        `only ${landed[cat]} files on disk after an honest download`;
      gaps.push({ category: cat, landed: landed[cat], need: MIN_PER_CATEGORY, why });
      console.log(`UNVERIFIED ${cat}: ${why}`);
    } else {
      console.log(`OK ${cat}: ${landed[cat]}`);
    }
  }

  const status = {
    landed,
    unverified: gaps,
    note: "Diagnostic holdout download status. Not a KEEP score.",
  };
  await mkdir(join(dataDir, "scenarios"), { recursive: true });
  await writeFile(
    join(dataDir, "scenarios/download-status.json"),
    JSON.stringify(status, null, 2) + "\n",
  );
  console.log("wrote eval/data/scenarios/download-status.json");
  if (gaps.length) {
    console.error(`${gaps.length} categor(ies) UNVERIFIED — manifest kept; files were not invented.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
