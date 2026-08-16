# Model weights

`commfor-vit-s-384.onnx` is produced by `tools/export_onnx.py` from
[OwensLab/commfor-model-384](https://huggingface.co/OwensLab/commfor-model-384).

Pinned SHA-256 (see `src/model-config.js`):

```
67a3770d39d07403a65628544eb99d0c4c444285d3ca2fcdec80972a1237436f
```

Do not commit a file that fails this hash. Re-export with:

```bash
python3 tools/export_onnx.py models/commfor-vit-s-384.onnx
```
