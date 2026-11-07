"""T2.1.2: find where every piece lies in the recording.

1. Silent gaps (analysis.json) cut the recording into segments.
2. Every piece is searched on its own in the whole recording (subsequence DTW on 5 Hz chroma,
   symbolic score chroma at a nominal tempo). The best place must beat the second best clearly.
3. Pieces are assigned to the segment that contains most of their match; the order of the pieces
   inside a segment follows their match positions.

Output: data/work/audio/layout.json  {segments: [{id, start, end, pieces: [...]}], search: {...}}
"""

from __future__ import annotations

import json

import numpy as np

from .chroma import normalize, recording_chroma, score_chroma
from .paths import AUDIO_WORK, WORK

SCORE = WORK / "score"
NOMINAL_SEC_PER_QUARTER = 0.575  # the whole score at this tempo fills the whole recording
STEPS = np.array([[1, 1], [1, 2], [2, 1]])


def load_pieces() -> list[dict]:
    doc = json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]
    return sorted((p for p in doc if p["status"] != "excluded"), key=lambda p: p["order"])


def load_notes(pid: str, unfolded: bool = False) -> list[dict]:
    name = f"{pid}.unfolded.json" if unfolded else f"{pid}.json"
    notes = json.loads((SCORE / "notes" / name).read_text(encoding="utf-8"))["notes"]
    return [n for n in notes if "grace" not in n.get("flags", [])]


def segments_from_silence(analysis: dict, key: str = "-40dB/1.5s") -> list[tuple[float, float]]:
    gaps = analysis["silences"][key]
    total = analysis["duration"]
    cuts = [(g["start"], g["end"]) for g in gaps]
    segs, pos = [], 0.0
    for s, e in cuts:
        if s - pos > 5:  # ignore slivers
            segs.append((pos, s))
        pos = e
    if total - pos > 5:
        segs.append((pos, total))
    # the recording starts with a silent lead-in: the first cut starts at 0 and ends at the music
    return [(a, b) for a, b in segs if b - a > 5]


def search_piece(notes, Y5: np.ndarray, sec_per_tick: float):
    import librosa

    X = normalize(np.sqrt(score_chroma(notes, sec_per_tick, fps=5.0)), smooth=3)
    D, wp = librosa.sequence.dtw(X=X, Y=Y5, metric="cosine", subseq=True, step_sizes_sigma=STEPS,
                                 weights_add=np.zeros(3), weights_mul=np.ones(3))
    last = D[-1, :]
    end = int(np.argmin(last))
    start = int(wp[-1, 1])
    mask = np.ones_like(last, bool)
    mask[max(0, end - 2 * X.shape[1]) : end + 2 * X.shape[1]] = False
    e2 = int(np.argmin(np.where(mask, last, np.inf)))
    n = len(wp)
    return {"start": start / 5, "end": end / 5, "cost": float(last[end]) / n, "second_end": e2 / 5,
            "second_cost": float(last[e2]) / n}


def main() -> None:
    analysis = json.loads((AUDIO_WORK / "analysis.json").read_text(encoding="utf-8"))
    segs = segments_from_silence(analysis)
    rec = recording_chroma()
    rec5 = rec[:, : rec.shape[1] // 2 * 2].reshape(12, -1, 2).mean(axis=2)
    Y5 = normalize(np.sqrt(rec5), smooth=3)
    search = {}
    for p in load_pieces():
        search[p["id"]] = search_piece(load_notes(p["id"]), Y5, NOMINAL_SEC_PER_QUARTER / 24)
        s = search[p["id"]]
        print(f"{p['id']:5s} {s['start']:7.1f}-{s['end']:7.1f}  cost {s['cost']:.3f}  2nd {s['second_cost']:.3f}", flush=True)
    placed = {i: [] for i in range(len(segs))}
    for pid, s in search.items():
        mid = (s["start"] + s["end"]) / 2
        k = next((i for i, (a, b) in enumerate(segs) if a - 5 <= mid <= b + 5), None)
        if k is None:
            raise RuntimeError(f"{pid}: match centre {mid:.0f}s lies in a silent gap")
        placed[k].append((s["start"], pid))
    layout = {"segments": [{"id": i, "start": round(a, 3), "end": round(b, 3),
                            "pieces": [pid for _t, pid in sorted(placed[i])]} for i, (a, b) in enumerate(segs)],
              "search": search}
    (AUDIO_WORK / "layout.json").write_text(json.dumps(layout, indent=1) + chr(10), encoding="utf-8")
    for sgm in layout["segments"]:
        print(sgm["id"], sgm["start"], sgm["end"], sgm["pieces"])


if __name__ == "__main__":
    main()
