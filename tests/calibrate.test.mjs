import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCalibration,
  biasForTarget,
  bestRawThreshold,
  sigmoid,
  logit,
} from "../src/calibrate.js";

describe("calibrate", () => {
  it("maps a chosen raw threshold onto 0.65", () => {
    const bias = biasForTarget(0.4, 0.65);
    const mapped = applyCalibration(0.4, { bias, temperature: 1 });
    assert.ok(Math.abs(mapped - 0.65) < 1e-6);
  });

  it("is identity when bias is 0 and temperature is 1", () => {
    assert.ok(Math.abs(applyCalibration(0.73) - 0.73) < 1e-6);
  });

  it("picks the raw cut with the best balanced accuracy", () => {
    const rows = [
      { label: 1, score: 0.8 },
      { label: 1, score: 0.7 },
      { label: 0, score: 0.2 },
      { label: 0, score: 0.3 },
    ];
    const best = bestRawThreshold(rows);
    assert.equal(best.balancedAccuracy, 1);
    assert.ok(best.threshold >= 0.2 && best.threshold <= 0.8);
  });

  it("logit and sigmoid are inverses on (0,1)", () => {
    assert.ok(Math.abs(sigmoid(logit(0.22)) - 0.22) < 1e-6);
  });
});
