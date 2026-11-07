"""Parse the MusicXML score into absolute-time notes.

Why a custom lxml parser instead of music21: the file is 24 MB, music21 is slow on it and hides
the details this project needs to control (hidden notes, the redundant 5th part, <backup>/<forward>
timing, implicit measures). All times are in MusicXML ``divisions``; ``DIV`` = divisions per quarter.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from lxml import etree

from .mxl import load_root

DIV = 24  # divisions per quarter note (constant in this file, asserted below)

_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ORNAMENTS = {
    "trill-mark": "trill",
    "mordent": "mordent",
    "inverted-mordent": "inverted-mordent",
    "turn": "turn",
    "inverted-turn": "inverted-turn",
}


@dataclass
class RawNote:
    part: int  # 1-based MusicXML part index (1..5)
    measure: int  # 0-based index into the measure list (same for all parts)
    voice: str  # MusicXML <voice> value
    staff: int | None
    pitch: int  # MIDI number
    start: int  # divisions from the start of the measure
    dur: int  # divisions (0 for grace notes)
    grace: bool = False
    tie_start: bool = False
    tie_stop: bool = False
    ornaments: list[str] = field(default_factory=list)
    fermata: bool = False
    staccato: bool = False
    # filled in later
    abs_start: int = 0  # divisions from the start of the whole score


@dataclass
class Measure:
    index: int
    number: str  # MusicXML number attribute, e.g. "17" or "X1"
    implicit: bool
    start: int = 0  # absolute divisions
    length: int = 0  # divisions
    time: tuple[int, int] | None = None  # only set where it changes
    key: int | None = None
    tempo: float | None = None  # quarter-note BPM where it changes
    words: list[str] = field(default_factory=list)
    final_barline: bool = False  # light-heavy right barline
    repeat_forward: bool = False
    repeat_backward: bool = False
    ending: str | None = None


@dataclass
class Score:
    measures: list[Measure]
    notes: list[RawNote]
    part_names: list[str]
    hidden_notes: int = 0


def _midi(pitch: etree._Element) -> int:
    step = pitch.findtext("step")
    alter = int(float(pitch.findtext("alter") or 0))
    return 12 * (int(pitch.findtext("octave")) + 1) + _STEP[step] + alter


def _text(e: etree._Element) -> str:
    return "".join(e.itertext()).strip()


def _quarter_bpm(sound_tempo: float, metronome: etree._Element | None) -> float:
    """MusicXML <sound tempo> is quarter-note BPM already; keep as is."""
    return sound_tempo


def parse_score(root: etree._Element | None = None) -> Score:
    root = root if root is not None else load_root()
    parts = root.findall("part")
    names = [(p.findtext("part-name") or "").strip() for p in root.find("part-list").findall("score-part")]
    n_measures = len(parts[0].findall("measure"))

    measures = [Measure(index=i, number=m.get("number"), implicit=m.get("implicit") == "yes")
                for i, m in enumerate(parts[0].findall("measure"))]
    notes: list[RawNote] = []
    hidden = 0
    max_cursor = [0] * n_measures  # longest extent per measure over all parts

    for pi, part in enumerate(parts, start=1):
        pms = part.findall("measure")
        assert len(pms) == n_measures, f"part {pi} has {len(pms)} measures, expected {n_measures}"
        for mi, m in enumerate(pms):
            cursor = 0
            last_start = 0
            meas = measures[mi]
            for el in m:
                tag = el.tag
                if tag == "attributes":
                    d = el.findtext("divisions")
                    if d is not None:
                        assert int(d) == DIV, f"unexpected divisions {d}"
                    t = el.find("time")
                    if t is not None and pi == 1:
                        meas.time = (int(t.findtext("beats")), int(t.findtext("beat-type")))
                    k = el.find("key")
                    if k is not None and pi == 1 and k.findtext("fifths") is not None:
                        meas.key = int(k.findtext("fifths"))
                elif tag == "direction" and pi == 1:
                    for w in el.iter("words"):
                        txt = _text(w)
                        if txt and txt not in ("[", "]"):
                            meas.words.append(txt)
                    s = el.find("sound")
                    if s is not None and s.get("tempo"):
                        meas.tempo = float(s.get("tempo"))
                elif tag == "barline" and pi == 1:
                    style = el.findtext("bar-style")
                    rep = el.find("repeat")
                    if el.get("location") == "right" and style == "light-heavy" and rep is None:
                        meas.final_barline = True
                    if rep is not None:
                        if rep.get("direction") == "forward":
                            meas.repeat_forward = True
                        else:
                            meas.repeat_backward = True
                    en = el.find("ending")
                    if en is not None and en.get("type") == "start":
                        meas.ending = en.get("number")
                elif tag == "backup":
                    cursor -= int(el.findtext("duration"))
                elif tag == "forward":
                    cursor += int(el.findtext("duration"))
                    max_cursor[mi] = max(max_cursor[mi], cursor)
                elif tag == "note":
                    is_chord = el.find("chord") is not None
                    is_grace = el.find("grace") is not None
                    dur = int(el.findtext("duration") or 0)
                    start = last_start if is_chord else cursor
                    if not is_chord:
                        last_start = cursor
                    if el.find("rest") is None:
                        if el.get("print-object") == "no":
                            hidden += 1
                        else:
                            n = RawNote(
                                part=pi, measure=mi, voice=el.findtext("voice") or "1",
                                staff=int(el.findtext("staff")) if el.findtext("staff") else None,
                                pitch=_midi(el.find("pitch")), start=start, dur=dur, grace=is_grace,
                            )
                            for tie in el.findall("tie"):
                                if tie.get("type") == "start":
                                    n.tie_start = True
                                elif tie.get("type") == "stop":
                                    n.tie_stop = True
                            for nt in el.findall("notations"):
                                for orn in nt.iter():
                                    if orn.tag in _ORNAMENTS:
                                        n.ornaments.append(_ORNAMENTS[orn.tag])
                                    elif orn.tag == "fermata":
                                        n.fermata = True
                                    elif orn.tag == "staccato":
                                        n.staccato = True
                            notes.append(n)
                    if not is_chord and not is_grace:
                        cursor += dur
                    max_cursor[mi] = max(max_cursor[mi], cursor)
    # measure lengths: longest extent over parts; absolute starts accumulate
    pos = 0
    for mi, meas in enumerate(measures):
        meas.start = pos
        meas.length = max_cursor[mi]
        pos += meas.length
    for n in notes:
        n.abs_start = measures[n.measure].start + n.start
    notes.sort(key=lambda n: (n.abs_start, n.part, n.pitch))
    return Score(measures=measures, notes=notes, part_names=names, hidden_notes=hidden)
