"""Gemini 3 Pro Image ("nano banana pro") client.

Calls the Gemini-compatible REST endpoint exposed by the nuwaflux proxy
(`https://api.nuwaflux.com` by default). We use raw httpx rather than the
`google-genai` SDK to avoid an extra heavy dependency — the only thing we
need is the `generateContent` POST with `responseModalities=[TEXT, IMAGE]`.

The endpoint returns image bytes either as `inlineData.data` (base64) on a
content part, or embedded as a `data:image/...;base64,...` URI inside a text
part. We handle both.
"""

from __future__ import annotations

import base64
import logging
import re
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger(__name__)


def _has_real_credentials() -> bool:
    key = settings.gemini_api_key or ""
    if not key or key.startswith("sk-replace") or len(key) < 20:
        return False
    return True


_DATA_URL_RE = re.compile(
    r"data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)",
    flags=re.IGNORECASE,
)


def _extract_image_bytes(response_json: dict) -> Optional[bytes]:
    """Walk the Gemini response and pull out the first image payload."""
    candidates = response_json.get("candidates") or []
    for cand in candidates:
        content = cand.get("content") or {}
        for part in content.get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and isinstance(inline.get("data"), str):
                try:
                    return base64.b64decode(inline["data"])
                except Exception:
                    continue
            text = part.get("text")
            if isinstance(text, str):
                m = _DATA_URL_RE.search(text)
                if m:
                    try:
                        return base64.b64decode(m.group(2))
                    except Exception:
                        continue
    return None


async def generate_image(prompt: str) -> Optional[bytes]:
    """Generate one image. Returns PNG (or whatever the model returns) bytes,
    or None on any failure — callers should fall back to a placeholder."""
    if not _has_real_credentials():
        log.info("gemini_image_client: no real credentials — skipping")
        return None

    url = (
        f"{settings.gemini_base_url.rstrip('/')}"
        f"/v1beta/models/{settings.gemini_image_model}:generateContent"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": settings.gemini_aspect_ratio,
                "imageSize": settings.gemini_image_size,
            },
        },
    }
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.gemini_api_key,
        # some proxies expect Authorization Bearer; send both — harmless.
        "Authorization": f"Bearer {settings.gemini_api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            r = await client.post(url, headers=headers, json=payload)
        if r.status_code != 200:
            log.warning(
                "gemini_image_client: HTTP %d for prompt %r; body: %s",
                r.status_code, prompt[:60], r.text[:300],
            )
            return None
        data = r.json()
    except Exception as e:
        log.warning("gemini_image_client: request failed (%s) for prompt %r", e, prompt[:60])
        return None

    img = _extract_image_bytes(data)
    if img is None:
        log.warning(
            "gemini_image_client: no image payload found in response for prompt %r",
            prompt[:60],
        )
    return img
