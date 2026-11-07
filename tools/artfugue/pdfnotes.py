"""Read noteheads (pitch, bar, x position) from the vector text layer of the Contrapunctus Press PDF.

The PDF was engraved with LilyPond: every notehead, accidental and clef is a glyph of the subset
font ``Emmentaler-20``. Glyph ids are specific to each page's font subset, so glyph names are read
from the embedded CFF charset of that page. Pitch is computed from the glyph's vertical position
relative to the five staff lines, the clef, the key signature and the accidentals of the bar.
"""

from __future__ import annotations

import bisect
import glob
import io
from dataclasses import dataclass, field
from functools import lru_cache

import pymupdf
from fontTools.cffLib import CFFFontSet

from .paths import RAW
from .pdfscore import _staff_barlines

KEY_ZONE = 24  # points after the first clef that belong to key and time signature
STEP = 4.98 / 2  # one diatonic step in points
LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11]  # C D E F G A B
# diatonic number (octave * 7 + letter) of the bottom staff line for each clef
CLEF_BOTTOM = {"clefs.G": 4 * 7 + 2, "clefs.F": 2 * 7 + 4, "clefs.C": 3 * 7 + 3,
               "clefs.G_change": 4 * 7 + 2, "clefs.F_change": 2 * 7 + 4, "clefs.C_change": 3 * 7 + 3}
ACC_ALTER = {"accidentals.sharp": 1, "accidentals.flat": -1, "accidentals.natural": 0,
             "accidentals.doublesharp": 2, "accidentals.flatflat": -2}
NOTEHEADS = {"noteheads.s0": "whole", "noteheads.s1": "half", "noteheads.s2": "black"}


@dataclass
class Head:
    x: float
    y: float
    staff: int  # 0 = upper staff of the system
    bar: int  # index of the bar inside the system (0 = first bar of the system)
    kind: str
    size: float
    dnum: int = 0  # diatonic number (octave * 7 + letter)
    alter: int = 0
    explicit: bool = False  # accidental printed in front of this note
    rel: float = 0.0  # horizontal position inside its bar, 0..1
    midi: int = 0


@dataclass
class SystemNotes:
    page: int
    system: int
    barlines: list[float]
    heads: list[Head] = field(default_factory=list)
    key: dict[int, dict[int, int]] = field(default_factory=dict)  # staff -> letter -> alter
    warnings: list[str] = field(default_factory=list)


@lru_cache(maxsize=1)
def _doc():
    return pymupdf.open(glob.glob(str(RAW / "*.pdf"))[0])


def _glyph_names(doc, page) -> dict[str, list[str]]:
    """font name -> list of glyph names indexed by glyph id, for the page's music fonts."""
    out: dict[str, list[str]] = {}
    for f in page.get_fonts():
        if "Emmentaler-20" not in f[3]:
            continue
        cs = CFFFontSet()
        cs.decompile(io.BytesIO(doc.extract_font(f[0])[3]), None)
        names = list(cs[cs.fontNames[0]].charset)
        if "Emmentaler-20" in out and out["Emmentaler-20"] != names:
            raise RuntimeError("two different Emmentaler subsets on one page")
        out["Emmentaler-20"] = names
    return out


def _staves(page) -> list[tuple[float, float]]:
    """[(y_top_line, y_bottom_line)] for every five-line staff on the page, top to bottom."""
    ys = set()
    for x in page.get_drawings():
        for it in x["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.05 and abs(it[1].x - it[2].x) > 300:
                ys.add(round(it[1].y, 2))
    ys = sorted(ys)
    staves, i = [], 0
    while i + 4 < len(ys):
        grp = ys[i : i + 5]
        if all(abs((grp[k + 1] - grp[k]) - 4.98) < 0.3 for k in range(4)):
            staves.append((grp[0], grp[4]))
            i += 5
        else:
            i += 1
    return staves


def _staff_of(staves: list[tuple[float, float]], y: float) -> int:
    d = [0 if st[0] <= y <= st[1] else min(abs(y - st[0]), abs(y - st[1])) for st in staves]
    return d.index(min(d))


def _has_ledgers(ledgers, x: float, edge: float, sign: int, need: int) -> bool:
    return all(any(lo - 1.5 <= x + 4 <= hi + 1.5 and abs(ly - (edge + sign * 4.98 * k)) < 0.6
                   for lo, hi, ly in ledgers) for k in range(1, need + 1))


def _staff_of_head(staves, ledgers, x: float, y: float) -> int:
    """Staff of a notehead; a note outside both staves belongs to the one whose ledger lines
    (all of them, up to the note) are drawn under it."""
    best, best_d = None, 1e9
    for i, st in enumerate(staves):
        if st[0] <= y <= st[1]:
            return i
        above = y < st[0]
        d = (st[0] - y) if above else (y - st[1])
        need = int((d + 0.3) / 4.98)
        if _has_ledgers(ledgers, x, st[0] if above else st[1], -1 if above else 1, need) and d < best_d:
            best, best_d = i, d
    return best if best is not None else _staff_of(staves, y)


def read_page(pdf_page: int) -> list[SystemNotes]:
    doc = _doc()
    page = doc[pdf_page - 1]
    names = _glyph_names(doc, page)["Emmentaler-20"]
    systems = _staff_barlines(page)
    staves = _staves(page)
    ledgers = []  # short horizontal strokes: ledger lines
    for dr in page.get_drawings():
        for it in dr["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.05 and 7 <= abs(it[1].x - it[2].x) <= 11:
                ledgers.append((min(it[1].x, it[2].x), max(it[1].x, it[2].x), it[1].y))
    # glyphs
    glyphs = []
    for sp in page.get_texttrace():
        if "Emmentaler-20" not in sp["font"]:
            continue
        for _u, gid, origin, _bb in sp["chars"]:
            glyphs.append((names[gid], origin[0], origin[1], sp["size"]))
    out = []
    for s, (y_sys, barlines) in enumerate(systems):
        # staves of this system: the one starting at y_sys and the next one
        k = next(i for i, st in enumerate(staves) if abs(st[0] - y_sys) < 3)
        sys_staves = staves[k : k + 2]
        sn = SystemNotes(pdf_page, s, barlines)
        lo = sys_staves[0][0] - 40
        hi = sys_staves[-1][1] + 40
        clefs: dict[int, list[tuple[float, int]]] = {0: [], 1: []}
        accs, heads = [], []

        for name, x, y, size in glyphs:
            if not lo <= y <= hi:
                continue
            if name in CLEF_BOTTOM:
                st = _staff_of(sys_staves, y)
                clefs[st].append((x, CLEF_BOTTOM[name]))
            elif name in ACC_ALTER:
                accs.append((x, y, ACC_ALTER[name], _staff_of(sys_staves, y)))
            elif name in NOTEHEADS:
                heads.append((x, y, NOTEHEADS[name], size, _staff_of_head(sys_staves, ledgers, x, y)))
        for lst in clefs.values():
            lst.sort()
        bars_x = list(barlines)
        # a forward-repeat sign at the start of a system is drawn as a barline before the first note;
        # it does not end a bar (Canon 3, bar 9)
        first_head = min((x for name, x, y, _ in glyphs if name in NOTEHEADS and lo <= y <= hi), default=None)
        clef_x = clefs[0][0][0] if clefs[0] else 0.0
        while first_head is not None and len(bars_x) > 1 and bars_x[0] < min(first_head, clef_x + 60):
            bars_x.pop(0)
        sn.barlines = list(bars_x)
        x_start = (clefs[0][0][0] + KEY_ZONE) if clefs[0] else 60.0
        for x, y, kind, size, st in sorted(heads):
            base_x = [c for c in clefs[st] if c[0] <= x]
            if not base_x:
                sn.warnings.append(f"no clef for note at x={x:.0f}")
                continue
            bottom = base_x[-1][1]
            ybot = sys_staves[st][1]
            dpos = round((ybot - y) / STEP)
            h = Head(x, y, st, bisect.bisect_left(bars_x, x - 0.5), kind, size)
            left = bars_x[h.bar - 1] if h.bar > 0 else x_start
            right = bars_x[h.bar] if h.bar < len(bars_x) else left + 1
            h.rel = min(1.0, max(0.0, (x - left) / max(right - left, 1.0)))
            h.dnum = bottom + dpos
            sn.heads.append(h)
        # attach accidentals to noteheads (key signature = right after the first clef)
        used = set()
        for ax, ay, alt, st in sorted(accs, key=lambda a: a[0]):
            if clefs[st] and ax - clefs[st][0][0] < KEY_ZONE:
                continue
            cands = [h for h in sn.heads
                     if 0 < h.x - ax < 24 and abs(h.y - ay) < 1.5 and not h.explicit]
            if cands:
                h = min(cands, key=lambda h: h.x)
                h.explicit, h.alter = True, alt
                used.add((ax, ay))
        # key signature = unattached accidentals left of the first notehead of the staff
        for st in (0, 1):
            fx = clefs[st][0][0] + KEY_ZONE if clefs[st] else 0
            key: dict[int, int] = {}
            for ax, ay, alt, ast in sorted(accs):
                if ast != st or (ax, ay) in used:
                    continue
                if ax < fx:
                    cl = [c for c in clefs[st] if c[0] <= ax]
                    if not cl:
                        continue
                    dn = cl[-1][1] + round((sys_staves[st][1] - ay) / STEP)
                    key[dn % 7] = alt
                else:
                    sn.warnings.append(f"unattached accidental staff {st} at x={ax:.0f}")
            sn.key[st] = key
        # pitch with accidentals valid until the end of the bar (per staff, per octave-pitch)
        for st in (0, 1):
            bar_state: dict[tuple[int, int], int] = {}
            cur_bar = -1
            for h in sorted((h for h in sn.heads if h.staff == st), key=lambda h: (h.bar, h.x)):
                if h.bar != cur_bar:
                    bar_state, cur_bar = {}, h.bar
                if not h.explicit:
                    h.alter = bar_state.get((h.dnum // 7, h.dnum % 7), sn.key[st].get(h.dnum % 7, 0))
                bar_state[(h.dnum // 7, h.dnum % 7)] = h.alter
                h.midi = 12 * (h.dnum // 7 + 1) + LETTER_SEMI[h.dnum % 7] + h.alter
        out.append(sn)
    return out


def piece_heads(layout: list[tuple[int, int, int]]) -> dict[int, list[Head]]:
    """printed bar number -> noteheads, for a piece described by its engraved systems."""
    res: dict[int, list[Head]] = {}
    cache: dict[int, list[SystemNotes]] = {}
    for pg, sidx, first in layout:
        if pg not in cache:
            cache[pg] = read_page(pg)
        sn = cache[pg][sidx]
        for h in sn.heads:
            res.setdefault(first + h.bar, []).append(h)
    return res


def _dist(a: int, b: int) -> float:
    """Semitone distance allowing octave displacements (each octave costs a little)."""
    d = abs(a - b)
    k = round(d / 12)
    return abs(d - 12 * k) + 0.3 * min(k, 3)


MAX_FIX = 2  # a mirrored pitch is only replaced by a PDF pitch at most this many semitones away


def _match(notes: list[dict], bars: list[dict], layout) -> dict:
    """Replace the pitches of mirror-derived notes by those read from the PDF, bar by bar.

    Rhythm, voices and onsets stay as derived (the mirror pieces are rhythmically identical to
    their source). Returns a report; ``bars_failed`` lists printed bars that still disagree with
    the engraving (a PDF pitch that nothing in the bar explains, or an onset the PDF does not show).
    """
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    heads = piece_heads(layout)
    by_bar: dict[int, list[dict]] = {}
    for n in notes:
        by_bar.setdefault(n["bar"], []).append(n)
    blen = {b["n"]: b for b in bars}
    changed, octave_moved, unresolved, failed = 0, 0, [], []
    for bar, ns in sorted(by_bar.items()):
        hs = [h for h in heads.get(bar, []) if h.size > 16]
        # notes tied over the barline show up again as an extra notehead at the start of the bar
        b0 = blen[bar]["on"]
        for n in notes:
            if n["on"] < b0 < n["on"] + n["dur"] and hs:
                cands = [h for h in hs if h.rel < 0.35 and _dist(n["pitch"], h.midi) <= MAX_FIX]
                if cands:
                    hs.remove(min(cands, key=lambda h: (_dist(n["pitch"], h.midi), h.rel)))
        if not hs:
            unresolved.append(bar)
            continue
        ln = max(blen[bar]["len"], 1)
        cost = np.zeros((len(ns), len(hs)))
        for i, n in enumerate(ns):
            for j, h in enumerate(hs):
                cost[i, j] = _dist(n["pitch"], h.midi) + 0.5 * abs(n["beat"] / ln - h.rel)
        for i, j in zip(*linear_sum_assignment(cost)):
            n, h = ns[i], hs[j]
            if _dist(n["pitch"], h.midi) <= MAX_FIX + 0.3 * 3:
                if n["pitch"] != h.midi:
                    changed += 1
                    if abs(n["pitch"] - h.midi) >= 10:
                        octave_moved += 1
                    n["pitch"] = h.midi
            else:
                unresolved.append(f"{bar}:{n['id']}")
    for bar in sorted(blen):
        b = blen[bar]
        s, e = b["on"], b["on"] + b["len"]
        onset = {n["pitch"] for n in notes if s <= n["on"] < e}
        sound = {n["pitch"] for n in notes if n["on"] < e and n["on"] + n["dur"] > s}
        pdf = {h.midi for h in heads.get(bar, []) if h.size > 16}
        if not (onset <= pdf <= sound):
            failed.append({"bar": bar, "not_in_pdf": sorted(onset - pdf), "not_sounding": sorted(pdf - sound)})
    return {"patched_notes": changed, "octave_moved": octave_moved, "unresolved": unresolved, "bars_failed": failed,
            "bars_checked": len(blen)}


def patch_pitches(notes: list[dict], bars: list[dict], layout) -> dict:
    """Two passes: learn one octave offset per voice (the mirror voices are transposed by octaves
    in Bach's pairs), apply it, then match again with octave displacements discouraged."""
    import collections

    trial = [dict(n) for n in notes]
    _match(trial, bars, layout)
    shift: dict[int, int] = {}
    for v in {n["voice"] for n in notes}:
        c = collections.Counter(round((t["pitch"] - n["pitch"]) / 12)
                                for n, t in zip(notes, trial) if n["voice"] == v)
        shift[v] = c.most_common(1)[0][0]
    for n in notes:
        n["pitch"] += 12 * shift[n["voice"]]
    rep = _match(notes, bars, layout)
    rep["voice_octave_shift"] = {str(v): k for v, k in sorted(shift.items())}
    return rep
