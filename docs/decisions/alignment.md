# Decision: how the score is aligned with the recording (T2.2.3)

**Status:** accepted; **confirmed by the owner's listening check of 2026-11-06** (all pieces judged in sync, `docs/listening-check.md`). The sections below are as they were written before that.

## Decision

Chroma DTW per silence-bounded segment, followed by note-level onset refinement. No piano transcription.

1. The pieces' places in the recording come from a per-piece subsequence search (`locate.py`).
2. Each segment of the recording is aligned with the symbolic chroma of its pieces by one global DTW at
   10 frames/s (`align.py`). The result is a monotone map from score ticks to seconds per piece.
3. Every note is moved to its own onset peak in a pitch-resolved CQT (`refine.py`), twice, the second time
   around a locally corrected time. Notes without a clear peak keep the corrected DTW time.

## Evidence (see `docs/alignment-report.md`)

|                                      | plain DTW | after refinement | chance level |
| ------------------------------------ | --------- | ---------------- | ------------ |
| onsets with a flux peak within 30 ms | 28-51 %   | 62-85 %          | 19-70 %      |

- The plain DTW is not good enough for note-level visuals: the refinement moves 95 % of the notes by less than 130-150 ms and the rest by more (one to two chroma frames).
- The refinement lifts the hit rate by 29-45 points in every piece. For the fast pieces (IX, XIII, Canon 1, Canon 4)
  the chance level is high (55-70 %), so the evidence is weaker there.
- 55-78 % of the notes have a clear onset (>= 3 dB) in their own pitch row after refinement; the rest sit in dense
  chords or under sustained notes, where an onset cannot be seen in the spectrum.

## What is not known

- **The actual error in milliseconds.** The AC asks for 30 hand-checked positions; none exist yet. The sync
  tolerance (T3.1.x) has not been fixed either; a visual sync is usually fine within about 50 ms.
  The numbers above show that most onsets are on a spectral peak, not that they are within 50 ms of the right one.
- Whether the release times (an estimate, written length x 0.92) are good enough for the visuals.

## Trigger for the fallback (T2.2.2, piano transcription)

Run the transcription spike only if, after the listening check, **more than 10 % of the notes of any one piece
are audibly wrong by more than 80 ms**, or if the 30 hand-checked positions show a median error above 50 ms or a
95th percentile above 120 ms after refinement and anchors (T2.3.4). Until then it stays at P3.

## Alternatives considered

- **One DTW over the whole recording**: a full cost matrix would need hundreds of GB; the per-piece search plus
  per-segment DTW needs under 0.5 GB and 10 seconds in total.
- **synctoolbox multi-resolution DTW** (backlog suggestion): not needed at these sizes; kept as an option if a
  finer feature rate (50 Hz) is wanted for the whole segment.
- **Fluidsynth rendering of the score**: not installed; the symbolic chroma (partials of a piano tone) removes
  the need for rendering audio and is exact in time.
