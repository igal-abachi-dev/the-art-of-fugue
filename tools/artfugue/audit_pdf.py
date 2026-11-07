"""Audit the MXL-derived notes against the noteheads engraved in the PDF (pitch level, per bar).

For every bar the check asks two questions:
  * does every note that starts in the bar appear as a notehead of the same pitch in the PDF?
  * is every PDF notehead explained by a note that sounds in the bar?
Noteheads at the start of a bar that continue a tie from the previous bar are matched to the
sounding note within a semitone (the engraving omits the accidental of a tied continuation).
"""

from __future__ import annotations

import json

from .paths import OVERRIDES, WORK
from .pdfnotes import piece_heads

SCORE = WORK / "score"


def layout_of(piece: dict) -> list[tuple[int, int, int]]:
    seen: dict[tuple[int, int], int] = {}
    for b in piece["bars"]:
        seen.setdefault((b["pdf_page"], b["pdf_system"]), b["n"])
    return [(pg, s, n) for (pg, s), n in seen.items()]


def _bar_heads(heads: dict, bar: dict, notes: list[dict]):
    """Noteheads of a bar without tied continuations (their accidental is not repeated)."""
    s, e = bar["on"], bar["on"] + bar["len"]
    sound = {n["pitch"] for n in notes if n["on"] < e and n["on"] + n["dur"] > s}
    tied = [n["pitch"] for n in notes if n["on"] < s < n["on"] + n["dur"]]
    hs = []
    all_h = [h for h in heads.get(bar["n"], []) if h.size > 16]
    x0 = min((h.x for h in all_h), default=0.0)
    for h in all_h:
        # a tied continuation sits in the first column of the bar
        # (an accidental printed for another note can push it into the second column: use the position in the bar)
        if (h.x - x0 < 3 or h.rel < 0.25) and h.midi not in sound and any(abs(h.midi - p) == 1 for p in tied):
            continue  # tied continuation printed without its accidental
        hs.append(h)
    return hs, sound


def _assign(ns: list[dict], hs, s: int, ln: int):
    """Optimal pairing of the notes starting in a bar with its noteheads (pitch first, then position)."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    cost = np.array([[abs(n["pitch"] - h.midi) + 0.5 * abs((n["on"] - s) / ln - h.rel) for h in hs]
                     for n in ns])
    rows, cols = linear_sum_assignment(cost)
    return list(zip(rows, cols))


def _bar_problem(heads: dict, bar: dict, notes: list[dict]) -> dict | None:
    """Per-note comparison: every note must pair with a notehead of the same pitch.

    Surplus noteheads must be explained by a sounding note (a tie inside the bar), surplus notes by
    a notehead of the same pitch (unison shared by two voices)."""
    s, e = bar["on"], bar["on"] + bar["len"]
    ns = [n for n in notes if s <= n["on"] < e and "grace" not in n.get("flags", [])]
    hs, sound = _bar_heads(heads, bar, notes)
    pairs = _assign(ns, hs, s, max(bar["len"], 1)) if ns and hs else []
    ni = {i for i, _ in pairs}
    hj = {j for _, j in pairs}
    missing = [ns[i]["pitch"] for i, j in pairs if ns[i]["pitch"] != hs[j].midi]
    extra = [hs[j].midi for i, j in pairs if ns[i]["pitch"] != hs[j].midi]
    pdf_set = {h.midi for h in hs}
    missing += [n["pitch"] for i, n in enumerate(ns) if i not in ni and n["pitch"] not in pdf_set]
    extra += [h.midi for j, h in enumerate(hs) if j not in hj and h.midi not in sound]
    if missing or extra:
        return {"bar": bar["n"], "mxl_not_in_pdf": sorted(missing), "pdf_not_in_mxl": sorted(extra)}
    return None


def audit_piece(piece: dict, notes: list[dict], heads: dict | None = None) -> dict:
    heads = heads if heads is not None else piece_heads(layout_of(piece))
    problems = [p for b in piece["bars"] if (p := _bar_problem(heads, b, notes))]
    return {"id": piece["id"], "bars": len(piece["bars"]), "bars_differing": len(problems),
            "problems": problems}


MAX_CORRECTION = 3  # semitones; larger disagreements are reported but not changed


def correct_piece(piece: dict, notes: list[dict]) -> tuple[list[dict], list[dict]]:
    """Change pitches of ``notes`` (in place) where the engraving disagrees, bar by bar.

    A bar is only changed when the changed bar then agrees completely with the engraving.
    Returns (corrections, bars that still disagree).
    """
    heads = piece_heads(layout_of(piece))
    corrections, unresolved = [], []
    for b in piece["bars"]:
        if _bar_problem(heads, b, notes) is None:
            continue
        s, e = b["on"], b["on"] + b["len"]
        ns = [n for n in notes if s <= n["on"] < e and "grace" not in n.get("flags", [])]
        hs, _ = _bar_heads(heads, b, notes)
        if not ns or not hs:
            unresolved.append(_bar_problem(heads, b, notes))
            continue
        trial = {}
        for i, j in _assign(ns, hs, s, max(b["len"], 1)):
            d = hs[j].midi - ns[i]["pitch"]
            if d and abs(d) <= MAX_CORRECTION:
                trial[ns[i]["id"]] = hs[j].midi
        if not trial:
            unresolved.append(_bar_problem(heads, b, notes))
            continue
        old = {n["id"]: n["pitch"] for n in ns if n["id"] in trial}
        for n in ns:
            if n["id"] in trial:
                n["pitch"] = trial[n["id"]]
        if _bar_problem(heads, b, notes) is None:
            for n in ns:
                if n["id"] in trial:
                    corrections.append({"piece": piece["id"], "bar": b["n"], "id": n["id"],
                                        "voice": n["voice"], "beat": n["on"] - s,
                                        "from": old[n["id"]], "to": n["pitch"]})
        else:  # revert: the engraving reading does not explain the bar
            for n in ns:
                if n["id"] in old:
                    n["pitch"] = old[n["id"]]
            unresolved.append(_bar_problem(heads, b, notes))
    return corrections, unresolved


def apply_overrides(piece: dict, notes: list[dict], unresolved: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Apply the hand-confirmed changes of ``data/pdf_overrides.json`` that belong to this piece.

    The automatic audit changes a pitch only up to ``MAX_CORRECTION`` semitones and never adds, removes or joins
    notes. A larger difference, or one in a bar the audit cannot pair up, is a decision, so it is listed in a file
    with its evidence (what the recording has at that note, ``python -m artfugue.audio_check``, and what the PDF shows)
    and applied from there. Two kinds of entry:

    * ``{"piece", "bar", "from", "to", ["voice", "beat"]}``: change one note's pitch. ``voice`` and ``beat`` (ticks
      from the start of the bar) say which one when the pitch occurs more than once in the bar.
    * ``{"piece", "bar", "op": "merge", "voice", "beats": [...], "to"}``: the PDF has one note where the MXL has
      several in a row (the first takes the pitch ``to`` and the length of all of them, the others go).
    * ``{"piece", "op": "clear_flags", "flags", ["bars"]}`` and ``{"piece", "bar", "op": "add_flag", "voice", "beat",
      "pitch", "flag"}``: an ornament or articulation mark the other source does not have (the recording decides).
    * ``{"piece", "bar", "op": "split", "voice", "beat", "dur", "add": [{"beat", "pitch", "dur"}]}``: the PDF has two
      notes where the MXL has one (the note at ``beat`` is shortened to ``dur`` and the new notes are added).

    Returns (the pitch changes made, the merges and splits made, the bars that still differ)."""
    if not OVERRIDES.exists():
        return [], [], unresolved
    todo = [o for o in json.loads(OVERRIDES.read_text(encoding="utf-8")) if o["piece"] == piece["id"]]
    pitch_changes, merges = [], []
    for o in todo:
        where = f"override {o['piece']} bar {o.get('bar', '(piece)')}"
        if o.get("op") != "clear_flags":
            bar = next(b for b in piece["bars"] if b["n"] == o["bar"])
            in_bar = [n for n in notes
                      if bar["on"] <= n["on"] < bar["on"] + bar["len"] and "grace" not in n.get("flags", [])]
        if o.get("op") == "merge":
            group = sorted((n for n in in_bar if n["voice"] == o["voice"] and n["on"] - bar["on"] in o["beats"]),
                           key=lambda n: n["on"])
            if len(group) != len(o["beats"]):
                raise RuntimeError(f"{where}: merge found {len(group)} notes, expected {len(o['beats'])}")
            first = group[0]
            merges.append({"op": "merge", "piece": piece["id"], "bar": o["bar"], "voice": o["voice"], "part": first["part"],
                           "beats": o["beats"], "pitches": [n["pitch"] for n in group], "dur": sum(n["dur"] for n in group),
                           "to": o["to"], "id": first["id"]})
            first["pitch"] = o["to"]
            first["dur"] = sum(n["dur"] for n in group)
            for n in group[1:]:
                notes.remove(n)
            continue
        if o.get("op") == "clear_flags":
            flags, only = set(o["flags"]), (set(o["bars"]) if o.get("bars") else None)
            changed = 0
            for n in notes:
                if (only is None or n["bar"] in only) and flags & set(n.get("flags", [])):
                    keep = [f for f in n["flags"] if f not in flags]
                    n["flags"] = keep
                    if not keep:
                        n.pop("flags")
                    changed += 1
            merges.append({"op": "clear_flags", "piece": piece["id"], "flags": sorted(flags),
                           "bars": sorted(only) if only else None, "changed": changed})
            continue
        if o.get("op") == "add_flag":
            hits = [n for n in in_bar if n["voice"] == o["voice"] and n["pitch"] == o["pitch"]
                    and n["on"] - bar["on"] == o["beat"]]
            if len(hits) != 1:
                raise RuntimeError(f"{where}: add_flag found {len(hits)} notes, expected 1")
            n = hits[0]
            n["flags"] = sorted({*n.get("flags", []), o["flag"]})
            merges.append({"op": "add_flag", "piece": piece["id"], "bar": o["bar"], "part": n["part"], "pitch": n["pitch"],
                           "beat": o["beat"], "flag": o["flag"]})
            continue
        if o.get("op") == "split":
            hits = [n for n in in_bar if n["voice"] == o["voice"] and n["on"] - bar["on"] == o["beat"]]
            if len(hits) != 1:
                raise RuntimeError(f"{where}: split found {len(hits)} notes at beat {o['beat']}, expected 1")
            base = hits[0]
            ids = [int(n["id"].rsplit("-", 1)[1]) for n in notes if n["id"].rsplit("-", 1)[1].isdigit()]
            added = []
            for a in o["add"]:
                ids.append(max(ids) + 1)
                new = {**base, "pitch": a["pitch"], "dur": a["dur"], "on": bar["on"] + a["beat"], "beat": a["beat"],
                       "id": f"{piece['id']}-{ids[-1]:04d}"}
                new.pop("flags", None)
                notes.append(new)
                added.append(new["id"])
            merges.append({"op": "split", "piece": piece["id"], "bar": o["bar"], "voice": o["voice"], "part": base["part"],
                           "beat": o["beat"], "pitch": base["pitch"], "dur": o["dur"], "add": o["add"], "id": base["id"],
                           "added_ids": added})
            base["dur"] = o["dur"]
            continue
        hits = [n for n in in_bar if n["pitch"] == o["from"] and o.get("voice", n["voice"]) == n["voice"]
                and o.get("beat", n["on"] - bar["on"]) == n["on"] - bar["on"]]
        if len(hits) != 1:
            raise RuntimeError(f"{where} {o['from']}->{o['to']}: {len(hits)} notes match, expected 1")
        n = hits[0]
        n["pitch"] = o["to"]
        pitch_changes.append({"piece": piece["id"], "bar": o["bar"], "id": n["id"], "voice": n["voice"],
                              "beat": n["on"] - bar["on"], "from": o["from"], "to": o["to"], "source": "override"})
    if pitch_changes or merges:
        heads = piece_heads(layout_of(piece))
        by_bar = {b["n"]: b for b in piece["bars"]}
        touched = {c["bar"] for c in pitch_changes} | {m["bar"] for m in merges if "bar" in m and m["op"] != "add_flag"}
        unresolved = [u for u in unresolved if u["bar"] not in touched or _bar_problem(heads, by_bar[u["bar"]], notes)]
    return pitch_changes, merges, unresolved


def main() -> None:
    pieces = json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]
    out = []
    for p in pieces:
        if p["status"] != "ok" or not p.get("in_pdf"):
            continue
        notes = json.loads((SCORE / "notes" / f"{p['id']}.json").read_text(encoding="utf-8"))["notes"]
        try:
            r = audit_piece(p, notes)
        except (StopIteration, RuntimeError, KeyError) as ex:  # reader limits (e.g. unusual staff layouts) are reported, not hidden
            r = {"id": p["id"], "bars": len(p["bars"]), "error": f"{type(ex).__name__}: {ex}"}
        out.append(r)
        print(p["id"], r.get("bars_differing", r.get("error")), "/", r["bars"])
    (SCORE / "pdf_audit.json").write_text(json.dumps(out, indent=1) + chr(10), encoding="utf-8")


if __name__ == "__main__":
    main()
