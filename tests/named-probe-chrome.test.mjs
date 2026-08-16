import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_PROBE_NAMES } from "../eval/chrome/run-named-probe.mjs";
import { fuseScores, FUSE_DEFAULTS } from "../src/fuse.js";

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

  it("re-fuses published chrome visuals: Charlesworth stays, uiCapture is scaled", () => {
    assert.equal(FUSE_DEFAULTS.graphicScaleWhenFlagged, 0.72);
    for (const name of [
      "Mrs_Winifred_Charlesworth.jpg",
      "250px-Mrs_Winifred_Charlesworth.jpg",
    ]) {
      const row = byName.get(name);
      const fused = fuseScores({
        visual: row.visual,
        provenance: { ai: false, camera: false },
        graphic: row.graphic,
      });
      assert.ok(Math.abs(fused.score - row.score) < 1e-9, `${name} must stay the chrome-path freeze`);
      assert.equal(fused.reasons.includes("graphic-gate"), false);
    }
    const blender = byName.get("Blender_2.92_UI.png");
    const scaled = fuseScores({
      visual: blender.visual,
      provenance: { ai: false, camera: false },
      graphic: blender.graphic,
    });
    assert.ok(scaled.fusedBeforeCalibration < blender.visual);
    assert.ok(scaled.reasons.includes("graphic-gate"));
    assert.ok(scaled.score < blender.score);
  });
});
