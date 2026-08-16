#!/usr/bin/env node
/**
 * Chrome-path scalar. Source: eval/results/chrome.json → broaderProxy.
 * Official 360 is printed as a secondary report only.
 * Do not invent. Do not use Node latest.json as the ratchet.
 */
import { readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDecodeDelta, recordedDecodeDelta } from "../eval/decode-delta.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const latest = JSON.parse(await readFile(join(root, "eval/results/chrome.json"), "utf8"));
const scalar = latest.broaderProxy;
const official = latest.officialOpenFake;
if (!scalar || !Number.isFinite(scalar.balancedAccuracy)) {
  console.error("broaderProxy missing from eval/results/chrome.json — not a new-scalar run");
  process.exit(2);
}
if (!official || !Number.isFinite(official.balancedAccuracy)) {
  console.error("officialOpenFake missing from eval/results/chrome.json");
  process.exit(2);
}
const lines = [
  "SCALAR broader-proxy (keep/revert)",
  `bal_acc_065: ${scalar.balancedAccuracy.toFixed(6)}`,
  `tpr_065:     ${scalar.tpr.toFixed(6)}`,
  `tnr_065:     ${scalar.tnr.toFixed(6)}`,
  `tp/fn/tn/fp: ${scalar.tp} / ${scalar.fn} / ${scalar.tn} / ${scalar.fp}`,
  `n:           ${scalar.n}`,
  "",
  "SECONDARY official-360 (not the ratchet)",
  `bal_acc_065: ${official.balancedAccuracy.toFixed(6)}`,
  `tpr_065:     ${official.tpr.toFixed(6)}`,
  `tnr_065:     ${official.tnr.toFixed(6)}`,
  `tp/fn/tn/fp: ${official.tp} / ${official.fn} / ${official.tn} / ${official.fp}`,
  `n:           ${official.n}`,
  `backend:     ${latest.backend || "?"}`,
  `webgpu:      ${latest.webgpu || "?"}`,
  "",
  formatDecodeDelta(latest.decodeDelta || recordedDecodeDelta()),
].join("\n");
console.log(lines);
await appendFile(join(root, "autoresearch/run.log"), `\nchrome-path broader-proxy\n${lines}\n`);
