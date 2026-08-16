import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODELS } from "../src/model-config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function sha256File(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function verified(path, spec) {
  try {
    const info = await stat(path);
    if (info.size !== spec.bytes) return false;
    return (await sha256File(path)) === spec.sha256;
  } catch {
    return false;
  }
}

async function download(url, dest, spec) {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  console.log(`downloading ${spec.id} from ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download ${spec.id} failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const hash = await sha256File(tmp);
  if (hash !== spec.sha256) {
    throw new Error(`${spec.id} SHA-256 mismatch: got ${hash}, expected ${spec.sha256}`);
  }
  const info = await stat(tmp);
  if (info.size !== spec.bytes) {
    throw new Error(`${spec.id} size mismatch: got ${info.size}, expected ${spec.bytes}`);
  }
  await copyFile(tmp, dest);
  console.log(`verified ${spec.id} ${hash}`);
}

async function ensureCommfor() {
  const spec = MODELS.commfor;
  const dest = join(root, "models", spec.filename);
  if (await verified(dest, spec)) {
    console.log(`already verified ${dest}`);
    return;
  }
  const staged = "/tmp/cf-official/commfor-vit-s-384.onnx";
  if (await verified(staged, spec)) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(staged, dest);
    console.log(`copied verified export to ${dest}`);
    return;
  }
  console.log("exporting OwensLab/commfor-model-384 (Python + torch)");
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
  if (!(await verified(dest, spec))) {
    const hash = await sha256File(dest);
    throw new Error(`${spec.id} SHA-256 mismatch after export: got ${hash}, expected ${spec.sha256}`);
  }
}

async function ensureSiglip() {
  const spec = MODELS.siglip2;
  const dest = join(root, "models", spec.filename);
  if (await verified(dest, spec)) {
    console.log(`already verified ${dest}`);
    return;
  }
  const staged = "/tmp/siglip2/community_vision_fp32.onnx";
  if (await verified(staged, spec)) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(staged, dest);
    console.log(`copied verified SigLIP2 vision to ${dest}`);
    return;
  }
  await download(spec.url, dest, spec);
}

await ensureCommfor();
await ensureSiglip();
console.log("all models ready");
