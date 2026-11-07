# Score overlay (T4.4.1)

The overlay shows the engraved system that is playing, lights the noteheads that sound in their voice colour and moves
a cursor along it, following the recording. Page for trying it: `/stage?score` (the "score" checkbox in the bar at
the bottom). The real interface (E7) will embed the same `lib/notation/Notation.svelte`.

| URL                         | what                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `/stage?score`              | Verovio's engraving of the MXL (the default; from the PDF-checked MXL, `mxl-pdf-check.md`) |
| `/stage?score&notation=pdf` | the second source: the PDF's own engraving                                                 |

## Two sources, one format

Both write `web/static/data/<source>/<piece>.json` in the same format and the component reads either:

```
{ version, piece, source, credit, unit?, systems: [ {
    svg:  file of the engraving (vector)        size: its coordinate space
    crop: [x, y, w, h] of this system in it     bars: [{n, x0, x1}]   (printed bar number, x range)
    heads: [[x, y, staff, i, j, ...]]           (notehead position and the positions i, j of its notes in the chunk)
} ] }
```

`heads` refer to positions in the shipped note chunk (`pieces/<id>.bin`, sorted by `t_on`), so the overlay needs no
other lookup: a sounding note is an index from `NoteWindow.active`, and the heads of that index are a table read.
A tied note lights all its heads; the two passes of a repeated canon share the heads of the printed bars.

|                    | PDF source (second)                                                                                               | Verovio source                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| made by            | `python -m artfugue.notation`                                                                                     | `python -m artfugue.notation_mxl`, `node web/scripts/notation-verovio.mjs`, `python -m artfugue.notation_verovio`                                                   |
| engraving          | the PDF itself: vector paths from `page.get_svg_image` (no raster anywhere), so it is the same drawing as the PDF | Verovio (LGPL-3.0, build time only, nothing of it ships) engraves the combined part of `data/derived/art-of-fugue.pdf-checked.mxl` (the MXL with the PDF's pitches) |
| files              | one SVG per PDF page (124, 25.4 MB, 3.3 MB gzipped), systems are crops                                            | one SVG per piece (20), systems are crops                                                                                                                           |
| pieces             | all 20                                                                                                            | all 20 (XII inversus and XIII are not in the original MXL; the PDF-checked MXL adds them, `mxl-pdf-check.md`)                                                       |
| noteheads          | read from the PDF's music-font glyphs (`pdfnotes.py`)                                                             | read from Verovio's SVG                                                                                                                                             |
| linking to notes   | bar by bar optimal assignment of pitch and position, as the pitch audit does                                      | onset tick and pitch from Verovio's timemap; tied continuations to the note already sounding                                                                        |
| shown              | 99.95 % of all notes have a notehead (30,465 of 30,480); every printed bar is on some system                      | 98.9 % overall; Canon 1 only 77 % (see below)                                                                                                                       |
| reflows to a width | no (the PDF's systems)                                                                                            | yes (re-run with another `pageWidth`)                                                                                                                               |

Why both: Verovio's engraving is the default (any width, restyling, no PDF needed, and the way to a Henle edition later if the MXL is replaced);
the PDF engraving looks as a printed score does and remains the source of truth for the notes (the MXL's pitches were corrected against it),
so it is kept as the second choice ("The printed score (the PDF)" in the effects menu, `&notation=pdf`).

### Verovio source: known gaps

- **Canon 1: 77 % of notes shown** (1,006 of 1,306), Canon 3: 97 %. The two canons with repeats, whose written bars in
  the MXL carry endings the note data does not pair with; the PDF source shows 100 % of them. Not investigated further.
- A corrected note gets an explicit accidental sign; accidentals that the corrected note makes redundant or needed on
  later notes of the bar are not recomputed.
- The mirror pieces' notation (XII inversus, XIII) is built by mirroring a partner's structure, and it shows: stems and
  beaming are Verovio's own, and rests inherited from the partner's voices sometimes collide with notes in the bass
  staff. For those two the PDF source is the one to use.

## The licence

The PDF is Contrapunctus Press CP 0101, edited and engraved by Dr. Dominic Florence, **CC BY-NC-SA 4.0**. The owner
decided the engraving may be shown (private, non-profit use). The credit is in every notation file (`credit`) and under
the score; what is derived from the engraving (positions, the SVG pages) is share-alike. For public use re-check the
IMSLP page. The Henle edition (HN 423), which the owner will have soon, is a different matter (not CC-licensed):
the pipeline is written for "a PDF with LilyPond-style glyphs", and would need `pdfnotes.py` adapted to another
engraver's font before it could read one.

## How it works in the page

- `notation.ts` (no DOM, unit-tested): `NotationIndex` (note to heads as flat typed arrays, bar to system),
  `CursorTrack` (the cursor), `markSounding` (the lit heads).
- The cursor is piecewise linear between the **measured onsets** of the notes of the current bar (so it follows the
  performance's rubato, not the engraving's spacing), from the bar's left edge to its right edge. Notes within 40 ms
  count as one column; a note whose head is in the next bar is ignored for this bar even if the recording has it a few
  ms early.
- `Notation.svelte` has its own `FrameLoop`; per frame it writes one attribute (the cursor) and toggles a class on the
  heads whose state changed (usually zero or two). A new system is repainted before the browser draws it.

## What was checked

Unit tests: 11 (index, lit heads, cursor including the early-note case); Python: 4 tests on the shipped data
(every shipped piece has notation and its page files, every head refers to a real note and lies inside its system,
at least 99 % of the notes of every piece have a notehead, every bar of every piece is on some system).

`pnpm notation-check` (real browsers, Edge 156 and Playwright's Firefox, both sources): 14 places across 10 pieces
(first and last bars, a pickup bar 0, both mirror pieces, a repeated canon on its second pass): the system shown
contains the playing bar, noteheads are lit when notes sound and never more than 3 per sounding note; 24 s of playback
of Contrapunctus I: the cursor never moves backwards inside a system, the system changes when the music moves on,
noteheads are lit in over 90 % of the samples; no failed request, no console error. Screenshots
(`docs/img/notation-*.png`, also at 3x pixel ratio to see that it is vector).

### Bugs the browser run found

1. **`engine.piece` and `engine.bar` were stale during continuous playback** (a real bug in E3/E4, found here): they were
   recomputed on media events only, and a buffered local file fires almost none. After 17 s of playback the bar still
   read 1. The stage, which draws `engine.piece`, would have drawn the old piece after a piece boundary until some
   event came. Now `engine.update()` runs on the transport's 10 Hz timer and every stage and overlay frame; regression
   test in `transport.spec.ts`.
2. The previous system's lit heads stayed lit on the reused elements when the system changed.
3. For one frame after a system change the new system was drawn with the old cursor position (Firefox); it is now
   repainted before the browser draws it.
4. The cursor was pulled forward by a note that starts a few ms before its barline.
5. Verovio: the MusicXML cut for a piece did not carry the key, clefs and staff count from earlier bars, so Verovio
   engraved everything on one treble staff with 40 ledger lines (only Contrapunctus I started with them).

6. **Every PDF page file was invalid XML** after a size optimisation (a bad regular-expression replacement wrote a
   control character and dropped minus signs); browsers refuse such an SVG, so the overlay showed lit noteheads over
   a blur. The check passed anyway, because it looked at the noteheads, not at the picture. Fixed, and now
   `notation-check` fetches the engraving of every place it visits and parses it in the browser, and a Python test
   parses all 144 SVG files.

## Not done / open

- **Not judged by eye**: whether the cursor feels in time, whether the highlight colours read on the paper card, where the
  card sits over the stage (it covers the lower half of the keyboard: a layout decision for E7).
- **Reduced motion / photosensitivity** (T7.5.1): the overlay has no flashing; the highlight fade is skipped under
  `prefers-reduced-motion`.
- **Size**: 40 MB of notation data in total (PDF source 26 MB + Verovio source 14 MB, 6.1 MB gzipped), loaded only for the piece
  being shown (110-300 kB gzipped per piece from the PDF source). The owner decided to keep both in the repository.
- Mobile layout, keyboard focus and a text alternative for the score are E7.
