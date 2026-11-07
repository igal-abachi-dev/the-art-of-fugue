"""Where does the recording play a different pitch from the score? (Candidates for differences between the PDF and
the Urtext edition the pianist may be reading.)

For every note of every piece the semitone CQT of the recording is read over the first 0.4 s of the note. A note is
**flagged** when the pitch a semitone above or below the written one stands clearly above it (by ``MARGIN_DB``) and
no other written note that sounds then explains that pitch (as itself or as an octave). This finds the kind of
difference editions have most often: a sharp or natural the one text prints and the other does not.

It is a list of candidates to look at, not a verdict: a note can be masked by louder neighbours, a trill or an
ornament sounds around its written pitch, pedal carries notes on, and the recording has its own mistakes. Notes shorter
than ``MIN_DUR_S`` are skipped (the window would be mostly the previous note).

Run:  python -m artfugue.recording_vs_score      (writes data/work/recording_vs_score.json)
"""

from __future__ import annotations

import bisect
import json

import numpy as np

from .audio_check import cqt
from .cqt import FPS, LOWEST_MIDI
from .paths import WORK

TIMED = WORK / "timed"
SCORE = WORK / "score"
MARGIN_DB = 8.0
MIN_DUR_S = 0.12
WINDOW_S = 0.4
NEAR_S = 0.6
SHIFTS = (-1, 1)  # a sharp, a flat or a natural: the usual difference between editions


def margin(db: np.ndarray, t: float, midi: int) -> float:
    """How far (dB) the pitch stands above the median of the twelve semitones around it, fundamental or octave."""
    a, b = int((t + 0.04) * FPS), int((t + WINDOW_S) * FPS)
    row = midi - LOWEST_MIDI
    win = db[:, a:b].mean(axis=1)
    own = max(win[row], win[row + 12] if row + 12 < len(win) else -99.0)
    return float(own - np.median(np.concatenate([win[row - 6 : row], win[row + 1 : row + 7]])))


def candidates_for_piece(pid: str, db: np.ndarray) -> tuple[list[dict], int]:
    notes = [n for n in json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))["notes"]
             if "grace" not in n.get("flags", [])]
    notes.sort(key=lambda n: n["t_on"])
    starts = [n["t_on"] for n in notes]
    out, checked = [], 0
    for n in notes:
        if n["t_off"] - n["t_on"] < MIN_DUR_S:
            continue
        row = n["pitch"] - LOWEST_MIDI
        if not 8 <= row < db.shape[0] - 14:
            continue
        t = n["t_on"]
        # written pitches that sound in the window, or begin or end within NEAR_S of it (an alignment off by a few
        # tens of milliseconds, or a pedalled note, puts the previous or next note into the window)
        lo = bisect.bisect_left(starts, t - 25.0)
        hi = bisect.bisect_right(starts, t + WINDOW_S + NEAR_S)
        explained = {m["pitch"] for m in notes[lo:hi] if m["t_off"] > t - NEAR_S}
        explained |= {p + 12 for p in explained} | {p - 12 for p in explained}
        own = margin(db, t, n["pitch"])
        checked += 1
        best = None
        for d in SHIFTS:
            alt = n["pitch"] + d
            if alt in explained:
                continue
            m = margin(db, t, alt)
            if best is None or m > best[1]:
                best = (alt, m)
        if best and best[1] >= own + MARGIN_DB and best[1] > MARGIN_DB:
            out.append({"piece": pid, "bar": n["bar"], "beat": n["beat"], "voice": n["voice"], "written": n["pitch"],
                        "stronger": best[0], "own_db": round(own, 1), "stronger_db": round(best[1], 1),
                        "excess_db": round(best[1] - own, 1), "t": round(t, 2), "id": n["id"]})
    return out, checked


def main() -> None:
    db = cqt()
    pieces = [p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]
              if p["status"] != "excluded"]
    allc, per, total = [], {}, 0
    for p in sorted(pieces, key=lambda p: p["order"]):
        c, n = candidates_for_piece(p["id"], db)
        allc += c
        per[p["id"]] = {"checked": n, "flagged": len(c)}
        total += n
    allc.sort(key=lambda c: -c["excess_db"])
    out = {"margin_db": MARGIN_DB, "checked": total, "flagged": len(allc), "per_piece": per, "candidates": allc}
    (WORK / "recording_vs_score.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(allc)} of {total} notes flagged ({len(allc) / total:.1%})")
    for pid, v in per.items():
        print(f"  {pid}: {v['flagged']} / {v['checked']}")


if __name__ == "__main__":
    main()
