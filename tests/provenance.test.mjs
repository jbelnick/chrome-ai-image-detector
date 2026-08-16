import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateJpegQuality, scanProvenance } from "../src/provenance.js";

function asciiBuffer(text) {
  return new TextEncoder().encode(text);
}

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

function jpegQuantScale(quality) {
  const q = Math.min(100, Math.max(1, quality));
  return q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
}

function jpegWithLumaDqt(quality) {
  const scale = jpegQuantScale(quality);
  const natural = JPEG_LUMA_STD.map((v) =>
    Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))),
  );
  const zigzag = JPEG_ZIGZAG.map((i) => natural[i]);
  const jpeg = new Uint8Array(4 + 2 + 1 + 64 + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00], 0);
  jpeg.set(zigzag, 7);
  jpeg.set([0xff, 0xd9], 71);
  return jpeg;
}

function pngWithText(keyword, value) {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const payload = new TextEncoder().encode(`${keyword}\0${value}`);
  const type = new TextEncoder().encode("tEXt");
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length);
  const crc = new Uint8Array(4);
  const out = new Uint8Array(sig.length + 12 + payload.length);
  out.set(sig, 0);
  out.set(length, 8);
  out.set(type, 12);
  out.set(payload, 16);
  out.set(crc, 16 + payload.length);
  return out;
}

describe("provenance", () => {
  it("flags Stable Diffusion PNG parameter text", () => {
    const buf = pngWithText("parameters", "steps: 20 sampler: Euler a\nStable Diffusion");
    const result = scanProvenance(buf);
    assert.equal(result.ai, true);
    assert.ok(result.signals.some((s) => s.includes("stable")));
  });

  it("flags C2PA / JUMBF boxes", () => {
    const buf = asciiBuffer("xxxxc2pa....claim.sig....");
    const result = scanProvenance(buf);
    assert.equal(result.ai, true);
  });

  it("flags camera EXIF makes as camera-native, not AI", () => {
    const buf = asciiBuffer("Exif\0\0Canon EOS 5D Mark IV");
    const result = scanProvenance(buf);
    assert.equal(result.ai, false);
    assert.equal(result.camera, true);
  });

  it("does not treat a generic JPEG as AI", () => {
    const buf = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const result = scanProvenance(buf);
    assert.equal(result.ai, false);
    assert.equal(result.camera, false);
  });

  it("does not treat a bare openai/google token in compressed entropy as provenance", () => {
    const buf = asciiBuffer("JFIF entropy blob openai google apple samsung noise");
    const result = scanProvenance(buf);
    assert.equal(result.ai, false);
    assert.equal(result.camera, false);
  });

  it("still flags an explicit generator string such as dall-e", () => {
    const buf = asciiBuffer("Image Generator: DALL-E 3");
    const result = scanProvenance(buf);
    assert.equal(result.ai, true);
  });

  it("does not treat sdxl in JPEG entropy as provenance", () => {
    // SOI + empty COM + SOS + entropy containing the letters sdxl
    const jpeg = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xfe, 0x00, 0x03, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x11, 0x73, 0x64, 0x78, 0x6c, 0x22, // "sdxl" in entropy
      0xff, 0xd9,
    ]);
    const result = scanProvenance(jpeg);
    assert.equal(result.ai, false);
  });

  it("still flags sdxl inside a JPEG COM comment", () => {
    const payload = new TextEncoder().encode("generated with SDXL");
    const len = payload.length + 2;
    const jpeg = new Uint8Array(4 + 2 + payload.length + 2);
    jpeg.set([0xff, 0xd8, 0xff, 0xfe, (len >> 8) & 255, len & 255], 0);
    jpeg.set(payload, 6);
    jpeg.set([0xff, 0xd9], 6 + payload.length);
    const result = scanProvenance(jpeg);
    assert.equal(result.ai, true);
  });

  it("estimates IJG quality from a luminance DQT and flags only the q≈72 band", () => {
    const q72 = scanProvenance(jpegWithLumaDqt(72));
    assert.equal(estimateJpegQuality(jpegWithLumaDqt(72)), 72);
    assert.equal(q72.jpegQuality, 72);
    assert.equal(q72.jpegMidQ, true);

    const q88 = scanProvenance(jpegWithLumaDqt(88));
    assert.equal(q88.jpegQuality, 88);
    assert.equal(q88.jpegMidQ, false);

    const q82 = scanProvenance(jpegWithLumaDqt(82));
    assert.equal(q82.jpegQuality, 82);
    assert.equal(q82.jpegMidQ, false);

    const q65 = scanProvenance(jpegWithLumaDqt(65));
    assert.equal(q65.jpegQuality, 65);
    assert.equal(q65.jpegMidQ, false);
  });

  it("does not invent a JPEG quality on a non-JPEG buffer", () => {
    const result = scanProvenance(asciiBuffer("not a jpeg"));
    assert.equal(result.jpegQuality, null);
    assert.equal(result.jpegMidQ, false);
  });

  it("requires EXIF-like context before treating a phone make as camera-native", () => {
    const without = scanProvenance(asciiBuffer("apple storefront photo"));
    assert.equal(without.camera, false);
    const withExif = scanProvenance(asciiBuffer("Exif\0\0Apple iPhone 15 Pro"));
    assert.equal(withExif.camera, true);
    assert.equal(withExif.ai, false);
  });
});

