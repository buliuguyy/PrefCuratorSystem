"""Initial 4 candidate image generation.

Phase 2.5: prefers real placeholder images from `frontend/temporary_assets/`
when available, falls back to generated gradients otherwise. The real
implementation will swap this whole module for a text-to-image API call while
keeping the `generate_candidates(prompt, n)` signature.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.storage import store

# ─── real-image source (user-uploaded placeholders) ─────────────────────────

# Resolved from the backend module location so it works regardless of CWD.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_TEMP_ASSETS = _REPO_ROOT / "frontend" / "temporary_assets"

# Filenames in stable label order (1.png maps to slot 0/A, etc.)
_TEMP_FILES = ["1.png", "2.png", "3.png", "4.png"]


def _load_temporary_assets() -> list[bytes] | None:
    """Return cached bytes of the 4 user-uploaded placeholders, or None
    if any are missing."""
    if not _TEMP_ASSETS.is_dir():
        return None
    out: list[bytes] = []
    for fn in _TEMP_FILES:
        p = _TEMP_ASSETS / fn
        if not p.is_file():
            return None
        out.append(p.read_bytes())
    return out


# Load once at import time. If the user later adds/removes files, restart.
_REAL_CANDIDATES: list[bytes] | None = _load_temporary_assets()


# ─── synthetic fallback (gradient placeholders) ─────────────────────────────

_PALETTES: list[tuple[str, tuple[int, int, int], tuple[int, int, int]]] = [
    ("A · spooky cottage",   (24, 13, 38),    (181, 76, 209)),
    ("B · dark hall",        (10, 16, 23),    (90, 120, 150)),
    ("C · pastel cartoon",   (220, 200, 235), (255, 140, 160)),
    ("D · dome at dusk",     (60, 30, 60),    (240, 160, 110)),
]


def _make_placeholder(label: str, bg: tuple[int, int, int], fg: tuple[int, int, int],
                      seed: str) -> bytes:
    size = 512
    img = Image.new("RGB", (size, size), bg)
    pixels = img.load()
    h = hashlib.sha1(seed.encode()).digest()
    cx = 100 + h[0] % 312
    cy = 100 + h[1] % 312
    max_d = (size**2 + size**2) ** 0.5
    for y in range(0, size, 2):
        for x in range(0, size, 2):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = 1.0 - min(d / max_d * 1.3, 1.0)
            r = int(bg[0] + (fg[0] - bg[0]) * t)
            g = int(bg[1] + (fg[1] - bg[1]) * t)
            b = int(bg[2] + (fg[2] - bg[2]) * t)
            for dx in (0, 1):
                for dy in (0, 1):
                    if x + dx < size and y + dy < size:
                        pixels[x + dx, y + dy] = (r, g, b)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    draw.text((24, size - 56), label, fill=(255, 255, 255), font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ─── public api ─────────────────────────────────────────────────────────────


def generate_candidates(prompt: str, n: int = 4) -> list[str]:
    """Generate `n` candidate images, store them, return asset ids."""
    n = max(1, min(n, 4))
    ids: list[str] = []

    if _REAL_CANDIDATES is not None:
        for i in range(n):
            asset = store.put(_REAL_CANDIDATES[i])
            ids.append(asset.id)
        return ids

    # synthetic fallback
    for i in range(n):
        label, bg, fg = _PALETTES[i]
        png = _make_placeholder(
            label=f"{label}  ·  '{prompt[:40]}'",
            bg=bg, fg=fg,
            seed=f"{prompt}:{i}",
        )
        asset = store.put(png)
        ids.append(asset.id)
    return ids
