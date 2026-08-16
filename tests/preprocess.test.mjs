import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scaledSize,
  centerCropBox,
  shouldAnalyzeDimensions,
  imageDataToTensor,
  visualProbabilityFromLogit,
  PREPROCESS,
  CANVAS_RESAMPLE,
  NODE_SHARP_RESAMPLE,
  DECODE_PATHS,
  applyCanvasResample,
  isBelowShortEdge,
  letterboxBox,
  imagenetPadCss,
} from "../src/preprocess.js";

describe("preprocess", () => {
  it("resizes the shorter edge to 440 while keeping aspect ratio", () => {
    const s = scaledSize(800, 600, 440);
    assert.equal(s.height, 440);
    assert.equal(s.width, Math.round(800 * (440 / 600)));
  });

  it("center-crops a 384 square", () => {
    const box = centerCropBox(586, 440, 384);
    assert.equal(box.size, 384);
    assert.equal(box.x, Math.floor((586 - 384) / 2));
    assert.equal(box.y, Math.floor((440 - 384) / 2));
  });

  it("skips tiny tracking pixels", () => {
    assert.equal(shouldAnalyzeDimensions(1, 1), false);
    assert.equal(shouldAnalyzeDimensions(63, 400), false);
    assert.equal(shouldAnalyzeDimensions(64, 64), true);
  });

  it("emits a 1x3x384x384 ImageNet-normalized NCHW tensor", () => {
    const n = 384 * 384;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 0;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = 255;
    }
    const tensor = imageDataToTensor(rgba, 384, 384);
    assert.equal(tensor.length, 3 * n);
    const expectedR = (1 - PREPROCESS.mean[0]) / PREPROCESS.std[0];
    const expectedG = (0 - PREPROCESS.mean[1]) / PREPROCESS.std[1];
    assert.ok(Math.abs(tensor[0] - expectedR) < 1e-5);
    assert.ok(Math.abs(tensor[n] - expectedG) < 1e-5);
  });

  it("applies the shared canvas resample settings", () => {
    const ctx = { imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
    applyCanvasResample(ctx, "commfor");
    assert.equal(ctx.imageSmoothingEnabled, CANVAS_RESAMPLE.commfor.imageSmoothingEnabled);
    assert.equal(ctx.imageSmoothingQuality, CANVAS_RESAMPLE.commfor.imageSmoothingQuality);
    applyCanvasResample(ctx, "siglip");
    assert.equal(ctx.imageSmoothingEnabled, CANVAS_RESAMPLE.siglip.imageSmoothingEnabled);
  });

  it("names chrome-path as truth and node sharp as the proxy decode", () => {
    assert.equal(DECODE_PATHS.sourceOfTruth, "chrome-path");
    assert.equal(DECODE_PATHS.deltaName, "decode-delta");
    assert.match(DECODE_PATHS.chrome, /createImageBitmap/);
    assert.match(DECODE_PATHS.node, /sharp/);
    assert.equal(NODE_SHARP_RESAMPLE.commfor.kernel, "cubic");
    assert.equal(NODE_SHARP_RESAMPLE.siglip.kernel, "lanczos3");
    assert.notEqual(CANVAS_RESAMPLE.siglip.imageSmoothingEnabled, true);
  });

  it("medium-smooths Community Forensics and nearest-neighbors SigLIP", () => {
    const cf = { imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
    applyCanvasResample(cf, "commfor");
    assert.equal(cf.imageSmoothingEnabled, true);
    assert.equal(cf.imageSmoothingQuality, "medium");

    const sl = { imageSmoothingEnabled: true, imageSmoothingQuality: "high" };
    applyCanvasResample(sl, "siglip");
    assert.equal(sl.imageSmoothingEnabled, false);
  });

  it("names skipUpsample when the source short edge is below the CF / SigLIP canvas", () => {
    assert.equal(isBelowShortEdge(250, 197, PREPROCESS.resizeShortEdge), true);
    assert.equal(isBelowShortEdge(250, 167, 224), true);
    assert.equal(isBelowShortEdge(250, 339, 224), false);
    assert.equal(isBelowShortEdge(470, 638, PREPROCESS.resizeShortEdge), false);
    assert.equal(isBelowShortEdge(652, 515, PREPROCESS.resizeShortEdge), false);
    assert.equal(isBelowShortEdge(440, 600, PREPROCESS.resizeShortEdge), false);
  });

  it("letterboxes small sources without scaling up", () => {
    const duke = letterboxBox(250, 197, 384);
    assert.equal(duke.scale, 1);
    assert.equal(duke.width, 250);
    assert.equal(duke.height, 197);
    assert.equal(duke.x, Math.floor((384 - 250) / 2));
    assert.equal(duke.y, Math.floor((384 - 197) / 2));

    const sl = letterboxBox(250, 197, 224);
    assert.ok(sl.scale <= 1);
    assert.equal(sl.width, 224);
    assert.equal(sl.height, Math.round(197 * (224 / 250)));
    assert.equal(sl.x, 0);

    const charlesworthOrig = letterboxBox(470, 638, 384);
    assert.ok(charlesworthOrig.scale < 1);
    assert.equal(charlesworthOrig.height, 384);
  });

  it("fills CF pad with ImageNet mean, not black", () => {
    assert.equal(imagenetPadCss(), "rgb(124, 116, 104)");
  });

  it("converts a logit to a probability with sigmoid", () => {
    assert.ok(visualProbabilityFromLogit(0) === 0.5);
    assert.ok(visualProbabilityFromLogit(6.753) > 0.99);
    assert.ok(visualProbabilityFromLogit(-6.7) < 0.01);
  });
});
