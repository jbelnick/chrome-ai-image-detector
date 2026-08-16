/**
 * Ship-gate listing. Isolated from the 358 mix and the PR 12 holdout.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertShipGateManifest } from "../../src/ship-gate.js";

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function manifestPathFromRoot(root) {
  return join(root, "eval/data/manifest-ship-gate.json");
}

export async function loadShipGateManifest(root = repoRoot()) {
  const raw = JSON.parse(await readFile(manifestPathFromRoot(root), "utf8"));
  return assertShipGateManifest(raw);
}

export async function listShipGateImages(root = repoRoot()) {
  const manifest = await loadShipGateManifest(root);
  const data = join(root, "eval/data");
  const rows = [];
  for (const img of manifest.images) {
    const absPath = join(data, img.path);
    let present = false;
    try {
      await stat(absPath);
      present = true;
    } catch {
      present = false;
    }
    rows.push({
      id: img.id,
      role: img.role,
      path: img.path,
      name: img.path,
      absPath,
      present,
      label: 0,
      source_url: img.source_url,
      notes: img.notes,
      freeze: img.chrome_path_freeze,
    });
  }
  return { manifest, rows };
}
