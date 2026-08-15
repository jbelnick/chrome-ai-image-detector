#!/usr/bin/env node
/**
 * Eval harness: same preprocess, fusion, and ONNX weights as the extension.
 * Prints balanced accuracy at the required 0.65 cut.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { MODELS, EVAL_THRESHOLD } from "../src/model-config.js";
import {
  PREPROCESS,
  scaledSize,
  centerCropBox,
  imageDataToTensor,
  visualProbabilityFromLogit,
} from "../src/preprocess.js";
import { imageDataToSiglipTensor, siglipProbability, blendVisual, SIGLIP } from "../src/siglip.js";
import { scanProvenance } from "../src/provenance.js";
import { analyzePixels } from "../src/graphic-gate.js";
import { fuseScores, FUSE_DEFAULTS } from "../src/fuse.js";
import { applyCalibration, bestRawThreshold, biasForTarget } from "../src/calibrate.js";
import { summarize } from "../src/metrics.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "eval/data");
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, seed) {
  const rnd = mulberry32(seed);
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function listLabeled() {
  const rows = [];
  for (const [folder, label] of [
    ["ai", 1],
    ["real", 0],
  ]) {
    const dir = join(dataDir, folder);
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!IMAGE_EXT.has(extname(name).toLowerCase())) continue;
      rows.push({ path: join(dir, name), label, name: `${folder}/${name}` });
    }
  }
  return rows;
}

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

async function decodeBoth(path) {
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
  const rgbaCf = rgbToRgba(cropped, box.size, box.size);

  const siglipRaw = await sharp(file)
    .rotate()
    .resize(SIGLIP.size, SIGLIP.size, { kernel: "lanczos3", fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const rgbaSig = rgbToRgba(siglipRaw, SIGLIP.size, SIGLIP.size);

  return {
    bytes: file,
    rgbaCf,
    tensorCf: imageDataToTensor(rgbaCf, box.size, box.size),
    tensorSig: imageDataToSiglipTensor(rgbaSig, SIGLIP.size, SIGLIP.size),
  };
}

async function verifyModel(spec) {
  const path = join(root, "models", spec.filename);
  const buf = await readFile(path);
  const hash = createHash("sha256").update(buf).digest("hex");
  if (hash !== spec.sha256) {
    throw new Error(`${spec.id} SHA-256 mismatch: ${hash}`);
  }
  return { path, hash };
}

async function main() {
  const files = await listLabeled();
  if (files.length < 20) {
    console.error("Not enough proxy images. Run: npm run eval:download");
    process.exit(2);
  }

  const cfSpec = await verifyModel(MODELS.commfor);
  const slSpec = await verifyModel(MODELS.siglip2);
  const cfSess = await ort.InferenceSession.create(cfSpec.path, {
    executionProviders: ["cpu"],
  });
  const slSess = await ort.InferenceSession.create(slSpec.path, {
    executionProviders: ["cpu"],
  });

  const scored = [];
  for (const [index, row] of files.entries()) {
    const { bytes, rgbaCf, tensorCf, tensorSig } = await decodeBoth(row.path);
    const provenance = scanProvenance(bytes);
    const graphic = analyzePixels(rgbaCf, PREPROCESS.crop, PREPROCESS.crop);
    const cfOut = await cfSess.run({
      [MODELS.commfor.inputName]: new ort.Tensor("float32", tensorCf, [1, 3, PREPROCESS.crop, PREPROCESS.crop]),
    });
    const slOut = await slSess.run({
      [MODELS.siglip2.inputName]: new ort.Tensor("float32", tensorSig, [1, 3, SIGLIP.size, SIGLIP.size]),
    });
    const commfor = visualProbabilityFromLogit(Number(cfOut[MODELS.commfor.outputName].data[0]));
    const siglip = siglipProbability(slOut[MODELS.siglip2.outputName].data);
    const visual = blendVisual(siglip, commfor);
    const fused = fuseScores({
      visual,
      provenance,
      graphic,
      config: { ...FUSE_DEFAULTS, bias: 0, temperature: 1 },
    });
    scored.push({
      ...row,
      visual,
      siglip,
      commfor,
      score: fused.fusedBeforeCalibration,
      reasons: fused.reasons,
    });
    if ((index + 1) % 25 === 0 || index === files.length - 1) {
      console.error(`scored ${index + 1}/${files.length}`);
    }
  }

  const shuffled = shuffle(scored, 20260815);
  const splitAt = Math.max(20, Math.floor(shuffled.length * 0.3));
  const calib = shuffled.slice(0, splitAt);
  const test = shuffled.slice(splitAt);

  const best = bestRawThreshold(calib.map((r) => ({ label: r.label, score: r.score })));
  const bias = biasForTarget(best.threshold, EVAL_THRESHOLD);
  const calibratedTest = test.map((row) => ({
    ...row,
    score: applyCalibration(row.score, { bias, temperature: 1 }),
  }));

  const rawTest = summarize(
    test.map((r) => ({ label: r.label, score: r.score })),
    EVAL_THRESHOLD,
  );
  const calTest = summarize(
    calibratedTest.map((r) => ({ label: r.label, score: r.score })),
    EVAL_THRESHOLD,
  );

  const report = {
    models: [MODELS.commfor.id, MODELS.siglip2.id],
    hashes: { commfor: cfSpec.hash, siglip2: slSpec.hash },
    threshold: EVAL_THRESHOLD,
    nTotal: scored.length,
    nCalib: calib.length,
    nTest: test.length,
    calibBestRawThreshold: best,
    fittedBias: bias,
    uncalibratedTest: rawTest,
    calibratedTest: calTest,
    note: "Calibration split is unused for the reported calibratedTest number. OpenFake core/test images were not used to train the SigLIP2 probe.",
  };

  await mkdir(join(root, "eval/results"), { recursive: true });
  await writeFile(join(root, "eval/results/latest.json"), JSON.stringify(report, null, 2));
  await writeFile(
    join(root, "eval/results/fuse.json"),
    JSON.stringify({ ...FUSE_DEFAULTS, bias, temperature: 1 }, null, 2),
  );

  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  console.log("");
  console.log("Grain eval — same ONNX + fusion path as the extension");
  console.log(`Models: ${MODELS.siglip2.id} + ${MODELS.commfor.id}`);
  console.log(`Images: ${scored.length}  calib=${calib.length}  test=${test.length}`);
  console.log(`Calib-optimal raw threshold: ${best.threshold.toFixed(2)} (BA ${pct(best.balancedAccuracy)})`);
  console.log(`Fitted bias so that raw ${best.threshold.toFixed(2)} → ${EVAL_THRESHOLD}`);
  console.log("");
  console.log(`UNCALIBRATED test @ ${EVAL_THRESHOLD}:`);
  console.log(`  balanced accuracy  ${pct(rawTest.balancedAccuracy)}`);
  console.log(`  TPR                ${pct(rawTest.tpr)}`);
  console.log(`  TNR                ${pct(rawTest.tnr)}`);
  console.log("");
  console.log(`CALIBRATED test @ ${EVAL_THRESHOLD}  (reported proxy score):`);
  console.log(`  balanced accuracy  ${pct(calTest.balancedAccuracy)}`);
  console.log(`  TPR                ${pct(calTest.tpr)}`);
  console.log(`  TNR                ${pct(calTest.tnr)}`);
  console.log(`  n                  ${calTest.n} (AI ${calTest.nAi} / real ${calTest.nReal})`);
  console.log("");
  console.log("Wrote eval/results/latest.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
