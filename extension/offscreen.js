import { MODEL } from "./lib/model-config.js";
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

let session = null;
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

async function readPackagedModel() {
  const url = chrome.runtime.getURL(`models/${MODEL.filename}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Packaged model missing (${response.status}). Run npm run fetch-models && npm run build.`,
    );
  }
  return response.arrayBuffer();
}

async function createSession(buffer) {
  const hash = await sha256Hex(buffer);
  assertSha256(hash, MODEL.sha256, MODEL.filename);
  const ort = globalThis.ort;
  if (!ort) throw new Error("onnxruntime-web failed to load");
  ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
  ort.env.wasm.numThreads = 1;
  const providers = [];
  if (navigator.gpu) providers.push("webgpu");
  providers.push("wasm");
  session = await ort.InferenceSession.create(buffer, {
    executionProviders: providers,
  });
  await chrome.storage.local.set({
    setupComplete: true,
    modelSha256: hash,
    modelId: MODEL.id,
  });
  return { hash, provider: providers[0] };
}

async function initModel() {
  if (session) return { ready: true };
  if (!initPromise) {
    initPromise = (async () => {
      await loadFuseConfig();
      const buffer = await readPackagedModel();
      return createSession(buffer);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function decodeRgba(bitmap) {
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const box = centerCropBox(width, height, PREPROCESS.crop);
  const crop = ctx.getImageData(box.x, box.y, box.size, box.size);
  return crop;
}

async function inferBytes(bytes, mime) {
  await initModel();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const provenance = scanProvenance(bytes);
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const bitmap = await createImageBitmap(blob);
  try {
    const imageData = decodeRgba(bitmap);
    const graphic = analyzePixels(imageData.data, imageData.width, imageData.height);
    const tensor = imageDataToTensor(imageData.data, imageData.width, imageData.height);
    const input = new ort.Tensor("float32", tensor, [1, 3, PREPROCESS.crop, PREPROCESS.crop]);
    const outputs = await session.run({ [MODEL.inputName]: input });
    const logits = outputs[MODEL.outputName].data;
    const visual = visualProbabilityFromLogit(Number(logits[0]));
    const fused = fuseScores({ visual, provenance, graphic, config: fuseConfig });
    return {
      score: fused.score,
      visual,
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
    sendResponse({ ready: Boolean(session), modelId: MODEL.id });
    return false;
  }
  if (message?.type === "infer") {
    const bytes = new Uint8Array(message.buffer);
    inferBytes(bytes, message.mime)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }
  return false;
});
