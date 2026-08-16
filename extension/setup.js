import { MODELS } from "./lib/model-config.js";

const log = document.getElementById("log");
const button = document.getElementById("start");

function line(text) {
  log.textContent += `${text}\n`;
}

button.addEventListener("click", async () => {
  button.disabled = true;
  log.textContent = "";
  line(`Models: ${MODELS.siglip2.id} + ${MODELS.commfor.id}`);
  line(`Community Forensics SHA-256: ${MODELS.commfor.sha256}`);
  line(`SigLIP2 SHA-256: ${MODELS.siglip2.sha256}`);
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
    const hashes = response.hashes || {};
    line(`Verified Community Forensics: ${hashes.commfor || "(cached)"}`);
    line(`Verified SigLIP2: ${hashes.siglip2 || "(cached)"}`);
    line(`Execution provider actually created: ${response.provider || "wasm"}`);
    line("Ready. Browse any webpage — badges appear on analyzed images.");
    chrome.storage.local.set({ setupComplete: true });
  });
});
