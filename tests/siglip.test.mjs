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

  it("ignores SigLIP when a UI capture has sure-real Community Forensics", () => {
    const ui = { uiCapture: true };
    const vetoed = blendVisual(0.93, 0.00004, ui);
    assert.ok(Math.abs(vetoed - (1 - 0.99996 * 0.99996)) < 1e-9);
    assert.ok(vetoed < 0.01);
    const dominated = blendVisual(0.93, 0.00004);
    assert.ok(dominated > 0.99);
  });

  it("does not fire the UI CF veto on film (no uiCapture), even when CF < 0.01", () => {
    const film = { uiCapture: false, scanGrain: true };
    const thumb = blendVisual(0.8944255098130955, 0.001987291830949727, film);
    const doubleSiglip = 1 - (1 - 0.8944255098130955) ** 2 * (1 - 0.001987291830949727);
    assert.ok(Math.abs(thumb - doubleSiglip) < 1e-12);
    const orig = blendVisual(0.8668807114713026, 0.22478997145559196, film);
    const origOr = 1 - (1 - 0.8668807114713026) ** 2 * (1 - 0.22478997145559196);
    assert.ok(Math.abs(orig - origOr) < 1e-12);
  });

  it("does not fire the UI CF veto when CF is not sure-real", () => {
    const ui = { uiCapture: true };
    const midCf = blendVisual(0.87, 0.225, ui);
    const doubleSiglip = 1 - (1 - 0.87) ** 2 * (1 - 0.225);
    assert.ok(Math.abs(midCf - doubleSiglip) < 1e-12);
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
