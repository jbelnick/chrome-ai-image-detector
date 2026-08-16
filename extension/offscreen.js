import { MODELS } from "./lib/model-config.js";
import { FUSE_DEFAULTS } from "./lib/fuse.js";
import { sha256Hex, assertSha256 } from "./lib/sha256.js";
import { base64ToBytes } from "./lib/transfer-bytes.js";
import { scoreImage } from "./lib/score-image.js";

let cfSession = null;
let slSession = null;
let activeProvider = "wasm";
let initPromise = null;
const fuseConfig = { ...FUSE_DEFAULTS };

async function readModelBuffer(spec) {
  const url = chrome.runtime.getURL(`models/${spec.filename}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Packaged ${spec.id} missing (${response.status}). Run npm run fetch-models && npm run build.`,
    );
  }
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

async function createSessions() {
  const ort = globalThis.ort;
  if (!ort) throw new Error("onnxruntime-web failed to load");
  ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
  ort.env.wasm.numThreads = 1;
  const preferGpu = Boolean(navigator.gpu);

  const cf = await readModelBuffer(MODELS.commfor);
  const sl = await readModelBuffer(MODELS.siglip2);
  const cfCreated = await createSession(ort, cf.buffer, preferGpu);
  const slCreated = await createSession(ort, sl.buffer, preferGpu);
  cfSession = cfCreated.session;
  slSession = slCreated.session;
  activeProvider =
    cfCreated.provider === slCreated.provider
      ? cfCreated.provider
      : `${cfCreated.provider}+${slCreated.provider}`;
  await chrome.storage.local.set({
    setupComplete: true,
    modelSha256: { commfor: cf.hash, siglip2: sl.hash },
    modelId: `${MODELS.siglip2.id}+${MODELS.commfor.id}`,
    executionProvider: activeProvider,
  });
  return {
    hashes: { commfor: cf.hash, siglip2: sl.hash },
    provider: activeProvider,
  };
}

async function initModel() {
  if (cfSession && slSession) return { ready: true, provider: activeProvider };
  if (!initPromise) {
    initPromise = (async () => {
      return createSessions();
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function inferBytes(bytes, mime) {
  await initModel();
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
    provenance: result.provenance.signals,
    graphic: result.graphic.isGraphic,
    provider: activeProvider,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "init-model") {
    initModel()
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }
  if (message?.type === "status") {
    sendResponse({
      ready: Boolean(cfSession && slSession),
      modelId: `${MODELS.siglip2.id}+${MODELS.commfor.id}`,
      provider: activeProvider,
    });
    return false;
  }
  if (message?.type === "infer") {
    let bytes;
    try {
      bytes = base64ToBytes(message.bytesB64);
    } catch (err) {
      sendResponse({ error: String(err.message || err) });
      return false;
    }
    inferBytes(bytes, message.mime)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }
  return false;
});
