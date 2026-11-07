"""The piece table: which part of the MXL is which piece of the Art of Fugue.

The mapping was established in T1.1.2/T1.1.3 by comparing the MXL with the Contrapunctus Press PDF
(the source of truth): bar counts per piece, titles, time signatures, repeats and spot checks of the
first bars. It is explicit data (not auto-detected) so it can be reviewed; ``check_table`` asserts
that it still agrees with what is in the file (final barlines and so on).
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

from .score import Score


@dataclass(frozen=True)
class PieceDef:
    id: str
    pdf_title: str  # exactly as engraved in the PDF (None when the PDF has no such piece)
    short: str
    kind: str  # provisional, checked by the annotation work (T1.3.1)
    mxl: tuple[int, int] | None  # inclusive 0-based measure indices; None = missing from the MXL
    in_pdf: bool = True
    subtitle: str | None = None  # traditional title, from general knowledge (not printed in the PDF)
    order: int = 0  # position in the PDF (the recording may differ; see T2.1.2)
    note: str = ""
    # for pieces missing from the MXL: (source piece id, axis sum) -> pitch' = axis_sum - pitch
    derive: tuple[str, int] | None = None


# Order = order in the PDF table of contents.
PIECES: list[PieceDef] = [
    PieceDef("c01", "Contrapunctus I", "I", "simple-fugue", (0, 77), order=1),
    PieceDef("c02", "Contrapunctus II", "II", "simple-fugue", (78, 161), order=2),
    PieceDef("c03", "Contrapunctus III", "III", "simple-fugue", (162, 233), order=3,
             note="subject in inversion (to be confirmed by T1.3.1)"),
    PieceDef("c04", "Contrapunctus IV", "IV", "simple-fugue", (234, 371), order=4,
             note="subject in inversion (to be confirmed by T1.3.1)"),
    PieceDef("c05", "Contrapunctus V", "V", "counter-fugue", (372, 461), order=5),
    PieceDef("c06", "Contrapunctus VI", "VI", "counter-fugue", (462, 540), order=6,
             subtitle="in stylo francese (diminution and inversion)"),
    PieceDef("c07", "Contrapunctus VII", "VII", "counter-fugue", (541, 601), order=7,
             subtitle="per augmentationem et diminutionem"),
    PieceDef("c08", "Contrapunctus VIII", "VIII", "triple-fugue", (602, 789), order=8),
    PieceDef("c09", "Contrapunctus IX", "IX", "double-fugue", (790, 919), order=9,
             subtitle="alla duodecima"),
    PieceDef("c10", "Contrapunctus X", "X", "double-fugue", (920, 1039), order=10,
             subtitle="alla decima"),
    PieceDef("c11", "Contrapunctus XI", "XI", "triple-fugue", (1040, 1223), order=11),
    PieceDef("c12r", "Contrapunctus XII", "XII", "mirror-fugue", (1740, 1795), order=12,
             note="rectus"),
    PieceDef("c12i", "Contrapunctus XII - Inversus", "XII inv.", "mirror-fugue", None, order=13,
             derive=("c12r", 119),
             note="in the PDF but missing from the MXL. DRAFT derived from XII rectus by chromatic "
                  "pitch mirror (pitch' = 119 - pitch); first bar checked against the PDF; "
                  "accidentals NOT verified (T1.3.4)"),
    PieceDef("c13r", "Contrapunctus XIII", "XIII", "mirror-fugue", None, order=14,
             derive=("c13i", 143),
             note="in the PDF but missing from the MXL. DRAFT derived from XIII inversus by "
                  "chromatic pitch mirror (pitch' = 143 - pitch); accidentals NOT verified (T1.3.4)"),
    PieceDef("c13i", "Contrapunctus XIII - Inversus", "XIII inv.", "mirror-fugue", (1596, 1667),
             order=15,
             note="MXL section 'X1': 3 voices, starts with an implicit (pickup) measure. Its first "
                  "bars (pickup A4, then D5 and rising triplets, bass staff empty) match the PDF's "
                  "Inversus, not the PDF's rectus"),
    PieceDef("c14", "Contrapunctus XIV", "XIV", "unfinished-fugue", (1796, 2034), order=16,
             note="the MXL labels the three sections XIXa, XIXb, XIXc"),
    PieceDef("k1", "Canon 1", "Canon 1", "canon", (1224, 1326), order=17,
             subtitle="alla Ottava"),
    PieceDef("k2", "Canon 2", "Canon 2", "canon", (1405, 1486), order=18,
             subtitle="alla Decima, Contrapunto alla Terza",
             note="in the MXL this comes after Canon 3 (swapped)"),
    PieceDef("k3", "Canon 3", "Canon 3", "canon", (1327, 1404), order=19,
             subtitle="alla Duodecima in Contrapunto alla Quinta",
             note="in the MXL this comes before Canon 2 (swapped)"),
    PieceDef("k4", "Canon 4", "Canon 4", "canon", (1487, 1595), order=20,
             subtitle="per Augmentationem in Contrario Motu"),
    # --- in the MXL only; not in the PDF: early versions kept for reference, not shown on the site
    PieceDef("x1", "", "Early canon (aug. in contrary motion)", "canon", (2035, 2101), in_pdf=False,
             order=101,
             note="P1 only; text 'Canon in Hypodiatessaron al rovescio e per augmentationem "
                  "perpetuus'; first/second endings and repeat marks"),
    PieceDef("x2", "", "Early Canon alla Ottava", "canon", (2102, 2204), in_pdf=False, order=102,
             note="P1 only; text 'Canon in Hypodiapason'; 103 bars like Canon 1"),
    PieceDef("x4", "", "XIII inversus, 4-voice version", "mirror-fugue", (1668, 1739), in_pdf=False,
             order=104,
             note="MXL section 'X2': same notes as c13i (86 % identical) plus a 4th voice; looks like "
                  "the two-keyboard version. Not in the PDF (the PDF's XIII Inversus has the empty "
                  "bass staff of the 3-voice version)"),
    PieceDef("x3", "", "'Contrap. a 4' (early version)", "simple-fugue", (2205, 2302), in_pdf=False,
             order=103, note="98 bars; text 'Contrap. a 4'"),
]

BY_ID = {p.id: p for p in PIECES}


def check_table(score: Score) -> list[str]:
    """Return a list of problems (empty if the table agrees with the file)."""
    problems = []
    covered = 0
    for p in PIECES:
        if p.mxl is None:
            continue
        a, b = p.mxl
        covered += b - a + 1
        if not (0 <= a <= b < len(score.measures)):
            problems.append(f"{p.id}: range {p.mxl} out of bounds")
    if covered != len(score.measures):
        problems.append(f"table covers {covered} of {len(score.measures)} measures")
    ranges = sorted(p.mxl for p in PIECES if p.mxl)
    for (a1, b1), (a2, _b2) in itertools.pairwise(ranges):
        if a2 != b1 + 1:
            problems.append(f"gap or overlap between {b1} and {a2}")
    return problems
