import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

await run(process.execPath, [join(root, "scripts/make-icons.mjs")]);

const libDir = join(root, "extension/lib");
await rm(libDir, { recursive: true, force: true });
await mkdir(libDir, { recursive: true });
for (const name of await readdir(join(root, "src"))) {
  if (name.endsWith(".js") || name.endsWith(".json")) {
    await cp(join(root, "src", name), join(libDir, name));
  }
}

const ortRoot = join(root, "node_modules/onnxruntime-web");
const vendor = join(root, "extension/vendor/ort");
await rm(vendor, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });

const distCandidates = [
  join(ortRoot, "dist"),
  join(ortRoot, "dist", "esm"),
];

async function copyIfExists(from, to) {
  try {
    await cp(from, to);
    return true;
  } catch {
    return false;
  }
}

let copied = 0;
for (const dist of distCandidates) {
  let names = [];
  try {
    names = await readdir(dist);
  } catch {
    continue;
  }
  for (const name of names) {
    if (
      name === "ort.min.js" ||
      name === "ort.wasm.min.js" ||
      name === "ort.webgpu.min.js" ||
      name.endsWith(".wasm") ||
      name.endsWith(".mjs") ||
      name.startsWith("ort-wasm")
    ) {
      if (await copyIfExists(join(dist, name), join(vendor, name))) copied += 1;
    }
  }
}

if (copied === 0) {
  throw new Error("onnxruntime-web dist files were not found");
}

const modelDstDir = join(root, "extension/models");
await mkdir(modelDstDir, { recursive: true });
for (const name of ["commfor-vit-s-384.onnx", "siglip2-vision.onnx"]) {
  try {
    await cp(join(root, "models", name), join(modelDstDir, name));
    console.log("copied", name);
  } catch {
    console.log(`${name} not present yet — run npm run fetch-models`);
  }
}

console.log(`build ok (copied ${copied} onnxruntime files)`);
