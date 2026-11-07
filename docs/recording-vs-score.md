# Where the recording differs from the score

The pianist, the owner says, plays the Henle Urtext, which is more accurate than the Contrapunctus Press PDF (itself
"mostly correct"). If so, the recording should differ from the PDF in the places where the two editions differ. This page
is the result of looking for exactly that, note by note, with the tool `python -m artfugue.recording_vs_score`.

## Method

For every note (not grace notes, not shorter than 0.12 s) the semitone spectrogram of the recording is read over the first
0.4 s after the note's aligned onset. The note is **flagged** when the pitch a semitone above or below the written one
stands out by at least 8 dB more than the written pitch does, _and_ no written note that sounds, begins or ends within
0.6 s of that moment has that pitch (as itself or an octave away). A semitone is the usual difference between editions: a
sharp, flat or natural that one prints and the other does not.

Result: **236 of 27,433 notes (0.9%) are flagged**; the other 99.1 % have no semitone neighbour that the
recording prefers. Of the flagged: 21 are in the closing two bars of a piece, 0 are ornament notes, and
**215 are elsewhere**.

## How to read it

- It is a list of _places to look_, not of errors. A written note can be masked by louder neighbours; ornaments sound
  around their written pitch; the pedal carries notes on; the alignment is off by tens of milliseconds in places
  (then the neighbouring note leaks into the window, which the 0.6 s rule only partly removes).
- **The closing bars are not trustworthy here.** The fermatas and the slowing down at the end of a piece make the aligned
  times of the last notes uncertain, and several of the strongest hits are there (Contrapunctus II bar 84, III bar 72, XII bar 56, and
  Canon 2 bar 81, which carries the word "Cadenza").
- When two sources disagree, neither is right by default. A recording that plays B natural where the PDF prints B flat is
  the Urtext reading _or_ a performer's choice _or_ an alignment slip. Only the Henle score (or Bach's text) can say which.
- Nothing in the score data was changed because of this list.

## Where they cluster

Bars with two or more flagged notes outside the closing bars: c13r bar 35 (3), k2 bar 78 (2), c07 bar 17 (2), c13i bar 22 (2), c14 bar 124 (2), c06 bar 77 (2), c12i bar 34 (2), k3 bar 69 (2), c14 bar 185 (2), c12r bar 32 (2), k2 bar 76 (2), c08 bar 48 (2), c05 bar 47 (2), c06 bar 8 (2), c08 bar 139 (2), k4 bar 83 (2), c06 bar 43 (2), c06 bar 28 (2), k3 bar 76 (2), c10 bar 68 (2), c07 bar 19 (2).
By piece (flagged notes outside the closing bars and ornaments): k2 20, c06 19, c08 17, c07 16, c10 16, c14 13, c11 12, c12r 11.

## The strongest 40 outside the closing bars

(`dB` is how much more the recording has at the other pitch than at the written one, in the first 0.4 s of the note.)

| piece | bar | voice | written | recording has | dB  |
| ----- | --- | ----- | ------- | ------------- | --- |
| c12i  | 44  | 4     | G2      | Ab2           | +24 |
| c09   | 73  | 1     | D5      | Eb5           | +23 |
| c03   | 28  | 2     | A4      | Bb4           | +23 |
| k2    | 78  | 1     | F4      | F#4           | +22 |
| c07   | 35  | 1     | D5      | Eb5           | +22 |
| c10   | 38  | 2     | D5      | Eb5           | +20 |
| c12r  | 52  | 4     | G2      | Ab2           | +20 |
| c13r  | 35  | 3     | D4      | C#4           | +20 |
| c07   | 55  | 2     | G4      | F#4           | +19 |
| c11   | 63  | 1     | G5      | F#5           | +19 |
| c13r  | 11  | 3     | C4      | C#4           | +19 |
| c05   | 86  | 4     | E3      | F3            | +18 |
| c14   | 110 | 2     | D5      | Eb5           | +18 |
| c13i  | 2   | 2     | F4      | F#4           | +18 |
| c01   | 54  | 2     | G4      | F#4           | +18 |
| c07   | 17  | 4     | C3      | B2            | +18 |
| c04   | 59  | 3     | D4      | Eb4           | +17 |
| c13i  | 22  | 2     | G4      | F#4           | +17 |
| c13i  | 56  | 1     | Bb4     | B4            | +17 |
| c14   | 124 | 1     | D5      | Eb5           | +17 |
| k2    | 79  | 1     | D5      | Eb5           | +17 |
| c05   | 7   | 2     | G4      | F#4           | +17 |
| c03   | 17  | 1     | D5      | Eb5           | +17 |
| k2    | 21  | 2     | D4      | Eb4           | +17 |
| c08   | 55  | 3     | G2      | Ab2           | +17 |
| c06   | 77  | 3     | C4      | B3            | +16 |
| c13r  | 35  | 2     | Bb4     | B4            | +16 |
| c08   | 123 | 2     | D5      | Eb5           | +16 |
| c13i  | 35  | 3     | C3      | B2            | +16 |
| c12i  | 34  | 3     | Bb3     | B3            | +16 |
| k3    | 69  | 2     | A3      | Bb3           | +16 |
| c06   | 67  | 2     | F4      | F#4           | +16 |
| c14   | 185 | 4     | G2      | Ab2           | +16 |
| k2    | 35  | 1     | D5      | Eb5           | +15 |
| k2    | 65  | 1     | D5      | Eb5           | +15 |
| c06   | 74  | 2     | E4      | F4            | +15 |
| c12r  | 32  | 1     | Bb3     | B3            | +15 |
| c12r  | 32  | 3     | Bb3     | B3            | +15 |
| k2    | 76  | 2     | G4      | F#4           | +15 |
| c04   | 15  | 2     | Eb4     | E4            | +15 |

The whole list (all 236) is in `data/work/recording_vs_score.json` (git-ignored; rerun the command to get it).
Pictures of the 12 strongest, with the written note circled, were made once for this review and are not kept.

## When the Henle edition arrives

1. Compare the 215 "elsewhere" bars with it first: where Henle agrees with the recording and not with the PDF, the PDF is
   wrong (or the MXL transcription of it is) and `data/pdf_overrides.json` takes the change.
2. Where Henle agrees with the PDF and the recording differs, the performer chose differently: nothing to change in the
   score, and the sound is what it is.
3. Rerun this command afterwards: the count should fall, and what is left is the performer's own.
