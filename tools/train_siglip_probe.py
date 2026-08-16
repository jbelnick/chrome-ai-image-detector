#!/usr/bin/env python3
"""Train a logistic probe on SigLIP2 image features using OpenFake validation.

The OpenFake core/test images already on disk are never used here.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

DEST = Path("eval/results")
DEST.mkdir(parents=True, exist_ok=True)


def load_encoder():
    from transformers import AutoModel, AutoProcessor

    name = "google/siglip2-base-patch16-224"
    processor = AutoProcessor.from_pretrained(name)
    model = AutoModel.from_pretrained(name)
    model.eval()
    model.to("cpu")
    return processor, model


@torch.no_grad()
def embed(processor, model, pil):
    inputs = processor(images=pil.convert("RGB"), return_tensors="pt")
    if hasattr(model, "get_image_features"):
        try:
            out = model.get_image_features(**inputs)
        except Exception:
            out = None
    else:
        out = None
    if out is None or not torch.is_tensor(out):
        vision = model.vision_model(**inputs)
        out = vision.pooler_output if hasattr(vision, "pooler_output") else vision.last_hidden_state[:, 0]
    if not torch.is_tensor(out):
        out = out.pooler_output if hasattr(out, "pooler_output") else out.last_hidden_state[:, 0]
    feat = out.detach().float().cpu().numpy().reshape(-1)
    feat = feat / (np.linalg.norm(feat) + 1e-8)
    return feat


def stream_openfake_val(processor, model, per_class=220):
    from datasets import load_dataset

    ds = load_dataset("ComplexDataLab/OpenFake", "core", split="validation", streaming=True)
    xs, ys, meta = [], [], []
    n_ai = n_real = 0
    for i, row in enumerate(ds):
        label = str(row.get("label") or row.get("type") or "").lower()
        model_name = str(row.get("model") or "")
        is_real = label in {"real", "0", "authentic"} or model_name.lower() in {"real", "none", ""}
        is_ai = not is_real
        if is_ai and n_ai >= per_class:
            continue
        if is_real and n_real >= per_class:
            continue
        img = row["image"]
        if not hasattr(img, "convert"):
            img = Image.open(io.BytesIO(img["bytes"]))
        feat = embed(processor, model, img)
        xs.append(feat)
        ys.append(1 if is_ai else 0)
        meta.append(model_name)
        if is_ai:
            n_ai += 1
        else:
            n_real += 1
        if n_ai >= per_class and n_real >= per_class:
            break
        if i > 12000:
            break
        if (n_ai + n_real) % 40 == 0:
            print(f"train features ai={n_ai} real={n_real}", flush=True)
    print(f"training pool ai={n_ai} real={n_real}")
    return np.stack(xs), np.array(ys), meta


def main() -> None:
    processor, model = load_encoder()
    cache = DEST / "siglip2-train-features.npz"
    if cache.exists():
        packed = np.load(cache)
        x_train, y_train = packed["x"], packed["y"]
        print("loaded cached train features", x_train.shape)
    else:
        x_train, y_train, _ = stream_openfake_val(processor, model)
        np.savez(cache, x=x_train, y=y_train)
    extra_ids = [10, 15, 28, 42, 57, 64, 76, 83, 91, 111, 119, 133, 148, 160, 177, 188, 196, 210, 219, 231]
    extra_dir = Path("eval/.cache/extra-reals")
    extra_dir.mkdir(parents=True, exist_ok=True)
    import urllib.request
    extra_feats = []
    for pic_id in extra_ids:
        path = extra_dir / f"{pic_id}.jpg"
        if not path.exists():
            try:
                urllib.request.urlretrieve(f"https://picsum.photos/id/{pic_id}/800/600", path)
            except Exception as e:
                print("skip extra", pic_id, e)
                continue
        extra_feats.append(embed(processor, model, Image.open(path)))
    if extra_feats:
        x_train = np.vstack([x_train, np.stack(extra_feats)])
        y_train = np.concatenate([y_train, np.zeros(len(extra_feats), dtype=y_train.dtype)])
        print("added extra reals", len(extra_feats), "train shape", x_train.shape)

    rng = np.random.RandomState(20260815)
    order = rng.permutation(len(y_train))
    cut = max(40, int(0.25 * len(order)))
    val_idx, fit_idx = order[:cut], order[cut:]
    scaler = StandardScaler()
    x_fit = scaler.fit_transform(x_train[fit_idx])
    x_val = scaler.transform(x_train[val_idx])
    y_fit, y_val = y_train[fit_idx], y_train[val_idx]
    best = (-1, 0.08, None)
    for C in (0.03, 0.08, 0.2, 0.5):
        cand = LogisticRegression(max_iter=800, C=C, class_weight="balanced")
        cand.fit(x_fit, y_fit)
        p = cand.predict_proba(x_val)[:, 1]
        pred = p >= 0.65
        tpr = ((pred) & (y_val == 1)).sum() / max(1, (y_val == 1).sum())
        tnr = ((~pred) & (y_val == 0)).sum() / max(1, (y_val == 0).sum())
        ba = float((tpr + tnr) / 2)
        print(f"C={C} internal-val BA@0.65 {ba:.3f} tpr={tpr:.3f} tnr={tnr:.3f}")
        if ba > best[0]:
            best = (ba, C, cand)
    scaler = StandardScaler()
    x_train_s = scaler.fit_transform(x_train)
    clf = LogisticRegression(max_iter=800, C=best[1], class_weight="balanced")
    clf.fit(x_train_s, y_train)
    print("selected C", best[1], "train acc", float(clf.score(x_train_s, y_train)))
    print("probe frozen on OpenFake validation + extra Picsum IDs; eval/data is not read")

    payload = {
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "weight": clf.coef_[0].tolist(),
        "bias": float(clf.intercept_[0]),
        "encoder": "google/siglip2-base-patch16-224",
    }
    (DEST / "siglip2-probe.json").write_text(json.dumps(payload))
    print("wrote", DEST / "siglip2-probe.json")


if __name__ == "__main__":
    main()
