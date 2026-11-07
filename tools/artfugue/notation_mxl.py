"""Second notation source (T4.4.1): the PDF-checked MXL cut into one MusicXML per piece, for Verovio.

``mxl_checked.py`` writes ``data/derived/art-of-fugue.pdf-checked.mxl``: the OpenScore MXL with the PDF's pitches and
the two pieces it lacks (XII inversus, XIII). Next to the four single-voice parts it has a fifth "Combined" part: the
keyboard reduction on two staves. This module cuts that part into one MusicXML file per piece
(``data/work/notation/<id>.musicxml``), which ``web/scripts/notation-verovio.mjs`` engraves with Verovio into a
static SVG. Layout hints are dropped and the measures are renumbered with the printed bar numbers of the PDF (the
same numbers as ``bar`` in the note data).

Run:  python -m artfugue.notation_mxl
"""

from __future__ import annotations

import copy
import json

from lxml import etree

from . import pieces as P
from .mxl import load_root
from .paths import WORK

OUT = WORK / "notation"
SCORE = WORK / "score"

STEPS = ["C", "D", "E", "F", "G", "A", "B"]
BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACCIDENTAL = {-1: "flat", 0: "natural", 1: "sharp"}


def midi_of(pitch: etree._Element) -> int:
    alter = pitch.findtext("alter")
    return 12 * (int(pitch.findtext("octave")) + 1) + BASE[pitch.findtext("step")] + (
        int(float(alter)) if alter else 0
    )


def respell(old: etree._Element, new_midi: int) -> tuple[str, int, int]:
    """(step, alter, octave) for ``new_midi`` near the old spelling: same letter if possible, else the next one."""
    old_i = STEPS.index(old.findtext("step"))
    best = None
    for di in (0, 1, -1, 2, -2, 3, -3):
        step = STEPS[(old_i + di) % 7]
        for alter in (0, -1, 1):
            octave, rem = divmod(new_midi - alter - BASE[step], 12)
            if rem == 0:
                cand = (abs(di), abs(alter))
                if best is None or cand < best[0]:
                    best = (cand, (step, alter, octave - 1))
    assert best is not None
    return best[1]


def note_starts(measure: etree._Element):
    """Yield (start in divisions, note element) for the notes of one measure."""
    cursor = 0
    last = 0
    for el in measure:
        if el.tag == "note":
            if el.find("chord") is not None:
                start = last
            else:
                start = cursor
                last = start
                if el.find("grace") is None:
                    cursor += int(el.findtext("duration") or 0)
            yield start, el
        elif el.tag == "backup":
            cursor -= int(el.findtext("duration"))
        elif el.tag == "forward":
            cursor += int(el.findtext("duration"))


def carried_attributes(measures: list[etree._Element], upto: int) -> dict:
    """The attributes in force at measure ``upto`` (divisions, key, time, staves, clefs by staff), from earlier bars."""
    state: dict = {"clef": {}}
    for m in measures[: upto + 1]:
        for att in m.findall("attributes"):
            for tag in ("divisions", "key", "time", "staves"):
                el = att.find(tag)
                if el is not None:
                    state[tag] = copy.deepcopy(el)
            for clef in att.findall("clef"):
                state["clef"][clef.get("number", "1")] = copy.deepcopy(clef)
    return state


def ensure_attributes(first: etree._Element, state: dict) -> list[str]:
    """Add to the first measure of a slice whatever the slice would otherwise lack; returns what was added."""
    att = first.find("attributes")
    if att is None:
        att = etree.Element("attributes")
        first.insert(0, att)
    added = [tag for tag in ("divisions", "key", "time", "staves") if tag in state and att.find(tag) is None]
    clefs_have = {c.get("number", "1") for c in att.findall("clef")}
    clefs_add = [n for n in sorted(state["clef"]) if n not in clefs_have]
    added += [f"clef {n}" for n in clefs_add]
    # MusicXML order: divisions, key, time, staves, then the clefs
    order = ["divisions", "key", "time", "staves"]
    existing = {t: att.find(t) for t in order}
    old_clefs = att.findall("clef")
    rest = [el for el in att if el.tag not in order and el.tag != "clef"]
    for el in list(att):
        att.remove(el)
    for t in order:
        el = existing[t] if existing[t] is not None else state.get(t)
        if el is not None:
            att.append(copy.deepcopy(el))
    for n in sorted({c.get("number", "1") for c in old_clefs} | set(clefs_add)):
        found = [c for c in old_clefs if c.get("number", "1") == n]
        att.append(copy.deepcopy(found[0] if found else state["clef"][n]))
    for el in rest:
        att.append(el)
    return added


def build_piece(root: etree._Element, pd: P.PieceDef, mxl_range: tuple[int, int]) -> tuple[bytes, dict]:
    a, b = mxl_range
    part5 = root.findall("part")[4]
    measures = part5.findall("measure")[a : b + 1]
    has_pickup = measures[0].get("implicit") == "yes"
    first_bar = 0 if has_pickup else 1

    out = etree.Element("score-partwise", version="3.1")
    work = etree.SubElement(out, "work")
    etree.SubElement(work, "work-title").text = pd.pdf_title
    plist = etree.SubElement(out, "part-list")
    sp = etree.SubElement(plist, "score-part", id="P1")
    etree.SubElement(sp, "part-name").text = ""
    part = etree.SubElement(out, "part", id="P1")

    carried = ensure_attributes(measures[0], carried_attributes(part5.findall("measure"), a))
    ms = []
    for i, m in enumerate(measures):
        m2 = copy.deepcopy(m)
        m2.set("number", str(first_bar + i))
        for attr in ("width", "text"):
            m2.attrib.pop(attr, None)
        for el in list(m2):
            if el.tag == "print":
                m2.remove(el)
        for el in m2.iter():
            for attr in ("default-x", "default-y", "relative-x", "relative-y"):
                el.attrib.pop(attr, None)
        part.append(m2)
        ms.append(m2)

    info = {"id": pd.id, "bars": len(ms), "carried_attributes": carried}
    return etree.tostring(out, xml_declaration=True, encoding="UTF-8", pretty_print=False), info


def main() -> None:
    from .mxl_checked import OUT_MXL, REPORT

    if not OUT_MXL.exists():
        raise SystemExit("run python -m artfugue.mxl_checked first")
    root = load_root(OUT_MXL)
    appended = {k: tuple(v["measures"]) for k, v in json.loads(REPORT.read_text(encoding="utf-8"))["mirror"].items()}
    OUT.mkdir(parents=True, exist_ok=True)
    report = []
    for pd in P.PIECES:
        if not pd.in_pdf:
            continue
        data, info = build_piece(root, pd, pd.mxl or appended[pd.id])
        (OUT / f"{pd.id}.musicxml").write_bytes(data)
        report.append(info)
        print(f"{pd.id}: {info['bars']} bars")
    (OUT / "build.json").write_text(json.dumps(report, indent=1), encoding="utf8")


if __name__ == "__main__":
    main()
