"""The sampled instruments of the sampler mode: what `python -m artfugue.instruments` writes."""

import json

import numpy as np
import pytest

from artfugue.instruments import DEST_NAMES, OUT, SPECS, cut_for, measure_pitch, midi_of


def test_midi_of_counts_c3_as_middle_c():
    assert midi_of("C3") == 60
    assert midi_of("A#0") == 34
    assert midi_of("F#4") == 78


def test_cut_follows_the_pitch():
    piano = next(s for s in SPECS if s.id == "piano")
    assert cut_for(piano, 30) == 9.0 and cut_for(piano, 60) == 7.0 and cut_for(piano, 90) == 5.0


def test_pitch_of_a_tone_is_measured_to_a_few_cents():
    sr = 44_100
    t = np.arange(int(2.5 * sr)) / sr
    for hz in (65.41, 261.63, 1046.5):
        y = np.sin(2 * np.pi * hz * t) + 0.5 * np.sin(2 * np.pi * 2 * hz * t)
        assert measure_pitch(y, sr) == pytest.approx(hz, rel=0.002)


@pytest.mark.parametrize("name", DEST_NAMES)
def test_shipped_files_match_the_list(name):
    index = OUT / name / "index.json"
    if not index.exists():
        pytest.skip("samples not built (python -m artfugue.instruments)")
    doc = json.loads(index.read_text(encoding="utf-8"))
    assert doc["license"] == "CC0 1.0" and "Versilian" in doc["credit"]
    files = {f.name for f in (OUT / name).iterdir() if f.name != "index.json"}
    listed = {s["file"] for layer in doc["layers"] for s in layer["samples"]}
    assert files == listed
    vels = [layer["vel"] for layer in doc["layers"]]
    assert vels == sorted(vels)
    for layer in doc["layers"]:
        midis = [s["midi"] for s in layer["samples"]]
        assert midis == sorted(set(midis))
        assert all(abs(s["cents"]) < 50 for s in layer["samples"])
        # the notes of the music (MIDI 35 to 88) are never more than four semitones from a sample (the harpsichord stops at C5, 84, so its top notes go up four)
        for pitch in range(35, 89):
            assert min(abs(pitch - m) for m in midis) <= 4, (name, layer["name"], pitch)
    if name == "organ":
        assert all("loop" in s for layer in doc["layers"] for s in layer["samples"])
