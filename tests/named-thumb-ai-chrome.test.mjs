import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_GATE_NAMES,
  REQUIRED_THUMB_AI_NAMES,
} from "../eval/chrome/run-named-thumbs.mjs";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import { scoreFromModels } from "../src/score-image.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dumpPath = join(root, "eval/chrome/named-thumb-ai-chrome.json");

describe("chrome-path named compressed-thumb AI dump", () => {
  const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
  const byName = new Map((dump.rows || []).map((row) => [row.name, row]));

  it("is a chrome-path dump, not sharp, and not PR 12", () => {
    assert.equal(dump.path, "chrome-ort-web-named-thumb-ai");
    assert.equal(dump.sharp, false);
    assert.equal(dump.backend, "wasm");
    assert.ok(dump.webgpu);
    assert.match(dump.note, /Not PR 12 holdout/);
    assert.match(dump.note, /Do not train on PR 12/);
  });

  it("covers named thumb-AI fixtures and the Charlesworth / UI gate", () => {
    for (const name of [...REQUIRED_THUMB_AI_NAMES, ...REQUIRED_GATE_NAMES]) {
      assert.ok(byName.has(name), `missing ${name}`);
    }
  });

  it("raises named thumb-AI TPR versus the recorded main baseline", () => {
    const ai = dump.rows.filter((row) => row.role === "thumb-ai");
    assert.ok(ai.length >= 6, `need named thumb-AI rows, got ${ai.length}`);
    const afterTp = ai.filter((row) => row.score >= 0.65).length;
    const baseTp = ai.filter((row) => (dump.baseline.scores[row.name] ?? 0) >= 0.65).length;
    assert.equal(dump.baseline.detector, "dc4b68d");
    assert.ok(afterTp > baseTp, `thumb-AI TP ${baseTp} -> ${afterTp} must rise`);
    assert.ok(dump.after.thumbAiTpr > dump.baseline.thumbAiTpr);
    const theatre = byName.get("q60-250-Theatre_Dopera_Spatial.jpg");
    assert.ok(dump.baseline.scores[theatre.name] < 0.65, "q60 Théâtre was FN on main");
    assert.ok(theatre.score >= 0.65, `q60 Théâtre ${theatre.score} must be TP`);
  });

  it("keeps Charlesworth orig+250 under 0.65 / not 99%", () => {
    for (const name of [
      "Mrs_Winifred_Charlesworth.jpg",
      "250px-Mrs_Winifred_Charlesworth.jpg",
    ]) {
      const row = byName.get(name);
      assert.equal(row.graphic.isGraphic, false, `${name} is film, not a UI graphic`);
      assert.equal(row.graphic.scanGrain, true, `${name} must stay scanGrain`);
      assert.equal(row.graphic.uiCapture, false);
      assert.ok(row.score < 0.65, `${name} ${row.score} must stay < 0.65`);
      assert.ok(row.score < 0.99, `${name} must not return to 0.99`);
      assert.ok(row.reasons.includes("muted-scan"));
    }
    assert.ok(Math.abs(byName.get("Mrs_Winifred_Charlesworth.jpg").score - 0.632695) < 1e-3);
    assert.ok(byName.get("250px-Mrs_Winifred_Charlesworth.jpg").score < 0.65);
  });

  it("keeps Blender / LibreOffice / pie / VLC under 0.65 on the live path", () => {
    for (const name of [
      "Blender_2.92_UI.png",
      "LibreOffice_Writer_7.5.png",
      "simple_pie_chart.png",
      "VLC_UI.png",
    ]) {
      const row = byName.get(name);
      assert.equal(row.graphic.uiCapture, true, `${name} should be uiCapture`);
      assert.ok(row.commfor < 0.01, `${name} CF ${row.commfor} should stay sure-real`);
      assert.ok(row.score < 0.65, `${name} live ${row.score} must stay < 0.65`);
      const hit = scoreFromModels({
        siglip: row.siglip,
        commfor: row.commfor,
        provenance: { ai: false, camera: false },
        graphic: row.graphic,
      });
      assert.ok(hit.score < 0.65, `${name} re-fuse ${hit.score} must stay < 0.65`);
    }
  });

  it("does not edit FUSE_DEFAULTS, graphic-gate, or blendVisual", () => {
    assert.equal(FUSE_DEFAULTS.graphicScaleWhenFlagged, 1);
    assert.equal(FUSE_DEFAULTS.bias, 0);
    assert.equal("uiCaptureDrop" in FUSE_DEFAULTS, false);
    const fuseSrc = readFileSync(join(root, "src/fuse.js"), "utf8");
    const gateSrc = readFileSync(join(root, "src/graphic-gate.js"), "utf8");
    const slSrc = readFileSync(join(root, "src/siglip.js"), "utf8");
    assert.equal(fuseSrc.includes("uiCaptureDrop"), false);
    assert.doesNotMatch(fuseSrc, /compressedThumbLift/);
    assert.match(gateSrc, /const uiCapture = !filmScan && colors\.size < 200 && fineRatio < 0\.2;/);
    assert.match(slSrc, /if \(graphic\?\.uiCapture && b < 0\.01\)/);
    assert.match(slSrc, /if \(a < 0\.25\)/);
  });
});
