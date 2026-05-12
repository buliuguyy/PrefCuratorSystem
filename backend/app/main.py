from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import assets, candidates, compose, tagging

app = FastAPI(title="PrefCurator Backend", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(candidates.router)
app.include_router(assets.router)
app.include_router(tagging.router)
app.include_router(compose.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "phase": "1-mock-clients"}
