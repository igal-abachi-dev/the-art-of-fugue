"""Ask the recording which of two pitches a disputed note has (used to settle MXL-versus-PDF differences).

For a note with aligned times (t_on, t_off) the semitone CQT of the recording (cqt.py) is averaged over the first
0.6 s of the note and the level at each candidate pitch is read at its fundamental and at two partials (octave,
octave + fifth), which a piano has: the lower the note, the more the partials carry it. The difference of the two
scores in dB says which pitch is more present at that moment. Not a transcription: a polyphonic texture can hold
either pitch in another voice, so a small difference means "the recording does not decide".

Run:  python -m artfugue.audio_check            (writes data/work/audio_check.json, prints the summary)
"""

from __future__ import annotations

import json

import numpy as np

from .cqt import FPS, LOWEST_MIDI, semitone_cqt
from .paths import WORK

SCORE = WORK / "score"
TIMED = WORK / "timed"
WINDOW_S = 0.6
SKIP_S = 0.03  # past the attack's broadband smear
DECIDES_DB = 3.0

_cqt: np.ndarray | None = None


def cqt() -> np.ndarray:
    global _cqt
    if _cqt is None:
        _cqt = semitone_cqt().astype(np.float32)
    return _cqt


def level(p: int, a: int, b: int) -> float:
    """Mean level (dB) of the rows of pitch ``p``: fundamental, octave and octave+fifth, over frames a..b."""
    db = cqt()
    total, n = 0.0, 0
    for k, w in ((0, 1.0), (12, 0.7), (19, 0.5)):
        row = p + k - LOWEST_MIDI
        if 0 <= row < db.shape[0]:
            total += w * float(db[row, a:b].mean())
            n += 1
    return total / max(n, 1)


def window(t_on: float, t_off: float) -> tuple[int, int]:
    a = int((t_on + SKIP_S) * FPS)
    b = int(min(t_off, t_on + WINDOW_S) * FPS)
    return a, max(b, a + 1)


def compare(t_on: float, t_off: float, p_pdf: int, p_mxl: int) -> float:
    """Level of the PDF's pitch minus level of the MXL's pitch (dB): positive = the recording supports the PDF."""
    a, b = window(t_on, t_off)
    return level(p_pdf, a, b) - level(p_mxl, a, b)


def verdict(delta: float) -> str:
    return "pdf" if delta > DECIDES_DB else "mxl" if delta < -DECIDES_DB else "undecided"


def main() -> None:
    corr = json.loads((SCORE / "pdf_corrections.json").read_text(encoding="utf-8"))
    timed: dict[str, dict] = {}

    def note(pid: str, nid: str) -> dict:
        if pid not in timed:
            doc = json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))
            index: dict[str, dict] = {}
            for n in doc["notes"]:  # an unfolded canon plays a note twice: keep the first pass
                index.setdefault(n.get("src", n["id"]), n)
            timed[pid] = index
        return timed[pid][nid]

    # 1. the 84 corrections: the PDF was taken as right; does the recording agree?
    rows = []
    for c in corr["corrections"]:
        n = note(c["piece"], c["id"])
        d = compare(n["t_on"], n["t_off"], c["to"], c["from"])
        rows.append({"piece": c["piece"], "bar": c["bar"], "from": c["from"], "to": c["to"],
                     "delta_db": round(d, 1), "verdict": verdict(d)})
    count = {k: sum(r["verdict"] == k for r in rows) for k in ("pdf", "mxl", "undecided")}

    # 2. the bars that still disagree by more than the correction allows
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    left = []
    for s in corr["still_differing"]:
        pid = s["piece"]
        doc = json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))
        bar = next(b for b in pieces[pid]["bars"] if b["n"] == s["bar"])
        in_bar = [n for n in doc["notes"] if n["bar"] == s["bar"] and "grace" not in n.get("flags", [])]
        item = {"piece": pid, "bar": s["bar"], "pdf_page": bar["pdf_page"], "mxl_only": s["mxl_not_in_pdf"],
                "pdf_only": s["pdf_not_in_mxl"], "notes": []}
        for p in sorted(set(s["mxl_not_in_pdf"])):
            for n in (x for x in in_bar if x["pitch"] == p):
                scores = {q: round(compare(n["t_on"], n["t_off"], q, p), 1) for q in s["pdf_not_in_mxl"]}
                item["notes"].append({"mxl_pitch": p, "t_on": n["t_on"], "vs_pdf_pitch_db": scores})
        left.append(item)
    out = {"corrections": rows, "corrections_summary": count, "still_differing": left}
    (WORK / "audio_check.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(rows)} corrections: the recording supports the PDF's pitch in {count['pdf']}, the MXL's in {count['mxl']}, "
          f"does not decide in {count['undecided']}")
    for item in left:
        print(item["piece"], item["bar"], "mxl", item["mxl_only"], "pdf", item["pdf_only"],
              [(n["mxl_pitch"], n["vs_pdf_pitch_db"]) for n in item["notes"]])


if __name__ == "__main__":
    main()
