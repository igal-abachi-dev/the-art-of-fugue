"""Contact sheets of the bars where the MXL and the PDF still disagree (for a person to look at).

Each sheet row is one bar cut from the PDF at 3x, with the noteheads the reader says the MXL does not have circled in
red, and a caption with the pitches on both sides and, where the recording was asked (``audio_check.py``), what it said.
Written to ``docs/img/pdf-review-N.png``; listed in ``docs/mxl-pdf-check.md``.

Run:  python -m artfugue.pdf_review
"""

from __future__ import annotations

import glob
import json

import pymupdf
from PIL import Image, ImageDraw

from . import pdfnotes
from .audit_pdf import layout_of
from .paths import RAW, ROOT, WORK
from .pdfscore import _staff_barlines

SCORE = WORK / "score"
IMG = ROOT / "docs" / "img"
PER_SHEET = 6
ZOOM = 3


def name(midi: int) -> str:
    return f"{['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][midi % 12]}{midi // 12 - 1}"


def main() -> None:
    doc = pymupdf.open(glob.glob(str(RAW / "*.pdf"))[0])
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    left = json.loads((SCORE / "pdf_corrections.json").read_text(encoding="utf-8"))["still_differing"]
    audio = {}
    path = WORK / "audio_check.json"
    if path.exists():
        for item in json.loads(path.read_text(encoding="utf-8"))["still_differing"]:
            audio[(item["piece"], item["bar"])] = item
    rows, cache = [], {}
    for d in left:
        p = pieces[d["piece"]]
        layout = layout_of(p)
        bar = next(b for b in p["bars"] if b["n"] == d["bar"])
        pg, sy = bar["pdf_page"], bar["pdf_system"]
        first = next(fb for (g, s, fb) in layout if g == pg and s == sy)
        if pg not in cache:
            cache[pg] = pdfnotes.read_page(pg)
        sn = cache[pg][sy]
        bi = d["bar"] - first
        page = doc[pg - 1]
        staves = pdfnotes._staves(page)
        ytop = _staff_barlines(page)[sy][0]
        k = next(i for i, s in enumerate(staves) if abs(s[0] - ytop) < 3)
        top, bot = staves[k][0], staves[k + 1][1]
        edges = [0, *sn.barlines]
        x0 = edges[bi] if bi > 0 else max(40, min(h.x for h in sn.heads) - 35)
        clip = pymupdf.Rect(x0 - 6, top - 30, edges[bi + 1] + 4, bot + 28)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        dr = ImageDraw.Draw(im)
        for h in sn.heads:
            if h.bar == bi and h.size > 16 and h.midi in d["pdf_not_in_mxl"]:
                x, y = (h.x + 3 - clip.x0) * ZOOM, (h.y - clip.y0) * ZOOM
                dr.ellipse((x - 16, y - 16, x + 16, y + 16), outline=(255, 0, 0), width=3)
        cap = (f"{d['piece']} bar {d['bar']} (PDF page {pg})   MXL has {[name(x) for x in d['mxl_not_in_pdf']]}   "
               f"PDF reading has {[name(x) for x in d['pdf_not_in_mxl']]} (red)")
        a = audio.get((d["piece"], d["bar"]))
        if a and a["notes"]:
            cap += "   recording, dB for the PDF pitch minus the MXL pitch: " + "; ".join(
                f"{name(n['mxl_pitch'])}: " + ", ".join(f"{name(int(q))} {v:+.1f}" for q, v in n["vs_pdf_pitch_db"].items())
                for n in a["notes"][:3])
        canvas = Image.new("RGB", (max(im.width, 1500), im.height + 26), "white")
        ImageDraw.Draw(canvas).text((4, 4), cap, fill=(0, 0, 0))
        canvas.paste(im, (0, 26))
        rows.append(canvas)
    for n in range(0, len(rows), PER_SHEET):
        chunk = rows[n : n + PER_SHEET]
        sheet = Image.new("RGB", (max(r.width for r in chunk), sum(r.height for r in chunk)), "white")
        y = 0
        for r in chunk:
            sheet.paste(r, (0, y))
            y += r.height
        out = IMG / f"pdf-review-{n // PER_SHEET + 1}.png"
        sheet.save(out)
        print(out.name, len(chunk), "bars")


if __name__ == "__main__":
    main()
