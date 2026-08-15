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
  grainDrop: 0.12,
  grainBandMin: 0.65,
  grainBandMax: 0.78,
  strongGrainDrop: 0.25,
  strongGrainBandMin: 0.8,
  strongGrainBandMax: 0.95,
  mutedHighDrop: 0.28,
  mutedHighBandMin: 0.8,
  mutedHighBandMax: 0.88,
  flatHighDrop: 0.2,
  flatHighBandMin: 0.8,
  flatHighBandMax: 0.83,
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

  let calibrated = applyPower(
    applyCalibration(score, {
      bias: config.bias,
      temperature: config.temperature,
    }),
    config.scorePower ?? 1,
  );

  const grainDrop = config.grainDrop ?? 0;
  if (
    grainDrop > 0 &&
    graphic?.grainy &&
    calibrated >= (config.grainBandMin ?? 0.65) &&
    calibrated < (config.grainBandMax ?? 0.78)
  ) {
    calibrated -= grainDrop;
    reasons.push("photo-grain");
  }

  const strongGrainDrop = config.strongGrainDrop ?? 0;
  if (
    strongGrainDrop > 0 &&
    graphic?.strongGrain &&
    calibrated >= (config.strongGrainBandMin ?? 0.8) &&
    calibrated < (config.strongGrainBandMax ?? 0.95)
  ) {
    calibrated -= strongGrainDrop;
    reasons.push("strong-grain");
  }

  const mutedHighDrop = config.mutedHighDrop ?? 0;
  if (
    mutedHighDrop > 0 &&
    graphic?.muted &&
    calibrated >= (config.mutedHighBandMin ?? 0.8) &&
    calibrated < (config.mutedHighBandMax ?? 0.88)
  ) {
    calibrated -= mutedHighDrop;
    reasons.push("muted-high");
  }

  const flatHighDrop = config.flatHighDrop ?? 0;
  if (
    flatHighDrop > 0 &&
    graphic?.flatTone &&
    calibrated >= (config.flatHighBandMin ?? 0.8) &&
    calibrated < (config.flatHighBandMax ?? 0.83)
  ) {
    calibrated -= flatHighDrop;
    reasons.push("flat-high");
  }

  return {
    score: calibrated,
    rawVisual: visual,
    fusedBeforeCalibration: score,
    reasons,
  };
}
