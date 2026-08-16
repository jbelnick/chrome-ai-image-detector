# Ship-gate fixtures

Named live-page product fixtures. Isolated from the 358 mix and from the PR 12 diagnostic holdout.

## Fixtures

| id | role | source |
| --- | --- | --- |
| `charlesworth_orig` | Charlesworth 1910s orig | Wikipedia / Commons `Mrs_Winifred_Charlesworth.jpg` |
| `charlesworth_250` | Charlesworth 250px thumb | same file, Wikipedia 250px |
| `nous_1870s_250` | Nous 1870s 250px | Commons `Nous_sitting_with_keeper.jpg` |
| `wiki_real_golden` | ordinary wiki real | Commons `Golden_retriever.jpg` |
| `wiki_real_dulmen` | ordinary wiki real | Commons 2022 Golden Retriever |

Charlesworth freeze (PR 11 / CLAIM, copied, not invented): orig **0.632695**, 250px **0.634229**. Both must stay **< 0.65** (not AI 99%). Nous freeze **0.322159** must stay real.

## Commands

```bash
npm test                          # CI ship-gate (fusion + pixels)
npm run eval:download:ship-gate   # 5 Commons files only
npm run eval:chrome:ship-gate     # chrome-path; fails if Charlesworth/Nous flip
npm run eval:holdout-grade        # print PR 12 table as grade-only
```

Do not train on the PR 12 holdout. Do not add holdout images into `eval/data/ai` or `eval/data/real`. Do not edit `FUSE_DEFAULTS`.
