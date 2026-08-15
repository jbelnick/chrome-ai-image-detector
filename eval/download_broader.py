#!/usr/bin/env python3
"""Download the broader chrome-path scalar proxy.

Disjoint from the official OpenFake core/test 180/class prefix.
Does not read OpenFake validation (probe training split).
"""
from __future__ import annotations

import io
import json
import sys
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "eval" / "data"

USED_PICSUM = {
    237, 1015, 1025, 1035, 1043, 1062, 1074, 1084, 129, 201,
    292, 338, 349, 365, 433, 452, 494, 548, 582, 593,
}
WEB_PICSUM = [
    10, 15, 28, 42, 57, 64, 76, 83, 91, 111, 122, 133, 146, 157, 164,
    177, 188, 196, 203, 211, 224, 231, 248, 256, 267, 274, 281, 287, 301, 312,
]


def label_of(row) -> int:
    raw = row.get("label")
    lab = "" if raw is None else str(raw).lower()
    if lab in {"fake", "ai", "synthetic", "1", "generated"}:
        return 1
    if lab in {"real", "0", "authentic"}:
        return 0
    model = str(row.get("model") or "").lower()
    return 0 if model in {"real", "none", ""} else 1


def to_pil(img):
    from PIL import Image

    if hasattr(img, "convert"):
        return img.convert("RGB")
    return Image.open(io.BytesIO(img["bytes"])).convert("RGB")


def save_jpeg(pil, path: Path, quality: int, max_side=None):
    from PIL import Image

    im = pil
    if max_side:
        w, h = im.size
        long_side = max(w, h)
        if long_side > max_side:
            scale = max_side / long_side
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="JPEG", quality=quality, optimize=True)


def stream_openfake(config, split, skip_per_class, take, prefix, quality, max_side=None, labels=(0, 1)):
    from datasets import load_dataset

    print(
        f"streaming ComplexDataLab/OpenFake {config}/{split} "
        f"skip={skip_per_class} take={take} labels={labels} ...",
        flush=True,
    )
    ds = load_dataset("ComplexDataLab/OpenFake", config, split=split, streaming=True)
    seen = {0: 0, 1: 0}
    kept = {0: 0, 1: 0}
    rows = []
    want = {lab: take for lab in labels}
    for i, row in enumerate(ds):
        lab = label_of(row)
        if lab not in want:
            continue
        if seen[lab] < skip_per_class:
            seen[lab] += 1
            continue
        if kept[lab] >= want[lab]:
            if all(kept[x] >= want[x] for x in want):
                break
            continue
        kind = "ai" if lab == 1 else "real"
        fname = f"{prefix}_{kind}_{kept[lab]:04d}.jpg"
        path = DEST / kind / fname
        save_jpeg(to_pil(row["image"]), path, quality=quality, max_side=max_side)
        rows.append(
            {
                "path": str(path),
                "label": lab,
                "source": f"openfake-{config}-{split}",
                "model": str(row.get("model") or ""),
                "prefix": prefix,
            }
        )
        kept[lab] += 1
        seen[lab] += 1
        if all(kept[x] >= want[x] for x in want):
            break
        if i > 40000:
            break
    print(f"  saved {prefix} ai={kept[1]} real={kept[0]}", flush=True)
    return rows, kept


def download_webreals(n=30):
    from PIL import Image

    rows = []
    for pic_id in WEB_PICSUM:
        if len(rows) >= n:
            break
        if pic_id in USED_PICSUM:
            continue
        path = DEST / "real" / f"webreal_{pic_id:04d}.jpg"
        if not path.exists():
            url = f"https://picsum.photos/id/{pic_id}/960/640"
            try:
                urllib.request.urlretrieve(url, path)
            except Exception as exc:
                print(f"  skip picsum {pic_id}: {exc}", flush=True)
                continue
            try:
                save_jpeg(Image.open(path).convert("RGB"), path, quality=65, max_side=720)
            except Exception as exc:
                print(f"  skip picsum decode {pic_id}: {exc}", flush=True)
                path.unlink(missing_ok=True)
                continue
        rows.append(
            {
                "path": str(path),
                "label": 0,
                "source": "picsum-web-recompress",
                "model": "",
                "prefix": "webreal",
            }
        )
    print(f"  webreal extras={len(rows)}", flush=True)
    return rows


def main():
    try:
        from datasets import load_dataset  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "eval:download:broader needs Python packages.\n"
            "  pip install datasets pillow\n"
            f"Import error: {exc}"
        ) from exc

    (DEST / "ai").mkdir(parents=True, exist_ok=True)
    (DEST / "real").mkdir(parents=True, exist_ok=True)

    reddit, reddit_n = stream_openfake(
        "reddit", "test", skip_per_class=0, take=90,
        prefix="ofreddit", quality=82,
    )
    hold, hold_n = stream_openfake(
        "core", "test", skip_per_class=180, take=60,
        prefix="ofhold", quality=72,
    )
    webai, webai_n = stream_openfake(
        "reddit", "test", skip_per_class=90, take=30,
        prefix="webai", quality=65, max_side=720, labels=(1,),
    )
    webreal = download_webreals(30)

    manifest = reddit + hold + webai + webreal
    n_ai = sum(1 for r in manifest if r["label"] == 1)
    n_real = sum(1 for r in manifest if r["label"] == 0)
    print(f"broader proxy ai={n_ai} real={n_real} sources={dict(Counter(r['source'] for r in manifest))}", flush=True)

    if n_ai < 80 or n_real < 80:
        raise SystemExit(
            f"broader proxy too small: ai={n_ai} real={n_real} (need >=80 each). "
            "Do not fall back to the official 360 prefix."
        )
    if reddit_n[1] < 40 or reddit_n[0] < 40:
        raise SystemExit(
            f"OpenFake reddit/test incomplete: ai={reddit_n[1]} real={reddit_n[0]} (need >=40 each)."
        )
    if hold_n[1] < 40 or hold_n[0] < 40:
        raise SystemExit(
            f"OpenFake core/test holdout incomplete: ai={hold_n[1]} real={hold_n[0]} (need >=40 each)."
        )

    while n_ai > n_real and n_ai > 80:
        rec = next((r for r in reversed(manifest) if r["label"] == 1 and r["prefix"] == "webai"), None)
        if rec is None:
            break
        Path(rec["path"]).unlink(missing_ok=True)
        manifest.remove(rec)
        n_ai -= 1
    while n_real > n_ai and n_real > 80:
        rec = next((r for r in reversed(manifest) if r["label"] == 0 and r["prefix"] == "webreal"), None)
        if rec is None:
            break
        Path(rec["path"]).unlink(missing_ok=True)
        manifest.remove(rec)
        n_real -= 1

    out = DEST / "manifest-broader.json"
    out.write_text(json.dumps(manifest, indent=2))
    print(f"wrote {out} n={len(manifest)} ai={n_ai} real={n_real}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
