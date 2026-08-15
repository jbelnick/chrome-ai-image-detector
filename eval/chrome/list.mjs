/**
 * Official proxy listing for the Chrome eval.
 * Same folders and honesty labels as `npm run eval` — OpenFake only.
 */
import { readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOfficialProxy, proxyKind } from "../../src/eval-set.js";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

export function dataDirFromRoot(root) {
  return join(root, "eval/data");
}

export async function listProxyImages(dataDir) {
  const rows = [];
  for (const [folder, label] of [
    ["ai", 1],
    ["real", 0],
  ]) {
    const dir = join(dataDir, folder);
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!IMAGE_EXT.has(extname(name).toLowerCase())) continue;
      const rel = `${folder}/${name}`;
      rows.push({
        path: join(dir, name),
        label,
        name: rel,
        kind: proxyKind(rel),
        official: isOfficialProxy(rel),
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function officialOnly(rows) {
  return rows.filter((row) => row.official);
}

export function assertOfficialSet(official) {
  const nAi = official.filter((r) => r.label === 1).length;
  const nReal = official.filter((r) => r.label === 0).length;
  if (official.length !== 360 || nAi !== 180 || nReal !== 180) {
    throw new Error(
      `official proxy is ${official.length} (AI ${nAi} / real ${nReal}); expected 360 (180/180). Run npm run eval:download.`,
    );
  }
}

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}
