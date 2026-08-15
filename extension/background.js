const OFFSCREEN_URL = "offscreen.html";

let offscreenReady = null;
const pageStats = new Map();
const resultCache = new Map();
const MAX_CACHE = 256;

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
  })();
  try {
    await offscreenReady;
  } catch (err) {
    offscreenReady = null;
    throw err;
  }
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
  return { buffer, mime };
}

function bumpStats(tabId, field) {
  if (tabId == null) return;
  const current = pageStats.get(tabId) || { analyzed: 0, ai: 0, errors: 0 };
  current[field] = (current[field] || 0) + 1;
  pageStats.set(tabId, current);
  chrome.storage.session?.set({ pageStats: Object.fromEntries(pageStats) }).catch(() => {});
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
    (async () => {
      if (resultCache.has(message.src)) {
        return resultCache.get(message.src);
      }
      await ensureOffscreen();
      const { buffer, mime } = await fetchImageBytes(message.src);
      const result = await sendToOffscreen({
        type: "infer",
        id: message.id,
        mime,
        buffer,
      });
      if (resultCache.size >= MAX_CACHE) {
        const first = resultCache.keys().next().value;
        resultCache.delete(first);
      }
      resultCache.set(message.src, result);
      bumpStats(tabId, "analyzed");
      if (result.score >= 0.65) bumpStats(tabId, "ai");
      return result;
    })()
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
    sendToOffscreen({ type: "status" })
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
