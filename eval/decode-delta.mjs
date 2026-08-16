/**
 * decode-delta: node-proxy − chrome-path on the same bytes / same detector.
 *
 * Chrome-path is the source of truth (createImageBitmap + OffscreenCanvas).
 * Node (sharp + onnxruntime-node) is a proxy. The score gap is decode-delta.
 * Do not paper it over in FUSE_DEFAULTS. Do not add mix nips to hide it.
 *
 * Recorded pair is copied from CLAIM.md KEEP 1e19a9f official-360.
 * Not invented. Fusion was not changed on that pair.
 */
import { DECODE_PATHS } from "../src/preprocess.js";

/** Official-360 paired run at KEEP 1e19a9f. Source: CLAIM.md. */
export const RECORDED_DECODE_DELTA = {
  kind: "decode-delta",
  label: "recorded KEEP 1e19a9f official-360",
  commit: "1e19a9f",
  n: 360,
  source: "CLAIM.md",
  chromePath: DECODE_PATHS.chrome,
  nodeProxy: DECODE_PATHS.node,
  sourceOfTruth: DECODE_PATHS.sourceOfTruth,
  fusePaperOver: false,
  node: {
    bal_acc_065: 0.872222,
    tpr_065: 0.9,
    tnr_065: 0.844444,
    tp: 162,
    fn: 18,
    tn: 152,
    fp: 28,
  },
  chrome: {
    bal_acc_065: 0.872222,
    tpr_065: 0.872222,
    tnr_065: 0.872222,
    tp: 157,
    fn: 23,
    tn: 157,
    fp: 23,
  },
  note:
    "Same BA 0.872222; confusion moved 162/18/152/28 → 157/23/157/23 (10 flips). " +
    "Fusion was not changed. Copied from CLAIM.md — not invented.",
};

function pickSummary(summary) {
  if (!summary) return null;
  const bal = Number(summary.balancedAccuracy ?? summary.bal_acc_065);
  const tpr = Number(summary.tpr ?? summary.tpr_065);
  const tnr = Number(summary.tnr ?? summary.tnr_065);
  if (![bal, tpr, tnr].every(Number.isFinite)) return null;
  return {
    bal_acc_065: bal,
    tpr_065: tpr,
    tnr_065: tnr,
    tp: Number.isFinite(summary.tp) ? summary.tp : null,
    fn: Number.isFinite(summary.fn) ? summary.fn : null,
    tn: Number.isFinite(summary.tn) ? summary.tn : null,
    fp: Number.isFinite(summary.fp) ? summary.fp : null,
  };
}

function subtract(chrome, node) {
  const delta = {
    bal_acc_065: chrome.bal_acc_065 - node.bal_acc_065,
    tpr_065: chrome.tpr_065 - node.tpr_065,
    tnr_065: chrome.tnr_065 - node.tnr_065,
  };
  for (const key of ["tp", "fn", "tn", "fp"]) {
    if (Number.isFinite(chrome[key]) && Number.isFinite(node[key])) {
      delta[key] = chrome[key] - node[key];
    }
  }
  return delta;
}

/**
 * Compare a chrome-path summary to a node-proxy summary.
 * Returns null if either side is missing. Never invents scores.
 */
export function computeDecodeDelta(chromeSummary, nodeSummary, extra = {}) {
  const chrome = pickSummary(chromeSummary);
  const node = pickSummary(nodeSummary);
  if (!chrome || !node) return null;
  return {
    kind: "decode-delta",
    label: extra.label || "live result files",
    chromePath: DECODE_PATHS.chrome,
    nodeProxy: DECODE_PATHS.node,
    sourceOfTruth: DECODE_PATHS.sourceOfTruth,
    fusePaperOver: false,
    chrome,
    node,
    delta: subtract(chrome, node),
    note:
      extra.note ||
      "chrome-path is truth. This gap is decode-delta, not a fuse bug. Do not edit FUSE_DEFAULTS to hide it.",
  };
}

export function recordedDecodeDelta() {
  return {
    ...RECORDED_DECODE_DELTA,
    delta: subtract(RECORDED_DECODE_DELTA.chrome, RECORDED_DECODE_DELTA.node),
  };
}

function fmt(n, digits = 6) {
  if (!Number.isFinite(n)) return "?";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

function confusion(side) {
  if (![side.tp, side.fn, side.tn, side.fp].every(Number.isFinite)) return "";
  return `  ${side.tp}/${side.fn}/${side.tn}/${side.fp}`;
}

/**
 * Stable print block. Tests match these headings.
 */
export function formatDecodeDelta(report) {
  if (!report) return "";
  const lines = [
    "decode-delta (node proxy vs chrome-path; chrome is truth)",
    `  pair: ${report.label}${report.commit ? ` commit ${report.commit}` : ""}`,
    `  node     BA ${report.node.bal_acc_065.toFixed(6)}  TPR ${report.node.tpr_065.toFixed(6)}  TNR ${report.node.tnr_065.toFixed(6)}${confusion(report.node)}`,
    `  chrome   BA ${report.chrome.bal_acc_065.toFixed(6)}  TPR ${report.chrome.tpr_065.toFixed(6)}  TNR ${report.chrome.tnr_065.toFixed(6)}${confusion(report.chrome)}`,
    `  delta    BA ${fmt(report.delta.bal_acc_065)} TPR ${fmt(report.delta.tpr_065)} TNR ${fmt(report.delta.tnr_065)}`,
    "  not a fuse target — do not paper over in FUSE_DEFAULTS",
  ];
  if (report.note) lines.push(`  note: ${report.note}`);
  return lines.join("\n");
}
