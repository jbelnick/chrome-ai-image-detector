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
  blockyLift: 0.06,
  blockyBandMin: 0.48,
  blockyBandMax: 0.7,
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

  const lift = config.blockyLift ?? 0;
  if (
    lift > 0 &&
    graphic?.blocky &&
    score >= (config.blockyBandMin ?? 0.48) &&
    score < (config.blockyBandMax ?? 0.7)
  ) {
    score = Math.min(0.92, score + lift);
    reasons.push("jpeg-block");
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
