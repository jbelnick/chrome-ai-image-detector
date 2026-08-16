#!/usr/bin/env node
/**
 * Download the 5 named ship-gate fixtures only.
 *
 * Does not touch the 358 mix (eval/data/ai, eval/data/real).
 * Does not download the PR 12 146-image holdout.
 * Saves Commons bytes as served (no recompress).
 */
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { loadShipGateManifest } from "../src/ship-gate.js";
import { repoRoot } from "./chrome/ship-gate.mjs";

const root = repoRoot();
const dataDir = join(root, "eval/data");
const UA =
  "GrainShipGate/1.0 (https://github.com/jbelnick/chrome-ai-image-detector; named-product-fixtures)";

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

async function commonsUrl(title, width) {
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
  if (width && info.thumburl) return info.thumburl;
  return info.url;
}

async function downloadTo(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetchOk(url);
  const file = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body), file);
}

async function main() {
  const manifest = loadShipGateManifest(root);
  for (const img of manifest.images) {
    const dest = join(dataDir, img.path);
    if (await exists(dest)) {
      console.log(`exists ${img.id} ${img.path}`);
      continue;
    }
    const url = await commonsUrl(img.download.title, img.download.width);
    await downloadTo(url, dest);
    console.log(`wrote ${img.id} ${img.path}`);
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log("ship-gate fixtures ready under eval/data/ship-gate/ (not the 358 mix)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
