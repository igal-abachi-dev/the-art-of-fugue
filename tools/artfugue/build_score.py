"""Build per-piece note files and ``pieces.json`` from the MXL (tasks T1.1.3, T1.2.1-T1.2.4).

Run:  python -m artfugue.build_score        (from ``tools/``, writes ``data/work/score``)
"""

from __future__ import annotations

import bisect
import collections
import json
import statistics
from dataclasses import asdict

from . import pieces as P
from .audit_pdf import apply_overrides, correct_piece
from .paths import WORK
from .pdfnotes import patch_pitches
from .pdfscore import read_pieces
from .score import DIV, RawNote, Score, parse_score
from .unfold import unfold
from .validate import validate

OUT = WORK / "score"
SCHEMA_VERSION = 1

VOICE_LABELS = {
    4: ["S", "A", "T", "B"],
    3: ["upper", "middle", "lower"],
    2: ["upper", "lower"],
    1: ["only"],
}


def _merge_ties(notes: list[RawNote]) -> list[RawNote]:
    """Merge tied notes (same part, voice, staff, pitch, end == start) into one longer note."""
    out: list[RawNote] = []
    open_by_key: dict[tuple, RawNote] = {}
    for n in sorted(notes, key=lambda n: (n.abs_start, n.part, n.voice, n.pitch)):
        key = (n.part, n.voice, n.pitch)
        prev = open_by_key.get(key)
        if n.tie_stop and prev is not None and prev.abs_start + prev.dur == n.abs_start:
            prev.dur += n.dur
            prev.fermata = prev.fermata or n.fermata
            if n.tie_start:
                open_by_key[key] = prev
            else:
                open_by_key.pop(key, None)
            continue
        out.append(n)
        if n.tie_start:
            open_by_key[key] = n
        else:
            open_by_key.pop(key, None)
    return out


def _bar_table(score: Score, a: int, b: int, layout, has_pickup: bool) -> list[dict]:
    """One record per measure: printed number, absolute start in ticks, length, PDF page/system."""
    base = score.measures[a].start
    first = 0 if has_pickup else 1
    bars = []
    for i in range(a, b + 1):
        m = score.measures[i]
        bars.append({"n": first + (i - a), "on": m.start - base, "len": m.length,
                     "mxl": m.number})
    if layout:
        # system k covers [first_bar_k, first_bar_{k+1}-1]
        starts = [first if k == 0 else fb for k, (_pg, _sy, fb) in enumerate(layout)]
        for bar in bars:
            k = bisect.bisect_right(starts, bar["n"]) - 1
            if k >= 0:
                bar["pdf_page"], bar["pdf_system"] = layout[k][0], layout[k][1]
    return bars


def _voices_for(raw: list[RawNote], mode: str) -> tuple[dict, list[dict]]:
    """Return (key -> voice rank, voice info list). Rank 1 = highest median pitch."""
    groups: dict[tuple, list[int]] = collections.defaultdict(list)
    for n in raw:
        key = (n.part,) if mode == "parts" else (n.staff, n.voice)
        groups[key].append(n.pitch)
    total = sum(len(v) for v in groups.values())
    keep = {k: v for k, v in groups.items() if len(v) >= max(3, 0.01 * total)}
    stray = [k for k in groups if k not in keep]
    ranked = sorted(keep, key=lambda k: -statistics.median(keep[k]))
    rank = {k: i + 1 for i, k in enumerate(ranked)}
    for k in stray:  # tiny voices join the voice with the nearest median pitch
        med = statistics.median(groups[k])
        near = min(ranked, key=lambda r: abs(statistics.median(keep[r]) - med))
        rank[k] = rank[near]
    labels = VOICE_LABELS.get(len(ranked), [f"v{i + 1}" for i in range(len(ranked))])
    info = [
        {"voice": rank[k], "label": labels[rank[k] - 1], "source": list(k),
         "median_pitch": int(statistics.median(keep[k])), "notes": len(keep[k])}
        for k in ranked
    ]
    return rank, info


def build_piece(score: Score, pd: P.PieceDef, layout) -> tuple[dict, list[dict], dict]:
    a, b = pd.mxl
    in_range = [n for n in score.notes if a <= n.measure <= b]
    parts_notes = [n for n in in_range if n.part < 5]
    combined = [n for n in in_range if n.part == 5]
    mode = "parts" if parts_notes else "combined"
    raw = parts_notes if mode == "parts" else combined

    # sanity: the 5th part ("Combined") should duplicate parts 1-4
    reduction = None
    if mode == "parts":
        sig = lambda ns: collections.Counter(
            (n.abs_start, n.pitch, n.dur) for n in ns if not n.grace)
        s1, s5 = sig(parts_notes), sig(combined)
        inter = sum((s1 & s5).values())
        union = sum((s1 | s5).values())
        reduction = {"parts_notes": sum(s1.values()), "combined_notes": sum(s5.values()),
                     "identical": inter, "jaccard": round(inter / union, 4) if union else 1.0}

    rank, voice_info = _voices_for(raw, mode)
    merged = _merge_ties(raw)
    base = score.measures[a].start
    has_pickup = score.measures[a].implicit
    first_bar = 0 if has_pickup else 1
    bars = _bar_table(score, a, b, layout, has_pickup)

    notes = []
    for n in sorted(merged, key=lambda n: (n.abs_start, rank[(n.part,) if mode == "parts" else (n.staff, n.voice)], n.pitch)):
        key = (n.part,) if mode == "parts" else (n.staff, n.voice)
        flags = []
        if n.grace:
            flags.append("grace")
        flags += sorted(set(n.ornaments))
        if n.fermata:
            flags.append("fermata")
        if n.staccato:
            flags.append("staccato")
        on = n.abs_start - base
        bar_start = score.measures[n.measure].start - base
        rec = {"pitch": n.pitch, "on": on, "dur": n.dur, "voice": rank[key], "part": n.part,
               "bar": first_bar + (n.measure - a), "beat": on - bar_start}
        if flags:
            rec["flags"] = flags
        notes.append(rec)
    for i, rec in enumerate(notes):
        rec["id"] = f"{pd.id}-{i:04d}"

    # checks
    problems = []
    last_end: dict[tuple, int] = {}
    overlaps = 0
    for rec in notes:
        k = (rec["voice"], rec["pitch"])
        if rec["on"] < last_end.get(k, -1) and "grace" not in rec.get("flags", []):
            overlaps += 1
        last_end[k] = max(last_end.get(k, -1), rec["on"] + rec["dur"])
    if overlaps:
        problems.append(f"{overlaps} overlapping same-pitch notes within a voice")
    max_poly = 0
    ev = sorted({r["on"] for r in notes})
    for t in ev[:: max(1, len(ev) // 400)]:
        max_poly = max(max_poly, len({r["voice"] for r in notes
                                      if r["on"] <= t < r["on"] + r["dur"] and "grace" not in r.get("flags", [])}))

    ms = score.measures[a:b + 1]
    times = [(m.index, m.time) for m in ms if m.time]
    tempos = [{"bar": first_bar + (m.index - a), "bpm": m.tempo} for m in ms if m.tempo]
    words = [{"bar": first_bar + (m.index - a), "text": w} for m in ms for w in m.words]
    repeats = [{"bar": first_bar + (m.index - a),
                "type": ("forward" if m.repeat_forward else "backward")}
               for m in ms if m.repeat_forward or m.repeat_backward]
    keys = sorted({m.key for m in ms if m.key is not None})
    rec_piece = {
        **{k: v for k, v in asdict(pd).items() if k not in ("mxl",)},
        "status": "ok" if pd.in_pdf else "excluded",
        "mxl": {"first": a, "last": b, "first_number": ms[0].number, "last_number": ms[-1].number},
        "ppq": DIV,
        "source_mode": mode,
        "pickup": has_pickup,
        "n_bars": len(ms) - (1 if has_pickup else 0),
        "length_ticks": ms[-1].start + ms[-1].length - base,
        "voices": voice_info,
        "time_signatures": [{"bar": first_bar + (i - a), "num": t[0], "den": t[1]} for i, t in times],
        "key_fifths": keys,
        "tempos": tempos,
        "words": words,
        "repeats": repeats,
        "bars": bars,
        "n_notes": len(notes),
    }
    val = {"id": pd.id, "n_notes": len(notes), "mode": mode, "reduction": reduction,
           "max_polyphony": max_poly, "problems": problems,
           "ornaments": dict(collections.Counter(f for r in notes for f in r.get("flags", []))),
           "pitch_range": [min(r["pitch"] for r in notes), max(r["pitch"] for r in notes)]}
    return rec_piece, notes, val


def derive_piece(pd: P.PieceDef, src_rec: dict, src_notes: list[dict], layout) -> tuple[dict, list[dict]]:
    """Draft piece made by mirroring another piece: pitch' = axis_sum - pitch, voices reversed."""
    _src_id, axis = pd.derive
    n_voices = len(src_rec["voices"])
    notes = []
    for n in src_notes:
        m = dict(n)
        m["pitch"] = axis - n["pitch"]
        m["voice"] = n_voices + 1 - n["voice"]
        notes.append(m)
    bars = [dict(b) for b in src_rec["bars"]]
    pdf_check = None
    if layout:  # correct the chromatic mirror against the noteheads engraved in the PDF
        # a pickup bar is printed without a number at the start of the first system
        adj = [(pg, sy, 0 if k == 0 and src_rec["pickup"] else fb) for k, (pg, sy, fb) in enumerate(layout)]
        pdf_check = patch_pitches(notes, bars, adj)
    # the mirror reverses the register order only roughly (the PDF's octaves decide), so number the voices as every
    # other piece is numbered: by median pitch, 1 = highest (docs/voices.md)
    median: dict[int, float] = {}
    for v in sorted({m["voice"] for m in notes}):
        median[v] = float(statistics.median(m["pitch"] for m in notes if m["voice"] == v))
    rank = {v: i + 1 for i, v in enumerate(sorted(median, key=lambda v: -median[v]))}
    for m in notes:
        m["voice"] = rank[m["voice"]]
    notes.sort(key=lambda r: (r["on"], r["voice"], r["pitch"]))
    for k, m in enumerate(notes):
        m["id"] = f"{pd.id}-{k:04d}"
    if layout:
        first = 0 if src_rec["pickup"] else 1
        starts = [first if k == 0 else fb for k, (_pg, _sy, fb) in enumerate(layout)]
        for bar in bars:
            bar.pop("pdf_page", None)
            bar.pop("pdf_system", None)
            k = bisect.bisect_right(starts, bar["n"]) - 1
            if k >= 0:
                bar["pdf_page"], bar["pdf_system"] = layout[k][0], layout[k][1]
    voices = []
    for v in src_rec["voices"]:
        mirrored = n_voices + 1 - v["voice"]
        nv = rank[mirrored]
        voices.append({**v, "voice": nv, "label": VOICE_LABELS.get(n_voices, [])[nv - 1]
                       if n_voices in VOICE_LABELS else f"v{nv}",
                       "median_pitch": median[mirrored]})
    voices.sort(key=lambda v: v["voice"])
    rec = {
        **{k: v for k, v in asdict(pd).items() if k not in ("mxl", "derive")},
        "status": "derived", "mxl": None, "ppq": DIV, "source_mode": "derived",
        "derived_from": pd.derive[0], "axis_sum": axis,
        "verified": bool(pdf_check) and not pdf_check["bars_failed"] and not pdf_check["unresolved"],
        "pdf_check": pdf_check,
        "pickup": src_rec["pickup"], "n_bars": src_rec["n_bars"],
        "length_ticks": src_rec["length_ticks"], "voices": voices, "bars": bars,
        "time_signatures": src_rec["time_signatures"], "key_fifths": [], "tempos": [],
        "words": [], "repeats": [], "n_notes": len(notes),
    }
    return rec, notes


def _read_timing() -> dict:
    """Audio placement from the alignment stage (data/work/audio/timing.json), if it has been run."""
    f = WORK / "audio" / "timing.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def _merge_timing(rec: dict, t: dict | None) -> None:
    if not t:
        return
    rec["audio_start"], rec["audio_end"] = t["audio_start"], t["audio_end"]
    rec["repeats_taken"] = t["repeats_taken"]
    first: dict[int, float] = {}
    for b in t["bars"]:
        first.setdefault(b["n"], b["t"])
    for bar in rec["bars"]:
        if bar["n"] in first:
            bar["t"] = first[bar["n"]]
    if t["repeats_taken"]:
        rec["played_bars"] = t["bars"]  # every bar as played, with its pass number


def _write(path, doc) -> None:
    path.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + chr(10),
                    encoding="utf-8")


def main() -> None:
    score = parse_score()
    probs = P.check_table(score)
    assert not probs, probs
    pdf = read_pieces()
    pdf_defs = sorted((p for p in P.PIECES if p.in_pdf), key=lambda p: p.order)
    assert len(pdf) == len(pdf_defs), (len(pdf), len(pdf_defs))
    layouts = {d.id: pp.layout for d, pp in zip(pdf_defs, pdf)}
    pdf_bars = {d.id: pp.bars for d, pp in zip(pdf_defs, pdf)}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "notes").mkdir(exist_ok=True)
    built: dict[str, tuple[dict, list[dict]]] = {}
    validation = []
    all_fixes, all_open, all_merges = [], [], []
    for pd in P.PIECES:
        if pd.mxl is None:
            continue
        rec, notes, val = build_piece(score, pd, layouts.get(pd.id))
        if rec["in_pdf"] and rec["status"] == "ok":
            fixes, left = correct_piece(rec, notes)
            more, merged, left = apply_overrides(rec, notes, left)
            fixes = fixes + more
            all_merges.extend(merged)
            if merged:
                notes.sort(key=lambda r: (r["on"], r["voice"], r["pitch"]))  # a split appends notes
            rec["n_notes"] = len(notes)  # a merge removes notes, a split adds them
            val["n_notes"] = len(notes)
            all_fixes.extend(fixes)
            rec["pdf_audit"] = {"corrected_notes": len(fixes),
                                "corrected_bars": len({f["bar"] for f in fixes}),
                                "bars_still_differing": [p["bar"] for p in left]}
            all_open.extend({"piece": pd.id, **p} for p in left)
        if pd.id in pdf_bars:
            val["pdf_bars_counted"] = pdf_bars[pd.id]
            val["mxl_bars"] = rec["n_bars"]
        unfolded = unfold(rec, notes)
        if unfolded is not None:
            rec["repeats_taken"] = None  # decided after alignment (T2.3.3)
            rec["unfolded_notes"] = len(unfolded)
            udoc = {"version": SCHEMA_VERSION, "piece": pd.id, "ppq": DIV, "notes": unfolded}
            validate("notes", udoc)
            _write(OUT / "notes" / f"{pd.id}.unfolded.json", udoc)
        built[pd.id] = (rec, notes)
        validation.append(val)
    for pd in P.PIECES:
        if pd.derive:
            src_rec, src_notes = built[pd.derive[0]]
            built[pd.id] = derive_piece(pd, src_rec, src_notes, layouts.get(pd.id))
            _more, merged, _left = apply_overrides(built[pd.id][0], built[pd.id][1], [])  # ornament and flag overrides
            all_merges.extend(merged)
    timing = _read_timing()
    pieces_out = []
    for pd in sorted(P.PIECES, key=lambda p: p.order):
        rec, notes = built[pd.id]
        _merge_timing(rec, timing.get(pd.id))
        doc = {"version": SCHEMA_VERSION, "piece": pd.id, "ppq": DIV, "notes": notes}
        validate("notes", doc)
        _write(OUT / "notes" / f"{pd.id}.json", doc)
        pieces_out.append(rec)
    pieces_doc = {"version": SCHEMA_VERSION, "ppq": DIV, "pieces": pieces_out}
    validate("pieces", pieces_doc)
    _write(OUT / "pieces.json", pieces_doc)
    _write(OUT / "pdf_corrections.json", {"corrections": all_fixes, "edits": all_merges, "still_differing": all_open})
    (OUT / "validation.json").write_text(json.dumps(validation, indent=1) + chr(10), encoding="utf-8")
    print(f"wrote {len(pieces_out)} pieces, {sum(len(n) for _r, n in built.values())} notes -> {OUT}")


if __name__ == "__main__":
    main()
