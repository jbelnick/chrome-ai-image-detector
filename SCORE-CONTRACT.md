# Score contract (locked)

Chrome-path is the source of truth.

1. Product test: live page, real vs AI, badge decision at 0.65. Not mix BA.
2. One `scoreImage(bytes)` used by overlay and eval.
3. `FUSE_DEFAULTS` nips: leftover 358-mix band drops/lifts are frozen junk. Allowed named product rules: `bias = 0`, provenance short-circuit, `muted-scan` / Charlesworth (do not revert without live-page evidence). Do not add mix nips.
4. Hunter PR accept/reject: a patch ships only if named live images improve and Charlesworth does not return to AI 99%.
5. 358 mix is a regression note only.

Identity: `overlay-path(B) === chrome-eval(B)` for the same file bytes B. Enforced by `tests/score-identity.test.mjs` (`npm test`).

Node (`sharp` + `onnxruntime-node`) is a proxy, not that identity. `node(B) − chrome(B)` is **decode-delta**. Report it (`eval/DECODE.md`). Do not absorb it in `FUSE_DEFAULTS`.
