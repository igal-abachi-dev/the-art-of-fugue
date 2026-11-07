"""Render the note JSON to MIDI files for listening checks (T1.2.6).

One track per voice, fixed 100 BPM; written to data/work/midi/<piece>.mid.
Usage: python -m artfugue.render_midi [piece ...]    (default: c01 c06 c08 c14 k1 k4)
"""

from __future__ import annotations

import json
import sys

import pretty_midi

from .paths import WORK

DEFAULT = ["c01", "c06", "c08", "c14", "k1", "k4"]
BPM = 100.0


def render(pid: str) -> str:
    doc = json.loads((WORK / "score" / "notes" / f"{pid}.json").read_text(encoding="utf-8"))
    ppq = doc["ppq"]
    sec_per_tick = 60.0 / BPM / ppq
    pm = pretty_midi.PrettyMIDI(initial_tempo=BPM)
    tracks: dict[int, pretty_midi.Instrument] = {}
    for n in doc["notes"]:
        if "grace" in n.get("flags", []):
            continue
        inst = tracks.setdefault(
            n["voice"], pretty_midi.Instrument(program=0, name=f"voice {n['voice']}"))
        start = n["on"] * sec_per_tick
        inst.notes.append(pretty_midi.Note(velocity=80, pitch=n["pitch"], start=start,
                                           end=start + max(n["dur"], 6) * sec_per_tick))
    pm.instruments.extend(tracks[v] for v in sorted(tracks))
    out = WORK / "midi"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{pid}.mid"
    pm.write(str(path))
    return str(path)


if __name__ == "__main__":
    for pid in sys.argv[1:] or DEFAULT:
        print(render(pid))
