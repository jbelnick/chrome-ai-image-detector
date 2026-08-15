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

  it("lets a confident Community Forensics score lift the visual probability", () => {
    assert.equal(blendVisual(0.2, 0.9), 0.9);
    assert.equal(blendVisual(0.8, 0.1), 0.8);
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
