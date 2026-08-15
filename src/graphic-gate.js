/**
 * Cheap screenshot / chart / UI gate.
 * Real UI captures are often mis-scored by photo-trained detectors.
 * This only down-weights; it never invents an AI verdict.
 */

export function quantizeChannel(value, bins = 16) {
  const step = 256 / bins;
  return Math.min(bins - 1, Math.floor(value / step));
}

function lumaAt(data, width, x, y) {
  const i = (y * width + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * Ratio of mean |Δluma| on 8-pixel JPEG block boundaries vs interior.
 * >1 means extra energy on the codec grid — a cheap periodic-artifact cue.
 */
export const TEXTURE = {
  blockyRatio: 1.18,
};

export function jpegBlockRatio(data, width, height) {
  let boundary = 0;
  let interior = 0;
  let nB = 0;
  let nI = 0;
  const step = 1;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width - 1; x += step) {
      const d = Math.abs(lumaAt(data, width, x, y) - lumaAt(data, width, x + 1, y));
      if ((x + 1) % 8 === 0) {
        boundary += d;
        nB += 1;
      } else {
        interior += d;
        nI += 1;
      }
    }
  }
  for (let y = 0; y < height - 1; y += step) {
    for (let x = 0; x < width; x += step) {
      const d = Math.abs(lumaAt(data, width, x, y) - lumaAt(data, width, x, y + 1));
      if ((y + 1) % 8 === 0) {
        boundary += d;
        nB += 1;
      } else {
        interior += d;
        nI += 1;
      }
    }
  }
  const b = nB === 0 ? 0 : boundary / nB;
  const inn = nI === 0 ? 0 : interior / nI;
  if (inn === 0) return b > 0 ? 99 : 0;
  return b / inn;
}

export function analyzePixels(data, width, height) {
  const bins = 12;
  const colors = new Set();
  let edge = 0;
  let samples = 0;
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 96));

  for (let y = 0; y < height - stride; y += stride) {
    for (let x = 0; x < width - stride; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      colors.add(
        (quantizeChannel(r, bins) << 8) |
          (quantizeChannel(g, bins) << 4) |
          quantizeChannel(b, bins),
      );
      const j = (y * width + (x + stride)) * 4;
      const k = ((y + stride) * width + x) * 4;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lumX = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      const lumY = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
      if (Math.abs(lum - lumX) > 28 || Math.abs(lum - lumY) > 28) edge += 1;
      samples += 1;
    }
  }

  const uniqueRatio = samples === 0 ? 1 : colors.size / samples;
  const edgeRatio = samples === 0 ? 0 : edge / samples;
  // Quantized palette size, not unique/samples — large photos always look
  // "sparse" if you divide by pixel count.
  const isGraphic = colors.size < 48 && edgeRatio > 0.12;
  const blockRatio = jpegBlockRatio(data, width, height);
  const blocky = blockRatio >= TEXTURE.blockyRatio;
  return {
    uniqueRatio,
    edgeRatio,
    isGraphic,
    samples,
    uniqueColors: colors.size,
    blockRatio,
    blocky,
  };
}

export function graphicScale(analysis) {
  return analysis.isGraphic ? 0.72 : 1;
}
