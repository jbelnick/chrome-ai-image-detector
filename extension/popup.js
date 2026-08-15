const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const slider = document.getElementById("threshold");
const label = document.getElementById("thresholdLabel");

function setThresholdLabel(value) {
  label.textContent = `${Math.round(value * 100)}%`;
  slider.value = String(Math.round(value * 100));
}

const stored = await chrome.storage.local.get(["threshold", "setupComplete", "modelId", "executionProvider"]);
const threshold = typeof stored.threshold === "number" ? stored.threshold : 0.65;
setThresholdLabel(threshold);
if (stored.setupComplete) {
  const provider = stored.executionProvider ? ` · ${stored.executionProvider}` : "";
  statusEl.textContent = `${stored.modelId || "Ready"}${provider}`;
} else {
  statusEl.textContent = "Needs setup";
}

slider.addEventListener("input", () => {
  const value = Number(slider.value) / 100;
  setThresholdLabel(value);
  chrome.storage.local.set({ threshold: value });
});

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab?.id != null) {
  chrome.runtime.sendMessage({ type: "get-stats", tabId: tab.id }, (stats) => {
    if (chrome.runtime.lastError) {
      statsEl.textContent = chrome.runtime.lastError.message;
      return;
    }
    if (!stats) return;
    const cut = Math.round(threshold * 100);
    statsEl.textContent = `${stats.analyzed || 0} analyzed · ${stats.ai || 0} ≥ ${cut}%`;
  });
}
