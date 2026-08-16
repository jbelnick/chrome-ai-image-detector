/**
 * Chrome-path infer. Overlay and chrome-eval must both call scoreImage
 * on the same file bytes. See SCORE-CONTRACT.md.
 */
import { MODELS } from "./model-config.js";
import { scanProvenance } from "./provenance.js";
import {
  PREPROCESS,
  scaledSize,
  centerCropBox,
  imageDataToTensor,
  visualProbabilityFromLogit,
  applyCanvasResample,
} from "./preprocess.js";
import { analyzePixels } from "./graphic-gate.js";
import { fuseScores, FUSE_DEFAULTS } from "./fuse.js";
import {
  SIGLIP,
  imageDataToSiglipTensor,
  siglipProbability,
  blendVisual,
} from "./siglip.js";

/** Badge / product cut. AI iff score >= 0.65. Not a remapped raw threshold. */
export const PRODUCT_THRESHOLD = 0.65;

export function cropForCommfor(bitmap, Canvas = globalThis.OffscreenCanvas) {
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  applyCanvasResample(ctx, "commfor");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const box = centerCropBox(width, height, PREPROCESS.crop);
  return ctx.getImageData(box.x, box.y, box.size, box.size);
}

export function squareForSiglip(bitmap, Canvas = globalThis.OffscreenCanvas) {
  const canvas = new Canvas(SIGLIP.size, SIGLIP.size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  applyCanvasResample(ctx, "siglip");
  ctx.drawImage(bitmap, 0, 0, SIGLIP.size, SIGLIP.size);
  return ctx.getImageData(0, 0, SIGLIP.size, SIGLIP.size);
}

/**
 * Finish the badge from model outputs + byte/pixel signals.
 * Used by scoreImage after decode; also the unit-test seam.
 */
export function scoreFromModels({
  siglip,
  commfor,
  provenance,
  graphic,
  config = FUSE_DEFAULTS,
} = {}) {
  const visual = blendVisual(siglip, commfor, graphic);
  const fused = fuseScores({ visual, provenance, graphic, config });
  return {
    score: fused.score,
    visual,
    siglip,
    commfor,
    reasons: fused.reasons,
    provenance,
    graphic,
    fused,
  };
}

/**
 * Score one image from its bytes. Overlay and chrome-eval call this.
 *
 * @param {Uint8Array|ArrayBuffer} bytes raw image bytes (same fetch as the page)
 * @param {object} [options]
 * @param {string} [options.mime]
 * @param {object} [options.cfSession] Community Forensics ORT session
 * @param {object} [options.slSession] SigLIP2 ORT session
 * @param {Function} [options.Tensor] ort.Tensor (defaults to globalThis.ort.Tensor)
 * @param {object} [options.config] fusion config (defaults to FUSE_DEFAULTS)
 * @param {Function} [options.runVisual] test seam; skips ONNX when provided
 * @param {Function} [options.createBitmap] defaults to createImageBitmap
 * @param {Function} [options.Canvas] defaults to OffscreenCanvas
 */
export async function scoreImage(bytes, {
  mime,
  cfSession,
  slSession,
  Tensor,
  config = FUSE_DEFAULTS,
  runVisual,
  createBitmap = globalThis.createImageBitmap,
  Canvas = globalThis.OffscreenCanvas,
} = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const provenance = scanProvenance(u8);
  if (typeof createBitmap !== "function") {
    throw new Error("scoreImage requires createImageBitmap (Chrome overlay / chrome-eval)");
  }
  const blob = new Blob([u8], { type: mime || "application/octet-stream" });
  const bitmap = await createBitmap(blob);
  try {
    const cfPixels = cropForCommfor(bitmap, Canvas);
    const slPixels = squareForSiglip(bitmap, Canvas);
    const graphic = analyzePixels(cfPixels.data, cfPixels.width, cfPixels.height);
    let commfor;
    let siglip;
    if (runVisual) {
      ({ commfor, siglip } = await runVisual({
        cfPixels,
        slPixels,
        graphic,
        provenance,
      }));
    } else {
      const OrtTensor = Tensor || globalThis.ort?.Tensor;
      if (!cfSession || !slSession || !OrtTensor) {
        throw new Error("scoreImage requires cfSession, slSession, and ort.Tensor");
      }
      const cfTensor = imageDataToTensor(cfPixels.data, cfPixels.width, cfPixels.height);
      const slTensor = imageDataToSiglipTensor(slPixels.data, slPixels.width, slPixels.height);
      const cfOut = await cfSession.run({
        [MODELS.commfor.inputName]: new OrtTensor("float32", cfTensor, [
          1,
          3,
          PREPROCESS.crop,
          PREPROCESS.crop,
        ]),
      });
      const slOut = await slSession.run({
        [MODELS.siglip2.inputName]: new OrtTensor("float32", slTensor, [
          1,
          3,
          SIGLIP.size,
          SIGLIP.size,
        ]),
      });
      commfor = visualProbabilityFromLogit(
        Number(cfOut[MODELS.commfor.outputName].data[0]),
      );
      siglip = siglipProbability(slOut[MODELS.siglip2.outputName].data);
    }
    return scoreFromModels({
      siglip,
      commfor,
      provenance,
      graphic,
      config,
    });
  } finally {
    bitmap.close?.();
  }
}

/** Named overlay / eval entry points. Same function as scoreImage. */
export const overlayPath = scoreImage;
export const chromeEvalPath = scoreImage;
