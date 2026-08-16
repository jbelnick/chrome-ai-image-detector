/**
 * Diagnostic scenario holdout listing.
 * Disjoint from the official 360 and the 358 broader proxy.
 * Not a KEEP scalar.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CATEGORIES = [
  "historic_scan_bw",
  "historic_scan_color",
  "wiki_web_real",
  "phone_web_real",
  "social_reddit_real",
  "social_reddit_ai",
  "gen_holdout_ai",
  "gen_holdout_real",
  "screenshot_ui",
  "compressed_thumb",
  "ai_photoreal",
  "ai_illustrated",
];

export const MIN_PER_CATEGORY = 10;

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function manifestPathFromRoot(root) {
  return join(root, "eval/data/manifest-scenarios.json");
}

export function dataDirFromRoot(root) {
  return join(root, "eval/data");
}

export async function loadScenarioManifest(root = repoRoot()) {
  const raw = JSON.parse(await readFile(manifestPathFromRoot(root), "utf8"));
  if (!raw || !Array.isArray(raw.images)) {
    throw new Error("eval/data/manifest-scenarios.json missing images[]");
  }
  return raw;
}

export function numericLabel(label) {
  if (label === 1 || label === "ai") return 1;
  if (label === 0 || label === "real") return 0;
  throw new Error(`unknown scenario label: ${label}`);
}

export function scenarioRows(manifest) {
  return manifest.images.map((img) => ({
    id: img.id,
    path: img.path,
    absPath: null,
    name: img.path,
    label: numericLabel(img.label),
    category: img.category,
    source_url: img.source_url,
    license: img.license,
    attribution: img.attribution,
    notes: img.notes,
    derived_from: img.derived_from || null,
  }));
}

export async function listScenarioImages(root = repoRoot()) {
  const manifest = await loadScenarioManifest(root);
  const data = dataDirFromRoot(root);
  const rows = [];
  for (const row of scenarioRows(manifest)) {
    const absPath = join(data, row.path);
    let present = false;
    try {
      await stat(absPath);
      present = true;
    } catch {
      present = false;
    }
    rows.push({ ...row, absPath, present });
  }
  return { manifest, rows };
}

export function countByCategory(rows) {
  const counts = {};
  for (const cat of REQUIRED_CATEGORIES) counts[cat] = 0;
  for (const row of rows) {
    counts[row.category] = (counts[row.category] || 0) + 1;
  }
  return counts;
}

export function unverifiedGaps(manifest, presentRows) {
  const listed = new Set((manifest.unverified || []).map((g) => g.category));
  const presentCounts = countByCategory(presentRows.filter((r) => r.present !== false));
  const gaps = [];
  for (const cat of REQUIRED_CATEGORIES) {
    const n = presentCounts[cat] || 0;
    if (n < MIN_PER_CATEGORY) {
      const known = (manifest.unverified || []).find((g) => g.category === cat);
      gaps.push({
        category: cat,
        landed: n,
        need: MIN_PER_CATEGORY,
        why: known?.why || (listed.has(cat) ? "listed UNVERIFIED" : "fewer than 10 files on disk"),
      });
    }
  }
  return gaps;
}

export function assertScenarioManifest(manifest) {
  const rows = scenarioRows(manifest);
  const counts = countByCategory(rows);
  const unverified = new Set((manifest.unverified || []).map((g) => g.category));
  const missing = [];
  for (const cat of REQUIRED_CATEGORIES) {
    if ((counts[cat] || 0) < MIN_PER_CATEGORY && !unverified.has(cat)) {
      missing.push(`${cat}=${counts[cat] || 0}`);
    }
  }
  if (missing.length) {
    throw new Error(
      `scenario manifest below ${MIN_PER_CATEGORY}/category without UNVERIFIED: ${missing.join(", ")}`,
    );
  }
  const charlesworth = rows.find((r) => r.id === "historic_scan_bw_00");
  if (!charlesworth || !/Charlesworth/i.test(charlesworth.notes || "")) {
    throw new Error("historic_scan_bw_00 must be the Charlesworth 1910s Golden Retriever photo");
  }
}

export function assertPresentOrPartial(rows, { allowPartial = false } = {}) {
  const missing = rows.filter((r) => !r.present);
  if (missing.length && !allowPartial) {
    throw new Error(
      `${missing.length} scenario files missing. Run: npm run eval:download:scenarios`,
    );
  }
  return missing;
}
