from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ─── shared primitives ─────────────────────────────────────────────────────────

Dimension = Literal[
    "Color", "Style", "Texture", "Lighting", "Mood", "Subject", "Composition"
]


class Concept(BaseModel):
    """One semantic concept extracted from one image — maps to one IP-Composer slot."""

    dimension: Dimension
    tags: list[str] = Field(min_length=1)
    alpha: float = 1.0  # frontend always sends positive; sign comes from group
    name: str  # short id e.g. "A_color"


class Group(BaseModel):
    """One source-image group. sign='+' means add features; '-' means subtract."""

    asset_id: str
    sign: Literal["+", "-"] = "+"
    concepts: list[Concept] = Field(min_length=1)


class FusionStack(BaseModel):
    """Full composition request from the Feature Fusion Stack panel."""

    base_asset_id: str
    groups: list[Group] = Field(min_length=1)
    num_samples: int = 1
    seed: int = 420


# ─── request / response models ────────────────────────────────────────────────


class CandidateRequest(BaseModel):
    prompt: str
    n: int = 4


class AssetRef(BaseModel):
    id: str
    url: str  # relative path mountable by frontend: /api/assets/{id}


class CandidateResponse(BaseModel):
    candidates: list[AssetRef]


class SmartTagRequest(BaseModel):
    asset_id: str
    dimensions: list[Dimension] = ["Color", "Style", "Texture", "Lighting", "Mood"]


class TagResult(BaseModel):
    """Per-dimension suggested tags for an asset."""

    asset_id: str
    tags: dict[Dimension, list[str]]


class LassoRequest(BaseModel):
    asset_id: str
    polygon: list[tuple[float, float]] = Field(min_length=3)
    dimensions: list[Dimension] = ["Subject", "Texture"]


class LassoResponse(BaseModel):
    cropped_asset_id: str
    tags: dict[Dimension, list[str]]


class ComposeResponse(BaseModel):
    result_asset_id: str
    seed: int
    used_mock: bool = False
