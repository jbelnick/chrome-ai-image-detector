/**
 * Score calibration so the operating point at the required 0.65
 * threshold matches a fitted raw-score threshold.
 */

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0.5;
  if (value <= 0) return 1e-6;
  if (value >= 1) return 1 - 1e-6;
  return value;
}

export function logit(p) {
  const x = clamp01(p);
  return Math.log(x / (1 - x));
}

export function sigmoid(z) {
  if (z >= 20) return 1 - 1e-6;
  if (z <= -20) return 1e-6;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Shift / scale a raw probability so that rawThreshold maps to targetThreshold.
 * temperature > 1 softens; temperature < 1 sharpens.
 */
export function applyCalibration(rawScore, { bias = 0, temperature = 1 } = {}) {
  const t = temperature === 0 ? 1 : temperature;
  return sigmoid((logit(rawScore) - bias) / t);
}

/**
 * Beta / power calibration. power < 1 lifts all scores toward 1
 * (milder than remapping a raw 0.33 onto 0.65). power = 1 is identity.
 */
export function applyPower(score, power = 1) {
  const p = clamp01(score);
  if (!Number.isFinite(power) || power <= 0 || power === 1) return p;
  return p ** power;
}

/**
 * Choose bias so that applyCalibration(rawThreshold) === targetThreshold
 * when temperature is 1. Used after picking the accuracy-optimal raw cut.
 */
export function biasForTarget(rawThreshold, targetThreshold = 0.65) {
  return logit(rawThreshold) - logit(targetThreshold);
}

/**
 * Scan candidate raw thresholds and return the one with the best
 * balanced accuracy. Does not look at image identities — only scores.
 */
export function bestRawThreshold(rows, { min = 0.05, max = 0.95, step = 0.01 } = {}) {
  let best = { threshold: 0.5, balancedAccuracy: -1 };
  for (let t = min; t <= max + 1e-9; t += step) {
    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;
    for (const row of rows) {
      const predictedAi = row.score >= t;
      if (row.label === 1 && predictedAi) tp += 1;
      else if (row.label === 0 && !predictedAi) tn += 1;
      else if (row.label === 0 && predictedAi) fp += 1;
      else fn += 1;
    }
    const tpr = tp + fn === 0 ? 0 : tp / (tp + fn);
    const tnr = tn + fp === 0 ? 0 : tn / (tn + fp);
    const ba = (tpr + tnr) / 2;
    if (ba > best.balancedAccuracy) {
      best = { threshold: Number(t.toFixed(4)), balancedAccuracy: ba, tpr, tnr };
    }
  }
  return best;
}
