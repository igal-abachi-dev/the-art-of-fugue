"""The spectrogram files (``python -m artfugue.spectro``) match what the web loader reads (web/src/lib/spectro/spectro.ts)."""

import struct

import pytest

from artfugue.export import DATA

FILES = sorted((DATA / "spectro").glob("*.bin"))
needs = pytest.mark.skipif(not FILES, reason="spectro not built")


@needs
def test_every_piece_has_a_file_with_a_consistent_header():
    assert len(FILES) == 20
    for f in FILES:
        b = f.read_bytes()
        assert b[:4] == b"AFS2"
        version, rows, cols, t0, dt, lowest, floor, per_semitone = struct.unpack("<IIIffIiI", b[4:36])
        assert version == 2 and per_semitone == 2 and rows == 168 and lowest == 24 and floor == -66
        assert len(b) == 36 + rows * cols, f.name  # the header is 36 bytes, as the loader assumes
        assert 0.0115 < dt < 0.0118 and t0 > 0 and cols > 4000  # every one of the transform's 86 frames a second


@needs
def test_the_music_is_in_the_data_not_only_silence():
    b = FILES[0].read_bytes()
    assert sum(1 for v in b[36::97] if v > 128) > 50
