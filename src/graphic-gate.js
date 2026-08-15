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
 * Mean-abs 4-neighbor Laplacian on luma. Camera photos keep grain even
 * in flat regions; many generators oversmooth that residual.
 * Threshold is on 8-bit luma units, not fit to eval identities.
 */
export const TEXTURE = {
  oversmoothLap: 11,
};

export function analyzePixels(data, width, height) {
  const bins = 12;
  const colors = new Set();
  let edge = 0;
  let samples = 0;
  let lapSum = 0;
  let lapN = 0;
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
      const lum = lumaAt(data, width, x, y);
      const lumX = lumaAt(data, width, x + stride, y);
      const lumY = lumaAt(data, width, x, y + stride);
      if (Math.abs(lum - lumX) > 28 || Math.abs(lum - lumY) > 28) edge += 1;
      if (x >= stride && y >= stride) {
        const lumW = lumaAt(data, width, x - stride, y);
        const lumN = lumaAt(data, width, x, y - stride);
        lapSum += Math.abs(4 * lum - lumW - lumX - lumN - lumY);
        lapN += 1;
      }
      samples += 1;
    }
  }

  const uniqueRatio = samples === 0 ? 1 : colors.size / samples;
  const edgeRatio = samples === 0 ? 0 : edge / samples;
  const lapEnergy = lapN === 0 ? 0 : lapSum / lapN;
  // Quantized palette size, not unique/samples — large photos always look
  // "sparse" if you divide by pixel count.
  const isGraphic = colors.size < 48 && edgeRatio > 0.12;
  const oversmooth = lapEnergy < TEXTURE.oversmoothLap;
  return {
    uniqueRatio,
    edgeRatio,
    isGraphic,
    samples,
    uniqueColors: colors.size,
    lapEnergy,
    oversmooth,
  };
}

export function graphicScale(analysis) {
  return analysis.isGraphic ? 0.72 : 1;
}
