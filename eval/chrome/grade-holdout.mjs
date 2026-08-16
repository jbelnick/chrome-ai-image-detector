#!/usr/bin/env node
/**
 * Print the PR 12 diagnostic holdout as grade-only.
 *
 * NEVER train on it. NEVER add those images into the 358 mix.
 * This prints the already-recorded chrome-path table (copied from PR 12).
 * It does not download the 146 images and does not fit anything.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./ship-gate.mjs";

function pct(x) {
  if (x == null) return "n/a";
  return `${(x * 100).toFixed(2)}%`;
}

async function main() {
  const root = repoRoot();
  const raw = JSON.parse(await readFile(join(root, "eval/data/holdout-grade-only.json"), "utf8"));
  console.log("");
  console.log("PR 12 diagnostic holdout — GRADE ONLY");
  console.log(raw.note);
  console.log(`Detector: ${raw.detector}  date: ${raw.date}  backend: ${raw.backend}`);
  console.log(`Command recorded: ${raw.command}`);
  console.log("");
  console.log("Per-category @ 0.65 (diagnostic — not a KEEP ratchet):");
  console.log(
    `${"category".padEnd(22)} ${"n".padStart(4)} ${"AI".padStart(3)} ${"real".padStart(4)} ${"TPR".padStart(8)} ${"TNR".padStart(8)} ${"BA".padStart(8)}  TP/FN/TN/FP`,
  );
  for (const s of raw.byCategory) {
    console.log(
      `${s.category.padEnd(22)} ${String(s.n).padStart(4)} ${String(s.nAi).padStart(3)} ${String(s.nReal).padStart(4)} ${pct(s.tpr).padStart(8)} ${pct(s.tnr).padStart(8)} ${pct(s.balancedAccuracy).padStart(8)}  ${s.tp}/${s.fn}/${s.tn}/${s.fp}`,
    );
  }
  const o = raw.overall;
  console.log("");
  console.log("OVERALL scenario holdout @ 0.65 (not the 358 scalar, not Kenny's bench):");
  console.log(`  balanced accuracy  ${pct(o.balancedAccuracy)}`);
  console.log(`  TPR                ${pct(o.tpr)}`);
  console.log(`  TNR                ${pct(o.tnr)}`);
  console.log(`  n                  ${raw.n} (AI ${raw.nAi} / real ${raw.nReal})`);
  console.log(`  TP/FN/TN/FP        ${o.tp} / ${o.fn} / ${o.tn} / ${o.fp}`);
  console.log("");
  console.log(
    `Charlesworth historic_scan_bw_00 on KEEP ${raw.detector}: ${raw.named.historic_scan_bw_00.score} (the AI 99% miss).`,
  );
  console.log("Do not train. Do not add holdout images into the 358 mix.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
