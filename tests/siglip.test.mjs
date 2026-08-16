import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { l2Normalize, probeLogit, blendVisual, imageDataToSiglipTensor } from "../src/siglip.js";

describe("siglip probe", () => {
  it("L2-normalizes a vector to unit length", () => {
    const n = l2Normalize([3, 4]);
    assert.ok(Math.abs(n[0] - 0.6) < 1e-6);
    assert.ok(Math.abs(n[1] - 0.8) < 1e-6);
  });

  it("returns a finite logit for a zero pooler", () => {
    const z = probeLogit(new Float32Array(768));
    assert.equal(Number.isFinite(z), true);
  });

  it("soft-ORs with SigLIP counted twice", () => {
    assert.ok(Math.abs(blendVisual(0.8, 0.1) - (1 - 0.2 * 0.2 * 0.9)) < 1e-9);
    assert.ok(blendVisual(0.8, 0.4) > 0.8 + 0.4 - 0.8 * 0.4);
  });

  it("ignores Community Forensics when SigLIP is sure-real", () => {
    const sureReal = blendVisual(0.10, 0.90);
    assert.ok(Math.abs(sureReal - (1 - 0.9 * 0.9)) < 1e-9);
    assert.ok(sureReal < 0.25);
    const mid = blendVisual(0.40, 0.90);
    assert.ok(mid > 0.40);
  });

  it("restores Community Forensics when SigLIP is sure-real but CF is extremely sure-AI", () => {
    const restored = blendVisual(0.20, 0.99);
    const ignored = blendVisual(0.20, 0.90);
    assert.ok(Math.abs(restored - (1 - 0.8 * 0.8 * 0.01)) < 1e-9);
    assert.ok(Math.abs(ignored - (1 - 0.8 * 0.8)) < 1e-9);
    assert.ok(restored > ignored);
    assert.ok(restored > 0.65);
  });

  it("builds a 1x3x224x224 SigLIP tensor", () => {
    const n = 224 * 224;
    const rgba = new Uint8Array(n * 4);
    rgba.fill(255);
    const t = imageDataToSiglipTensor(rgba, 224, 224);
    assert.equal(t.length, 3 * n);
    assert.ok(Math.abs(t[0] - 1) < 1e-5);
  });
});
