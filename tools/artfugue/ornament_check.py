"""Let the recording decide the ornaments and staccato marks on which the MXL and the PDF disagree.

``pdf_rhythm.py`` lists the bars where one source has a trill, mordent or staccato mark and the other does not. For each
such mark the note it belongs to is found (the MXL's flag on a note, or the PDF's glyph and the notehead nearest to it) and
two things are measured in the recording's semitone spectrogram (``cqt.py``):

* **staccato**: how fast the note dies away, the level of its pitch in the first 40-120 ms after the attack minus the level
  200-320 ms after it (dB). A detached note falls away fast, a legato or pedalled one rings on;
* **mordent, trill, turn**: how much energy a neighbouring semitone or tone (one or two steps up or down) gains in the
  first 250 ms of the note, against the 300 ms before it (dB). An ornament puts a burst on the neighbour.

Each is compared with the same measure for ordinary notes of the same piece (no mark, at least 0.35 s long) and reported as
the percentile it reaches among them. A mark supported by the recording sits high among its controls; one that is not
looks like any other note.

Run:  python -m artfugue.ornament_check      (writes data/work/ornament_check.json)
"""

from __future__ import annotations

import json
import random
import statistics

import numpy as np

from . import pdfnotes
from .audio_check import cqt
from .audit_pdf import layout_of
from .cqt import FPS, LOWEST_MIDI
from .export import DATA, shipped_order
from .paths import WORK
from .pdf_rhythm import SCRIPT_NAME, PageData
from .pdfscore import _staff_barlines

TIMED = WORK / "timed"
SCORE = WORK / "score"
ORNAMENTS = {"trill", "mordent", "inverted-mordent", "turn", "inverted-turn"}


def row(db: np.ndarray, p: int) -> np.ndarray | None:
    r = p - LOWEST_MIDI
    return db[r] if 0 <= r < db.shape[0] else None


def decay_drop(db: np.ndarray, t: float, p: int) -> float | None:
    x = row(db, p)
    if x is None:
        return None
    return float(x[int((t + 0.04) * FPS) : int((t + 0.12) * FPS)].mean() - x[int((t + 0.20) * FPS) : int((t + 0.32) * FPS)].mean())


def neighbour_burst(db: np.ndarray, t: float, p: int) -> float | None:
    best = None
    for d in (-2, -1, 1, 2):
        x = row(db, p + d)
        if x is None:
            continue
        gain = float(x[int(t * FPS) : int((t + 0.25) * FPS)].max() - x[int((t - 0.30) * FPS) : int((t - 0.05) * FPS)].mean())
        best = gain if best is None else max(best, gain)
    return best


def percentile(value: float, controls: list[float]) -> float:
    return 100.0 * sum(c <= value for c in controls) / len(controls)


def glyph_notes(pid: str, piece: dict, shipped: list[dict], doc, cache: dict) -> list[dict]:
    """Every ornament or staccato glyph of the PDF with the notes of the notehead nearest to it."""
    notation = json.loads((DATA / "notation" / f"{pid}.json").read_text(encoding="utf-8"))
    out = []
    for si, (pg, sidx, first) in enumerate(layout_of(piece)):
        if pg not in cache:
            cache[pg] = (PageData(doc, pg), pdfnotes.read_page(pg))
        data, systems = cache[pg]
        sn = systems[sidx]
        page = doc[pg - 1]
        staves = pdfnotes._staves(page)
        top = _staff_barlines(page)[sidx][0]
        k = next(i for i, s in enumerate(staves) if abs(s[0] - top) < 3)
        lo, hi = staves[k][0] - 30, staves[k + 1][1] + 30
        edges = [0, *sn.barlines]
        heads = notation["systems"][si]["heads"]
        for name, x, y in data.glyphs:
            if name not in SCRIPT_NAME or not lo <= y <= hi:
                continue
            bar_i = next((i for i in range(len(edges) - 1) if edges[i] - 2 <= x < edges[i + 1]), None)
            if bar_i is None:
                continue
            near = sorted((h for h in heads if abs(h[0] - x) <= 7), key=lambda h: (abs(h[0] - x), abs(h[1] - y)))
            if not near:
                continue
            idx = [i for i in near[0][3:] if i < len(shipped)]
            out.append({"piece": pid, "bar": first + bar_i, "kind": SCRIPT_NAME[name], "notes": idx})
    return out


def main() -> None:
    db = cqt()
    doc = pdfnotes._doc()
    rd = json.loads((WORK / "pdf_rhythm.json").read_text(encoding="utf-8"))
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    rng = random.Random(3)
    cases, cache = [], {}
    for pid, x in rd.items():
        diffs = [e for e in x["script"]]
        if not diffs:
            continue
        timed = json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))
        shipped = shipped_order(timed["notes"])
        plain = [n for n in shipped if not n.get("flags") and n.get("pass", 1) == 1]
        controls = rng.sample([n for n in plain if n["t_off"] - n["t_on"] >= 0.35], min(400, sum(1 for n in plain if n["t_off"] - n["t_on"] >= 0.35)))
        c_decay = [v for n in controls if (v := decay_drop(db, n["t_on"], n["pitch"])) is not None]
        c_burst = [v for n in controls if (v := neighbour_burst(db, n["t_on"], n["pitch"])) is not None]
        glyphs = None
        for e in diffs:
            for kind in set(e["pdf"]) | set(e["mxl"]):
                delta = e["pdf"].get(kind, 0) - e["mxl"].get(kind, 0)
                if delta == 0:
                    continue
                if delta < 0:  # the MXL has the mark: the notes carrying the flag in this bar
                    flag = {"mordent": ("mordent", "inverted-mordent"), "turn": ("turn", "inverted-turn")}.get(kind, (kind,))
                    notes = [n for n in shipped if n["bar"] == e["bar"] and n.get("pass", 1) == 1
                             and any(f in n.get("flags", []) for f in flag)]
                    who = "MXL"
                else:  # the PDF has the mark: the notes of the notehead next to its glyph
                    if glyphs is None:
                        glyphs = glyph_notes(pid, pieces[pid], shipped, doc, cache)
                    idx = [i for g in glyphs if g["bar"] == e["bar"] and g["kind"] == kind for i in g["notes"]]
                    notes = [shipped[i] for i in idx]
                    who = "PDF"
                for n in notes[: abs(delta)] if who == "PDF" else notes:
                    if kind == "staccato":
                        v = decay_drop(db, n["t_on"], n["pitch"])
                        # a short note dies away quickly whatever its articulation: compare it with notes of its own length
                        dur = n["t_off"] - n["t_on"]
                        same = [m for m in plain if abs((m["t_off"] - m["t_on"]) - dur) <= 0.07]
                        same = rng.sample(same, min(300, len(same)))
                        ctrl = [d for m in same if (d := decay_drop(db, m["t_on"], m["pitch"])) is not None] or c_decay
                    elif kind in ("trill", "mordent", "turn"):
                        v = neighbour_burst(db, n["t_on"], n["pitch"])
                        ctrl = c_burst
                    else:
                        continue
                    if v is None:
                        continue
                    cases.append({"piece": pid, "bar": e["bar"], "mark": kind, "in": who, "id": n["id"], "dur": round(n["t_off"] - n["t_on"], 2),
                                  "value_db": round(v, 1), "percentile": round(percentile(v, ctrl), 0),
                                  "control_median_db": round(statistics.median(ctrl), 1)})
    (WORK / "ornament_check.json").write_text(json.dumps(cases, indent=1), encoding="utf-8")
    groups: dict[tuple, list] = {}
    for c in cases:
        groups.setdefault((c["piece"] if c["mark"] != "staccato" else "all canons" if c["piece"].startswith("k") else c["piece"],
                           c["mark"], c["in"]), []).append(c)
    for (pid, mark, who), cs in sorted(groups.items()):
        p = [c["percentile"] for c in cs]
        print(f"{pid:11s} {mark:9s} mark only in {who}: {len(cs):3d} notes, median percentile among ordinary notes {statistics.median(p):.0f}, "
              f"{sum(v >= 75 for v in p)} of {len(p)} at or above the 75th")


if __name__ == "__main__":
    main()
