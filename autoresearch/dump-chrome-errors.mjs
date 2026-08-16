#!/usr/bin/env node
/**
 * Dump chrome-path FN/FP from eval/results/chrome.json.
 * Analysis only. Does not change the score or the set.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const latest = JSON.parse(await readFile(join(root, "eval/results/chrome.json"), "utf8"));
const rows = latest.rows || latest.officialRows || [];
const threshold = latest.threshold ?? 0.65;

function kind(row) {
  const pred = row.score >= threshold ? 1 : 0;
  if (row.label === 1 && pred === 0) return "FN";
  if (row.label === 0 && pred === 1) return "FP";
  if (row.label === 1 && pred === 1) return "TP";
  return "TN";
}

const buckets = { FN: [], FP: [], TP: [], TN: [] };
for (const row of rows) buckets[kind(row)].push(row);

function show(tag, list) {
  const sorted = [...list].sort((a, b) => a.score - b.score);
  console.log(`\n${tag} n=${sorted.length}`);
  for (const r of sorted) {
    const sl = Number.isFinite(r.siglip) ? r.siglip.toFixed(3) : "?";
    const cf = Number.isFinite(r.commfor) ? r.commfor.toFixed(3) : "?";
    const vis = Number.isFinite(r.visual) ? r.visual.toFixed(3) : "?";
    console.log(
      `  ${r.score.toFixed(3)} vis=${vis} sl=${sl} cf=${cf} ${r.name} ${(r.reasons || []).join(",")}`,
    );
  }
}

console.log(
  `chrome-path dump threshold=${threshold} n=${rows.length} ` +
    `TP=${buckets.TP.length} FN=${buckets.FN.length} TN=${buckets.TN.length} FP=${buckets.FP.length}`,
);
show("FN (AI scored < 0.65)", buckets.FN);
show("FP (real scored >= 0.65)", buckets.FP);
