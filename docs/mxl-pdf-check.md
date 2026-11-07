# MXL, PDF and recording: do they agree?

Three sources describe the same music: the OpenScore **MXL** (CC0, the note data's source), the Contrapunctus Press **PDF**
(the source of truth for the notes) and the **recording** (the source of truth for time). This page says what has been
checked between them, with numbers, and what has not.

|                         | what was done                                                                                                                            | result                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MXL against PDF         | every notehead of the PDF read from its music-font glyphs and compared with the MXL's notes, bar by bar (`python -m artfugue.audit_pdf`) | 1962 of 1963 bars agree in pitch after the corrections below; the other 1 (k2 bar 72) is listed here                                                                                                                         |
| PDF-checked MXL         | `python -m artfugue.mxl_checked` writes `data/derived/art-of-fugue.pdf-checked.mxl`                                                      | the corrections are in the XML, the two pieces the MXL lacks are added, and read back all 20 pieces equal the pipeline's note data                                                                                           |
| Score against recording | for every note, is its pitch audible at its aligned time? (`python -m artfugue.consistency`)                                             | 95.5% of 32,370 notes, against 68.1% when every note is moved by 0.45 s                                                                                                                                                      |
| Repeats                 | the PDF's repeat signs, the MXL's repeat marks, and whether the pianist takes them                                                       | the PDF has exactly four repeat signs: Canon 1 (bars 5 to 80) and Canon 3 (bars 9 to 75). The MXL has the same two pairs. Both passes of both canons are audible at their aligned times (95 to 97 %): the repeats are played |
| End of the last fugue   | Contrapunctus XIV                                                                                                                        | 239 bars in the PDF and in the MXL, no final barline in the PDF (it breaks off); the last note ends at 4824.93 s and the recording is silent (-67.8 dB) two seconds later                                                    |

## What "agrees with the PDF" means

The pitch of every notehead, bar by bar, and (where the audit could not pair a bar) the notes that make it up.
**Not compared with the PDF:** rhythm and note lengths in general, beams, ties as such, ornaments, dynamics and
articulation, and the layout. (Rhythm has one indirect check: the bar counts of the notes and of the PDF agree for
every piece, `docs/mxl-vs-pdf.md`.) The PDF is "mostly correct", in the owner's words, and has not been proofread by
anyone; the Henle edition (HN 423), when it arrives, is the better reference.

## The corrections

98 pitches and 11 note edits and mark changes were made, all applied in the single-voice part the note belongs to and in the combined
part of the XML, following the tie chain, with an explicit accidental on a changed note:

- 85 **automatic** pitch changes: the PDF's notehead is one to three semitones from the MXL's (a missing accidental,
  a wrong octave sign) and the bar then agrees completely (`audit_pdf.correct_piece`).
- 13 **pitch changes confirmed by hand** and 3 **note edits**, and 8 **ornament and staccato changes** decided by the recording (`data/pdf_overrides.json`, each with its
  evidence, listed below): larger than the audit allows, or in a bar it cannot pair up. A merge joins several notes into one, a
  split cuts one note into several.

Asking the recording about all 98 pitch changes as a calibration: it supports the PDF's pitch for 65, the MXL's for
12, and does not decide for 21 (a polyphonic texture often holds the other pitch in another voice). So the
recording is a tendency, not a judge: it favours the PDF about five times as often as the MXL. After each round of overrides
the alignment was recomputed: roughly 100 notes of 32,370 (0.3 %) moved by 5 to 310 ms each time, in the pieces and bars
around the changed notes (II, IV, VIII, XIV, Canon 1), and the note counts changed in Contrapunctus X (3 fewer) and XI (2 more).

### Every hand-confirmed change

| piece | bar | kind        | what                                                                                           | evidence                                                                                                                                                                                                                                                                                                                                     |
| ----- | --- | ----------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| c02   | 37  | pitch       | C3 to E3                                                                                       | PDF reading E3 against MXL C3; the recording has 8.2 dB more at E3 than at C3 for this note (audio_check)                                                                                                                                                                                                                                    |
| c08   | 68  | pitch       | F3 to A3                                                                                       | PDF A3 against MXL F3; recording +9.4 dB for A3                                                                                                                                                                                                                                                                                              |
| c08   | 133 | pitch       | A4 to F4                                                                                       | PDF F4 against MXL A4; recording +4.8 dB for F4                                                                                                                                                                                                                                                                                              |
| c14   | 147 | pitch       | F3 to A3                                                                                       | PDF A3 against MXL F3; recording +9.9 dB for A3                                                                                                                                                                                                                                                                                              |
| k1    | 39  | pitch       | Bb4 to D5                                                                                      | PDF D5 against MXL Bb4; recording +4.4 and +8.4 dB for D5 on the two passes                                                                                                                                                                                                                                                                  |
| k1    | 71  | pitch       | A4 to F4                                                                                       | PDF F4 against MXL A4; recording +0.6 and +12.6 dB for F4 on the two passes                                                                                                                                                                                                                                                                  |
| c04   | 120 | pitch       | E4 to C4 (voice 2, tick 0)                                                                     | PDF middle C4 on its ledger line (voice 2, first beat; checked by counting staff steps from the A4 above it) against MXL E4; recording C4 +6.3 against E4 +5.2 dB, a weak tendency                                                                                                                                                           |
| c11   | 180 | pitch       | Bb4 to C5 (voice 2, tick 60)                                                                   | PDF C5 against MXL Bb4 for the third note of the lower treble voice; recording at that moment: C5 +15.9, A4 +3.1, Bb4 -10.5 dB                                                                                                                                                                                                               |
| c10   | 82  | pitch       | G4 to E4 (voice 2, tick 84)                                                                    | PDF E4 (last eighth of the group G Bb A E, three steps below the A4) against MXL G4; recording E4 +10.3, G4 +4.9 dB                                                                                                                                                                                                                          |
| k1    | 98  | pitch       | A3 to G3 (voice 2, tick 48)                                                                    | PDF G3 against MXL A3 for the last eighth; recording G3 +3.1, A3 -5.6 dB                                                                                                                                                                                                                                                                     |
| c10   | 37  | pitch       | A4 to A3 (voice 3, tick 0)                                                                     | PDF A3 on the bass staff's top line (half note) against MXL A4; the voice comes from C4 in the bar before, so A3 follows by a third and A4 would be a leap of a sixth; recording has both octaves (A3 +11.9, A4 +10.1 dB)                                                                                                                    |
| c10   | 53  | pitch       | D3 to C3 (voice 4, tick 0)                                                                     | lowest voice, first note: PDF C3 against MXL D3; recording C3 +29.3, D3 -3.0 dB                                                                                                                                                                                                                                                              |
| c10   | 53  | pitch       | E3 to D3 (voice 4, tick 36)                                                                    | lowest voice, second note: PDF D3 against MXL E3; recording D3 +20.7, E3 +3.0 dB                                                                                                                                                                                                                                                             |
| c10   | 53  | merge       | 4 notes of voice 4 into one E3                                                                 | the PDF has one half-note E3 where the MXL has the eighths F3 G3 F3 E3 in the lowest voice; recording at the third eighth: E3 +13.9, F3 +3.1 dB, and E3 +13.7 at the last                                                                                                                                                                    |
| c11   | 81  | split       | voice 2, tick 48: shortened, plus D4 added                                                     | the PDF has four beamed eighths in this voice (F#4 D4 G4 E4, evenly spaced) where the MXL has two quarters (F#4, G4); the recording does not decide: the D4 attack at the third beat of the bar is +4.7 dB, the E4 attack +1.5 dB, in a dense texture where even the shared notes rise only 4 to 13 dB. Applied on the PDF's authority alone |
| c11   | 81  | split       | voice 2, tick 72: shortened, plus E4 added                                                     | second half of the same correction (G4 then E4 as eighths)                                                                                                                                                                                                                                                                                   |
| k1    | -   | clear_flags | remove staccato in the whole piece                                                             | the PDF prints no staccato in Canon 1; the MXL has 48 marks. In the recording these notes die away no faster than unmarked notes of the same length (median percentile 45 among them, 9 of 48 above the 75th: chance is 12), so they are not played detached                                                                                 |
| c08   | -   | clear_flags | remove mordent/inverted-mordent in bars [13, 23, 37, 63, 69, 83, 117, 133, 149, 154, 172, 184] | the PDF prints no mordent in bars [13, 23, 37, 63, 69, 83, 117, 133, 149, 154, 172, 184]; the MXL has 12. The recording shows no burst on a neighbouring pitch at their start (median percentile 40 among ordinary notes, 1 of 12 above the 75th)                                                                                            |
| c12i  | -   | clear_flags | remove trill in bars [8, 9, 23, 24, 35]                                                        | the PDF prints no trill in bar(s) [8, 9, 23, 24, 35], the MXL has one (inherited from the partner piece the MXL version was built from); the recording shows no alternation with a neighbouring pitch there (percentiles 31 to 50 among ordinary notes)                                                                                      |
| c13r  | -   | clear_flags | remove trill in bars [11, 48, 60]                                                              | the PDF prints no trill in bar(s) [11, 48, 60], the MXL has one (inherited from the partner piece the MXL version was built from); the recording shows no alternation with a neighbouring pitch there (percentiles 31 to 50 among ordinary notes)                                                                                            |
| c12r  | -   | clear_flags | remove trill in bars [35]                                                                      | the PDF prints no trill in bar(s) [35], the MXL has one; the recording shows no alternation with a neighbouring pitch there (percentiles 31 to 50 among ordinary notes)                                                                                                                                                                      |
| c06   | -   | clear_flags | remove trill in bars [43]                                                                      | the PDF prints no trill in bar(s) [43], the MXL has one; the recording shows no alternation with a neighbouring pitch there (percentiles 31 to 50 among ordinary notes)                                                                                                                                                                      |
| c06   | 42  | add_flag    | add mordent (voice 1, tick 72, A4)                                                             | the PDF prints a mordent on this note, the MXL has none; the recording has a burst on a neighbouring pitch at its start (percentile 87 among ordinary notes)                                                                                                                                                                                 |
| c06   | 74  | add_flag    | add mordent (voice 1, tick 24, C#5)                                                            | the PDF prints a mordent on this note, the MXL has none; the recording has a burst on a neighbouring pitch at its start (percentile 95 among ordinary notes)                                                                                                                                                                                 |

How sure each one is, honestly: for most of the pitch changes the recording agrees with the PDF by 4 dB or more at the
note's own moment, and those are solid. Three rest on the PDF with little or no help from the recording, and are the
ones worth a listen: **c04 bar 120** (middle C on its ledger line, checked by counting staff steps; the recording leans
to C by only 1 dB), **c10 bar 37** (an octave: the voice-leading and the PDF say A3, the recording has both A3 and A4)
and **c11 bar 81** (the PDF has four beamed eighths where the MXL has two quarters; the recording is inconclusive in that
dense texture, so this one is applied on the PDF's authority alone). **All three were listened to by the owner on 2026-11-06, who found the PDF accurate there** (`docs/listening-check.md`); the edits stay.

## The two pieces the MXL lacks

Contrapunctus XII Inversus and XIII (rectus) are in the PDF but not in the MXL. The checked MXL appends them as
measures 2303 to 2358 and 2359 to 2430, in all five parts:

- the structure (rhythm, beams, ties, ornaments) is the mirror partner's (XII and XIII Inversus); the single-voice
  parts are exchanged as the voices are (highest becomes lowest);
- every pitch is spelled as the PDF engraves it (letter, octave and accidental from the notehead); a tied continuation
  keeps its partner's pitch; the key signature is the PDF's (-1 flat);
- 2039 of 2156 (XII inversus) and 2321 of 2447 (XIII) note elements take their spelling from a notehead; the rest are tied
  continuations and a few grace notes spelled by mirroring;
- the recording was **not** needed for these two: their timing is the alignment's, already in `data/work/timed/`.

Reading the file back with the pipeline's own reader gives, for **all 20 pieces**, exactly the notes the pipeline has
(onset, pitch, length and voice, note for note). The file is a derived work: the OpenScore transcription (CC0) plus
pitches read from the PDF (CC BY-NC-SA 4.0, so share-alike applies to it).

**A consequence found while doing this:** the derived pieces numbered their voices by simply reversing the partner's,
but in XIII the mirrored middle voice ends up the _highest_ line (median pitch 77 against 67). Voices are now ranked by
median pitch for every piece, as `docs/voices.md` says; in the shipped data XIII's voices 1 and 2 swapped (620 notes),
so its voice colours now follow the register.

## The bar that was in doubt (settled by ear, 2026-11-06)

**Settled:** the owner listened to the whole recording and says the **MXL is correct** here: the B-flat 4 belongs in the bar and stays in the data (`docs/listening-check.md`). The analysis below is how the question was framed before that.

k2 bar 72: the MXL has a B-flat 4 on an off-grid beat (tick 30, six long, in a run of sixteenth triplets) that the PDF does
not print anywhere, no small notehead either. The recording has it: in the first 100 ms after the attack B-flat 4 is the
loudest of the neighbouring semitones (-19 dB against -29 for B natural 4 and -25 for A4; all relative to the loudest
sound of the whole recording), so the pianist plays B-flat, not B natural. (A pasted explanation claimed she plays B
natural there; the measurement says otherwise.) So the MXL and the recording agree and the PDF has no such note. It is not a hidden or overlapped notehead:
every glyph and filled shape the PDF draws between the neighbouring G5 and A5 was listed, and there is nothing on the
middle line there, only the heads of G5, A5 and A4. So the edition leaves the note out (an omission, or, the owner's
reading, an intentional editorial choice based on a manuscript variant: unconfirmed, the PDF says only that it is
"a scholarly edition based upon original sources" and has no notes on variants), or the MXL adds it. In the PDF
engraving overlay this note has no notehead to light, in the Verovio one it does. It was left as the MXL has it, to be settled with
the Henle edition. Picture, with the disagreeing noteheads circled: `docs/img/pdf-review-1.png` (`python -m artfugue.pdf_review`).
In the table "recording" is dB for the PDF's pitch minus the MXL's pitch (positive: the recording favours the PDF).

| piece | bar | PDF page | MXL has | PDF reading has | recording                                                        |
| ----- | --- | -------- | ------- | --------------- | ---------------------------------------------------------------- |
| k2    | 72  | 117      | E4, Bb4 | D4, E4          | E4: D4 -6.8, E4 +0.0; E4: D4 +6.3, E4 +0.0; E4: D4 +2.5, E4 +0.0 |

## Score against recording, per piece

Fraction of notes whose pitch is audible at the aligned time / the same with every note moved by 0.45 s:
c01 0.97/0.69 · c02 0.97/0.67 · c03 0.95/0.65 · c04 0.96/0.67 · c05 0.96/0.65 · c06 0.94/0.70 · c07 0.95/0.66 · c08 0.95/0.69 · c09 0.93/0.65 · c10 0.95/0.67 · c11 0.96/0.70 · c12r 0.95/0.67 · c12i 0.95/0.70 · c13r 0.95/0.72 · c13i 0.94/0.74 · c14 0.97/0.71 · k1 0.95/0.64 · k2 0.94/0.72 · k3 0.96/0.65 · k4 0.98/0.69.

Every piece is clearly better aligned than shifted, but this does not measure milliseconds, and the sync tolerance
(median 30 ms, 95th percentile 80 ms, `docs/mvp.md`) still needs a person to listen (T2.3.5). The independent
flux-peak numbers are in `docs/alignment-report.md`.

## Rebuild

```
python -m artfugue.build_all --no-qa        # score data (with the overrides), alignment, export, notation, docs
python -m artfugue.mxl_checked              # data/derived/art-of-fugue.pdf-checked.mxl
python -m artfugue.audio_check              # what the recording says about the corrections and the open bar
python -m artfugue.consistency              # the three-way checks above
python -m artfugue.pdf_review               # the contact sheet
```
