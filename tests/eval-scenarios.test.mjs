import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isBroaderProxy, isOfficialProxy, proxyKind } from "../src/eval-set.js";
import {
  MIN_PER_CATEGORY,
  REQUIRED_CATEGORIES,
  assertScenarioManifest,
  countByCategory,
  loadScenarioManifest,
  numericLabel,
  repoRoot,
  scenarioRows,
} from "../eval/chrome/scenarios.mjs";

const USED_PICSUM = new Set([
  237, 1015, 1025, 1035, 1043, 1062, 1074, 1084, 129, 201, 292, 338, 349, 365, 433, 452,
  494, 548, 582, 593, 10, 15, 28, 42, 57, 64, 76, 83, 91, 111, 122, 133, 146, 157, 164,
  177, 188, 196, 203, 211, 224, 231, 248, 256, 267, 274, 281, 287, 301, 312,
]);

const REAL_ONLY = new Set([
  "historic_scan_bw",
  "historic_scan_color",
  "wiki_web_real",
  "phone_web_real",
  "social_reddit_real",
  "gen_holdout_real",
]);

const AI_ONLY = new Set([
  "social_reddit_ai",
  "gen_holdout_ai",
  "ai_photoreal",
  "ai_illustrated",
]);

describe("scenario holdout manifest", () => {
  it("has every required category at >=10 or an UNVERIFIED gap", async () => {
    const manifest = await loadScenarioManifest();
    assertScenarioManifest(manifest);
    const rows = scenarioRows(manifest);
    const counts = countByCategory(rows);
    for (const cat of REQUIRED_CATEGORIES) {
      const unverified = (manifest.unverified || []).some((g) => g.category === cat);
      if (!unverified) assert.ok(counts[cat] >= MIN_PER_CATEGORY, cat);
    }
    assert.equal(REQUIRED_CATEGORIES.length, 12);
  });

  it("requires id, path, label, category, source_url, license, attribution, notes", async () => {
    const manifest = await loadScenarioManifest();
    for (const img of manifest.images) {
      for (const key of [
        "id",
        "path",
        "label",
        "category",
        "source_url",
        "license",
        "attribution",
        "notes",
      ]) {
        assert.ok(img[key], `${img.id} missing ${key}`);
      }
      assert.ok(img.label === "ai" || img.label === "real", img.id);
      assert.ok(img.path.startsWith("scenarios/"), img.id);
      assert.equal(numericLabel(img.label) === 1, img.label === "ai");
    }
  });

  it("includes the Charlesworth 1910s Golden Retriever photo as REAL", async () => {
    const manifest = await loadScenarioManifest();
    const row = manifest.images.find((img) => img.id === "historic_scan_bw_00");
    assert.ok(row);
    assert.equal(row.label, "real");
    assert.equal(row.category, "historic_scan_bw");
    assert.match(row.source_url, /Mrs_Winifred_Charlesworth/);
    assert.match(row.notes, /Charlesworth/);
  });

  it("keeps historic / wiki / phone / unused-reddit-real as REAL only", async () => {
    const manifest = await loadScenarioManifest();
    for (const img of manifest.images) {
      if (REAL_ONLY.has(img.category)) assert.equal(img.label, "real", img.id);
      if (AI_ONLY.has(img.category)) assert.equal(img.label, "ai", img.id);
    }
  });

  it("marks compressed thumbs with derived_from and original ids", async () => {
    const manifest = await loadScenarioManifest();
    const thumbs = manifest.images.filter((img) => img.category === "compressed_thumb");
    assert.ok(thumbs.length >= 10);
    const ids = new Set(manifest.images.map((img) => img.id));
    for (const img of thumbs) {
      assert.ok(img.derived_from, img.id);
      assert.ok(ids.has(img.derived_from), img.derived_from);
      assert.equal(img.download?.kind, "derive");
      const side = img.download.max_side;
      assert.ok(side >= 250 && side <= 400, img.id);
      assert.equal(img.download.quality, 60);
    }
  });

  it("does not reuse Picsum IDs from the 360/358 mix", async () => {
    const manifest = await loadScenarioManifest();
    for (const img of manifest.images) {
      if (img.download?.kind !== "picsum") continue;
      assert.equal(USED_PICSUM.has(img.download.id), false, `picsum ${img.download.id}`);
    }
  });

  it("keeps OpenFake slices past the 360 prefix and the 358 ofhold/ofreddit windows", async () => {
    const manifest = await loadScenarioManifest();
    for (const img of manifest.images) {
      const dl = img.download || {};
      if (dl.kind !== "openfake" && dl.kind !== "openfake-filter") continue;
      if (img.category === "social_reddit_real") {
        assert.equal(dl.config, "reddit");
        assert.ok(dl.skip >= 90, img.id);
      }
      if (img.category === "social_reddit_ai") {
        assert.equal(dl.config, "reddit");
        assert.ok(dl.skip >= 120, img.id);
      }
      if (img.category === "gen_holdout_ai" || img.category === "gen_holdout_real") {
        assert.equal(dl.config, "core");
        assert.ok(dl.skip >= 240, img.id);
      }
      if (img.category === "ai_photoreal" || img.category === "ai_illustrated") {
        assert.equal(dl.config, "core");
        assert.ok(dl.skip >= 252, img.id);
        assert.ok(dl.filter);
      }
    }
  });

  it("is not the official 360 or the 358 broader proxy", async () => {
    const manifest = await loadScenarioManifest();
    for (const img of manifest.images) {
      assert.equal(isOfficialProxy(img.path), false, img.id);
      assert.equal(isBroaderProxy(img.path), false, img.id);
      assert.equal(proxyKind(img.path), "other");
    }
    assert.match(manifest.note, /not a KEEP scalar/i);
    assert.match(manifest.note, /Kenny/i);
  });

  it("does not embed detector image-content hashes", async () => {
    const raw = await readFile(
      join(repoRoot(), "eval/data/manifest-scenarios.json"),
      "utf8",
    );
    assert.equal(/[a-f0-9]{64}/i.test(raw), false);
  });

  it("labels screenshot_ui rows honestly as ai or real", async () => {
    const manifest = await loadScenarioManifest();
    const rows = manifest.images.filter((img) => img.category === "screenshot_ui");
    assert.ok(rows.some((r) => r.label === "real"));
    assert.ok(rows.some((r) => r.label === "ai"));
    for (const row of rows) {
      assert.ok(/graphic-gate|AI-generated|Labeled AI/i.test(row.notes), row.id);
    }
  });
});
