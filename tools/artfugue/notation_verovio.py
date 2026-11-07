"""Notation source 2 (T4.4.1): Verovio's engraving of the MXL, in the same data format as the PDF source.

Needs ``python -m artfugue.notation_mxl`` and ``node web/scripts/notation-verovio.mjs`` first (see that script). This
step pairs every notehead Verovio drew with the notes of the shipped chunk, by onset tick and pitch (a tied
continuation, which has no onset of its own, goes to the note that is sounding at the start of its bar) and writes
``web/static/data/notation-verovio/<id>.json`` plus one SVG per piece (the systems are crops of it).

Run:  python -m artfugue.notation_verovio
"""

from __future__ import annotations

import json
import shutil

from .export import DATA, SCORE, TIMED, shipped_order
from .paths import WORK

SRC = WORK / "notation"
OUT = DATA / "notation-verovio"
UNIT = 180.0  # one staff space in Verovio's drawing units
CREDIT = (
    "Score engraved with Verovio (LGPL-3.0) from the OpenScore transcription of The Art of Fugue (CC0), "
    "pitches corrected against the Contrapunctus Press reference score (CC BY-NC-SA 4.0)"
)


def build_piece(piece: dict, written: list[dict], timed: dict, vrv: dict) -> tuple[dict, dict]:
    shipped = shipped_order(timed["notes"])
    positions: dict[str, list[int]] = {}
    for i, n in enumerate(shipped):
        positions.setdefault(n.get("src", n["id"]), []).append(i)
    bar_on = {b["n"]: b["on"] for b in piece["bars"]}
    sounding = [n for n in written if "grace" not in n.get("flags", [])]
    by_key: dict[tuple[int, int], list[dict]] = {}
    for n in sounding:
        by_key.setdefault((n["on"], n["pitch"]), []).append(n)
    used: dict[tuple[int, int], int] = {}

    stats = {"heads": 0, "matched": 0, "tail": 0}
    shown: set[str] = set()
    systems = []
    for s in vrv["systems"]:
        heads = []
        for h in sorted(s["heads"], key=lambda h: (h["x"], h["y"])):
            stats["heads"] += 1
            notes: list[dict] = []
            if h["on"] is not None:
                pool = by_key.get((h["on"], h["pitch"]), [])
                if pool:
                    k = used.get((h["on"], h["pitch"]), 0)
                    notes = [pool[min(k, len(pool) - 1)]]
                    used[(h["on"], h["pitch"])] = k + 1
                else:  # a tied continuation: the note of that pitch that is already sounding
                    notes = [n for n in sounding if n["pitch"] == h["pitch"] and n["on"] < h["on"] < n["on"] + n["dur"]][:1]
                    stats["tail"] += bool(notes)
            else:  # no onset: a tied continuation, which starts at a barline
                bar = next((b["n"] for b in s["bars"] if b["x0"] - 1 <= h["x"] <= b["x1"]), None)
                if bar is not None and bar in bar_on:
                    t = bar_on[bar]
                    notes = [n for n in sounding if n["pitch"] == h["pitch"] and n["on"] < t < n["on"] + n["dur"]][:1]
                    stats["tail"] += bool(notes)
            ids = [n["id"] for n in notes]
            shown.update(ids)
            idx = sorted({p for i in ids for p in positions.get(i, [])})
            stats["matched"] += bool(idx)
            heads.append([round(h["x"] + 0.59 * UNIT, 1), round(h["y"], 1), 0, *idx])
        systems.append({
            "page": 0,
            "svg": vrv["svg"],
            "size": vrv["size"],
            "crop": [round(v, 1) for v in s["crop"]],
            "bars": s["bars"],
            "heads": heads,
        })
    stats["notes"] = len(sounding)
    stats["notes_shown"] = sum(1 for n in sounding if n["id"] in shown)
    doc = {"version": 1, "piece": piece["id"], "source": "verovio", "credit": CREDIT, "unit": UNIT, "systems": systems}
    return doc, stats


def main() -> None:
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    OUT.mkdir(parents=True, exist_ok=True)
    for f in sorted(SRC.glob("*.verovio.json")):
        pid = f.name.split(".")[0]
        written = json.loads((SCORE / "notes" / f"{pid}.json").read_text(encoding="utf-8"))["notes"]
        timed = json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))
        doc, st = build_piece(pieces[pid], written, timed, json.loads(f.read_text(encoding="utf-8")))
        (OUT / f"{pid}.json").write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
        shutil.copyfile(SRC / "verovio" / f"{pid}.svg", OUT / f"{pid}.svg")
        print(f"{pid}: {len(doc['systems'])} systems, {st['matched']}/{st['heads']} heads matched "
              f"({st['tail']} tied continuations), {st['notes_shown']}/{st['notes']} notes shown")


if __name__ == "__main__":
    main()
