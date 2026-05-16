"""User + Persona CRUD endpoints.

Persona records hold a snapshot of the user's curated stack plus the byte
contents of the referenced source images, so loading a persona on a fresh
canvas brings the images back intact. See ``backend/app/persona_store.py``
for the storage model.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.persona_store import (
    PersonaConcept,
    personas as persona_store,
    users as user_store,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["personas"])


# ─── DTOs ─────────────────────────────────────────────────────────────────────


class UserCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class UserRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class ConceptPayload(BaseModel):
    assetId: str
    dimension: str
    tag: str
    sign: str  # "+" or "-"
    alpha: float = 1.0


class PersonaSavePayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    concepts: list[ConceptPayload]
    asset_ids: list[str]
    prompt: str = ""
    seed: int = 420


# ─── users ────────────────────────────────────────────────────────────────────


@router.get("/users")
async def list_users() -> dict[str, Any]:
    return {"users": [u.to_dict() for u in user_store.list()]}


@router.post("/users")
async def create_user(payload: UserCreateRequest) -> dict[str, Any]:
    try:
        u = user_store.create(payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return u.to_dict()


@router.put("/users/{user_id}")
async def rename_user(user_id: str, payload: UserRenameRequest) -> dict[str, Any]:
    try:
        u = user_store.rename(user_id, payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if u is None:
        raise HTTPException(status_code=404, detail="user not found")
    return u.to_dict()


@router.delete("/users/{user_id}")
async def delete_user(user_id: str) -> dict[str, Any]:
    ok = user_store.delete(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="user not found")
    return {"ok": True}


@router.post("/users/{user_id}/touch")
async def touch_user(user_id: str) -> dict[str, Any]:
    user_store.touch(user_id)
    return {"ok": True}


# ─── personas ────────────────────────────────────────────────────────────────


def _require_user(user_id: str) -> None:
    if user_store.get(user_id) is None:
        raise HTTPException(status_code=404, detail="user not found")


@router.get("/users/{user_id}/personas")
async def list_personas(user_id: str) -> dict[str, Any]:
    _require_user(user_id)
    return {
        "personas": [p.to_summary() for p in persona_store.list_for_user(user_id)]
    }


@router.post("/users/{user_id}/personas")
async def create_persona(user_id: str, payload: PersonaSavePayload) -> dict[str, Any]:
    _require_user(user_id)
    p = persona_store.snapshot_from_payload(
        user_id=user_id,
        name=payload.name,
        concepts=[c.dict() for c in payload.concepts],
        asset_ids=payload.asset_ids,
        prompt=payload.prompt,
        seed=payload.seed,
    )
    persona_store.upsert(p)
    return p.to_summary()


@router.put("/users/{user_id}/personas/{persona_id}")
async def update_persona(
    user_id: str, persona_id: str, payload: PersonaSavePayload
) -> dict[str, Any]:
    _require_user(user_id)
    if persona_store.get(user_id, persona_id) is None:
        raise HTTPException(status_code=404, detail="persona not found")
    p = persona_store.snapshot_from_payload(
        user_id=user_id,
        name=payload.name,
        concepts=[c.dict() for c in payload.concepts],
        asset_ids=payload.asset_ids,
        prompt=payload.prompt,
        seed=payload.seed,
        persona_id=persona_id,
    )
    persona_store.upsert(p)
    return p.to_summary()


@router.delete("/users/{user_id}/personas/{persona_id}")
async def delete_persona(user_id: str, persona_id: str) -> dict[str, Any]:
    _require_user(user_id)
    ok = persona_store.delete(user_id, persona_id)
    if not ok:
        raise HTTPException(status_code=404, detail="persona not found")
    return {"ok": True}


@router.get("/users/{user_id}/personas/{persona_id}")
async def get_persona(user_id: str, persona_id: str) -> dict[str, Any]:
    """Full persona payload — re-hydrates asset bytes into the in-memory
    AssetStore (so /api/assets/<id> serves them) and returns the metadata
    needed to repopulate the canvas + stack."""
    _require_user(user_id)
    p = persona_store.get(user_id, persona_id)
    if p is None:
        raise HTTPException(status_code=404, detail="persona not found")
    hydrated_ids = persona_store.hydrate_into_asset_store(p)
    # Don't ship base64 over the wire — frontend just needs metadata + the
    # asset ids it can fetch via /api/assets/<id>. We do surface tags so a
    # restored asset shows the smart-tag chips it had when saved.
    return {
        "id": p.id,
        "user_id": p.user_id,
        "name": p.name,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "last_used_at": p.last_used_at,
        "prompt": p.prompt,
        "seed": p.seed,
        "concepts": [
            {
                "assetId": c.assetId,
                "dimension": c.dimension,
                "tag": c.tag,
                "sign": c.sign,
                "alpha": c.alpha,
            }
            for c in p.concepts
        ],
        "assets": [
            {
                "id": a.id,
                "label": a.label,
                "origin": a.origin,
                "url": f"/api/assets/{a.id}",
                "tags": a.tags,
                "available": a.id in hydrated_ids,
            }
            for a in p.assets
        ],
    }
