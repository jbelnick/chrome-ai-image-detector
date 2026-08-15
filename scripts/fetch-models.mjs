import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { MODEL } from "../src/model-config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "models", MODEL.filename);

async function sha256File(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function alreadyGood() {
  try {
    const info = await stat(dest);
    if (info.size !== MODEL.bytes) return false;
    const hash = await sha256File(dest);
    return hash === MODEL.sha256;
  } catch {
    return false;
  }
}

if (await alreadyGood()) {
  console.log(`model already present and verified: ${dest}`);
  process.exit(0);
}

const staged = "/tmp/cf-official/commfor-vit-s-384.onnx";
try {
  const hash = await sha256File(staged);
  if (hash === MODEL.sha256) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(staged, dest);
    console.log(`copied verified export to ${dest}`);
    process.exit(0);
  }
} catch {
  // fall through to export
}

console.log("exporting official OwensLab/commfor-model-384 → ONNX (requires Python + torch)");
await mkdir(dirname(dest), { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn("python3", [join(root, "tools/export_onnx.py"), dest], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`export_onnx.py exited ${code}`));
  });
});

const hash = await sha256File(dest);
if (hash !== MODEL.sha256) {
  console.warn(`exported SHA-256 ${hash} (pinned ${MODEL.sha256})`);
  console.warn("update src/model-config.js if the official weights revision changed");
} else {
  console.log(`verified ${hash}`);
}
