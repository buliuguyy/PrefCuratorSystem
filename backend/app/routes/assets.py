from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.schemas import AssetRef
from app.storage import store

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.post("/upload", response_model=AssetRef)
async def upload_asset(file: UploadFile = File(...)) -> AssetRef:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    ct = file.content_type or "image/png"
    asset = store.put(data, content_type=ct)
    return AssetRef(id=asset.id, url=f"/api/assets/{asset.id}")


@router.get("/{asset_id}")
async def get_asset(asset_id: str) -> Response:
    asset = store.get(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return Response(content=asset.bytes_, media_type=asset.content_type)
