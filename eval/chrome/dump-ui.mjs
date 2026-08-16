#!/usr/bin/env node
/**
 * Chrome-path dump for the independent UI probe (or any folder).
 * Same offscreen fusion as the extension. Not a KEEP scalar.
 *
 *   node eval/chrome/dump-ui.mjs
 *   GRAIN_UI_PROBE_DIR=eval/data/ui-probe node eval/chrome/dump-ui.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
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

async function resolveRoots() {
  const vendor = await firstExisting([
    join(root, "extension/vendor/ort"),
    join(root, "node_modules/onnxruntime-web/dist"),
  ]);
  if (!vendor) throw new Error("ORT web files missing. Run npm run build");
  const models = await firstExisting([
    join(root, "extension/models"),
    join(root, "models"),
  ]);
  if (!models) throw new Error("ONNX missing. Run npm run fetch-models && npm run build");
  return { vendor, models, lib: join(root, "src") };
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
    const label = name.startsWith("ai_") ? 1 : 0;
    rows.push({ name, label, path: join(dir, name) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
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
  const data = resolve(root, process.env.GRAIN_UI_PROBE_DIR || "eval/data/ui-probe");
  const scored = await listProbe(data);
  if (!scored.length) throw new Error(`no images in ${data}`);
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
  if (!chrome) throw new Error("Chrome not found");
  const server = await startServer({ ...roots, data, scored });
  console.error(`serving ${server.url} n=${scored.length}`);
  const profile = join(tmpdir(), `grain-ui-dump-${process.pid}`);
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
    if (!payload?.ok) throw new Error("no /done");
    const rows = payload.rows || [];
    console.log("");
    console.log("Grain chrome-path UI probe (not a KEEP scalar, not the holdout)");
    console.log(`Backend: ${payload.provider}  webgpu: ${payload.webgpu}`);
    console.log(`Fuse bias=${FUSE_DEFAULTS.bias}  cut=${EVAL_THRESHOLD}`);
    console.log("");
    for (const r of rows) {
      const g = r.graphic || {};
      const badge = `${Math.round((r.score || 0) * 100)}%`;
      const pred = r.score >= EVAL_THRESHOLD ? "AI" : "real";
      const truth = r.label === 1 ? "AI" : "real";
      const hit = pred === truth ? "ok" : "MISS";
      console.log(
        `${hit.padEnd(4)} ${r.name.padEnd(28)} badge=${badge.padStart(4)} score=${r.score.toFixed(3)} vis=${r.visual.toFixed(3)} sl=${r.siglip.toFixed(3)} cf=${r.commfor.toFixed(3)} ${ (r.reasons || []).join(",")}`,
      );
      console.log(
        `     graphic=${g.isGraphic ? "Y" : "."} scan=${g.scanGrain ? "Y" : "."} ui=${g.uiCapture ? "Y" : "."} mut=${g.muted ? "Y" : "."} viv=${g.vivid ? "Y" : "."} flat=${g.flatTone ? "Y" : "."} colors=${g.uniqueColors} edge=${Number(g.edgeRatio).toFixed(3)} fine=${Number(g.fineRatio).toFixed(3)} col=${Number(g.colorfulness).toFixed(1)}`,
      );
    }
    await mkdir(join(root, "eval/results"), { recursive: true });
    const out = join(root, "eval/results/ui-probe-chrome.json");
    await writeFile(out, JSON.stringify({ ...payload, threshold: EVAL_THRESHOLD, fuse: FUSE_DEFAULTS }, null, 2));
    console.log(`\nWrote ${out}`);
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
