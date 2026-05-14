from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ─── shared primitives ─────────────────────────────────────────────────────────

# The 9-dim pool the VLM is allowed to pick from. Kept as a Literal so the
# frontend → backend hint is type-checked. Note: VLM responses MAY include
# novel dimension names; those flow back via TagResult.tags whose key type
# is intentionally `str` (not Dimension) to tolerate that.
Dimension = Literal[
    "Color", "Style", "Texture", "Lighting", "Mood",
    "Subject", "Composition", "Detail", "Atmosphere",
]


class Concept(BaseModel):
    """One semantic concept extracted from one image — maps to one IP-Composer slot."""

    dimension: str  # tolerates any dim string the VLM returns
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


class CandidateAsset(BaseModel):
    """Candidate produced by the initial image generation pipeline. Includes
    the variant prompt the LLM expanded to (so the frontend can surface it)
    and which generator actually produced the bytes."""

    id: str
    url: str
    prompt: str
    generator: str  # "gemini" | "placeholder" | "synthetic"


class CandidateResponse(BaseModel):
    candidates: list[CandidateAsset]


class SmartTagRequest(BaseModel):
    asset_id: str
    # Hint to the VLM. With a real VLM, this is ignored — the model picks its
    # own subset from its prompt's 9-dim pool.
    dimensions: list[Dimension] = [
        "Color", "Style", "Texture", "Lighting", "Mood",
        "Subject", "Composition", "Detail", "Atmosphere",
    ]


class TagResult(BaseModel):
    """Per-dimension suggested tags for an asset. The `tags` key type is str
    (not Dimension) so a VLM that emits e.g. "Background" doesn't fail
    validation."""

    asset_id: str
    tags: dict[str, list[str]]


class LassoRequest(BaseModel):
    asset_id: str
    polygon: list[tuple[float, float]] = Field(min_length=3)
    dimensions: list[Dimension] = ["Subject", "Texture", "Composition"]


class LassoResponse(BaseModel):
    cropped_asset_id: str
    tags: dict[str, list[str]]


class ComposeResponse(BaseModel):
    result_asset_id: str
    seed: int
    used_mock: bool = False
