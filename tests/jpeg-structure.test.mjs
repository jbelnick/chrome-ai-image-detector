import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanJpegStructure, JPEG_STRUCT } from "../src/jpeg-structure.js";

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

const STD_DC_LUMA_LI = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const STD_AC_LUMA_LI = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const STD_DC_CHROMA_LI = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const STD_AC_CHROMA_LI = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function segment(marker, payload) {
  const len = payload.length + 2;
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (len >> 8) & 255;
  out[3] = len & 255;
  out.set(payload, 4);
  return out;
}

function scaledLumaZigzag(quality) {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  const natural = JPEG_LUMA_STD.map((v) =>
    Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))),
  );
  const zigzag = new Uint8Array(64);
  for (let z = 0; z < 64; z += 1) zigzag[z] = natural[JPEG_ZIGZAG[z]];
  return zigzag;
}

function dqtSegment(quality, id = 0) {
  const payload = new Uint8Array(1 + 64);
  payload[0] = id;
  payload.set(scaledLumaZigzag(quality), 1);
  return segment(0xdb, payload);
}

function sofSegment(marker, { width, height, nf, sampling }) {
  const payload = new Uint8Array(6 + nf * 3);
  payload[0] = 8;
  payload[1] = (height >> 8) & 255;
  payload[2] = height & 255;
  payload[3] = (width >> 8) & 255;
  payload[4] = width & 255;
  payload[5] = nf;
  for (let i = 0; i < nf; i += 1) {
    const [h, v] = sampling[i];
    payload[6 + i * 3] = i + 1;
    payload[7 + i * 3] = (h << 4) | v;
    payload[8 + i * 3] = i === 0 ? 0 : 1;
  }
  return segment(marker, payload);
}

function dhtTable(tc, th, li) {
  let symbols = 0;
  for (const n of li) symbols += n;
  const payload = new Uint8Array(1 + 16 + symbols);
  payload[0] = (tc << 4) | th;
  payload.set(li, 1);
  return payload;
}

function dhtSegment(tables) {
  return segment(0xc4, concat(...tables));
}

function jpegFrom({ sofMarker = 0xc0, width = 64, height = 48, nf = 3, sampling, quality = 72, dhtTables }) {
  const samp = sampling || (nf === 1 ? [[2, 2]] : [[2, 2], [1, 1], [1, 1]]);
  return concat(
    Uint8Array.from([0xff, 0xd8]),
    dqtSegment(quality, 0),
    sofSegment(sofMarker, { width, height, nf, sampling: samp }),
    dhtSegment(dhtTables),
    Uint8Array.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9]),
  );
}

const STANDARD_DHT = [
  dhtTable(0, 0, STD_DC_LUMA_LI),
  dhtTable(1, 0, STD_AC_LUMA_LI),
  dhtTable(0, 1, STD_DC_CHROMA_LI),
  dhtTable(1, 1, STD_AC_CHROMA_LI),
];

function sparseAcLi(symbols) {
  const li = new Array(16).fill(0);
  li[1] = Math.min(symbols, 8);
  li[2] = Math.max(0, symbols - 8);
  return li;
}

describe("jpeg-structure", () => {
  it("does not invent structure on a non-JPEG buffer", () => {
    const result = scanJpegStructure(new TextEncoder().encode("not a jpeg"));
    assert.equal(result.jpeg, false);
    assert.equal(result.jpegSparseAc, false);
    assert.equal(result.jpegProgressive, false);
    assert.equal(result.lumaQuality, null);
  });

  it("reads SOF0 component count and 4:2:0 sampling", () => {
    const result = scanJpegStructure(
      jpegFrom({ sofMarker: 0xc0, nf: 3, sampling: [[2, 2], [1, 1], [1, 1]], dhtTables: STANDARD_DHT }),
    );
    assert.equal(result.jpeg, true);
    assert.equal(result.nf, 3);
    assert.equal(result.samplingKey, "2x2,1x1,1x1");
    assert.equal(result.jpegMono, false);
    assert.equal(result.jpegNon420, false);
    assert.equal(result.jpegProgressive, false);
  });

  it("flags progressive SOF2 and grayscale SOF0", () => {
    const prog = scanJpegStructure(
      jpegFrom({ sofMarker: 0xc2, dhtTables: STANDARD_DHT }),
    );
    assert.equal(prog.jpegProgressive, true);
    assert.equal(prog.progressive, true);

    const mono = scanJpegStructure(
      jpegFrom({
        nf: 1,
        sampling: [[2, 2]],
        dhtTables: [dhtTable(0, 0, STD_DC_LUMA_LI), dhtTable(1, 0, STD_AC_LUMA_LI)],
      }),
    );
    assert.equal(mono.jpegMono, true);
    assert.equal(mono.nf, 1);
  });

  it("flags non-4:2:0 SOF sampling without treating 4:2:0 as unusual", () => {
    const yuv444 = scanJpegStructure(
      jpegFrom({ sampling: [[1, 1], [1, 1], [1, 1]], dhtTables: STANDARD_DHT }),
    );
    assert.equal(yuv444.jpegNon420, true);
    assert.equal(yuv444.samplingKey, "1x1,1x1,1x1");

    const yuv420 = scanJpegStructure(
      jpegFrom({ sampling: [[2, 2], [1, 1], [1, 1]], dhtTables: STANDARD_DHT }),
    );
    assert.equal(yuv420.jpegNon420, false);
  });

  it("estimates IJG quality from the luminance DQT", () => {
    const q72 = scanJpegStructure(jpegFrom({ quality: 72, dhtTables: STANDARD_DHT }));
    assert.equal(q72.lumaQuality, 72);
    assert.equal(q72.jpegCustomQt, false);

    const q88 = scanJpegStructure(jpegFrom({ quality: 88, dhtTables: STANDARD_DHT }));
    assert.equal(q88.lumaQuality, 88);
  });

  it("recognizes Annex K Huffman tables and does not call them sparse", () => {
    const result = scanJpegStructure(jpegFrom({ dhtTables: STANDARD_DHT }));
    assert.equal(result.standardDht, true);
    assert.equal(result.acLumaSymbols, 162);
    assert.equal(result.dhtCount, 4);
    assert.equal(result.jpegSparseAc, false);
    assert.equal(result.jpegDenseAc, false);
    assert.equal(result.jpegUnusualDhtCount, false);
  });

  it("flags a sparse optimized AC luma DHT without treating standard tables as sparse", () => {
    const sparseLi = sparseAcLi(32);
    const custom = [
      dhtTable(0, 0, STD_DC_LUMA_LI),
      dhtTable(1, 0, sparseLi),
      dhtTable(0, 1, STD_DC_CHROMA_LI),
      dhtTable(1, 1, STD_AC_CHROMA_LI),
    ];
    const result = scanJpegStructure(jpegFrom({ dhtTables: custom }));
    assert.equal(result.standardDht, false);
    assert.equal(result.acLumaSymbols, 32);
    assert.equal(result.jpegSparseAc, true);
    assert.ok(result.acLumaSymbols <= JPEG_STRUCT.sparseAcMax);
  });

  it("flags a dense optimized AC luma DHT only on mid-Q Annex-K tables", () => {
    const denseLi = sparseAcLi(74);
    const custom = [
      dhtTable(0, 0, STD_DC_LUMA_LI),
      dhtTable(1, 0, denseLi),
      dhtTable(0, 1, STD_DC_CHROMA_LI),
      dhtTable(1, 1, STD_AC_CHROMA_LI),
    ];
    const mid = scanJpegStructure(jpegFrom({ quality: 72, dhtTables: custom }));
    assert.equal(mid.standardDht, false);
    assert.equal(mid.acLumaSymbols, 74);
    assert.equal(mid.jpegDenseAc, true);
    assert.equal(mid.jpegMidQ, true);
    assert.ok(mid.acLumaSymbols >= JPEG_STRUCT.denseAcMin);

    const q88 = scanJpegStructure(jpegFrom({ quality: 88, dhtTables: custom }));
    assert.equal(q88.jpegDenseAc, true);
    assert.equal(q88.jpegMidQ, false);

    const standardMid = scanJpegStructure(jpegFrom({ quality: 72, dhtTables: STANDARD_DHT }));
    assert.equal(standardMid.jpegMidQ, true);
    assert.equal(standardMid.jpegDenseAc, false);
  });

  it("does not read DHT or SOF from entropy after SOS", () => {
    const entropy = concat(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]),
      sofSegment(0xc2, { width: 8, height: 8, nf: 1, sampling: [[1, 1]] }),
      Uint8Array.from([0xff, 0xd9]),
    );
    const result = scanJpegStructure(entropy);
    assert.equal(result.jpeg, true);
    assert.equal(result.jpegProgressive, false);
    assert.equal(result.nf, 0);
  });
});
