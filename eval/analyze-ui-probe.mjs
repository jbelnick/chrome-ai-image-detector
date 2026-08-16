#!/usr/bin/env node
/**
 * Pixel-flag dump for the independent UI probe.
 * Same CF crop + analyzePixels as the Node eval path.
 * Does not run ONNX. Does not touch the holdout.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PREPROCESS, scaledSize, centerCropBox } from "../src/preprocess.js";
import { analyzePixels } from "../src/graphic-gate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "eval/data/ui-probe");

function rgbToRgba(rgb, width, height) {
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

async function cropCf(path) {
  const file = await readFile(path);
  const meta = await sharp(file).rotate().metadata();
  const scaled = scaledSize(meta.width, meta.height);
  const resized = await sharp(file)
    .rotate()
    .resize(scaled.width, scaled.height, { kernel: "cubic", fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const box = centerCropBox(resized.info.width, resized.info.height);
  const cropped = await sharp(resized.data, {
    raw: { width: resized.info.width, height: resized.info.height, channels: 3 },
  })
    .extract({ left: box.x, top: box.y, width: box.size, height: box.size })
    .raw()
    .toBuffer();
  return rgbToRgba(cropped, box.size, box.size);
}

async function main() {
  const names = (await readdir(dir)).filter((n) =>
    [".jpg", ".jpeg", ".png", ".webp"].includes(extname(n).toLowerCase()),
  );
  names.sort();
  console.log(
    [
      "id".padEnd(22),
      "g",
      "scan",
      "mut",
      "viv",
      "flat",
      "colors",
      "edge",
      "fine",
      "colorful",
      "cb",
    ].join("  "),
  );
  for (const name of names) {
    const rgba = await cropCf(join(dir, name));
    const a = analyzePixels(rgba, PREPROCESS.crop, PREPROCESS.crop);
    console.log(
      [
        name.replace(/\.[^.]+$/, "").padEnd(22),
        a.isGraphic ? "Y" : ".",
        a.scanGrain ? "Y" : ".",
        a.muted ? "Y" : ".",
        a.vivid ? "Y" : ".",
        a.flatTone ? "Y" : ".",
        String(a.uniqueColors).padStart(6),
        a.edgeRatio.toFixed(3),
        a.fineRatio.toFixed(3),
        a.colorfulness.toFixed(1).padStart(8),
        a.centerBorder.toFixed(3),
      ].join("  "),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
