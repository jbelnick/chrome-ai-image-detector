#!/usr/bin/env node
/**
 * Score the official OpenFake 360 on Chrome's ORT-web path
 * (createImageBitmap + OffscreenCanvas + WebGPU-then-WASM).
 *
 *   npm run build          # vendors ORT + copies src → extension/lib
 *   npm run eval:download  # same proxy set as npm run eval
 *   npm run eval:chrome
 *
 * Does not retune fusion. Does not invent scores.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MODELS, EVAL_THRESHOLD } from "../../src/model-config.js";
import { FUSE_DEFAULTS } from "../../src/fuse.js";
import { summarize } from "../../src/metrics.js";
import {
  assertOfficialSet,
  dataDirFromRoot,
  listProxyImages,
  officialOnly,
  repoRoot,
} from "./list.mjs";

const root = repoRoot();
const NODE_REF = {
  commit: "1e19a9f",
  bal_acc_065: 0.872222,
  tpr_065: 0.9,
  tnr_065: 0.844444,
};

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
  const lib = await firstExisting([join(root, "src")]);
  return { vendor, models, lib, data: dataDirFromRoot(root) };
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

async function startServer({ vendor, models, lib, data, official }) {
  let doneResolve;
  let doneReject;
  const done = new Promise((resolveDone, rejectDone) => {
    doneResolve = resolveDone;
    doneReject = rejectDone;
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST") {
        console.error(`${req.method} ${url.pathname}`);
      }
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
        doneReject(new Error(body.error || "chrome eval failed"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/manifest.json") {
        const json = JSON.stringify(
          official.map((row) => ({ name: row.name, label: row.label })),
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
      const stream = createReadStream(file);
      stream.on("error", (err) => {
        if (!res.writableEnded) res.destroy(err);
      });
      stream.pipe(res);
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
  const profile = join(tmpdir(), `grain-chrome-eval-${process.pid}`);
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
  const child = spawn(bin, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/FATAL|CHECK failed|GPU process/i.test(text)) {
      process.stderr.write(text);
    }
  });
  return child;
}

function printReport(official, payload) {
  const summary = summarize(
    payload.rows.map((r) => ({ label: r.label, score: r.score })),
    EVAL_THRESHOLD,
  );
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  const backend = payload.provider;
  const webgpu = payload.webgpu;
  const gpu = payload.gpu || {};
  const delta = summary.balancedAccuracy - NODE_REF.bal_acc_065;

  console.log("");
  console.log("Grain Chrome eval — ORT-web + createImageBitmap / OffscreenCanvas");
  console.log(`Models: ${MODELS.siglip2.id} + ${MODELS.commfor.id}`);
  console.log(`Fuse bias=${FUSE_DEFAULTS.bias} temperature=${FUSE_DEFAULTS.temperature}`);
  console.log(`AI iff score >= ${EVAL_THRESHOLD}`);
  console.log(`Images: official(OpenFake)=${official.length}  (Picsum/CF extras not scored)`);
  console.log(`Backend: ${backend}`);
  if (webgpu === "software-swiftshader") {
    console.log(
      "WebGPU: software-swiftshader — ORT webgpu EP ran, but this is not a real GPU device (UNVERIFIED for hardware WebGPU)",
    );
  } else if (webgpu === "UNVERIFIED") {
    const arch = String(gpu.adapterInfo?.architecture || "");
    const software = /swiftshader|llvmpipe/i.test(arch);
    console.log(
      software
        ? "WebGPU: UNVERIFIED — only a software adapter (SwiftShader); no real GPU device. ORT used wasm."
        : `WebGPU: UNVERIFIED — navigator.gpu=${Boolean(gpu.hasNavigatorGpu)} adapter=${Boolean(gpu.adapter)}`,
    );
  } else {
    console.log(`WebGPU: ${webgpu}`);
  }
  if (gpu.adapterInfo) {
    console.log(`GPU adapter: ${JSON.stringify(gpu.adapterInfo)}`);
  }
  console.log("");
  console.log(`OFFICIAL OpenFake core/test @ ${EVAL_THRESHOLD} (Chrome path):`);
  console.log(`  balanced accuracy  ${pct(summary.balancedAccuracy)}`);
  console.log(`  TPR                ${pct(summary.tpr)}`);
  console.log(`  TNR                ${pct(summary.tnr)}`);
  console.log(`  n                  ${summary.n} (AI ${summary.nAi} / real ${summary.nReal})`);
  console.log(`  TP/FN/TN/FP        ${summary.tp} / ${summary.fn} / ${summary.tn} / ${summary.fp}`);
  console.log("");
  console.log(`NODE reference (KEEP ${NODE_REF.commit}, onnxruntime-node + sharp):`);
  console.log(`  bal_acc_065: ${NODE_REF.bal_acc_065.toFixed(6)}`);
  console.log(`  tpr_065:     ${NODE_REF.tpr_065.toFixed(6)}`);
  console.log(`  tnr_065:     ${NODE_REF.tnr_065.toFixed(6)}`);
  console.log(`  delta_ba:    ${delta >= 0 ? "+" : ""}${delta.toFixed(6)}`);
  console.log("");
  console.log(`bal_acc_065: ${summary.balancedAccuracy.toFixed(6)}`);
  console.log(`tpr_065:     ${summary.tpr.toFixed(6)}`);
  console.log(`tnr_065:     ${summary.tnr.toFixed(6)}`);
  console.log(`backend:     ${backend}`);
  console.log(`webgpu:      ${webgpu}`);
  return summary;
}

async function main() {
  const roots = await resolveRoots();
  const all = await listProxyImages(roots.data);
  let official = officialOnly(all);
  const limit = Number(process.env.GRAIN_CHROME_EVAL_LIMIT || 0);
  if (limit > 0) {
    const ai = official.filter((r) => r.label === 1).slice(0, Math.ceil(limit / 2));
    const real = official.filter((r) => r.label === 0).slice(0, Math.floor(limit / 2));
    official = [...ai, ...real];
    console.error(`GRAIN_CHROME_EVAL_LIMIT=${limit} — scoring ${official.length} (not the official 360)`);
  } else {
    assertOfficialSet(official);
  }

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

  const server = await startServer({ ...roots, official });
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
          if (!timedOut) {
            reject(new Error(`Chrome exited before /done (code ${code})`));
          }
        });
      }),
    ]);
    if (timedOut) throw new Error(`Chrome eval timed out after ${timeoutMs}ms`);
    if (!payload?.ok || !Array.isArray(payload.rows)) {
      throw new Error("Chrome eval returned no rows");
    }
    if (payload.rows.length !== official.length) {
      throw new Error(`scored ${payload.rows.length}, expected ${official.length}`);
    }
    const summary = printReport(official, payload);
    const report = {
      path: "chrome-ort-web",
      backend: payload.provider,
      webgpu: payload.webgpu,
      gpu: payload.gpu,
      hashes: payload.hashes,
      threshold: EVAL_THRESHOLD,
      fuse: FUSE_DEFAULTS,
      nOfficial: official.length,
      officialOpenFake: summary,
      nodeReference: NODE_REF,
      note:
        "OFFICIAL Chrome number uses the same OpenFake core/test 180/class prefix as npm run eval. " +
        "Decode is createImageBitmap + OffscreenCanvas (extension path). " +
        "Inference is onnxruntime-web, WebGPU session first, WASM if that throws. " +
        "Picsum and CF extras are not scored. Fuse bias stays 0.",
    };
    await mkdir(join(root, "eval/results"), { recursive: true });
    await writeFile(
      join(root, "eval/results/chrome.json"),
      JSON.stringify(report, null, 2),
    );
    console.log("Wrote eval/results/chrome.json");
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
