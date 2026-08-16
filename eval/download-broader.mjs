#!/usr/bin/env node
/**
 * Download the broader chrome-path scalar proxy.
 *
 * Disjoint from the official OpenFake core/test 180/class prefix.
 * Does not read OpenFake validation (probe training split).
 *
 *   npm run eval:download:broader
 *
 * Requires: pip install datasets pillow
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "eval/download_broader.py");
const child = spawn("python3", [script], { cwd: root, stdio: "inherit" });
const code = await new Promise((resolve) => child.on("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
