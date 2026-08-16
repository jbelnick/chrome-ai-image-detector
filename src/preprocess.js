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
 * Family 1 run 6: opposite of discarded 47bdfd0.
 * Medium-smooth Community Forensics (try to recover TNR);
 * nearest-neighbor SigLIP (KEEP 404faa6 TPR came from the 224 stretch).
 *
 * Named product rule `skipUpsample`: when the source short edge is
 * below the CF 440 recipe (or below SigLIP 224), do not scale those
 * pixels up. Letterbox / pad native (or already-smaller) pixels into
 * the 384 / 224 canvas. Wikimedia 250×197 thumbs are the live case;
 * any short-edge-below-recipe file takes the same branch. Not nearest
 * CF stretch (PR 23). Graphic flags still read the default medium 440
 * CF crop so Charlesworth 250px cannot flip off scanGrain.
 *
 * This is the source-of-truth decode. Node sharp kernels below are a proxy.
 * node(B) − chrome(B) is decode-delta. Do not absorb it in FUSE_DEFAULTS.
 */
export const CANVAS_RESAMPLE = {
  commfor: { imageSmoothingEnabled: true, imageSmoothingQuality: "medium" },
  siglip: { imageSmoothingEnabled: false, imageSmoothingQuality: "medium" },
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
 * Named product rule `skipUpsample`: the source short edge is below the
 * model canvas, so the 440/224 recipe would scale pixels up. Not a URL
 * or file-hash special-case. Not nearest stretch (PR 23).
 */
export function isBelowShortEdge(width, height, shortEdge) {
  const short = Math.min(width, height);
  return short > 0 && short < shortEdge;
}

/** ImageNet-mean CSS fill so CF pad is ~0 after mean-centering. */
export function imagenetPadCss(mean = PREPROCESS.mean) {
  const r = Math.round((mean[0] ?? 0.485) * 255);
  const g = Math.round((mean[1] ?? 0.456) * 255);
  const b = Math.round((mean[2] ?? 0.406) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Fit source into dest without scaling up. Downscale only when a side
 * already exceeds dest; otherwise center the native pixels and pad.
 * This is letterbox / skip-upsample, not a stretch.
 */
export function letterboxBox(srcW, srcH, dest) {
  if (srcW <= 0 || srcH <= 0 || dest <= 0) {
    throw new Error("image has no area");
  }
  const scale = Math.min(1, dest / srcW, dest / srcH);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  return {
    x: Math.floor((dest - width) / 2),
    y: Math.floor((dest - height) / 2),
    width,
    height,
    scale,
  };
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
