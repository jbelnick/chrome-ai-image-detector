import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_PROBE_NAMES } from "../eval/chrome/run-named-probe.mjs";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import { scoreFromModels } from "../src/score-image.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dumpPath = join(root, "eval/chrome/named-probe-chrome.json");

describe("chrome-path named-probe dump", () => {
  const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
  const byName = new Map((dump.rows || []).map((row) => [row.name, row]));

  it("is a chrome-path dump, not sharp", () => {
    assert.equal(dump.path, "chrome-ort-web-named-probe");
    assert.equal(dump.sharp, false);
    assert.equal(dump.backend, "wasm");
    assert.ok(dump.webgpu);
    assert.notEqual(dump.path, "sharp");
  });

  it("covers the required film and UI list", () => {
    for (const name of REQUIRED_PROBE_NAMES) {
      assert.ok(byName.has(name), `missing ${name}`);
    }
  });

  it("keeps Charlesworth isGraphic false / scanGrain true and not 0.99", () => {
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
      assert.equal(row.reasons.includes("graphic-gate"), false);
    }
    assert.ok(Math.abs(byName.get("Mrs_Winifred_Charlesworth.jpg").score - 0.632695) < 1e-3);
    assert.ok(Math.abs(byName.get("250px-Mrs_Winifred_Charlesworth.jpg").score - 0.634229) < 1e-3);
  });

  it("flags the named UI and chart probes as isGraphic", () => {
    for (const name of [
      "Blender_2.92_UI.png",
      "Inkscape_UI.png",
      "LibreOffice_Writer_7.5.png",
      "VLC_UI.png",
      "CO2_line_chart.png",
      "DOE_org_chart.png",
      "simple_pie_chart.png",
    ]) {
      const row = byName.get(name);
      assert.equal(row.graphic.isGraphic, true, `${name} should be isGraphic`);
      assert.equal(row.graphic.scanGrain, false, `${name} is not film`);
      assert.equal(row.graphic.uiCapture, true, `${name} should be uiCapture`);
      assert.ok(row.reasons.includes("graphic-gate"), `${name} should trip graphic-gate`);
    }
  });

  it("does not edit FUSE_DEFAULTS bands or add uiCaptureDrop", () => {
    assert.equal(FUSE_DEFAULTS.graphicScaleWhenFlagged, 1);
    assert.equal(FUSE_DEFAULTS.bias, 0);
    assert.equal("uiCaptureDrop" in FUSE_DEFAULTS, false);
    const fuseSrc = readFileSync(join(root, "src/fuse.js"), "utf8");
    assert.equal(fuseSrc.includes("uiCaptureDrop"), false);
    const gateSrc = readFileSync(join(root, "src/graphic-gate.js"), "utf8");
    assert.match(gateSrc, /const uiCapture = !filmScan && colors\.size < 200 && fineRatio < 0\.2;/);
  });
});

describe("named-probe re-fuse after UI CF veto", () => {
  const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
  const byName = new Map((dump.rows || []).map((row) => [row.name, row]));

  function scoreDumpRow(name) {
    const row = byName.get(name);
    return scoreFromModels({
      siglip: row.siglip,
      commfor: row.commfor,
      provenance: { ai: false, camera: false },
      graphic: row.graphic,
    });
  }

  it("keeps Charlesworth orig 0.632695 and thumb 0.634229 (rule does not fire on film)", () => {
    const orig = scoreDumpRow("Mrs_Winifred_Charlesworth.jpg");
    const thumb = scoreDumpRow("250px-Mrs_Winifred_Charlesworth.jpg");
    assert.equal(byName.get("Mrs_Winifred_Charlesworth.jpg").graphic.uiCapture, false);
    assert.equal(byName.get("250px-Mrs_Winifred_Charlesworth.jpg").graphic.uiCapture, false);
    assert.ok(byName.get("Mrs_Winifred_Charlesworth.jpg").commfor > 0.01);
    assert.ok(Math.abs(orig.score - 0.632695) < 1e-3);
    assert.ok(Math.abs(thumb.score - 0.634229) < 1e-3);
    assert.ok(orig.score < 0.65);
    assert.ok(thumb.score < 0.65);
  });

  it("puts Blender, LibreOffice, pie, and VLC under 0.65", () => {
    for (const name of [
      "Blender_2.92_UI.png",
      "LibreOffice_Writer_7.5.png",
      "simple_pie_chart.png",
      "VLC_UI.png",
    ]) {
      const row = byName.get(name);
      const hit = scoreDumpRow(name);
      assert.equal(row.graphic.uiCapture, true, `${name} should be uiCapture`);
      assert.ok(row.commfor < 0.01, `${name} CF ${row.commfor} should be sure-real`);
      assert.ok(hit.score < 0.65, `${name} re-fuse ${hit.score} must be < 0.65`);
    }
  });

  it("does not walk Inkscape from under 0.65 to over 0.65", () => {
    const dumpScore = byName.get("Inkscape_UI.png").score;
    assert.ok(dumpScore < 0.65, `Inkscape dump ${dumpScore} should start < 0.65`);
    const hit = scoreDumpRow("Inkscape_UI.png");
    assert.ok(hit.score < 0.65, `Inkscape re-fuse ${hit.score} must stay < 0.65`);
  });

  it("keeps PR 14 DALL·E / Midjourney illustration dumps AI", () => {
    // Chrome-path sl/cf/palette copied from PR 14 CLAIM dump — not invented.
    const illustrations = [
      {
        name: "ai_dalle_shiba",
        siglip: 0.922,
        commfor: 0.936,
        graphic: { uiCapture: false, isGraphic: false, uniqueColors: 179, fineRatio: 0.357 },
      },
      {
        name: "ai_dalle_astronaut",
        siglip: 0.786,
        commfor: 1.0,
        graphic: { uiCapture: false, isGraphic: false, uniqueColors: 168, fineRatio: 0.31 },
      },
      {
        name: "ai_midjourney_castle",
        siglip: 0.93,
        commfor: 0.009,
        graphic: { uiCapture: false, isGraphic: false, uniqueColors: 312, fineRatio: 0.347 },
      },
    ];
    for (const row of illustrations) {
      assert.equal(row.graphic.uiCapture, false, `${row.name} is painterly, not uiCapture`);
      assert.ok(row.graphic.fineRatio >= 0.2 || row.graphic.uniqueColors >= 200);
      const hit = scoreFromModels({
        siglip: row.siglip,
        commfor: row.commfor,
        provenance: { ai: false, camera: false },
        graphic: row.graphic,
      });
      assert.ok(hit.score >= 0.65, `${row.name} re-fuse ${hit.score} must stay AI`);
    }
  });
});
