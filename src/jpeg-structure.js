/**
 * JPEG DQT / DHT / SOF structure. Header markers only — stops at SOS.
 * Not APP-string provenance and not entropy-of-compressed-bytes.
 */

// ITU-T T.81 Annex K luminance table (quality 50), natural 8x8 order.
const JPEG_LUMA_STD = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const JPEG_ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
];

// Annex K standard Huffman Li[1..16] (DC luma, AC luma, DC chroma, AC chroma).
const STD_DHT_LI = {
  "0:0": [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  "1:0": [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125],
  "0:1": [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  "1:1": [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119],
};

export const JPEG_STRUCT = {
  sparseAcMax: 40,
  denseAcMin: 71,
  midQMin: 68,
  midQMax: 76,
  customQtMinResidual: 40,
};

function scaledLumaTable(quality) {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  const out = new Array(64);
  for (let i = 0; i < 64; i += 1) {
    out[i] = Math.min(255, Math.max(1, Math.floor((JPEG_LUMA_STD[i] * scale + 50) / 100)));
  }
  return out;
}

function qualityFromLumaTable(natural) {
  let bestQ = null;
  let bestErr = Infinity;
  for (let q = 1; q <= 100; q += 1) {
    const scaled = scaledLumaTable(q);
    let err = 0;
    for (let i = 0; i < 64; i += 1) {
      const d = natural[i] - scaled[i];
      err += d * d;
    }
    if (err < bestErr) {
      bestErr = err;
      bestQ = q;
    }
  }
  return { quality: bestQ, residual: bestErr };
}

function liEqual(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function walkJpegMarkers(bytes, onSegment) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
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
    onSegment(marker, bytes.subarray(start, end));
    i = start + Math.max(0, len - 2);
  }
  return true;
}

function parseSof(payload) {
  if (payload.length < 6) return null;
  const precision = payload[0];
  const height = (payload[1] << 8) | payload[2];
  const width = (payload[3] << 8) | payload[4];
  const nf = payload[5];
  const components = [];
  let p = 6;
  for (let c = 0; c < nf && p + 2 < payload.length; c += 1) {
    const id = payload[p];
    const hv = payload[p + 1];
    const tq = payload[p + 2];
    components.push({ id, h: hv >> 4, v: hv & 0x0f, tq });
    p += 3;
  }
  return { precision, width, height, nf, components };
}

function parseDqt(payload, tables) {
  let p = 0;
  while (p < payload.length) {
    const info = payload[p];
    const precision = info >> 4;
    const tableId = info & 0x0f;
    const coeffBytes = precision === 0 ? 64 : 128;
    p += 1;
    if (p + coeffBytes > payload.length) break;
    if (precision === 0) {
      const zigzag = Array.from(payload.subarray(p, p + 64));
      const natural = new Array(64);
      for (let z = 0; z < 64; z += 1) natural[JPEG_ZIGZAG[z]] = zigzag[z];
      tables.push({ id: tableId, precision, zigzag, natural });
    }
    p += coeffBytes;
  }
}

function parseDht(payload, tables) {
  let p = 0;
  while (p + 17 <= payload.length) {
    const info = payload[p];
    const tc = info >> 4;
    const th = info & 0x0f;
    p += 1;
    const li = Array.from(payload.subarray(p, p + 16));
    p += 16;
    let symbols = 0;
    for (let i = 0; i < 16; i += 1) symbols += li[i];
    if (p + symbols > payload.length) break;
    p += symbols;
    const key = `${tc}:${th}`;
    tables.push({
      tc,
      th,
      li,
      symbols,
      li16: li[15],
      standard: liEqual(li, STD_DHT_LI[key]),
    });
  }
}

export function scanJpegStructure(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const empty = {
    jpeg: false,
    sofMarker: 0,
    progressive: false,
    nf: 0,
    width: 0,
    height: 0,
    samplingKey: "",
    dqtCount: 0,
    lumaQuality: null,
    lumaResidual: null,
    dhtCount: 0,
    acLumaSymbols: 0,
    acChromaSymbols: 0,
    dcLumaSymbols: 0,
    standardDht: false,
    dri: false,
    jpegProgressive: false,
    jpegMono: false,
    jpegNon420: false,
    jpegSparseAc: false,
    jpegDenseAc: false,
    jpegMidQ: false,
    jpegCustomQt: false,
    jpegUnusualDhtCount: false,
  };
  const dqt = [];
  const dht = [];
  let sof = null;
  let sofMarker = 0;
  let dri = false;
  const isJpeg = walkJpegMarkers(bytes, (marker, payload) => {
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (!sof) {
        sof = parseSof(payload);
        sofMarker = marker;
      }
    } else if (marker === 0xdb) {
      parseDqt(payload, dqt);
    } else if (marker === 0xc4) {
      parseDht(payload, dht);
    } else if (marker === 0xdd) {
      dri = true;
    }
  });
  if (!isJpeg) return empty;

  const luma = dqt.find((t) => t.id === 0) || dqt[0];
  const qFit = luma ? qualityFromLumaTable(luma.natural) : { quality: null, residual: null };
  const acLuma = dht.find((t) => t.tc === 1 && t.th === 0);
  const acChroma = dht.find((t) => t.tc === 1 && t.th === 1);
  const dcLuma = dht.find((t) => t.tc === 0 && t.th === 0);
  const samplingKey = (sof?.components || [])
    .map((c) => `${c.h}x${c.v}`)
    .join(",");
  const nf = sof?.nf || 0;
  const progressive = sofMarker === 0xc2;
  const standardDht = dht.length > 0 && dht.every((t) => t.standard);
  const jpegNon420 = nf === 3 && samplingKey !== "" && samplingKey !== "2x2,1x1,1x1";
  const acLumaSymbols = acLuma?.symbols || 0;
  const jpegMidQ =
    Number.isFinite(qFit.quality) &&
    qFit.quality >= JPEG_STRUCT.midQMin &&
    qFit.quality <= JPEG_STRUCT.midQMax;

  return {
    jpeg: true,
    sofMarker,
    progressive,
    nf,
    width: sof?.width || 0,
    height: sof?.height || 0,
    samplingKey,
    dqtCount: dqt.length,
    lumaQuality: qFit.quality,
    lumaResidual: qFit.residual,
    dhtCount: dht.length,
    acLumaSymbols,
    acChromaSymbols: acChroma?.symbols || 0,
    dcLumaSymbols: dcLuma?.symbols || 0,
    standardDht,
    dri,
    jpegProgressive: progressive,
    jpegMono: nf === 1,
    jpegNon420,
    jpegSparseAc: !standardDht && acLumaSymbols > 0 && acLumaSymbols <= JPEG_STRUCT.sparseAcMax,
    jpegDenseAc: !standardDht && acLumaSymbols >= JPEG_STRUCT.denseAcMin,
    jpegMidQ,
    jpegCustomQt: Number.isFinite(qFit.residual) && qFit.residual >= JPEG_STRUCT.customQtMinResidual,
    jpegUnusualDhtCount: dht.length > 0 && dht.length !== 4,
  };
}
