import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const root = dirname(fileURLToPath(import.meta.url));
const CHARLESWORTH = {
  page: "https://en.wikipedia.org/wiki/Golden_Retriever",
  origPath: "/wikipedia/commons/4/45/Mrs_Winifred_Charlesworth.jpg",
  thumbPath: "/wikipedia/commons/thumb/4/45/Mrs_Winifred_Charlesworth.jpg/250px-Mrs_Winifred_Charlesworth.jpg",
  src: "//upload.wikimedia.org/wikipedia/commons/thumb/4/45/Mrs_Winifred_Charlesworth.jpg/250px-Mrs_Winifred_Charlesworth.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail",
  srcset:
    "//upload.wikimedia.org/wikipedia/commons/4/45/Mrs_Winifred_Charlesworth.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail_unscaled 2x",
  fileWidth: 470,
};

const DUKEDESTINY = {
  page: "https://en.wikipedia.org/wiki/Golden_Retriever",
  origPath: "/wikipedia/commons/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg",
  thumb250Path:
    "/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/250px-Golden_Retriever_Dukedestiny01_drvd.jpg",
  thumb500Path:
    "/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/500px-Golden_Retriever_Dukedestiny01_drvd.jpg",
  src: "//upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/250px-Golden_Retriever_Dukedestiny01_drvd.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail",
  srcset:
    "//upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/500px-Golden_Retriever_Dukedestiny01_drvd.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail 2x",
  fileWidth: 652,
};

function loadContent() {
  const chrome = {
    storage: {
      local: { get: (_keys, cb) => cb({}) },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage() {}, lastError: null },
  };
  const document = {
    documentElement: { appendChild() {} },
    querySelectorAll: () => [],
    createElement: () => ({
      className: "",
      style: {},
      dataset: {},
      classList: { toggle() {} },
      textContent: "",
      title: "",
      remove() {},
    }),
  };
  const sandbox = {
    chrome,
    document,
    window: { addEventListener() {} },
    HTMLImageElement: class HTMLImageElement {},
    IntersectionObserver: class {
      observe() {}
    },
    MutationObserver: class {
      observe() {}
    },
    URL,
    location: { href: CHARLESWORTH.page },
    setTimeout,
    console,
  };
  sandbox.globalThis = sandbox;
  const code = readFileSync(join(root, "../extension/content.js"), "utf8");
  runInContext(code, createContext(sandbox), { filename: "content.js" });
  assert.ok(sandbox.__GRAIN_CONTENT__, "content.js must expose __GRAIN_CONTENT__ for tests");
  return sandbox.__GRAIN_CONTENT__;
}

function wikiImg({ naturalWidth, currentSrc }) {
  return {
    src: CHARLESWORTH.src,
    srcset: CHARLESWORTH.srcset,
    currentSrc,
    naturalWidth,
    baseURI: CHARLESWORTH.page,
    dataset: { fileWidth: String(CHARLESWORTH.fileWidth) },
    getAttribute(name) {
      if (name === "srcset") return CHARLESWORTH.srcset;
      if (name === "data-file-width") return String(CHARLESWORTH.fileWidth);
      return null;
    },
  };
}

describe("content source selection", () => {
  it("Golden Retriever / Charlesworth: naturalWidth 470 prefers the original srcset candidate, not the 250px src", () => {
    const { sourceOf } = loadContent();
    const thumbAbs =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Mrs_Winifred_Charlesworth.jpg/250px-Mrs_Winifred_Charlesworth.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";
    const picked = sourceOf(
      wikiImg({
        naturalWidth: 470,
        currentSrc: thumbAbs,
      }),
    );
    assert.match(picked, /Mrs_Winifred_Charlesworth\.jpg/);
    assert.ok(picked.includes(CHARLESWORTH.origPath), picked);
    assert.doesNotMatch(picked, /\/thumb\//);
    assert.doesNotMatch(picked, /250px-/);
  });

  it("Golden Retriever / Charlesworth: naturalWidth 250 keeps the 250px thumb", () => {
    const { sourceOf } = loadContent();
    const thumbAbs =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Mrs_Winifred_Charlesworth.jpg/250px-Mrs_Winifred_Charlesworth.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";
    const picked = sourceOf(
      wikiImg({
        naturalWidth: 250,
        currentSrc: thumbAbs,
      }),
    );
    assert.match(picked, /250px-Mrs_Winifred_Charlesworth/);
    assert.match(picked, /\/thumb\//);
  });

  it("Dukedestiny infobox: density-corrected naturalWidth 250 + currentSrc 500px picks the 2x thumb, not the 250px src", () => {
    const { sourceOf } = loadContent();
    const thumb250 =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/250px-Golden_Retriever_Dukedestiny01_drvd.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";
    const thumb500 =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/500px-Golden_Retriever_Dukedestiny01_drvd.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";
    const picked = sourceOf({
      src: DUKEDESTINY.src,
      srcset: DUKEDESTINY.srcset,
      currentSrc: thumb500,
      naturalWidth: 250,
      baseURI: DUKEDESTINY.page,
      dataset: { fileWidth: String(DUKEDESTINY.fileWidth) },
      getAttribute(name) {
        if (name === "srcset") return DUKEDESTINY.srcset;
        if (name === "data-file-width") return String(DUKEDESTINY.fileWidth);
        return null;
      },
    });
    assert.ok(picked.includes(DUKEDESTINY.thumb500Path), picked);
    assert.doesNotMatch(picked, /250px-/);
    assert.notEqual(picked, thumb250);
  });

  it("Dukedestiny infobox: 1x currentSrc 250px keeps the 250px thumb", () => {
    const { sourceOf } = loadContent();
    const thumb250 =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Golden_Retriever_Dukedestiny01_drvd.jpg/250px-Golden_Retriever_Dukedestiny01_drvd.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";
    const picked = sourceOf({
      src: DUKEDESTINY.src,
      srcset: DUKEDESTINY.srcset,
      currentSrc: thumb250,
      naturalWidth: 250,
      baseURI: DUKEDESTINY.page,
      dataset: { fileWidth: String(DUKEDESTINY.fileWidth) },
      getAttribute(name) {
        if (name === "srcset") return DUKEDESTINY.srcset;
        if (name === "data-file-width") return String(DUKEDESTINY.fileWidth);
        return null;
      },
    });
    assert.match(picked, /250px-Golden_Retriever_Dukedestiny01_drvd/);
  });

  it("prefers the srcset w candidate that equals naturalWidth", () => {
    const { sourceOf } = loadContent();
    const picked = sourceOf({
      src: "https://cdn.example/img-320.jpg",
      srcset:
        "https://cdn.example/img-320.jpg 320w, https://cdn.example/img-640.jpg 640w, https://cdn.example/img-1280.jpg 1280w",
      currentSrc: "https://cdn.example/img-640.jpg",
      naturalWidth: 1280,
      baseURI: "https://example.com/article",
    });
    assert.equal(picked, "https://cdn.example/img-1280.jpg");
  });

  it("overlay records sha256 of the bytes that were scored", () => {
    const { applyResultMeta } = loadContent();
    const badge = { dataset: {} };
    const img = { dataset: {} };
    const sha256 = "4266da5bbed84f5f4bb7bbb6f8051ce809c82660bf7eb8248e88100673cdf2e7";
    applyResultMeta(badge, { score: 0.5, sha256 });
    applyResultMeta(img, { score: 0.5, sha256 });
    assert.equal(badge.dataset.grainSha256, sha256);
    assert.equal(img.dataset.grainSha256, sha256);
    assert.equal(badge.dataset.grainScore, "0.5");
  });

  it("live Wikipedia Dukedestiny orig / 500px / 250px are different files", async () => {
    const origUrl = `https://upload.wikimedia.org${DUKEDESTINY.origPath}`;
    const thumb500Url = `https://upload.wikimedia.org${DUKEDESTINY.thumb500Path}`;
    const thumb250Url = `https://upload.wikimedia.org${DUKEDESTINY.thumb250Path}`;
    const headers = { "user-agent": "GrainDetector/1.0 (srcset identity test)" };
    const [origRes, thumb500Res, thumb250Res] = await Promise.all([
      fetch(origUrl, { headers }),
      fetch(thumb500Url, { headers }),
      fetch(thumb250Url, { headers }),
    ]);
    assert.equal(origRes.ok, true, `orig fetch ${origRes.status}`);
    assert.equal(thumb500Res.ok, true, `500px fetch ${thumb500Res.status}`);
    assert.equal(thumb250Res.ok, true, `250px fetch ${thumb250Res.status}`);
    const origBytes = new Uint8Array(await origRes.arrayBuffer());
    const thumb500Bytes = new Uint8Array(await thumb500Res.arrayBuffer());
    const thumb250Bytes = new Uint8Array(await thumb250Res.arrayBuffer());
    const origHash = Buffer.from(await crypto.subtle.digest("SHA-256", origBytes)).toString("hex");
    const thumb500Hash = Buffer.from(await crypto.subtle.digest("SHA-256", thumb500Bytes)).toString("hex");
    const thumb250Hash = Buffer.from(await crypto.subtle.digest("SHA-256", thumb250Bytes)).toString("hex");
    assert.notEqual(origHash, thumb500Hash);
    assert.notEqual(origHash, thumb250Hash);
    assert.notEqual(thumb500Hash, thumb250Hash);
    assert.equal(origHash, "74cd09d6d360041ff3763af1abcb0a809200a26f784e3baf81321c60b676eb31");
    assert.equal(thumb500Hash, "1a5278316a8bb2f413ca29be6f4579ffcd6fff589f58d054bfe17e86d4fa5b50");
    assert.equal(thumb250Hash, "40a49c7a244484c9406393b44dcf1f60adf555b345d334e4dd7cb7ffd872ef8e");
  });

  it("live Wikipedia Charlesworth thumb and original are different files", async () => {
    const origUrl = `https://upload.wikimedia.org${CHARLESWORTH.origPath}`;
    const thumbUrl = `https://upload.wikimedia.org${CHARLESWORTH.thumbPath}`;
    const [origRes, thumbRes] = await Promise.all([
      fetch(origUrl, { headers: { "user-agent": "GrainDetector/1.0 (srcset identity test)" } }),
      fetch(thumbUrl, { headers: { "user-agent": "GrainDetector/1.0 (srcset identity test)" } }),
    ]);
    assert.equal(origRes.ok, true, `orig fetch ${origRes.status}`);
    assert.equal(thumbRes.ok, true, `thumb fetch ${thumbRes.status}`);
    const origBytes = new Uint8Array(await origRes.arrayBuffer());
    const thumbBytes = new Uint8Array(await thumbRes.arrayBuffer());
    const origHash = Buffer.from(await crypto.subtle.digest("SHA-256", origBytes)).toString("hex");
    const thumbHash = Buffer.from(await crypto.subtle.digest("SHA-256", thumbBytes)).toString("hex");
    assert.notEqual(origBytes.byteLength, thumbBytes.byteLength);
    assert.notEqual(origHash, thumbHash);
    assert.equal(origHash, "4266da5bbed84f5f4bb7bbb6f8051ce809c82660bf7eb8248e88100673cdf2e7");
    assert.equal(thumbHash, "73faf59f5409c0127fe180fd1f44d678f613b0d9446723e52fc5a0ab1006c83c");
  });
});
