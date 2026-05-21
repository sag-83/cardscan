#!/usr/bin/env python3
"""Build PWA / iPhone icons from Delta Diamonds source artwork (strips checkerboard, edge-to-edge)."""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "assets" / "Gemini_Generated_Image_g0adsvg0adsvg0ad-dc36fb30-0962-4cbd-8805-12bfee6f49b4.png"
OUT = ROOT / "public"
BG = (14, 14, 18)


def strip_checker(im: Image.Image) -> Image.Image:
    arr = np.array(im.convert("RGB"), dtype=np.int16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    spread = np.maximum.reduce([r, g, b]) - np.minimum.reduce([r, g, b])
    mean = (r + g + b) // 3
    checker = (spread < 18) & (mean > 188)
    arr[checker] = BG
    return Image.fromarray(arr.astype(np.uint8))


def crop_artwork(im: Image.Image) -> Image.Image:
    """Bounding box of the icon on the source canvas (excludes checkerboard only)."""
    arr = np.array(im.convert("RGB"))
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    spread = np.maximum.reduce([r, g, b]) - np.minimum.reduce([r, g, b])
    mean = (r.astype(int) + g.astype(int) + b.astype(int)) // 3
    checker = (spread < 18) & (mean > 188)
    ys, xs = np.where(~checker)
    return im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def cover_square(im: Image.Image, size: int) -> Image.Image:
    cw, ch = im.size
    scale = max(size / cw, size / ch)
    nw, nh = int(round(cw * scale)), int(round(ch * scale))
    scaled = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - size) // 2
    top = (nh - size) // 2
    return scaled.crop((left, top, left + size, top + size))


def build(src: Path = DEFAULT_SRC) -> None:
    raw = Image.open(src)
    art = strip_checker(crop_artwork(raw))
    icons_dir = OUT / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    sizes: dict[str, int] = {
        "apple-touch-icon.png": 180,
        "apple-touch-icon-120.png": 120,
        "apple-touch-icon-152.png": 152,
        "apple-touch-icon-167.png": 167,
        "app-icon-192.png": 192,
        "app-icon.png": 512,
        "favicon.png": 32,
    }
    for name, sz in sizes.items():
        cover_square(art, sz).save(OUT / name)

    for sz in (32, 180, 192, 512):
        cover_square(art, sz).save(icons_dir / f"icon-{sz}.png")

    cover_square(art, 1024).save(icons_dir / "source.png")
    print(f"Built {len(sizes)} icons from {src.name} (crop {art.size} → cover fill)")


if __name__ == "__main__":
    src = Path(os.environ.get("ICON_SRC", DEFAULT_SRC))
    if not src.is_file():
        raise SystemExit(f"Missing source: {src}")
    build(src)
