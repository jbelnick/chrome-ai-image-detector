# Multi-scenario diagnostic holdout

This slice exists so Grain is graded on failure modes the 358 mix never contained.

Jason watched Grain call the 1910s Wikipedia / Wikimedia Commons photograph of Winifred Charlesworth with her Golden Retrievers **AI 99%**. That image is a real pre-1950 film scan. The official OpenFake 360 prefix and the later 358 broader proxy (reddit/test + ofhold + Picsum recompress) did not include that class of miss.

**This suite is a diagnostic holdout.**

- It is **not** Kenny's private maintainer bench.
- It is **not** a KEEP scalar unless Jason says so later.
- Do **not** fit the SigLIP probe on these images.
- Do **not** replace `npm run eval:chrome` / the 358 broader proxy as a silent default ratchet.
- Do **not** climb a KEEP score on this set tonight.

## How to populate and score

```bash
npm run eval:download:scenarios   # Commons + Picsum + OpenFake holdout slices
npm run eval:chrome:scenarios     # per-category TPR / TNR / BA + overall
```

Images land under `eval/data/scenarios/` and are gitignored. The committed source of truth is `eval/data/manifest-scenarios.json` plus `eval/download-scenarios.mjs` / `eval/download_scenarios.py`.

`GRAIN_CHROME_EVAL_LIMIT=N` scores a short subset (not a claim run).  
`GRAIN_CHROME_EVAL_ALLOW_PARTIAL=1` scores whatever is on disk.

## Categories

| slug | label | source |
| --- | --- | --- |
| `historic_scan_bw` | REAL | Wikimedia Commons pre-1950 B&W/sepia scans, including Charlesworth |
| `historic_scan_color` | REAL | Autochrome / Prokudin-Gorsky / early color scans |
| `wiki_web_real` | REAL | Modern Commons photographs at typical wiki JPEG widths |
| `phone_web_real` | REAL | Lorem Picsum IDs **not** in the 358 mix, q≈65, max side 720 |
| `social_reddit_real` | REAL | OpenFake `reddit/test` after the first 90 (ofreddit_*) |
| `social_reddit_ai` | AI | OpenFake `reddit/test` after the first 120 (ofreddit + webai) |
| `gen_holdout_ai` | AI | OpenFake `core/test` after skip 240 (360 prefix + ofhold) |
| `gen_holdout_real` | REAL | Matching real holdout, same skip |
| `screenshot_ui` | mixed | Commons charts/UI screenshots + honestly labeled AI UI |
| `compressed_thumb` | mixed | Derived max-side 250–400, q=60; `derived_from` keeps the original id |
| `ai_photoreal` | AI | OpenFake `core/test` after skip 252, photoreal generators |
| `ai_illustrated` | AI | Same stream, exclusive Midjourney / illustrated / cartoon filter |

If a category cannot reach 10 after an honest search, the downloader prints **UNVERIFIED** and why. Files are not invented.

## Isolation

No `createClaim`. No on-chain transaction. No detector image-content hashes. SHA of model weights is unchanged and is not this suite's job.
