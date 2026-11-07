# MXL vs PDF (T1.1.2)

**The Contrapunctus Press PDF (`IMSLP742925-PMLP5843`, CP 0101, edited and engraved by
Dr. Dominic Florence, (c) 2021) is the source of truth.** The MXL is an open-source transcription
(OpenScore, MuseScore 2.1.0, 2017) and is checked against it, not trusted.

## Method

1. **Titles and page numbers** read from the PDF's text layer (titles and bar numbers use a simple
   character offset, decoded in `artfugue/pdfscore.py`). The PDF has 20 pieces: Contrapunctus
   I-XI, XII and XII Inversus, XIII and XIII Inversus, XIV, and Canon 1-4. The table of contents
   in the PDF lists the same, with printed page numbers.
2. **Bar counts per piece.** The PDF prints a bar number at the start of every system, and every
   barline is a vector line, so the bars of each system can be counted. The count was checked
   against the printed numbers (they agree for all pieces except two noted below).
3. **MXL sections** were found from final barlines (light-heavy), repeat marks, time/key/tempo
   resets and the text directions, then matched to PDF pieces by bar count, time signature and
   voice count.
4. **Spot checks of the first bars by eye** (rendered PDF page against the parsed notes):
   Contrapunctus I bars 1-3 (D4/A4, F4/D4, C#4 D4 E4), Contrapunctus XII bar 1 (bass D3 half, A3
   whole), Canon 3 bar 1 (sextuplet sixteenths D E D C# D E | F G F E F G), Canon 2 bar 1, and both
   XIII openings (pickup A4; D5 then rising triplets D4 E4 F4 for the Inversus). Bar counts match
   for all 18 pieces present in the MXL. **Note-by-note comparison of every bar was not done** (that
   would need OMR); this is the verification level.

## Mapping

Page columns: physical PDF page, then printed page number. `*` marks a PDF count that disagrees by
one with the printed numbers: Contrapunctus XIII counts the pickup bar (MXL bar 0) as a bar, and
Canon 3's double barline is counted twice by the barline counter. Both are counting artifacts, not
differences in the score.

| PDF title | PDF pages | printed | MXL idx | PDF bars (counted) | MXL bars | id |
|---|---|---|---|---|---|---|
| Contrapunctus I | 7-10 | 1-4 | 0-77 | 78 | 78 | c01 |
| Contrapunctus II | 10-14 | 4-8 | 78-161 | 84 | 84 | c02 |
| Contrapunctus III | 15-18 | 9-12 | 162-233 | 72 | 72 | c03 |
| Contrapunctus IV | 18-25 | 12-19 | 234-371 | 138 | 138 | c04 |
| Contrapunctus V | 25-29 | 19-23 | 372-461 | 90 | 90 | c05 |
| Contrapunctus VI | 29-37 | 23-31 | 462-540 | 79 | 79 | c06 |
| Contrapunctus VII | 37-43 | 31-37 | 541-601 | 61 | 61 | c07 |
| Contrapunctus VIII | 43-53 | 37-47 | 602-789 | 188 | 188 | c08 |
| Contrapunctus IX | 53-59 | 47-53 | 790-919 | 130 | 130 | c09 |
| Contrapunctus X | 59-65 | 53-59 | 920-1039 | 120 | 120 | c10 |
| Contrapunctus XI | 65-74 | 59-68 | 1040-1223 | 184 | 184 | c11 |
| Contrapunctus XII | 75-78 | 69-72 | 1740-1795 | 56 | 56 | c12r |
| Contrapunctus XII - Inversus | 78-81 | 72-75 | - | 56 | 56 | c12i (derived, checked vs PDF) |
| Contrapunctus XIII | 81-86 | 75-80 | - | 72* | 71 | c13r (derived, checked vs PDF) |
| Contrapunctus XIII - Inversus | 86-91 | 80-85 | 1596-1667 | 72* | 71 | c13i |
| Contrapunctus XIV | 91-103 | 85-97 | 1796-2034 | 239 | 239 | c14 |
| Canon 1 | 105-111 | 99-105 | 1224-1326 | 103 | 103 | k1 |
| Canon 2 | 111-118 | 105-112 | 1405-1486 | 82 | 82 | k2 |
| Canon 3 | 118-123 | 112-117 | 1327-1404 | 79* | 78 | k3 |
| Canon 4 | 123-131 | 117-125 | 1487-1595 | 109 | 109 | k4 |

## Findings

- **Present in both, same length:** I-XI, XII (rectus), XIV, Canon 1-4 (bar counts equal).
- **Canon order differs:** the MXL lists Canon 3 (78 bars, with "NB." and "Finale" text) before
  Canon 2 (82 bars, "Cadenza"). Matched by content: Canon 3 starts with the sextuplet figure in
  alla breve; Canon 2 is in 12/8.
- **Contrapunctus XIII:** the MXL has two sections with the same pitch material. The first (3
  voices, pickup `X1`) is the PDF's **Inversus**: it opens with pickup A4, then D5 and rising
  triplets, and the bass staff is empty as in the PDF. The second (pickup `X2`) repeats 86 % of
  those notes and adds a 4th voice (two-keyboard version); it has no counterpart in the PDF.
  **So the PDF's XIII (rectus) is missing from the MXL.**
- **Contrapunctus XII:** only the rectus is in the MXL. **The PDF's XII Inversus is missing.**
- **Appendix in the MXL, not in the PDF:** early versions of the augmentation canon and of the
  Canon alla Ottava (first line only), and "Contrap. a 4" (98 bars).
- **Note-level discrepancies found:** none in the bars compared. Not found does not mean absent
  (see Method, point 4).

## Decisions

| Item | Decision |
|---|---|
| 18 pieces present in the MXL | use as-is |
| XII Inversus, XIII (rectus) | derived by pitch mirror (axis sums 119 and 143), then every pitch read from the PDF noteheads (`verified: true`) |
| 4-voice XIII version, appendix early versions | exclude from the site; keep in the data as `excluded` |
| Canon 2 / 3 order | use the PDF order (Canon 1, 2, 3, 4) |
