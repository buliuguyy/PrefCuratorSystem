"""Smart-tagging service client.

Phase 1: returns hardcoded tags per dimension based on a simple hash of the
asset id, so multiple assets produce different (but stable) tag sets. The real
implementation will call GPT-5.4 with the image and a structured-JSON prompt.

The public interface — `smart_tag(asset_id, dimensions)` and
`tag_cropped(image_bytes, dimensions)` — is stable across mock/real.
"""

from __future__ import annotations

import hashlib

from app.schemas import Dimension


# Pools of tags per dimension. The screenshot examples informed Image A's
# pool; the rest are realistic-sounding alternatives so we get variety.
_TAG_POOLS: dict[Dimension, list[list[str]]] = {
    "Color": [
        ["warm", "glowing", "amber"],
        ["cool", "moonlit", "blue-tinted"],
        ["pastel", "soft pink", "cream"],
        ["fiery", "sunset orange", "ember"],
    ],
    "Style": [
        ["fantasy", "magical realism", "painterly illustration"],
        ["gothic", "moody oil paint", "low-light cinematic"],
        ["pixel art", "cartoon", "classic video game"],
        ["dreamy concept art", "matte painting"],
    ],
    "Texture": [
        ["rough wood", "thatched", "weathered stone"],
        ["smooth marble", "polished granite"],
        ["flat shaded", "low-res pixel"],
        ["billowy", "fluffy", "painterly texture"],
    ],
    "Lighting": [
        ["warm candlelight", "fairy-lit", "lantern glow"],
        ["dim moonlight", "rim lighting"],
        ["bright daylight", "even diffuse"],
        ["sunset", "golden hour", "fiery backlighting"],
    ],
    "Mood": [
        ["mystical", "spooky but charming", "Halloween", "dreamy twilight"],
        ["austere", "lonely", "haunted"],
        ["cheerful", "whimsical", "playful"],
        ["serene", "majestic", "dreamlike"],
    ],
    "Subject": [
        ["witch's cottage", "twisted tree"],
        ["empty corridor", "fireplace"],
        ["Victorian house", "porch swing"],
        ["cloud formations", "stone dome"],
    ],
    "Composition": [
        ["centered subject", "low horizon"],
        ["one-point perspective", "leading lines"],
        ["isometric", "flat front view"],
        ["floating in clouds", "high horizon"],
    ],
}


def _idx_for(asset_id: str, dim: Dimension) -> int:
    h = int(hashlib.sha1(f"{asset_id}:{dim}".encode()).hexdigest(), 16)
    return h % len(_TAG_POOLS[dim])


def smart_tag(asset_id: str, dimensions: list[Dimension]) -> dict[Dimension, list[str]]:
    """Return suggested tags for each requested dimension of an asset."""
    return {dim: _TAG_POOLS[dim][_idx_for(asset_id, dim)] for dim in dimensions}


def tag_cropped(
    image_bytes: bytes,  # noqa: ARG001  used by real impl
    dimensions: list[Dimension],
    seed_hint: str = "",
) -> dict[Dimension, list[str]]:
    """Tag a cropped ROI (e.g. lasso selection). Mock uses a hash of the bytes."""
    import hashlib as _h
    seed = _h.sha1(image_bytes + seed_hint.encode()).hexdigest()
    return {dim: _TAG_POOLS[dim][int(seed, 16) % len(_TAG_POOLS[dim])] for dim in dimensions}
