# Grain — on-device AI image detector

Chrome Manifest V3 extension that scores webpage images for AI generation **entirely inside the browser**. Inference uses WebGPU with a WebAssembly fallback. There is no cloud API, no localhost helper, and no Python/Node server at runtime.

License: [MIT](LICENSE).

## What it does

- Finds ordinary `<img>` elements on a page (skips tiny tracking pixels).
- Runs a dedicated offscreen ONNX session on each image.
- Overlays a badge with the **AI confidence** (`AI 87%`).
- Optionally short-circuits when specific C2PA / generator metadata is present (not a bare `openai` / `google` token in JPEG entropy).
- Down-weights charts / UI screenshots so photo-trained scores are not treated as gospel.

The visual path is a hybrid:

1. A SigLIP2-base vision encoder ([onnx-community export](https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX) of `google/siglip2-base-patch16-224`) plus a tiny linear probe trained on **OpenFake validation only**.
2. A deterministic ONNX export of the public MIT-licensed [Community Forensics ViT-S/384](https://huggingface.co/OwensLab/commfor-model-384) checkpoint, used as a high-precision booster on older generators.

`sigmoid` outputs are fused in-browser. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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

1. Reuse `models/commfor-vit-s-384.onnx` if its SHA-256 matches the pin in `src/model-config.js`, otherwise export it from `OwensLab/commfor-model-384`.
2. Download `siglip2-vision.onnx` (~355 MB, one-time) from Hugging Face and SHA-256 verify it. After that the extension does not fetch weights again.

After a successful build the unpacked extension root is **`extension/`**. `extension/vendor/`, `extension/lib/`, and `extension/models/` are gitignored build outputs — loading the unbuilt tree will 404 `ort.min.js` and the weights. `npm run fetch-models` and `npm run build` fail closed on a SHA-256 or missing-ONNX error.

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
# Python deps for the downloader only: pip install datasets pillow
npm run eval:download   # OpenFake core/test (official) + optional Picsum easy-reals
npm run eval            # prints official BA / TPR / TNR at threshold 0.65
```

Balanced accuracy = (TPR + TNR) / 2. An image is predicted AI when the **shipped** fused score `>= 0.65`. Fuse bias is `0` — the harness does not remap a lower raw cut onto 0.65.

The number printed as **OFFICIAL OpenFake core/test** is the proxy score. Picsum photographs are easy-real padding and are labeled as such. Community Forensics DALL·E extras are excluded because they embed generator ASCII.

This is a public proxy, **not** the private maintainer set. OpenFake `core/test` holds out generators; it is still easier than a private web-JPEG bench of recent models.

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
- Cookie-gated `https` images still fail closed (`credentials: "omit"`). Page-origin `blob:` / `data:` URLs are fetched in the content script and sent as Base64.
- Recent generators that post-date Community Forensics training can still fool a single visual model. Provenance helps when generators embed C2PA.
- Eval (`sharp` + CPU ORT) is not a bit-exact match of Chrome canvas + WebGPU/WASM.

## License

MIT. See [LICENSE](LICENSE).
