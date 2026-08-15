# Claim packet — poidh Arbitrum bounty 323 (on-chain id 143)

## Repository

https://github.com/jbelnick/chrome-ai-image-detector

MIT License. This packet does not submit an on-chain claim.

## What was built

**Grain**, a Chrome Manifest V3 extension that:

- Auto-analyzes images on ordinary webpages and overlays an AI confidence badge.
- Runs **all** inference in-browser (ONNX Runtime Web: WebGPU, then WASM).
- Does not call cloud detectors, localhost helpers, or any native backend.
- Packages a SHA-256-pinned ONNX export of the public Community Forensics ViT-S/384 weights. After `npm run build`, setup is a local verify — no further weight downloads.

## How to build

```bash
git clone https://github.com/jbelnick/chrome-ai-image-detector.git
cd chrome-ai-image-detector
npm ci
npm run fetch-models
npm run build
```

Unpacked root: `extension/`.

## How to load unpacked

1. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
2. Setup tab verifies `models/commfor-vit-s-384.onnx` SHA-256 `67a3770d39d07403a65628544eb99d0c4c444285d3ca2fcdec80972a1237436f`.
3. Disable the network after that if you want to confirm offline inference. Page image fetches still need the image host; the model does not.

## How eval was run

```bash
npm test
npm run eval:download
npm run eval
```

Same preprocess (shorter-edge 440, center-crop 384, ImageNet norm), same ONNX, same fusion as the extension. Calibration uses a 30% split (seed 20260815) and is **not** the reported test split.

Proxy set: OpenFake `core/test` (held-out generators) plus a small public DALL·E-2 / real-photo supplement. This is a hard public proxy, not the private maintainer set.

## Proxy score

**UNVERIFIED at write time — replaced after `npm run eval` prints a real number.**

Target: balanced accuracy ≥ 75.0% at confidence threshold 0.65.

```
(paste eval stdout here)
```

## Rules checklist

- [x] No cloud inference
- [x] No local backend process
- [x] No extra model downloads after setup
- [x] No hardcoded benchmark image hashes / lookup tables
- [x] MIT License
- [x] Auto-analyze + per-image confidence on ordinary pages
