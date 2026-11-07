# Testing (EN9.2: T9.2.1, T9.2.2, T9.2.3)

What is tested, how, and what the tests cannot say. The commands are in the README's table; this is the reasoning and the results.

## Unit tests (T9.2.1)

`pnpm test` (Vitest, no browser, about 1.5 s) and `pytest -q` in `tools/`. CI runs both.

**The clock** (`web/src/lib/playback/clock.spec.ts`, `clock.edge.spec.ts`, 23 tests, on a virtual clock and a fake media element that
updates `currentTime` in steps, stalls and seeks like a browser's). The edge cases a listener meets:

| Case                                                                 | Test                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| a seek while playing, while paused, before the element announces it  | lands at once, no glide from the old place, the first read already sees the discontinuity (epoch)         |
| a seek during a stall                                                | follows the new place, no jump when the data arrives                                                      |
| a stall                                                              | the clock freezes, resumes without a jump                                                                 |
| a change of speed                                                    | no jump, also across seven changes in a row; a change during a stall changes nothing until sound runs     |
| a hidden tab (no frames for 8 s)                                     | right at the first call afterwards                                                                        |
| the same seek again and again; a backward seek                       | every one is a discontinuity and lands exactly; time then runs forward                                    |
| the end of the recording                                             | stops at the end, does not run past it                                                                    |
| drift against the element                                            | corrected by slewing, no step larger than a frame; a disagreement over the threshold snaps and says so    |
| the AAC offset and the output latency                                | they add; paused and playing; no jump of their own                                                        |

**The data loader and the data that ships** (`web/src/lib/data/data.spec.ts` 9 tests, `integrity.spec.ts` 48, `version.spec.ts` 3 for the versioned URLs). The loader rejects a
buffer that is not a note chunk, a chunk of another version, and one that was cut short (a clear "truncated" message; before, a cut chunk
failed with a bare `RangeError`), and accepts an empty one. `integrity.spec.ts` loads the **committed manifest and every one of the 20 note
chunks** with the loader the page uses, and checks them against each other: the manifest's pieces are unique, in order and inside the
recording; the build id and the audio hashes are there; bars run forward inside their piece; every referenced file exists (notes, events, mirror,
both engravings, spectrogram, overview); each chunk has the notes the manifest says, sorted by onset, each ending after it begins, inside
its piece, in the keyboard's range, with a voice and a bar the piece has; every event points at notes that exist, in order; each mirror file
has one pitch per note. It needs no recording, so CI runs it: a broken pipeline run does not get past it.

**The pipeline** (`tools/tests/`, 68 tests): bar lengths, no overlaps, note counts, schema validation, the build id (`test_fingerprint.py`),
the sync acceptance (`test_sync_acceptance.py`), the entry and sparse-note masks of the alignment. The ones that need `data/raw` skip
without it.

## The end-to-end smoke test (T9.2.2)

`pnpm smoke-check` (Playwright, Edge and Firefox). Through the real interface, with the real audio: Begin; play four seconds and see the
clock and the time display move; click the middle of the seek bar and be there, playing; Next piece; Previous piece; Space to pause (the
clock stands still) and again to play; open `/credits` and `/stage`. It **fails on any console error, uncaught exception, failed request or
HTTP status of 400 or more** (except the browser dropping or caching a range request of the audio itself). Checked that the error watch works:
`--inject-error` makes the page log an error and request a missing file, and the run then fails (positive control). It is local, not in CI,
because the audio is generated and not committed; the CI build cannot play. The controls are examined one by one by `pnpm player-check`.

## The sync acceptance test (T9.2.3)

The tolerance (backlog.md): **median |note onset error| ≤ 30 ms, 95th percentile ≤ 80 ms.** The report is `docs/sync-report.md`, written by
`python -m artfugue.syncref`; `pnpm release-check` and CI run it and fail when the tolerance is exceeded.

**Reference points.** `data/sync-reference.json`, 44 notes in 16 of the 20 pieces and all 7 piece types, each with the time its attack was read
off the recording's **waveform**: the instant the level rises fastest, either over the whole band (150 Hz to 6 kHz; for notes that stand alone, such as
the beginnings of pieces and entries after a rest) or at the note's own pitch and first partials (notes no other note begins near). A search
window of −0.45 s to +0.30 s around the aligned time is used, so an alignment that is far off is found to be far off. Points are skipped only
where the recording has no clear attack or two comparable ones (359 of 404 candidates were). The measurement does not use the alignment's own
signals (the chroma and the CQT flux), but it **is not a person's ear**, and it covers isolated attacks only. (The owner has since listened to all the pieces and judged the sync good, with no numbers: `docs/listening-check.md`.) A point a person has listened
to can be added with `"source": "ear"` and is kept when the points are measured again.

**What it found, and what was done.** The first measurement (38 points) gave a median of 28.7 ms and a 95th percentile of **280 ms**, worst 298 ms: the first notes
of Contrapunctus XI and Canon 2, the second entry of Contrapunctus XIV and an entry in the second pass of Canon 1 were **250–300 ms late**, and an entry in
Contrapunctus I and one in Canon 4 were 130 and 170 ms late. Cause: chroma DTW can place the
beginning of a segment or an entry after a rest further out than the note-level refinement looks (±150 ms), and the refinement then keeps the
wrong time. The fix is in `timing.py`: notes that begin 0.6 s or more after everything before them has ended, and notes with no other onset within
0.35 s on either side, are looked for first in a window of ±0.45 s (the same peak finder as before, nothing else changes; the release moves
with the onset). After the re-run (1,202 of 32,370 note times moved, 379 by more than 50 ms, most in Contrapunctus XIV and Canons 2 and 4): median **26.0 ms,
95th percentile 35.1 ms, worst 36.7 ms**. The independent onset hit rate of `alignment-report.md` is the same or up to two points higher in every piece (no piece got
worse).

**What remains.** The errors are all positive and tight: the shipped onsets are a median of **+26 ms after** the instant of the steepest rise in the
level (+22 ms by the whole-band method, +29 ms by the per-pitch method; spread about 4 ms). That is the +19 ms the refinement adds to the CQT peaks
plus the difference between what the CQT and the waveform call an attack. It is inside the tolerance, with 4 ms to spare on the median, and
it was **not corrected**: the picture follows the clock, and the clock reads the audio element's time, which runs ahead of what leaves the loudspeaker by the
output latency (not calibrated, `docs/playback.md`; typically 20 to 60 ms on a desktop). The two roughly cancel; correcting one without measuring the other would
trade a known lateness for an unknown earliness. A person with a metronome-like click and the player would settle it (`MasterClock.setLatency` is
ready for the result). The margin is thin: any pipeline change that moves the notes later fails the test, which is the point.

**Not covered:** 4 pieces have no reference point (VI, XIII and its mirror, Canon 3: no note there stands alone with a clear attack), and nothing
checks the dense polyphony between the points. The acceptance is a floor, not a proof of sync.
