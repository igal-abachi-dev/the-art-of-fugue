# Note values, ties, ornaments: MXL against PDF

`docs/mxl-pdf-check.md` compares pitches. This page is about the rest of what the PDF prints: how long each note is, which
notes are tied, rests, ornaments and staccato. The tool is `python -m artfugue.pdf_rhythm`; it writes
`data/work/pdf_rhythm.json` (every difference, bar by bar; git-ignored, rerun to get it).

**Read this first: it is a screening, not a proof.** The PDF is read from its drawing, not by a person, and the reader
still makes mistakes of its own. Two checks were added after a first version proved noisy (a lost dot, a tied head read as a
different pitch, beam stubs): the written values are compared only after pairing each head with the note of the same pitch
(within a semitone, for a tied note printed without its accidental), and the **onset structure** is compared on its own: how
many distinct time positions a bar's noteheads stand at against how many distinct onsets the MXL's notes have, which does not
depend on reading any note value. Only the ornament and staccato marks, which the recording can settle, were changed (see the
end of the page); note values and ties were not.

## What is compared, and how

|                        | from the PDF                                                                                                                                 | from the MXL                                                                           | result                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onset structure        | the number of distinct time positions of a bar's noteheads (heads closer than 7 pt are one onset)                                            | the number of distinct onsets of the notes                                             | **agrees in 95.1 % of the 2,091 bars** (103 differ, 90 of them in four pieces with dense triplet runs: Contrapunctus XIII and XIV, Canons 2 and 3, where the heads are too close to separate); outside those pieces 13 of 1,548 bars (0.8 %) |
| Note values            | the notehead (whole, half, filled), its stem, the flags and beams at the stem's end, the augmentation dots                                   | the written value, worked out from the note's duration and tuplet ratio, with its dots | **5.4 % of bars show a value difference** (113 bars) and 2.7 % a head with no partner; the rest agree                                                                                                                                        |
| Ties                   | a filled curve from one notehead to a later notehead of the same pitch (or to the end of the system, for a tie that goes on to the next one) | the tie starts of the combined part                                                    | 11 % of bars differ, mostly "the MXL has a tie the reader did not find" (ties between chord notes and inside dense bars are the weak spot)                                                                                                   |
| Rests                  | the rest glyphs, by kind                                                                                                                     | the rests, by written value                                                            | 76 bars differ; **not reliable** (the MXL has a rest per voice, the PDF one per place on the staff), shown in the data file only                                                                                                             |
| Ornaments and staccato | the `scripts.*` glyphs: trill, mordents, turn, fermata, staccato                                                                             | the notations on the notes                                                             | 54 bars differed; **14 do now**, after the recording decided the rest (below)                                                                                                                                                                |

The MXL side is the combined part of `data/derived/art-of-fugue.pdf-checked.mxl`; notes that are not printed
(`print-object="no"`), grace notes and cue notes are left out.

## Findings

- **Canon 1 is notated with half the note values.** Every value in the MXL is one step shorter than the PDF's (an
  eighth where the PDF has a quarter), a different denominator for the same time: the bars add up and the alignment is
  unaffected. With that scale taken into account Canon 1 agrees in every bar (0 of 103 differ in value).
- **Ornaments and staccato: the recording decided.** `python -m artfugue.ornament_check` measures, for every mark on which the
  two sources disagreed, how the recording behaves at that note, against ordinary notes of the same piece (staccato: how fast
  the note dies away, against notes of the same length; mordent, trill: how much a neighbouring pitch gains in the first
  250 ms). The result, and what was done:
  - **Canon 1: 48 staccato marks in the MXL, none in the PDF.** The notes die away no faster than unmarked ones (median
    percentile 45; 9 of 48 above the 75th, chance is 12). They are not played detached: the marks were removed.
  - **Contrapunctus VIII: 12 mordents in the MXL, none in the PDF.** No burst on a neighbour (median 40; 1 of 12 above the
    75th). Removed.
  - **Trills in XII inversus (4), XIII (3), XII (1) and VI (1), in the MXL only.** The recording shows no alternation (medians 31
    to 50). Removed; in the two pieces built by mirroring they had been inherited from the partners.
  - **Contrapunctus VI: 3 mordents in the PDF, none in the MXL.** Two of the three show the burst (percentiles 87 and above);
    those two were added.
  - **Left as they are** (the recording gives no clear answer, small numbers): 9 staccato marks the PDF has in Canons 2 to 4 (4 of 9
    above the 75th, where chance is 2), one mordent each in Contrapunctus IX and Canon 1, one trill in XIII inversus and
    the fermatas (a fermata is a held note, not tested). 14 bars with a mark difference remain, down from 54.
- **The cue note.** The B-flat in Canon 2 bar 72 that the PDF omits is the only _cue note_ in the MXL, with a bracketed
  notehead: the source of the transcription printed it as an optional or editorial note, which an edition "without editorial
  additions" would leave out (`docs/mxl-pdf-check.md`).
- **Rhythm structure.** Where the PDF can be read, the MXL's rhythm has the same onsets: 13 differing bars in 1,548 outside the
  dense pieces. In a random sample of the value differences that remain, one is a harmless difference of notation (the MXL has
  one half note where the PDF prints two tied quarters) and the rest could not be told from reader mistakes, so no duration was
  changed: a duration changed in one voice would also have to change the next onset in that voice, and which voice a printed
  head belongs to is not something the page states.
- **The recording counts the onsets where the page cannot.** `python -m artfugue.onset_check` asks, for each bar, whether every
  onset the MXL has is heard in the recording (the pitch's own level jumps there, or the broadband onset envelope peaks) and
  whether the recording has attacks the MXL does not (envelope peaks away from every written onset). It is calibrated on a
  sample of 60 ordinary bars of each piece (a bar passes if it is within what those do). Of the **103 bars where the page and
  the MXL disagreed about the onsets, 93 pass**: the recording has what the MXL has, and the page undercounted (the dense
  triplet bars of XIII, Canons 2 and 3 are nearly all of them). That check is lenient (ordinary bars themselves "hear" only
  50 to 60 % of their onsets at the 10th percentile, because notes over a sounding note of the same pitch show no jump).
- **Ten bars where the recording does not back the MXL**: Contrapunctus IV bar 64, IX bar 75, XII bar 56 (the final bar, with a
  fermata: its timing is uncertain anyway), XIII inversus bars 32 and 68, XIV bars 58, 59, 105 and 106, Canon 3 bar 25.
  In six of them (IV 64, IX 75, XIV 58, 59, 105, 106) the page also shows **one more time position than the MXL has**
  and the recording has extra attacks, so two independent sources agree that something differs. In XIV bar 58, for example,
  the PDF has a half-note F3 in the bass about two thirds into the bar that the MXL has no onset for. Pictures:
  `docs/img/rhythm-review-1.png` (XIV 58, 59, 105) and `-2.png` (IV 64, IX 75, Canon 3 25), with the MXL's onsets in the
  captions. These were **not changed**: fixing one means re-timing notes of a voice, which needs a person with the page (and the
  Henle score) in front of them. They are the real rhythm questions of the MXL; the other ~2,080 bars have none that either the
  page or the recording shows.
- **Note values elsewhere.** The bars that differ are spread over the fugues (Contrapunctus XI 25, XIV 23, VI 20, III 19, IV 18,
  V 16, X 14, VII 10, VIII 10, IX 7, I 3) and the canons (Canon 2 6, Canon 4 5, Canons 1 and 3 none). I looked at four; see above
  for what they were.

## What was changed, and what was not

The ornament and staccato changes above are in `data/pdf_overrides.json` (with their evidence), applied to the note data
(`flags`) and to the XML of the PDF-checked MXL; the alignment does not use them (it looks only at grace notes), so no
timing moved. **Note values and ties were not changed**: the screening is too noisy to act on (see the top of this page), and
the recording cannot tell an eighth from a quarter reliably (the pedal carries the sound on). Use
`data/work/pdf_rhythm.json` as a checklist when the Henle edition is at hand: a bar where the reader says "PDF eighth,
MXL quarter" and a person looking at the page agrees is a real correction.
