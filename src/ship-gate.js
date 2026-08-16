/**
 * Hunter ship-gate: named live images, not the 358 mix.
 *
 * Fail closed if Charlesworth returns to AI 99% or Nous flips to AI.
 * PR 12 diagnostic holdout may be printed grade-only. Never train on it.
 * Never add holdout images into the 358 mix.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fuseScores } from "./fuse.js";
import { isBroaderProxy, isOfficialProxy, proxyKind } from "./eval-set.js";
import { PRODUCT_THRESHOLD, scoreFromModels } from "./score-image.js";

export { PRODUCT_THRESHOLD };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SHIP_GATE_MANIFEST_REL = "eval/data/manifest-ship-gate.json";
export const SHIP_GATE_DIR_REL = "eval/data/ship-gate";
export const HOLDOUT_GRADE_ONLY_REL = "eval/data/holdout-grade-only.json";

export const REQUIRED_ROLES = ["charlesworth", "charlesworth", "nous", "wiki-real", "wiki-real"];
export const REQUIRED_IDS = [
  "charlesworth_orig",
  "charlesworth_250",
  "nous_1870s_250",
  "wiki_real_golden",
  "wiki_real_dulmen",
];

export function shipGateManifestPath(repoRoot = root) {
  return join(repoRoot, SHIP_GATE_MANIFEST_REL);
}

export function loadShipGateManifest(repoRoot = root) {
  const raw = JSON.parse(readFileSync(shipGateManifestPath(repoRoot), "utf8"));
  if (!raw || !Array.isArray(raw.images) || raw.images.length !== 5) {
    throw new Error("ship-gate manifest must list exactly 5 named fixtures");
  }
  return raw;
}

export function shipGateImages(manifest = loadShipGateManifest()) {
  return manifest.images;
}

export function assertShipGateManifest(manifest = loadShipGateManifest()) {
  const ids = manifest.images.map((img) => img.id);
  if (ids.join(",") !== REQUIRED_IDS.join(",")) {
    throw new Error(`ship-gate ids must be ${REQUIRED_IDS.join(", ")}; got ${ids.join(", ")}`);
  }
  const charlesworth = manifest.images.filter((img) => img.role === "charlesworth");
  const nous = manifest.images.filter((img) => img.role === "nous");
  const wiki = manifest.images.filter((img) => img.role === "wiki-real");
  if (charlesworth.length !== 2) throw new Error("need Charlesworth orig + 250px");
  if (nous.length !== 1) throw new Error("need Nous 1870s 250px");
  if (wiki.length !== 2) throw new Error("need two ordinary wiki reals");
  for (const img of manifest.images) {
    if (img.label !== "real") throw new Error(`${img.id} must be labeled real`);
    if (!String(img.path).startsWith("ship-gate/shipgate_")) {
      throw new Error(`${img.id} path must stay under ship-gate/shipgate_*`);
    }
    if (isOfficialProxy(img.path) || isBroaderProxy(img.path)) {
      throw new Error(`${img.id} leaked into the 360/358 mix labels`);
    }
    if (proxyKind(img.path) !== "ship-gate") {
      throw new Error(`${img.id} must be proxyKind ship-gate`);
    }
  }
  const orig = charlesworth.find((img) => img.id === "charlesworth_orig");
  const thumb = charlesworth.find((img) => img.id === "charlesworth_250");
  if (!/Charlesworth/i.test(orig?.notes || "") || !/250/.test(thumb?.notes || "")) {
    throw new Error("Charlesworth fixtures must stay the Wikipedia 1910s orig + 250px thumb");
  }
  if (!/Nous/i.test(nous[0]?.notes || "") || !/1870/.test(nous[0]?.notes || "")) {
    throw new Error("Nous fixture must stay the 1870s 250px thumb");
  }
  return manifest;
}

/**
 * Accept/reject for a scored ship-gate row.
 * Charlesworth must stay below the 0.65 product cut (not AI 99%).
 * Nous must stay real.
 */
export function shipGateVerdict(row, threshold = PRODUCT_THRESHOLD) {
  const score = Number(row.score);
  const id = row.id || row.name;
  const role = row.role;
  if (!Number.isFinite(score)) {
    return { id, role, ok: false, reason: "missing score (do not invent one)" };
  }
  if (role === "charlesworth" && score >= threshold) {
    return {
      id,
      role,
      ok: false,
      reason: `Charlesworth ${score.toFixed(3)} is AI @ ${threshold} (must stay < 0.65 / not 0.99)`,
    };
  }
  if (role === "nous" && score >= threshold) {
    return {
      id,
      role,
      ok: false,
      reason: `Nous ${score.toFixed(3)} flipped to AI @ ${threshold} (must stay real)`,
    };
  }
  return { id, role, ok: true, score };
}

export const GATED_IDS = ["charlesworth_orig", "charlesworth_250", "nous_1870s_250"];

export function assertShipGateScores(rows, threshold = PRODUCT_THRESHOLD) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = GATED_IDS.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`ship-gate missing scored ids: ${missing.join(", ")}`);
  }
  const failures = [];
  for (const row of rows) {
    if (row.role !== "charlesworth" && row.role !== "nous") continue;
    const verdict = shipGateVerdict(row, threshold);
    if (!verdict.ok) failures.push(verdict.reason);
  }
  if (failures.length) {
    throw new Error(`SHIP GATE FAIL\n${failures.join("\n")}`);
  }
  return rows;
}

/** After the film split, Charlesworth is isGraphic false / scanGrain true. */
export function charlesworthFromFreeze(dump) {
  const graphic = {
    isGraphic: false,
    muted: true,
    scanGrain: true,
    flatTone: dump.graphic?.flatTone ?? false,
    uniqueColors: dump.graphic?.uniqueColors,
    fineRatio: dump.graphic?.fineRatio,
    edgeRatio: dump.graphic?.edgeRatio,
    colorfulness: dump.graphic?.colorfulness,
  };
  return scoreFromModels({
    siglip: dump.siglip,
    commfor: dump.commfor,
    provenance: { ai: false, camera: false },
    graphic,
  });
}

export function charlesworthWithoutScan(dump) {
  return scoreFromModels({
    siglip: dump.siglip,
    commfor: dump.commfor,
    provenance: { ai: false, camera: false },
    graphic: { isGraphic: false, muted: true, scanGrain: false },
  });
}

/**
 * Invert the shipped calibration so a recorded chrome-path score can be
 * re-fused as visual-only. Used for Nous (PR 11 recorded 0.322159, reasons
 * visual). Not an invented badge number.
 */
export function visualFromRecordedScore(score, { bias = 0, temperature = 0.9, scorePower = 0.85 } = {}) {
  const calib = Number(score) ** (1 / scorePower);
  const logit = (p) => Math.log(p / (1 - p));
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  return sigmoid(temperature * logit(calib) + bias);
}

export function nousFromFreeze(dump) {
  const visual = visualFromRecordedScore(dump.score);
  return fuseScores({
    visual,
    provenance: { ai: false, camera: false },
    graphic: { isGraphic: false },
  });
}

export function freezeRows(manifest = loadShipGateManifest()) {
  return manifest.images
    .filter((img) => img.chrome_path_freeze)
    .map((img) => ({
      id: img.id,
      role: img.role,
      label: 0,
      score: img.chrome_path_freeze.score,
      reasons: img.chrome_path_freeze.reasons,
      source: img.chrome_path_freeze.source,
    }));
}
