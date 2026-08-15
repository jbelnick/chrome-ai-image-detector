(() => {
  const MIN_SIDE = 64;
  const pending = new Map();
  const badges = new WeakMap();
  let seq = 0;
  let threshold = 0.65;
  const seen = new WeakSet();

  chrome.storage.local.get(["threshold"], (stored) => {
    if (typeof stored.threshold === "number") threshold = stored.threshold;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.threshold?.newValue != null) {
      threshold = changes.threshold.newValue;
      document.querySelectorAll(".grain-badge").forEach(refreshBadge);
    }
  });

  function eligible(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.closest("svg")) return false;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < MIN_SIDE || h < MIN_SIDE) return false;
    if (!img.src && !img.currentSrc) return false;
    return true;
  }

  function sourceOf(img) {
    return img.currentSrc || img.src;
  }

  function ensureHost(img) {
    const parent = img.parentElement;
    if (!parent) return null;
    const style = getComputedStyle(parent);
    if (style.position === "static") parent.style.position = "relative";
    return parent;
  }

  function refreshBadge(badge) {
    const score = Number(badge.dataset.grainScore);
    if (!Number.isFinite(score)) return;
    const pct = Math.round(score * 100);
    badge.textContent = `AI ${pct}%`;
    badge.classList.toggle("grain-badge-ai", score >= threshold);
    badge.classList.toggle("grain-badge-real", score < threshold);
    badge.title = `Grain on-device estimate: ${pct}% likely AI-generated`;
  }

  function paintBadge(img, result) {
    const host = ensureHost(img);
    if (!host) return;
    let badge = badges.get(img);
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "grain-badge";
      host.appendChild(badge);
      badges.set(img, badge);
    }
    badge.dataset.grainScore = String(result.score);
    img.dataset.grainScore = String(result.score);
    img.dataset.grainVerdict = result.score >= threshold ? "ai" : "real";
    refreshBadge(badge);
  }

  function analyze(img) {
    if (seen.has(img)) return;
    if (!eligible(img)) return;
    seen.add(img);
    const src = sourceOf(img);
    if (!src || src.startsWith("chrome://") || src.startsWith("chrome-extension://")) return;
    const id = `g${seq++}`;
    pending.set(id, img);
    chrome.runtime.sendMessage({ type: "analyze", id, src }, (response) => {
      pending.delete(id);
      if (chrome.runtime.lastError) {
        img.dataset.grainError = chrome.runtime.lastError.message;
        return;
      }
      if (!response || response.error) {
        img.dataset.grainError = response?.error || "no-response";
        return;
      }
      paintBadge(img, response);
    });
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) analyze(entry.target);
      }
    },
    { rootMargin: "200px", threshold: 0.01 },
  );

  function watch(img) {
    if (seen.has(img) || img.dataset.grainWatch === "1") return;
    img.dataset.grainWatch = "1";
    if (img.complete && eligible(img)) {
      io.observe(img);
      return;
    }
    img.addEventListener(
      "load",
      () => {
        io.observe(img);
      },
      { once: true },
    );
  }

  function scan(root = document) {
    root.querySelectorAll?.("img").forEach(watch);
  }

  scan();
  const mo = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "IMG") watch(node);
        else scan(node);
      }
      if (mutation.type === "attributes" && mutation.target.tagName === "IMG") {
        seen.delete(mutation.target);
        mutation.target.dataset.grainWatch = "";
        watch(mutation.target);
      }
    }
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
})();
