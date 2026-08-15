import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scaledSize,
  centerCropBox,
  shouldAnalyzeDimensions,
  imageDataToTensor,
  visualProbabilityFromLogit,
  PREPROCESS,
  equalizeLumaTiles,
} from "../src/preprocess.js";

describe("preprocess", () => {
  it("resizes the shorter edge to 440 while keeping aspect ratio", () => {
    const s = scaledSize(800, 600, 440);
    assert.equal(s.height, 440);
    assert.equal(s.width, Math.round(800 * (440 / 600)));
  });

  it("center-crops a 384 square", () => {
    const box = centerCropBox(586, 440, 384);
    assert.equal(box.size, 384);
    assert.equal(box.x, Math.floor((586 - 384) / 2));
    assert.equal(box.y, Math.floor((440 - 384) / 2));
  });

  it("skips tiny tracking pixels", () => {
    assert.equal(shouldAnalyzeDimensions(1, 1), false);
    assert.equal(shouldAnalyzeDimensions(63, 400), false);
    assert.equal(shouldAnalyzeDimensions(64, 64), true);
  });

  it("emits a 1x3x384x384 ImageNet-normalized NCHW tensor", () => {
    const n = 384 * 384;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 0;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = 255;
    }
    const tensor = imageDataToTensor(rgba, 384, 384, { clahe: 0 });
    assert.equal(tensor.length, 3 * n);
    const expectedR = (1 - PREPROCESS.mean[0]) / PREPROCESS.std[0];
    const expectedG = (0 - PREPROCESS.mean[1]) / PREPROCESS.std[1];
    assert.ok(Math.abs(tensor[0] - expectedR) < 1e-5);
    assert.ok(Math.abs(tensor[n] - expectedG) < 1e-5);
  });

  it("equalizes luma inside tiles on a two-level field", () => {
    const w = 64;
    const h = 64;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const v = (x + y) % 2 === 0 ? 40 : 80;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const out = equalizeLumaTiles(data, w, h, 2);
    let min = 255;
    let max = 0;
    for (let i = 0; i < w * h; i += 1) {
      min = Math.min(min, out[i * 4]);
      max = Math.max(max, out[i * 4]);
    }
    assert.ok(max - min > 80);
    assert.equal(PREPROCESS.claheTiles, 4);
  });

  it("converts a logit to a probability with sigmoid", () => {
    assert.ok(visualProbabilityFromLogit(0) === 0.5);
    assert.ok(visualProbabilityFromLogit(6.753) > 0.99);
    assert.ok(visualProbabilityFromLogit(-6.7) < 0.01);
  });
});
