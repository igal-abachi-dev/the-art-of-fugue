"""The shipped events address notes by position in the piece's note chunk (the scenes of E5 depend on that)."""

import json

import pytest

from artfugue.export import DATA

MANIFEST = DATA / "manifest.json"
pytestmark = pytest.mark.skipif(not MANIFEST.exists(), reason="shipped data not built")


def pieces():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["pieces"]


def test_event_notes_are_valid_ascending_positions():
    for p in pieces():
        events = json.loads((DATA / p["events"]).read_text(encoding="utf-8"))
        for e in events:
            assert e["notes"] == sorted(e["notes"]), e["id"]
            assert all(0 <= i < p["n_notes"] for i in e["notes"]), e["id"]


def test_canon_links_pair_each_follower_with_a_leader():
    seen = 0
    for p in pieces():
        for e in json.loads((DATA / p["events"]).read_text(encoding="utf-8")):
            if e["type"] != "canon-link":
                continue
            lead = e["data"]["leader_notes"]
            assert len(lead) == len(e["notes"]), e["id"]
            assert all(0 <= i < p["n_notes"] for i in lead), e["id"]
            seen += len(lead)
    assert seen > 0


def test_mirror_files_have_one_byte_per_note_and_pair_up():
    mirrored = {p["id"]: p for p in pieces() if "mirror" in p}
    assert set(mirrored) == {"c12r", "c12i", "c13r", "c13i"}
    for pid, p in mirrored.items():
        data = (DATA / p["mirror"]["file"]).read_bytes()
        assert len(data) == p["n_notes"], pid
        assert p["mirror"]["pair"] in mirrored
        assert mirrored[p["mirror"]["pair"]]["mirror"]["pair"] == pid
        assert p["mirror"]["axis_sum"] == mirrored[p["mirror"]["pair"]]["mirror"]["axis_sum"]


def test_only_the_last_piece_has_a_tail():
    tails = {p["id"]: p["tail_s"] for p in pieces() if "tail_s" in p}
    last = max(pieces(), key=lambda p: p["audio_end"])["id"]
    assert list(tails) == [last]
    assert 0 < tails[last] <= 5
