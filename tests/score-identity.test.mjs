import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import {
  chromeEvalPath,
  overlayPath,
  scoreImage,
} from "../src/score-image.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function fakeBitmap(width = 440, height = 440) {
  return { width, height, close() {} };
}

class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "medium",
      drawImage() {},
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i += 1) {
          data[i * 4] = 120;
          data[i * 4 + 1] = 118;
          data[i * 4 + 2] = 116;
          data[i * 4 + 3] = 255;
        }
        return { data, width, height };
      },
    };
  }
}

const decodeSeam = {
  createBitmap: async () => fakeBitmap(),
  Canvas: FakeCanvas,
  runVisual: async () => ({ siglip: 0.867, commfor: 0.225 }),
};

/** Same option bag as extension/offscreen.js inferBytes. */
function overlayOpts(mime = "image/jpeg") {
  return {
    mime,
    cfSession: { id: "overlay-cf" },
    slSession: { id: "overlay-sl" },
    config: { ...FUSE_DEFAULTS },
    ...decodeSeam,
  };
}

/** Same option bag as eval/chrome/page.js inferBytes. */
function chromeEvalOpts(mime = "image/jpeg") {
  return {
    mime,
    cfSession: { id: "eval-cf" },
    slSession: { id: "eval-sl" },
    config: { ...FUSE_DEFAULTS },
    ...decodeSeam,
  };
}

describe("score identity", () => {
  it("exports one infer: overlayPath === chromeEvalPath === scoreImage", () => {
    assert.equal(overlayPath, scoreImage);
    assert.equal(chromeEvalPath, scoreImage);
    assert.equal(overlayPath, chromeEvalPath);
  });

  it("overlay and chrome-eval both call scoreImage(bytes)", () => {
    const offscreen = read("extension/offscreen.js");
    const page = read("eval/chrome/page.js");
    assert.match(offscreen, /import\s*\{\s*scoreImage\s*\}\s*from\s*["'].*score-image\.js["']/);
    assert.match(page, /import\s*\{\s*scoreImage\s*\}\s*from\s*["'].*score-image\.js["']/);
    assert.match(offscreen, /scoreImage\(\s*bytes\s*,/);
    assert.match(page, /scoreImage\(\s*bytes\s*,/);
    assert.doesNotMatch(offscreen, /fuseScores\s*\(/);
    assert.doesNotMatch(page, /fuseScores\s*\(/);
    assert.doesNotMatch(offscreen, /blendVisual\s*\(/);
    assert.doesNotMatch(page, /blendVisual\s*\(/);
    assert.doesNotMatch(offscreen, /analyzePixels\s*\(/);
    assert.doesNotMatch(page, /analyzePixels\s*\(/);
  });

  it("overlay-path(B) === chrome-eval(B) for the same file bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);
    const overlay = await overlayPath(bytes, overlayOpts());
    const evaled = await chromeEvalPath(bytes, chromeEvalOpts());
    assert.equal(overlay.score, evaled.score);
    assert.equal(overlay.visual, evaled.visual);
    assert.equal(overlay.siglip, evaled.siglip);
    assert.equal(overlay.commfor, evaled.commfor);
    assert.deepEqual(overlay.reasons, evaled.reasons);
    assert.equal(Object.is(overlay.score, evaled.score), true);
  });

  it("fails closed if one path stops using scoreImage on those bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 9, 8, 7, 6]);
    const overlay = await overlayPath(bytes, overlayOpts());
    const drifted = await scoreImage(bytes, {
      ...chromeEvalOpts(),
      runVisual: async () => ({ siglip: 0.1, commfor: 0.9 }),
    });
    assert.notEqual(overlay.score, drifted.score);
  });

  it("letterboxes a short-edge-below-440 source for CF and keeps the 440 crop for graphic flags", async () => {
    const draws = [];
    class RecordCanvas {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        const canvas = this;
        const ctx = {
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "medium",
          fillStyle: "",
          fillRect() {},
          drawImage(_img, ...rest) {
            draws.push({
              w: canvas.width,
              h: canvas.height,
              destW: rest.length >= 7 ? rest[6] : rest[2],
              destH: rest.length >= 7 ? rest[7] : rest[3],
            });
          },
          getImageData(_x, _y, width, height) {
            const data = new Uint8ClampedArray(width * height * 4);
            return { data, width, height };
          },
        };
        return ctx;
      }
    }
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 2, 2, 2, 2]);
    await scoreImage(bytes, {
      ...overlayOpts(),
      createBitmap: async () => fakeBitmap(250, 197),
      Canvas: RecordCanvas,
    });
    const cf = draws.filter((row) => row.w !== 224);
    assert.equal(cf.length, 2, "graphic recipe crop plus skip-upsample CF crop");
    assert.equal(cf[0].w, 558, "graphic flags stay on the 440 short-edge recipe (250×197 → 558×440)");
    assert.equal(cf[0].h, 440);
    assert.equal(cf[1].w, 384, "CF model canvas is letterboxed 384, not a 440/640 stretch");
    assert.equal(cf[1].destW, 250);
    assert.equal(cf[1].destH, 197);
    const sl = draws.filter((row) => row.w === 224);
    assert.equal(sl.length, 1);
    assert.equal(sl[0].destW, 224);
    assert.ok(sl[0].destH < 224, "SigLIP letterboxes the 197-tall thumb instead of stretching height");
  });

  it("does not take skipUpsample on Charlesworth-orig sized sources", async () => {
    const draws = [];
    class RecordCanvas {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        const canvas = this;
        const ctx = {
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "medium",
          fillStyle: "",
          fillRect() {},
          drawImage() {
            draws.push({ w: canvas.width, h: canvas.height });
          },
          getImageData(_x, _y, width, height) {
            const data = new Uint8ClampedArray(width * height * 4);
            return { data, width, height };
          },
        };
        return ctx;
      }
    }
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 3, 3, 3, 3]);
    await scoreImage(bytes, {
      ...overlayOpts(),
      createBitmap: async () => fakeBitmap(470, 638),
      Canvas: RecordCanvas,
    });
    const cf = draws.filter((row) => row.w !== 224);
    assert.equal(cf.length, 1);
    assert.equal(cf[0].w, 440, "470×638 short-edge recipe stays 440, not a 384 letterbox");
    assert.equal(cf[0].h, 597);
  });
});
