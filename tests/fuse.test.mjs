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

  it("records camera EXIF without changing the visual score when scale is 1", () => {
    const result = fuseScores({
      visual: 0.4,
      provenance: { ai: false, camera: true },
      graphic: { isGraphic: false },
    });
    assert.ok(Math.abs(result.fusedBeforeCalibration - 0.4) < 1e-9);
    assert.ok(result.reasons.includes("camera-exif"));
  });

  it("does not remap a raw 0.33 onto the 0.65 badge cut", () => {
    const result = fuseScores({
      visual: 0.33,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false },
    });
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

  it("lifts a vivid mid-range visual without inventing a verdict from colorfulness alone", () => {
    const lifted = fuseScores({
      visual: 0.56,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, vivid: true },
    });
    assert.ok(lifted.fusedBeforeCalibration > 0.56);
    assert.ok(lifted.reasons.includes("colorfulness"));

    const colorOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, vivid: true },
    });
    assert.ok(Math.abs(colorOnly.fusedBeforeCalibration - 0.2) < 1e-9);
  });

  it("lifts a flat-tone mid-range visual without inventing a verdict from even illumination alone", () => {
    const lifted = fuseScores({
      visual: 0.56,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(lifted.fusedBeforeCalibration > 0.56);
    assert.ok(lifted.reasons.includes("flat-tone"));

    const toneOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(Math.abs(toneOnly.fusedBeforeCalibration - 0.2) < 1e-9);
  });

  it("lifts a muted mid-range visual without inventing a verdict from low colorfulness alone", () => {
    const lifted = fuseScores({
      visual: 0.56,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true },
    });
    assert.ok(lifted.fusedBeforeCalibration > 0.56);
    assert.ok(lifted.reasons.includes("muted-color"));
  });
});
