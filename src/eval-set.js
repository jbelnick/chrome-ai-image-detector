/**
 * Honesty labels for the public proxy mix.
 *
 * Official 360 = OpenFake core/test streaming prefix (openfake_*).
 * Broader scalar = reddit/test web JPEGs + core/test holdout past that
 * prefix + extra web recompress samples. Disjoint from the 360.
 * Picsum easy-real padding and Community Forensics DALL·E extras are
 * in neither score.
 */

export function proxyKind(name) {
  const base = String(name).split("/").pop() || "";
  if (base.startsWith("cf_")) return "excluded-metadata-extra";
  if (base.startsWith("picsum_")) return "easy-real";
  if (base.startsWith("openfake_")) return "openfake";
  if (base.startsWith("ofreddit_")) return "openfake-reddit";
  if (base.startsWith("ofhold_")) return "openfake-holdout";
  if (base.startsWith("webai_")) return "web-ai-recompress";
  if (base.startsWith("webreal_")) return "web-real-recompress";
  return "other";
}

export function isOfficialProxy(name) {
  return proxyKind(name) === "openfake";
}

export function isBroaderProxy(name) {
  return (
    proxyKind(name) === "openfake-reddit" ||
    proxyKind(name) === "openfake-holdout" ||
    proxyKind(name) === "web-ai-recompress" ||
    proxyKind(name) === "web-real-recompress"
  );
}
