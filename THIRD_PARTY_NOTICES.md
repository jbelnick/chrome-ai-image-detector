# Third-party notices

## Community Forensics ViT-S/384

- Source: [OwensLab/commfor-model-384](https://huggingface.co/OwensLab/commfor-model-384)
- Paper: Park & Owens, *Community Forensics: Using Thousands of Generators to Train Fake Image Detectors*, https://arxiv.org/abs/2411.04125
- Code: https://github.com/JeongsooP/Community-Forensics
- License: MIT
- This repository ships a deterministic ONNX export of those public weights
  (`tools/export_onnx.py`). The exported file is a single logit;
  `sigmoid(logit)` is P(AI-generated).

## onnxruntime-web / onnxruntime-node

- Copyright (c) Microsoft Corporation
- License: MIT
- Vendored into `extension/vendor/ort` at build time.

## ImageNet-normalized ViT backbone

The Community Forensics checkpoint is fine-tuned from
`timm/vit_small_patch16_384.augreg_in21k_ft_in1k` (Apache-2.0).
