#!/usr/bin/env node
/**
 * Chrome-path ship-gate. Scores the 5 named fixtures only.
 *
 * Fails if Charlesworth is AI @ 0.65 (the 99% miss) or Nous flips to AI.
 * Does not score or enlarge the 358 mix. Does not train.
 *
 *   npm run eval:download:ship-gate
 *   npm run build && npm run fetch-models
 *   npm run eval:chrome:ship-gate
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MODELS, EVAL_THRESHOLD } from "../../src/model-config.js";
import { FUSE_DEFAULTS } from "../../src/fuse.js";
import { assertShipGateScores } from "../../src/ship-gate.js";
import { listShipGateImages, repoRoot } from "./ship-gate.mjs";

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
      /* next */
    }
  }
  return null;
}

async function resolveRoots() {
  const vendor = await firstExisting([
    join(root, "extension/vendor/ort"),
    join(root, "node_modules/onnxruntime-web/dist"),
  ]);
  if (!vendor) throw new Error("ORT web files missing. Run: npm ci && npm run build");
  const models = await firstExisting([
    join(root, "extension/models"),
    join(root, "models"),
  ]);
  if (!models) throw new Error("ONNX missing. Run: npm run fetch-models && npm run build");
  return { vendor, models, lib: join(root, "src"), data: join(root, "eval/data") };
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
        console.error(`scored ${body.scored}/${body.total}  provider=${body.provider}`);
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
        doneReject(new Error(body.error || "chrome ship-gate failed"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/manifest.json") {
        const json = JSON.stringify(scored.map((row) => ({ name: row.name, label: row.label })));
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
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/eval/chrome/page.html`,
    done,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function main() {
  const { rows } = await listShipGateImages(root);
  const missing = rows.filter((r) => !r.present);
  if (missing.length) {
    throw new Error(
      `${missing.length} ship-gate files missing (${missing.map((r) => r.id).join(", ")}). Run: npm run eval:download:ship-gate`,
    );
  }
  const roots = await resolveRoots();
  let chrome = null;
  for (const bin of chromeCandidates()) {
    try {
      await stat(bin);
      chrome = bin;
      break;
    } catch {
      /* next */
    }
  }
  if (!chrome) throw new Error("Chrome not found. Set CHROME_PATH.");

  const server = await startServer({ ...roots, scored: rows });
  console.error(`serving ${server.url} n=${rows.length} (ship-gate only)`);
  const profile = join(tmpdir(), `grain-ship-gate-${process.pid}`);
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-webgpu",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      server.url,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const timeoutMs = Number(process.env.GRAIN_CHROME_EVAL_TIMEOUT_MS || 30 * 60 * 1000);
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const payload = await server.done;
    if (!payload?.ok || !Array.isArray(payload.rows)) throw new Error("no /done rows");
    const byName = new Map(payload.rows.map((r) => [r.name, r]));
    const joined = rows.map((r) => {
      const hit = byName.get(r.name);
      if (!hit) throw new Error(`chrome-path missed ${r.id}`);
      return {
        id: r.id,
        role: r.role,
        name: r.name,
        label: r.label,
        score: hit.score,
        visual: hit.visual,
        siglip: hit.siglip,
        commfor: hit.commfor,
        reasons: hit.reasons,
      };
    });

    console.log("");
    console.log("Grain chrome-path SHIP GATE (not the 358 mix, not PR 12 holdout)");
    console.log(`Models: ${MODELS.siglip2.id} + ${MODELS.commfor.id}`);
    console.log(`Fuse bias=${FUSE_DEFAULTS.bias}  cut=${EVAL_THRESHOLD}`);
    console.log(`Backend: ${payload.provider}  webgpu: ${payload.webgpu}`);
    console.log("");
    for (const r of joined) {
      const pred = r.score >= EVAL_THRESHOLD ? "AI" : "real";
      console.log(
        `${r.id.padEnd(22)} ${pred.padEnd(4)} score=${r.score.toFixed(6)} vis=${r.visual.toFixed(3)} sl=${r.siglip.toFixed(3)} cf=${r.commfor.toFixed(3)} ${(r.reasons || []).join(",")}`,
      );
    }

    assertShipGateScores(joined, EVAL_THRESHOLD);
    console.log("");
    console.log("SHIP GATE PASS: Charlesworth < 0.65, Nous stays real.");

    await mkdir(join(root, "eval/results"), { recursive: true });
    const out = join(root, "eval/results/ship-gate-chrome.json");
    await writeFile(
      out,
      JSON.stringify(
        {
          path: "chrome-ort-web-ship-gate",
          scalar: false,
          diagnostic: false,
          shipGate: true,
          backend: payload.provider,
          webgpu: payload.webgpu,
          threshold: EVAL_THRESHOLD,
          fuse: FUSE_DEFAULTS,
          rows: joined,
          note: "Named product fixtures only. Not the 358 KEEP scalar. Not PR 12 holdout.",
        },
        null,
        2,
      ),
    );
    console.log(`Wrote ${out}`);
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
