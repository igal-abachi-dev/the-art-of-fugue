"""The PDF-checked MXL (``python -m artfugue.mxl_checked``): every piece reads back as the pipeline's notes."""

import json

import pytest

from artfugue.mxl_checked import OUT_MXL, REPORT
from artfugue.paths import OVERRIDES, WORK

needs_mxl = pytest.mark.skipif(not (OUT_MXL.exists() and REPORT.exists()), reason="mxl_checked not run")


@needs_mxl
def test_every_piece_reads_back_identical_to_the_pipeline():
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    assert len(report["check"]) == 20
    bad = [c for c in report["check"] if not c["identical"]]
    assert not bad, bad


@needs_mxl
def test_every_correction_was_applied_to_the_xml():
    c = json.loads(REPORT.read_text(encoding="utf-8"))["corrections"]
    assert c["not_found"] == []
    assert c["notes_changed"] >= c["corrections"]


@needs_mxl
def test_the_two_missing_pieces_were_added_with_the_pdf_key_and_almost_every_pitch_from_the_pdf():
    m = json.loads(REPORT.read_text(encoding="utf-8"))["mirror"]
    assert set(m) == {"c12i", "c13r"}
    for stats in m.values():
        assert stats["key_fifths"] == -1
        assert stats["fallback"] <= 0.01 * stats["notes"]  # only grace notes are spelled without a notehead


@needs_mxl
def test_merges_and_splits_were_applied_to_the_xml():
    e = json.loads(REPORT.read_text(encoding="utf-8"))["edits"]
    assert e["not_found"] == []
    assert e["applied"] >= e["edits"]  # each edit is made in the single-voice part and in the combined part


@pytest.mark.skipif(not (WORK / "score" / "pdf_corrections.json").exists(), reason="score data not built")
def test_overrides_are_applied_and_each_says_why():
    corr = json.loads((WORK / "score" / "pdf_corrections.json").read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    pitch = [o for o in overrides if "op" not in o]
    assert len([c for c in corr["corrections"] if c.get("source") == "override"]) == len(pitch)
    assert len(corr["edits"]) >= len([o for o in overrides if o.get("op") in ("merge", "split", "clear_flags", "add_flag")])
    for o in overrides:
        assert o["evidence"]
