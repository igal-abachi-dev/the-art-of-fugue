# Voice assignment (T1.2.2)

**Rule.** `voice` is the rank of the line by its median pitch within the piece (1 = highest). Four
voices are labelled S, A, T, B; three are upper/middle/lower; two are upper/lower.

- **Parts mode** (all pieces with voices in parts 1-4): the line is the MusicXML part. Part 5
  ("Combined") is a duplicate reduction and is ignored (checked: it agrees with parts 1-4 for every
  piece, Jaccard >= 0.986). A note's `part` field keeps the original part number.
- **Combined mode** (the four canons, where parts 1-4 are empty): the lines are the
  (staff, voice) pairs of part 5. Voices with under 1 % of the notes (one stray note in Canon 2) join
  the voice with the nearest median pitch.
- **Voice crossings** are kept: the label is by median register, so a line that crosses another for a
  few bars keeps its voice. Crossings are listed as `crossing` events (T1.3.3).
- **Rests then re-entry** (for example the voices of a fugal exposition) need no special handling:
  voice identity is per line, not per sounding time.
- In Contrapunctus XIII Inversus (excluded 4-voice version) parts and register order differ (part 2
  is lower than part 3); the rank-by-median rule handles that.

| id | piece | mode | voice <- source | note |
|---|---|---|---|---|
| c01 | I | parts | voice 1 (S) = part 1 (median 72), voice 2 (A) = part 2 (median 66), voice 3 (T) = part 3 (median 58), voice 4 (B) = part 4 (median 50) |  |
| c02 | II | parts | voice 1 (S) = part 1 (median 72), voice 2 (A) = part 2 (median 65), voice 3 (T) = part 3 (median 57), voice 4 (B) = part 4 (median 50) |  |
| c03 | III | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 58), voice 4 (B) = part 4 (median 50) |  |
| c04 | IV | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 58), voice 4 (B) = part 4 (median 50) |  |
| c05 | V | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 60), voice 4 (B) = part 4 (median 53) |  |
| c06 | VI | parts | voice 1 (S) = part 1 (median 73), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 57), voice 4 (B) = part 4 (median 50) |  |
| c07 | VII | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 57), voice 4 (B) = part 4 (median 50) |  |
| c08 | VIII | parts | voice 1 (upper) = part 1 (median 72), voice 2 (middle) = part 2 (median 64), voice 3 (lower) = part 4 (median 51) |  |
| c09 | IX | parts | voice 1 (S) = part 1 (median 72), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 57), voice 4 (B) = part 4 (median 50) |  |
| c10 | X | parts | voice 1 (S) = part 1 (median 75), voice 2 (A) = part 2 (median 69), voice 3 (T) = part 3 (median 59), voice 4 (B) = part 4 (median 52) |  |
| c11 | XI | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 60), voice 4 (B) = part 4 (median 52) |  |
| c12r | XII | parts | voice 1 (S) = part 1 (median 73), voice 2 (A) = part 2 (median 65), voice 3 (T) = part 3 (median 58), voice 4 (B) = part 4 (median 50) |  |
| c12i | XII inv. | derived | 1=S, 2=A, 3=T, 4=B | mirror of c12r |
| c13r | XIII | derived | 1=upper, 2=middle, 3=lower | mirror of c13i |
| c13i | XIII inv. | parts | voice 1 (upper) = part 1 (median 74), voice 2 (middle) = part 2 (median 65), voice 3 (lower) = part 4 (median 53) |  |
| c14 | XIV | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 2 (median 67), voice 3 (T) = part 3 (median 58), voice 4 (B) = part 4 (median 51) |  |
| k1 | Canon 1 | combined | voice 1 = staff 1 / xml voice 1 (median 70), voice 2 = staff 2 / xml voice 5 (median 58) |  |
| k2 | Canon 2 | combined | voice 1 = staff 1 / xml voice 1 (median 76), voice 2 = staff 2 / xml voice 5 (median 62) |  |
| k3 | Canon 3 | combined | voice 1 = staff 1 / xml voice 1 (median 71), voice 2 = staff 2 / xml voice 5 (median 50) |  |
| k4 | Canon 4 | combined | voice 1 = staff 1 / xml voice 1 (median 71), voice 2 = staff 2 / xml voice 5 (median 55) |  |
| x1 | Early canon (aug. in contrary motion) | parts | voice 1 (upper) = part 1 (median 70), voice 2 (lower) = part 2 (median 55) |  |
| x2 | Early Canon alla Ottava | parts | voice 1 (only) = part 1 (median 70) |  |
| x3 | 'Contrap. a 4' (early version) | parts | voice 1 (S) = part 1 (median 76), voice 2 (A) = part 2 (median 69), voice 3 (T) = part 3 (median 59), voice 4 (B) = part 4 (median 52) |  |
| x4 | XIII inversus, 4-voice version | parts | voice 1 (S) = part 1 (median 74), voice 2 (A) = part 3 (median 69), voice 3 (T) = part 4 (median 58), voice 4 (B) = part 2 (median 53) |  |

## Spot checks against the PDF (3 pieces)

1. **Contrapunctus I**, PDF page 7: bar 1 D4, A4; bar 2 F4, D4; bar 3 C#4, D4, E4 in the upper staff;
   the parsed data has the same pitches. The detector reports the exposition as voice 2 (alto) at
   bar 1, voice 1 (soprano) at bar 5, voice 4 (bass) at bar 9 and voice 3 (tenor) at bar 13. Bars 1, 5
   and 9 were checked by eye on page 7; bar 13 was not.
2. **Contrapunctus XII**, PDF page 75: bass D3 half and A3 whole in bar 1, rests above; parsed notes
   have part 4 only in bar 1 (a stray hidden F4 in parts 1 and 2 is correctly skipped).
3. **Canon 3**, PDF page 118: bar 1 bass sextuplets D E D C# D E F G F E F G; parsed voice 2 has
   these twelve sixteenths in bar 1.
