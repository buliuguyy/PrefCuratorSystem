"""End-to-end smoke test of the Phase 1 backend.

Runs entirely with mock service clients — IP-Composer is expected to be
unreachable in CI, so we assert that the mock fallback kicks in.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_full_pipeline_with_mock_fallback() -> None:
    # 1. health
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["phase"] == "1-mock-clients"

    # 2. candidates
    r = client.post("/api/candidates", json={"prompt": "a haunted house", "n": 4})
    assert r.status_code == 200
    cands = r.json()["candidates"]
    assert len(cands) == 4
    asset_ids = [c["id"] for c in cands]

    # 3. each candidate is fetchable as PNG bytes
    for c in cands:
        r = client.get(c["url"])
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/")
        assert len(r.content) > 1000  # non-trivial PNG

    # 4. smart-tag the first candidate
    r = client.post("/api/tagging/smart-tag", json={
        "asset_id": asset_ids[0],
        "dimensions": ["Color", "Style", "Mood"],
    })
    assert r.status_code == 200
    tags = r.json()["tags"]
    assert set(tags.keys()) == {"Color", "Style", "Mood"}
    for v in tags.values():
        assert isinstance(v, list) and len(v) >= 1

    # 5. lasso a region of the 4th candidate
    r = client.post("/api/tagging/lasso", json={
        "asset_id": asset_ids[3],
        "polygon": [[100, 100], [400, 100], [400, 400], [100, 400]],
        "dimensions": ["Subject", "Texture"],
    })
    assert r.status_code == 200
    body = r.json()
    cropped_id = body["cropped_asset_id"]
    assert cropped_id and cropped_id != asset_ids[3]
    assert set(body["tags"].keys()) == {"Subject", "Texture"}

    # 6. compose with a fusion stack mirroring the spec image:
    #    Result = A(Color + Style + Mood) + D_lasso(Subject + Texture) - C(Style)
    stack = {
        "base_asset_id": asset_ids[0],
        "groups": [
            {
                "asset_id": asset_ids[0],
                "sign": "+",
                "concepts": [
                    {"dimension": "Color", "tags": ["warm", "glowing"], "alpha": 1.0, "name": "A_color"},
                    {"dimension": "Style", "tags": ["fantasy"], "alpha": 1.0, "name": "A_style"},
                    {"dimension": "Mood",  "tags": ["mystical"], "alpha": 1.0, "name": "A_mood"},
                ],
            },
            {
                "asset_id": cropped_id,
                "sign": "+",
                "concepts": [
                    {"dimension": "Subject", "tags": ["cloud formations"], "alpha": 1.0, "name": "D_subj"},
                ],
            },
            {
                "asset_id": asset_ids[2],
                "sign": "-",
                "concepts": [
                    {"dimension": "Style", "tags": ["pixel art", "cartoon"], "alpha": 1.0, "name": "C_style"},
                ],
            },
        ],
        "num_samples": 1,
        "seed": 420,
    }
    r = client.post("/api/compose", json=stack)
    assert r.status_code == 200, r.text
    out = r.json()
    # IP-Composer is not running in test env → mock fallback must trigger
    assert out["used_mock"] is True
    assert out["seed"] == 420
    result_id = out["result_asset_id"]

    # 7. fetch the composite back as PNG
    r = client.get(f"/api/assets/{result_id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")
    assert len(r.content) > 1000


def test_compose_rejects_missing_asset() -> None:
    r = client.post("/api/compose", json={
        "base_asset_id": "deadbeef",
        "groups": [{
            "asset_id": "deadbeef",
            "sign": "+",
            "concepts": [{"dimension": "Color", "tags": ["x"], "alpha": 1.0, "name": "x"}],
        }],
    })
    assert r.status_code == 404
