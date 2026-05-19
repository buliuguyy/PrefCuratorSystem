"""Disk-backed user + persona persistence.

Layout under ``backend/storage/``::

    users.json                              # [{id, name, created_at, last_seen_at}, ...]
    personas/
      <user_id>/
        index.json                          # [{id, name, ...}, ...] (lightweight list)
        <persona_id>.json                   # full persona record + base64 asset blobs
        assets/                             # (reserved — currently inline-base64 inside json)

Each persona record carries the **byte contents** of every source asset it
references so it can be re-hydrated on a fresh canvas. Asset bytes are base64
because (a) persona files are small (handful of images per persona) and
(b) it keeps each persona one atomic JSON file with no extra cleanup.

If we ever bloat past a few MB per persona we can refactor to side-file
blobs — `references` is already structured to make that swap easy
(replace `bytes_b64` with `path` and read on hydrate).
"""
from __future__ import annotations

import base64
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from app.storage import store as asset_store

log = logging.getLogger(__name__)

# storage/ sits as a sibling of app/ inside backend/
STORAGE_ROOT = Path(__file__).resolve().parent.parent / "storage"
USERS_FILE = STORAGE_ROOT / "users.json"
PERSONAS_DIR = STORAGE_ROOT / "personas"

STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
PERSONAS_DIR.mkdir(parents=True, exist_ok=True)


# ─── users ────────────────────────────────────────────────────────────────────


@dataclass
class User:
    id: str
    name: str
    created_at: float
    last_seen_at: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class UserStore:
    """JSON-file backed roster of known users. No auth — name is the only
    identifying datum the user types; the backend assigns the stable id."""

    def __init__(self, path: Path = USERS_FILE) -> None:
        self.path = path
        self._lock = threading.Lock()
        if not self.path.exists():
            self._write([])

    def _read(self) -> list[dict[str, Any]]:
        try:
            with self.path.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
                return data if isinstance(data, list) else []
        except FileNotFoundError:
            return []
        except json.JSONDecodeError:
            log.warning("users.json corrupt — resetting")
            return []

    def _write(self, items: list[dict[str, Any]]) -> None:
        tmp = self.path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fp:
            json.dump(items, fp, indent=2, ensure_ascii=False)
        tmp.replace(self.path)

    def list(self) -> list[User]:
        with self._lock:
            return [User(**row) for row in self._read()]

    def get(self, user_id: str) -> User | None:
        for u in self.list():
            if u.id == user_id:
                return u
        return None

    def get_by_name(self, name: str) -> User | None:
        nm = name.strip().lower()
        for u in self.list():
            if u.name.strip().lower() == nm:
                return u
        return None

    def create(self, name: str) -> User:
        name = name.strip()
        if not name:
            raise ValueError("user name required")
        existing = self.get_by_name(name)
        if existing is not None:
            # idempotent — same display name returns the existing record
            return existing
        now = time.time()
        u = User(id=uuid.uuid4().hex, name=name, created_at=now, last_seen_at=now)
        with self._lock:
            rows = self._read()
            rows.append(u.to_dict())
            self._write(rows)
        (PERSONAS_DIR / u.id).mkdir(parents=True, exist_ok=True)
        return u

    def touch(self, user_id: str) -> None:
        with self._lock:
            rows = self._read()
            for r in rows:
                if r["id"] == user_id:
                    r["last_seen_at"] = time.time()
                    self._write(rows)
                    return

    def rename(self, user_id: str, new_name: str) -> User | None:
        new_name = new_name.strip()
        if not new_name:
            raise ValueError("name required")
        with self._lock:
            rows = self._read()
            for r in rows:
                if r["id"] == user_id:
                    r["name"] = new_name
                    self._write(rows)
                    return User(**r)
        return None

    def delete(self, user_id: str) -> bool:
        with self._lock:
            rows = self._read()
            new_rows = [r for r in rows if r["id"] != user_id]
            if len(new_rows) == len(rows):
                return False
            self._write(new_rows)
        user_dir = PERSONAS_DIR / user_id
        if user_dir.exists():
            for p in user_dir.glob("*"):
                try:
                    p.unlink()
                except OSError:
                    pass
            try:
                user_dir.rmdir()
            except OSError:
                pass
        return True


users = UserStore()


# ─── personas ─────────────────────────────────────────────────────────────────


@dataclass
class PersonaConcept:
    """Per-tag curated concept snapshot — matches frontend CuratedConcept,
    minus the live store key."""

    assetId: str
    dimension: str
    tag: str
    sign: str  # "+" or "-"
    alpha: float


@dataclass
class PersonaAssetSnapshot:
    """One source asset embedded inside a persona record.

    `bytes_b64` is the raw image bytes, base64-encoded. On hydrate we
    re-put into the in-memory AssetStore so the frontend's existing
    /api/assets/<id> endpoint serves it transparently."""

    id: str
    label: str
    origin: str  # generated | composed | lasso | uploaded
    content_type: str
    bytes_b64: str
    tags: dict[str, list[str]] | None = None
    # extra fields per origin — kept loose so we don't have to evolve the
    # frontend Asset shape in lock-step.
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Persona:
    id: str
    user_id: str
    name: str
    created_at: float
    updated_at: float
    last_used_at: float
    concepts: list[PersonaConcept]
    assets: list[PersonaAssetSnapshot]
    # Soft metadata to round-trip what would otherwise need a separate UI:
    prompt: str = ""
    seed: int = 420
    # Phase 10: short natural-language summary of the user's preferences
    # derived from concepts + recent prompt. Cached so we don't re-derive on
    # every Generate; reset to None whenever the persona content changes (see
    # snapshot_from_payload).
    prompt_summary: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_used_at": self.last_used_at,
            "concepts": [asdict(c) for c in self.concepts],
            "assets": [asdict(a) for a in self.assets],
            "prompt": self.prompt,
            "seed": self.seed,
            "prompt_summary": self.prompt_summary,
        }

    def to_summary(self) -> dict[str, Any]:
        """Lightweight view for list endpoints — no base64 asset payloads."""
        plus = sum(1 for c in self.concepts if c.sign == "+")
        minus = sum(1 for c in self.concepts if c.sign == "-")
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_used_at": self.last_used_at,
            "prompt": self.prompt,
            "seed": self.seed,
            "concept_count": len(self.concepts),
            "plus_count": plus,
            "minus_count": minus,
            "asset_count": len(self.assets),
            # Tiny preview chips for the panel — dim + tag, no alpha
            "concept_preview": [
                {"dimension": c.dimension, "tag": c.tag, "sign": c.sign}
                for c in self.concepts[:8]
            ],
            # Top-3 asset ids (used to render thumbnail strip from existing /api/assets/<id>)
            "asset_preview_ids": [a.id for a in self.assets[:3]],
        }


class PersonaStore:
    """One file per persona, sharded by user_id directory.

    Concurrency is process-local — adequate for the single-user-on-laptop
    target. Add a real DB before multi-user prod."""

    def __init__(self, root: Path = PERSONAS_DIR) -> None:
        self.root = root
        self._lock = threading.Lock()

    def _user_dir(self, user_id: str) -> Path:
        d = self.root / user_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _persona_path(self, user_id: str, persona_id: str) -> Path:
        return self._user_dir(user_id) / f"{persona_id}.json"

    def list_for_user(self, user_id: str) -> list[Persona]:
        d = self._user_dir(user_id)
        out: list[Persona] = []
        for p in sorted(d.glob("*.json")):
            try:
                out.append(self._load_file(p))
            except Exception as e:  # noqa: BLE001 — corrupt file shouldn't kill the list
                log.warning("skipping corrupt persona %s: %s", p, e)
        out.sort(key=lambda x: x.updated_at, reverse=True)
        return out

    def get(self, user_id: str, persona_id: str) -> Persona | None:
        path = self._persona_path(user_id, persona_id)
        if not path.exists():
            return None
        return self._load_file(path)

    def _load_file(self, path: Path) -> Persona:
        with path.open("r", encoding="utf-8") as fp:
            raw = json.load(fp)
        return Persona(
            id=raw["id"],
            user_id=raw["user_id"],
            name=raw["name"],
            created_at=raw["created_at"],
            updated_at=raw["updated_at"],
            last_used_at=raw.get("last_used_at", raw["updated_at"]),
            prompt=raw.get("prompt", ""),
            seed=raw.get("seed", 420),
            prompt_summary=raw.get("prompt_summary"),
            concepts=[PersonaConcept(**c) for c in raw.get("concepts", [])],
            assets=[
                PersonaAssetSnapshot(
                    id=a["id"],
                    label=a.get("label", ""),
                    origin=a["origin"],
                    content_type=a.get("content_type", "image/png"),
                    bytes_b64=a["bytes_b64"],
                    tags=a.get("tags"),
                    extra=a.get("extra", {}),
                )
                for a in raw.get("assets", [])
            ],
        )

    def _save_file(self, persona: Persona) -> None:
        path = self._persona_path(persona.user_id, persona.id)
        tmp = path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fp:
            json.dump(persona.to_dict(), fp, indent=2, ensure_ascii=False)
        tmp.replace(path)

    def upsert(self, persona: Persona) -> Persona:
        with self._lock:
            self._save_file(persona)
        return persona

    def delete(self, user_id: str, persona_id: str) -> bool:
        path = self._persona_path(user_id, persona_id)
        if not path.exists():
            return False
        with self._lock:
            try:
                path.unlink()
                return True
            except OSError as e:
                log.warning("delete persona %s failed: %s", path, e)
                return False

    # ─── snapshotting helpers ──────────────────────────────────────────────

    def snapshot_from_payload(
        self,
        *,
        user_id: str,
        name: str,
        concepts: list[dict[str, Any]],
        asset_ids: list[str],
        prompt: str = "",
        seed: int = 420,
        persona_id: str | None = None,
    ) -> Persona:
        """Build a Persona record from a frontend payload.

        Asset bytes are pulled from the live in-memory AssetStore — so this
        ONLY works while the asset hasn't been GC'd. Missing assets are
        silently skipped (rather than failing the whole save) and the
        warning is logged so the user can diagnose."""
        now = time.time()
        pid = persona_id or uuid.uuid4().hex
        # If updating an existing persona, preserve created_at
        created_at = now
        if persona_id is not None:
            existing = self.get(user_id, persona_id)
            if existing is not None:
                created_at = existing.created_at

        snapshots: list[PersonaAssetSnapshot] = []
        for aid in asset_ids:
            a = asset_store.get(aid)
            if a is None:
                log.warning(
                    "persona snapshot: asset %s not in store — skipping", aid
                )
                continue
            snapshots.append(
                PersonaAssetSnapshot(
                    id=a.id,
                    label="",
                    origin="generated",  # frontend will overwrite via extra if it cares
                    content_type=a.content_type,
                    bytes_b64=base64.b64encode(a.bytes_).decode("ascii"),
                )
            )

        return Persona(
            id=pid,
            user_id=user_id,
            name=name,
            created_at=created_at,
            updated_at=now,
            last_used_at=now,
            concepts=[
                PersonaConcept(
                    assetId=c["assetId"],
                    dimension=c["dimension"],
                    tag=c["tag"],
                    sign=c["sign"],
                    alpha=float(c.get("alpha", 1.0)),
                )
                for c in concepts
            ],
            assets=snapshots,
            prompt=prompt,
            seed=int(seed),
        )

    def set_prompt_summary(self, user_id: str, persona_id: str, summary: str) -> None:
        """Persist a freshly-derived natural-language preference summary
        onto a persona record. Used by the prompt expander to avoid
        re-deriving the same summary on every Generate. No-op if the persona
        was deleted between the derive call and now."""
        with self._lock:
            existing = self.get(user_id, persona_id)
            if existing is None:
                return
            existing.prompt_summary = summary.strip() or None
            self._save_file(existing)

    def hydrate_into_asset_store(self, persona: Persona) -> list[str]:
        """Re-load this persona's asset bytes into the in-memory AssetStore
        under their **original ids**, so the existing `/api/assets/<id>`
        endpoint serves them. Returns the list of ids that were hydrated
        (or already present)."""
        hydrated: list[str] = []
        for a in persona.assets:
            existing = asset_store.get(a.id)
            if existing is not None:
                hydrated.append(a.id)
                continue
            try:
                raw = base64.b64decode(a.bytes_b64)
            except Exception as e:  # noqa: BLE001
                log.warning("persona hydrate: bad b64 for asset %s: %s", a.id, e)
                continue
            # Reach into the asset store internals to preserve the id — the
            # public put() generates a fresh uuid which would break the
            # concept→asset mapping in the persona record.
            from app.storage import Asset as StoreAsset  # local import to avoid cycle

            asset_store._items[a.id] = StoreAsset(  # type: ignore[attr-defined]
                id=a.id, bytes_=raw, content_type=a.content_type
            )
            hydrated.append(a.id)
        return hydrated


personas = PersonaStore()
