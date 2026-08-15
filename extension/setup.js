import { MODEL } from "./lib/model-config.js";

const log = document.getElementById("log");
const button = document.getElementById("start");

function line(text) {
  log.textContent += `${text}\n`;
}

button.addEventListener("click", async () => {
  button.disabled = true;
  log.textContent = "";
  line(`Model: ${MODEL.id}`);
  line(`Expected SHA-256: ${MODEL.sha256}`);
  line("Opening inference document…");
  chrome.runtime.sendMessage({ type: "setup-init" }, (response) => {
    if (chrome.runtime.lastError) {
      line(`Error: ${chrome.runtime.lastError.message}`);
      button.disabled = false;
      return;
    }
    if (response?.error) {
      line(`Error: ${response.error}`);
      button.disabled = false;
      return;
    }
    line(`Verified SHA-256: ${response.hash || "(cached)"}`);
    line(`Execution provider preference: ${response.provider || "wasm"}`);
    line("Ready. Browse any webpage — badges appear on analyzed images.");
    chrome.storage.local.set({ setupComplete: true });
  });
});
