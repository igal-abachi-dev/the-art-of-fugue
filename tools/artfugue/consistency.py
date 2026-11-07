"""Do the MXL, the PDF and the recording agree? Three checks that can be repeated.

1. **Alignment against the recording**: for every note of every piece, is its pitch audible at its aligned time? The
   semitone CQT of the recording is averaged over the first 0.4 s of the note and the note's pitch (its fundamental or
   its octave) must stand at least 3 dB above the median of the twelve neighbouring semitones. The same is measured
   with every note moved 0.45 s earlier and later. A good alignment gives a high first number and a clearly lower
   second one; a wrong one gives two equal numbers. This is not a measure of milliseconds, only of "the right note
   is sounding about then".
2. **Repeats**: the repeat signs engraved in the PDF (a thick barline with dots) against the repeat marks in the MXL,
   and against the repeats the alignment found the pianist plays (``repeats_taken``).
3. **The end of the last fugue**: Contrapunctus XIV breaks off. Its last bar, the last aligned note and the level of
   the recording after it.

Run:  python -m artfugue.consistency      (writes data/work/consistency.json)
"""

from __future__ import annotations

import json

import numpy as np

from . import pdfnotes
from .audio_check import cqt
from .cqt import FPS, LOWEST_MIDI
from .paths import WORK
from .pdfscore import _staff_barlines

SCORE = WORK / "score"
TIMED = WORK / "timed"
SHIFT_S = 0.45
PRESENT_DB = 3.0


def present_fraction(notes: list[dict], shift: float) -> tuple[int, int]:
    db = cqt()
    ok = total = 0
    for n in notes:
        if "grace" in n.get("flags", []):
            continue
        a = int((n["t_on"] + shift + 0.03) * FPS)
        b = int(min(n["t_off"] + shift, n["t_on"] + shift + 0.4) * FPS)
        row = n["pitch"] - LOWEST_MIDI
        if a < 0 or b <= a or b >= db.shape[1] or not 6 <= row < db.shape[0] - 6:
            continue
        win = db[:, a:b].mean(axis=1)
        own = max(win[row], win[row + 12] if row + 12 < len(win) else -99.0)
        total += 1
        ok += bool(own > np.median(np.concatenate([win[row - 6 : row], win[row + 1 : row + 7]])) + PRESENT_DB)
    return ok, total


def alignment_check(pieces: list[str]) -> dict:
    out, all_ok, all_n, all_s = {}, 0, 0, 0.0
    for pid in pieces:
        notes = json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))["notes"]
        a, t = present_fraction(notes, 0.0)
        s1, _ = present_fraction(notes, SHIFT_S)
        s2, _ = present_fraction(notes, -SHIFT_S)
        out[pid] = {"notes": t, "aligned": round(a / t, 3), "shifted": round((s1 + s2) / 2 / t, 3)}
        all_ok, all_n, all_s = all_ok + a, all_n + t, all_s + (s1 + s2) / 2
    out["all"] = {"notes": all_n, "aligned": round(all_ok / all_n, 3), "shifted": round(all_s / all_n, 3)}
    return out


def pdf_repeat_signs() -> list[dict]:
    """Thick barlines with dots next to them, per PDF page and system."""
    doc = pdfnotes._doc()
    found = []
    for pg in range(1, len(doc) + 1):
        page = doc[pg - 1]
        try:
            names = pdfnotes._glyph_names(doc, page)["Emmentaler-20"]
        except (KeyError, RuntimeError):
            continue
        dots = [o for sp in page.get_texttrace() if "Emmentaler-20" in sp["font"]
                for _u, gid, o, _b in sp["chars"] if names[gid] == "dots.dot"]
        staves = pdfnotes._staves(page)
        drawings = page.get_drawings()
        for si, (y_sys, _bl) in enumerate(_staff_barlines(page)):
            k = next((i for i, s in enumerate(staves) if abs(s[0] - y_sys) < 3), None)
            if k is None:
                continue
            top, bot = staves[k][0], staves[k + 1][1]
            thick = sorted({round(it[1].x, 1) for dr in drawings for it in dr["items"]
                            if it[0] == "l" and abs(it[1].x - it[2].x) < 0.6 and abs(it[1].y - it[2].y) > 15
                            and (dr.get("width") or 0) > 2 and top - 3 <= min(it[1].y, it[2].y) <= top + 8})
            for x in thick:
                if len([d for d in dots if abs(d[0] - x) < 14 and top - 3 <= d[1] <= bot + 3]) >= 2:
                    found.append({"page": pg, "system": si, "x": x})
    return found


def repeats_check(pieces: dict[str, dict]) -> dict:
    signs = pdf_repeat_signs()
    system_piece: dict[tuple[int, int], set[str]] = {}  # a page can hold the end of one piece and the start of the next
    for pid, p in pieces.items():
        if p.get("in_pdf") and p["status"] != "excluded":
            for b in p["bars"]:
                if "pdf_page" in b:
                    system_piece.setdefault((b["pdf_page"], b["pdf_system"]), set()).add(pid)
    in_pdf = sorted({pid for s in signs for pid in system_piece.get((s["page"], s["system"]), ())})
    in_mxl = sorted(pid for pid, p in pieces.items() if p.get("repeats") and p.get("in_pdf"))
    return {"pdf_repeat_signs": signs, "pieces_with_signs_in_pdf": in_pdf, "pieces_with_repeats_in_mxl": in_mxl,
            "played_with_repeats": sorted(pid for pid, p in pieces.items() if p.get("repeats_taken")),
            "agree": in_pdf == in_mxl}


def ending_check(pieces: dict[str, dict]) -> dict:
    p = pieces["c14"]
    notes = json.loads((TIMED / "c14.json").read_text(encoding="utf-8"))["notes"]
    last_bar = max(b["n"] for b in p["bars"])
    last_off = max(n["t_off"] for n in notes)
    db = cqt()
    level = {}
    for dt in (-2, 0, 1, 2, 5):
        a = int((last_off + dt) * FPS)
        b = a + int(FPS)
        if b < db.shape[1]:
            level[f"{dt:+d}s"] = round(float(db[:, a:b].max(axis=0).mean()), 1)
    return {"bars": p["n_bars"], "last_bar": last_bar, "last_note_off_s": round(last_off, 2),
            "last_bar_starts_s": next(b["t"] for b in p["bars"] if b["n"] == last_bar),
            "recording_s": round(db.shape[1] / FPS, 1), "level_db_around_last_note_off": level}


def main() -> None:
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    ids = [pid for pid, p in sorted(pieces.items(), key=lambda kv: kv[1]["order"]) if p["status"] != "excluded"]
    out = {"alignment": alignment_check(ids), "repeats": repeats_check(pieces), "ending": ending_check(pieces)}
    (WORK / "consistency.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    a = out["alignment"]["all"]
    print(f"pitch audible at the aligned time: {a['aligned']:.1%} of {a['notes']} notes; "
          f"with every note moved by {SHIFT_S} s: {a['shifted']:.1%}")
    r = out["repeats"]
    print(f"repeat signs in the PDF: {r['pieces_with_signs_in_pdf']}, in the MXL: {r['pieces_with_repeats_in_mxl']}, "
          f"played with repeats: {r['played_with_repeats']}, agree: {r['agree']}")
    print("end of Contrapunctus XIV:", out["ending"])


if __name__ == "__main__":
    main()
