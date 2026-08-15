# Autoresearch — Grain on-device detector

Karpathy [autoresearch](https://github.com/karpathy/autoresearch) adapted to poidh bounty 323.

Hard stop: Sunday 16 Aug 2026, 05:45 UTC. Freeze and ship. No on-chain claim, no wallet.

## Three-file split

| File | Role |
| --- | --- |
| `autoresearch/program.md` | This strategy. Follow it. Do not rewrite the rules mid-loop. |
| `eval/` | **IMMUTABLE** harness + proxy download. Do not retune labels, metric, threshold, or set membership to flatter a model. |
| Detector code under `src/` (and the extension copies of it) | The only thing an experiment may edit. One idea, one tight module, per run. |

## Scalar metric (higher is better)

**Chrome-path** `bal_acc_065` from `npm run eval:chrome`. Same OpenFake `core/test` 180/class prefix, AI iff `score >= 0.65`, BA = `(TPR+TNR)/2`.

On this cloud VM there is no real GPU. Chrome WASM printed the same 157/23/157/23 matrix as Mac Metal WebGPU. Treat VM `eval:chrome` as the chrome-path proxy. Label it chrome-path, never hardware WebGPU.

Print after every chrome-path eval:

```
bal_acc_065: 0.872222
tpr_065:     0.872222
tnr_065:     0.872222
backend:     wasm
webgpu:      UNVERIFIED
```

Source of truth: `eval/results/chrome.json` → `officialOpenFake`. `node autoresearch/print-chrome-score.mjs`. Do not invent. Do not use Node `latest.json`, Picsum, or the exploratory raw-cut search as the ratchet. Do not retune fuse bias. Do not remap a raw cut onto 0.65.

Log every completed run to untracked `autoresearch/results.tsv`:

```
commit	bal_acc_065	status	description
```

`status` is `keep` | `discard` | `crash`.

## Loop

1. First run is the baseline on current HEAD. Record it. Keep it.
2. Form **one** hypothesis. Edit detector code only.
3. `git commit` that change only.
4. `npm run eval:chrome` → `autoresearch/run.log`. Then `node autoresearch/print-chrome-score.mjs`. `grep "^bal_acc_065:"`.
5. Crash or empty grep: fix a dumb bug at most twice, else log `crash`, `git reset --hard` to the running best, next idea.
6. Strictly higher `bal_acc_065` than the running best → **KEEP**. Update best. Spin the three bounty reviewers on that commit. A disqualifier invalidates the KEEP: revert, log, next idea. Nits do not block.
7. Equal or worse → `git reset --hard` to the previous best. Log `discard`.
8. Simplicity: tiny gain + ugly hack = discard. Equal score + simpler code = keep.
9. Never stop to ask. If a family flats, switch family.

## Asymptote

A family is flat when the last 5 completed keep/discard runs each moved best `bal_acc_065` by `< 0.001`.
When a family flats, start a new family (different combination rule, different calibration, different preprocess, different features).
The whole run is asymptotic only after **three** families in a row are flat **and** best `bal_acc_065 >= 0.75`. If still under 0.75, start a more radical family and continue until the hard stop.

## Families (in order, then invent)

1. **Ensemble / blend** — how SigLIP2 and Community Forensics combine (`src/siglip.js`).
2. **Gates** — graphic down-weight, camera EXIF scale, provenance short-circuit (`src/fuse.js`, `src/graphic-gate.js`). Never add an eval-image hash table. Provenance may only use generic C2PA/XMP/generator ASCII.
3. **Calibration** — temperature / small honest bias in `FUSE_DEFAULTS`. The printed score is still `P(AI)`; do not relabel a raw 0.05 as “0.65 confidence” in CLAIM.md.
4. **Preprocess / compression robustness** — resize, crop, optional JPEG round-trip (`src/preprocess.js`).
5. **Radical** — new ONNX, new probe, new feature, only if 1–4 are flat and/or best `< 0.75`.

## Allowed / forbidden

May change: visual model, ONNX, ensemble weights, preprocess, provenance short-circuit (no proxy leakage), calibration, worker path if it changes the score.

Must not change: eval set, labels, metric formula, 0.65 keep/discard threshold, hash lookup of eval images, cloud inference, local servers, extra post-setup model downloads, fabricated numbers.

## When to freeze

Asymptote (three chrome-path families in a row flat) or Sunday 16 Aug 2026 05:45 UTC, whichever first. Write `CLAIM.md` with the real chrome-path block and the best `bal_acc_065`. PR body includes `results.tsv` summary, best score, and the claim packet.
