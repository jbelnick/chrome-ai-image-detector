# Claim packet — poidh Arbitrum bounty 323 (on-chain id 143)

## Repository

https://github.com/jbelnick/chrome-ai-image-detector

MIT License. This packet does not submit an on-chain claim.

## What was built

**Grain**, a Chrome Manifest V3 extension that:

- Auto-analyzes images on ordinary webpages and overlays an AI confidence badge.
- Runs **all** inference in-browser (ONNX Runtime Web: WebGPU, then WASM).
- Does not call cloud detectors, localhost helpers, or any native backend.
- Bundles a SHA-256-pinned Community Forensics ViT-S/384 ONNX. Downloads SigLIP2 vision ONNX **once** (`npm run fetch-models` or first setup), SHA-256 verifies it, then stays offline for weights.

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
2. Setup tab verifies packaged weights:
   - `commfor-vit-s-384.onnx` SHA-256 `67a3770d39d07403a65628544eb99d0c4c444285d3ca2fcdec80972a1237436f`
   - `siglip2-vision.onnx` SHA-256 `c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad`
3. Disable the network after that if you want to confirm offline inference. Page image fetches still need the image host; the models do not.

## How eval was run

```bash
npm test
npm run eval:download
npm run eval
```

Same preprocess, same two ONNX files, same fusion as the extension (Node `onnxruntime-node` + `sharp` instead of Chrome canvas / WebGPU). Calibration uses a 30% split (seed `20260815`) and is **not** the reported test split. The SigLIP2 linear probe was fit on OpenFake **validation** only — not on `core/test`.

Proxy set: OpenFake `core/test` (held-out generators, 180 AI + 180 real) plus 5 public Community Forensics DALL·E-2 images and 20 Lorem Picsum photographs. This is a hard public proxy, not the private maintainer set.

## Proxy score

Command: `npm run eval`  
Date: 2026-08-15  
Machine: this Cloud Agent (CPU ONNX Runtime).

```
Grain eval — same ONNX + fusion path as the extension
Models: siglip2-vision-base-224 + commfor-vit-s-384
Images: 385  calib=115  test=270
Calib-optimal raw threshold: 0.33 (BA 93.12%)
Fitted bias so that raw 0.33 → 0.65

UNCALIBRATED test @ 0.65:
  balanced accuracy  80.73%
  TPR                66.94%
  TNR                94.52%

CALIBRATED test @ 0.65  (reported proxy score):
  balanced accuracy  84.96%
  TPR                82.26%
  TNR                87.67%
  n                  270 (AI 124 / real 146)
```

Reported proxy score: **84.96% balanced accuracy at threshold 0.65**.

An earlier Community-Forensics-only run on the same images was **68.85%** calibrated / **57.72%** uncalibrated at 0.65 (TPR 16%). That failed the 75% bar and is why the SigLIP2 probe was added. Those CF-only numbers are not the claim.

## Rules checklist

- [x] No cloud inference
- [x] No local backend process
- [x] No extra model downloads after setup / `fetch-models`
- [x] No hardcoded benchmark image hashes / lookup tables
- [x] MIT License
- [x] Auto-analyze + per-image confidence on ordinary pages
