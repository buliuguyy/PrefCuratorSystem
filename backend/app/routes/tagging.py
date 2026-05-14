"""Tagging routes: full-image Smart Tag + lasso ROI crop+tag."""

from __future__ import annotations

import io

from fastapi import APIRouter, HTTPException
from PIL import Image, ImageDraw

from app.schemas import (
    LassoRequest,
    LassoResponse,
    SmartTagRequest,
    TagResult,
)
from app.services import vlm_tagger_client
from app.storage import store

router = APIRouter(prefix="/api/tagging", tags=["tagging"])


@router.post("/smart-tag", response_model=TagResult)
async def smart_tag(req: SmartTagRequest) -> TagResult:
    asset = store.get(req.asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    tags = await vlm_tagger_client.smart_tag(
        asset.bytes_,
        list(req.dimensions),
        content_type=asset.content_type,
        seed_hint=req.asset_id,
    )
    return TagResult(asset_id=req.asset_id, tags=tags)


@router.post("/lasso", response_model=LassoResponse)
async def lasso(req: LassoRequest) -> LassoResponse:
    asset = store.get(req.asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    cropped_png = _crop_polygon(asset.bytes_, req.polygon)
    new_asset = store.put(cropped_png)
    tags = await vlm_tagger_client.tag_cropped(
        cropped_png,
        list(req.dimensions),
        seed_hint=req.asset_id,
    )
    return LassoResponse(cropped_asset_id=new_asset.id, tags=tags)


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
