import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProvenance } from "../src/provenance.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function asciiBuffer(text) {
  return new TextEncoder().encode(text);
}

function readShipGate(name) {
  const path = join(root, "eval/data/ship-gate", name);
  if (!existsSync(path)) return null;
  return new Uint8Array(readFileSync(path));
}

function u16le(n) {
  return [n & 255, (n >> 8) & 255];
}

function u32le(n) {
  return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
}

/** Minimal JPEG with one APP1 Exif IFD0 Make/Model. No entropy scan. */
function jpegWithExifIfd({ make, model }) {
  const makeBytes = new TextEncoder().encode(`${make}\0`);
  const modelBytes = new TextEncoder().encode(`${model}\0`);
  const ifd0 = 8;
  const count = 2;
  const entry0 = ifd0 + 2;
  const entry1 = entry0 + 12;
  const next = entry1 + 12;
  const makeOff = next + 4;
  const modelOff = makeOff + makeBytes.length;
  const tiff = new Uint8Array(modelOff + modelBytes.length);
  tiff.set([0x49, 0x49, 0x2a, 0x00, ...u32le(ifd0)], 0);
  tiff.set(u16le(count), ifd0);
  tiff.set([0x0f, 0x01, 0x02, 0x00, ...u32le(makeBytes.length), ...u32le(makeOff)], entry0);
  tiff.set([0x10, 0x01, 0x02, 0x00, ...u32le(modelBytes.length), ...u32le(modelOff)], entry1);
  tiff.set(u32le(0), next);
  tiff.set(makeBytes, makeOff);
  tiff.set(modelBytes, modelOff);
  const payload = new Uint8Array(6 + tiff.length);
  payload.set(new TextEncoder().encode("Exif\0\0"), 0);
  payload.set(tiff, 6);
  return jpegWithApp1(payload);
}

function jpegWithStubExifAndIccApple() {
  const tiff = new Uint8Array(26);
  tiff.set([0x49, 0x49, 0x2a, 0x00, ...u32le(8)], 0);
  tiff.set(u16le(1), 8);
  tiff.set([0x12, 0x01, 0x03, 0x00, ...u32le(1), ...u16le(1), 0x00, 0x00], 10);
  tiff.set(u32le(0), 22);
  const exif = new Uint8Array(6 + tiff.length);
  exif.set(new TextEncoder().encode("Exif\0\0"), 0);
  exif.set(tiff, 6);
  const icc = new TextEncoder().encode("ICC_PROFILE\0\0\0Apple RGB display");
  return jpegWithSegments([
    { marker: 0xe1, payload: exif },
    { marker: 0xe2, payload: icc },
  ]);
}

function jpegWithXmpMake(make) {
  const xml =
    `http://ns.adobe.com/xap/1.0/\0<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xapmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/">` +
    `<tiff:Make>${make}</tiff:Make></rdf:Description></rdf:RDF></x:xapmeta>`;
  return jpegWithApp1(new TextEncoder().encode(xml));
}

function jpegWithApp1(payload) {
  return jpegWithSegments([{ marker: 0xe1, payload }]);
}

function jpegWithSegments(segments) {
  let total = 4;
  for (const { payload } of segments) total += 4 + payload.length;
  const out = new Uint8Array(total);
  out[0] = 0xff;
  out[1] = 0xd8;
  let o = 2;
  for (const { marker, payload } of segments) {
    const len = payload.length + 2;
    out[o] = 0xff;
    out[o + 1] = marker;
    out[o + 2] = (len >> 8) & 255;
    out[o + 3] = len & 255;
    out.set(payload, o + 4);
    o += 4 + payload.length;
  }
  out[o] = 0xff;
  out[o + 1] = 0xd9;
  return out;
}

function pngChunk(type, payload) {
  const typeBytes = new TextEncoder().encode(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length);
  const crc = new Uint8Array(4);
  const out = new Uint8Array(12 + payload.length);
  out.set(length, 0);
  out.set(typeBytes, 4);
  out.set(payload, 8);
  out.set(crc, 8 + payload.length);
  return out;
}

function pngWithIdat(payload) {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = pngChunk("IDAT", payload);
  const iend = pngChunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(sig.length + idat.length + iend.length);
  out.set(sig, 0);
  out.set(idat, sig.length);
  out.set(iend, sig.length + idat.length);
  return out;
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

  it("requires EXIF-like context before treating a phone make as camera-native", () => {
    const without = scanProvenance(asciiBuffer("apple storefront photo"));
    assert.equal(without.camera, false);
    const withExif = scanProvenance(asciiBuffer("Exif\0\0Apple iPhone 15 Pro"));
    assert.equal(withExif.camera, true);
    assert.equal(withExif.ai, false);
  });

  it("reads JPEG APP1 IFD Make and ignores ICC Apple", () => {
    const canon = jpegWithExifIfd({ make: "Canon", model: "EOS 5D Mark IV" });
    const hit = scanProvenance(canon);
    assert.equal(hit.ai, false);
    assert.equal(hit.camera, true);
    assert.ok(hit.signals.includes("camera:canon"));

    const iccOnly = jpegWithStubExifAndIccApple();
    const miss = scanProvenance(iccOnly);
    assert.equal(miss.camera, false);
    assert.equal(miss.ai, false);
  });

  it("keeps C2PA AI when a JPEG also carries a camera Make", () => {
    const camera = jpegWithExifIfd({ make: "Canon", model: "EOS 5D" });
    const claim = new TextEncoder().encode("c2pa.org claim.sig");
    const len = claim.length + 2;
    const jpeg = new Uint8Array(camera.length + 2 + 2 + claim.length);
    jpeg.set(camera.subarray(0, camera.length - 2), 0);
    const o = camera.length - 2;
    jpeg[o] = 0xff;
    jpeg[o + 1] = 0xfe;
    jpeg[o + 2] = (len >> 8) & 255;
    jpeg[o + 3] = len & 255;
    jpeg.set(claim, o + 4);
    jpeg.set([0xff, 0xd9], o + 4 + claim.length);
    const result = scanProvenance(jpeg);
    assert.equal(result.ai, true);
    assert.equal(result.camera, false);
    assert.ok(result.signals.some((s) => s.includes("c2pa")));
  });

  it("reads XMP tiff:Make in APP1 without scanning entropy", () => {
    const xmp = jpegWithXmpMake("Nikon");
    const result = scanProvenance(xmp);
    assert.equal(result.ai, false);
    assert.equal(result.camera, true);
    assert.ok(result.signals.includes("camera:nikon"));
  });

  it("does not treat Charlesworth stub Exif as camera-native", () => {
    const orig = readShipGate("shipgate_charlesworth_orig.jpg");
    const thumb = readShipGate("shipgate_charlesworth_250.jpg");
    if (!orig || !thumb) return;
    assert.equal(scanProvenance(orig).camera, false);
    assert.equal(scanProvenance(orig).ai, false);
    assert.equal(scanProvenance(thumb).camera, false);
  });

  it("flags the named Sony Golden Retriever EXIF as camera-real", () => {
    const golden = readShipGate("shipgate_wiki_real_golden.jpg");
    if (!golden) return;
    const result = scanProvenance(golden);
    assert.equal(result.ai, false);
    assert.equal(result.camera, true);
    assert.ok(result.signals.includes("camera:sony"));
  });

  it("does not treat sdxl or a phone make in PNG IDAT as provenance", () => {
    const idat = new TextEncoder().encode("entropy blob sdxl apple samsung noise");
    const png = pngWithIdat(idat);
    const result = scanProvenance(png);
    assert.equal(result.ai, false);
    assert.equal(result.camera, false);
  });

  it("does not treat Dulmen artist-only Exif as camera-real", () => {
    const dulmen = readShipGate("shipgate_wiki_real_dulmen.jpg");
    if (!dulmen) return;
    const result = scanProvenance(dulmen);
    assert.equal(result.camera, false);
    assert.equal(result.ai, false);
  });
});

