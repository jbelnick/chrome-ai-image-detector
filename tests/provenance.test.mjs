import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanProvenance } from "../src/provenance.js";

function asciiBuffer(text) {
  return new TextEncoder().encode(text);
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
});
