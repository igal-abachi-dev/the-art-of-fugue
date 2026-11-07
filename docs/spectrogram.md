# The spectrogram view

`/stage?spectro` (or the "spectrogram" checkbox on `/stage`) shows the recording's semitone spectrogram scrolling past a
playhead, with the score on it. Time runs left to right (10 s across, playhead 30 % in), pitch upward, two rows per semitone (quarter tones) from
C1 to B7. Every note of the piece in view is outlined in its voice colour; the notes sounding now are filled lightly and
underlined with a thick line of the same colour. If the alignment is right, each outline sits on a bright ridge of the picture;
a note that sits beside its ridge, or on empty background, is a note to look at.

This is the "spectrogram with the aligned notes overlaid" of the alignment-QA task (T2.3.5) made live: seek anywhere and look.

|       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data  | `python -m artfugue.spectro` (part of `python -m artfugue.build_all`) writes `web/static/data/spectro/<id>.bin`, one file per piece: the pipeline's transform (`cqt.py`) without the fold into semitones, so **168 rows (two a semitone) at all 86 frames a second**, cut to the piece plus a second each side, 8 bits (-66 dB and below is black, 0 dB is white). About 860 columns for the 10 seconds in view: enough for a 4K (4096 px) screen, drawn with smooth interpolation (version 2 of the file, `AFS2`; the loader still reads the first version, 84 rows at 21.5 columns a second). 20 files, about 70 MB (2 to 7 MB the piece being shown, loaded when it is first shown). The quarter-tone transform is cached in `data/work/audio/cqt168.npy` (140 MB), apart from the alignment's own `cqt84.npy`. |
| Code  | `web/src/lib/spectro/spectro.ts` (loader and the arithmetic, unit-tested), `Spectrogram.svelte` (one 2D canvas as many device pixels wide as the screen, up to 4096; the piece's picture is built once as tiles of at most 8192 columns, because a long piece is wider than a canvas can be, then each frame is a few `drawImage` calls of the window plus the note outlines; line widths and type scale with the canvas). The panel and the picture are a little see-through (picture 80 % opaque over a half-transparent dark panel), so the stage shows faintly behind.                                                                                                                                                                                                                                         |
| Check | `pnpm spectro-check`: for seven places in seven pieces, in Edge and Firefox, the file loads, a good part of the canvas is lit, and voice-coloured pixels (outlines and underlines) are on it. Python: `test_spectro.py` checks the file format against what the loader reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Limits

- It is the **whole mix**: the spectrogram cannot separate the voices (they overlap in frequency), so a note's outline sits on
  energy that may belong to other notes at the same pitch or to the overtones of lower ones. A ridge under an outline is
  necessary for a good alignment, not proof of it.
- Pedal and the room make notes ring on, so the picture runs on past the end of a note; the onset (left edge of the
  ridge) is what to compare.
- The rows run from C1 to B7 (84 semitones), so the 88 keys' extremes (A0 to B0, and C8) are not shown.
- Resolution is the transform's: its time resolution at the low notes is a good deal coarser than its 11.6 ms frame, so the picture is smooth rather than sharper there.
- It was judged only in screenshots; nobody has yet scrubbed through it.

## Rights

The spectrogram is derived from the recording. For private use it is on the same footing as the audio; if the site is ever published,
treat it like the audio (`docs/rights.md`). It is a reduction (86 columns a second, 168 rows, 8 bits, magnitude only: no phase) from which
the recording cannot be reconstructed, but it shows the performance.
