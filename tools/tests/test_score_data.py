"""Sanity tests for the score data pipeline (T1.2.6)."""

import json

from artfugue import pieces as P
from artfugue.paths import WORK
from artfugue.validate import validate

SCORE = WORK / "score"
SNAPSHOT = json.loads((__import__("pathlib").Path(__file__).parent / "note_counts.json").read_text())


def test_mxl_basics(score):
    assert len(score.measures) == 2303
    assert score.hidden_notes == 49  # invisible print-object="no" notes are skipped
    assert score.part_names[-1] == "Combined"


def test_piece_table_covers_every_measure_once(score):
    assert P.check_table(score) == []


def test_pdf_pieces_all_present(pieces):
    pdf = [p for p in pieces.values() if p["in_pdf"]]
    assert len(pdf) == 20
    assert {p["status"] for p in pdf} == {"ok", "derived"}
    assert sorted(p["id"] for p in pdf if p["status"] == "derived") == ["c12i", "c13r"]


def test_bar_lengths_match_time_signature(pieces):
    """Every bar has the nominal length, except pickups (first) and final chords (last)."""
    for p in pieces.values():
        if p["status"] == "derived":
            continue
        ts = {t["bar"]: t["num"] * 24 * 4 // t["den"] for t in p["time_signatures"]}
        nominal = None
        for i, b in enumerate(p["bars"]):
            nominal = ts.get(b["n"], nominal)
            if b["len"] != nominal:
                assert i == 0 and p["pickup"] or i == len(p["bars"]) - 1, (p["id"], b)


def test_bar_numbers_are_consecutive(pieces):
    for p in pieces.values():
        ns = [b["n"] for b in p["bars"]]
        assert ns == list(range(ns[0], ns[0] + len(ns))), p["id"]
        assert ns[0] == (0 if p["pickup"] else 1)


def test_no_overlapping_same_pitch_in_a_voice(notes, pieces):
    """Ornament-related same-onset duplicates are the only tolerated overlaps (5 known cases)."""
    total = 0
    for pid, p in pieces.items():
        if p["status"] == "excluded":  # early versions with first/second endings: not used
            continue
        last = {}
        for n in notes(pid):
            if "grace" in n.get("flags", []):
                continue
            key = (n["voice"], n["pitch"])
            if key in last and n["on"] < last[key]["on"] + last[key]["dur"]:
                assert n["on"] == last[key]["on"], (pid, n["bar"], key)  # same onset only
                total += 1
            if key not in last or n["on"] + n["dur"] > last[key]["on"] + last[key]["dur"]:
                last[key] = n
    assert total <= 6


def test_note_counts_snapshot(notes, pieces):
    got = {pid: len(notes(pid)) for pid in pieces}
    assert got == SNAPSHOT, "note counts changed: review and update tests/note_counts.json"


def test_combined_part_duplicates_voice_parts(pieces):
    val = json.loads((SCORE / "validation.json").read_text())
    for v in val:
        if v["reduction"] and v["reduction"]["combined_notes"]:
            assert v["reduction"]["jaccard"] >= 0.98, v["id"]


def test_outputs_validate_against_schema(pieces, notes):
    validate("pieces", json.loads((SCORE / "pieces.json").read_text()))
    for pid in pieces:
        validate("notes", json.loads((SCORE / "notes" / f"{pid}.json").read_text()))
        if pieces[pid]["status"] != "excluded":
            validate("events", json.loads((SCORE / "events" / f"{pid}.json").read_text()))


def test_every_note_has_a_bar_and_voice(notes, pieces):
    for pid, p in pieces.items():
        bars = {b["n"] for b in p["bars"]}
        voices = {v["voice"] for v in p["voices"]}
        for n in notes(pid):
            assert n["bar"] in bars and n["voice"] in voices


def test_bars_know_their_pdf_page(pieces):
    for pid, p in pieces.items():
        if p["in_pdf"]:
            assert all("pdf_page" in b for b in p["bars"]), pid
    assert pieces["c01"]["bars"][0]["pdf_page"] == 7  # Contrapunctus I starts on PDF page 7


def test_deterministic_output(notes):
    a = json.dumps(notes("c01"), sort_keys=True)
    from artfugue import build_score

    build_score.main()
    assert json.dumps(notes("c01"), sort_keys=True) == a


def test_ties_are_merged(notes):
    # Contrapunctus I opens with a tied note: no two notes of one voice may touch end-to-start on
    # the same pitch without being intentionally repeated (no tie flags remain in the output)
    assert all(not any(f.startswith("tie") for f in n.get("flags", [])) for n in notes("c01"))


def test_unfolded_repeats(pieces, notes):
    k1 = pieces["k1"]
    assert k1["repeats"] == [{"bar": 5, "type": "forward"}, {"bar": 80, "type": "backward"}]
    written, unfolded = notes("k1"), notes("k1", unfolded=True)
    assert len(unfolded) > len(written)
    assert {n["pass"] for n in unfolded} == {1, 2}
    assert [n["on"] for n in unfolded] == sorted(n["on"] for n in unfolded)


def test_derived_mirror_pieces(notes, pieces):
    a, b = notes("c12r"), notes("c12i")
    assert len(a) == len(b)
    axis = pieces["c12i"]["axis_sum"]
    # mirror of the source, with accidentals and a few notes corrected from the engraving
    same = sum(1 for x, y in zip(sorted(axis - n["pitch"] for n in a), sorted(n["pitch"] for n in b)) if x == y)
    assert same / len(a) > 0.7
    for pid in ("c12i", "c13r"):
        assert pieces[pid]["verified"] is True
        assert pieces[pid]["pdf_check"]["bars_failed"] == []
        assert pieces[pid]["pdf_check"]["unresolved"] == []
    # first bar of the PDF's inversus: A4 (half) and D4 (whole), mirror of D3 and A3
    first = [n["pitch"] for n in b if n["bar"] == 1]
    assert 69 in first and 62 in first


def test_bach_motif_exact_pitches():
    from artfugue.annotate import N, detect_bach

    def line(pitches):
        return {1: [N(f"t-{i:04d}", p, i * 24, 24, 1, 1, ()) for i, p in enumerate(pitches)]}

    ev = detect_bach("t", line([70, 69, 72, 71]))
    assert len(ev) == 1 and ev[0]["data"]["form"] == "exact"
    assert detect_bach("t", line([69, 68, 71, 70]))[0]["data"]["form"] == "transposed"
    assert detect_bach("t", line([60, 62, 64, 65])) == []


def test_bach_motif_in_xiv_third_subject():
    ev = json.loads((SCORE / "events" / "c14.json").read_text())["events"]
    exact = [e for e in ev if e["type"] == "bach" and e["data"]["form"] == "exact"]
    assert exact and exact[0]["bar"] == 193  # where the MXL labels the third exposition (XIXc)


def test_fugue_I_exposition_order(pieces):
    ev = json.loads((SCORE / "events" / "c01.json").read_text())["events"]
    s1 = [(e["bar"], e["voice"]) for e in ev
          if e["type"] == "subject-entry" and e["data"]["theme"] == "S1"][:4]
    assert s1 == [(1, 2), (5, 1), (9, 4), (13, 3)]  # alto, soprano, bass, tenor
