#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [commit, bal, status, ...rest] = process.argv.slice(2);
if (!commit || !bal || !status) {
  console.error("usage: log-result.mjs <commit> <bal_acc_065> <keep|discard|crash> <description>");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(root, { recursive: true });
const line = `${commit}\t${bal}\t${status}\t${rest.join(" ").replaceAll("\t", " ")}\n`;
await appendFile(join(root, "autoresearch/results.tsv"), line);
process.stdout.write(line);
