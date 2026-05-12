from fastapi import APIRouter

from app.schemas import AssetRef, CandidateRequest, CandidateResponse
from app.services import image_gen_client

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


@router.post("", response_model=CandidateResponse)
async def create_candidates(req: CandidateRequest) -> CandidateResponse:
    ids = image_gen_client.generate_candidates(prompt=req.prompt, n=req.n)
    return CandidateResponse(
        candidates=[AssetRef(id=i, url=f"/api/assets/{i}") for i in ids],
    )
