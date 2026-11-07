"""The PDF notehead reader and the MXL-vs-engraving audit."""

import copy
import json
import random

from artfugue.audit_pdf import audit_piece, correct_piece
from artfugue.paths import WORK

SCORE = WORK / "score"


def test_reader_matches_mxl_where_they_agree(pieces, notes):
    """Pieces whose MXL needed no correction at all must read back identically from the PDF."""
    for pid in ("c01", "c13i", "k4"):
        r = audit_piece(pieces[pid], notes(pid))
        assert r["bars_differing"] == 0, (pid, r["problems"][:3])


def test_forward_repeat_sign_is_not_a_barline(pieces, notes):
    """Canon 3 bar 9 starts a system with a forward-repeat sign, drawn as a barline before the first note.
    Counting it shifted bars 9-11 by one (they showed up as 4 differing bars)."""
    r = audit_piece(pieces["k3"], notes("k3"))
    assert r["bars_differing"] == 0, r["problems"][:2]


def test_audit_after_corrections_is_mostly_clean(pieces, notes):
    total = open_bars = 0
    for pid, p in pieces.items():
        if p["status"] != "ok" or not p["in_pdf"]:
            continue
        total += p["n_bars"]
        open_bars += len(audit_piece(p, notes(pid))["problems"])
    assert open_bars <= 20, open_bars  # reviewed list in docs/pdf-audit.md (19 on 2026-11-04)
    assert open_bars / total < 0.015


def test_corrections_recover_perturbed_pitches(pieces, notes):
    """Perturb 2% of the pitches of a clean piece by +/-1 or 2 semitones; most must be restored.

    Errors that sit next to a tied note, or several errors in one bar, can survive (documented in
    docs/pdf-audit.md); the bar is therefore 80%, not 100%."""
    rng = random.Random(1)
    truth = notes("c01")
    noisy = copy.deepcopy(truth)
    changed = {}
    for n in noisy:
        if "grace" not in n.get("flags", []) and rng.random() < 0.02:
            changed[n["id"]] = n["pitch"]
            n["pitch"] += rng.choice([-2, -1, 1, 2])
    _fixes, left = correct_piece(pieces["c01"], noisy)
    back = {n["id"]: n["pitch"] for n in noisy}
    ok = sum(1 for i, p in changed.items() if back[i] == p)
    assert len(changed) > 20
    assert ok / len(changed) > 0.8, (ok, len(changed), left[:3])


def test_corrections_file_is_consistent(pieces):
    doc = json.loads((SCORE / "pdf_corrections.json").read_text(encoding="utf-8"))
    for c in doc["corrections"]:
        # the automatic audit changes a pitch by up to three semitones; a hand-confirmed override (data/pdf_overrides.json,
        # with its evidence) can be larger, up to an octave
        assert 1 <= abs(c["to"] - c["from"]) <= (12 if c.get("source") == "override" else 3)
        assert c["piece"] in pieces
