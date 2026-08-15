# Grain — on-device AI image detector

Chrome Manifest V3 extension that scores webpage images for AI generation **entirely inside the browser**. Inference uses WebGPU with a WebAssembly fallback. There is no cloud API, no localhost helper, and no Python/Node server at runtime.

License: [MIT](LICENSE).

## What it does

- Finds ordinary `<img>` elements on a page (skips tiny tracking pixels).
- Runs a dedicated offscreen ONNX session on each image.
- Overlays a badge with the **AI confidence** (`AI 87%`).
- Optionally short-circuits when C2PA / XMP / generator metadata is present.
- Down-weights charts / UI screenshots so photo-trained scores are not treated as gospel.

The visual backbone is a deterministic ONNX export of the public MIT-licensed [Community Forensics ViT-S/384](https://huggingface.co/OwensLab/commfor-model-384) checkpoint (Park & Owens, 2024). `sigmoid(logit)` is P(AI-generated). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Build from source

Requires **Node.js 20+**. Python + PyTorch are only needed if you want to **re-export** the ONNX file yourself.

```bash
git clone https://github.com/jbelnick/chrome-ai-image-detector.git
cd chrome-ai-image-detector
npm ci
npm run fetch-models    # copies or re-exports commfor-vit-s-384.onnx (SHA-256 checked)
npm run build           # vendors onnxruntime-web, copies src/ → extension/lib, icons
npm test                # unit tests for metrics, calibration, provenance, preprocess
```

`npm run fetch-models` will:

1. Reuse `models/commfor-vit-s-384.onnx` if its SHA-256 matches the pin in `src/model-config.js`.
2. Otherwise export it from `OwensLab/commfor-model-384` via `tools/export_onnx.py`.

After a successful build the unpacked extension root is **`extension/`**.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory from this repo (the folder that contains `manifest.json`).
5. The setup tab verifies the packaged weights (SHA-256) and warms the engine. After that the extension works **offline**.
6. Browse any normal webpage. Badges appear on analyzed images. The toolbar popup shows status and a display-only threshold slider.

Optional: in the extension details, allow access to file URLs if you want `file://` pages scored.

Internet is used only to fetch the *page's own image bytes* (cookie-less) so the worker can decode them. Image pixels are not sent to any other host. Model weights are not re-downloaded after setup.

## Evaluation harness

The eval script uses the **same** preprocess, provenance scan, graphic gate, fusion, and ONNX weights as the extension (Node + `onnxruntime-node` + `sharp` instead of Chrome canvas / WebGPU).

```bash
npm run eval:download   # hard public proxy: OpenFake core/test + extras
npm run eval            # prints balanced accuracy / TPR / TNR at threshold 0.65
```

Balanced accuracy = (TPR + TNR) / 2. An image is predicted AI when `score >= 0.65`.

A 30% calibration split (seed `20260815`) is used only to place the 0.65 operating point. The number printed as **CALIBRATED test** is computed on the remaining images and is the proxy score recorded in [CLAIM.md](CLAIM.md).

This is a public proxy, **not** the private maintainer set. Self-reported homemade sets are easy to overfit; OpenFake `core/test` holds out generators.

## Repository layout

```
src/                 shared detection core (extension + eval)
extension/           unpacked MV3 extension (load this folder)
eval/                proxy download + harness
scripts/             build, fetch-models, icons
tools/export_onnx.py reproducible ONNX export
tests/               node:test unit tests
```

## Limits

- Scores are forensic signals, not proof of authorship.
- Cookie-gated images cannot be fetched by the service worker; those are skipped rather than guessed.
- Recent generators that post-date Community Forensics training can still fool a single visual model. Provenance helps when generators embed C2PA.

## License

MIT. See [LICENSE](LICENSE).
