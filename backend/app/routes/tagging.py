"""Tagging routes: full-image Smart Tag + lasso ROI crop+tag (Phase 9).

The VLM now emits a flat list of coarse IP-Composer concepts, each with a
`scope` (local | global) and — for local — a normalized anchor (x, y) in
[0,1]^2 that the frontend uses to float pills over the image. Lasso ROIs
keep the same VLM call but force all local anchors to image-center because
the polygon already isolates the region of interest.
"""

from __future__ import annotations

import io

from fastapi import APIRouter, HTTPException
from PIL import Image, ImageDraw

from app.schemas import (
    ConceptTag,
    LassoRequest,
    LassoResponse,
    SmartTagRequest,
    TagResult,
)
from app.services import vlm_tagger_client
from app.storage import store

router = APIRouter(prefix="/api/tagging", tags=["tagging"])


def _to_concept_tags(raw: list[dict]) -> list[ConceptTag]:
    out: list[ConceptTag] = []
    for r in raw:
        try:
            out.append(ConceptTag(**r))
        except Exception:
            # Already normalized in the client, but if a future change emits
            # a stray shape we'd rather drop it than 500 the whole request.
            continue
    return out


@router.post("/smart-tag", response_model=TagResult)
async def smart_tag(req: SmartTagRequest) -> TagResult:
    asset = store.get(req.asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    raw = await vlm_tagger_client.smart_tag(
        asset.bytes_,
        content_type=asset.content_type,
        seed_hint=req.asset_id,
    )
    return TagResult(asset_id=req.asset_id, tags=_to_concept_tags(raw))


@router.post("/lasso", response_model=LassoResponse)
async def lasso(req: LassoRequest) -> LassoResponse:
    asset = store.get(req.asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    cropped_png = _crop_polygon(asset.bytes_, req.polygon)
    new_asset = store.put(cropped_png)
    raw = await vlm_tagger_client.tag_cropped(
        cropped_png,
        seed_hint=req.asset_id,
    )
    # Lasso has already isolated the region — collapse every local anchor
    # to the crop's center so the floating pills don't try to sub-locate
    # within an already-localized image.
    for r in raw:
        if r.get("scope") == "local":
            r["anchor"] = [0.5, 0.5]
    return LassoResponse(cropped_asset_id=new_asset.id, tags=_to_concept_tags(raw))


# ─── polygon crop helper ────────────────────────────────────────────────────


def _crop_polygon(src_bytes: bytes, polygon: list[tuple[float, float]]) -> bytes:
    """Mask the source image with the lasso polygon and crop to its bounding box.

    Areas outside the polygon are filled with neutral gray (128,128,128) rather
    than transparent — IP-Composer / CLIP encoders generally cope better with
    a solid neutral background than alpha.
    """
    src = Image.open(io.BytesIO(src_bytes)).convert("RGB")
    w, h = src.size

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)

    gray = Image.new("RGB", (w, h), (128, 128, 128))
    composite = Image.composite(src, gray, mask)

    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    x0 = max(0, int(min(xs)) - 4)
    y0 = max(0, int(min(ys)) - 4)
    x1 = min(w, int(max(xs)) + 4)
    y1 = min(h, int(max(ys)) + 4)
    cropped = composite.crop((x0, y0, x1, y1))

    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    return buf.getvalue()
