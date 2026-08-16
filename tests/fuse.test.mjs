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

  it("skips photo-grain after a vivid colorfulness lift", () => {
    const skipped = fuseScores({
      visual: 0.629,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, grainy: true, vivid: true },
    });
    assert.equal(skipped.reasons.includes("colorfulness"), true);
    assert.equal(skipped.reasons.includes("photo-grain"), false);
    assert.ok(skipped.score >= 0.65);

    const stillDropped = fuseScores({
      visual: 0.709,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, grainy: true, vivid: true },
    });
    assert.equal(stillDropped.reasons.includes("colorfulness"), false);
    assert.ok(stillDropped.reasons.includes("photo-grain"));
    assert.ok(stillDropped.score < 0.65);
  });

  it("skips photo-grain after a muted-color lift even without flat-tone", () => {
    const skipped = fuseScores({
      visual: 0.64,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, grainy: true, muted: true, flatTone: false },
    });
    assert.equal(skipped.reasons.includes("muted-color"), true);
    assert.equal(skipped.reasons.includes("photo-grain"), false);
    assert.ok(skipped.score >= 0.65);

    const stillDropped = fuseScores({
      visual: 0.709,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, grainy: true, muted: true, flatTone: true },
    });
    assert.equal(stillDropped.reasons.includes("muted-color"), false);
    assert.ok(stillDropped.reasons.includes("photo-grain"));
    assert.ok(stillDropped.score < 0.65);
  });

  it("drops a grainy just-over-cut visual without inventing a real verdict from grain alone", () => {
    const dropped = fuseScores({
      visual: 0.70,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, grainy: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("photo-grain"));

    const grainOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, grainy: true },
    });
    assert.ok(Math.abs(grainOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(grainOnly.reasons.includes("photo-grain"), false);
  });

  it("drops a strong-grain high-band visual without inventing a real verdict from grain alone", () => {
    const dropped = fuseScores({
      visual: 0.8,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, strongGrain: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("strong-grain"));

    const grainOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, strongGrain: true },
    });
    assert.ok(Math.abs(grainOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(grainOnly.reasons.includes("strong-grain"), false);
  });

  it("drops a muted high-band visual without inventing a real verdict from low colorfulness alone", () => {
    const dropped = fuseScores({
      visual: 0.8,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("muted-high"));

    const mutedOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true },
    });
    assert.ok(Math.abs(mutedOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(mutedOnly.reasons.includes("muted-high"), false);
  });

  it("drops a flat-tone high-band visual without inventing a real verdict from even illumination alone", () => {
    const dropped = fuseScores({
      visual: 0.76,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("flat-high"));

    const toneOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(Math.abs(toneOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(toneOnly.reasons.includes("flat-high"), false);
  });

  it("drops a vivid high-band visual without inventing a real verdict from colorfulness alone", () => {
    const dropped = fuseScores({
      visual: 0.84,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, vivid: true, flatTone: false },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("vivid-high"));

    const vividFlat = fuseScores({
      visual: 0.84,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, vivid: true, flatTone: true },
    });
    assert.equal(vividFlat.reasons.includes("vivid-high"), false);

    const vividOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, vivid: true, flatTone: false },
    });
    assert.ok(Math.abs(vividOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(vividOnly.reasons.includes("vivid-high"), false);
  });

  it("drops a muted-fine high-band visual without inventing a real verdict from muted grain alone", () => {
    const dropped = fuseScores({
      visual: 0.85,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, mutedFine: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("muted-fine"));

    const fineOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, mutedFine: true },
    });
    assert.ok(Math.abs(fineOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(fineOnly.reasons.includes("muted-fine"), false);
  });

  it("drops a flat-tone mid-high visual without inventing a real verdict from even illumination alone", () => {
    const dropped = fuseScores({
      visual: 0.875,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("flat-mid"));

    const toneOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(Math.abs(toneOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(toneOnly.reasons.includes("flat-mid"), false);
  });

  it("drops a flat-fine high-band visual without inventing a real verdict from flat grain alone", () => {
    const dropped = fuseScores({
      visual: 0.89,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatFine: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("flat-fine"));

    const fineOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatFine: true },
    });
    assert.ok(Math.abs(fineOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(fineOnly.reasons.includes("flat-fine"), false);
  });

  it("drops a flat-tone upper-band visual without inventing a real verdict from even illumination alone", () => {
    const dropped = fuseScores({
      visual: 0.91,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("flat-upper"));

    const toneOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, flatTone: true },
    });
    assert.ok(Math.abs(toneOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(toneOnly.reasons.includes("flat-upper"), false);
  });

  it("drops a muted-flat-fine high-band visual without inventing a real verdict from that combo alone", () => {
    const dropped = fuseScores({
      visual: 0.925,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, mutedFlatFine: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("muted-flat-fine"));

    const comboOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, mutedFlatFine: true },
    });
    assert.ok(Math.abs(comboOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(comboOnly.reasons.includes("muted-flat-fine"), false);
  });

  it("drops a muted upper-band visual without inventing a real verdict from low colorfulness alone", () => {
    const dropped = fuseScores({
      visual: 0.926,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true, flatTone: false },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("muted-upper"));

    const mutedOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true, flatTone: false },
    });
    assert.ok(Math.abs(mutedOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(mutedOnly.reasons.includes("muted-upper"), false);
  });

  it("drops a muted strong-grain tail without inventing a real verdict from that combo alone", () => {
    const dropped = fuseScores({
      visual: 0.908,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true, strongGrain: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("muted-strong-tail"));

    const comboOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: true, strongGrain: true },
    });
    assert.ok(Math.abs(comboOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(comboOnly.reasons.includes("muted-strong-tail"), false);
  });

  it("drops a muted scan-grain extreme-tail visual without inventing a real verdict from film grain alone", () => {
    const dropped = fuseScores({
      visual: 0.97,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: true, muted: true, scanGrain: true },
    });
    assert.ok(dropped.score < 0.65);
    assert.ok(dropped.reasons.includes("muted-scan"));

    const comboOnly = fuseScores({
      visual: 0.2,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: true, muted: true, scanGrain: true },
    });
    assert.ok(Math.abs(comboOnly.fusedBeforeCalibration - 0.2) < 1e-9);
    assert.equal(comboOnly.reasons.includes("muted-scan"), false);

    const colorfulTail = fuseScores({
      visual: 0.97,
      provenance: { ai: false, camera: false },
      graphic: { isGraphic: false, muted: false, scanGrain: false, vivid: true },
    });
    assert.equal(colorfulTail.reasons.includes("muted-scan"), false);
    assert.ok(colorfulTail.score >= 0.65);
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
