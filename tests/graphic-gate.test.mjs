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

  it("flags a noisy photographic field as grainy and a flat field as not", () => {
    const w = 128;
    const h = 128;
    const noisy = new Uint8Array(w * h * 4);
    let seed = 1;
    for (let i = 0; i < w * h; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noisy[i * 4] = seed & 255;
      noisy[i * 4 + 1] = (seed >>> 8) & 255;
      noisy[i * 4 + 2] = (seed >>> 16) & 255;
      noisy[i * 4 + 3] = 255;
    }
    const noisyAnalysis = analyzePixels(noisy, w, h);
    assert.equal(noisyAnalysis.grainy, true);

    const flat = new Uint8Array(w * h * 4);
    flat.fill(128);
    for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
    assert.equal(analyzePixels(flat, w, h).grainy, false);
    assert.equal(analyzePixels(flat, w, h).strongGrain, false);
  });

  it("flags dense mid-delta luma as strong-grain", () => {
    const w = 128;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const v = 120 + ((x + y) % 2 === 0 ? 12 : -12);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.grainy, true);
    assert.equal(analysis.strongGrain, true);
  });

  it("flags a muted noisy field as muted-fine and a vivid noisy field as not", () => {
    const w = 128;
    const h = 128;
    const muted = new Uint8Array(w * h * 4);
    let seed = 1;
    for (let i = 0; i < w * h; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = 120 + ((seed & 31) - 15);
      muted[i * 4] = v;
      muted[i * 4 + 1] = v;
      muted[i * 4 + 2] = v;
      muted[i * 4 + 3] = 255;
    }
    const mutedAnalysis = analyzePixels(muted, w, h);
    assert.equal(mutedAnalysis.muted, true);
    assert.equal(mutedAnalysis.mutedFine, true);
    assert.equal(
      mutedAnalysis.scanGrain,
      mutedAnalysis.isGraphic && mutedAnalysis.fineRatio >= 0.4,
    );

    const vivid = new Uint8Array(w * h * 4);
    seed = 1;
    for (let i = 0; i < w * h; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      vivid[i * 4] = seed & 255;
      vivid[i * 4 + 1] = (seed >>> 8) & 255;
      vivid[i * 4 + 2] = (seed >>> 16) & 255;
      vivid[i * 4 + 3] = 255;
    }
    assert.equal(analyzePixels(vivid, w, h).mutedFine, false);
    assert.equal(analyzePixels(vivid, w, h).scanGrain, false);
  });

  it("flags a muted grainy monochrome field as scan-grain even when the UI gate also fires", () => {
    const w = 128;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    let seed = 1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const frame = x < 2 || y < 2 || x > w - 3 || y > h - 3 || x % 26 === 0;
        const v = frame ? 18 : 118 + ((seed & 31) - 15);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const analysis = analyzePixels(data, w, h);
    assert.equal(analysis.muted, true);
    assert.ok(analysis.fineRatio >= 0.4);
    assert.equal(analysis.isGraphic, true);
    assert.equal(analysis.scanGrain, true);
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
});
