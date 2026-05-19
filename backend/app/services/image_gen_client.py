"""Initial N candidate image generation.

Pipeline (strict 1:1 fan-out — N variants ⇒ N images, one per variant):
  1. Expand the user prompt into N diverse variants via prompt_expander_client
     (GPT-mini with an art-director system prompt). Each variant pushes on a
     different unspecified aesthetic dimension.
  2. For each variant, call Gemini 3 Pro Image ("nano banana pro") via
     gemini_image_client EXACTLY ONCE. The N Gemini calls run concurrently
     via asyncio.gather, each with its own distinct variant prompt.
  3. Any variant whose Gemini call fails (no creds / API error / no image
     in response) is replaced INDIVIDUALLY with a placeholder so the user
     always gets N tiles. Successful variants are NOT swapped out.

We deliberately do NOT ask Gemini for multiple samples per call. One
variant ↔ one image keeps the per-tile prompt traceable in the UI.

Placeholder ordering: prefers the 4 user-uploaded images in
`frontend/temporary_assets/` if present; otherwise generates synthetic
gradient PNGs.

Returns `list[CandidateOut]` with the asset id paired with the variant prompt
that produced it (so the frontend can surface "this tile was made from
prompt X" in the inspiration grid).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.services import (
    gemini_image_client,
    persona_summary_client,
    prompt_expander_client,
)
from app.storage import store

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CandidateOut:
    asset_id: str
    prompt: str
    generator: str  # "gemini" | "placeholder" | "synthetic"


# ─── placeholder source (user-uploaded images) ─────────────────────────────

_REPO_ROOT = Path(__file__).resolve().parents[3]
_TEMP_ASSETS = _REPO_ROOT / "frontend" / "temporary_assets"
_TEMP_FILES = ["1.png", "2.png", "3.png", "4.png"]


def _load_temporary_assets() -> list[bytes] | None:
    if not _TEMP_ASSETS.is_dir():
        return None
    out: list[bytes] = []
    for fn in _TEMP_FILES:
        p = _TEMP_ASSETS / fn
        if not p.is_file():
            return None
        out.append(p.read_bytes())
    return out


_REAL_CANDIDATES: list[bytes] | None = _load_temporary_assets()


# ─── synthetic fallback ─────────────────────────────────────────────────────

_PALETTES: list[tuple[str, tuple[int, int, int], tuple[int, int, int]]] = [
    ("A · spooky cottage",   (24, 13, 38),    (181, 76, 209)),
    ("B · dark hall",        (10, 16, 23),    (90, 120, 150)),
    ("C · pastel cartoon",   (220, 200, 235), (255, 140, 160)),
    ("D · dome at dusk",     (60, 30, 60),    (240, 160, 110)),
]


def _make_synthetic(label: str, bg: tuple[int, int, int], fg: tuple[int, int, int],
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


def _fallback_bytes(idx: int, variant_prompt: str) -> tuple[bytes, str]:
    """Return placeholder PNG bytes + a tag describing which fallback was used."""
    if _REAL_CANDIDATES is not None:
        return _REAL_CANDIDATES[idx % len(_REAL_CANDIDATES)], "placeholder"
    label, bg, fg = _PALETTES[idx % len(_PALETTES)]
    png = _make_synthetic(
        label=f"{label}  ·  '{variant_prompt[:40]}'",
        bg=bg, fg=fg,
        seed=f"{variant_prompt}:{idx}",
    )
    return png, "synthetic"


# ─── public api ─────────────────────────────────────────────────────────────


async def _gen_one(idx: int, variant_prompt: str) -> CandidateOut:
    """Generate ONE image for ONE variant prompt. Falls back to a placeholder
    on Gemini failure."""
    log.info("image_gen[%d] → gemini prompt: %s", idx, variant_prompt[:120])
    img_bytes = await gemini_image_client.generate_image(variant_prompt)
    generator = "gemini"
    if img_bytes is None:
        img_bytes, generator = _fallback_bytes(idx, variant_prompt)
        log.info("image_gen[%d] ← FALLBACK (%s)", idx, generator)
    else:
        log.info("image_gen[%d] ← gemini ok (%d bytes)", idx, len(img_bytes))
    # Gemini may return PNG or JPEG; default to image/png since that's what
    # the placeholder path uses. Pillow re-encodes to PNG only on synthetic.
    content_type = "image/png"
    asset = store.put(img_bytes, content_type=content_type)
    return CandidateOut(asset_id=asset.id, prompt=variant_prompt, generator=generator)


async def _resolve_persona_summary(
    user_id: str | None,
    persona_id: str | None,
    recent_prompt: str,
) -> str | None:
    """Look up (or derive + cache) the preference summary for an active
    persona. Returns None silently on any miss so the caller can fall back
    to unbiased expansion."""
    if not user_id or not persona_id:
        return None
    # Local import keeps this module decoupled from persona storage at import
    # time (so the smoke tests don't have to spin up the storage dir).
    from app.persona_store import personas as persona_store

    persona = persona_store.get(user_id, persona_id)
    if persona is None:
        log.info("image_gen: persona %s not found — unbiased expansion", persona_id)
        return None
    if persona.prompt_summary:
        return persona.prompt_summary
    if not persona.concepts:
        return None
    concept_payload = [
        {"sign": c.sign, "dimension": c.dimension, "tag": c.tag}
        for c in persona.concepts
    ]
    summary = await persona_summary_client.derive_summary(
        concepts=concept_payload, recent_prompt=recent_prompt,
    )
    if summary:
        persona_store.set_prompt_summary(user_id, persona_id, summary)
    return summary


async def generate_candidates(
    prompt: str,
    n: int = 4,
    user_id: str | None = None,
    persona_id: str | None = None,
) -> list[CandidateOut]:
    """Generate exactly `n` candidate images via prompt-expand → fan-out Gemini.

    One image per variant prompt. Slot i in the returned list corresponds to
    variant i — the order is preserved so frontend tile order matches the
    prompt ordering produced by the expander."""
    n = max(1, min(n, 4))
    persona_summary = await _resolve_persona_summary(user_id, persona_id, prompt)
    variants = await prompt_expander_client.expand(
        prompt, n, persona_summary=persona_summary,
    )
    # Pad / trim defensively (expander guarantees this but it's cheap insurance).
    while len(variants) < n:
        variants.append(prompt)
    variants = variants[:n]

    log.info("image_gen: expanded %r into %d variant(s)", prompt[:60], len(variants))
    for i, v in enumerate(variants):
        log.info("  variant[%d]: %s", i, v[:160])

    # asyncio.gather preserves the order of the input task list, so
    # results[i] is guaranteed to be the image for variants[i].
    tasks = [_gen_one(i, v) for i, v in enumerate(variants)]
    results = await asyncio.gather(*tasks)
    return list(results)


async def generate_candidates_stream(
    prompt: str,
    n: int = 4,
    user_id: str | None = None,
    persona_id: str | None = None,
):
    """Async generator variant of generate_candidates. Yields (idx, CandidateOut)
    pairs in the order each Gemini call FINISHES (not the variant order), so
    the frontend can render images on the canvas as they land instead of
    waiting for the slowest variant.

    Total still equals `n`. Each fallback failure is yielded individually so
    one slow Gemini call doesn't block earlier successes."""
    n = max(1, min(n, 4))
    persona_summary = await _resolve_persona_summary(user_id, persona_id, prompt)
    variants = await prompt_expander_client.expand(
        prompt, n, persona_summary=persona_summary,
    )
    while len(variants) < n:
        variants.append(prompt)
    variants = variants[:n]

    log.info("image_gen[stream]: expanded %r into %d variant(s)", prompt[:60], len(variants))
    for i, v in enumerate(variants):
        log.info("  variant[%d]: %s", i, v[:160])

    async def _with_idx(i: int, v: str) -> tuple[int, CandidateOut]:
        return i, await _gen_one(i, v)

    tasks = [asyncio.create_task(_with_idx(i, v)) for i, v in enumerate(variants)]
    for fut in asyncio.as_completed(tasks):
        yield await fut
