/**
 * Honesty labels for the public proxy mix.
 * Official score = OpenFake core/test only.
 * Picsum is easy-real padding. Community Forensics DALL·E extras are
 * excluded because they embed generator ASCII that provenance would
 * short-circuit without a visual win.
 */

export function proxyKind(name) {
  const base = String(name).split("/").pop() || "";
  if (base.startsWith("cf_")) return "excluded-metadata-extra";
  if (base.startsWith("picsum_")) return "easy-real";
  if (base.startsWith("openfake_")) return "openfake";
  return "other";
}

export function isOfficialProxy(name) {
  return proxyKind(name) === "openfake";
}
