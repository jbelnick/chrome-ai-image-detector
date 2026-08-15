import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  assertBroaderSet,
  assertOfficialSet,
  broaderOnly,
  dataDirFromRoot,
  listProxyImages,
  officialOnly,
  repoRoot,
} from "../eval/chrome/list.mjs";
import { isBroaderProxy, isOfficialProxy } from "../src/eval-set.js";

describe("chrome eval listing", () => {
  it("keeps the official 360 as OpenFake-only and drops Picsum/CF extras", async () => {
    const root = repoRoot();
    const rows = await listProxyImages(dataDirFromRoot(root));
    if (rows.length < 20) {
      return; // download not present in a fresh clone
    }
    const official = officialOnly(rows);
    assertOfficialSet(official);
    assert.equal(official.every((r) => isOfficialProxy(r.name)), true);
    assert.equal(
      official.some((r) => r.name.includes("picsum_") || r.name.includes("cf_")),
      false,
    );
    assert.equal(official.filter((r) => r.label === 1).length, 180);
    assert.equal(official.filter((r) => r.label === 0).length, 180);
    const broader = broaderOnly(rows);
    if (broader.length >= 160) {
      assertBroaderSet(broader);
      assert.equal(broader.every((r) => isBroaderProxy(r.name)), true);
      assert.equal(broader.some((r) => r.name.includes("openfake_")), false);
    }
  });

  it("resolves the repo root next to package.json", () => {
    assert.equal(join(repoRoot(), "package.json").endsWith("package.json"), true);
  });
});
