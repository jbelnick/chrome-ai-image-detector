import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzePixels } from "../src/graphic-gate.js";

describe("graphic-gate", () => {
  it("flags a two-color UI-like rectangle as graphic", () => {
    const w = 128;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const on = x < 8 || y < 8 || x > w - 9 || y > h - 9 || x % 16 === 0;
        const v = on ? 20 : 240;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.isGraphic, true);
  });

  it("does not flag a noisy photographic field as graphic", () => {
    const w = 128;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    let seed = 1;
    for (let i = 0; i < w * h; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i * 4] = seed & 255;
      data[i * 4 + 1] = (seed >>> 8) & 255;
      data[i * 4 + 2] = (seed >>> 16) & 255;
      data[i * 4 + 3] = 255;
    }
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.isGraphic, false);
  });

  it("flags a saturated opponent-color field as vivid", () => {
    const w = 64;
    const h = 64;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      data[i * 4] = i % 2 === 0 ? 255 : 0;
      data[i * 4 + 1] = i % 2 === 0 ? 0 : 255;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.vivid, true);
    assert.ok(analysis.colorfulness >= 72);
  });

  it("flags a uniform field as flat-tone", () => {
    const w = 64;
    const h = 64;
    const data = new Uint8Array(w * h * 4);
    data.fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.flatTone, true);
    assert.ok(analysis.centerBorder > 0.92 && analysis.centerBorder < 1.08);
  });

  it("flags a field with clipped highlights as specular", () => {
    const w = 64;
    const h = 64;
    const data = new Uint8Array(w * h * 4);
    data.fill(40);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (let i = 0; i < 200; i += 1) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
    }
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.specular, true);
  });
});
