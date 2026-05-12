"""In-memory asset cache keyed by UUID. Adequate for Phase 1 demo;
swap for Redis or disk-backed store before deploying anywhere real."""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class Asset:
    id: str
    bytes_: bytes
    content_type: str = "image/png"


class AssetStore:
    def __init__(self) -> None:
        self._items: dict[str, Asset] = {}

    def put(self, data: bytes, content_type: str = "image/png") -> Asset:
        asset = Asset(id=uuid.uuid4().hex, bytes_=data, content_type=content_type)
        self._items[asset.id] = asset
        return asset

    def get(self, asset_id: str) -> Asset | None:
        return self._items.get(asset_id)

    def __contains__(self, asset_id: str) -> bool:
        return asset_id in self._items

    def __len__(self) -> int:
        return len(self._items)


# module-level singleton
store = AssetStore()
