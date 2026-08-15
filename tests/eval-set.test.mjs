import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FUSE_DEFAULTS } from "../src/fuse.js";
import { applyCalibration } from "../src/calibrate.js";
import { isOfficialProxy, proxyKind } from "../src/eval-set.js";

describe("shipped operating point", () => {
  it("keeps fuse bias at identity so 0.65 is a real confidence cut", () => {
    assert.equal(FUSE_DEFAULTS.bias, 0);
    assert.equal(FUSE_DEFAULTS.temperature, 1);
    assert.ok(Math.abs(applyCalibration(0.65, FUSE_DEFAULTS) - 0.65) < 1e-6);
    assert.ok(Math.abs(applyCalibration(0.33, FUSE_DEFAULTS) - 0.33) < 1e-6);
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
});
