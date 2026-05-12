"""Initial 4 candidate image generation.

Phase 1: mock — generates 4 visually-distinct placeholder PNGs so the UI has
something to display. Later phases will swap the impl for a real text-to-image
service while preserving this interface (`generate_candidates(prompt, n)`).
"""

from __future__ import annotations

import hashlib
import io

from PIL import Image, ImageDraw, ImageFont

from app.storage import store


# 4 distinct palettes echoing the screenshot vibes (witch-house / hall / cartoon / dome)
_PALETTES: list[tuple[str, tuple[int, int, int], tuple[int, int, int]]] = [
    ("A · spooky cottage",   (24, 13, 38),    (181, 76, 209)),
    ("B · dark hall",        (10, 16, 23),    (90, 120, 150)),
    ("C · pastel cartoon",   (220, 200, 235), (255, 140, 160)),
    ("D · dome at dusk",     (60, 30, 60),    (240, 160, 110)),
]


def _make_placeholder(label: str, bg: tuple[int, int, int], fg: tuple[int, int, int],
                      seed: str) -> bytes:
    """Generate a 512x512 PNG with a gradient + label so each candidate looks distinct."""
    size = 512
    img = Image.new("RGB", (size, size), bg)
    pixels = img.load()
    # cheap radial gradient toward fg using a deterministic hash for variation
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
            pixels[x, y] = (r, g, b)
            if x + 1 < size:
                pixels[x + 1, y] = (r, g, b)
            if y + 1 < size:
                pixels[x, y + 1] = (r, g, b)
                if x + 1 < size:
                    pixels[x + 1, y + 1] = (r, g, b)

    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    draw.text((24, size - 56), label, fill=(255, 255, 255), font=font)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def generate_candidates(prompt: str, n: int = 4) -> list[str]:
    """Generate `n` placeholder candidate images, store them, return asset ids."""
    n = max(1, min(n, len(_PALETTES)))
    ids: list[str] = []
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
