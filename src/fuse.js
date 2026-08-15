import { applyCalibration } from "./calibrate.js";
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
  textureSmoothLift: 0.08,
  textureBandMin: 0.5,
  textureBandMax: 0.68,
  bias: 0,
  temperature: 0.9,
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

  // Weak AI cue: oversmoothed mid-range visuals. Does not invent a
  // verdict from texture alone — only lifts an already-suspicious band.
  const lift = config.textureSmoothLift ?? 0;
  if (
    lift > 0 &&
    graphic?.oversmooth &&
    score >= (config.textureBandMin ?? 0.5) &&
    score < (config.textureBandMax ?? 0.68)
  ) {
    score = Math.min(0.92, score + lift);
    reasons.push("texture-smooth");
  }

  const calibrated = applyCalibration(score, {
    bias: config.bias,
    temperature: config.temperature,
  });

  return {
    score: calibrated,
    rawVisual: visual,
    fusedBeforeCalibration: score,
    reasons,
  };
}
