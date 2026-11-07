"""Timed notes for every piece (T2.3.1, T2.3.2, T2.3.3, T2.3.6).

Run:  python -m artfugue.timing            (needs data/work/audio/layout.json from artfugue.locate)

For every piece:
  1. DTW map tick -> seconds (align.py).
  2. Note-level refinement: pass 1 around the DTW time (+-150 ms); the median shift of the clear
     peaks (running median over +-1.5 s) corrects the DTW time; pass 2 searches +-90 ms around that.
  3. Release time: DTW time of the written end, shortened for the detached touch (estimate only).
  4. Confidence 0..1 from the DTW local cost and from the strength of the refined peak.
  5. Velocity 0..1 from the note's level (rank over all notes of the recording).
Anchors in data/anchors.json (bar -> seconds, T2.3.4) override the automatic bar times.
"""

from __future__ import annotations

import json
import sys

import numpy as np

from .align import SegmentResult, local_cost_at, run_segments, tick_time
from .locate import load_pieces
from .paths import AUDIO_WORK, ROOT, WORK
from .refine import BroadbandPeaks, Onsets, onset_contrast, refine_onsets
from .validate import validate

SCORE = WORK / "score"
OUT = WORK / "timed"
ANCHORS = ROOT / "data" / "anchors.json"
ARTICULATION = 0.92  # detached touch: written length * this (estimate, section 1b of the backlog)
MIN_DUR_S = 0.05
ENTRY_REST_S = 0.6  # everything before a note has ended this long ahead of it: an entry after a rest (or a piece beginning)
ENTRY_WINDOW_S = 0.45  # how far from the DTW time such an entry is looked for
SPARSE_GAP_S = 0.35  # a note with no other onset this close on either side is also looked for in the wide window


def running_median_offset(t: np.ndarray, off: np.ndarray, found: np.ndarray, half_s: float = 1.5) -> np.ndarray:
    """Median of the refined-minus-DTW shifts of the clear peaks within +-half_s of every note."""
    idx = np.where(found)[0]
    if len(idx) == 0:
        return np.zeros(len(t))
    order = idx[np.argsort(t[idx])]
    ts, offs = t[order], off[order]
    lo = np.searchsorted(ts, t - half_s)
    hi = np.searchsorted(ts, t + half_s)
    out = np.zeros(len(t))
    for k in range(len(t)):
        a, b = lo[k], hi[k]
        out[k] = np.median(offs[a:b]) if b > a else 0.0
    return out


def entry_mask(t_start: np.ndarray, t_end: np.ndarray, rest_s: float = ENTRY_REST_S) -> np.ndarray:
    """Notes that begin at least ``rest_s`` after every earlier note has ended (the first note counts)."""
    order = np.argsort(t_start, kind="stable")
    ended = np.maximum.accumulate(t_end[order])
    gap = np.empty(len(order))
    gap[0] = np.inf
    gap[1:] = t_start[order][1:] - ended[:-1]
    mask = np.zeros(len(t_start), bool)
    mask[order] = gap >= rest_s
    return mask


def sparse_mask(t_start: np.ndarray, gap_s: float = SPARSE_GAP_S) -> np.ndarray:
    """Notes with no other note beginning within ``gap_s`` before or after them."""
    order = np.argsort(t_start, kind="stable")
    t = t_start[order]
    d = np.diff(t)
    before = np.concatenate([[np.inf], d])
    after = np.concatenate([d, [np.inf]])
    mask = np.zeros(len(t_start), bool)
    mask[order] = (before >= gap_s) & (after >= gap_s)
    return mask


def load_anchors() -> dict:
    if ANCHORS.exists():
        return json.loads(ANCHORS.read_text(encoding="utf-8"))
    return {}


def apply_anchors(bars: list[dict], anchors: list[dict]) -> int:
    """Overwrite bar times by hand-set anchors ``{"bar": n, "t": seconds, "pass": 1}``; returns how many."""
    done = 0
    for a in anchors:
        for b in bars:
            if b["n"] == a["bar"] and b.get("pass", 1) == a.get("pass", 1):
                b["t"], b["anchored"] = a["t"], True
                done += 1
    return done


def anchor_points(res: SegmentResult, plan, anchors: list[dict]):
    """(auto times of the anchored bars, shifts to the anchor times), or None without anchors."""
    pairs = []
    for a in anchors:
        for b in plan.bars:
            if b["n"] == a["bar"] and b.get("pass", 1) == a.get("pass", 1):
                auto = float(tick_time(res, plan, np.array([b["on"]]))[0])
                pairs.append((auto, a["t"] - auto))
    if not pairs:
        return None
    pairs.sort()
    return np.array([p[0] for p in pairs]), np.array([p[1] for p in pairs])


def diff_against_previous(old: dict, new: dict) -> dict:
    """Per piece: bars whose time moved by more than 50 ms since the previous run."""
    out = {}
    for pid, m in new.items():
        prev = old.get(pid)
        if not prev:
            continue
        a = {(b["n"], b.get("pass", 1)): b["t"] for b in prev["bars"]}
        moved = [(b["n"], round(b["t"] - a[(b["n"], b.get("pass", 1))], 3)) for b in m["bars"]
                 if (b["n"], b.get("pass", 1)) in a and abs(b["t"] - a[(b["n"], b.get("pass", 1))]) > 0.05]
        if moved:
            out[pid] = {"bars_moved": len(moved), "largest_s": max(abs(d) for _n, d in moved),
                        "examples": moved[:5]}
    return out


def time_piece(res: SegmentResult, plan, ons: Onsets, bb: BroadbandPeaks, level_cache: list, anchors: dict) -> dict:
    notes = [dict(n) for n in plan.notes]
    on = np.array([n["on"] for n in notes])
    dur = np.array([n["dur"] for n in notes])
    pitch = np.array([n["pitch"] for n in notes])
    t_dtw = tick_time(res, plan, on)
    t_end_dtw = tick_time(res, plan, on + dur)
    # hand-set anchors move the DTW map (linear in between, constant outside) before the refinement
    pts = anchor_points(res, plan, anchors.get(plan.pid, []))
    if pts:
        t_dtw = t_dtw + np.interp(t_dtw, pts[0], pts[1])
        t_end_dtw = t_end_dtw + np.interp(t_end_dtw, pts[0], pts[1])
    import artfugue.refine as R

    # Entries after a rest. Chroma DTW can place the beginning of a segment a few hundred ms late, further than the note-level
    # refinement looks (+-150 ms), and nothing before such a note can be mistaken for it. The same holds for a note with no
    # other onset within SPARSE_GAP_S either side: a neighbour cannot be mistaken for it either. These notes, and only these, are
    # looked for in a wide window first; the release moves with the onset (the note keeps its length). Found by the sync
    # acceptance test (T9.2.3): the first notes of Contrapunctus XI and Canon 2 were 270-300 ms late.
    entry = entry_mask(t_dtw, t_end_dtw) | sparse_mask(t_dtw)
    R.WINDOW_S = ENTRY_WINDOW_S
    t_e, _s_e, f_e = refine_onsets(ons, pitch, t_dtw)
    moved = entry & f_e
    delta = np.where(moved, t_e - t_dtw, 0.0)
    t_dtw = t_dtw + delta
    t_end_dtw = t_end_dtw + delta
    # pass 1 and pass 2

    R.WINDOW_S = 0.15
    t1, _s1, f1 = refine_onsets(ons, pitch, t_dtw)
    shift = running_median_offset(t_dtw, t1 - t_dtw, f1)
    t_pred2 = t_dtw + shift
    R.WINDOW_S = 0.09
    t2, s2, f2 = refine_onsets(ons, pitch, t_pred2)
    t_on = np.where(f2, t2, t_pred2)
    # releases
    rel = (t_end_dtw - t_dtw) * np.where(dur >= 12, ARTICULATION, 1.0) + shift * 0
    t_off = np.maximum(t_on + np.maximum(rel, MIN_DUR_S), t_on + MIN_DUR_S)
    # confidence
    lc = local_cost_at(res, plan, on)
    c_dtw = np.clip(1.0 - lc / 0.35, 0.0, 1.0)
    c_peak = np.where(f2, np.clip(s2 / 25.0, 0.0, 1.0), 0.0)
    conf = np.clip(0.5 * c_dtw + 0.5 * np.maximum(c_peak, 0.3 * c_dtw), 0.0, 1.0)
    contrast_dtw = onset_contrast(ons, pitch, t_dtw)
    contrast = onset_contrast(ons, pitch, t_on)
    # level for the velocity (peak of the weighted rows right after the onset)
    lv = np.zeros(len(notes), np.float32)
    for k in range(len(notes)):
        p = int(pitch[k])
        if 24 <= p < 108:
            f = round(t_on[k] * 86.1328125)
            lv[k] = ons.level(p, max(f, 0), min(f + 12, ons.frames)).max()
    level_cache.append((plan.pid, lv))
    for k, n in enumerate(notes):
        n["t_on"] = round(float(t_on[k]), 4)
        n["t_off"] = round(float(t_off[k]), 4)
        n["conf"] = round(float(conf[k]), 3)
    grace = np.array(["grace" in n.get("flags", []) for n in notes])
    # bar times from the map (ticks of the variant's own axis)
    bars = []
    for b in plan.bars:
        tb = float(tick_time(res, plan, np.array([b["on"]]))[0])
        if pts:
            tb += float(np.interp(tb, pts[0], pts[1]))
        inside = (on >= b["on"]) & (on < b["on"] + b["len"]) & ~grace
        bars.append({"n": b["n"], "t": round(tb, 3), **({"pass": b["pass"]} if "pass" in b else {}),
                     "conf": round(float(np.median(conf[inside])), 3) if inside.any() else None})
    apply_anchors(bars, anchors.get(plan.pid, []))
    stats = {
        "variant": plan.variant,
        "notes": len(notes),
        "refined_fraction": round(float(f2[~grace].mean()), 3),
        "contrast_ge3_dtw": round(float((contrast_dtw[~grace] >= 3).mean()), 3),
        "contrast_ge3_final": round(float((contrast[~grace] >= 3).mean()), 3),
        "median_shift_ms": round(float(np.median((t_on - t_dtw)[f2 & ~grace]) * 1000), 1) if f2.any() else None,
        "p95_abs_shift_ms": round(float(np.percentile(np.abs(t_on - t_dtw)[f2 & ~grace], 95) * 1000), 1) if f2.any() else None,
        "hit30_dtw": round(bb.hit_rate(t_dtw[~grace]), 3),
        "hit30_final": round(bb.hit_rate(t_on[~grace]), 3),
        "hit30_chance": round(bb.hit_rate(t_on[~grace] + 0.31), 3),
        "median_conf": round(float(np.median(conf)), 3),
        "low_conf_fraction": round(float((conf < 0.4).mean()), 3),
    }
    return {"notes": notes, "bars": bars, "stats": stats, "conf": conf, "t_on": t_on, "t_off": t_off,
            "plan": plan}


def piece_audio_span(res: SegmentResult, tp: dict, next_start: float | None) -> tuple[float, float]:
    t_on, t_off = tp["t_on"], tp["t_off"]
    a = max(res.start, float(t_on.min()) - 0.5)
    b = float(t_off.max()) + 1.5
    b = min(b, res.end, next_start - 0.2 if next_start else res.end)
    return round(a, 2), round(b, 2)


def main(only: set[str] | None = None) -> None:
    results = run_segments(only)
    ons = Onsets()
    bb = BroadbandPeaks()
    anchors = load_anchors()
    piece_info = {p["id"]: p for p in load_pieces()}
    OUT.mkdir(parents=True, exist_ok=True)
    pieces_meta = {}
    level_cache: list = []
    timed = {}
    for res in results:
        starts = []
        tps = []
        for plan in res.pieces:
            tp = time_piece(res, plan, ons, bb, level_cache, anchors)
            tps.append(tp)
            starts.append(float(tp["t_on"].min()))
        for k, tp in enumerate(tps):
            plan = tp["plan"]
            nxt = starts[k + 1] if k + 1 < len(starts) else None
            a, b = piece_audio_span(res, tp, nxt)
            has_rep = bool(piece_info[plan.pid].get("unfolded_notes"))
            pieces_meta[plan.pid] = {"audio_start": a, "audio_end": b,
                                     "repeats_taken": (plan.variant == "unfolded") if has_rep else None,
                                     "segment": res.seg_id, "dtw_cost": round(res.cost, 4),
                                     "bars": tp["bars"], "stats": tp["stats"]}
            timed[plan.pid] = tp
    # velocity: rank of the peak level over all notes of the recording, mapped to 0.2..1
    all_lv = np.concatenate([lv for _p, lv in level_cache])
    order = np.argsort(np.argsort(all_lv)) / max(len(all_lv) - 1, 1)
    pos = 0
    for pid, lv in level_cache:
        r = order[pos : pos + len(lv)]
        pos += len(lv)
        for n, v in zip(timed[pid]["notes"], r):
            n["vel"] = round(float(0.2 + 0.8 * v), 3)
    for pid, tp in timed.items():
        doc = {"version": 1, "piece": pid, "ppq": 24, "variant": tp["plan"].variant, "notes": tp["notes"]}
        validate("notes", doc)
        (OUT / f"{pid}.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + chr(10),
                                         encoding="utf-8")
    prev_file = AUDIO_WORK / "timing.json"
    if prev_file.exists() and not only:
        diff = diff_against_previous(json.loads(prev_file.read_text(encoding="utf-8")), pieces_meta)
        (AUDIO_WORK / "timing_diff.json").write_text(json.dumps(diff, indent=1) + chr(10), encoding="utf-8")
        print("changes against the previous run:", diff or "none")
    if only:  # a partial run keeps the other pieces' entries
        old = json.loads(prev_file.read_text(encoding="utf-8")) if prev_file.exists() else {}
        pieces_meta = {**old, **pieces_meta}
    prev_file.write_text(json.dumps(pieces_meta, indent=1) + chr(10), encoding="utf-8")
    for pid, m in pieces_meta.items():
        s = m["stats"]
        print(f"{pid:5s} {m['audio_start']:7.1f}-{m['audio_end']:7.1f} {s['variant']:8s} refined {s['refined_fraction']:.2f} "
              f"contrast>=3dB {s['contrast_ge3_dtw']:.2f}->{s['contrast_ge3_final']:.2f} "
              f"hit30 {s['hit30_dtw']:.2f}->{s['hit30_final']:.2f} (chance {s['hit30_chance']:.2f}) conf {s['median_conf']:.2f}")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
