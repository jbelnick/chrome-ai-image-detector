#!/usr/bin/env node
/**
 * Chrome-path scalar. Source: eval/results/chrome.json → officialOpenFake.
 * Do not invent. Do not use Node latest.json as the ratchet.
 */
import { readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const latest = JSON.parse(await readFile(join(root, "eval/results/chrome.json"), "utf8"));
const row = latest.officialOpenFake;
if (!row || !Number.isFinite(row.balancedAccuracy)) {
  console.error("officialOpenFake missing from eval/results/chrome.json");
  process.exit(2);
}
const lines = [
  `bal_acc_065: ${row.balancedAccuracy.toFixed(6)}`,
  `tpr_065:     ${row.tpr.toFixed(6)}`,
  `tnr_065:     ${row.tnr.toFixed(6)}`,
  `backend:     ${latest.backend || "?"}`,
  `webgpu:      ${latest.webgpu || "?"}`,
  `tp/fn/tn/fp: ${row.tp} / ${row.fn} / ${row.tn} / ${row.fp}`,
  `n:           ${row.n}`,
].join("\n");
console.log(lines);
await appendFile(join(root, "autoresearch/run.log"), `\nchrome-path\n${lines}\n`);
