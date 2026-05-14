"""Unit tests for the VLM response parser. Pure-function tests — no network."""

from app.services.vlm_tagger_client import parse_vlm_response


def test_complex_fantasy_landscape_example():
    """Example 1 from the curator prompt — five dimensions, comma-rich."""
    text = (
        "<Subject>Ancient glowing ruins, Overgrown mossy architecture, "
        "Cascading waterfalls, Ethereal spirit figures | "
        "<Lighting>Bioluminescent blue glow, Soft moonbeams piercing through canopy, "
        "Dappled forest light, Mystical ambiance, Volumetric rays | "
        "<Texture>Rough stone masonry, Velvety moss, Rippling water surface, "
        "Mist-covered foliage | "
        "<Color>Deep emerald greens, Sapphire blue highlights, Earthy browns, Magic teal | "
        "<Mood>Enchanted, Serene, Mysterious, Ancient, Dreamlike"
    )
    out = parse_vlm_response(text)
    assert set(out.keys()) == {"Subject", "Lighting", "Texture", "Color", "Mood"}
    assert out["Subject"] == [
        "Ancient glowing ruins",
        "Overgrown mossy architecture",
        "Cascading waterfalls",
        "Ethereal spirit figures",
    ]
    assert out["Mood"] == ["Enchanted", "Serene", "Mysterious", "Ancient", "Dreamlike"]
    assert len(out["Lighting"]) == 5


def test_minimalist_logo_example():
    """Example 2 — fewer dimensions, terse content."""
    text = (
        "<Subject>Abstract geometric fox head | <Style>Flat vector art, Modern minimalism | "
        "<Color>Vibrant gradient orange, Pure white | <Composition>Symmetrical balance, Clean negative space"
    )
    out = parse_vlm_response(text)
    assert out["Subject"] == ["Abstract geometric fox head"]
    assert out["Style"] == ["Flat vector art", "Modern minimalism"]
    assert out["Composition"] == ["Symmetrical balance", "Clean negative space"]


def test_tolerant_of_leading_prose_and_newlines():
    """Real models often add intro text and break lines."""
    text = """Sure! Here are the curated highlights:

<Subject>Witch's cottage, Twisted trees, Glowing windows
<Color>Warm amber, Deep violet shadows
<Mood>Spooky, Whimsical, Cozy

Hope this helps!"""
    out = parse_vlm_response(text)
    assert "Subject" in out
    assert "Color" in out
    assert "Mood" in out
    assert out["Mood"] == ["Spooky", "Whimsical", "Cozy"]


def test_strips_trailing_pipe_and_extra_whitespace():
    text = "<Subject>only one thing  |  <Style>another  |"
    out = parse_vlm_response(text)
    assert out["Subject"] == ["only one thing"]
    assert out["Style"] == ["another"]


def test_drops_empty_dimensions():
    text = "<Subject>   |  <Style>good stuff"
    out = parse_vlm_response(text)
    assert "Subject" not in out  # no kws after strip → omitted
    assert out["Style"] == ["good stuff"]


def test_handles_novel_dimension_names():
    """Curator prompt invites the VLM to add dims beyond the pool — we keep them."""
    text = "<Background>Solid white | <Foreground>Geometric icon"
    out = parse_vlm_response(text)
    assert out == {"Background": ["Solid white"], "Foreground": ["Geometric icon"]}


def test_empty_returns_empty_dict():
    assert parse_vlm_response("") == {}
    assert parse_vlm_response("no structured tags here") == {}
