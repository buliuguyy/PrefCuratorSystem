"""Prompt expansion service.

Given a single user prompt, asks a small language model (gpt-5.4-mini by
default) to rewrite it as N variants that *diverge* on aesthetic dimensions
the original prompt left unconstrained. The intent is that the user is
shown a diverse opening palette — varying style, lighting, mood, color,
texture, composition, etc. — rather than four near-identical images.

Returns a `list[str]` of length exactly N. If the LLM call fails or the
response can't be parsed, returns `[prompt] * n` so the upstream image
generator still runs (and the user still gets four images, just less
diverse).

Implementation note: calls the OpenAI-compatible `/v1/chat/completions`
endpoint directly via httpx rather than going through the AsyncOpenAI SDK.
That avoids subtle SDK-version / proxy-response-shape mismatches we hit
with the nuwaflux gateway (the SDK occasionally surfaced a non-dict body
as a bare string, blowing up `.choices[0]` access). Going raw also lets us
log the proxy's actual response when something goes wrong.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an art-director assistant. The user gives you a short image prompt. Your job is to produce N MAXIMALLY DIVERSE variant prompts that all satisfy the user's core subject but explore radically different aesthetic territory along dimensions the user did NOT specify.

# Dimensions of variation to push HARD on (when unspecified):
- **Medium / Style**: oil painting · watercolor · 3D render · pixel art · anime cel-shaded · photorealistic photograph · pencil sketch · low-poly · vaporwave · ukiyo-e woodblock · papercut collage · charcoal · vector flat · isometric · claymation still · cyberpunk concept art · hand-drawn storybook illustration
- **Era / Genre**: Renaissance · Art Deco 1920s · 1970s sci-fi paperback · 1980s synthwave · medieval manuscript · Bauhaus · brutalist · solarpunk · steampunk · post-apocalyptic · cottagecore
- **Lighting**: golden hour · neon underlight · candlelit chiaroscuro · overcast morning · harsh studio flash · bioluminescent · firelight · moonlit · volumetric god rays
- **Mood / Atmosphere**: serene · ominous · whimsical · austere · dreamlike · gritty · ceremonial · melancholic
- **Color palette**: monochrome · pastel · saturated complementary · earthy ochre · cool teal & orange · jewel tones · sepia · neon pink/cyan
- **Composition / Camera**: top-down isometric · low-angle hero · wide cinematic · macro close-up · symmetrical centered · dutch tilt

# Hard rules:
1. **Preserve the user's core subject verbatim or near-verbatim.** "a house" stays a house in every variant.
2. **Each pair of variants must differ on AT LEAST 3 of the dimensions above.** No "same scene, slightly different lighting" outputs — push them into genuinely different artistic worlds.
3. **Specifically maximize Medium/Style spread.** If you produce 4 variants, the 4 mediums should feel like they belong to 4 different artists from 4 different traditions (e.g. one photoreal, one anime, one oil painting, one 3D render). DO NOT make them all "concept art" or all "illustration".
4. **If the user pinned a dimension** (explicitly wrote "watercolor", "neon", "moody", "minimalist", etc.), keep that pinned in every variant and diverge on the remaining free dimensions even harder.
5. Each variant is one line, 15-45 words, plain English, no numbering, no quotes, no markdown.

# Example
User prompt: "design a house"
Good output:
[
  "A cozy thatched-roof cottage rendered as a soft watercolor storybook illustration, golden afternoon light, muted ochre and sage palette, gentle painterly edges, cottagecore mood.",
  "A brutalist concrete house, low-angle architectural photograph at dusk under harsh sodium streetlight, dramatic shadows, monochrome teal-and-orange grade, photorealistic.",
  "A floating sci-fi house perched on a cliff, 1970s paperback cover oil painting, neon sunset, retro-futurist mood, saturated magenta and cyan palette, dynamic composition.",
  "A tiny isometric pixel-art house, vibrant 8-bit palette, sharp diagonal lighting, charming whimsical mood, top-down 45-degree view, transparent grid-aligned silhouette."
]

# Output format
A JSON array of exactly N strings. No prose before or after. No markdown fences."""


def _has_real_credentials() -> bool:
    key = settings.openai_api_key or ""
    if not key or key.startswith("sk-replace") or len(key) < 20:
        return False
    return True


def _parse_variants(text: str, expected: int) -> Optional[list[str]]:
    """Pull a JSON list of strings out of the model's response, tolerating
    code-fence wrappers and trailing prose."""
    text = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```\s*$", text, flags=re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    m = re.search(r"\[.*\]", text, flags=re.DOTALL)
    if not m:
        return None
    try:
        arr = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(arr, list):
        return None
    out: list[str] = []
    for item in arr:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
        elif isinstance(item, dict):
            for key in ("prompt", "text", "variant"):
                if isinstance(item.get(key), str):
                    out.append(item[key].strip())
                    break
    if len(out) < expected:
        return None
    return out[:expected]


def _extract_message_content(body: dict) -> Optional[str]:
    """Pull the assistant text out of an OpenAI chat-completions response.

    Tolerates both the standard `choices[0].message.content` (a string) and
    the newer block-style `choices[0].message.content` (a list of parts
    each with a `.text`)."""
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
        # gpt-5 block style: [{"type": "text", "text": "..."}]
        parts: list[str] = []
        for blk in content:
            if isinstance(blk, dict) and isinstance(blk.get("text"), str):
                parts.append(blk["text"])
        if parts:
            return "".join(parts)
    return None


async def expand(prompt: str, n: int = 4) -> list[str]:
    """Return `n` variant prompts for `prompt`. Falls back to `[prompt]*n` on
    any failure so callers never have to handle the error case."""
    n = max(1, min(n, 8))
    user_prompt = prompt.strip()
    if not user_prompt:
        return [user_prompt] * n

    if not _has_real_credentials():
        log.info("prompt_expander: no real credentials — returning identity variants")
        return [user_prompt] * n

    api_base = settings.openai_base_url.rstrip("/")
    # Some users set OPENAI_BASE_URL without the /v1 suffix (e.g. just
    # "https://api.nuwaflux.com"). The standard OpenAI-compatible path is
    # /v1/chat/completions, so we auto-append /v1 when missing — otherwise
    # the proxy returns its homepage HTML and we get a confusing parse
    # error downstream.
    if not (api_base.endswith("/v1") or "/v1/" in api_base):
        api_base = api_base + "/v1"
    url = f"{api_base}/chat/completions"
    payload = {
        "model": settings.prompt_expander_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Original prompt: {user_prompt}\nN: {n}"},
        ],
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.openai_api_key}",
    }

    log.info("prompt_expander: POST %s (model=%s)", url, settings.prompt_expander_model)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, headers=headers, json=payload)
    except Exception as e:
        # httpx connect / SSL / protocol errors can have empty str(e); log the
        # exception class and the args tuple so we always see SOMETHING useful.
        log.warning(
            "prompt_expander: HTTP request failed (%s: %r, args=%r) — identity fallback",
            type(e).__name__, str(e), getattr(e, "args", ()),
        )
        return [user_prompt] * n

    if r.status_code != 200:
        log.warning(
            "prompt_expander: HTTP %d — body: %s",
            r.status_code, r.text[:300],
        )
        return [user_prompt] * n

    try:
        body = r.json()
    except ValueError:
        log.warning(
            "prompt_expander: non-JSON response — first 300 chars: %r",
            r.text[:300],
        )
        return [user_prompt] * n

    text = _extract_message_content(body)
    if text is None:
        log.warning(
            "prompt_expander: unrecognized response shape — keys: %s; sample: %s",
            list(body.keys()) if isinstance(body, dict) else type(body).__name__,
            str(body)[:300],
        )
        return [user_prompt] * n

    parsed = _parse_variants(text, n)
    if parsed is None:
        log.warning(
            "prompt_expander: unparseable variants block; first 300 chars: %r",
            text[:300],
        )
        return [user_prompt] * n
    return parsed
