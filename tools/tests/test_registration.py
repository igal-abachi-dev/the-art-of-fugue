"""The organ's registration score: its shape, its rules and the overrides."""

import itertools
import json

import numpy as np
import pytest

from artfugue import registration as reg
from artfugue import syncref


def test_overrides_cut_the_segments_around_them_and_merge_equal_neighbours():
    pieces = {"c01": {"1": [[0.0, 10.0, "full"], [10.0, 20.0, "flute"], [20.0, 30.0, "full"]]}}
    applied = reg.apply_overrides(
        pieces,
        {
            "_about": "x",
            "c01": {"1": [[5.0, 12.0, "flute"], [25.0, 28.0, "flute"]]},
            "c99": {"1": [[0, 1, "full"]]},
        },
    )
    assert applied == 2
    assert pieces["c01"]["1"] == [
        [0.0, 5.0, "full"],
        [5.0, 20.0, "flute"],
        [20.0, 25.0, "full"],
        [25.0, 28.0, "flute"],
        [28.0, 30.0, "full"],
    ]


def test_a_bad_override_is_refused():
    with pytest.raises(ValueError):
        reg.apply_overrides(
            {"c01": {"1": [[0.0, 5.0, "full"]]}}, {"c01": {"1": [[3.0, 2.0, "flute"]]}}
        )
    with pytest.raises(ValueError):
        reg.apply_overrides(
            {"c01": {"1": [[0.0, 5.0, "full"]]}}, {"c01": {"1": [[1.0, 2.0, "oboe"]]}}
        )


def test_segments_run_along_a_voice_and_end_where_told():
    t = np.array([1.0, 2.0, 3.0, 4.0])
    out = reg.segments(t, np.array([True, True, False, True]), 9.0)
    assert out == [[1.0, 3.0, "full"], [3.0, 4.0, "flute"], [4.0, 9.0, "full"]]


def test_the_texture_modes_hold_for_the_dwell_time():
    step = reg.STEP_S
    drama = np.array(
        [0.0] * 20 + [2.0] * 4 + [0.0] * 4 + [2.0] * 40
    )  # a short burst, then a long climax
    modes = reg.modes_of(drama, step)
    assert modes[10] == 0
    assert modes.max() == 1
    changes = int((np.diff(modes) != 0).sum())
    assert changes <= 3


def test_the_shipped_score_covers_every_voice_of_every_piece():
    if not reg.OUT.exists():
        pytest.skip("not built (python -m artfugue.registration)")
    doc = json.loads(reg.OUT.read_text(encoding="utf-8"))
    manifest = syncref.load_manifest()
    assert set(doc["pieces"]) == {p["id"] for p in manifest["pieces"]}
    for p in manifest["pieces"]:
        c = syncref.load_chunk(p)
        voices = doc["pieces"][p["id"]]
        assert set(voices) == {str(int(v)) for v in np.unique(c["voice"])}
        for voice, segs in voices.items():
            starts = [s[0] for s in segs]
            assert starts == sorted(starts) and all(
                s[1] > s[0] and s[2] in ("full", "flute") for s in segs
            )
            assert all(a[1] == b[0] and a[2] != b[2] for a, b in itertools.pairwise(segs)), (
                p["id"],
                voice,
            )
            first = float(c["t_on"][c["voice"] == int(voice)].min())
            assert segs[0][0] == pytest.approx(first, abs=0.0011)
            assert segs[-1][1] > p["audio_end"]


def test_the_theme_is_the_full_rank_where_it_does_not_lie_in_the_high_octaves():
    if not reg.OUT.exists():
        pytest.skip("not built (python -m artfugue.registration)")
    doc = json.loads(reg.OUT.read_text(encoding="utf-8"))
    piece = next(p for p in syncref.load_manifest()["pieces"] if p["id"] == "c02")
    c = syncref.load_chunk(piece)
    events = json.loads((reg.DATA / piece["events"]).read_text(encoding="utf-8"))
    notes = [i for e in events if e["type"] == "subject-entry" for i in e["notes"]]
    full = 0
    low = 0
    for i in notes:
        if c["pitch"][i] >= reg.HIGH_FROM:
            continue
        low += 1
        segs = doc["pieces"]["c02"][str(int(c["voice"][i]))]
        t = float(c["t_on"][i])
        name = next(s[2] for s in segs if s[0] <= t < s[1])
        full += name == "full"
    # most of them: a hush in the recording or a passage that lies high takes the theme to the flute too
    assert low > 20 and full / low > 0.6
