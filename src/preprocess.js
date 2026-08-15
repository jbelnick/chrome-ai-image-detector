/**
 * Community Forensics test-time preprocessing:
 * resize shorter edge to 440, center-crop 384, mean-center, NCHW.
 * Experiment: 4-tile luma histogram equalization before mean-only
 * ImageNet so local contrast (not global grade) reaches the ViT.
 */

export const PREPROCESS = {
  resizeShortEdge: 440,
  crop: 384,
  mean: [0.485, 0.456, 0.406],
  // Experiment: mean-only (skip ImageNet std). Keeps the trained
  // centering, drops the per-channel gain that can hide generator
  // color-grade differences.
  std: [1, 1, 1],
  claheTiles: 4,
};

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
 * Tile-wise luma histogram equalization (CLAHE-lite, no clip).
 * Local contrast stretch; chroma is rescaled with luma so hue holds.
 */
export function equalizeLumaTiles(data, width, height, tiles = PREPROCESS.claheTiles) {
  const out = new Uint8Array(data);
  const tileW = Math.floor(width / tiles);
  const tileH = Math.floor(height / tiles);
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = tx === tiles - 1 ? width : x0 + tileW;
      const y1 = ty === tiles - 1 ? height : y0 + tileH;
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const lum = Math.max(
            0,
            Math.min(255, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])),
          );
          hist[lum] += 1;
        }
      }
      const nPix = (x1 - x0) * (y1 - y0) || 1;
      const map = new Uint8Array(256);
      let acc = 0;
      for (let v = 0; v < 256; v += 1) {
        acc += hist[v];
        map[v] = Math.round((acc / nPix) * 255);
      }
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const yOld = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const yNew = map[Math.max(0, Math.min(255, Math.round(yOld)))];
          const scale = yOld > 1 ? yNew / yOld : 1;
          out[i] = Math.max(0, Math.min(255, Math.round(data[i] * scale)));
          out[i + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] * scale)));
          out[i + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] * scale)));
          out[i + 3] = data[i + 3];
        }
      }
    }
  }
  return out;
}

/**
 * Convert an RGBA ImageData-like buffer (row-major) into a float32
 * NCHW tensor using ImageNet mean/std. `data` is Uint8ClampedArray or Uint8Array.
 */
export function imageDataToTensor(
  data,
  width,
  height,
  { mean = PREPROCESS.mean, std = PREPROCESS.std, clahe = PREPROCESS.claheTiles } = {},
) {
  if (width !== PREPROCESS.crop || height !== PREPROCESS.crop) {
    throw new Error(`expected ${PREPROCESS.crop}x${PREPROCESS.crop} crop, got ${width}x${height}`);
  }
  const src = clahe ? equalizeLumaTiles(data, width, height, clahe) : data;
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const r = src[i * 4] / 255;
    const g = src[i * 4 + 1] / 255;
    const b = src[i * 4 + 2] / 255;
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
