/**
 * Social-JPEG / recompress scan.
 *
 * Typical platform recompress (Reddit / Twitter / OG-image style) lands
 * near JPEG quality 65 with a long side at or under 720. Uses generic
 * DQT + SOF markers only — not an eval-image hash table.
 */

export const SOCIAL_JPEG = {
  qualityMin: 60,
  qualityMax: 70,
  maxSide: 720,
  commforRestore: 0.99,
  siglipMin: 0.1,
  siglipMax: 0.25,
};

// ITU-T T.81 Annex K luminance table (quality 50), natural 8x8 order.
const STD_LUM = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
];

function scaledStdLum(quality) {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    out[i] = Math.min(255, Math.max(1, Math.floor((STD_LUM[i] * scale + 50) / 100)));
  }
  return out;
}

function zigzag(natural) {
  const out = new Uint8Array(64);
  for (let z = 0; z < 64; z += 1) out[z] = natural[ZIGZAG[z]];
  return out;
}

function tableError(dqt, expected) {
  let err = 0;
  for (let i = 0; i < 64; i += 1) err += Math.abs(expected[i] - dqt[i]);
  return err;
}

export function estimateJpegQuality(dqt) {
  if (!dqt || dqt.length < 64) return null;
  let bestQ = 50;
  let bestErr = Infinity;
  for (let q = 1; q <= 100; q += 1) {
    const natural = scaledStdLum(q);
    const err = Math.min(tableError(dqt, natural), tableError(dqt, zigzag(natural)));
    if (err < bestErr) {
      bestErr = err;
      bestQ = q;
    }
  }
  return bestQ;
}

function emptyJpeg() {
  return {
    jpeg: false,
    quality: null,
    width: 0,
    height: 0,
    maxSide: 0,
    socialRecompress: false,
  };
}

export function parseJpegContainer(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return emptyJpeg();
  }
  let lumaDqt = null;
  let width = 0;
  let height = 0;
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const start = i + 4;
    const end = Math.min(bytes.length, start + Math.max(0, len - 2));
    if (marker === 0xdb) {
      let p = start;
      while (p < end && !lumaDqt) {
        const info = bytes[p];
        const precision = info >> 4;
        const dest = info & 0x0f;
        const tableBytes = precision === 0 ? 64 : 128;
        if (p + 1 + tableBytes > end) break;
        if (precision === 0 && dest === 0) {
          lumaDqt = bytes.subarray(p + 1, p + 65);
        }
        p += 1 + tableBytes;
      }
    }
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof && start + 5 <= end) {
      height = (bytes[start + 1] << 8) | bytes[start + 2];
      width = (bytes[start + 3] << 8) | bytes[start + 4];
    }
    i = start + Math.max(0, len - 2);
  }
  const quality = estimateJpegQuality(lumaDqt);
  const maxSide = Math.max(width, height);
  const socialRecompress =
    quality != null &&
    quality >= SOCIAL_JPEG.qualityMin &&
    quality <= SOCIAL_JPEG.qualityMax &&
    maxSide > 0 &&
    maxSide <= SOCIAL_JPEG.maxSide;
  return {
    jpeg: true,
    quality,
    width,
    height,
    maxSide,
    socialRecompress,
  };
}

export function scanJpegSocial(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return parseJpegContainer(bytes);
}
