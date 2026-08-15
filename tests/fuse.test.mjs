import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fuseScores, FUSE_DEFAULTS } from "../src/fuse.js";

describe("fuse", () => {
  it("short-circuits to a high AI score when provenance declares a generator", () => {
    const result = fuseScores({
      visual: 0.2,
      provenance: { ai: true, camera: false },
      graphic: { isGraphic: false },
    });
    assert.ok(result.score >= 0.9);
    assert.ok(result.reasons.includes("provenance-ai"));
  });

  it("down-weights camera-native photos that the visual model is unsure about", () => {
    const result = fuseScores({
      visual: 0.4,
      provenance: { ai: false, camera: true },
      graphic: { isGraphic: false },
    });
    assert.ok(result.fusedBeforeCalibration < 0.4);
    assert.ok(result.reasons.includes("camera-exif"));
  });

  it("does not remap a raw 0.33 onto the 0.65 badge cut", () => {
    const result = fuseScores({
      visual: 0.33,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false },
    });
    assert.ok(Math.abs(result.score - 0.33) < 1e-6);
    assert.ok(result.score < 0.65);
  });

  it("down-weights charts and UI captures", () => {
    const result = fuseScores({
      visual: 0.8,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: true },
    });
    assert.ok(result.fusedBeforeCalibration < 0.8 * FUSE_DEFAULTS.graphicScaleWhenFlagged + 1e-6);
    assert.ok(result.reasons.includes("graphic-gate"));
  });
});
