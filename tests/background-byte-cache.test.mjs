import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToBase64 } from "../src/transfer-bytes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CHARLESWORTH_ORIG =
  "https://upload.wikimedia.org/wikipedia/commons/4/45/Mrs_Winifred_Charlesworth.jpg";
const realFetch = globalThis.fetch;

function sha256Hex(buffer) {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function installChrome({ infer }) {
  const inferCalls = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, cb) {
        if (message?.type === "ping") {
          cb({ ok: true });
          return;
        }
        if (message?.type === "infer") {
          inferCalls.push(message);
          Promise.resolve(infer(message)).then(cb);
          return;
        }
        cb({ error: `unexpected ${message?.type}` });
      },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      getContexts: async () => [{ contextType: "OFFSCREEN_DOCUMENT" }],
      lastError: null,
    },
    offscreen: { createDocument: async () => {} },
    storage: {
      local: {
        get: async () => ({ threshold: 0.65 }),
        set: async () => {},
      },
      session: { set: async () => {} },
    },
    tabs: { onRemoved: { addListener() {} } },
  };
  return { inferCalls };
}

describe("background byte-identity cache", () => {
  let analyzeImage;
  let resultCache;
  let inferCalls;

  before(async () => {
    await mkdir(join(root, "extension/lib"), { recursive: true });
    await copyFile(join(root, "src/transfer-bytes.js"), join(root, "extension/lib/transfer-bytes.js"));
    const scores = [0.11, 0.22, 0.33, 0.44];
    inferCalls = installChrome({
      infer: (message) => ({ score: scores.shift(), id: message.id }),
    }).inferCalls;
    ({ analyzeImage, resultCache } = await import("../extension/background.js"));
  });

  it("caches by sha256(bytes) and records that hash on the result", async () => {
    resultCache.clear();
    const bytesA = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0x03]).buffer;
    const hashA = sha256Hex(bytesA);
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => bytesA,
    });
    const first = await analyzeImage({ type: "analyze", id: "a1", src: CHARLESWORTH_ORIG }, 1);
    assert.equal(first.sha256, hashA);
    assert.equal(inferCalls.length, 1);

    const second = await analyzeImage(
      { type: "analyze", id: "a2", src: "https://cdn.example/other-name.jpg" },
      1,
    );
    assert.equal(second.sha256, hashA);
    assert.equal(second.score, first.score);
    assert.equal(inferCalls.length, 1, "same bytes must reuse the hash cache even when the URL changes");
  });

  it("same URL with different bytes does not reuse the old score", async () => {
    resultCache.clear();
    inferCalls.length = 0;
    const bytesA = Uint8Array.from([0x11, 0x22, 0x33, 0x44]).buffer;
    const bytesB = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]).buffer;
    const hashA = sha256Hex(bytesA);
    const hashB = sha256Hex(bytesB);
    assert.notEqual(hashA, hashB);

    const payloads = [bytesA, bytesB];
    globalThis.fetch = async () => {
      const buffer = payloads.shift();
      return {
        ok: true,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => buffer,
      };
    };

    const first = await analyzeImage({ type: "analyze", id: "b1", src: CHARLESWORTH_ORIG }, 1);
    const second = await analyzeImage({ type: "analyze", id: "b2", src: CHARLESWORTH_ORIG }, 1);

    assert.equal(first.sha256, hashA);
    assert.equal(second.sha256, hashB);
    assert.notEqual(first.score, second.score);
    assert.equal(inferCalls.length, 2);
  });

  it("records sha256 of live Charlesworth orig bytes it actually scored", async () => {
    resultCache.clear();
    inferCalls.length = 0;
    const origUrl = CHARLESWORTH_ORIG;
    const res = await realFetch(origUrl, {
      headers: { "user-agent": "GrainDetector/1.0 (srcset identity test)" },
    });
    assert.equal(res.ok, true, `orig fetch ${res.status}`);
    const buffer = await res.arrayBuffer();
    const hash = sha256Hex(buffer);
    const result = await analyzeImage(
      {
        type: "analyze",
        id: "live-orig",
        src: origUrl,
        bytesB64: bytesToBase64(buffer),
        mime: "image/jpeg",
      },
      1,
    );
    assert.equal(hash, "4266da5bbed84f5f4bb7bbb6f8051ce809c82660bf7eb8248e88100673cdf2e7");
    assert.equal(result.sha256, hash);
    assert.equal(inferCalls.length, 1);
  });
});
