#!/usr/bin/env node
/**
 * Read the frozen harness output. Do not recompute a different metric.
 */
import { readFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const latest = JSON.parse(await readFile(join(root, "eval/results/latest.json"), "utf8"));
const row = latest.officialOpenFake;
if (!row || !Number.isFinite(row.balancedAccuracy)) {
  console.error("officialOpenFake missing from eval/results/latest.json");
  process.exit(2);
}
const lines = [
  `bal_acc_065: ${row.balancedAccuracy.toFixed(6)}`,
  `tpr_065:     ${row.tpr.toFixed(6)}`,
  `tnr_065:     ${row.tnr.toFixed(6)}`,
].join("\n");
console.log(lines);
await appendFile(join(root, "autoresearch/run.log"), `\n${lines}\n`);
