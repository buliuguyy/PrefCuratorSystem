"""Smart-tagging service client (Phase 9).

Emits a flat list of *coarse* IP-Composer-aligned concepts per image, each
with a `scope` (local / global) and — for local — a normalized `anchor`
in [0,1]^2 marking where that concept lives on the image. The frontend
renders these as floating, zoom-invariant pills anchored to the image.

Concept granularity follows IP-Composer (Dorfman et al. 2025): narrow
named categories when one fits (dog / vehicle / flower / fur / pattern),
otherwise fall back to broad slots (object / material / scene / lighting
/ style / mood / composition / color). Keyword sub-lists are intentionally
gone — each tag IS a single concept.

Mock fallback: when no real OPENAI_API_KEY is configured, returns a
small deterministic concept set with stub anchors derived from a hash
of the asset id, so the frontend keeps working offline.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import math
import re
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# ─── prompt ────────────────────────────────────────────────────────────────

# Reference vocabulary the VLM should prefer. Narrow named categories
# (dog/vehicle/flower) when a clean named category fits the image;
# broad fallbacks for anything else. Matches the rank-tier table the
# downstream concept-probe step (system_msg in ip_composer pipeline)
# expects, so the smart-tag output flows straight into the slot picker
# without needing renames.
NARROW_VOCAB = [
    "dog", "cat", "bird", "horse", "animal",
    "person", "face", "outfit", "pose", "expression",
    "vehicle", "building", "flower", "fruit", "food",
    "tree", "plant",
]
BROAD_VOCAB = [
    "object", "subject",
    "fur", "pattern", "material", "texture",
    "scene", "background", "layout",
    "lighting", "time of day",
    "color", "color palette",
    "style", "mood", "atmosphere", "composition",
]

GLOBAL_VOCAB = {
    "lighting", "time of day",
    "color", "color palette",
    "style", "mood", "atmosphere", "composition",
    "background", "scene", "layout",
}

CURATOR_PROMPT = """# Role
You configure smart-tagging for the IP-Composer image-fusion pipeline (Dorfman et al., SIGGRAPH 2025). Each tag you emit becomes one selectable concept the user can fuse INTO a new image from this reference.

# Task
Pick 3–8 coarse concepts that best describe the image's fusable axes, then for each one report (a) whether it's a global concept or a local one, and (b) for local concepts only, a normalized anchor (x, y) marking the most representative spot on the image (origin (0, 0) = top-left, (1, 1) = bottom-right).

# Concept granularity (IP-Composer-aligned)
Use the NARROWEST clean named category that still covers the slot image. Prefer the narrow vocab when something fits; fall back to broad when nothing narrower applies.

NARROW (use when a clean named category fits):
  dog, cat, bird, horse, animal, person, face, outfit, pose, expression,
  vehicle, building, flower, fruit, food, tree, plant
BROAD (fallbacks — use only when no narrow term fits):
  object, subject, fur, pattern, material, texture, scene, background, layout,
  lighting, time of day, color, color palette, style, mood, atmosphere, composition

Examples:
  photo of a beagle on grass → "dog" (narrow) + "lighting" (global)
  photo of a ceramic mug with floral pattern → "object" (or "mug" if you must) + "pattern"
  abstract art piece → "style" (global) + "color palette" (global) + "composition" (global)
  sunset over ocean → "lighting" (global) + "scene"

NEVER emit multi-word descriptive phrases ("a beagle puppy", "warm sunset lighting"). Single canonical concept words only. Strip adjectives and instance qualifiers.

# Scope rules
"global" — concepts that are properties of the whole image with no specific anchor point. Use for:
  lighting, time of day, color, color palette, style, mood, atmosphere, composition, background, scene, layout
"local" — concepts tied to a specific object or region in the image:
  every other concept (dog, person, outfit, vehicle, flower, object, fur, pattern, material, etc.)

Local concepts MUST have an anchor (x and y in [0,1]). The anchor should sit ON the visual instance of the concept (center of the dog's body, on the patterned surface, etc.), NOT in empty space.
Global concepts MUST NOT have an anchor.

# Output (STRICT JSON, no prose, no markdown fence)
{
  "tags": [
    {"concept": "<canonical word>", "scope": "local" | "global", "anchor": [x, y] | null}
  ]
}

Constraints:
  - 3 ≤ len(tags) ≤ 8. Pick what's actually salient; don't pad.
  - At most one tag per concept name (no duplicates).
  - anchor is [x, y] for local (both in [0,1]), null for global.
  - Output JSON ONLY. No code fence, no leading prose.
"""

# ─── mock fallback ─────────────────────────────────────────────────────────

# Small rotating concept set keyed by hash(asset_id). Enough variety to
# verify the frontend overlay layout without a real VLM key.
_MOCK_CONCEPT_SETS: list[list[tuple[str, str, tuple[float, float] | None]]] = [
    [
        ("dog", "local", (0.5, 0.6)),
        ("scene", "local", (0.5, 0.2)),
        ("lighting", "global", None),
    ],
    [
        ("object", "local", (0.5, 0.55)),
        ("pattern", "local", (0.3, 0.5)),
        ("color palette", "global", None),
    ],
    [
        ("person", "local", (0.5, 0.5)),
        ("outfit", "local", (0.5, 0.7)),
        ("expression", "local", (0.5, 0.3)),
        ("mood", "global", None),
    ],
    [
        ("flower", "local", (0.45, 0.55)),
        ("color palette", "global", None),
        ("lighting", "global", None),
    ],
    [
        ("vehicle", "local", (0.5, 0.55)),
        ("scene", "local", (0.5, 0.3)),
        ("style", "global", None),
    ],
]


def _has_real_credentials() -> bool:
    key = settings.raw_openai_api_key or ""
    if not key:
        return False
    if key.startswith("sk-replace"):
        return False
    if len(key) < 20:
        return False
    return True


def _seed_int(image_bytes: bytes, seed_hint: Optional[str]) -> int:
    src = seed_hint.encode() if seed_hint else image_bytes
    return int(hashlib.sha1(src).hexdigest(), 16)


def _mock_tag(image_bytes: bytes, seed_hint: Optional[str]) -> list[dict]:
    seed = _seed_int(image_bytes, seed_hint)
    bucket = _MOCK_CONCEPT_SETS[seed % len(_MOCK_CONCEPT_SETS)]
    return [
        {"concept": c, "scope": s, "anchor": list(a) if a is not None else None}
        for (c, s, a) in bucket
    ]


# ─── validation + cleanup ──────────────────────────────────────────────────


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


def _dejitter(tags: list[dict]) -> list[dict]:
    """Offset local anchors that land within 0.08 normalized distance of
    an already-placed anchor. Pushes successive collisions outward in a
    short logarithmic spiral so the floating pills don't stack on top
    of each other."""
    placed: list[tuple[float, float]] = []
    for t in tags:
        if t.get("scope") != "local":
            continue
        a = t.get("anchor")
        if not isinstance(a, list) or len(a) != 2:
            continue
        x, y = float(a[0]), float(a[1])
        for px, py in placed:
            if math.hypot(x - px, y - py) < 0.08:
                # nudge along a deterministic spiral until clear
                for k in range(1, 12):
                    angle = k * 1.2
                    r = 0.06 + 0.03 * k
                    nx = _clamp01(px + r * math.cos(angle))
                    ny = _clamp01(py + r * math.sin(angle))
                    if all(math.hypot(nx - q[0], ny - q[1]) >= 0.08 for q in placed):
                        x, y = nx, ny
                        break
                break
        placed.append((x, y))
        t["anchor"] = [x, y]
    return tags


def _normalize(raw: list[dict]) -> list[dict]:
    """Coerce a raw tag list to the canonical ConceptTag shape.

    - drops malformed entries
    - lowercases + trims concept names
    - dedupes by concept name (keeps first occurrence)
    - forces global concepts to have anchor=None
    - clamps local anchors into [0,1]^2, drops entries with missing anchors
    - re-routes "global-vocab" concepts that the model mislabeled as local
    """
    out: list[dict] = []
    seen: set[str] = set()
    for t in raw:
        if not isinstance(t, dict):
            continue
        concept = t.get("concept")
        scope = t.get("scope")
        anchor = t.get("anchor")
        if not isinstance(concept, str) or not concept.strip():
            continue
        concept = concept.strip().lower()
        if concept in seen:
            continue
        if scope not in ("local", "global"):
            scope = "global" if concept in GLOBAL_VOCAB else "local"
        if concept in GLOBAL_VOCAB and scope == "local":
            scope = "global"
        if scope == "global":
            anchor = None
        else:
            if not (isinstance(anchor, (list, tuple)) and len(anchor) == 2):
                # local without anchor → place center as a defensive default
                anchor = [0.5, 0.5]
            try:
                x = _clamp01(float(anchor[0]))
                y = _clamp01(float(anchor[1]))
            except (TypeError, ValueError):
                x, y = 0.5, 0.5
            anchor = [x, y]
        out.append({"concept": concept, "scope": scope, "anchor": anchor})
        seen.add(concept)
    # cap at 8 (prompt asks for ≤8 but be defensive)
    out = out[:8]
    return _dejitter(out)


# ─── response parsing ──────────────────────────────────────────────────────


def _strip_code_fence(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        # ```json\n...\n``` or ```\n...\n```
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s)
    return s.strip()


def parse_vlm_response(text: str) -> list[dict]:
    """Parse the VLM's JSON output into a list of raw tag dicts.

    Tolerates:
      - leading/trailing prose around the JSON object
      - markdown code fences
      - object directly returned, or wrapped under "tags"
    """
    s = _strip_code_fence(text)
    # Pull out the first {...} or [...] block if the model added prose.
    # Prefer whichever appears first so a bare list response isn't
    # mistakenly unwrapped down to its first inner object.
    if not (s.startswith("{") or s.startswith("[")):
        obj_m = re.search(r"\{.*\}", s, re.DOTALL)
        arr_m = re.search(r"\[.*\]", s, re.DOTALL)
        # take whichever matched earlier in the string
        if obj_m and arr_m:
            pick = obj_m if obj_m.start() < arr_m.start() else arr_m
        else:
            pick = obj_m or arr_m
        if pick:
            s = pick.group(0)
    try:
        body = json.loads(s)
    except json.JSONDecodeError:
        log.warning("VLM JSON parse failed; head=%r", s[:200])
        return []
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        tags = body.get("tags")
        if isinstance(tags, list):
            return tags
    return []


def _extract_message_content(body: dict) -> Optional[str]:
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


# ─── real VLM call ─────────────────────────────────────────────────────────


async def _real_tag(image_bytes: bytes, content_type: str = "image/png") -> list[dict]:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    base = settings.raw_openai_base_url.rstrip("/")
    if not (base.endswith("/v1") or "/v1/" in base):
        base = base + "/v1"
    url = f"{base}/chat/completions"
    payload = {
        "model": settings.vlm_model,
        # Some OpenAI-compatible proxies honor this; the rest ignore it
        # and we fall back to text-parse anyway.
        "response_format": {"type": "json_object"},
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
        return []
    try:
        body = r.json()
    except ValueError:
        log.warning("VLM: non-JSON response — first 300 chars: %r", r.text[:300])
        return []
    text = _extract_message_content(body)
    if text is None:
        log.warning("VLM: unrecognized response shape — keys: %s",
                    list(body.keys()) if isinstance(body, dict) else type(body).__name__)
        return []
    raw = parse_vlm_response(text.strip())
    if not raw:
        log.warning("VLM returned text but no parseable tags; first 200 chars: %r", text[:200])
    return raw


# ─── public api ────────────────────────────────────────────────────────────


async def smart_tag(
    image_bytes: bytes,
    *,
    content_type: str = "image/png",
    seed_hint: Optional[str] = None,
) -> list[dict]:
    """Tag a whole image. Returns a list of dicts:
        [{"concept": str, "scope": "local"|"global", "anchor": [x,y]|null}]
    """
    if _has_real_credentials():
        try:
            raw = await _real_tag(image_bytes, content_type=content_type)
            if raw:
                return _normalize(raw)
            log.warning("VLM returned no parseable tags — falling back to mock")
        except Exception as e:
            log.warning("VLM call failed (%s: %r, args=%r) — falling back to mock",
                        type(e).__name__, str(e), getattr(e, "args", ()))
    return _normalize(_mock_tag(image_bytes, seed_hint))


async def tag_cropped(
    image_bytes: bytes,
    *,
    seed_hint: Optional[str] = None,
) -> list[dict]:
    """Tag a cropped ROI. Same call path as smart_tag — caller is responsible
    for rewriting anchors to (0.5, 0.5) since the lasso has already isolated
    the region of interest."""
    return await smart_tag(image_bytes, seed_hint=seed_hint)
