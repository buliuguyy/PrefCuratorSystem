"""Persona → one-line preference summary.

Given a persona's stack of curated concepts (and the prompt they were saved
under), ask a small LLM to summarise the user's aesthetic tendencies in a
single sentence. The result is used by the prompt-expander as a "User
preference bias: …" hint so subsequent Generate calls produce variants that
already lean toward the user's known preferences.

Returns ``None`` on any failure (no creds, HTTP error, unparseable response)
so callers can degrade gracefully — the expander will then run unbiased.

Implementation is intentionally a thin httpx call rather than going through
the AsyncOpenAI SDK, matching the pattern used by ``prompt_expander_client``
to keep the proxy/auth handling identical across services.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.config import settings

log = logging.getLogger(__name__)


SYSTEM_PROMPT = """You distill a designer's aesthetic preferences into ONE short sentence (≤30 words).

You will be given a list of concepts the designer has up-voted (+) or down-voted (−), each tagged with a high-level dimension (lighting, style, material, mood, etc.), and optionally a recent prompt they wrote.

Your output:
- ONE sentence in plain English. No lists, no preamble, no quotes, no markdown.
- Lead with the positives ("prefers …"), then optionally append the negatives ("avoids …").
- Stay concrete — name actual styles, lighting, palettes, moods. Don't say "various".
- Do NOT mention the user's prompt subject (e.g. "a house") — only the aesthetic tendencies.

Example input:
+ style: watercolor
+ lighting: golden hour
+ palette: warm ochre
- style: pixel art
- mood: ominous

Example output:
Prefers soft painterly aesthetics with warm golden-hour lighting and ochre palettes; avoids pixel-art and ominous moods."""


def _has_real_credentials() -> bool:
    key = settings.raw_openai_api_key or ""
    if not key or key.startswith("sk-replace") or len(key) < 20:
        return False
    return True


def _build_user_message(
    concepts: list[dict[str, Any]],
    recent_prompt: str = "",
) -> str:
    lines: list[str] = []
    for c in concepts:
        sign = c.get("sign", "+")
        dim = c.get("dimension", "")
        tag = c.get("tag", "")
        # tag and dimension are typically the same coarse concept name
        # post-Phase 9; show only the dim if they match.
        label = dim if (not tag or tag == dim) else f"{dim}: {tag}"
        lines.append(f"{sign} {label}")
    parts = ["Concepts the designer has curated:", *lines]
    if recent_prompt.strip():
        parts.extend(["", f"Recent prompt: {recent_prompt.strip()}"])
    return "\n".join(parts)


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


async def derive_summary(
    concepts: list[dict[str, Any]],
    recent_prompt: str = "",
) -> Optional[str]:
    """Return a single-sentence preference summary, or None on failure."""
    if not concepts:
        return None
    if not _has_real_credentials():
        log.info("persona_summary: no real credentials — skipping derive")
        return None

    api_base = settings.raw_openai_base_url.rstrip("/")
    if not (api_base.endswith("/v1") or "/v1/" in api_base):
        api_base = api_base + "/v1"
    url = f"{api_base}/chat/completions"
    user_msg = _build_user_message(concepts, recent_prompt)
    payload = {
        "model": settings.prompt_expander_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.raw_openai_api_key}",
    }

    log.info("persona_summary: POST %s (%d concepts)", url, len(concepts))
    client_kwargs: dict = {"timeout": 30.0}
    if settings.raw_openai_proxy:
        client_kwargs["proxy"] = settings.raw_openai_proxy
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            r = await client.post(url, headers=headers, json=payload)
    except Exception as e:
        log.warning(
            "persona_summary: HTTP request failed (%s: %r)",
            type(e).__name__, str(e),
        )
        return None

    if r.status_code != 200:
        log.warning(
            "persona_summary: HTTP %d — body: %s",
            r.status_code, r.text[:300],
        )
        return None

    try:
        body = r.json()
    except ValueError:
        return None

    text = _extract_message_content(body)
    if text is None:
        return None
    # Single-line normalize — the system prompt asks for a sentence; defensively
    # strip any leading/trailing whitespace and collapse internal newlines.
    summary = " ".join(text.split()).strip().strip('"').strip()
    return summary or None
