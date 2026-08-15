import { MODELS } from "./lib/model-config.js";
import { scanProvenance } from "./lib/provenance.js";
import {
  PREPROCESS,
  scaledSize,
  centerCropBox,
  imageDataToTensor,
  visualProbabilityFromLogit,
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

let cfSession = null;
let slSession = null;
let initPromise = null;
let fuseConfig = { ...FUSE_DEFAULTS };

async function loadFuseConfig() {
  try {
    const stored = await chrome.storage.local.get(["fuse"]);
    if (stored.fuse && typeof stored.fuse === "object") {
      fuseConfig = { ...FUSE_DEFAULTS, ...stored.fuse };
    }
  } catch {
    fuseConfig = { ...FUSE_DEFAULTS };
  }
}

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

async function createSessions() {
  const ort = globalThis.ort;
  if (!ort) throw new Error("onnxruntime-web failed to load");
  ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
  ort.env.wasm.numThreads = 1;
  const providers = [];
  if (navigator.gpu) providers.push("webgpu");
  providers.push("wasm");

  const cf = await readModelBuffer(MODELS.commfor);
  const sl = await readModelBuffer(MODELS.siglip2);
  cfSession = await ort.InferenceSession.create(cf.buffer, { executionProviders: providers });
  slSession = await ort.InferenceSession.create(sl.buffer, { executionProviders: providers });
  await chrome.storage.local.set({
    setupComplete: true,
    modelSha256: { commfor: cf.hash, siglip2: sl.hash },
    modelId: `${MODELS.siglip2.id}+${MODELS.commfor.id}`,
  });
  return { hashes: { commfor: cf.hash, siglip2: sl.hash }, provider: providers[0] };
}

async function initModel() {
  if (cfSession && slSession) return { ready: true };
  if (!initPromise) {
    initPromise = (async () => {
      await loadFuseConfig();
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const box = centerCropBox(width, height, PREPROCESS.crop);
  return ctx.getImageData(box.x, box.y, box.size, box.size);
}

function squareForSiglip(bitmap) {
  const canvas = new OffscreenCanvas(SIGLIP.size, SIGLIP.size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
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
    const visual = blendVisual(siglip, commfor);
    const fused = fuseScores({ visual, provenance, graphic, config: fuseConfig });
    return {
      score: fused.score,
      visual,
      siglip,
      commfor,
      reasons: fused.reasons,
      provenance: provenance.signals,
      graphic: graphic.isGraphic,
    };
  } finally {
    bitmap.close?.();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "init-model") {
    initModel()
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }
  if (message?.type === "status") {
    sendResponse({ ready: Boolean(cfSession && slSession), modelId: MODELS.siglip2.id });
    return false;
  }
  if (message?.type === "infer") {
    if (!message.buffer) {
      sendResponse({ error: "missing image buffer" });
      return false;
    }
    const bytes = new Uint8Array(message.buffer);
    inferBytes(bytes, message.mime)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }
  return false;
});
