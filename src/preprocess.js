/**
 * Community Forensics test-time preprocessing:
 * resize shorter edge to 440, center-crop 384, mean-center, NCHW.
 * Experiment: ImageNet mean only — std is identity so channel gain
 * is not forced to the ImageNet training recipe.
 */

export const PREPROCESS = {
  resizeShortEdge: 440,
  crop: 384,
  mean: [0.485, 0.456, 0.406],
  // Experiment: mean-only (skip ImageNet std). Keeps the trained
  // centering, drops the per-channel gain that can hide generator
  // color-grade differences.
  std: [1, 1, 1],
};

/**
 * OffscreenCanvas resample used by the extension and chrome-path eval.
 * Family 1 run 3: keep nearest on Community Forensics (KEEP 404faa6
 * TPR gain) and medium-smooth SigLIP (try to recover TNR).
 */
export const CANVAS_RESAMPLE = {
  commfor: { imageSmoothingEnabled: false, imageSmoothingQuality: "medium" },
  siglip: { imageSmoothingEnabled: true, imageSmoothingQuality: "medium" },
};

export function applyCanvasResample(ctx, which = "commfor") {
  const spec = CANVAS_RESAMPLE[which] || CANVAS_RESAMPLE.commfor;
  ctx.imageSmoothingEnabled = spec.imageSmoothingEnabled;
  ctx.imageSmoothingQuality = spec.imageSmoothingQuality;
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
