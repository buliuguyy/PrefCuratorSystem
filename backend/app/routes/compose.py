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

    if not outcome.images:
        raise HTTPException(status_code=502, detail="IP-Composer returned 0 images")

    ids = [store.put(b).id for b in outcome.images]
    return ComposeResponse(
        result_asset_id=ids[0],
        result_asset_ids=ids,
        seed=stack.seed,
        used_mock=outcome.used_mock,
        drift=outcome.drift,
        drift_warn=outcome.drift_warn,
        weak_slots=outcome.weak_slots,
    )
