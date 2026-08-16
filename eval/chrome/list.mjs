/**
 * Official proxy listing for the Chrome eval.
 * Same folders and honesty labels as `npm run eval` — OpenFake only.
 */
import { readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBroaderProxy, isOfficialProxy, proxyKind } from "../../src/eval-set.js";

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
        broader: isBroaderProxy(rel),
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function officialOnly(rows) {
  return rows.filter((row) => row.official);
}

export function broaderOnly(rows) {
  return rows.filter((row) => row.broader);
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

export function assertBroaderSet(broader) {
  const nAi = broader.filter((r) => r.label === 1).length;
  const nReal = broader.filter((r) => r.label === 0).length;
  const kinds = new Set(broader.map((r) => r.kind));
  if (nAi < 80 || nReal < 80) {
    throw new Error(
      `broader proxy is ${broader.length} (AI ${nAi} / real ${nReal}); need >=80 each. Run npm run eval:download:broader.`,
    );
  }
  if (nAi !== nReal) {
    throw new Error(
      `broader proxy is unbalanced: AI ${nAi} / real ${nReal}. Run npm run eval:download:broader.`,
    );
  }
  if (!kinds.has("openfake-reddit") || !kinds.has("openfake-holdout")) {
    throw new Error(
      `broader proxy missing required slices (have ${[...kinds].join(",")}). Run npm run eval:download:broader.`,
    );
  }
  if (broader.some((r) => r.official || r.name.includes("openfake_"))) {
    throw new Error("broader proxy must stay disjoint from the official 360 prefix");
  }
}

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}
