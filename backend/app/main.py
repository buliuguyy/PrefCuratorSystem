import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routes import assets, candidates, compose, tagging

# Make our own log.info() calls visible alongside uvicorn's INFO output.
# Python's root logger defaults to WARNING, which swallows the per-variant
# image-gen diagnostics we rely on for debugging the prompt → image fan-out.
logging.getLogger("app").setLevel(logging.INFO)
if not logging.getLogger("app").handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    logging.getLogger("app").addHandler(_h)
    logging.getLogger("app").propagate = False

log = logging.getLogger(__name__)

app = FastAPI(title="PrefCurator Backend", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all so unhandled exceptions return a proper JSON response with
    the CORSMiddleware running on it. Without this, a raised Python exception
    on a route results in a 500 served BEFORE the middleware adds CORS headers,
    which the browser surfaces (misleadingly) as a CORS error rather than the
    actual 500."""
    log.error("unhandled %s on %s: %s", type(exc).__name__, request.url.path, exc)
    log.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={
            "detail": f"{type(exc).__name__}: {exc}",
            "path": request.url.path,
        },
    )


app.include_router(candidates.router)
app.include_router(assets.router)
app.include_router(tagging.router)
app.include_router(compose.router)


@app.get("/health")
async def health() -> dict[str, str]:
    # `phase` is bumped per phase so the UI can render the version chip.
    return {"status": "ok", "phase": "7-ux-polish"}
