import { bytesToBase64, base64ToBytes } from "./lib/transfer-bytes.js";

const OFFSCREEN_URL = "offscreen.html";
const MAX_CACHE = 256;
const MAX_INFLIGHT = 2;

let offscreenReady = null;
const pageStats = new Map();
const resultCache = new Map();
let inflight = 0;
const queue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

function pump() {
  if (inflight >= MAX_INFLIGHT) return;
  const job = queue.shift();
  if (!job) return;
  inflight += 1;
  job
    .fn()
    .then(job.resolve, job.reject)
    .finally(() => {
      inflight -= 1;
      pump();
    });
}

function sendToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("empty offscreen response"));
        return;
      }
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

async function pingOffscreen(tries = 40, delayMs = 100) {
  let last = new Error("offscreen ping timeout");
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await sendToOffscreen({ type: "ping" });
      if (response?.ok) return;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw last;
}

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS"],
        justification: "Run on-device ONNX inference away from webpage threads",
      });
    }
    await pingOffscreen();
  })();
  try {
    await offscreenReady;
  } catch (err) {
    offscreenReady = null;
    throw err;
  }
}

async function fetchImageBytes(src) {
  const response = await fetch(src, {
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`fetch ${response.status}`);
  }
  const mime = response.headers.get("content-type") || "application/octet-stream";
  const buffer = await response.arrayBuffer();
  return { bytesB64: bytesToBase64(buffer), mime };
}

function bumpStats(tabId, field) {
  if (tabId == null) return;
  const current = pageStats.get(tabId) || { analyzed: 0, ai: 0, errors: 0 };
  current[field] = (current[field] || 0) + 1;
  pageStats.set(tabId, current);
  chrome.storage.session?.set({ pageStats: Object.fromEntries(pageStats) }).catch(() => {});
}

async function analyzeImage(message, tabId) {
  if (resultCache.has(message.src)) {
    return resultCache.get(message.src);
  }
  await ensureOffscreen();
  let bytesB64 = message.bytesB64;
  let mime = message.mime || "application/octet-stream";
  if (!bytesB64) {
    const fetched = await fetchImageBytes(message.src);
    bytesB64 = fetched.bytesB64;
    mime = fetched.mime;
  } else {
    base64ToBytes(bytesB64);
  }
  const result = await sendToOffscreen({
    type: "infer",
    id: message.id,
    mime,
    bytesB64,
  });
  if (resultCache.size >= MAX_CACHE) {
    const first = resultCache.keys().next().value;
    resultCache.delete(first);
  }
  resultCache.set(message.src, result);
  const stored = await chrome.storage.local.get(["threshold"]);
  const threshold = typeof stored.threshold === "number" ? stored.threshold : 0.65;
  bumpStats(tabId, "analyzed");
  if (result.score >= threshold) bumpStats(tabId, "ai");
  return result;
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  pageStats.delete(tabId);
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["threshold", "setupComplete"]);
  if (stored.threshold == null) {
    await chrome.storage.local.set({ threshold: 0.65 });
  }
  if (!stored.setupComplete) {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "analyze") {
    const tabId = sender.tab?.id;
    enqueue(() => analyzeImage(message, tabId))
      .then(sendResponse)
      .catch((err) => {
        bumpStats(tabId, "errors");
        sendResponse({ error: String(err.message || err) });
      });
    return true;
  }

  if (message?.type === "get-stats") {
    sendResponse(pageStats.get(message.tabId) || { analyzed: 0, ai: 0, errors: 0 });
    return false;
  }

  if (message?.type === "setup-status") {
    (async () => {
      await ensureOffscreen();
      return sendToOffscreen({ type: "status" });
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }

  if (message?.type === "setup-init") {
    (async () => {
      await ensureOffscreen();
      return sendToOffscreen({ type: "init-model" });
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err.message || err) }));
    return true;
  }

  return false;
});
