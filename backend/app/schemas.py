from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ─── smart tag result (Phase 9) ────────────────────────────────────────────


class ConceptTag(BaseModel):
    """One coarse, IP-Composer-aligned concept extracted from an image, with
    an optional anchor on the image for floating-pill placement.

    - scope="local": anchor MUST be (x, y) in [0,1]^2
    - scope="global": anchor MUST be None (concepts like lighting / style /
      mood that have no specific image location — frontend pins these to
      the image's edge as chips)
    """

    concept: str
    scope: Literal["local", "global"]
    anchor: tuple[float, float] | None = None


# ─── fusion stack (unchanged shape; consumed by ip_composer_client) ────────


class Concept(BaseModel):
    """One slot fed into IP-Composer. `dimension` carries the coarse concept
    name (e.g. "dog", "lighting") — same string as ConceptTag.concept that
    the user picked. `tags` is a single-element list with the same value;
    ip_composer_client joins it with ", " to form the slot's concept prompt."""

    dimension: str
    tags: list[str] = Field(min_length=1)
    alpha: float = 1.0
    name: str


class Group(BaseModel):
    """One source-image group. sign='+' means add features; '-' means subtract."""

    asset_id: str
    sign: Literal["+", "-"] = "+"
    concepts: list[Concept] = Field(min_length=1)


class FusionStack(BaseModel):
    base_asset_id: str
    groups: list[Group] = Field(min_length=1)
    num_samples: int = 1
    seed: int = 420


# ─── request / response models ────────────────────────────────────────────────


class CandidateRequest(BaseModel):
    prompt: str
    n: int = 4
    # Phase 10: when an active persona is set on the frontend, both ids are
    # forwarded so the prompt expander can bias variants toward the user's
    # known preferences. Optional — unauthenticated / unattached calls work
    # exactly like before.
    user_id: str | None = None
    persona_id: str | None = None


class AssetRef(BaseModel):
    id: str
    url: str  # relative path mountable by frontend: /api/assets/{id}


class CandidateAsset(BaseModel):
    id: str
    url: str
    prompt: str
    generator: str  # "gemini" | "placeholder" | "synthetic"


class CandidateResponse(BaseModel):
    candidates: list[CandidateAsset]


class SmartTagRequest(BaseModel):
    asset_id: str


class TagResult(BaseModel):
    """Smart-tag output: a flat list of ConceptTag (Phase 9). The legacy
    per-dimension keyword-list shape is gone — each tag IS a single
    IP-Composer concept the user can fuse with."""

    asset_id: str
    tags: list[ConceptTag]


class LassoRequest(BaseModel):
    asset_id: str
    polygon: list[tuple[float, float]] = Field(min_length=3)


class LassoResponse(BaseModel):
    cropped_asset_id: str
    tags: list[ConceptTag]


class ComposeResponse(BaseModel):
    result_asset_id: str
    result_asset_ids: list[str] = Field(default_factory=list)
    seed: int
    used_mock: bool = False
    drift: float | None = None
    drift_warn: bool = False
    weak_slots: list[str] = Field(default_factory=list)
