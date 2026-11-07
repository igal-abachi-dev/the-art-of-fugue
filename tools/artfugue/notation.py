"""Notation for the score overlay (T4.4.1), source 1: the engraving of the Contrapunctus Press PDF.

For every shipped piece this writes ``web/static/data/notation/<id>.json`` and, for the PDF pages the piece uses,
``web/static/data/notation/pdf/p<page>.svg`` (vector, from the PDF itself). The JSON says, per engraved system:

* which page file to show and which rectangle of it (``crop``, in PDF points),
* where each bar is (``bars``: printed number and x range),
* where every notehead is (``heads``: ``[x, y, staff, i, j, ...]`` with the positions ``i, j...`` of the notes it
  belongs to in the shipped note chunk; a repeated canon's two passes share one head).

The heads are read from the PDF's own glyphs (``pdfnotes``) and paired with the notes bar by bar, the same way the
pitch audit does. A second source (Verovio, from the MXL) writes the same format: see ``notation_mxl.py``.

Licence of the PDF: CC BY-NC-SA 4.0 (Contrapunctus Press, edited and engraved by Dr. Dominic Florence): the credit is
in the JSON (``credit``) and the app shows it; share-alike applies to what is derived from the engraving.

Run:  python -m artfugue.notation
"""

from __future__ import annotations

import glob
import json
import re

import numpy as np
import pymupdf
from scipy.optimize import linear_sum_assignment

from . import pdfnotes
from .audit_pdf import layout_of
from .export import DATA, SCORE, TIMED, shipped_order
from .paths import RAW

OUT = DATA / "notation"
CREDIT = (
    "Score engraving: Contrapunctus Press reference score (CP 0101), edited and engraved by Dr. Dominic Florence, "
    "CC BY-NC-SA 4.0, via IMSLP"
)
HEAD_HALF_WIDTH = 3.2  # centre of a notehead from its glyph origin, points
MAX_PITCH_DIFF = 2  # a notehead and a note this far apart still count as the same note
CROP_ABOVE, CROP_BELOW = 34.0, 30.0


_LONG_NUMBER = re.compile(r"-?\d*\.\d{4,}")


def _round_numbers(text: str, digits: int) -> str:
    def one(m: re.Match) -> str:
        t = f"{float(m.group(0)):.{digits}f}".rstrip("0").rstrip(".")
        t = re.sub(r"^(-?)0\.", r"\1.", t)
        return t if t not in ("", "-", "-0") else "0"

    return _LONG_NUMBER.sub(one, text)


def slim_svg(svg: str) -> str:
    """Round the numbers of a PyMuPDF page SVG: glyph outlines (1-em units, drawn about 14 pt) to 3 decimals, which
    is below 0.02 pt, everything else to 4. About 40 % smaller, and no visible change at 4x zoom."""
    svg = re.sub(r' xmlns:inkscape="[^"]*"', "", svg)
    svg = re.sub(r'(<path id="font_[^"]*" d=")([^"]*)(")',
                 lambda m: m.group(1) + _round_numbers(m.group(2), 3) + m.group(3), svg)
    return _round_numbers(svg, 4)


def _line_extent(page, y0: float, y1: float) -> tuple[float, float]:
    """x extent of the long staff lines between y0 and y1."""
    lo, hi = 1e9, -1e9
    for dr in page.get_drawings():
        for it in dr["items"]:
            long_flat = it[0] == "l" and abs(it[1].y - it[2].y) < 0.05 and abs(it[1].x - it[2].x) > 300
            if long_flat and y0 <= it[1].y <= y1:
                lo, hi = min(lo, it[1].x, it[2].x), max(hi, it[1].x, it[2].x)
    return lo, hi


def _pair_bar(ns: list[dict], hs: list, s: int, ln: int) -> list[tuple[dict, object]]:
    """Notes starting in the bar paired with noteheads, pitch first, then position in the bar."""
    if not ns or not hs:
        return []
    cost = np.array(
        [[abs(n["pitch"] - h.midi) + 0.5 * abs((n["on"] - s) / ln - h.rel) for h in hs] for n in ns]
    )
    out = []
    for i, j in zip(*linear_sum_assignment(cost)):
        if abs(ns[i]["pitch"] - hs[j].midi) <= MAX_PITCH_DIFF:
            out.append((ns[i], hs[j]))
    return out


def attach_bar(bar: dict, notes: list[dict], heads: list) -> dict[int, list[dict]]:
    """head index (in ``heads``) -> the written notes it shows, for one bar."""
    s, ln = bar["on"], max(bar["len"], 1)
    e = s + ln
    heads = [h for h in heads if h.size > 16]  # smaller glyphs are grace notes
    ns = [n for n in notes if s <= n["on"] < e and "grace" not in n.get("flags", [])]
    owner: dict[int, list[dict]] = {}
    free = list(range(len(heads)))

    # notes tied over the barline show again as a notehead at the start of the bar
    for n in notes:
        if n["on"] < s < n["on"] + n["dur"]:
            cands = [j for j in free if heads[j].rel < 0.35 and abs(heads[j].midi - n["pitch"]) <= 1]
            if cands:
                j = min(cands, key=lambda j: (abs(heads[j].midi - n["pitch"]), heads[j].rel))
                owner.setdefault(j, []).append(n)
                free.remove(j)

    for n, h in _pair_bar(ns, [heads[j] for j in free], s, ln):
        j = next(k for k in free if heads[k] is h)
        owner.setdefault(j, []).append(n)
        free.remove(j)

    # what is left: a tie inside the bar (second head of a long note), or a head the notes do not explain
    for j in free:
        t = s + heads[j].rel * ln
        cands = [
            n for n in notes
            if n["on"] <= t < n["on"] + n["dur"] and abs(n["pitch"] - heads[j].midi) <= 1
            and "grace" not in n.get("flags", [])
        ]
        if cands:
            owner.setdefault(j, []).append(min(cands, key=lambda n: abs(n["pitch"] - heads[j].midi)))
    return owner


def build_piece(doc, piece: dict, written: list[dict], timed: dict, cache: dict) -> tuple[dict, dict]:
    layout = layout_of(piece)
    bars = {b["n"]: b for b in piece["bars"]}
    shipped = shipped_order(timed["notes"])
    # written note id -> positions in the shipped chunk (an unfolded canon has two notes per written note)
    positions: dict[str, list[int]] = {}
    for i, n in enumerate(shipped):
        positions.setdefault(n.get("src", n["id"]), []).append(i)

    systems, stats = [], {"heads": 0, "heads_with_notes": 0, "notes": 0, "notes_shown": 0, "pages": set()}
    shown: set[str] = set()
    for pg, sidx, first in layout:
        if pg not in cache:
            cache[pg] = pdfnotes.read_page(pg)
        sn = cache[pg][sidx]
        page = doc[pg - 1]
        staves = pdfnotes._staves(page)
        k = next(i for i, st in enumerate(staves) if abs(st[0] - sn_top(page, sn)) < 3)
        top, bottom = staves[k][0], staves[k + 1][1]
        x0, x1 = _line_extent(page, top - 1, bottom + 1)
        crop = [round(x0 - 18, 1), round(top - CROP_ABOVE, 1), round(x1 - x0 + 24, 1),
                round(bottom - top + CROP_ABOVE + CROP_BELOW, 1)]
        by_bar: dict[int, list] = {}
        for h in sn.heads:
            by_bar.setdefault(h.bar, []).append(h)
        out_heads = []
        for bi, hs in sorted(by_bar.items()):
            n_bar = first + bi
            if n_bar not in bars:
                continue
            own = attach_bar(bars[n_bar], written, hs)
            real = [h for h in hs if h.size > 16]
            for j, h in enumerate(real):
                ids = [n["id"] for n in own.get(j, [])]
                idx = sorted({p for i in ids for p in positions.get(i, [])})
                shown.update(ids)
                stats["heads"] += 1
                stats["heads_with_notes"] += bool(idx)
                out_heads.append([round(h.x + HEAD_HALF_WIDTH, 1), round(h.y, 1), h.staff, *idx])
        edges = [x0, *sn.barlines]
        assert max((h.bar for h in sn.heads), default=0) < len(sn.barlines), (pg, sidx)
        systems.append({
            "page": pg,
            "svg": f"pdf/p{pg:03d}.svg",
            "size": [round(page.rect.width, 1), round(page.rect.height, 1)],
            "crop": crop,
            # the list holds the barline that ends each bar (the line at the left edge is not in it)
            "bars": [
                {"n": first + i, "x0": round(edges[i], 1), "x1": round(edges[i + 1], 1)}
                for i in range(len(edges) - 1) if first + i in bars
            ],
            "heads": out_heads,
        })
        stats["pages"].add(pg)
    sounding = [n for n in written if "grace" not in n.get("flags", [])]
    stats["notes"] = len(sounding)
    stats["notes_shown"] = sum(1 for n in sounding if n["id"] in shown)
    stats["pages"] = sorted(stats["pages"])
    return {"version": 1, "piece": piece["id"], "source": "pdf", "credit": CREDIT, "systems": systems}, stats


def sn_top(page, sn) -> float:
    """y of the upper staff of the system (the layout reader keeps barlines, so look it up the same way)."""
    from .pdfscore import _staff_barlines

    return _staff_barlines(page)[sn.system][0]


def main() -> None:
    pieces = json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]
    doc = pymupdf.open(glob.glob(str(RAW / "*.pdf"))[0])
    (OUT / "pdf").mkdir(parents=True, exist_ok=True)
    cache: dict[int, list] = {}
    report, written_pages = [], set()
    for p in sorted(pieces, key=lambda p: p["order"]):
        timed_path = TIMED / f"{p['id']}.json"
        if p["status"] == "excluded" or not timed_path.exists():
            continue
        written = json.loads((SCORE / "notes" / f"{p['id']}.json").read_text(encoding="utf-8"))["notes"]
        timed = json.loads(timed_path.read_text(encoding="utf-8"))
        data, st = build_piece(doc, p, written, timed, cache)
        (OUT / f"{p['id']}.json").write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
        for pg in st["pages"]:
            if pg not in written_pages:
                svg = slim_svg(doc[pg - 1].get_svg_image(text_as_path=True))
                (OUT / "pdf" / f"p{pg:03d}.svg").write_text(svg, encoding="utf-8")
                written_pages.add(pg)
        report.append({"id": p["id"], **{k: v for k, v in st.items() if k != "pages"}, "pages": len(st["pages"])})
        print(f"{p['id']}: {len(data['systems'])} systems, {st['heads']} heads ({st['heads_with_notes']} with notes), "
              f"{st['notes_shown']}/{st['notes']} notes shown, {len(st['pages'])} pages")
    (WORK_REPORT).write_text(json.dumps(report, indent=1), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"{len(written_pages)} page files, {total / 1e6:.1f} MB in {OUT}")


WORK_REPORT = SCORE.parent / "notation_report.json"

if __name__ == "__main__":
    main()
