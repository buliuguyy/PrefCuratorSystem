"""Unit tests for the Phase 9 VLM response parser + normalizer.

The smart-tag pipeline now emits a flat list of coarse IP-Composer-aligned
concepts each tagged with scope (local | global) and a normalized anchor
for local concepts. These tests pin the JSON parse + cleanup logic so a
proxy or model variant change doesn't silently regress.
"""

from app.services.vlm_tagger_client import _normalize, parse_vlm_response


def test_parses_strict_json():
    text = '{"tags": [{"concept": "dog", "scope": "local", "anchor": [0.5, 0.6]}]}'
    out = parse_vlm_response(text)
    assert out == [{"concept": "dog", "scope": "local", "anchor": [0.5, 0.6]}]


def test_tolerant_of_code_fence():
    text = '```json\n{"tags": [{"concept": "cat", "scope": "local", "anchor": [0.4, 0.4]}]}\n```'
    out = parse_vlm_response(text)
    assert out and out[0]["concept"] == "cat"


def test_tolerant_of_leading_prose():
    text = (
        "Sure! Here you go:\n\n"
        '{"tags": [{"concept": "lighting", "scope": "global", "anchor": null}]}'
    )
    out = parse_vlm_response(text)
    assert out == [{"concept": "lighting", "scope": "global", "anchor": None}]


def test_bare_list_also_accepted():
    """Some models emit just the list, no `tags` wrapper."""
    text = '[{"concept": "flower", "scope": "local", "anchor": [0.45, 0.55]}]'
    out = parse_vlm_response(text)
    assert out == [{"concept": "flower", "scope": "local", "anchor": [0.45, 0.55]}]


def test_empty_returns_empty_list():
    assert parse_vlm_response("") == []
    assert parse_vlm_response("nothing structured here") == []


def test_normalize_drops_malformed_entries():
    raw = [
        {"concept": "dog", "scope": "local", "anchor": [0.5, 0.5]},
        {"oops": "no concept"},
        {"concept": "", "scope": "local", "anchor": [0.1, 0.1]},
        {"concept": "lighting", "scope": "global", "anchor": None},
    ]
    out = _normalize(raw)
    concepts = [t["concept"] for t in out]
    assert "dog" in concepts
    assert "lighting" in concepts
    assert "" not in concepts


def test_normalize_clamps_anchors_into_unit_square():
    raw = [{"concept": "dog", "scope": "local", "anchor": [1.5, -0.2]}]
    out = _normalize(raw)
    x, y = out[0]["anchor"]
    assert 0.0 <= x <= 1.0
    assert 0.0 <= y <= 1.0


def test_normalize_reroutes_global_vocab_misslabeled_as_local():
    """If the model says 'lighting' is local, force it back to global."""
    raw = [{"concept": "lighting", "scope": "local", "anchor": [0.3, 0.3]}]
    out = _normalize(raw)
    assert out[0]["scope"] == "global"
    assert out[0]["anchor"] is None


def test_normalize_force_anchor_none_for_global():
    raw = [{"concept": "mood", "scope": "global", "anchor": [0.5, 0.5]}]
    out = _normalize(raw)
    assert out[0]["anchor"] is None


def test_normalize_defaults_missing_anchor_to_center():
    raw = [{"concept": "dog", "scope": "local"}]
    out = _normalize(raw)
    assert out[0]["anchor"] == [0.5, 0.5]


def test_normalize_dedupes_by_concept():
    raw = [
        {"concept": "dog", "scope": "local", "anchor": [0.4, 0.4]},
        {"concept": "dog", "scope": "local", "anchor": [0.6, 0.6]},
    ]
    out = _normalize(raw)
    assert len(out) == 1


def test_normalize_caps_at_eight():
    raw = [
        {"concept": f"obj_{i}", "scope": "local", "anchor": [0.5, 0.5]}
        for i in range(20)
    ]
    out = _normalize(raw)
    assert len(out) <= 8


def test_normalize_dejitters_overlapping_anchors():
    """Two close-by anchors should be separated to keep pills readable."""
    raw = [
        {"concept": "dog", "scope": "local", "anchor": [0.5, 0.5]},
        {"concept": "cat", "scope": "local", "anchor": [0.51, 0.5]},
    ]
    out = _normalize(raw)
    # both kept, but moved further apart than the input
    assert len(out) == 2
    dx = abs(out[0]["anchor"][0] - out[1]["anchor"][0])
    dy = abs(out[0]["anchor"][1] - out[1]["anchor"][1])
    assert (dx * dx + dy * dy) ** 0.5 >= 0.08 - 1e-6
