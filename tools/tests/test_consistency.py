"""MXL, PDF and recording agree (``python -m artfugue.consistency``)."""

import json

import pytest

from artfugue.paths import WORK

FILE = WORK / "consistency.json"
needs = pytest.mark.skipif(not FILE.exists(), reason="consistency not run")


@pytest.fixture(scope="module")
def doc():
    return json.loads(FILE.read_text(encoding="utf-8"))


@needs
def test_every_pieces_notes_are_audible_at_their_aligned_time_and_clearly_less_so_when_moved(doc):
    for pid, r in doc["alignment"].items():
        assert r["aligned"] >= 0.90, (pid, r)
        assert r["aligned"] - r["shifted"] >= 0.15, (pid, r)


@needs
def test_the_pdfs_repeat_signs_are_the_mxls_and_are_the_ones_played(doc):
    r = doc["repeats"]
    assert r["agree"]
    assert r["pieces_with_signs_in_pdf"] == ["k1", "k3"] == r["played_with_repeats"]
    assert len(r["pdf_repeat_signs"]) == 4  # a forward and a backward sign in each of the two canons


@needs
def test_the_unfinished_fugue_ends_where_the_text_does_and_the_recording_dies_away(doc):
    e = doc["ending"]
    assert e["bars"] == e["last_bar"] == 239
    assert e["last_bar_starts_s"] < e["last_note_off_s"] < e["recording_s"]
    assert e["level_db_around_last_note_off"]["+2s"] < -45  # nothing sounds after the last note
