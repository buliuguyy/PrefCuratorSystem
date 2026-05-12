"""IP-Composer service client.

Real implementation: forwards the FusionStack as a multipart request to
`POST {IP_COMPOSER_URL}/compose`, expanding each Concept into one slot.

Fallback: when IP-Composer is unreachable (ConnectError) we synthesize a
"MOCK COMPOSITE" PNG that overlays the requested concept names on the base
image. The fallback is purely for unblocking UI iteration — production code
paths should never silently swallow real composition failures, so we surface
the fallback flag back to the caller (and ultimately to the UI).

The IP-Composer protocol (per user-provided spec):

    POST /compose  (multipart/form-data)
      base_image: <bytes>
      slot_0:     <bytes>
      slot_1:     <bytes>
      ...
      params:     JSON string {
        "slots":[
          {"image_key":"slot_0","concept":"<text>","alpha":1.0,"name":"<id>"},
          ...
        ],
        "num_samples": int,
        "seed": int
      }
"""

from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass

import httpx
from PIL import Image, ImageDraw, ImageFont

from app.config import settings
from app.schemas import FusionStack
from app.storage import store

log = logging.getLogger(__name__)


@dataclass
class ComposeOutcome:
    image_bytes: bytes
    used_mock: bool


# ─── slot expansion ─────────────────────────────────────────────────────────


def _expand_slots(stack: FusionStack) -> tuple[list[tuple[str, bytes]], list[dict]]:
    """Expand FusionStack groups into IP-Composer multipart files + slot specs.

    Returns (files, slot_specs):
      files: list of (slot_key, png_bytes) for each concept
      slot_specs: list of slot dicts to put into params JSON
    """
    files: list[tuple[str, bytes]] = []
    specs: list[dict] = []

    slot_idx = 0
    for group in stack.groups:
        asset = store.get(group.asset_id)
        if asset is None:
            raise ValueError(f"asset not found: {group.asset_id}")
        signed = 1.0 if group.sign == "+" else -1.0
        for concept in group.concepts:
            slot_key = f"slot_{slot_idx}"
            files.append((slot_key, asset.bytes_))
            specs.append({
                "image_key": slot_key,
                "concept": ", ".join(concept.tags),
                "alpha": signed * concept.alpha,
                "name": concept.name,
            })
            slot_idx += 1
    return files, specs


# ─── real call ───────────────────────────────────────────────────────────────


async def compose(stack: FusionStack) -> ComposeOutcome:
    base = store.get(stack.base_asset_id)
    if base is None:
        raise ValueError(f"base asset not found: {stack.base_asset_id}")
    files, specs = _expand_slots(stack)

    multipart: list[tuple[str, tuple[str, bytes, str]]] = [
        ("base_image", (f"{stack.base_asset_id}.png", base.bytes_, "image/png")),
    ]
    for slot_key, png in files:
        multipart.append((slot_key, (f"{slot_key}.png", png, "image/png")))
    multipart.append((
        "params",
        ("params.json", json.dumps({
            "slots": specs,
            "num_samples": stack.num_samples,
            "seed": stack.seed,
        }).encode(), "application/json"),
    ))

    url = f"{settings.ip_composer_url.rstrip('/')}/compose"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, files=multipart)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            if ctype.startswith("image/"):
                return ComposeOutcome(image_bytes=resp.content, used_mock=False)
            # Some IP-Composer builds return JSON with a URL or base64; tolerate both.
            data = resp.json()
            if "image_base64" in data:
                import base64
                return ComposeOutcome(
                    image_bytes=base64.b64decode(data["image_base64"]),
                    used_mock=False,
                )
            raise RuntimeError(f"unexpected IP-Composer response shape: {list(data)[:5]}")
    except (httpx.ConnectError, httpx.ReadTimeout) as e:
        log.warning("IP-Composer unreachable (%s) — using mock composite", e)
        return ComposeOutcome(image_bytes=_mock_composite(stack, specs), used_mock=True)


# ─── mock fallback ───────────────────────────────────────────────────────────


def _mock_composite(stack: FusionStack, specs: list[dict]) -> bytes:
    """Render the base image with an overlay listing the requested slot concepts.
    Lets the UI iterate even when IP-Composer is down."""
    base = store.get(stack.base_asset_id)
    if base is None:
        raise RuntimeError("base asset vanished mid-mock")
    img = Image.open(io.BytesIO(base.bytes_)).convert("RGB")

    # darken
    overlay = Image.new("RGB", img.size, (0, 0, 0))
    img = Image.blend(img, overlay, 0.35)
    draw = ImageDraw.Draw(img)
    try:
        title_font = ImageFont.truetype("DejaVuSans-Bold.ttf", 22)
        body_font = ImageFont.truetype("DejaVuSans.ttf", 16)
    except OSError:
        title_font = body_font = ImageFont.load_default()

    draw.text((20, 16), "MOCK COMPOSITE (IP-Composer offline)",
              fill=(255, 200, 100), font=title_font)
    y = 56
    for spec in specs[:14]:
        sign = "+" if spec["alpha"] >= 0 else "−"
        line = f"  {sign} {spec['name']}: {spec['concept'][:48]}  (α={abs(spec['alpha']):.2f})"
        draw.text((20, y), line, fill=(230, 230, 240), font=body_font)
        y += 22

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
