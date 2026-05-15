import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

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


@router.post("/stream")
async def create_candidates_stream(req: CandidateRequest) -> StreamingResponse:
    """NDJSON stream — one line per candidate as it finishes, plus a final
    `{"type":"done"}` line. Each candidate line carries the same payload as
    the batch endpoint's `CandidateAsset` plus an `idx` (variant slot)."""
    async def gen():
        total = 0
        async for idx, c in image_gen_client.generate_candidates_stream(
            prompt=req.prompt, n=req.n,
        ):
            total += 1
            yield (
                json.dumps(
                    {
                        "type": "candidate",
                        "idx": idx,
                        "id": c.asset_id,
                        "url": f"/api/assets/{c.asset_id}",
                        "prompt": c.prompt,
                        "generator": c.generator,
                    }
                )
                + "\n"
            )
        yield json.dumps({"type": "done", "total": total}) + "\n"

    # x-ndjson is the convention; some proxies buffer text/event-stream
    # aggressively, which would defeat the whole point of streaming.
    return StreamingResponse(gen(), media_type="application/x-ndjson")
