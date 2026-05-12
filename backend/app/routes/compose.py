from fastapi import APIRouter, HTTPException

from app.schemas import ComposeResponse, FusionStack
from app.services import ip_composer_client
from app.storage import store

router = APIRouter(prefix="/api/compose", tags=["compose"])


@router.post("", response_model=ComposeResponse)
async def compose(stack: FusionStack) -> ComposeResponse:
    if stack.base_asset_id not in store:
        raise HTTPException(status_code=404, detail="base asset not found")
    for grp in stack.groups:
        if grp.asset_id not in store:
            raise HTTPException(
                status_code=404, detail=f"group asset not found: {grp.asset_id}"
            )

    try:
        outcome = await ip_composer_client.compose(stack)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    result_asset = store.put(outcome.image_bytes)
    return ComposeResponse(
        result_asset_id=result_asset.id,
        seed=stack.seed,
        used_mock=outcome.used_mock,
    )
