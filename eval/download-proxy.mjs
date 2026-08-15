#!/usr/bin/env node
/**
 * Download the public proxy set.
 *
 * Official / hard subset: OpenFake core/test (held-out generators).
 * Optional easy-real padding: seeded Lorem Picsum photographs.
 *
 * Community Forensics DALL·E extras are NOT downloaded. Those PNGs embed
 * generator ASCII that provenance would short-circuit without a visual win.
 *
 * Requires Python 3 with: pip install datasets pillow
 * Fails closed if OpenFake does not land at least 100 images per class.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "eval/data");

await mkdir(join(dest, "ai"), { recursive: true });
await mkdir(join(dest, "real"), { recursive: true });

const py = `
import json
import io
from pathlib import Path

dest = Path(r"${dest}")
(dest / "ai").mkdir(parents=True, exist_ok=True)
(dest / "real").mkdir(parents=True, exist_ok=True)

try:
    from datasets import load_dataset
    from PIL import Image
except ImportError as exc:
    raise SystemExit(
        "eval:download needs Python packages. Install with:\\n"
        "  pip install datasets pillow\\n"
        f"Import error: {exc}"
    ) from exc

manifest = []

# Easy-real padding only — not part of the official OpenFake proxy.
for pic_id in [237, 1015, 1025, 1035, 1043, 1062, 1074, 1084, 129, 201, 292, 338, 349, 365, 433, 452, 494, 548, 582, 593]:
    path = dest / "real" / f"picsum_{pic_id}.jpg"
    if not path.exists():
        import urllib.request
        urllib.request.urlretrieve(f"https://picsum.photos/id/{pic_id}/800/600", path)
    manifest.append({"path": str(path), "label": 0, "source": "picsum-easy-real"})

print("streaming ComplexDataLab/OpenFake core/test ...")
ds = load_dataset("ComplexDataLab/OpenFake", "core", split="test", streaming=True)
n_ai = 0
n_real = 0
target = 180
for i, row in enumerate(ds):
    label = row.get("label") or row.get("type") or ""
    lab = str(label).lower()
    is_ai = lab in {"fake", "ai", "synthetic", "1", "generated"}
    is_real = lab in {"real", "0", "authentic"}
    if not (is_ai or is_real):
        model = str(row.get("model") or "").lower()
        if model in {"real", "none", ""} and not is_ai:
            is_real = True
        else:
            is_ai = True
    if is_ai and n_ai >= target:
        continue
    if is_real and n_real >= target:
        continue
    img = row["image"]
    if hasattr(img, "convert"):
        pil = img.convert("RGB")
    else:
        pil = Image.open(io.BytesIO(img["bytes"])).convert("RGB")
    kind = "ai" if is_ai else "real"
    fname = f"openfake_{kind}_{n_ai if is_ai else n_real:04d}.jpg"
    path = dest / kind / fname
    pil.save(path, quality=88)
    manifest.append({
        "path": str(path),
        "label": 1 if is_ai else 0,
        "source": "openfake-core-test",
        "model": str(row.get("model") or ""),
    })
    if is_ai:
        n_ai += 1
    else:
        n_real += 1
    if n_ai >= target and n_real >= target:
        break
    if i > 8000:
        break

print(f"openfake saved ai={n_ai} real={n_real}")
if n_ai < 100 or n_real < 100:
    raise SystemExit(
        f"OpenFake download incomplete: ai={n_ai} real={n_real} (need >=100 each). "
        "Do not fall back to Picsum-only."
    )

(dest / "manifest.json").write_text(json.dumps(manifest, indent=2))
print("wrote", dest / "manifest.json", "n=", len(manifest))
`

await mkdir(join(root, "eval/.cache"), { recursive: true });
await writeFile(join(root, "eval/.cache/download_proxy.py"), py);

const child = spawn("python3", ["-c", py], { cwd: root, stdio: "inherit" });
const code = await new Promise((resolve) => child.on("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
