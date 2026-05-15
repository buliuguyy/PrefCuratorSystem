"""Smart-tagging service client.

Real impl: calls a vision LLM (defaults to gpt-5.4-mini via the OpenAI-compatible
endpoint in `.env`) with the curator-style aesthetic-analysis prompt below.
Parses the `<Dim>kw, kw | <Dim>kw...` response into a `Dict[str, List[str]]`.

Mock fallback: when `OPENAI_API_KEY` is still the placeholder or the real call
fails, returns deterministic hardcoded tags from hash-indexed pools so the
frontend keeps working offline.

Dimensions are *per-image dynamic* — the VLM picks 3–7 relevant ones from a
9-element pool. The frontend tolerates novel dimension names (see
`SmartTagPopover.accentFor`).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import re
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# ─── curator prompt (verbatim from user spec) ──────────────────────────────

CURATOR_PROMPT = """# Role
You are a visual aesthetics curator with a keen eye for detail. You are simulating a user who is deeply appreciating the most satisfying and attractive aspects of an image.

# Task
Analyze the provided image and describe its most striking aesthetic features.
**Crucially, you must adapt the length of your description to the visual complexity of the image:**
- If a dimension is **visually rich and complex** (e.g., an intricate oil painting or a detailed sci-fi scene), provide a **comprehensive list** of keywords to capture every nuance.
- If a dimension is **simple or clean** (e.g., a minimalist icon), keep the description **concise and direct**.

# Guidelines
1. **Select Relevant Dimensions Only:** Choose 3-7 dimensions from the pool below that best represent the image's appeal. Do not force irrelevant dimensions.
2. **Adaptive Depth (No Word Limit):** Do not restrict yourself to a fixed number of keywords.
   - For rich features: Go deep (e.g., "<Texture>Cracked oil paint, Visible brushstrokes, Heavy impasto, Canvas grain, Rough tactile finish...").
   - For simple features: Keep it short (e.g., "<Background>Solid white").
3. **Aesthetic Vocabulary:** Use evocative, appreciative, and specific terms that a designer or artist would use to praise the image.

# Dimension Pool (Reference only, you can add more if needed)
<Subject>, <Style>, <Color>, <Lighting>, <Composition>, <Texture>, <Mood>, <Detail>, <Atmosphere>

# Output Format Rule (Strictly Follow)
Output the selected dimensions in a single line or block using the following format:
<Dimension Name>Keyword, Keyword, Keyword... | <Dimension Name>Keyword, Keyword...

# Example Outputs
*Example 1 (Complex Fantasy Landscape):*
<Subject>Ancient glowing ruins, Overgrown mossy architecture, Cascading waterfalls, Ethereal spirit figures | <Lighting>Bioluminescent blue glow, Soft moonbeams piercing through canopy, Dappled forest light, Mystical ambiance, Volumetric rays | <Texture>Rough stone masonry, Velvety moss, Rippling water surface, Mist-covered foliage | <Color>Deep emerald greens, Sapphire blue highlights, Earthy browns, Magic teal | <Mood>Enchanted, Serene, Mysterious, Ancient, Dreamlike

*Example 2 (Minimalist Logo):*
<Subject>Abstract geometric fox head | <Style>Flat vector art, Modern minimalism | <Color>Vibrant gradient orange, Pure white | <Composition>Symmetrical balance, Clean negative space

# Now, please curate the aesthetic highlights of the image provided:"""

# ─── mock fallback pools (kept for offline / no-key dev) ───────────────────

_TAG_POOLS: dict[str, list[list[str]]] = {
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
_DEFAULT_MOCK_DIMS = ["Color", "Style", "Texture", "Lighting", "Mood"]


def _has_real_credentials() -> bool:
    """True if the .env has been filled with what looks like a real API key.
    Reads `raw_openai_api_key` (direct-to-OpenAI key, no proxy)."""
    key = settings.raw_openai_api_key or ""
    if not key:
        return False
    # Default placeholder from .env.example is "sk-replace-me"
    if key.startswith("sk-replace"):
        return False
    if len(key) < 20:
        return False
    return True


def _seed_int(image_bytes: bytes, seed_hint: Optional[str]) -> int:
    """Stable int derived from either an explicit hint string or the image bytes."""
    src = seed_hint.encode() if seed_hint else image_bytes
    return int(hashlib.sha1(src).hexdigest(), 16)


def _mock_tag(
    image_bytes: bytes,
    dimensions: list[str],
    seed_hint: Optional[str],
) -> dict[str, list[str]]:
    seed = _seed_int(image_bytes, seed_hint)
    out: dict[str, list[str]] = {}
    for dim in dimensions:
        if dim not in _TAG_POOLS:
            continue
        pool = _TAG_POOLS[dim]
        out[dim] = pool[seed % len(pool)]
    return out


# ─── response parser ───────────────────────────────────────────────────────


def parse_vlm_response(text: str) -> dict[str, list[str]]:
    """Parse `<Dim>kw, kw, kw | <Dim>kw...` format into a dict.

    Tolerant of:
      - leading / trailing prose around the structured block
      - newlines between `<Dim>` blocks (single newlines kept as inline)
      - extra spaces, missing trailing `|`
      - markdown wrappers (```...```)
    """
    out: dict[str, list[str]] = {}
    # capture <Word>content_until_next_<_or_end>
    for match in re.finditer(r"<([A-Za-z][A-Za-z _-]*)>\s*([^<]+)", text, flags=re.DOTALL):
        dim = match.group(1).strip()
        content = match.group(2)
        # Cut trailing prose: anything after a blank-line break is presumed
        # outro text from the model and dropped.
        content = re.split(r"\n\s*\n", content, maxsplit=1)[0]
        # Drop any code-fence remnants that snuck in.
        if "```" in content:
            content = content.split("```", 1)[0]
        # Strip enclosing whitespace + trailing pipe separator.
        content = content.strip().rstrip("|").rstrip()
        # Split on commas; trim each keyword.
        kws = [k.strip() for k in content.split(",") if k.strip()]
        if kws:
            out[dim] = kws
    return out


# ─── real VLM call ─────────────────────────────────────────────────────────


def _extract_message_content(body: dict) -> Optional[str]:
    """Pull the assistant text out of an OpenAI chat-completions response.
    Tolerates both string `content` and gpt-5 block-style `content` (list of
    `{type:"text", text:"..."}`)."""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        return None
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for blk in content:
            if isinstance(blk, dict) and isinstance(blk.get("text"), str):
                parts.append(blk["text"])
        if parts:
            return "".join(parts)
    return None


async def _real_tag(image_bytes: bytes, content_type: str = "image/png") -> dict[str, list[str]]:
    """Single VLM call with the curator prompt + image.

    Uses raw httpx against the OpenAI-compatible `/v1/chat/completions`
    endpoint. Switched away from the AsyncOpenAI SDK because the nuwaflux
    proxy occasionally returned bodies the SDK surfaced as bare strings
    (`'str' object has no attribute 'choices'`). Raw httpx lets us log the
    real proxy response when things go wrong."""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    base = settings.raw_openai_base_url.rstrip("/")
    # Auto-append /v1 if the base URL lacks it (see prompt_expander_client).
    if not (base.endswith("/v1") or "/v1/" in base):
        base = base + "/v1"
    url = f"{base}/chat/completions"
    payload = {
        "model": settings.vlm_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": CURATOR_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{content_type};base64,{b64}"},
                    },
                ],
            }
        ],
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.raw_openai_api_key}",
    }

    client_kwargs: dict = {"timeout": 90.0}
    if settings.raw_openai_proxy:
        client_kwargs["proxy"] = settings.raw_openai_proxy
    async with httpx.AsyncClient(**client_kwargs) as client:
        r = await client.post(url, headers=headers, json=payload)

    if r.status_code != 200:
        log.warning("VLM: HTTP %d — body: %s", r.status_code, r.text[:300])
        return {}

    try:
        body = r.json()
    except ValueError:
        log.warning("VLM: non-JSON response — first 300 chars: %r", r.text[:300])
        return {}

    text = _extract_message_content(body)
    if text is None:
        log.warning(
            "VLM: unrecognized response shape — keys: %s; sample: %s",
            list(body.keys()) if isinstance(body, dict) else type(body).__name__,
            str(body)[:300],
        )
        return {}

    parsed = parse_vlm_response(text.strip())
    if not parsed:
        log.warning(
            "VLM returned text but no <Dim>... blocks parsed; first 200 chars: %r",
            text[:200],
        )
    return parsed


# ─── public api ────────────────────────────────────────────────────────────


async def smart_tag(
    image_bytes: bytes,
    dimensions: Optional[list[str]] = None,
    *,
    content_type: str = "image/png",
    seed_hint: Optional[str] = None,
) -> dict[str, list[str]]:
    """Tag a whole image. Real VLM if credentials are configured; otherwise
    deterministic mock. `seed_hint` lets callers (e.g., the asset id) make the
    mock output stable across runs."""
    if _has_real_credentials():
        try:
            tags = await _real_tag(image_bytes, content_type=content_type)
            if tags:
                return tags
            log.warning("VLM returned no parseable tags — falling back to mock")
        except Exception as e:
            # Surface the real exception class + args. Bare str(e) was empty
            # for several httpx/proxy errors, which made debugging impossible.
            log.warning(
                "VLM call failed (%s: %r, args=%r) — falling back to mock",
                type(e).__name__, str(e), getattr(e, "args", ()),
            )
    return _mock_tag(image_bytes, dimensions or _DEFAULT_MOCK_DIMS, seed_hint)


async def tag_cropped(
    image_bytes: bytes,
    dimensions: Optional[list[str]] = None,
    *,
    seed_hint: Optional[str] = None,
) -> dict[str, list[str]]:
    """Tag a cropped ROI (e.g. lasso selection). Same impl as smart_tag — the
    distinction matters only because lasso pipes the cropped sub-image in."""
    return await smart_tag(image_bytes, dimensions, seed_hint=seed_hint)
