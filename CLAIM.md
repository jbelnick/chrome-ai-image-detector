# Claim packet — poidh Arbitrum bounty 323 (on-chain id 143)

## Repository

https://github.com/jbelnick/chrome-ai-image-detector

MIT License. This packet does not submit an on-chain claim.

## What was built

**Grain**, a Chrome Manifest V3 extension that:

- Auto-analyzes images on ordinary webpages and overlays an AI confidence badge.
- Runs **all** inference in-browser (ONNX Runtime Web: WebGPU session create, then WASM if that throws).
- Does not call cloud detectors, localhost helpers, or any native backend.
- Bundles a SHA-256-pinned Community Forensics ViT-S/384 ONNX. Downloads SigLIP2 vision ONNX **once** (`npm run fetch-models` or first setup), SHA-256 verifies it, then stays offline for weights.
- Sends image bytes as Base64 over `chrome.runtime.sendMessage` (JSON-safe). An `ArrayBuffer` field would serialize to `{}`.

## How to build

```bash
git clone https://github.com/jbelnick/chrome-ai-image-detector.git
cd chrome-ai-image-detector
npm ci
npm run fetch-models
npm run build
```

`extension/vendor/`, `extension/lib/`, and `extension/models/` are build artifacts (gitignored). Load the built `extension/` folder, not the raw git tree.

## How to load unpacked

1. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
2. Setup tab verifies packaged weights:
   - `commfor-vit-s-384.onnx` SHA-256 `67a3770d39d07403a65628544eb99d0c4c444285d3ca2fcdec80972a1237436f`
   - `siglip2-vision.onnx` SHA-256 `c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad`
3. Disable the network after that if you want to confirm offline inference. Page image fetches still need the image host; the models do not.

## How eval was run

```bash
npm test
npm run eval:download   # needs: pip install datasets pillow
npm run eval
```

Same fusion object as the extension (`FUSE_DEFAULTS.bias = 0`). Node uses `onnxruntime-node` + `sharp`; Chrome uses canvas `drawImage` + WebGPU/WASM. Those decode paths are not identical.

Official proxy: OpenFake `core/test` only. Lorem Picsum is easy-real padding and is **not** the claim. Community Forensics DALL·E extras are excluded (embedded generator ASCII). The SigLIP2 linear probe was fit on OpenFake **validation** only — the train script does not read `eval/data`.

## Proxy score

**UNVERIFIED after the honesty/compliance rewrite.** The previous 84.96% figure was a calib-split remapping of raw 0.33 onto a displayed 0.65 and is **withdrawn**. The previous 80.73% uncalibrated figure mixed Picsum / CF extras into a 70% split and is also not the current official number.

Re-run `npm run eval` and paste the `OFFICIAL OpenFake core/test @ 0.65` block here. Do not invent a replacement.

## Rules checklist

- [x] No cloud inference
- [x] No local backend process
- [x] No extra model downloads after setup / `fetch-models`
- [x] No hardcoded benchmark image hashes / lookup tables
- [x] MIT License
- [x] Auto-analyze + per-image confidence on ordinary pages (JSON-safe byte path)
