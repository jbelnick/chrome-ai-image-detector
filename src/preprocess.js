/**
 * Community Forensics test-time preprocessing:
 * resize shorter edge to 440, center-crop 384, mean-center, NCHW.
 * Experiment: ImageNet mean only — std is identity so channel gain
 * is not forced to the ImageNet training recipe.
 */

export const PREPROCESS = {
  resizeShortEdge: 440,
  // Compressed-thumb CF model upsample target. Same short-edge < 440
  // branch (Dukedestiny infobox 250 is 250×197 and takes it). One-shot
  // nearest-to-440 parked Wikipedia Space opera in frozen flat-fine
  // (0.874→0.657). Nearest-to-640 keeps that thumb clearly AI and
  // keeps Dukedestiny 250 well under 0.99. Graphic flags still use 440.
  thumbResizeShortEdge: 640,
  crop: 384,
  mean: [0.485, 0.456, 0.406],
  // Experiment: mean-only (skip ImageNet std). Keeps the trained
  // centering, drops the per-channel gain that can hide generator
  // color-grade differences.
  std: [1, 1, 1],
};

/**
 * OffscreenCanvas resample used by the extension and chrome-path eval.
 * Family 1 run 6: opposite of discarded 47bdfd0.
 * Medium-smooth Community Forensics (try to recover TNR);
 * nearest-neighbor SigLIP (KEEP 404faa6 TPR came from the 224 stretch).
 *
 * Named product rule `compressedThumb`: a source whose short edge is
 * below the CF 440 recipe takes a nearest CF upsample to
 * `thumbResizeShortEdge` (640), then the 384 crop. Medium-smooth
 * upsample to 440 smears leftover generator traces on Wikipedia/social
 * JPEG thumbs. One-shot nearest-to-440 is the same 224-stretch lesson
 * but lands Wikipedia Space opera in frozen flat-fine (not clearly AI).
 * 640 is the decode that keeps Space opera clearly AI and keeps the
 * live Dukedestiny 250×197 infobox well under 0.99. Charlesworth orig
 * is 470×638 (no upsample) and does not take this branch. Graphic
 * flags still read the default medium 440 CF crop so the 250px
 * Charlesworth scanGrain / muted-scan path cannot flip to 99%.
 *
 * This is the source-of-truth decode. Node sharp kernels below are a proxy.
 * node(B) − chrome(B) is decode-delta. Do not absorb it in FUSE_DEFAULTS.
 */
export const CANVAS_RESAMPLE = {
  commfor: { imageSmoothingEnabled: true, imageSmoothingQuality: "medium" },
  siglip: { imageSmoothingEnabled: false, imageSmoothingQuality: "medium" },
  compressedThumb: { imageSmoothingEnabled: false, imageSmoothingQuality: "medium" },
};

/**
 * Node-proxy resample (sharp + onnxruntime-node). Not chrome-path.
 * Chrome uses CANVAS_RESAMPLE via createImageBitmap + OffscreenCanvas.
 * These kernels are the documented Node stand-in, not a fuse target.
 * Changing them changes decode-delta; it does not change the badge.
 */
export const NODE_SHARP_RESAMPLE = {
  commfor: { kernel: "cubic", fit: "fill" },
  siglip: { kernel: "lanczos3", fit: "fill" },
};

/** Chrome-path is truth. Node is a proxy. See eval/DECODE.md. */
export const DECODE_PATHS = {
  chrome: "createImageBitmap + OffscreenCanvas + ort-web",
  node: "sharp + onnxruntime-node",
  sourceOfTruth: "chrome-path",
  deltaName: "decode-delta",
};

export function applyCanvasResample(ctx, which = "commfor") {
  const spec = CANVAS_RESAMPLE[which] || CANVAS_RESAMPLE.commfor;
  ctx.imageSmoothingEnabled = spec.imageSmoothingEnabled;
  ctx.imageSmoothingQuality = spec.imageSmoothingQuality;
}

/**
 * Named product rule: source must be upscaled to reach the CF short-edge.
 * Not a URL or file-hash special-case. Not a fuse band.
 */
export function isCompressedThumbSize(width, height) {
  const short = Math.min(width, height);
  return short > 0 && short < PREPROCESS.resizeShortEdge;
}

/** CF canvas which: nearest upsample on compressed thumbs, else medium. */
export function commforResampleWhich(width, height) {
  return isCompressedThumbSize(width, height) ? "compressedThumb" : "commfor";
}

export function scaledSize(width, height, shortEdge = PREPROCESS.resizeShortEdge) {
  if (width <= 0 || height <= 0) {
    throw new Error("image has no area");
  }
  const short = Math.min(width, height);
  const scale = shortEdge / short;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function centerCropBox(width, height, crop = PREPROCESS.crop) {
  const size = Math.min(crop, width, height);
  return {
    x: Math.max(0, Math.floor((width - size) / 2)),
    y: Math.max(0, Math.floor((height - size) / 2)),
    size,
  };
}

export function shouldAnalyzeDimensions(width, height, minSide = 64) {
  return width >= minSide && height >= minSide;
}

/**
 * Convert an RGBA ImageData-like buffer (row-major) into a float32
 * NCHW tensor using ImageNet mean/std. `data` is Uint8ClampedArray or Uint8Array.
 */
export function imageDataToTensor(
  data,
  width,
  height,
  { mean = PREPROCESS.mean, std = PREPROCESS.std } = {},
) {
  if (width !== PREPROCESS.crop || height !== PREPROCESS.crop) {
    throw new Error(`expected ${PREPROCESS.crop}x${PREPROCESS.crop} crop, got ${width}x${height}`);
  }
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    tensor[i] = (r - mean[0]) / std[0];
    tensor[plane + i] = (g - mean[1]) / std[1];
    tensor[2 * plane + i] = (b - mean[2]) / std[2];
  }
  return tensor;
}

export function visualProbabilityFromLogit(logit) {
  if (!Number.isFinite(logit)) return 0.5;
  if (logit >= 20) return 1 - 1e-6;
  if (logit <= -20) return 1e-6;
  return 1 / (1 + Math.exp(-logit));
}
