#!/usr/bin/env python3
"""Export OwensLab/commfor-model-384 to a single-logit ONNX file."""

from __future__ import annotations

import sys
from pathlib import Path

import torch
import torch.nn as nn
import timm
from huggingface_hub import PyTorchModelHubMixin


class ViTClassifier(nn.Module, PyTorchModelHubMixin):
    def __init__(
        self,
        model_size="small",
        input_size=384,
        patch_size=16,
        freeze_backbone=False,
        device="cpu",
        dtype=None,
    ):
        super().__init__()
        self.vit = timm.create_model(
            "vit_small_patch16_384.augreg_in21k_ft_in1k",
            pretrained=False,
        )
        self.vit.head = nn.Linear(in_features=384, out_features=1, bias=True)

    def forward(self, x):
        return self.vit(x)


def main() -> None:
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else "models/commfor-vit-s-384.onnx")
    dest.parent.mkdir(parents=True, exist_ok=True)
    model = ViTClassifier.from_pretrained("OwensLab/commfor-model-384", device="cpu")
    model.eval()
    dummy = torch.randn(1, 3, 384, 384)
    torch.onnx.export(
        model,
        dummy,
        str(dest),
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
