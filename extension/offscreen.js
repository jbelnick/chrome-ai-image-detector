import { MODELS } from "./lib/model-config.js";
import { scanProvenance } from "./lib/provenance.js";
import {
  PREPROCESS,
  scaledSize,
  centerCropBox,
  imageDataToTensor,
  visualProbabilityFromLogit,
  applyCanvasResample,
} from "./lib/preprocess.js";
import { analyzePixels } from "./lib/graphic-gate.js";
import { fuseScores, FUSE_DEFAULTS } from "./lib/fuse.js";
import { sha256Hex, assertSha256 } from "./lib/sha256.js";
import {
  SIGLIP,
  imageDataToSiglipTensor,
  siglipProbability,
  blendVisual,
} from "./lib/siglip.js";
import { base64ToBytes } from "./lib/transfer-bytes.js";

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

function cropForCommfor(bitmap) {
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  applyCanvasResample(ctx, "commfor");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const box = centerCropBox(width, height, PREPROCESS.crop);
  return ctx.getImageData(box.x, box.y, box.size, box.size);
}

function squareForSiglip(bitmap) {
  const canvas = new OffscreenCanvas(SIGLIP.size, SIGLIP.size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  applyCanvasResample(ctx, "siglip");
  ctx.drawImage(bitmap, 0, 0, SIGLIP.size, SIGLIP.size);
  return ctx.getImageData(0, 0, SIGLIP.size, SIGLIP.size);
}

async function inferBytes(bytes, mime) {
  await initModel();
  const provenance = scanProvenance(bytes);
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const bitmap = await createImageBitmap(blob);
  try {
    const cfPixels = cropForCommfor(bitmap);
    const slPixels = squareForSiglip(bitmap);
    const graphic = analyzePixels(cfPixels.data, cfPixels.width, cfPixels.height);
    const cfTensor = imageDataToTensor(cfPixels.data, cfPixels.width, cfPixels.height);
    const slTensor = imageDataToSiglipTensor(slPixels.data, slPixels.width, slPixels.height);
    const cfOut = await cfSession.run({
      [MODELS.commfor.inputName]: new ort.Tensor("float32", cfTensor, [1, 3, PREPROCESS.crop, PREPROCESS.crop]),
    });
    const slOut = await slSession.run({
      [MODELS.siglip2.inputName]: new ort.Tensor("float32", slTensor, [1, 3, SIGLIP.size, SIGLIP.size]),
    });
    const commfor = visualProbabilityFromLogit(Number(cfOut[MODELS.commfor.outputName].data[0]));
    const siglip = siglipProbability(slOut[MODELS.siglip2.outputName].data);
    const visual = blendVisual(siglip, commfor, graphic);
    const fused = fuseScores({ visual, provenance, graphic, config: fuseConfig });
    return {
      score: fused.score,
      visual,
      siglip,
      commfor,
      reasons: fused.reasons,
      provenance: provenance.signals,
      graphic: graphic.isGraphic,
      provider: activeProvider,
    };
  } finally {
    bitmap.close?.();
  }
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
