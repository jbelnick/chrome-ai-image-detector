# Eval decode notes

Chrome-path is the source of truth. Node is a proxy.

| path | decode | infer | role |
| --- | --- | --- | --- |
| chrome-path | `createImageBitmap` + `OffscreenCanvas` (`CANVAS_RESAMPLE`) | onnxruntime-web (WebGPU, then WASM) | overlay + `npm run eval:chrome` |
| node-proxy | `sharp` (`NODE_SHARP_RESAMPLE`) | onnxruntime-node CPU | `npm run eval` only |

`overlay-path(B) === chrome-eval(B)` is already enforced (`SCORE-CONTRACT.md`). Node is outside that identity.

## decode-delta

`node(B) − chrome(B)` on the same file bytes and the same detector is **decode-delta**.

- Report it. Print the `decode-delta` block from `eval/decode-delta.mjs`.
- Do not absorb it in `FUSE_DEFAULTS`.
- Do not add mix nips to make Node match Chrome.
- Do not treat a matching balanced accuracy as “the paths are the same.”

## Recorded pair (not invented)

Copied from `CLAIM.md` KEEP `1e19a9f` official OpenFake 360. Same fusion. Fusion was not changed.

| path | BA | TPR | TNR | TP/FN/TN/FP |
| --- | --- | --- | --- | --- |
| Node `1e19a9f` (sharp + ort-node) | 0.872222 | 0.900000 | 0.844444 | 162/18/152/28 |
| Chrome WASM `1e19a9f` (canvas + ort-web) | 0.872222 | 0.872222 | 0.872222 | 157/23/157/23 |

`delta_ba` was +0.000000. The confusion matrix moved: TPR down 5, TNR up 5 (10 decision flips). That gap is decode-delta.

A later chrome-path KEEP can move Chrome numbers without a paired Node re-run. Do not subtract a stale Node file from a new Chrome file and call the mix a fuse bug. Live `latest.json` vs `chrome.json` is labeled only when both files exist; confirm the same commit before citing.

## Resample (why they differ)

Chrome (`src/preprocess.js` `CANVAS_RESAMPLE`):

- Community Forensics: smoothing on, quality `medium`
- SigLIP: smoothing off (nearest-neighbor 224 stretch)
- Named product rule `compressedThumb`: when the source short-edge is below the CF 440 recipe, CF upsample is nearest. Graphic flags still read the default medium CF crop so Charlesworth 250px cannot flip off `scanGrain`.

Node (`NODE_SHARP_RESAMPLE`):

- Community Forensics: sharp `cubic`
- SigLIP: sharp `lanczos3`

Color management, EXIF apply, and ORT backend (CPU vs WASM/WebGPU) also differ. This lane does not retune those kernels to chase a mix number. Changing a kernel changes decode-delta; it does not change the badge.

## What this lane does not do

- Edit `FUSE_DEFAULTS`
- Add mix KEEP nips
- Train on PR 12 scenario holdout
- URL / file-hash special-case
- Put Charlesworth back to AI 99%
- `createClaim`
