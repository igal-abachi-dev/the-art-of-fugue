"""Checks on the alignment output (data/work/timed, data/work/audio). Skipped until the audio
stage has been run (python -m artfugue.timing)."""

import itertools
import json

import numpy as np
import pytest

from artfugue.export import decode_notes, encode_notes
from artfugue.paths import AUDIO_WORK, WORK
from artfugue.timing import apply_anchors, diff_against_previous

TIMING = AUDIO_WORK / "timing.json"
needs_audio = pytest.mark.skipif(not TIMING.exists(), reason="alignment not run")


@pytest.fixture(scope="module")
def timing():
    return json.loads(TIMING.read_text(encoding="utf-8"))


def timed(pid):
    return json.loads((WORK / "timed" / f"{pid}.json").read_text(encoding="utf-8"))["notes"]


@needs_audio
def test_every_pdf_piece_is_placed_in_order(timing, pieces):
    ids = [p["id"] for p in sorted(pieces.values(), key=lambda p: p["order"]) if p["in_pdf"]]
    assert set(timing) == set(ids)
    spans = sorted((m["audio_start"], m["audio_end"], pid) for pid, m in timing.items())
    for (_a0, b0, p0), (a1, _b1, p1) in itertools.pairwise(spans):
        assert b0 <= a1 + 0.3, (p0, p1)  # no overlap between neighbours
    # the recording order found by the DTW search: I-XI, XII r/i, XIII r/i, canons 4,1,2,3, XIV
    assert [s[2] for s in spans] == ["c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08", "c09", "c10",
                                     "c11", "c12r", "c12i", "c13r", "c13i", "k4", "k1", "k2", "k3", "c14"]


@needs_audio
def test_repeats_decision(timing):
    assert timing["k1"]["repeats_taken"] is True and timing["k3"]["repeats_taken"] is True
    assert all(m["repeats_taken"] is None for pid, m in timing.items() if pid not in ("k1", "k3"))


@needs_audio
def test_timed_notes_are_sane(timing):
    for pid, m in timing.items():
        notes = timed(pid)
        t_on = np.array([n["t_on"] for n in notes])
        t_off = np.array([n["t_off"] for n in notes])
        assert (t_off > t_on).all(), pid
        assert t_on.min() >= m["audio_start"] - 1.0 and t_on.max() <= m["audio_end"] + 0.5, pid
        assert all(0 <= n["conf"] <= 1 and 0.2 <= n["vel"] <= 1 for n in notes), pid
        bars = m["bars"]
        assert all(b0["t"] <= b1["t"] for b0, b1 in itertools.pairwise(bars)), pid


@needs_audio
def test_refinement_beats_plain_dtw_and_chance(timing):
    for pid, m in timing.items():
        s = m["stats"]
        assert s["hit30_final"] >= s["hit30_dtw"] + 0.2, pid
        assert s["hit30_final"] >= s["hit30_chance"] + 0.05, pid


@needs_audio
def test_notes_follow_score_order_within_a_voice(timing):
    """Consecutive notes of one voice keep their score order in time (allowing for 30 ms of jitter)."""
    bad = 0
    total = 0
    for pid in timing:
        notes = sorted(timed(pid), key=lambda n: n["on"])
        by_voice: dict[int, list[dict]] = {}
        for n in notes:
            by_voice.setdefault(n["voice"], []).append(n)
        for v in by_voice.values():
            for a, b in itertools.pairwise(v):
                if b["on"] > a["on"]:
                    total += 1
                    bad += b["t_on"] < a["t_on"] - 0.03
    assert bad / total < 0.01, (bad, total)


def test_binary_chunk_round_trip():
    notes = [{"t_on": 1.5, "t_off": 2.25, "on": 24, "pitch": 62, "voice": 2, "vel": 0.6, "conf": 0.9,
              "bar": 3, "flags": ["fermata", "grace"]},
             {"t_on": 2.0, "t_off": 3.0, "on": 48, "pitch": 70, "voice": 1, "bar": 4, "pass": 2}]
    cols = decode_notes(encode_notes(notes))
    assert list(cols["pitch"]) == [62, 70] and list(cols["pass"]) == [1, 2]
    assert list(cols["flags"]) == [(1 << 0) | (1 << 6), 0]
    assert cols["t_on"][0] == pytest.approx(1.5) and cols["vel"][0] == round(255 * 0.6)


def test_anchors_override_and_diff():
    bars = [{"n": 1, "t": 10.0}, {"n": 2, "t": 12.0}, {"n": 2, "t": 40.0, "pass": 2}]
    assert apply_anchors(bars, [{"bar": 2, "t": 12.5}, {"bar": 2, "pass": 2, "t": 41.0}, {"bar": 9, "t": 1}]) == 2
    assert bars[1] == {"n": 2, "t": 12.5, "anchored": True} and bars[2]["t"] == 41.0
    old = {"c01": {"bars": [{"n": 1, "t": 10.0}, {"n": 2, "t": 12.0}]}}
    new = {"c01": {"bars": [{"n": 1, "t": 10.01}, {"n": 2, "t": 12.5}]}}
    assert diff_against_previous(old, new)["c01"]["bars_moved"] == 1


def test_anchor_points_shift_the_map_between_anchors():
    from artfugue.align import PiecePlan, SegmentResult
    from artfugue.timing import anchor_points

    res = SegmentResult(0, 0.0, 100.0, 0.1, 0.01)
    res.frames_i = np.arange(1000)
    res.audio_t = np.arange(1000) / 10.0  # 1 tick = 0.1 s at 10 frames/s with spt 0.01 -> 10 ticks per second
    plan = PiecePlan("t", "written", [], 1000, [{"n": 1, "on": 100}, {"n": 2, "on": 400}, {"n": 3, "on": 700}])
    pts = anchor_points(res, plan, [{"bar": 2, "t": 4.5}, {"bar": 9, "t": 1.0}])
    assert pts is not None
    auto, shift = pts
    assert list(auto) == [pytest.approx(4.0)] and list(shift) == [pytest.approx(0.5)]
    assert anchor_points(res, plan, []) is None


def test_entry_after_a_rest_and_sparse_notes_are_found_for_the_wide_window():
    import numpy as np

    from artfugue.timing import entry_mask, sparse_mask

    t_on = np.array([0.0, 0.5, 1.0, 3.0, 3.2, 5.0])
    t_off = np.array([0.4, 0.9, 1.5, 3.1, 3.6, 5.5])
    # the first note, and the ones that begin 0.6 s or more after everything before them has ended (3.0 after 1.5; 5.0 after 3.6)
    assert entry_mask(t_on, t_off).tolist() == [True, False, False, True, False, True]
    # a note is sparse if no other begins within 0.35 s either side: 0.0 is 0.5 from the next, 1.0 is 0.5 from 0.5, 3.0/3.2 are 0.2 apart
    assert sparse_mask(t_on).tolist() == [True, True, True, False, False, True]
    # the order the notes are given in does not matter
    perm = np.array([3, 0, 5, 2, 4, 1])
    assert entry_mask(t_on[perm], t_off[perm]).tolist() == [True, True, True, False, False, False]
