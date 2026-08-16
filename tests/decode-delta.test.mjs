import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import { DECODE_PATHS } from "../src/preprocess.js";
import {
  computeDecodeDelta,
  formatDecodeDelta,
  recordedDecodeDelta,
  RECORDED_DECODE_DELTA,
} from "../eval/decode-delta.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

describe("decode-delta", () => {
  it("records the CLAIM.md 1e19a9f pair without inventing scores", () => {
    const recorded = recordedDecodeDelta();
    assert.equal(recorded.kind, "decode-delta");
    assert.equal(recorded.commit, "1e19a9f");
    assert.equal(recorded.sourceOfTruth, "chrome-path");
    assert.equal(recorded.fusePaperOver, false);
    assert.equal(recorded.node.bal_acc_065, 0.872222);
    assert.equal(recorded.node.tpr_065, 0.9);
    assert.equal(recorded.node.tnr_065, 0.844444);
    assert.deepEqual(
      [recorded.node.tp, recorded.node.fn, recorded.node.tn, recorded.node.fp],
      [162, 18, 152, 28],
    );
    assert.equal(recorded.chrome.bal_acc_065, 0.872222);
    assert.equal(recorded.chrome.tpr_065, 0.872222);
    assert.equal(recorded.chrome.tnr_065, 0.872222);
    assert.deepEqual(
      [recorded.chrome.tp, recorded.chrome.fn, recorded.chrome.tn, recorded.chrome.fp],
      [157, 23, 157, 23],
    );
    assert.equal(recorded.delta.bal_acc_065, 0);
    assert.ok(Math.abs(recorded.delta.tpr_065 - (0.872222 - 0.9)) < 1e-9);
    assert.ok(Math.abs(recorded.delta.tnr_065 - (0.872222 - 0.844444)) < 1e-9);
    assert.equal(recorded.delta.tp, -5);
    assert.equal(recorded.delta.fn, 5);
    assert.equal(recorded.delta.tn, 5);
    assert.equal(recorded.delta.fp, -5);
  });

  it("prints a decode-delta block that names chrome as truth", () => {
    const text = formatDecodeDelta(recordedDecodeDelta());
    assert.match(text, /^decode-delta \(node proxy vs chrome-path; chrome is truth\)/m);
    assert.match(text, /not a fuse target — do not paper over in FUSE_DEFAULTS/);
    assert.match(text, /node     BA 0\.872222/);
    assert.match(text, /chrome   BA 0\.872222/);
    assert.match(text, /delta    BA \+?0\.000000/);
  });

  it("computes live decode-delta from summaries and refuses missing sides", () => {
    const live = computeDecodeDelta(
      { balancedAccuracy: 0.88, tpr: 0.87, tnr: 0.89, tp: 157, fn: 23, tn: 160, fp: 20 },
      { balancedAccuracy: 0.87, tpr: 0.9, tnr: 0.84, tp: 162, fn: 18, tn: 151, fp: 29 },
      { label: "unit" },
    );
    assert.equal(live.kind, "decode-delta");
    assert.equal(live.fusePaperOver, false);
    assert.ok(Math.abs(live.delta.bal_acc_065 - 0.01) < 1e-9);
    assert.equal(computeDecodeDelta(null, { balancedAccuracy: 0.8, tpr: 0.8, tnr: 0.8 }), null);
  });

  it("does not paper over decode-delta in fuse.js or FUSE_DEFAULTS", () => {
    const fuse = read("src/fuse.js");
    assert.doesNotMatch(fuse, /decode-delta|decodeDelta|sharp|createImageBitmap|onnxruntime-node/);
    assert.equal(FUSE_DEFAULTS.bias, 0);
    assert.equal(FUSE_DEFAULTS.temperature, 0.9);
    assert.equal(FUSE_DEFAULTS.mutedScanDrop, 0.36);
  });

  it("node eval uses scoreFromModels after sharp and prints decode-delta", () => {
    const run = read("eval/run.mjs");
    assert.match(run, /scoreFromModels/);
    assert.match(run, /NODE_SHARP_RESAMPLE/);
    assert.match(run, /formatDecodeDelta/);
    assert.match(run, /NODE PROXY/);
    assert.doesNotMatch(run, /blendVisual\s*\(/);
    assert.doesNotMatch(run, /fuseScores\s*\(/);
  });

  it("chrome eval prints decode-delta and does not treat NODE_REF as a fuse target", () => {
    const chrome = read("eval/chrome/run.mjs");
    assert.match(chrome, /formatDecodeDelta/);
    assert.match(chrome, /recordedDecodeDelta/);
    assert.match(chrome, /decode-delta/);
    assert.doesNotMatch(chrome, /NODE_REF/);
    assert.doesNotMatch(chrome, /nodeReference/);
  });

  it("SCORE-CONTRACT names decode-delta and forbids fuse paper-over", () => {
    const contract = read("SCORE-CONTRACT.md");
    assert.match(contract, /decode-delta/);
    assert.match(contract, /Do not absorb it in `FUSE_DEFAULTS`/);
    assert.equal(DECODE_PATHS.sourceOfTruth, "chrome-path");
  });

  it("eval decode notes keep the recorded pair and reject fuse paper-over", () => {
    const notes = read("eval/DECODE.md");
    assert.match(notes, /decode-delta/);
    assert.match(notes, /1e19a9f/);
    assert.match(notes, /162\/18\/152\/28/);
    assert.match(notes, /157\/23\/157\/23/);
    assert.match(notes, /Do not absorb it in `FUSE_DEFAULTS`/);
    assert.match(notes, /Do not add mix nips/);
    assert.match(notes, /Train on PR 12/);
    assert.equal(RECORDED_DECODE_DELTA.source, "CLAIM.md");
  });
});
