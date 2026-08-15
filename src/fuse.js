import { applyCalibration, applyPower } from "./calibrate.js";
import { graphicScale } from "./graphic-gate.js";

/**
 * Default fusion. Bias stays at 0 so the badge number *is* the fused
 * score and `score >= 0.65` is a real 0.65 cut — not a remapped raw
 * threshold. Do not copy a calib-split bias into this object.
 */
export const FUSE_DEFAULTS = {
  provenanceAiScore: 0.93,
  cameraRealScale: 1,
  graphicScaleWhenFlagged: 1,
  vividLift: 0.05,
  vividBandMin: 0.5,
  vividBandMax: 0.68,
  mutedLift: 0.05,
  mutedBandMin: 0.5,
  mutedBandMax: 0.68,
  flatToneLift: 0.05,
  flatToneBandMin: 0.5,
  flatToneBandMax: 0.68,
  huePeakDrop: 0.05,
  huePeakBandMin: 0.58,
  huePeakBandMax: 0.8,
  bias: 0,
  temperature: 0.9,
  scorePower: 0.85,
};

export function fuseScores({
  visual,
  provenance,
  graphic,
  config = FUSE_DEFAULTS,
} = {}) {
  let score = Number.isFinite(visual) ? visual : 0.5;
  const reasons = ["visual"];

  if (provenance?.ai) {
    score = Math.max(score, config.provenanceAiScore);
    reasons.push("provenance-ai");
  } else if (provenance?.camera && score < 0.55) {
    score *= config.cameraRealScale;
    reasons.push("camera-exif");
  }

  if (graphic?.isGraphic) {
    score *= config.graphicScaleWhenFlagged ?? graphicScale(graphic);
    reasons.push("graphic-gate");
  }

  const lift = config.vividLift ?? 0;
  if (
    lift > 0 &&
    graphic?.vivid &&
    score >= (config.vividBandMin ?? 0.5) &&
    score < (config.vividBandMax ?? 0.68)
  ) {
    score = Math.min(0.92, score + lift);
    reasons.push("colorfulness");
  }

  const mutedLift = config.mutedLift ?? 0;
  if (
    mutedLift > 0 &&
    graphic?.muted &&
    score >= (config.mutedBandMin ?? 0.5) &&
    score < (config.mutedBandMax ?? 0.68)
  ) {
    score = Math.min(0.92, score + mutedLift);
    reasons.push("muted-color");
  }

  const flatToneLift = config.flatToneLift ?? 0;
  if (
    flatToneLift > 0 &&
    graphic?.flatTone &&
    score >= (config.flatToneBandMin ?? 0.5) &&
    score < (config.flatToneBandMax ?? 0.68)
  ) {
    score = Math.min(0.92, score + flatToneLift);
    reasons.push("flat-tone");
  }

  const huePeakDrop = config.huePeakDrop ?? 0;
  if (
    huePeakDrop > 0 &&
    graphic?.huePeakish &&
    score >= (config.huePeakBandMin ?? 0.58) &&
    score < (config.huePeakBandMax ?? 0.8)
  ) {
    score = Math.max(0.08, score - huePeakDrop);
    reasons.push("hue-peak");
  }

  const calibrated = applyPower(
    applyCalibration(score, {
      bias: config.bias,
      temperature: config.temperature,
    }),
    config.scorePower ?? 1,
  );

  return {
    score: calibrated,
    rawVisual: visual,
    fusedBeforeCalibration: score,
    reasons,
  };
}
