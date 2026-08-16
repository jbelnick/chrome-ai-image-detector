import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import { analyzePixels } from "../src/graphic-gate.js";
import { isBroaderProxy, isOfficialProxy, proxyKind } from "../src/eval-set.js";
import { PRODUCT_THRESHOLD } from "../src/score-image.js";
import { PREPROCESS, centerCropBox, scaledSize } from "../src/preprocess.js";
import {
  assertShipGateManifest,
  assertShipGateScores,
  charlesworthFromFreeze,
  charlesworthWithoutScan,
  freezeRows,
  loadShipGateManifest,
  nousFromFreeze,
  shipGateVerdict,
} from "../src/ship-gate.js";
import { listProxyImages, repoRoot } from "../eval/chrome/list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function fixturePath(img) {
  return join(root, "eval/data", img.path);
}

async function commforCropRgba(absPath) {
  const meta = await sharp(absPath).metadata();
  const { width, height } = scaledSize(meta.width, meta.height);
  const box = centerCropBox(width, height, PREPROCESS.crop);
  const { data } = await sharp(absPath)
    .resize(width, height)
    .extract({ left: box.x, top: box.y, width: box.size, height: box.size })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: box.size, height: box.size };
}

describe("ship-gate fixtures", () => {
  const manifest = loadShipGateManifest(root);

  it("lists Charlesworth orig+250, Nous 1870s 250, and two ordinary wiki reals", () => {
    assertShipGateManifest(manifest);
    assert.equal(manifest.images.length, 5);
    assert.equal(manifest.threshold, 0.65);
  });

  it("never labels ship-gate or PR 12 holdout paths as the 360/358 mix", () => {
    for (const img of manifest.images) {
      assert.equal(proxyKind(img.path), "ship-gate");
      assert.equal(isOfficialProxy(img.path), false);
      assert.equal(isBroaderProxy(img.path), false);
    }
    assert.equal(proxyKind("eval/data/scenarios/historic_scan_bw/historic_scan_bw_00.jpg"), "scenario-holdout");
    assert.equal(isBroaderProxy("eval/data/scenarios/historic_scan_bw/historic_scan_bw_00.jpg"), false);
    assert.equal(isOfficialProxy("eval/data/scenarios/historic_scan_bw/historic_scan_bw_00.jpg"), false);
    assert.equal(proxyKind("eval/data/holdout-grade-only.json"), "other");
  });

  it("keeps listProxyImages off the ship-gate folder (358 mix stays closed)", async () => {
    const rows = await listProxyImages(join(root, "eval/data"));
    assert.equal(
      rows.some((r) => r.name.includes("shipgate_") || r.name.includes("ship-gate/")),
      false,
    );
    assert.equal(
      rows.some((r) => r.name.includes("scenarios/") || r.name.includes("holdout-grade")),
      false,
    );
  });
});

describe("ship-gate accept/reject", () => {
  const manifest = loadShipGateManifest(root);

  it("uses the locked 0.65 product cut and does not edit FUSE_DEFAULTS", () => {
    assert.equal(PRODUCT_THRESHOLD, 0.65);
    assert.equal(FUSE_DEFAULTS.bias, 0);
    assert.equal(FUSE_DEFAULTS.mutedScanDrop, 0.36);
    assert.equal(FUSE_DEFAULTS.mutedScanBandMin, 0.955);
    assert.equal(FUSE_DEFAULTS.mutedScanBandMax, 1);
    const src = readFileSync(join(root, "src/fuse.js"), "utf8");
    assert.match(src, /mutedScanDrop: 0\.36/);
  });

  it("re-fuses the PR 11 Charlesworth dump below 0.65 and not 0.99", () => {
    const orig = manifest.images.find((img) => img.id === "charlesworth_orig");
    const thumb = manifest.images.find((img) => img.id === "charlesworth_250");
    const origHit = charlesworthFromFreeze(orig.chrome_path_freeze);
    const thumbHit = charlesworthFromFreeze(thumb.chrome_path_freeze);
    assert.ok(origHit.score < 0.65, `Charlesworth orig ${origHit.score} must stay < 0.65`);
    assert.ok(thumbHit.score < 0.65, `Charlesworth 250 ${thumbHit.score} must stay < 0.65`);
    assert.ok(origHit.score < 0.99);
    assert.ok(thumbHit.score < 0.99);
    assert.ok(origHit.reasons.includes("muted-scan"));
    assert.ok(thumbHit.reasons.includes("muted-scan"));
    assert.ok(Math.abs(origHit.score - orig.chrome_path_freeze.score) < 1e-3);
    assert.ok(Math.abs(thumbHit.score - thumb.chrome_path_freeze.score) < 1e-3);
  });

  it("fails if muted-scan is gone and Charlesworth returns to AI 99%", () => {
    const orig = manifest.images.find((img) => img.id === "charlesworth_orig");
    const miss = charlesworthWithoutScan(orig.chrome_path_freeze);
    assert.ok(miss.score >= 0.99, `no-scan Charlesworth should be the recorded 0.99 miss, got ${miss.score}`);
    assert.equal(miss.reasons.includes("muted-scan"), false);
    const verdict = shipGateVerdict({ id: orig.id, role: "charlesworth", score: miss.score });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /Charlesworth/);
  });

  it("keeps the PR 11 Nous 1870s 250px freeze real", () => {
    const nous = manifest.images.find((img) => img.id === "nous_1870s_250");
    assert.ok(nous.chrome_path_freeze.score < 0.65);
    assert.equal(nous.chrome_path_freeze.score, 0.322159);
    const fused = nousFromFreeze(nous.chrome_path_freeze);
    assert.ok(fused.score < 0.65, `Nous ${fused.score} must stay real`);
    assert.ok(Math.abs(fused.score - 0.322159) < 1e-6);
    assert.equal(fused.reasons.includes("muted-scan"), false);
    const flip = shipGateVerdict({ id: nous.id, role: "nous", score: 0.99 });
    assert.equal(flip.ok, false);
    assert.match(flip.reason, /Nous/);
  });

  it("fails closed when freeze rows are pushed over the cut", () => {
    const rows = freezeRows(manifest);
    assertShipGateScores(rows);
    const broken = rows.map((row) =>
      row.role === "charlesworth" ? { ...row, score: 0.993 } : row,
    );
    assert.throws(() => assertShipGateScores(broken), /SHIP GATE FAIL/);
    const nousFlip = rows.map((row) => (row.role === "nous" ? { ...row, score: 0.7 } : row));
    assert.throws(() => assertShipGateScores(nousFlip), /Nous/);
  });
});

describe("ship-gate fixture pixels", () => {
  const manifest = loadShipGateManifest(root);

  it("flags Charlesworth orig+250 scan-grain when the JPEGs are on disk", async () => {
    const needed = manifest.images.filter((img) => img.role === "charlesworth");
    if (needed.some((img) => !existsSync(fixturePath(img)))) {
      assert.fail("ship-gate Charlesworth JPEGs missing. Run: npm run eval:download:ship-gate");
    }
    for (const img of needed) {
      const crop = await commforCropRgba(fixturePath(img));
      const graphic = analyzePixels(crop.data, crop.width, crop.height);
      assert.equal(graphic.muted, true, `${img.id} should be muted`);
      assert.ok(graphic.fineRatio >= 0.4, `${img.id} fineRatio ${graphic.fineRatio}`);
      assert.equal(graphic.isGraphic, false, `${img.id} is film, not a UI graphic`);
      assert.equal(graphic.scanGrain, true, `${img.id} must stay scanGrain or Charlesworth returns to 99%`);
    }
  });

  it("does not treat Nous 1870s 250px as the Charlesworth scan-grain trap", async () => {
    const nous = manifest.images.find((img) => img.id === "nous_1870s_250");
    if (!existsSync(fixturePath(nous))) {
      assert.fail("ship-gate Nous JPEG missing. Run: npm run eval:download:ship-gate");
    }
    const crop = await commforCropRgba(fixturePath(nous));
    const graphic = analyzePixels(crop.data, crop.width, crop.height);
    assert.equal(graphic.scanGrain, false);
    const fused = nousFromFreeze(nous.chrome_path_freeze);
    assert.ok(fused.score < PRODUCT_THRESHOLD);
  });
});
