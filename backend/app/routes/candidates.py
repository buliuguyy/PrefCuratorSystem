from fastapi import APIRouter

from app.schemas import CandidateAsset, CandidateRequest, CandidateResponse
from app.services import image_gen_client

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


@router.post("", response_model=CandidateResponse)
async def create_candidates(req: CandidateRequest) -> CandidateResponse:
    cands = await image_gen_client.generate_candidates(prompt=req.prompt, n=req.n)
    return CandidateResponse(
        candidates=[
            CandidateAsset(
                id=c.asset_id,
                url=f"/api/assets/{c.asset_id}",
                prompt=c.prompt,
                generator=c.generator,
            )
            for c in cands
        ],
    )
