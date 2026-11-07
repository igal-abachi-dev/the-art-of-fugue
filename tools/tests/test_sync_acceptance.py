"""Sync acceptance (T9.2.3): the shipped note timings against the committed reference points, at the project's tolerance.

Needs no recording: the reference points (data/sync-reference.json) were measured on it once and are committed, and the
timings are the note chunks that ship. A pipeline change that makes the timings worse fails here, and so does the release check.
"""

import json

import pytest

from artfugue import syncref


@pytest.fixture(scope="module")
def result():
    doc = json.loads(syncref.REFERENCE.read_text(encoding="utf-8"))
    return syncref.evaluate(doc["points"])


def test_every_reference_note_is_in_the_shipped_data(result):
    assert result["missing"] == []


def test_enough_reference_points_across_all_piece_types(result):
    assert result["matched"] >= syncref.MIN_POINTS
    kinds = {p["kind"] for p in syncref.load_manifest()["pieces"]}
    assert set(result["by_kind"]) == kinds
    assert len(result["pieces"]) >= 14  # most pieces have at least one; the report lists those with none


def test_median_error_is_within_the_tolerance(result):
    assert result["all"]["median"] <= syncref.MEDIAN_LIMIT_MS


def test_95th_percentile_error_is_within_the_tolerance(result):
    assert result["all"]["p95"] <= syncref.P95_LIMIT_MS


def test_the_evaluation_sees_an_error_when_there_is_one():
    pts = json.loads(syncref.REFERENCE.read_text(encoding="utf-8"))["points"]
    moved = [{**p, "t_ref": p["t_ref"] + 0.2} for p in pts]  # as if every shipped note were 200 ms off
    bad = syncref.evaluate(moved)
    assert bad["problems"], "a 200 ms shift of every note must fail the acceptance"


def test_stats_of_known_errors():
    # the check is only as good as its arithmetic: median and 95th percentile of a hand-made set
    import numpy as np

    err = np.array([10.0, 20.0, 30.0, 40.0, 90.0])
    assert float(np.median(np.abs(err))) == 30.0
    assert float(np.percentile(np.abs(err), 95)) == pytest.approx(80.0)
