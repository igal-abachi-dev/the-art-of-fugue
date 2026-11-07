"""The overview strip of the seek bar (T7.2.6): what the whole recording looks like, in one small file.

Run:  python -m artfugue.overview
Writes web/static/data/overview.bin, format "AFO1" (little endian):

  16-byte header: magic 'AFO1', u32 columns, f32 step (seconds per column), u32 voices
  u8 level[columns]               loudness of the recording in the column, 0..255 over -60..0 dBFS (RMS)
  u8 pitch[voices][columns]       the MIDI pitch the voice sounds in the column (the note that covers most of it), 0 = silent

The seek bar draws the level as a waveform and each voice's pitch as a coloured contour on it, as the overview strip of a
DJ program shows where a track is loud and where it changes, and so lets the listener see the structure of the work and
jump to a place by sight. It is derived from the recording and the timed notes, so it needs the same inputs as the export.
"""

from __future__ import annotations

import json
import struct

import numpy as np

from .export import DATA, decode_notes

MAGIC = b"AFO1"
STEP = 0.5
VOICES = 4
FLOOR_DB = -60.0


def levels(y: np.ndarray, sr: float, step: float, columns: int) -> np.ndarray:
    """RMS of each column in dBFS mapped to 0..255 (silence below FLOOR_DB is 0)."""
    n = round(step * sr)
    out = np.zeros(columns, "u1")
    for i in range(columns):
        seg = y[i * n : (i + 1) * n]
        if len(seg) == 0:
            break
        rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2)))
        db = 20 * np.log10(max(rms, 1e-9))
        out[i] = round(255 * min(1.0, max(0.0, (db - FLOOR_DB) / -FLOOR_DB)))
    return out


def contours(notes: list[dict[str, np.ndarray]], step: float, columns: int) -> np.ndarray:
    """For each voice and column the pitch of the note that covers most of the column (0 = none)."""
    best = np.zeros((VOICES, columns), "f4")  # covered seconds of the best note so far
    pitch = np.zeros((VOICES, columns), "u1")
    for d in notes:
        for t0, t1, p, v in zip(d["t_on"], d["t_off"], d["pitch"], d["voice"]):
            if not 1 <= v <= VOICES:
                continue
            a = max(0, int(t0 // step))
            b = min(columns - 1, int(t1 // step))
            for c in range(a, b + 1):
                cover = min(t1, (c + 1) * step) - max(t0, c * step)
                if cover > best[v - 1, c]:
                    best[v - 1, c] = cover
                    pitch[v - 1, c] = p
    return pitch


def encode(level: np.ndarray, pitch: np.ndarray, step: float) -> bytes:
    columns = len(level)
    out = bytearray(MAGIC + struct.pack("<IfI", columns, step, pitch.shape[0]))
    out += level.tobytes()
    out += b"\0" * (-len(out) % 4)
    for row in pitch:
        out += row.tobytes()
    return bytes(out)


def decode(buf: bytes) -> tuple[np.ndarray, np.ndarray, float]:
    assert buf[:4] == MAGIC
    columns, step, voices = struct.unpack("<IfI", buf[4:16])
    level = np.frombuffer(buf, "u1", columns, 16)
    pos = 16 + columns
    pos += -pos % 4
    pitch = np.frombuffer(buf, "u1", voices * columns, pos).reshape(voices, columns)
    return level, pitch, step


def main() -> None:
    from .cqt import SR, load_mono_22k

    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    columns = int(np.ceil(manifest["duration"] / STEP))
    y = load_mono_22k()
    lv = levels(y, SR, STEP, columns)
    notes = [decode_notes((DATA / p["notes"]).read_bytes()) for p in manifest["pieces"]]
    pitch = contours(notes, STEP, columns)
    blob = encode(lv, pitch, STEP)
    (DATA / "overview.bin").write_bytes(blob)
    print(f"overview.bin: {columns} columns of {STEP} s, {len(blob) / 1e3:.1f} kB; {int((pitch > 0).sum())} voice-columns sounding")


if __name__ == "__main__":
    main()
