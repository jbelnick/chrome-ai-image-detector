/**
 * Chrome-path eval. Calls scoreImage(bytes) — same infer as the overlay.
 */
import { MODELS } from "/lib/model-config.js";
import { FUSE_DEFAULTS } from "/lib/fuse.js";
import { sha256Hex, assertSha256 } from "/lib/sha256.js";
import { scoreImage } from "/lib/score-image.js";

const logEl = document.getElementById("log");
const fuseConfig = { ...FUSE_DEFAULTS };

function log(line) {
  logEl.textContent += `${line}\n`;
}

async function fetchOk(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return res;
      last = new Error(`${url} ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  throw last;
}

async function post(path, body, { required = true } = {}) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} ${res.status}`);
    return res.json().catch(() => ({}));
  } catch (err) {
    if (required) throw err;
    console.warn(`POST ${path} failed`, err);
    return {};
  }
}

async function readModelBuffer(spec) {
  const response = await fetchOk(`/models/${spec.filename}`);
  const buffer = await response.arrayBuffer();
  const hash = await sha256Hex(buffer);
  assertSha256(hash, spec.sha256, spec.filename);
  if (buffer.byteLength !== spec.bytes) {
    throw new Error(`${spec.id} size ${buffer.byteLength} != ${spec.bytes}`);
  }
  return { buffer, hash };
}

async function createSession(ort, buffer, preferGpu) {
  if (preferGpu) {
    try {
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ["webgpu"],
      });
      return { session, provider: "webgpu" };
    } catch (err) {
      console.warn("webgpu session failed, falling back to wasm", err);
    }
  }
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });
  return { session, provider: "wasm" };
}

async function probeGpu() {
  const hasNavigatorGpu = Boolean(navigator.gpu);
  let adapter = false;
  let adapterInfo = null;
  if (hasNavigatorGpu) {
    try {
      const a = await navigator.gpu.requestAdapter();
      adapter = Boolean(a);
      if (a?.info) {
        adapterInfo = {
          vendor: a.info.vendor || "",
          architecture: a.info.architecture || "",
          device: a.info.device || "",
        };
      }
    } catch (err) {
      adapter = false;
      adapterInfo = { error: String(err.message || err) };
    }
  }
  return { hasNavigatorGpu, adapter, adapterInfo };
}

function graphicDump(graphic) {
  return {
    isGraphic: graphic.isGraphic,
    scanGrain: graphic.scanGrain,
    uiCapture: graphic.uiCapture,
    uniqueColors: graphic.uniqueColors,
    edgeRatio: graphic.edgeRatio,
    fineRatio: graphic.fineRatio,
    colorfulness: graphic.colorfulness,
    muted: graphic.muted,
  };
}

async function inferBytes(cfSession, slSession, bytes, mime) {
  const result = await scoreImage(bytes, {
    mime,
    cfSession,
    slSession,
    config: fuseConfig,
  });
  return {
    score: result.score,
    visual: result.visual,
    siglip: result.siglip,
    commfor: result.commfor,
    reasons: result.reasons,
    graphic: graphicDump(result.graphic),
  };
}

function mimeFromName(name) {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}

async function main() {
  const ort = globalThis.ort;
  if (!ort) throw new Error("onnxruntime-web failed to load");
  ort.env.wasm.wasmPaths = "/vendor/ort/";
  ort.env.wasm.numThreads = 1;

  const gpu = await probeGpu();
  const arch = String(gpu.adapterInfo?.architecture || "").toLowerCase();
  const softwareAdapter = arch.includes("swiftshader") || arch.includes("llvmpipe");
  // Software WebGPU is not a real GPU device. Jason asked for UNVERIFIED
  // hardware WebGPU in that case and a labeled WASM run.
  const preferGpu = gpu.hasNavigatorGpu && gpu.adapter && !softwareAdapter;
  log(
    `navigator.gpu=${gpu.hasNavigatorGpu} adapter=${gpu.adapter} software=${softwareAdapter} preferGpu=${preferGpu}`,
  );

  const cf = await readModelBuffer(MODELS.commfor);
  const sl = await readModelBuffer(MODELS.siglip2);
  const cfCreated = await createSession(ort, cf.buffer, preferGpu);
  const slCreated = await createSession(ort, sl.buffer, preferGpu);
  const provider =
    cfCreated.provider === slCreated.provider
      ? cfCreated.provider
      : `${cfCreated.provider}+${slCreated.provider}`;
  const webgpuSession = provider.includes("webgpu");
  const webgpu = webgpuSession
    ? softwareAdapter
      ? "software-swiftshader"
      : "initialized"
    : "UNVERIFIED";
  log(`sessions ready provider=${provider} webgpu=${webgpu}`);
  await post(
    "/progress",
    {
      scored: 0,
      total: 0,
      provider,
      webgpu,
      elapsedMs: 0,
      phase: "sessions-ready",
    },
    { required: false },
  );
  await new Promise((r) => setTimeout(r, 250));

  const manifest = await (await fetchOk("/manifest.json")).json();
  log(`manifest n=${manifest.length}`);
  const scored = [];
  const startedAt = Date.now();
  for (const [index, row] of manifest.entries()) {
    const res = await fetchOk(`/eval-data/${row.name}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const result = await inferBytes(
      cfCreated.session,
      slCreated.session,
      bytes,
      mimeFromName(row.name),
    );
    scored.push({
      name: row.name,
      label: row.label,
      score: result.score,
      visual: result.visual,
      siglip: result.siglip,
      commfor: result.commfor,
      reasons: result.reasons,
      graphic: result.graphic,
    });
    if ((index + 1) % 5 === 0 || index === manifest.length - 1) {
      log(`scored ${index + 1}/${manifest.length}`);
      await post(
        "/progress",
        {
          scored: index + 1,
          total: manifest.length,
          provider,
          webgpu,
          elapsedMs: Date.now() - startedAt,
        },
        { required: false },
      );
    }
  }

  await post("/done", {
    ok: true,
    provider,
    webgpu,
    gpu,
    hashes: { commfor: cf.hash, siglip2: sl.hash },
    fuse: FUSE_DEFAULTS,
    n: scored.length,
    rows: scored,
  });
  log("posted /done");
}

main().catch(async (err) => {
  const message = String(err?.stack || err?.message || err);
  log(`FAIL ${message}`);
  try {
    await post("/fail", { error: message });
  } catch {
    /* driver will time out */
  }
});
