"""The overview strip's file (T7.2.6): the format round-trips and the contour picks the note covering most of a column."""

import numpy as np

from artfugue.overview import contours, decode, encode, levels


def test_roundtrip():
    lv = np.array([0, 10, 255], "u1")
    pitch = np.array([[60, 0, 62], [0, 0, 0], [40, 41, 42], [0, 70, 0]], "u1")
    got_lv, got_pitch, step = decode(encode(lv, pitch, 0.5))
    assert step == 0.5
    assert got_lv.tolist() == lv.tolist()
    assert got_pitch.tolist() == pitch.tolist()


def test_contour_takes_the_note_covering_most_of_the_column():
    d = {
        "t_on": np.array([0.0, 0.4], "f4"),
        "t_off": np.array([0.45, 1.0], "f4"),
        "pitch": np.array([60, 64], "u1"),
        "voice": np.array([1, 1], "u1"),
    }
    p = contours([d], 0.5, 2)
    assert p[0].tolist() == [60, 64]  # column 0: 0.45 s of the first, 0.1 s of the second
    assert p[1].tolist() == [0, 0]


def test_levels_span_the_range():
    sr = 1000
    y = np.concatenate([np.zeros(500), np.full(500, 1.0), np.full(500, 0.01)]).astype("f4")
    lv = levels(y, sr, 0.5, 3)
    assert lv.tolist()[0] == 0 and lv.tolist()[1] == 255 and 0 < lv.tolist()[2] < 255
