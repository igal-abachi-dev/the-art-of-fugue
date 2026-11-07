"""An MXL that agrees with the PDF: the OpenScore MXL with the PDF's pitches, plus the two pieces it lacks.

Reads the CC0 OpenScore MXL (data/raw) and writes ``data/derived/art-of-fugue.pdf-checked.mxl``:

1. **Corrections.** Every pitch change the PDF audit made (``pdf_corrections.json``: the 84 automatic ones within
   three semitones and the hand-confirmed ones of ``data/pdf_overrides.json``) is applied to the MusicXML itself, in
   the single-voice part the note belongs to and in the combined part, following the tie chain forward. The changed
   note gets an explicit accidental sign.
2. **The two missing pieces.** Contrapunctus XII Inversus and XIII (rectus) are in the PDF but not in the MXL. They are
   appended as measures 2303 onward, in all five parts: the structure (rhythm, beams, ties, ornaments) is the
   mirror partner's, the parts are exchanged as the voices are (highest becomes lowest), and every pitch is spelled
   as the PDF engraves it (letter, octave and accidental read from the notehead; a tied continuation keeps its
   partner's pitch). The key signature is the PDF's.
3. **Check.** The result is parsed with the same reader the pipeline uses and every piece's notes are compared with
   the pipeline's note data (which passed the PDF audit): onset, pitch, length and voice, note for note.

What "agrees with the PDF" means here: the pitch of every notehead, bar by bar (``audit_pdf.py``), 13 bars of the 3,000
or so excepted and listed in ``docs/mxl-pdf-check.md``. Rhythm, ties, ornaments and layout are not compared with the PDF.

Run:  python -m artfugue.mxl_checked
"""

from __future__ import annotations

import copy
import json
import zipfile

from lxml import etree

from . import pieces as P
from .audit_pdf import layout_of
from .build_score import build_piece
from .mxl import load_root
from .notation_mxl import (
    ACCIDENTAL,
    carried_attributes,
    ensure_attributes,
    midi_of,
    note_starts,
    respell,
)
from .paths import MXL, ROOT, WORK
from .score import parse_score

SCORE = WORK / "score"
OUT = ROOT / "data" / "derived"
OUT_MXL = OUT / "art-of-fugue.pdf-checked.mxl"
REPORT = WORK / "mxl_checked.json"
LETTERS = "CDEFGAB"
STRIP_ATTRS = ("default-x", "default-y", "relative-x", "relative-y")


# ---------------------------------------------------------------- corrections

def measure_length(measure: etree._Element) -> int:
    cursor = top = 0
    for el in measure:
        if el.tag == "note" and el.find("chord") is None and el.find("grace") is None:
            cursor += int(el.findtext("duration") or 0)
        elif el.tag == "backup":
            cursor -= int(el.findtext("duration"))
        elif el.tag == "forward":
            cursor += int(el.findtext("duration"))
        top = max(top, cursor)
    return top


def find_note(measure: etree._Element, start: int, midi: int, tie_stop: bool | None = None, voice=None):
    for s, note in note_starts(measure):
        pitch = note.find("pitch")
        if pitch is None or s != start or midi_of(pitch) != midi:
            continue
        if tie_stop is not None and any(t.get("type") == "stop" for t in note.findall("tie")) != tie_stop:
            continue
        if voice is not None and note.findtext("voice") != voice:
            continue
        return note
    return None


def set_pitch_like(note: etree._Element, source_pitch: etree._Element, accidental: str | None) -> None:
    old = note.find("pitch")
    new = copy.deepcopy(source_pitch)
    old.getparent().replace(old, new)
    for acc in note.findall("accidental"):
        note.remove(acc)
    if accidental:
        acc = etree.Element("accidental")
        acc.text = accidental
        anchor = None
        for tag in ("type", "dot", "voice", "duration"):
            found = note.findall(tag)
            if found:
                anchor = found[-1]
                break
        anchor.addnext(acc)


def correct_chain(measures: list[etree._Element], mi: int, start: int, old: int, new: int,
                  first_only: bool) -> int:
    """Change every note of pitch ``old`` starting at ``start`` in measure ``mi`` to ``new`` and follow ties."""
    changed = 0
    m = measures[mi]
    candidates = [n for s, n in note_starts(m) if s == start and n.find("pitch") is not None
                  and midi_of(n.find("pitch")) == old and not any(t.get("type") == "stop" for t in n.findall("tie"))]
    for note in candidates[:1] if first_only else candidates:
        voice, staff = note.findtext("voice"), note.findtext("staff")
        pos, cur_mi = start, mi
        cur = note
        # the note itself (this respells it and adds the accidental)
        step, alter, octave = respell(cur.find("pitch"), new)
        pitch = cur.find("pitch")
        pitch.find("step").text = step
        al = pitch.find("alter")
        if alter:
            if al is None:
                al = etree.Element("alter")
                pitch.insert(1, al)
            al.text = str(alter)
        elif al is not None:
            pitch.remove(al)
        pitch.find("octave").text = str(octave)
        for acc in cur.findall("accidental"):
            cur.remove(acc)
        acc = etree.Element("accidental")
        acc.text = ACCIDENTAL[alter]
        anchor = next((cur.findall(t)[-1] for t in ("type", "dot", "voice", "duration") if cur.findall(t)), None)
        anchor.addnext(acc)
        changed += 1
        new_pitch = cur.find("pitch")
        # follow the tie chain forward
        while any(t.get("type") == "start" for t in cur.findall("tie")):
            dur = int(cur.findtext("duration") or 0)
            pos += dur
            if pos >= measure_length(measures[cur_mi]):
                cur_mi, pos = cur_mi + 1, 0
                if cur_mi >= len(measures):
                    break
            nxt = find_note(measures[cur_mi], pos, old, tie_stop=True, voice=voice)
            if nxt is None or nxt.findtext("staff") != staff:
                break
            set_pitch_like(nxt, new_pitch, None)
            changed += 1
            cur = nxt
    return changed


def apply_corrections(root: etree._Element, corrections: list[dict], notes_by_piece: dict) -> dict:
    parts = [p.findall("measure") for p in root.findall("part")]
    stats = {"corrections": len(corrections), "notes_changed": 0, "not_found": []}
    for c in corrections:
        pd = P.BY_ID[c["piece"]]
        a = pd.mxl[0]
        note = notes_by_piece[c["piece"]][c["id"]]
        has_pickup = parts[4][a].get("implicit") == "yes"
        mi = a + c["bar"] - (0 if has_pickup else 1)
        targets = {note["part"], 5}
        found_any = False
        for part in sorted(targets):
            n = correct_chain(parts[part - 1], mi, c["beat"], c["from"], c["to"], first_only=(part != 5))
            stats["notes_changed"] += n
            found_any = found_any or n > 0 and part == note["part"]
        if not found_any:
            stats["not_found"].append({k: c[k] for k in ("piece", "bar", "beat", "from", "to")})
    return stats


# ---------------------------------------------------------------- merges and splits (data/pdf_overrides.json)

TYPE_OF = {96: ("whole", 0), 144: ("whole", 1), 48: ("half", 0), 72: ("half", 1), 24: ("quarter", 0),
           36: ("quarter", 1), 12: ("eighth", 0), 18: ("eighth", 1), 6: ("16th", 0), 9: ("16th", 1)}


def set_length(note: etree._Element, dur: int) -> None:
    """Give a note a new duration (divisions: 24 to the quarter) and a matching written value."""
    note.find("duration").text = str(dur)
    for tag in ("type", "dot", "beam", "time-modification"):
        for el in note.findall(tag):
            note.remove(el)
    kind, dots = TYPE_OF[dur]
    typ = etree.Element("type")
    typ.text = kind
    anchor = next(note.findall(t)[-1] for t in ("voice", "duration") if note.findall(t))
    anchor.addnext(typ)
    for _ in range(dots):
        dot = etree.Element("dot")
        typ.addnext(dot)


def set_pitch(note: etree._Element, midi: int) -> None:
    step, alter, octave = respell(note.find("pitch"), midi)
    pitch = note.find("pitch")
    pitch.find("step").text = step
    al = pitch.find("alter")
    if alter:
        if al is None:
            al = etree.Element("alter")
            pitch.insert(1, al)
        al.text = str(alter)
    elif al is not None:
        pitch.remove(al)
    pitch.find("octave").text = str(octave)
    for acc in note.findall("accidental"):
        note.remove(acc)
    acc = etree.Element("accidental")
    acc.text = ACCIDENTAL[alter]
    anchor = next(note.findall(t)[-1] for t in ("type", "dot", "voice", "duration") if note.findall(t))
    anchor.addnext(acc)


MARKS = {"trill": ("trill-mark", "wavy-line"), "mordent": ("mordent",), "inverted-mordent": ("inverted-mordent",),
         "turn": ("turn", "delayed-turn"), "inverted-turn": ("inverted-turn",), "staccato": ("staccato",),
         "fermata": ("fermata",)}


def strip_marks(measure: etree._Element, flags: list[str]) -> int:
    removed = 0
    for note in measure.findall("note"):
        for flag in flags:
            for tag in MARKS[flag]:
                for el in list(note.iter(tag)):
                    el.getparent().remove(el)
                    removed += 1
        for tag in ("ornaments", "articulations", "notations"):
            for el in list(note.iter(tag)):
                if len(el) == 0:
                    el.getparent().remove(el)
    return removed


def add_mark(note: etree._Element, flag: str) -> None:
    notations = note.find("notations")
    if notations is None:
        notations = etree.SubElement(note, "notations")
    ornaments = notations.find("ornaments")
    if ornaments is None:
        ornaments = etree.SubElement(notations, "ornaments")
    etree.SubElement(ornaments, MARKS[flag][0])


def apply_edits(root: etree._Element, edits: list[dict], ranges: dict[str, tuple[int, int]] | None = None) -> dict:
    """The merges, splits and mark changes of the override file, in the single-voice parts and in the combined part."""
    parts = [p.findall("measure") for p in root.findall("part")]
    stats = {"edits": len(edits), "applied": 0, "not_found": []}
    for e in edits:
        pd = P.BY_ID[e["piece"]]
        a, b = (ranges or {}).get(e["piece"]) or pd.mxl
        if e["op"] == "clear_flags":
            first = 0 if parts[4][a].get("implicit") == "yes" else 1
            for part in range(1, 6):
                for i, m in enumerate(parts[part - 1][a : b + 1]):
                    if e["bars"] is None or first + i in e["bars"]:
                        strip_marks(m, e["flags"])
            stats["applied"] += 1
            continue
        mi = a + e["bar"] - (0 if parts[4][a].get("implicit") == "yes" else 1)
        for part in sorted({e["part"], 5}):
            measure = parts[part - 1][mi]
            if e["op"] == "add_flag":
                note = find_note(measure, e["beat"], e["pitch"])
                if note is None:
                    stats["not_found"].append({"piece": e["piece"], "bar": e["bar"], "part": part})
                    continue
                add_mark(note, e["flag"])
            elif e["op"] == "merge":
                found = [find_note(measure, b, p) for b, p in zip(e["beats"], e["pitches"], strict=True)]
                if None in found:
                    stats["not_found"].append({"piece": e["piece"], "bar": e["bar"], "part": part})
                    continue
                set_pitch(found[0], e["to"])
                set_length(found[0], e["dur"])
                for n in found[1:]:
                    n.getparent().remove(n)
            else:  # split
                base = find_note(measure, e["beat"], e["pitch"])
                if base is None or base.find("chord") is not None:
                    stats["not_found"].append({"piece": e["piece"], "bar": e["bar"], "part": part})
                    continue
                template = copy.deepcopy(base)
                set_length(base, e["dur"])
                prev = base
                for add in e["add"]:
                    new = copy.deepcopy(template)
                    for el in new.findall("tie") + new.findall("notations"):
                        new.remove(el)
                    set_pitch(new, add["pitch"])
                    set_length(new, add["dur"])
                    prev.addnext(new)
                    prev = new
            stats["applied"] += 1
    return stats


# ---------------------------------------------------------------- the two missing pieces

def fifths_of(key: dict[int, int]) -> int:
    sharps = sum(1 for v in key.values() if v > 0)
    flats = sum(1 for v in key.values() if v < 0)
    if sharps and flats:
        raise ValueError(f"mixed key signature {key}")
    return sharps - flats


def pdf_heads(piece: dict) -> tuple[dict[int, list], int]:
    """The engraved noteheads of a piece by printed bar, and the key signature of its first system (fifths)."""
    from . import pdfnotes

    cache: dict[int, list] = {}
    by_bar: dict[int, list] = {}
    fifths = None
    bars = {b["n"] for b in piece["bars"]}
    for pg, sidx, first in layout_of(piece):
        if pg not in cache:
            cache[pg] = pdfnotes.read_page(pg)
        sn = cache[pg][sidx]
        if fifths is None:
            fifths = fifths_of(sn.key.get(0, {}))
        for h in sn.heads:
            if h.size > 16 and first + h.bar in bars:
                by_bar.setdefault(first + h.bar, []).append(h)
    return by_bar, fifths


def head_for(note: dict, by_bar: dict[int, list], bar_len: int):
    """The engraved notehead that shows ``note``'s pitch (the nearest one in the bar when several do)."""
    cands = [h for h in by_bar.get(note["bar"], []) if h.midi == note["pitch"]]
    if not cands:
        return None
    return min(cands, key=lambda h: abs(h.rel - note["beat"] / max(bar_len, 1)))


def spell(head, like: etree._Element | None) -> tuple[etree._Element, str | None]:
    """A <pitch> element for an engraved notehead, and the accidental to print (None when the PDF prints none)."""
    pitch = etree.Element("pitch")
    etree.SubElement(pitch, "step").text = LETTERS[head.dnum % 7]
    if head.alter:
        etree.SubElement(pitch, "alter").text = str(head.alter)
    etree.SubElement(pitch, "octave").text = str(head.dnum // 7)
    return pitch, (ACCIDENTAL[head.alter] if head.explicit else None)


def build_mirror(root: etree._Element, pd: P.PieceDef, piece: dict, written: list[dict],
                 src_written: list[dict], links: dict[str, str]) -> tuple[list[list[etree._Element]], dict]:
    """The five parts' measures of a derived piece, as lists of elements per part."""
    src_id, axis = pd.derive
    src = P.BY_ID[src_id]
    a, b = src.mxl
    parts = [p.findall("measure") for p in root.findall("part")]
    by_bar, fifths = pdf_heads(piece)
    bar_len = {b["n"]: b["len"] for b in piece["bars"]}
    dst_note = {n["id"]: n for n in written}
    voices_used = sorted({n["part"] for n in src_written if n["part"] < 5})
    perm = {p: q for p, q in zip(voices_used, reversed(voices_used), strict=True)}  # high voice <-> low voice
    first_bar = 0 if parts[4][a].get("implicit") == "yes" else 1
    by_key: dict[tuple, list[dict]] = {}
    for n in src_written:
        by_key.setdefault((n["bar"], n["beat"], n["pitch"]), []).append(n)
    stats = {"notes": 0, "from_pdf": 0, "tied": 0, "fallback": 0}
    out: list[list[etree._Element]] = []
    for q in range(1, 6):  # target part q takes the structure of source part sp
        sp = perm.get(q, q) if q < 5 else 5
        measures = [copy.deepcopy(m) for m in parts[sp - 1][a : b + 1]]
        used: set[str] = set()  # each part is a copy of the notes: pair them once per part
        ties: dict[tuple, etree._Element] = {}
        for i, m in enumerate(measures):
            m.set("number", str(first_bar + i))
            m.attrib.pop("width", None)
            for el in list(m):
                if el.tag == "print":
                    m.remove(el)
            for el in m.iter():
                for attr in STRIP_ATTRS:
                    el.attrib.pop(attr, None)
            for st in m.iter("stem"):
                st.getparent().remove(st)
            for s, note in note_starts(m):
                pitch = note.find("pitch")
                if pitch is None:
                    continue
                orig = midi_of(pitch)
                key = (first_bar + i, s, orig)
                voice, staff = note.findtext("voice"), note.findtext("staff")
                tie_stop = any(t.get("type") == "stop" for t in note.findall("tie"))
                tie_start = any(t.get("type") == "start" for t in note.findall("tie"))
                new_pitch, accidental = None, None
                if tie_stop and (voice, staff, orig) in ties:
                    new_pitch, accidental = ties.pop((voice, staff, orig)), None
                    stats["tied"] += 1
                else:
                    cands = [n for n in by_key.get(key, []) if n["id"] not in used
                             and (sp == 5 or n["part"] == sp)]
                    head = None
                    if cands:
                        used.add(cands[0]["id"])
                        dst = dst_note.get(links.get(cands[0]["id"], ""))
                        head = head_for(dst, by_bar, bar_len[dst["bar"]]) if dst else None
                    if head is not None:
                        new_pitch, accidental = spell(head, pitch)
                        stats["from_pdf"] += 1
                        if q == 5:
                            note.find("staff").text = str(head.staff + 1)
                    else:  # a grace note or an ornament's helper: mirror the pitch, spell it near the old one
                        step, alter, octave = respell(pitch, axis - orig)
                        new_pitch = etree.Element("pitch")
                        etree.SubElement(new_pitch, "step").text = step
                        if alter:
                            etree.SubElement(new_pitch, "alter").text = str(alter)
                        etree.SubElement(new_pitch, "octave").text = str(octave)
                        accidental = ACCIDENTAL[alter] if alter else None
                        stats["fallback"] += 1
                stats["notes"] += 1
                set_pitch_like(note, new_pitch, accidental)
                if tie_start:
                    ties[(voice, staff, orig)] = copy.deepcopy(note.find("pitch"))
        # attributes of the first measure: this part's own clefs, the PDF's key
        for att in measures[0].findall("attributes"):
            for tag in ("clef", "key"):
                for el in att.findall(tag):
                    att.remove(el)
        state = carried_attributes(parts[q - 1], a)
        key = etree.Element("key")
        etree.SubElement(key, "fifths").text = str(fifths)
        state["key"] = key
        ensure_attributes(measures[0], state)
        out.append(measures)
    stats["key_fifths"] = fifths
    return out, stats


# ---------------------------------------------------------------- the check

def compare_with_pipeline(score, pd: P.PieceDef, mxl_range: tuple[int, int], notes: list[dict]) -> dict:
    """Notes read back from the new MXL against the pipeline's notes for the same piece."""
    pd2 = P.PieceDef(**{**pd.__dict__, "mxl": mxl_range, "derive": None})
    _rec, got, _val = build_piece(score, pd2, None)

    def key(n):
        return (n["on"], n["pitch"], n["dur"], n["voice"])

    want = sorted(key(n) for n in notes)
    have = sorted(key(n) for n in got)
    ws, hs = set(want), set(have)
    return {"id": pd.id, "want": len(want), "have": len(have), "identical": want == have,
            "only_in_pipeline": len(ws - hs), "only_in_mxl": len(hs - ws)}


def main() -> None:
    root = load_root()
    corr = json.loads((SCORE / "pdf_corrections.json").read_text(encoding="utf-8"))["corrections"]
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    written = {pid: json.loads((SCORE / "notes" / f"{pid}.json").read_text(encoding="utf-8"))["notes"]
               for pid in pieces}
    notes_by_piece = {pid: {n["id"]: n for n in ns} for pid, ns in written.items()}
    report: dict = {}

    report["corrections"] = apply_corrections(root, corr, notes_by_piece)
    print("corrections:", {k: v if k != "not_found" else len(v) for k, v in report["corrections"].items()})
    edits = json.loads((SCORE / "pdf_corrections.json").read_text(encoding="utf-8")).get("edits", [])
    derived = {pd.id for pd in P.PIECES if pd.derive}
    report["edits"] = apply_edits(root, [e for e in edits if e["piece"] not in derived])
    print("merges and splits:", report["edits"])

    links = {}  # derived piece id -> {source note id: derived note id}
    for pair in json.loads((SCORE / "mirror_links.json").read_text(encoding="utf-8"))["pairs"]:
        links[pair["b"]] = {src: dst for src, dst in pair["links"]}
    parts = root.findall("part")
    n_before = len(parts[0].findall("measure"))
    appended: dict[str, tuple[int, int]] = {}
    report["mirror"] = {}
    for pd in P.PIECES:
        if not pd.derive:
            continue
        measures, stats = build_mirror(root, pd, pieces[pd.id], written[pd.id], written[pd.derive[0]], links[pd.id])
        start = len(parts[0].findall("measure"))
        for part, ms in zip(parts, measures, strict=True):
            for m in ms:
                part.append(m)
        appended[pd.id] = (start, start + len(measures[0]) - 1)
        report["mirror"][pd.id] = {**stats, "measures": appended[pd.id]}
        print(pd.id, "appended", appended[pd.id], stats)
    assert n_before == 2303

    # the overrides of the two built pieces apply to the measures just appended
    later = apply_edits(root, [e for e in edits if e["piece"] in derived], appended)
    report["edits"]["edits"] += later["edits"]
    report["edits"]["applied"] += later["applied"]
    report["edits"]["not_found"] += later["not_found"]
    xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
    OUT.mkdir(parents=True, exist_ok=True)
    name = "art-of-fugue.pdf-checked.xml"
    container = (b'<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles>'
                 b'<rootfile full-path="' + name.encode() + b'"/></rootfiles></container>\n')
    with zipfile.ZipFile(OUT_MXL, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/container.xml", container)
        z.writestr(name, xml)
    print(f"wrote {OUT_MXL} ({OUT_MXL.stat().st_size / 1e6:.1f} MB)")

    # read it back with the pipeline's own reader and compare piece by piece
    score = parse_score(load_root(OUT_MXL))
    checks = []
    for pd in P.PIECES:
        if not pd.in_pdf:
            continue
        rng = pd.mxl or appended[pd.id]
        checks.append(compare_with_pipeline(score, pd, rng, written[pd.id]))
    report["check"] = checks
    bad = [c for c in checks if not c["identical"]]
    print(f"{len(checks) - len(bad)} of {len(checks)} pieces read back identical to the pipeline's notes")
    for c in bad:
        print("  differs:", c)
    report["source"] = str(MXL.name)
    REPORT.write_text(json.dumps(report, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
