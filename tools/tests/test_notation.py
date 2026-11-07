"""Checks on the score-overlay data written by ``python -m artfugue.notation`` (T4.4.1)."""

import json

import pytest

from artfugue.export import DATA

NOTATION = DATA / "notation"
needs_notation = pytest.mark.skipif(not (NOTATION / "c01.json").exists(), reason="notation not built")


@pytest.fixture(scope="module")
def manifest():
    return json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))


def doc(pid):
    return json.loads((NOTATION / f"{pid}.json").read_text(encoding="utf-8"))


@needs_notation
def test_every_shipped_piece_has_notation_and_its_page_files(manifest):
    for p in manifest["pieces"]:
        d = doc(p["id"])
        assert d["piece"] == p["id"] and d["source"] == "pdf" and "CC BY-NC-SA" in d["credit"]
        for s in d["systems"]:
            assert (NOTATION / s["svg"]).exists(), s["svg"]


@needs_notation
def test_heads_refer_to_real_notes_and_lie_inside_their_system(manifest):
    for p in manifest["pieces"]:
        d = doc(p["id"])
        for s in d["systems"]:
            cx, cy, cw, ch = s["crop"]
            lo, hi = s["bars"][0]["x0"], s["bars"][-1]["x1"]
            for h in s["heads"]:
                assert lo - 1 <= h[0] <= hi + 1
                assert cy <= h[1] <= cy + ch and cx <= h[0] <= cx + cw
                assert all(0 <= i < p["n_notes"] for i in h[3:])


@needs_notation
def test_nearly_every_note_is_shown_on_a_notehead(manifest):
    for p in manifest["pieces"]:
        shown = {i for s in doc(p["id"])["systems"] for h in s["heads"] for i in h[3:]}
        assert len(shown) >= 0.99 * p["n_notes"], (p["id"], len(shown), p["n_notes"])


@needs_notation
def test_every_bar_of_every_piece_is_on_some_system(manifest):
    for p in manifest["pieces"]:
        on_page = {b["n"] for s in doc(p["id"])["systems"] for b in s["bars"]}
        assert {b["n"] for b in p["bars"]} <= on_page, p["id"]


@needs_notation
def test_every_notation_svg_is_valid_xml_without_control_characters():
    """A browser refuses to draw an SVG that is not well-formed XML (and the overlay then shows no score at all)."""
    import re

    from lxml import etree

    files = sorted(NOTATION.glob("pdf/*.svg")) + sorted((NOTATION.parent / "notation-verovio").glob("*.svg"))
    assert len(files) >= 124
    for f in files:
        text = f.read_text(encoding="utf-8")
        assert not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text), f.name
        etree.fromstring(text.encode("utf-8"))  # raises on a syntax error
