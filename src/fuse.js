import { applyCalibration } from "./calibrate.js";
import { graphicScale } from "./graphic-gate.js";

/**
 * Default fusion / calibration. `bias` is fitted on a held-out
 * calibration split so the 0.65 operating point is well placed.
 * Do not tune these numbers against the reported proxy test set.
 */
export const FUSE_DEFAULTS = {
  provenanceAiScore: 0.93,
  cameraRealScale: 0.88,
  graphicScaleWhenFlagged: 0.72,
  bias: 0,
  temperature: 1,
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
