"""Align the score with the recording (T2.2.1, T2.3.1).

Per silence-delimited segment of the recording (see locate.py) the pieces it holds are rendered as
symbolic chroma at a nominal tempo and matched with the segment's chroma by one global DTW (10 frames
per second; segments are at most 13 minutes, so the cost matrix stays below 0.5 GB; the recording is
never aligned as a whole). The DTW path becomes a monotone map tick -> seconds per piece.

Repeats of Canon 1 and 3 are decided by the DTW cost of the written and the unfolded version.
"""

from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field

import numpy as np

from .chroma import FPS, normalize, recording_chroma, score_chroma
from .locate import STEPS, load_notes, load_pieces
from .paths import AUDIO_WORK, WORK
from .unfold import unfolded_bars

SCORE = WORK / "score"
GAP_S = 3.0  # nominal pause between pieces that share a segment
LEGATO = 0.9


@dataclass
class PiecePlan:
    pid: str
    variant: str  # "written" | "unfolded"
    notes: list[dict]
    length_ticks: int
    bars: list[dict]  # [{n, on, len, pass?}] in the variant's tick axis
    start_s: float = 0.0  # nominal start inside the segment plan


@dataclass
class SegmentResult:
    seg_id: int
    start: float
    end: float
    cost: float
    spt: float
    pieces: list[PiecePlan] = field(default_factory=list)
    frames_i: np.ndarray | None = None
    audio_t: np.ndarray | None = None  # seconds in the recording for every score frame
    local_cost: np.ndarray | None = None


def _variants(piece: dict) -> list[PiecePlan]:
    out = [PiecePlan(piece["id"], "written", load_notes(piece["id"]), piece["length_ticks"], piece["bars"])]
    if piece.get("unfolded_notes"):
        ub = unfolded_bars(piece)
        out.append(PiecePlan(piece["id"], "unfolded", load_notes(piece["id"], unfolded=True),
                             ub[-1]["on"] + ub[-1]["len"], ub))
    return out


def _plan_chroma(plans: list[PiecePlan], spt: float):
    t = 0.0
    on, off, notes = [], [], []
    for k, p in enumerate(plans):
        if k:
            t += GAP_S
        p.start_s = t
        for n in p.notes:
            on.append(t + n["on"] * spt)
            off.append(t + (n["on"] + max(n["dur"], 6) * LEGATO) * spt)
        notes += p.notes
        t += p.length_ticks * spt
    n_frames = int(np.ceil(t * FPS)) + 1
    X = score_chroma(notes, spt, fps=FPS, times=(np.array(on), np.array(off)), n_frames=n_frames)
    return normalize(np.sqrt(X), smooth=5), t


def align_segment(seg: dict, pieces: dict[str, dict], rec_norm: np.ndarray, plans: list[PiecePlan]) -> SegmentResult:
    import librosa

    a, b = seg["start"], seg["end"]
    i0, i1 = round(a * FPS), round(b * FPS)
    Y = rec_norm[:, i0:i1]
    total_ticks = sum(p.length_ticks for p in plans)
    spt = (b - a - GAP_S * (len(plans) - 1)) / total_ticks
    X, _t = _plan_chroma(plans, spt)
    D, wp = librosa.sequence.dtw(X=X, Y=Y, metric="cosine", step_sizes_sigma=STEPS,
                                 weights_add=np.zeros(3), weights_mul=np.ones(3))
    wp = wp[::-1]  # increasing
    cost = float(D[-1, -1]) / len(wp)
    nx = X.shape[1]
    sums = np.zeros(nx)
    cnt = np.zeros(nx)
    dist = np.zeros(nx)
    for i, j in wp:
        sums[i] += j
        cnt[i] += 1
        dist[i] += 1.0 - float(X[:, i] @ Y[:, j])
    tau = np.maximum.accumulate(sums / np.maximum(cnt, 1))
    res = SegmentResult(seg["id"], a, b, cost, spt, plans)
    res.frames_i = np.arange(nx)
    res.audio_t = a + tau / FPS
    res.local_cost = dist / np.maximum(cnt, 1)
    return res


def tick_time(res: SegmentResult, plan: PiecePlan, ticks: np.ndarray) -> np.ndarray:
    """Seconds in the recording for piece ticks (linear interpolation of the DTW map)."""
    frame = (plan.start_s + ticks * res.spt) * FPS
    return np.interp(frame, res.frames_i, res.audio_t)


def local_cost_at(res: SegmentResult, plan: PiecePlan, ticks: np.ndarray, half: int = 10) -> np.ndarray:
    from scipy.ndimage import uniform_filter1d

    sm = uniform_filter1d(res.local_cost, size=2 * half + 1, mode="nearest")
    frame = ((plan.start_s + ticks * res.spt) * FPS).astype(int)
    return sm[np.clip(frame, 0, len(sm) - 1)]


def run_segments(only: set[str] | None = None) -> list[SegmentResult]:
    layout = json.loads((AUDIO_WORK / "layout.json").read_text(encoding="utf-8"))
    pieces = {p["id"]: p for p in load_pieces()}
    rec = recording_chroma()
    rec_norm = normalize(np.sqrt(rec), smooth=5)
    results = []
    for seg in layout["segments"]:
        if only and not (set(seg["pieces"]) & only):
            continue
        options = [_variants(pieces[pid]) for pid in seg["pieces"]]
        best = None
        for combo in itertools.product(*options):
            res = align_segment(seg, pieces, rec_norm, [PiecePlan(**vars(p)) for p in combo])
            tag = "+".join(f"{p.pid}:{p.variant}" for p in combo)
            print(f"segment {seg['id']:2d} {tag:45s} cost {res.cost:.4f}", flush=True)
            if best is None or res.cost < best.cost:
                best = res
        results.append(best)
    return results
