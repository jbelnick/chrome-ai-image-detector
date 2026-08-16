#!/usr/bin/env python3
"""Download OpenFake slices for the diagnostic scenario holdout.

Disjoint from the official core/test 180/class prefix and the 358 broader
proxy (ofreddit first 90/class, ofhold skip 180 take 60, webai reddit AI
skip 90 take 30). Does not read OpenFake validation.
"""
from __future__ import annotations

import io
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "eval" / "data" / "manifest-scenarios.json"
DEST = ROOT / "eval" / "data"

# Photoreal vs illustrated — exclusive. Illustrated wins if both match.
ILLUSTRATED_MARKERS = (
    "midjourney",
    "ideogram",
    "illustrious",
    "anime",
    "cartoon",
    "pony",
    "niji",
    "waifu",
    "counterfeit",
    "anything-v",
    "novelai",
    "comic",
    "illustration",
    "toon",
)
PHOTOREAL_MARKERS = (
    "flux",
    "sdxl",
    "gpt-image",
    "nano-banana",
    "imagen",
    "grok",
    "dalle",
    "dall-e",
    "dall·e",
    "hidream",
    "z-image",
    "recraft",
    "seedream",
    "realistic-vision",
    "epic-realism",
    "juggernaut",
    "realvis",
    "touchofrealism",
    "playground",
    "kolors",
    "chroma",
    "mystic",
    "aurora",
    "lumina",
    "qwen-image",
    "sd-3",
    "sd-1",
    "sd-2",
)


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


def save_jpeg(pil, path: Path, quality: int = 82):
    path.parent.mkdir(parents=True, exist_ok=True)
    pil.convert("RGB").save(path, format="JPEG", quality=quality, optimize=True)


def classify_model(model: str) -> str | None:
    m = (model or "").lower()
    if any(tok in m for tok in ILLUSTRATED_MARKERS):
        return "illustrated"
    if any(tok in m for tok in PHOTOREAL_MARKERS):
        return "photoreal"
    return None


def jobs_from_manifest(images):
    jobs = []
    for img in images:
        dl = img.get("download") or {}
        if dl.get("kind") not in {"openfake", "openfake-filter"}:
            continue
        jobs.append(
            {
                "id": img["id"],
                "path": DEST / img["path"],
                "config": dl["config"],
                "split": dl["split"],
                "label": int(dl["label"]),
                "skip": int(dl["skip"]),
                "slot": int(dl["slot"]),
                "filter": dl.get("filter"),
                "kind": dl["kind"],
            }
        )
    return jobs


def fill_plain(ds, wanted, quality=82):
    """wanted: list of jobs sharing config/split, no filter, same label."""
    if not wanted:
        return {}, []
    by_label = defaultdict(list)
    for job in wanted:
        by_label[job["label"]].append(job)
    for lab in by_label:
        by_label[lab].sort(key=lambda j: (j["skip"], j["slot"]))

    seen = {0: 0, 1: 0}
    filled = {}
    models = []
    need = {lab: len(jobs) for lab, jobs in by_label.items()}
    last_needed = {
        lab: max(j["skip"] + j["slot"] for j in jobs) for lab, jobs in by_label.items()
    }

    for i, row in enumerate(ds):
        lab = label_of(row)
        if lab not in need:
            continue
        matched = next(
            (
                j
                for j in by_label[lab]
                if j["id"] not in filled and j["skip"] + j["slot"] == seen[lab]
            ),
            None,
        )
        if matched is not None:
            model = str(row.get("model") or "")
            save_jpeg(to_pil(row["image"]), matched["path"], quality=quality)
            filled[matched["id"]] = model
            models.append({"id": matched["id"], "model": model})
            print(f"  saved {matched['id']} model={model!r}", flush=True)
        seen[lab] += 1
        if all(seen.get(x, 0) > last_needed[x] for x in need):
            break
        if i > 80000:
            break
    return filled, models


def fill_filters(ds, wanted, quality=82):
    """Exclusive photoreal/illustrated assignment after a shared skip."""
    if not wanted:
        return {}, []
    wanted = sorted(wanted, key=lambda j: (j["filter"] or "", j["slot"]))
    skip = min(j["skip"] for j in wanted)
    buckets = defaultdict(list)
    for job in wanted:
        buckets[job["filter"]].append(job)
    for key in buckets:
        buckets[key].sort(key=lambda j: j["slot"])

    seen_ai = 0
    filled = {}
    models = []
    got = {k: 0 for k in buckets}
    need = {k: len(v) for k, v in buckets.items()}

    for i, row in enumerate(ds):
        lab = label_of(row)
        if lab != 1:
            continue
        if seen_ai < skip:
            seen_ai += 1
            continue
        if all(got[k] >= need[k] for k in need):
            break
        model = str(row.get("model") or "")
        kind = classify_model(model)
        if kind not in buckets:
            seen_ai += 1
            if i > 120000:
                break
            continue
        pending = [j for j in buckets[kind] if j["id"] not in filled]
        if not pending:
            seen_ai += 1
            continue
        job = pending[0]
        save_jpeg(to_pil(row["image"]), job["path"], quality=quality)
        filled[job["id"]] = model
        models.append({"id": job["id"], "model": model, "filter": kind})
        got[kind] += 1
        seen_ai += 1
        print(f"  saved {job['id']} filter={kind} model={model!r}", flush=True)
        if i > 120000:
            break
    return filled, models


def main():
    try:
        from datasets import load_dataset  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "eval:download:scenarios needs Python packages.\n"
            "  pip install datasets pillow\n"
            f"Import error: {exc}"
        ) from exc

    manifest = json.loads(MANIFEST.read_text())
    jobs = jobs_from_manifest(manifest["images"])
    if not jobs:
        print("no OpenFake scenario jobs", flush=True)
        return 0

    groups = defaultdict(list)
    for job in jobs:
        groups[(job["config"], job["split"])].append(job)

    all_models = []
    unverified = []
    from datasets import load_dataset

    for (config, split), group in groups.items():
        print(f"streaming ComplexDataLab/OpenFake {config}/{split} ...", flush=True)
        plain = [j for j in group if not j["filter"]]
        filtered = [j for j in group if j["filter"]]

        if plain:
            ds = load_dataset("ComplexDataLab/OpenFake", config, split=split, streaming=True)
            filled, models = fill_plain(ds, plain)
            all_models.extend(models)
            missing = [j for j in plain if j["id"] not in filled]
            for job in missing:
                print(f"  UNVERIFIED {job['id']}: stream ended before skip+slot", flush=True)

        if filtered:
            ds = load_dataset("ComplexDataLab/OpenFake", config, split=split, streaming=True)
            filled, models = fill_filters(ds, filtered)
            all_models.extend(models)
            by_cat = defaultdict(list)
            for job in filtered:
                cat = job["id"].rsplit("_", 1)[0]
                by_cat[cat].append(job)
            for cat, cat_jobs in by_cat.items():
                landed = sum(1 for j in cat_jobs if j["id"] in filled)
                if landed < 10:
                    why = (
                        f"OpenFake {config}/{split} filter yielded {landed}/10 after skip="
                        f"{min(j['skip'] for j in cat_jobs)}. Honest miss — not invented."
                    )
                    unverified.append({"category": cat, "landed": landed, "why": why})
                    print(f"  UNVERIFIED {cat}: {why}", flush=True)

    status_dir = DEST / "scenarios"
    status_dir.mkdir(parents=True, exist_ok=True)
    (status_dir / "openfake-meta.json").write_text(
        json.dumps({"models": all_models, "unverified": unverified}, indent=2) + "\n"
    )
    print(f"openfake saved {len(all_models)} files; unverified={len(unverified)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
