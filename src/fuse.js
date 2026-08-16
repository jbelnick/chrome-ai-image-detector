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
  vividHighDrop: 0.24,
  vividHighBandMin: 0.87,
  vividHighBandMax: 0.89,
  mutedFineDrop: 0.28,
  mutedFineBandMin: 0.88,
  mutedFineBandMax: 0.93,
  flatMidDrop: 0.27,
  flatMidBandMin: 0.9,
  flatMidBandMax: 0.918,
  flatFineDrop: 0.28,
  flatFineBandMin: 0.92,
  flatFineBandMax: 0.94,
  flatUpperDrop: 0.29,
  flatUpperBandMin: 0.934,
  flatUpperBandMax: 0.946,
  mutedFlatFineDrop: 0.31,
  mutedFlatFineBandMin: 0.946,
  mutedFlatFineBandMax: 0.955,
  mutedUpperDrop: 0.31,
  mutedUpperBandMin: 0.949,
  mutedUpperBandMax: 0.954,
  mutedStrongTailDrop: 0.04,
  mutedStrongTailBandMin: 0.68,
  mutedStrongTailBandMax: 0.694,
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

  if (graphic?.socialRecompress) {
    reasons.push("social-recompress");
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
    !reasons.includes("muted-color") &&
    !reasons.includes("colorfulness") &&
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

  const vividHighDrop = config.vividHighDrop ?? 0;
  if (
    vividHighDrop > 0 &&
    graphic?.vivid &&
    !graphic?.flatTone &&
    calibrated >= (config.vividHighBandMin ?? 0.87) &&
    calibrated < (config.vividHighBandMax ?? 0.89)
  ) {
    calibrated -= vividHighDrop;
    reasons.push("vivid-high");
  }

  const mutedFineDrop = config.mutedFineDrop ?? 0;
  if (
    mutedFineDrop > 0 &&
    graphic?.mutedFine &&
    calibrated >= (config.mutedFineBandMin ?? 0.88) &&
    calibrated < (config.mutedFineBandMax ?? 0.93)
  ) {
    calibrated -= mutedFineDrop;
    reasons.push("muted-fine");
  }

  const flatMidDrop = config.flatMidDrop ?? 0;
  if (
    flatMidDrop > 0 &&
    graphic?.flatTone &&
    calibrated >= (config.flatMidBandMin ?? 0.9) &&
    calibrated < (config.flatMidBandMax ?? 0.918)
  ) {
    calibrated -= flatMidDrop;
    reasons.push("flat-mid");
  }

  const flatFineDrop = config.flatFineDrop ?? 0;
  if (
    flatFineDrop > 0 &&
    graphic?.flatFine &&
    calibrated >= (config.flatFineBandMin ?? 0.92) &&
    calibrated < (config.flatFineBandMax ?? 0.94)
  ) {
    calibrated -= flatFineDrop;
    reasons.push("flat-fine");
  }

  const flatUpperDrop = config.flatUpperDrop ?? 0;
  if (
    flatUpperDrop > 0 &&
    graphic?.flatTone &&
    calibrated >= (config.flatUpperBandMin ?? 0.934) &&
    calibrated < (config.flatUpperBandMax ?? 0.946)
  ) {
    calibrated -= flatUpperDrop;
    reasons.push("flat-upper");
  }

  const mutedFlatFineDrop = config.mutedFlatFineDrop ?? 0;
  if (
    mutedFlatFineDrop > 0 &&
    graphic?.mutedFlatFine &&
    calibrated >= (config.mutedFlatFineBandMin ?? 0.946) &&
    calibrated < (config.mutedFlatFineBandMax ?? 0.955)
  ) {
    calibrated -= mutedFlatFineDrop;
    reasons.push("muted-flat-fine");
  }

  const mutedUpperDrop = config.mutedUpperDrop ?? 0;
  if (
    mutedUpperDrop > 0 &&
    graphic?.muted &&
    !graphic?.flatTone &&
    calibrated >= (config.mutedUpperBandMin ?? 0.949) &&
    calibrated < (config.mutedUpperBandMax ?? 0.954)
  ) {
    calibrated -= mutedUpperDrop;
    reasons.push("muted-upper");
  }

  const mutedStrongTailDrop = config.mutedStrongTailDrop ?? 0;
  if (
    mutedStrongTailDrop > 0 &&
    graphic?.muted &&
    graphic?.strongGrain &&
    calibrated >= (config.mutedStrongTailBandMin ?? 0.68) &&
    calibrated < (config.mutedStrongTailBandMax ?? 0.694)
  ) {
    calibrated -= mutedStrongTailDrop;
    reasons.push("muted-strong-tail");
  }

  return {
    score: calibrated,
    rawVisual: visual,
    fusedBeforeCalibration: score,
    reasons,
  };
}
