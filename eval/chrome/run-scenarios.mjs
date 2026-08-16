#!/usr/bin/env node
/**
 * Chrome ORT-web eval for the diagnostic scenario holdout.
 *
 * Prints per-category TPR/TNR/BA plus overall.
 * Does NOT replace the 358 broader proxy as the keep/revert scalar.
 * Does not retune fusion. Does not invent scores.
 *
 *   npm run eval:download:scenarios
 *   npm run eval:chrome:scenarios
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MODELS, EVAL_THRESHOLD } from "../../src/model-config.js";
import { FUSE_DEFAULTS } from "../../src/fuse.js";
import { summarizeByCategory } from "../../src/metrics.js";
import {
  REQUIRED_CATEGORIES,
  assertPresentOrPartial,
  assertScenarioManifest,
  dataDirFromRoot,
  listScenarioImages,
  repoRoot,
} from "./scenarios.mjs";

const root = repoRoot();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

function chromeCandidates() {
  if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

async function firstExisting(paths) {
  for (const p of paths) {
    try {
      await stat(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function resolveRoots() {
  const vendor = await firstExisting([
    join(root, "extension/vendor/ort"),
    join(root, "node_modules/onnxruntime-web/dist"),
  ]);
  if (!vendor) {
    throw new Error("ORT web files missing. Run: npm ci && npm run build");
  }
  const models = await firstExisting([
    join(root, "extension/models"),
    join(root, "models"),
  ]);
  if (!models) {
    throw new Error("ONNX weights missing. Run: npm run fetch-models && npm run build");
  }
  return { vendor, models, lib: join(root, "src"), data: dataDirFromRoot(root) };
}

function underRoot(base, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const abs = resolve(base, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const rel = relative(base, abs);
  if (rel.startsWith("..") || normalize(rel).startsWith("..")) return null;
  return abs;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function startServer({ vendor, models, lib, data, scored }) {
  let doneResolve;
  let doneReject;
  const done = new Promise((resolveDone, rejectDone) => {
    doneResolve = resolveDone;
    doneReject = rejectDone;
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/progress") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const secs = body.elapsedMs ? `  ${Math.round(body.elapsedMs / 1000)}s` : "";
        const phase = body.phase ? `  ${body.phase}` : "";
        console.error(
          `scored ${body.scored}/${body.total}  provider=${body.provider}${secs}${phase}`,
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      if (req.method === "POST" && url.pathname === "/done") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        doneResolve(body);
        return;
      }
      if (req.method === "POST" && url.pathname === "/fail") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        doneReject(new Error(body.error || "chrome scenario eval failed"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/manifest.json") {
        const json = JSON.stringify(
          scored.map((row) => ({ name: row.name, label: row.label })),
        );
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(json),
        });
        res.end(json);
        return;
      }

      let file = null;
      if (url.pathname.startsWith("/vendor/ort/")) {
        file = underRoot(vendor, url.pathname.slice("/vendor/ort".length));
      } else if (url.pathname.startsWith("/models/")) {
        file = underRoot(models, url.pathname.slice("/models".length));
      } else if (url.pathname.startsWith("/lib/")) {
        file = underRoot(lib, url.pathname.slice("/lib".length));
      } else if (url.pathname.startsWith("/eval-data/")) {
        file = underRoot(data, url.pathname.slice("/eval-data".length));
      } else if (url.pathname.startsWith("/eval/chrome/")) {
        file = underRoot(join(root, "eval/chrome"), url.pathname.slice("/eval/chrome".length));
      } else if (url.pathname === "/" || url.pathname === "/eval/chrome/page.html") {
        file = join(root, "eval/chrome/page.html");
      }

      if (!file) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const info = await stat(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
        "content-length": info.size,
      });
      createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message || err));
    }
  });

  server.timeout = 0;
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 60_000;
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}/eval/chrome/page.html`,
    done,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function chromeExists(bin) {
  try {
    await stat(bin);
    return true;
  } catch {
    return false;
  }
}

async function launchChrome(bin, pageUrl) {
  const profile = join(tmpdir(), `grain-chrome-scenarios-${process.pid}`);
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-unsafe-webgpu",
    "--enable-webgpu-developer-features",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    pageUrl,
  ];
  return spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
}

function pct(x) {
  return `${(x * 100).toFixed(2)}%`;
}

function printBackend(payload) {
  console.log("");
  console.log("Grain Chrome SCENARIO holdout — diagnostic, not the KEEP scalar");
  console.log(`Models: ${MODELS.siglip2.id} + ${MODELS.commfor.id}`);
  console.log(`Fuse bias=${FUSE_DEFAULTS.bias} temperature=${FUSE_DEFAULTS.temperature}`);
  console.log(`AI iff score >= ${EVAL_THRESHOLD}`);
  console.log(`Backend: ${payload.provider}`);
  console.log(`WebGPU: ${payload.webgpu}`);
  if (payload.gpu?.adapterInfo) {
    console.log(`GPU adapter: ${JSON.stringify(payload.gpu.adapterInfo)}`);
  }
}

function printCategoryTable(byCategory) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log("");
  console.log("Per-category @ 0.65 (diagnostic — not a KEEP ratchet):");
  console.log(
    `${pad("category", 22)} ${num("n", 4)} ${num("AI", 3)} ${num("real", 4)} ${num("TPR", 8)} ${num("TNR", 8)} ${num("BA", 8)}  TP/FN/TN/FP`,
  );
  for (const cat of REQUIRED_CATEGORIES) {
    const s = byCategory[cat];
    if (!s) {
      console.log(`${pad(cat, 22)} ${num("—", 4)}   UNVERIFIED / not scored`);
      continue;
    }
    const tpr = s.nAi ? pct(s.tpr) : "n/a";
    const tnr = s.nReal ? pct(s.tnr) : "n/a";
    console.log(
      `${pad(cat, 22)} ${num(s.n, 4)} ${num(s.nAi, 3)} ${num(s.nReal, 4)} ${num(tpr, 8)} ${num(tnr, 8)} ${num(pct(s.balancedAccuracy), 8)}  ${s.tp}/${s.fn}/${s.tn}/${s.fp}`,
    );
  }
}

function printOverall(summary) {
  console.log("");
  console.log("OVERALL scenario holdout @ 0.65 (not the 358 scalar, not Kenny's bench):");
  console.log(`  balanced accuracy  ${pct(summary.balancedAccuracy)}`);
  console.log(`  TPR                ${pct(summary.tpr)}`);
  console.log(`  TNR                ${pct(summary.tnr)}`);
  console.log(`  n                  ${summary.n} (AI ${summary.nAi} / real ${summary.nReal})`);
  console.log(`  TP/FN/TN/FP        ${summary.tp} / ${summary.fn} / ${summary.tn} / ${summary.fp}`);
}

async function main() {
  const { manifest, rows: listed } = await listScenarioImages(root);
  assertScenarioManifest(manifest);
  const allowPartial =
    process.env.GRAIN_CHROME_EVAL_ALLOW_PARTIAL === "1" ||
    Number(process.env.GRAIN_CHROME_EVAL_LIMIT || 0) > 0;
  const missing = assertPresentOrPartial(listed, { allowPartial });
  if (missing.length) {
    console.error(
      `GRAIN_CHROME_EVAL_ALLOW_PARTIAL: scoring ${listed.length - missing.length}/${listed.length} (missing ${missing.length})`,
    );
  }

  let scored = listed.filter((r) => r.present);
  const limit = Number(process.env.GRAIN_CHROME_EVAL_LIMIT || 0);
  if (limit > 0) {
    const take = [];
    const perCat = Math.max(1, Math.floor(limit / REQUIRED_CATEGORIES.length));
    for (const cat of REQUIRED_CATEGORIES) {
      take.push(...scored.filter((r) => r.category === cat).slice(0, perCat));
    }
    scored = take.slice(0, limit);
    console.error(
      `GRAIN_CHROME_EVAL_LIMIT=${limit} — scoring ${scored.length} (not a claim run)`,
    );
  }

  if (!scored.length) {
    throw new Error("no scenario images on disk. Run: npm run eval:download:scenarios");
  }

  const roots = await resolveRoots();
  let chrome = null;
  for (const bin of chromeCandidates()) {
    if (await chromeExists(bin)) {
      chrome = bin;
      break;
    }
  }
  if (!chrome) {
    throw new Error("Chrome not found. Set CHROME_PATH to a Chrome/Chromium binary.");
  }

  const server = await startServer({ ...roots, scored });
  console.error(`serving ${server.url}`);
  const child = await launchChrome(chrome, server.url);
  const timeoutMs = Number(process.env.GRAIN_CHROME_EVAL_TIMEOUT_MS || 3 * 60 * 60 * 1000);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  try {
    const payload = await Promise.race([
      server.done,
      new Promise((_, reject) => {
        child.on("exit", (code) => {
          if (!timedOut) reject(new Error(`Chrome exited before /done (code ${code})`));
        });
      }),
    ]);
    if (timedOut) throw new Error(`Chrome eval timed out after ${timeoutMs}ms`);
    if (!payload?.ok || !Array.isArray(payload.rows)) {
      throw new Error("Chrome eval returned no rows");
    }
    if (payload.rows.length !== scored.length) {
      throw new Error(`scored ${payload.rows.length}, expected ${scored.length}`);
    }

    const byName = new Map(payload.rows.map((r) => [r.name, r]));
    const joined = scored.map((r) => {
      const hit = byName.get(r.name);
      return {
        ...r,
        score: hit.score,
        visual: hit.visual,
        siglip: hit.siglip,
        commfor: hit.commfor,
        reasons: hit.reasons,
      };
    });
    const { overall, byCategory } = summarizeByCategory(joined, EVAL_THRESHOLD);

    printBackend(payload);
    printCategoryTable(byCategory);
    printOverall(overall);
    console.log("");
    console.log("NOTE: this suite is a diagnostic holdout. It is not the 358 KEEP scalar.");
    console.log("NOTE: do not fit the SigLIP probe on these images.");

    const report = {
      path: "chrome-ort-web-scenarios",
      scalar: false,
      diagnostic: true,
      backend: payload.provider,
      webgpu: payload.webgpu,
      gpu: payload.gpu,
      hashes: payload.hashes,
      threshold: EVAL_THRESHOLD,
      fuse: FUSE_DEFAULTS,
      n: joined.length,
      nMissing: missing.length,
      overall,
      byCategory,
      rows: joined.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        label: r.label,
        score: r.score,
        reasons: r.reasons,
      })),
      note:
        "Diagnostic multi-scenario holdout. Not Kenny's private bench. " +
        "Not a KEEP scalar unless Jason says so later. " +
        "The 358 broader proxy remains the keep/revert number.",
    };
    await mkdir(join(root, "eval/results"), { recursive: true });
    await writeFile(
      join(root, "eval/results/chrome-scenarios.json"),
      JSON.stringify(report, null, 2),
    );
    console.log("Wrote eval/results/chrome-scenarios.json");
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
