"""Extract structure (titles, system-start measure numbers) from the Contrapunctus Press PDF.

The PDF's text uses subset fonts: digits in 'Didot-Bold' 9pt are encoded as
``chr(0x14 + digit)`` and title text is shifted by +28 code points.
"""

import glob
from dataclasses import dataclass, field

import pymupdf

from .paths import RAW


@dataclass
class PdfPage:
    pdf_page: int  # 1-based physical page
    printed_page: int | None
    titles: list[str] = field(default_factory=list)
    system_starts: list[int] = field(default_factory=list)  # printed measure numbers, top to bottom


def _decode_digits(s: str) -> int | None:
    try:
        digits = [ord(c) - 0x14 for c in s]
    except TypeError:
        return None
    if not digits or any(not 0 <= x <= 9 for x in digits):
        return None
    return int("".join(map(str, digits)))


def _decode_title(s: str) -> str:
    return "".join(chr(ord(c) + 28) if 0x20 < ord(c) < 0x60 else " " for c in s).strip()


def read_pages() -> list[PdfPage]:
    pdf = pymupdf.open(glob.glob(str(RAW / "*.pdf"))[0])
    pages = []
    for i, page in enumerate(pdf):
        p = PdfPage(pdf_page=i + 1, printed_page=None)
        items = []
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    if s["font"] != "Didot-Bold":
                        continue
                    size = round(s["size"])
                    y = s["bbox"][1]
                    if size == 9:
                        n = _decode_digits(s["text"])
                        if n is not None:
                            items.append((y, n))
                    elif size == 17:
                        p.titles.append(s["text"])
        p.system_starts = [n for _, n in sorted(items)]
        pages.append(p)
    return pages


@dataclass
class PdfPiece:
    title: str
    first_pdf_page: int
    bars: int = 0
    systems: int = 0
    consistent: bool = True  # printed system-start numbers agree with counted barlines
    problems: list[str] = field(default_factory=list)
    # one entry per engraved system: (pdf_page, system index on that page, first bar number)
    layout: list[tuple[int, int, int]] = field(default_factory=list)


def _staff_barlines(page) -> list[tuple[float, list[float]]]:
    """Return [(top_y_of_system, [barline x positions])] for the upper staff of each system."""
    segs: dict[int, set[float]] = {}
    for x in page.get_drawings():
        for it in x["items"]:
            if it[0] != "l" or abs(it[1].x - it[2].x) > 0.6:
                continue
            y0, y1 = sorted((it[1].y, it[2].y))
            if 18 <= y1 - y0 <= 22:
                segs.setdefault(round(y0), set()).add(round(it[1].x, 1))
    # staves come in (treble, bass) pairs ~52pt apart; keep the upper one of each pair
    ys = sorted(segs)
    systems, skip = [], set()
    for i, y in enumerate(ys):
        if y in skip:
            continue
        for y2 in ys[i + 1 :]:
            if 45 <= y2 - y <= 95 and segs[y2] == segs[y]:
                skip.add(y2)
                break
        systems.append(y)
    out = []
    for y in systems:
        xs = sorted(segs[y])
        merged: list[float] = []
        for x in xs:  # collapse thin+thick double barlines
            if not merged or x - merged[-1] > 4:
                merged.append(x)
        out.append((float(y), merged))
    return out


def read_pieces() -> list[PdfPiece]:
    pdf = pymupdf.open(glob.glob(str(RAW / "*.pdf"))[0])
    pieces: list[PdfPiece] = []
    cur: PdfPiece | None = None
    for i, page in enumerate(pdf):
        titles = []
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    if s["font"] == "Didot-Bold" and round(s["size"]) == 17:
                        titles.append((s["bbox"][1], _decode_title(s["text"])))
        nums = []
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    if s["font"] == "Didot-Bold" and round(s["size"]) == 9:
                        n = _decode_digits(s["text"])
                        if n is not None:
                            nums.append((s["bbox"][1], n))
        nums.sort()
        systems = _staff_barlines(page)
        events = [(y, "title", t) for y, t in titles] + [(y, "system", bl) for y, bl in systems]
        sys_on_page = 0
        for y, kind, val in sorted(events, key=lambda e: e[0]):
            if kind == "title":
                cur = PdfPiece(title=val, first_pdf_page=i + 1)
                pieces.append(cur)
                continue
            if cur is None:
                continue
            printed = next((n for ny, n in nums if abs(ny - y) < 30), None)
            expected_start = cur.bars + 1
            if printed is not None and printed != expected_start:
                cur.consistent = False
                cur.problems.append(
                    f"p{i + 1}: printed bar {printed}, counted {expected_start}"
                )
            first_bar = printed if printed is not None else expected_start
            cur.layout.append((i + 1, sys_on_page, first_bar))
            sys_on_page += 1
            cur.bars += len(val)
            cur.systems += 1
    return pieces
