/**
 * Detection metrics used by the eval harness and unit tests.
 * Balanced accuracy = (TPR + TNR) / 2.
 */

export function confusionAtThreshold(rows, threshold = 0.65) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    const predictedAi = row.score >= threshold;
    if (row.label === 1 && predictedAi) tp += 1;
    else if (row.label === 0 && !predictedAi) tn += 1;
    else if (row.label === 0 && predictedAi) fp += 1;
    else fn += 1;
  }
  return { tp, tn, fp, fn };
}

export function truePositiveRate(confusion) {
  const denom = confusion.tp + confusion.fn;
  return denom === 0 ? 0 : confusion.tp / denom;
}

export function trueNegativeRate(confusion) {
  const denom = confusion.tn + confusion.fp;
  return denom === 0 ? 0 : confusion.tn / denom;
}

export function balancedAccuracy(confusion) {
  return (truePositiveRate(confusion) + trueNegativeRate(confusion)) / 2;
}

export function summarize(rows, threshold = 0.65) {
  const confusion = confusionAtThreshold(rows, threshold);
  const tpr = truePositiveRate(confusion);
  const tnr = trueNegativeRate(confusion);
  return {
    threshold,
    n: rows.length,
    nAi: rows.filter((r) => r.label === 1).length,
    nReal: rows.filter((r) => r.label === 0).length,
    ...confusion,
    tpr,
    tnr,
    balancedAccuracy: (tpr + tnr) / 2,
  };
}

/**
 * Per-category TPR/TNR/BA plus overall. Used by the diagnostic
 * scenario holdout — not the KEEP scalar.
 */
export function summarizeByCategory(rows, threshold = 0.65) {
  const byCategory = {};
  const groups = new Map();
  for (const row of rows) {
    const key = row.category || "uncategorized";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [category, group] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    byCategory[category] = summarize(group, threshold);
  }
  return {
    overall: summarize(rows, threshold),
    byCategory,
  };
}
