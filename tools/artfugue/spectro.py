"""Ship the spectrogram of the recording, one file per piece, for the spectrogram view (``/stage?spectro``).

The source is the pipeline's own transform (``cqt.py``) without the fold into semitones: 168 rows from C1, two a semitone
(quarter-tone resolution), at every one of its 86 frames a second, level in dB relative to the loudest sound of the whole
recording. Per piece it is cut to the piece's span plus a second either side and quantised to 8 bits (-66 dB and below is 0,
0 dB is 255). That is about 860 columns for the 10 seconds the view shows, enough to fill a 4K (4096 px) screen with a smooth
picture: the view draws it with interpolation.

File ``web/static/data/spectro/<id>.bin`` (little endian, version 2):

    'AFS2', u32 version = 2, u32 rows, u32 cols, f32 t0 (seconds on the WAV timeline of column 0's left edge),
    f32 dt (seconds per column), u32 lowest midi note, i32 floor dB, u32 rows per semitone, then rows x cols bytes, row 0 =
    the lowest pitch. Row r is centred on semitone `lowest + r / rows_per_semitone`.

(Version 1, 'AFS1', had 84 semitone rows, 21.5 columns a second and no rows-per-semitone field; the loader still reads it.)

It is derived from the recording: private use, like the audio itself (``docs/rights.md``).

Run:  python -m artfugue.spectro
"""

from __future__ import annotations

import json
import struct

import numpy as np

from .cqt import FPS, LOWEST_MIDI, quartertone_cqt
from .export import DATA, SCORE
from .paths import WORK

OUT = DATA / "spectro"
GROUP = 1  # frames per column (1: every frame of the transform)
PER_SEMITONE = 2
FLOOR_DB = -66
PAD_S = 1.0
MAGIC = b"AFS2"


def encode(db: np.ndarray, t_start: float, t_end: float) -> tuple[bytes, dict]:
    f0 = max(0, int((t_start - PAD_S) * FPS) // GROUP * GROUP)
    f1 = min(db.shape[1], int((t_end + PAD_S) * FPS) + GROUP)
    seg = db[:, f0:f1].astype(np.float32)
    if GROUP > 1:
        cols = seg.shape[1] // GROUP
        seg = seg[:, : cols * GROUP].reshape(seg.shape[0], cols, GROUP).max(axis=2)
    q = np.clip((seg - FLOOR_DB) / -FLOOR_DB, 0.0, 1.0) * 255.0
    data = np.rint(q).astype(np.uint8)
    t0, dt = f0 / FPS, GROUP / FPS
    head = MAGIC + struct.pack("<IIIffIiI", 2, data.shape[0], data.shape[1], t0, dt, LOWEST_MIDI, FLOOR_DB, PER_SEMITONE)
    return head + data.tobytes(), {"per_semitone": PER_SEMITONE, "rows": data.shape[0], "cols": data.shape[1], "t0": round(t0, 3), "dt": round(dt, 5)}


def main() -> None:
    db = quartertone_cqt()
    OUT.mkdir(parents=True, exist_ok=True)
    pieces = [p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]
              if p["status"] != "excluded" and p.get("audio_start") is not None]
    total = 0
    for p in sorted(pieces, key=lambda p: p["order"]):
        blob, info = encode(db, p["audio_start"], p["audio_end"])
        (OUT / f"{p['id']}.bin").write_bytes(blob)
        total += len(blob)
        print(f"{p['id']}: {info['rows']} x {info['cols']}, {len(blob) / 1e6:.2f} MB")
    print(f"{len(pieces)} files, {total / 1e6:.1f} MB in {OUT}")
    (WORK / "spectro_report.json").write_text(json.dumps({"files": len(pieces), "bytes": total}), encoding="utf-8")


if __name__ == "__main__":
    main()
