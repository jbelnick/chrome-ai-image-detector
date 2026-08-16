/**
 * Cheap screenshot / chart / UI gate.
 * Real UI captures are often mis-scored by photo-trained detectors.
 * This only down-weights; it never invents an AI verdict.
 */

export function quantizeChannel(value, bins = 16) {
  const step = 256 / bins;
  return Math.min(bins - 1, Math.floor(value / step));
}

export const TEXTURE = {
  vividColorfulness: 72,
  mutedColorfulness: 28,
  flatToneLo: 0.92,
  flatToneHi: 1.08,
  // Center much brighter than the surround. Leftover web-real FPs
  // with a lit subject on a dark field sit well above flat-tone.
  centerBrightLo: 1.8,
};

export function analyzePixels(data, width, height) {
  const bins = 12;
  const colors = new Set();
  let edge = 0;
  let fine = 0;
  let samples = 0;
  let rgSum = 0;
  let ybSum = 0;
  let rgSq = 0;
  let ybSq = 0;
  let centerLum = 0;
  let centerN = 0;
  let borderLum = 0;
  let borderN = 0;
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 96));
  const x0 = width * 0.25;
  const x1 = width * 0.75;
  const y0 = height * 0.25;
  const y1 = height * 0.75;

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
      const dLum = Math.max(Math.abs(lum - lumX), Math.abs(lum - lumY));
      if (dLum > 28) edge += 1;
      else if (dLum > 8) fine += 1;
      const rg = r - g;
      const yb = 0.5 * (r + g) - b;
      rgSum += rg;
      ybSum += yb;
      rgSq += rg * rg;
      ybSq += yb * yb;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        centerLum += lum;
        centerN += 1;
      } else {
        borderLum += lum;
        borderN += 1;
      }
      samples += 1;
    }
  }

  const uniqueRatio = samples === 0 ? 1 : colors.size / samples;
  const edgeRatio = samples === 0 ? 0 : edge / samples;
  const fineRatio = samples === 0 ? 0 : fine / samples;
  // Quantized palette size, not unique/samples — large photos always look
  // "sparse" if you divide by pixel count.
  const isGraphic = colors.size < 48 && edgeRatio > 0.12;
  const grainy = !isGraphic && fineRatio >= 0.08;
  // Stronger luma-delta density than ordinary photo-grain. Used for a
  // high-band drop on leftover web-real FPs that sit above 0.78.
  const strongGrain = !isGraphic && fineRatio >= 0.4;
  const n = samples || 1;
  const rgMean = rgSum / n;
  const ybMean = ybSum / n;
  const rgStd = Math.sqrt(Math.max(0, rgSq / n - rgMean * rgMean));
  const ybStd = Math.sqrt(Math.max(0, ybSq / n - ybMean * ybMean));
  const colorfulness =
    Math.sqrt(rgStd * rgStd + ybStd * ybStd) +
    0.3 * Math.sqrt(rgMean * rgMean + ybMean * ybMean);
  const vivid = colorfulness >= TEXTURE.vividColorfulness;
  const muted = colorfulness <= TEXTURE.mutedColorfulness;
  // Muted + denser-than-ordinary grain. Used for a high-band drop on
  // leftover web-real FPs that sit above the muted-high window.
  const mutedFine = !isGraphic && muted && fineRatio >= 0.32;
  const centerMean = centerLum / (centerN || 1);
  const borderMean = borderLum / (borderN || 1);
  const centerBorder = centerMean / (borderMean + 1e-3);
  const flatTone =
    centerBorder >= TEXTURE.flatToneLo && centerBorder <= TEXTURE.flatToneHi;
  // Flat illumination plus denser mid-delta luma than typical flat photos.
  const flatFine = flatTone && !isGraphic && fineRatio >= 0.34;
  const mutedFlatFine = muted && flatTone && !isGraphic && fineRatio >= 0.3;
  // Muted photo whose center is much brighter than the border.
  // Used for an extreme-tail drop on leftover web-real FPs that
  // sit above every existing muted window.
  const centerBright = !isGraphic && centerBorder >= TEXTURE.centerBrightLo;
  const mutedCenterBright = muted && centerBright;
  return {
    uniqueRatio,
    edgeRatio,
    isGraphic,
    samples,
    uniqueColors: colors.size,
    colorfulness,
    vivid,
    muted,
    centerBorder,
    flatTone,
    fineRatio,
    grainy,
    strongGrain,
    mutedFine,
    flatFine,
    mutedFlatFine,
    centerBright,
    mutedCenterBright,
  };
}

export function graphicScale(analysis) {
  return analysis.isGraphic ? 0.72 : 1;
}
