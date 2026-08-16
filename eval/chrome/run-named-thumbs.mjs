#!/usr/bin/env node
/**
 * Chrome-path dump for named compressed-thumb AI fixtures + ship-gate
 * Charlesworth / UI probes. Same offscreen fusion as the extension.
 *
 *   GRAIN_NAMED_THUMB_DIR=/path npm run eval:chrome:named-thumbs
 *
 * Not the PR 12 holdout. Sharp does not count.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { MODELS, EVAL_THRESHOLD } from "../../src/model-config.js";
import { FUSE_DEFAULTS } from "../../src/fuse.js";
import { repoRoot } from "./list.mjs";

const root = repoRoot();
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
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

export const REQUIRED_THUMB_AI_NAMES = [
  "q60-250-Theatre_Dopera_Spatial.jpg",
  "q60-250-Space_opera_1_Midjourney.jpg",
  "250px-Theatre_Dopera_Spatial.jpg",
  "250px-Space_opera_1_Midjourney.jpg",
  "250px-DALLE2_Shiba_beret.jpg",
  "q60-250-DALLE2_Shiba_beret.jpg",
];

export const REQUIRED_GATE_NAMES = [
  "Mrs_Winifred_Charlesworth.jpg",
  "250px-Mrs_Winifred_Charlesworth.jpg",
  "Blender_2.92_UI.png",
  "LibreOffice_Writer_7.5.png",
  "simple_pie_chart.png",
  "VLC_UI.png",
];

function chromeCandidates() {
  if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
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

async function listProbe(dir) {
  const names = await readdir(dir);
  const rows = [];
  for (const name of names) {
    if (!IMAGE_EXT.has(extname(name).toLowerCase())) continue;
    rows.push({ name, label: 0, path: join(dir, name) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

async function startServer({ vendor, models, lib, dataDir, scored }) {
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
        console.error(`scored ${body.scored}/${body.total}  provider=${body.provider}${secs}`);
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
        file = underRoot(dataDir, url.pathname.slice("/eval-data".length));
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

export function dumpPathFromRoot(repo = root) {
  return join(repo, "eval/chrome/named-thumb-ai-chrome.json");
}

async function main() {
  const data = process.env.GRAIN_NAMED_THUMB_DIR || join(root, "eval/data/named-thumb-ai");
  const scored = await listProbe(data);
  const vendor = await firstExisting([
    join(root, "extension/vendor/ort"),
    join(root, "node_modules/onnxruntime-web/dist"),
  ]);
  const models = await firstExisting([join(root, "extension/models"), join(root, "models")]);
  if (!vendor || !models) throw new Error("missing ORT vendor or models");
  const chrome = await firstExisting(chromeCandidates());
  if (!chrome) throw new Error("Chrome not found");
  const server = await startServer({
    vendor,
    models,
    lib: join(root, "src"),
    dataDir: data,
    scored,
  });
  console.error(`serving ${server.url} n=${scored.length} page=eval/chrome/page.js`);
  const profile = join(tmpdir(), `grain-named-thumbs-${process.pid}`);
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
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/FATAL|FAIL /i.test(text)) process.stderr.write(text);
  });
  const timeoutMs = Number(process.env.GRAIN_CHROME_EVAL_TIMEOUT_MS || 30 * 60 * 1000);
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const payload = await server.done;
    if (!payload?.ok) throw new Error("no /done");
    const rows = payload.rows || [];
    console.log("");
    console.log("Grain chrome-path named-thumb-ai dump (same offscreen fusion as the extension)");
    console.log(`Backend: ${payload.provider}  webgpu: ${payload.webgpu}`);
    console.log(`Fuse bias=${FUSE_DEFAULTS.bias}  cut=${EVAL_THRESHOLD}`);
    console.log(`Models: ${MODELS.siglip2.id} + ${MODELS.commfor.id}`);
    console.log("");
    for (const r of rows) {
      const g = r.graphic || {};
      const badge = `${Math.round((r.score || 0) * 100)}%`;
      console.log(
        `${r.name.padEnd(40)} badge=${badge.padStart(4)} score=${Number(r.score).toFixed(6)} vis=${Number(r.visual).toFixed(3)} sl=${Number(r.siglip).toFixed(3)} cf=${Number(r.commfor).toFixed(3)} ${(r.reasons || []).join(",")}`,
      );
      console.log(
        `     isGraphic=${g.isGraphic ? "true" : "false"} scanGrain=${g.scanGrain ? "true" : "false"} uiCapture=${g.uiCapture ? "true" : "false"} colors=${g.uniqueColors} edge=${Number(g.edgeRatio).toFixed(3)} fine=${Number(g.fineRatio).toFixed(3)} col=${Number(g.colorfulness).toFixed(1)}`,
      );
    }
    await mkdir(join(root, "eval/chrome"), { recursive: true });
    const out = dumpPathFromRoot(root);
    await writeFile(
      out,
      JSON.stringify(
        {
          path: "chrome-ort-web-named-thumb-ai",
          sharp: false,
          backend: payload.provider,
          webgpu: payload.webgpu,
          gpu: payload.gpu,
          hashes: payload.hashes,
          threshold: EVAL_THRESHOLD,
          fuse: FUSE_DEFAULTS,
          n: rows.length,
          rows,
          note: "Chrome-path dump of named compressed-thumb AI fixtures plus Charlesworth/UI gate. createImageBitmap + OffscreenCanvas + shipped fuse. Sharp does not count. Not PR 12 holdout.",
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${out}`);
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await server.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
