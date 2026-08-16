import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64, base64ToBytes } from "../src/transfer-bytes.js";

describe("transfer-bytes", () => {
  it("round-trips binary that JSON.stringify would drop from an ArrayBuffer field", () => {
    const raw = Uint8Array.from([0, 1, 255, 10, 13, 0x89, 0x50]);
    assert.equal(JSON.stringify({ buffer: raw.buffer }), '{"buffer":{}}');
    const encoded = bytesToBase64(raw);
    assert.equal(typeof encoded, "string");
    assert.notEqual(encoded.length, 0);
    assert.deepEqual([...base64ToBytes(encoded)], [...raw]);
  });

  it("round-trips lengths that are not multiples of three", () => {
    for (const n of [1, 2, 3, 4, 5, 31, 32]) {
      const raw = Uint8Array.from({ length: n }, (_, i) => (i * 17) & 255);
      assert.deepEqual([...base64ToBytes(bytesToBase64(raw))], [...raw]);
    }
  });

  it("rejects missing payloads so offscreen cannot decode an empty JSON buffer", () => {
    assert.throws(() => base64ToBytes(""), /missing image bytes/);
    assert.throws(() => base64ToBytes(undefined), /missing image bytes/);
  });
});
