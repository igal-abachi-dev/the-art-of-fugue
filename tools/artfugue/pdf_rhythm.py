"""Does the MXL have the same note values, ties, rests and ornaments as the PDF? (``audit_pdf.py`` compares pitches.)

Read from the PDF's vector drawing, per engraved system:

* **note values**: the notehead glyph (whole, half, filled), its stem (a thin filled rectangle beside the head), the
  flags at the stem's end and the beams that cross it, and the augmentation dots to its right. A filled head with no
  flag and no beam is a quarter, one flag or beam an eighth, two a sixteenth;
* **ties**: a filled curve that starts at one notehead and ends at another of the same pitch (a slur joins two
  different pitches);
* **rests**: the rest glyphs, by kind;
* **ornaments and articulation**: the ``scripts.*`` glyphs (trill, mordents, turn, fermata, staccato).

Each is compared bar by bar with the PDF-checked MXL (``mxl_checked.py``): the combined part's notes with their written
``<type>`` and ``<dot/>``, the tie starts, the rests and the ``<notations>``/``<articulations>``. Notes that are not
printed (``print-object="no"``), grace notes and cue notes are left out on the MXL side, small noteheads on the PDF
side.

Run:  python -m artfugue.pdf_rhythm      (writes data/work/pdf_rhythm.json)
"""

from __future__ import annotations

import collections
import json

from lxml import etree

from . import pdfnotes
from . import pieces as P
from .audit_pdf import layout_of
from .mxl import load_root
from .notation_mxl import midi_of, note_starts
from .paths import WORK
from .pdfscore import _staff_barlines

SCORE = WORK / "score"
HEAD_W = 5.9  # width of a notehead, points
VALUE = {"whole": "whole", "half": "half", "quarter": "quarter", "eighth": "eighth", "16th": "16th", "32nd": "32nd"}
REST_NAME = {"rests.0": "whole", "rests.0o": "whole", "rests.1": "half", "rests.1o": "half", "rests.2": "quarter",
             "rests.3": "eighth", "rests.4": "16th", "rests.5": "32nd"}
SCRIPT_NAME = {"scripts.trill": "trill", "scripts.prall": "mordent", "scripts.prallmordent": "mordent",
               "scripts.prallprall": "mordent", "scripts.lineprall": "mordent", "scripts.upprall": "mordent",
               "scripts.turn": "turn", "scripts.ufermata": "fermata", "scripts.dfermata": "fermata",
               "scripts.staccato": "staccato"}


class PageData:
    """Everything the checks need from one PDF page, read once."""

    def __init__(self, doc, pg: int):
        page = doc[pg - 1]
        names = pdfnotes._glyph_names(doc, page)["Emmentaler-20"]
        self.glyphs: list[tuple[str, float, float]] = []
        for sp in page.get_texttrace():
            if "Emmentaler-20" in sp["font"]:
                for _u, gid, origin, _bb in sp["chars"]:
                    self.glyphs.append((names[gid], origin[0], origin[1]))
        self.stems, self.beams, self.curves = [], [], []
        for dr in page.get_drawings():
            if dr["type"] not in ("f", "fs"):
                continue
            r = dr["rect"]
            kinds = {it[0] for it in dr["items"]}
            if kinds == {"re"} and r.width <= 0.6 and r.height >= 7:
                self.stems.append((r.x0 + r.width / 2, r.y0, r.y1))
            elif kinds <= {"l", "re"} and r.width >= 3 and 1.2 <= r.height <= 6.5:
                pts = []
                for it in dr["items"]:
                    if it[0] == "l":
                        pts += [(it[1].x, it[1].y), (it[2].x, it[2].y)]
                    else:
                        pts += [(it[1].x0, it[1].y0), (it[1].x1, it[1].y0), (it[1].x1, it[1].y1), (it[1].x0, it[1].y1)]
                pts.sort()
                left = pts[:2] if len(pts) >= 4 else pts
                right = pts[-2:] if len(pts) >= 4 else pts
                self.beams.append((r.x0, r.x1, sum(y for _, y in left) / len(left), sum(y for _, y in right) / len(right)))
            elif kinds == {"c"} and r.width >= 4:
                self.curves.append((r.x0, r.x1, r.y0, r.y1))


def dots_of(h, heads: list, pd: PageData) -> int:
    """Augmentation dots of a head: a dot sits just right of its head, level with it or half a staff space above or below
    it (a note on a line has its dot in the space next to the line), and belongs to the one head it is closest to (two
    voices' heads may crowd the same column)."""

    def dy(c, y: float) -> float:
        return min(abs(y - c.y), abs(y - (c.y - 2.5)), abs(y - (c.y + 2.5)))

    n = 0
    for name, x, y in pd.glyphs:
        if name != "dots.dot" or not h.x + 6.0 <= x <= h.x + 15.0:
            continue
        mine = [c for c in heads if c.x + 6.0 <= x <= c.x + 15.0]
        best = min(mine, key=lambda c: (round(dy(c, y), 1), abs(x - (c.x + 9.0))))
        if best is h and dy(h, y) <= 1.8:
            n += 1
    return n


def head_value(h, pd: PageData, heads: list | None = None) -> tuple[str, int]:
    """(written value, dots) of an engraved notehead."""
    dots = dots_of(h, heads if heads is not None else [h], pd)
    if h.kind == "whole":
        return "whole", dots
    if h.kind == "half":
        return "half", dots
    # a filled head: stem, then flags and beams at its end
    up = [s for s in pd.stems if abs(s[0] - (h.x + HEAD_W - 0.3)) <= 0.8 and s[1] - 2.5 <= h.y <= s[2] + 2.5]
    down = [s for s in pd.stems if abs(s[0] - (h.x + 0.2)) <= 0.8 and s[1] - 2.5 <= h.y <= s[2] + 2.5]
    stem = (up or down or [None])[0]
    if stem is None:
        return "quarter", dots  # no stem found: the weakest guess, counted separately by the caller
    xc, y0, y1 = stem
    end_y = y0 if up else y1
    levels = [int(name[-1]) for name, x, y in pd.glyphs
              if name.startswith("flags.") and abs(x - xc) <= 3.5 and abs(y - end_y) <= 4.5]
    flags = {3: 1, 4: 2, 5: 3}.get(max(levels), 0) if levels else 0
    # beams hang from the stem's end, the first at the very end and the others one beam-width inwards
    beams = 0
    for bx0, bx1, yl, yr in pd.beams:
        if bx0 - 1.2 <= xc <= bx1 + 1.2:
            ymid = yl + (yr - yl) * ((xc - bx0) / max(bx1 - bx0, 0.1))  # the beam's centre line at the stem
            inward = (ymid - end_y) if up else (end_y - ymid)
            if -1.8 <= inward <= 10.5:
                beams += 1
    n = max(flags, beams)
    return ("quarter", "eighth", "16th", "32nd")[min(n, 3)], dots


WRITTEN = {96: ("whole", 0), 144: ("whole", 1), 48: ("half", 0), 72: ("half", 1), 24: ("quarter", 0),
           36: ("quarter", 1), 12: ("eighth", 0), 18: ("eighth", 1), 6: ("16th", 0), 9: ("16th", 1),
           3: ("32nd", 0)}  # ticks (24 to the quarter) of each written value
STEP = ["whole", "half", "quarter", "eighth", "16th", "32nd"]


def written_value(n: etree._Element) -> tuple[str | None, int]:
    """What an engraver would print for this note: from its duration and tuplet ratio, not from its <type> label."""
    dur = int(n.findtext("duration") or 0)
    tm = n.find("time-modification")
    if tm is not None:
        dur = dur * int(tm.findtext("actual-notes")) / int(tm.findtext("normal-notes"))
    return WRITTEN.get(round(dur), (n.findtext("type"), len(n.findall("dot"))))


def shift_value(value: str, steps: int) -> str:
    """One step down is half the length (quarter to eighth)."""
    if value not in STEP:
        return value
    return STEP[min(max(STEP.index(value) + steps, 0), len(STEP) - 1)]


def mxl_notes(measure: etree._Element) -> list[dict]:
    out = []
    for start, n in note_starts(measure):
        if n.get("print-object") == "no" or n.find("grace") is not None or n.find("cue") is not None:
            continue
        pitch = n.find("pitch")
        typ, dots = written_value(n)
        notations = n.find("notations")
        scripts = []
        if notations is not None:
            for tag, name in (("fermata", "fermata"), ("trill-mark", "trill")):
                if notations.find(f".//{tag}") is not None:
                    scripts.append(name)
            for tag in ("mordent", "inverted-mordent", "turn", "inverted-turn", "delayed-turn"):
                if notations.find(f".//{tag}") is not None:
                    scripts.append("turn" if "turn" in tag else "mordent")
            if notations.find(".//staccato") is not None:
                scripts.append("staccato")
        out.append({"start": start, "rest": pitch is None, "midi": midi_of(pitch) if pitch is not None else None, "type": typ,
                    "dots": dots, "tie_start": any(t.get("type") == "start" for t in n.findall("tie")),
                    "measure_rest": n.find("rest") is not None and n.find("rest").get("measure") == "yes",
                    "scripts": scripts})
    return out


COLUMN_GAP = 7.0  # points: noteheads closer than this are one onset (a second's displaced head is 5.9 away; swept 4.5 to 8)


def pdf_columns(heads: list, gap: float | None = None) -> int:
    """How many distinct time positions the printed noteheads of a bar stand at (heads of one onset share a column)."""
    gap = COLUMN_GAP if gap is None else gap
    cols, last = 0, -99.0
    for x in sorted(h.x for h in heads):
        if x - last >= gap:
            cols += 1
            last = x
    return cols


def compare_values(pdf: collections.Counter, mxl: collections.Counter) -> tuple[list, list]:
    """(value differences, unpaired heads). A PDF head and an MXL note count as the same note when their pitches are within a
    semitone (a tied note is printed without its accidental); then their written values are compared. Heads with no
    partner at all are a difference in the number of notes, which the pitch audit reports, not a difference in value."""
    left_p = list((pdf - mxl).elements())
    left_m = list((mxl - pdf).elements())
    values, unpaired = [], []
    for m, t, d in sorted(left_p):
        k = next((i for i, (m2, _t2, _d2) in enumerate(left_m) if abs(m2 - m) <= 1), None)
        if k is None:
            unpaired.append(("PDF", N(m), t, d))
            continue
        _m2, t2, d2 = left_m.pop(k)
        if (t, d) != (t2, d2):
            values.append({"pitch": N(m), "pdf": [t, d], "mxl": [t2, d2]})
    unpaired += [("MXL", N(m), t, d) for m, t, d in left_m]
    return values, unpaired


def best_scale(pd_, piece, mx, pages, doc) -> int:
    """Some pieces are printed with note values twice or half as long as the MXL's (the same time, another
    denominator): find the shift that makes most of the first 25 bars agree."""
    score = {}
    for sc in (0, 1, -1, 2, -2):
        agree = total = 0
        for pg, sidx, first in layout_of(piece)[:6]:
            if pg not in pages:
                pages[pg] = (PageData(doc, pg), pdfnotes.read_page(pg))
            data, systems = pages[pg]
            sn = systems[sidx]
            for bi in range(len(sn.barlines)):
                n_bar = first + bi
                if n_bar not in mx or total >= 40:
                    continue
                heads = [h for h in sn.heads if h.bar == bi and h.size > 16]
                pv = collections.Counter((h.midi, *head_value(h, data, heads)) for h in heads)
                mv = collections.Counter((n["midi"], shift_value(n["type"], sc), n["dots"]) for n in mx[n_bar] if not n["rest"])
                total += 1
                agree += not compare_values(pv, mv)[0] and pv.total() == mv.total()
        score[sc] = agree
    return max(score, key=lambda k: (score[k], -abs(k)))


def main() -> None:
    doc = pdfnotes._doc()
    root = load_root(__import__("artfugue.mxl_checked", fromlist=["x"]).OUT_MXL)
    rep = json.loads((WORK / "mxl_checked.json").read_text(encoding="utf-8"))
    appended = {k: tuple(v["measures"]) for k, v in rep["mirror"].items()}
    part5 = root.findall("part")[4].findall("measure")
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    pages: dict[int, tuple[PageData, list]] = {}
    out: dict[str, dict] = {}
    for pd_ in sorted((p for p in P.PIECES if p.in_pdf), key=lambda p: p.order):
        piece = pieces[pd_.id]
        a, b = pd_.mxl or appended[pd_.id]
        first_bar = 0 if part5[a].get("implicit") == "yes" else 1
        mx = {first_bar + i: mxl_notes(m) for i, m in enumerate(part5[a : b + 1])}
        diffs = {"onsets": [], "value": [], "unpaired": [], "rest": [], "tie": [], "script": []}
        stats = collections.Counter()
        scale = best_scale(pd_, piece, mx, pages, doc)
        stats["scale"] = scale
        for pg, sidx, first in layout_of(piece):
            if pg not in pages:
                pages[pg] = (PageData(doc, pg), pdfnotes.read_page(pg))
            data, systems = pages[pg]
            sn = systems[sidx]
            page = doc[pg - 1]
            staves = pdfnotes._staves(page)
            ytop = _staff_barlines(page)[sidx][0]
            k = next(i for i, s in enumerate(staves) if abs(s[0] - ytop) < 3)
            top, bot = staves[k][0], staves[k + 1][1]
            edges = [0, *sn.barlines]
            for bi in range(len(sn.barlines)):
                n_bar = first + bi
                if n_bar not in mx:
                    continue
                x0, x1 = edges[bi], edges[bi + 1]
                lo = x0 if bi else x0 + 30  # the first bar starts after clef and key signature
                heads = [h for h in sn.heads if h.bar == bi and h.size > 16]
                pdf_vals = collections.Counter((h.midi, *head_value(h, data, heads)) for h in heads)
                mx_vals = collections.Counter((n["midi"], shift_value(n["type"], scale), n["dots"])
                                              for n in mx[n_bar] if not n["rest"])
                n_pdf = pdf_columns(heads)
                n_mxl = len({n["start"] for n in mx[n_bar] if not n["rest"]})
                if n_pdf != n_mxl:
                    diffs["onsets"].append({"bar": n_bar, "pdf_positions": n_pdf, "mxl_positions": n_mxl})
                values, unpaired = compare_values(pdf_vals, mx_vals)
                if values:
                    diffs["value"].append({"bar": n_bar, "differences": values})
                if unpaired:
                    diffs["unpaired"].append({"bar": n_bar, "heads": unpaired})
                stats["bars"] += 1
                # rests
                pdf_rests = collections.Counter(REST_NAME[nm] for nm, x, y in data.glyphs
                                                if nm in REST_NAME and lo - 2 <= x <= x1 and top - 8 <= y <= bot + 8)
                mx_rests = collections.Counter(shift_value(n["type"] or "whole", scale) for n in mx[n_bar]
                                               if n["rest"] and not n["measure_rest"])
                mx_rests += collections.Counter("whole" for n in mx[n_bar] if n["measure_rest"])
                if pdf_rests != mx_rests:
                    diffs["rest"].append({"bar": n_bar, "pdf": dict(pdf_rests), "mxl": dict(mx_rests)})
                # ties: curves from a head to another head of the same pitch
                ties: list[int] = []
                by_pitch: dict[int, list] = collections.defaultdict(list)
                for h in sn.heads:
                    if h.size > 16:
                        by_pitch[h.midi].append(h)
                for cx0, cx1, cy0, cy1 in data.curves:
                    if not (x0 - 2 <= cx0 < x1 and top - 14 <= cy0 <= bot + 14):
                        continue
                    ymid = (cy0 + cy1) / 2
                    for hs in by_pitch.values():
                        # a tie starts just after its first head and ends at the left side of the second one, a few
                        # points above or below them (a slur joins heads of different pitch and is not counted)
                        left = [h for h in hs if -2.5 <= cx0 - (h.x + HEAD_W) <= 8.0 and abs(h.y - ymid) <= 9]
                        right = [h for h in hs if -4.5 <= cx1 - h.x <= 7.0 and abs(h.y - ymid) <= 9]
                        # a tie into the next system is drawn only up to the end of this one
                        to_edge = cx1 >= sn.barlines[-1] - 16 and cy1 - cy0 <= 9.5 and bool(left)
                        if to_edge or any(abs(l.y - r.y) < 0.5 and r.x > l.x + 3 for l in left for r in right):
                            ties.append(max((l for l in left), key=lambda h: h.x).midi if left else 0)
                            break
                mx_ties = [n["midi"] for n in mx[n_bar] if n["tie_start"]]
                if collections.Counter(ties) != collections.Counter(mx_ties):
                    diffs["tie"].append({"bar": n_bar, "pdf": sorted(N(m) for m in ties),
                                         "mxl": sorted(N(m) for m in mx_ties)})
                # ornaments and articulation
                pdf_sc = collections.Counter(SCRIPT_NAME[nm] for nm, x, y in data.glyphs
                                             if nm in SCRIPT_NAME and lo - 2 <= x <= x1 and top - 30 <= y <= bot + 30)
                mx_sc = collections.Counter(s for n in mx[n_bar] for s in n["scripts"])
                if pdf_sc != mx_sc:
                    diffs["script"].append({"bar": n_bar, "pdf": dict(pdf_sc), "mxl": dict(mx_sc)})
        out[pd_.id] = {"bars": stats["bars"], "scale": scale, **{k: v for k, v in diffs.items()}}
        print(pd_.id, stats["bars"], "scale", scale, {k: len(v) for k, v in diffs.items()}, flush=True)
    (WORK / "pdf_rhythm.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def N(m: int) -> str:
    return ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][m % 12] + str(m // 12 - 1)


if __name__ == "__main__":
    main()
