"""IP-Composer service client.

Real implementation: forwards the FusionStack as a multipart request to
`POST {IP_COMPOSER_URL}/compose`, expanding each Concept into one slot,
then fetches each generated PNG via a follow-up `GET /outputs/<fn>`.

Fallback: when IP-Composer is unreachable (ConnectError) we synthesize a
"MOCK COMPOSITE" PNG that overlays the requested concept names on the base
image. The fallback is purely for unblocking UI iteration — production code
paths should never silently swallow real composition failures, so we surface
the fallback flag back to the caller (and ultimately to the UI).

The IP-Composer protocol (Flask app at ~/IP_Composer/app.py):

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
    →  200 application/json {
         "drift": float, "drift_warn": bool,
         "slots": [{"name", "alpha", "rank", "source",
                    "signal_ratio", "weak_signal"}, ...],
         "num_samples": int,
         "files": ["...png", ...],
         "urls":  ["/outputs/...png", ...]
       }
    GET  /outputs/<fn>  →  PNG bytes
"""

from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, field

import httpx
from PIL import Image, ImageDraw, ImageFont

from app.config import settings
from app.schemas import FusionStack
from app.storage import store

log = logging.getLogger(__name__)


@dataclass
class ComposeOutcome:
    """Result of one /compose call.

    `images` always has ≥1 entry (one PNG per requested num_samples; mock
    fallback emits exactly one). `weak_slots` is the names of the slots whose
    signal_ratio < 0.10 — surfaced to the UI as a "this reference image barely
    contains the concept" hint."""

    images: list[bytes]
    used_mock: bool
    drift: float | None = None
    drift_warn: bool = False
    weak_slots: list[str] = field(default_factory=list)


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

    base_url = settings.ip_composer_url.rstrip("/")
    url = f"{base_url}/compose"
    # IP-Composer runs SDXL inference for num_samples * num_inference_steps,
    # which can take ~30s for 4 samples on a single GPU. Generous timeout.
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(url, files=multipart)
            if resp.status_code >= 400:
                # Surface the real server-side error body, otherwise the
                # broad except below swallows it and the only signal you get
                # is "fell back to mock" with no clue why.
                body_preview = resp.text[:500].replace("\n", " ")
                log.warning(
                    "IP-Composer %d on POST /compose — body: %s",
                    resp.status_code, body_preview,
                )
                resp.raise_for_status()
            data = resp.json()
            outcome = await _fetch_outputs(client, base_url, data)
            return outcome
    except (httpx.ConnectError, httpx.ReadTimeout, httpx.HTTPStatusError, httpx.RequestError) as e:
        log.warning("IP-Composer unreachable / errored (%s) — using mock composite", e)
        return ComposeOutcome(
            images=[_mock_composite(stack, specs)],
            used_mock=True,
        )


async def _fetch_outputs(
    client: httpx.AsyncClient, base_url: str, data: dict
) -> ComposeOutcome:
    """Parse the /compose JSON response and follow the per-file URLs to pull
    the PNG bytes back."""
    urls = data.get("urls") or []
    files = data.get("files") or []
    # Prefer `urls` (server-relative); fall back to constructing from `files`.
    paths: list[str] = []
    if urls:
        paths = [u if u.startswith("http") else f"{base_url}{u}" for u in urls]
    elif files:
        paths = [f"{base_url}/outputs/{fn}" for fn in files]
    else:
        raise RuntimeError(
            f"IP-Composer response missing 'urls'/'files': {sorted(data)[:8]}"
        )

    images: list[bytes] = []
    for p in paths:
        r = await client.get(p)
        r.raise_for_status()
        if not r.content:
            raise RuntimeError(f"IP-Composer returned empty PNG at {p}")
        images.append(r.content)

    slot_diag = data.get("slots") or []
    weak = [
        str(s.get("name") or f"slot{i}")
        for i, s in enumerate(slot_diag)
        if isinstance(s, dict) and s.get("weak_signal")
    ]
    drift = data.get("drift")
    return ComposeOutcome(
        images=images,
        used_mock=False,
        drift=float(drift) if isinstance(drift, (int, float)) else None,
        drift_warn=bool(data.get("drift_warn")),
        weak_slots=weak,
    )


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
