import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import { applyCalibration } from "../src/calibrate.js";
import { isBroaderProxy, isOfficialProxy, proxyKind } from "../src/eval-set.js";

describe("shipped operating point", () => {
  it("keeps fuse bias at 0", () => {
    assert.equal(FUSE_DEFAULTS.bias, 0);
  });
});

describe("eval-set", () => {
  it("treats OpenFake files as the official public proxy", () => {
    assert.equal(proxyKind("ai/openfake_ai_0001.jpg"), "openfake");
    assert.equal(isOfficialProxy("ai/openfake_ai_0001.jpg"), true);
  });

  it("excludes Community Forensics metadata extras from the official set", () => {
    assert.equal(proxyKind("ai/cf_00000274.png"), "excluded-metadata-extra");
    assert.equal(isOfficialProxy("ai/cf_00000274.png"), false);
  });

  it("labels Picsum photographs as easy-real padding, not the official set", () => {
    assert.equal(proxyKind("real/picsum_237.jpg"), "easy-real");
    assert.equal(isOfficialProxy("real/picsum_237.jpg"), false);
  });

  it("keeps the broader scalar disjoint from the official 360 prefix", () => {
    assert.equal(isOfficialProxy("ai/ofreddit_ai_0001.jpg"), false);
    assert.equal(isOfficialProxy("ai/ofhold_ai_0001.jpg"), false);
    assert.equal(isOfficialProxy("ai/webai_ai_0001.jpg"), false);
    assert.equal(isBroaderProxy("ai/openfake_ai_0001.jpg"), false);
    assert.equal(isBroaderProxy("ai/ofreddit_ai_0001.jpg"), true);
    assert.equal(isBroaderProxy("real/ofhold_real_0001.jpg"), true);
    assert.equal(isBroaderProxy("ai/webai_ai_0001.jpg"), true);
    assert.equal(isBroaderProxy("real/webreal_0010.jpg"), true);
    assert.equal(isBroaderProxy("real/picsum_237.jpg"), false);
  });

  it("keeps ship-gate fixtures and the PR 12 holdout out of both public mixes", () => {
    assert.equal(proxyKind("ship-gate/shipgate_charlesworth_orig.jpg"), "ship-gate");
    assert.equal(isOfficialProxy("ship-gate/shipgate_charlesworth_orig.jpg"), false);
    assert.equal(isBroaderProxy("ship-gate/shipgate_charlesworth_orig.jpg"), false);
    assert.equal(isOfficialProxy("scenarios/historic_scan_bw/historic_scan_bw_00.jpg"), false);
    assert.equal(isBroaderProxy("scenarios/historic_scan_bw/historic_scan_bw_00.jpg"), false);
  });
});
