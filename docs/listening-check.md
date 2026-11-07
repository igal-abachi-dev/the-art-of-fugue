# The owner's listening check (2026-11-06)

This file is a record of a **person's report**, written down as it was given. It is not a measurement and it has no numbers in milliseconds.
The measurements are in `docs/sync-report.md` (44 reference points read off the waveform) and `docs/alignment-report.md`.

## What was done

On 2026-11-06 the project owner reported having **listened to all of the pieces** of the recording on the site, running locally, and answered the items that had been
waiting for a listener (the alignment QA and the piece boundaries, the note refinement and the problem areas, the sync acceptance, the score overlay), the four pieces
without a reference point, the three PDF-based pitch edits and Canon 2 bar 72. How the listening was set up (loudspeakers or headphones, which browser, whether the
spectrogram view was used) was not described, and is not recorded. The answers below are the owner's words, summarised.

## What the owner reported

| Question                                                                                        | Answer                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Does the picture sound-sync (notes landing with the sound) across the pieces?                   | **Yes: heard well, accurate, "synced well"** in all pieces                                     |
| Are the piece boundaries right (where each piece starts and ends in the recording)?             | listed among the items the owner judged good (T2.1.2); nothing wrong was reported             |
| Note timings, the ornaments, the fermatas, the ritardandi, the repeats taken in Canons 1 and 3? | judged good (T2.3.2, T2.3.3: the "problem areas" of `alignment-report.md`)                      |
| The score overlay (engraving, lit noteheads, cursor) against the sound?                         | good                                                                                           |
| The four pieces with no sync reference point (XIII rectus, XIII inversus, VI, Canon 3)           | **sound right**; no reference point is needed for them                                         |
| The three pitch edits that rest mostly on the PDF (IV bar 120, X bar 37, XI bar 81)              | **fine: the PDF is accurate** (`docs/mxl-pdf-check.md`)                                         |
| Canon 2 bar 72: the B-flat 4 that the MXL has and the PDF omits (the MXL's only cue note)        | **the MXL is correct**: the note belongs there and stays                                        |
| The sampler piano (E8, the piano button) against the recording                                   | **a bit off in rhythm compared with the recording; acceptable, because the recording is the main thing to listen to** |
| The Salamander piano's sound against the recording's                                            | lacks the recording's reverb, room depth, texture and articulations; **understood and accepted** |
| The shipped bitrates: Opus 128 kbps (primary) and AAC 160 kbps (fallback)                       | **fine**; the choice stays as shipped                                                          |
| The overall impression                                                                          | "great"                                                                                        |

## What this settles

- The sync of the picture to the sound, piece by piece, is judged good by ear. The earlier worry that the sync "was measured on the waveform, not heard" is answered for the
  whole recording at normal listening. The decision of `docs/decisions/alignment.md` (chroma DTW with note-level refinement) is confirmed; the transcription fallback
  (T2.2.2) stays unneeded, because its trigger (more than 10 % of the notes of a piece audibly wrong by over 80 ms) was not met.
- The alignment tasks that waited for a listener (T2.1.2, T2.2.1, T2.2.3, T2.3.2, T2.3.3, T2.3.5, T9.2.3) and the score overlay (T4.4.1) are closed in `backlog.md`.
- The three PDF-based pitch edits and the Canon 2 bar 72 question (open since E1) are closed: the data stays as it is.
- The bitrate question of T2.1.3 is answered by ear for the shipped pair: Opus 128 and AAC 160 stay. This was listening to those two files, **not a blind ABX** against Opus 96 or AAC 128,
  so it says the shipped files are good enough, not that the smaller ones would be worse. They would save 22 MB (Opus) and 19 MB (AAC).

## What it does not settle

- **No millisecond figure came out of it.** A listener cannot tell +26 ms from +10 ms. The waveform measurement (median 26 ms after the waveform's steepest rise, signed) is
  still the only number, and the output latency of a loudspeaker or headphones (not calibrated) is still unknown. They are small enough not to be heard in this check; if
  they ever are, the answer is a calibration setting, not a re-alignment.
- **No `"source": "ear"` reference points were written** to `data/sync-reference.json`, because no times were noted down. The format for adding them is in `docs/sync-report.md`.
- **The sampler's rhythm was heard to be a little off, and nothing was changed.** What is known: the piano plays each note at its aligned onset (`docs/sampler.md`), measured within 14 ms (Edge)
  and 26 ms (Firefox) of that onset; and the aligned onsets themselves lie a median of +26 ms after the instant the recording's level rises fastest (`docs/sync-report.md`), so the piano is
  likely to land about that much later than the recording's attack, besides the notes in dense passages whose onsets are less sure. **That is a candidate cause, not a finding**: it was not
  tested against what the owner heard. If it ever matters, the thing to try is an offset setting for the sampler only (a few tens of milliseconds earlier), judged by ear.
- **Only what was said is recorded.** The owner's general verdict covers what was seen and heard; no separate judgement was given for the per-piece scenes, the ambient layer's
  look, a phone, Safari or another machine. Those stay as they were in `README.md` and `docs/release.md`.
- It is one listener, one machine, one browser, one pair of loudspeakers or headphones.
