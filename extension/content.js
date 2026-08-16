(() => {
  const TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let out = "";
    let i = 0;
    for (; i + 2 < u8.length; i += 3) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += TABLE[(n >> 18) & 63] + TABLE[(n >> 12) & 63] + TABLE[(n >> 6) & 63] + TABLE[n & 63];
    }
    const rem = u8.length - i;
    if (rem === 1) {
      const n = u8[i] << 16;
      out += TABLE[(n >> 18) & 63] + TABLE[(n >> 12) & 63] + "==";
    } else if (rem === 2) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8);
      out += TABLE[(n >> 18) & 63] + TABLE[(n >> 12) & 63] + TABLE[(n >> 6) & 63] + "=";
    }
    return out;
  }

  const MIN_SIDE = 64;
const MAX_ATTEMPTS = 2;
const pending = new Map();
const badges = new WeakMap();
const attempts = new WeakMap();
const watching = new WeakSet();
let seq = 0;
let threshold = 0.65;

chrome.storage.local.get(["threshold"], (stored) => {
  if (typeof stored.threshold === "number") threshold = stored.threshold;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.threshold?.newValue != null) {
    threshold = changes.threshold.newValue;
    document.querySelectorAll(".grain-badge").forEach(refreshBadge);
  }
});

function parseSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") return [];
  return srcset
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return null;
      const match = trimmed.match(/^(.*?)\s+(\d+(?:\.\d+)?)([wx])$/i);
      if (match) {
        return {
          url: match[1].trim(),
          descriptor: Number(match[2]),
          kind: match[3].toLowerCase(),
        };
      }
      return { url: trimmed, descriptor: null, kind: null };
    })
    .filter(Boolean);
}

function resolveUrl(url, img) {
  if (!url) return url;
  try {
    const base = img?.baseURI || (typeof location !== "undefined" ? location.href : undefined);
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function widthHint(candidate, img) {
  if (candidate.kind === "w" && Number.isFinite(candidate.descriptor)) {
    return candidate.descriptor;
  }
  const fromName = String(candidate.url).match(/\/(\d+)px-[^/?#]+/i);
  if (fromName) return Number(fromName[1]);
  const fileW = Number(img?.dataset?.fileWidth || img?.getAttribute?.("data-file-width"));
  if (fileW > 0 && !/\/thumb\//i.test(candidate.url) && !/\/\d+px-/i.test(candidate.url)) {
    return fileW;
  }
  return null;
}

function sourceOf(img) {
  const natural = Number(img.naturalWidth);
  const srcset = img.srcset || img.getAttribute?.("srcset") || "";
  const candidates = parseSrcset(srcset);
  if (img.src) candidates.push({ url: img.src, descriptor: null, kind: null });
  if (natural > 0) {
    const match = candidates.find((c) => widthHint(c, img) === natural);
    if (match?.url) return resolveUrl(match.url, img);
  }
  const fallback = img.currentSrc || img.src;
  return fallback ? resolveUrl(fallback, img) : fallback;
}

function applyResultMeta(target, result) {
  if (!target?.dataset) return;
  if (result?.score != null) target.dataset.grainScore = String(result.score);
  if (result?.sha256) target.dataset.grainSha256 = result.sha256;
}

function isSvg(img) {
  if (img.closest("svg")) return true;
  const src = sourceOf(img) || "";
  if (/\.svg(\?|#|$)/i.test(src)) return true;
  if (src.startsWith("data:image/svg")) return true;
  return false;
}

function eligible(img) {
  if (!(img instanceof HTMLImageElement)) return false;
  if (isSvg(img)) return false;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w < MIN_SIDE || h < MIN_SIDE) return false;
  if (!img.src && !img.currentSrc) return false;
  return true;
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

function placeBadge(img, badge) {
  const rect = img.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "block";
  badge.style.left = `${Math.round(rect.left + 8)}px`;
  badge.style.top = `${Math.round(rect.bottom - 26)}px`;
}

function paintBadge(img, result) {
  let badge = badges.get(img);
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "grain-badge";
    document.documentElement.appendChild(badge);
    badges.set(img, badge);
  }
  applyResultMeta(badge, result);
  applyResultMeta(img, result);
  img.dataset.grainVerdict = result.score >= threshold ? "ai" : "real";
  refreshBadge(badge);
  placeBadge(img, badge);
}

function teardown(img) {
  const badge = badges.get(img);
  if (badge) {
    badge.remove();
    badges.delete(img);
  }
}

function repositionAll() {
  document.querySelectorAll("img[data-grain-score]").forEach((img) => {
    const badge = badges.get(img);
    if (badge) placeBadge(img, badge);
  });
}

async function localBytes(src) {
  if (!src.startsWith("blob:") && !src.startsWith("data:")) return null;
  const response = await fetch(src);
  const buffer = await response.arrayBuffer();
  return {
    bytesB64: bytesToBase64(buffer),
    mime: response.headers.get("content-type") || "",
  };
}

function analyze(img) {
  if (!eligible(img)) return;
  const used = attempts.get(img) || 0;
  if (used >= MAX_ATTEMPTS) return;
  const src = sourceOf(img);
  if (!src || src.startsWith("chrome://") || src.startsWith("chrome-extension://")) return;
  const id = `g${seq++}`;
  pending.set(id, img);
  const payload = { type: "analyze", id, src };
  const send = (extra) => {
    chrome.runtime.sendMessage({ ...payload, ...extra }, (response) => {
      pending.delete(id);
      const transient =
        chrome.runtime.lastError?.message ||
        (response?.error && /Receiving end does not exist|offscreen ping/i.test(response.error)
          ? response.error
          : "");
      if (transient && used + 1 < MAX_ATTEMPTS) {
        img.dataset.grainError = transient;
        attempts.set(img, used + 1);
        setTimeout(() => analyze(img), 400);
        return;
      }
      if (chrome.runtime.lastError) {
        attempts.set(img, MAX_ATTEMPTS);
        img.dataset.grainError = chrome.runtime.lastError.message;
        return;
      }
      if (!response || response.error) {
        attempts.set(img, MAX_ATTEMPTS);
        img.dataset.grainError = response?.error || "no-response";
        return;
      }
      attempts.set(img, MAX_ATTEMPTS);
      delete img.dataset.grainError;
      paintBadge(img, response);
    });
  };
  if (src.startsWith("blob:") || src.startsWith("data:")) {
    localBytes(src)
      .then((extra) => send(extra || {}))
      .catch((err) => {
        pending.delete(id);
        img.dataset.grainError = String(err.message || err);
      });
    return;
  }
  send({});
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
  if (watching.has(img) || img.dataset.grainWatch === "1") return;
  watching.add(img);
  img.dataset.grainWatch = "1";
  if (img.complete) {
    if (eligible(img)) io.observe(img);
    return;
  }
  img.addEventListener(
    "load",
    () => {
      if (eligible(img)) io.observe(img);
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
    for (const node of mutation.removedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.tagName === "IMG") teardown(node);
      else node.querySelectorAll?.("img").forEach(teardown);
    }
    if (mutation.type === "attributes" && mutation.target.tagName === "IMG") {
      attempts.delete(mutation.target);
      watching.delete(mutation.target);
      mutation.target.dataset.grainWatch = "";
      teardown(mutation.target);
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

window.addEventListener("scroll", repositionAll, { passive: true, capture: true });
window.addEventListener("resize", repositionAll, { passive: true });

globalThis.__GRAIN_CONTENT__ = {
  parseSrcset,
  sourceOf,
  applyResultMeta,
  resolveUrl,
};
})();
