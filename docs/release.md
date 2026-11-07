# Release checklist (T9.4.1)

Two kinds of release, one script: `pnpm build && pnpm release-check` checks a **private preview** (the technical items must hold, the
rights items are reported); `pnpm release-check --public` checks a **public release** (every rights item must also be cleared). Add
`--require-audio` when the audio files should be in the build (they are generated, so a CI build has none).

The script ticks what a script can tick. The rest is a person's, and is kept in `data/release.json` with its evidence.

## Technical items (the script fails if one is not met)

| Item                                                                                                   | How it is checked                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No raw WAV or other unlicensed material in the deployed build                                          | `build/` has no `.wav .flac .aiff .pdf .mxl` or archive; no file is a raw source or named after one (`data/raw`); the only audio under `audio/` is the two encodes the manifest lists, and neither is a WAV (RIFF header); the only MP3s are the 30 piano samples; nothing is over 100 MB |
| Sync report attached                                                                                   | `python -m artfugue.syncref` passes the project's tolerance (median 30 ms, 95th percentile 80 ms) on the shipped timings, and regenerates `docs/sync-report.md`, which must say PASS |
| Photosensitivity warning present                                                                       | the built app's start screen carries the "Moving light" warning, says what it is about, and offers the calm start; `docs/accessibility.md` documents the WCAG 2.3.1 flash measurement (`pnpm flash-check`) |
| Attributions shown                                                                                     | the credits page names the performer, the reference score and its licence (CC BY-NC-SA 4.0), OpenScore (CC0), the piano samples (CC BY 3.0), Verovio, three.js and butterchurn |
| A private deployment                                                                                   | `X-Robots-Tag: noindex` in `vercel.json`, `robots.txt` disallows everything                                                                              |

Also run before a release (they need the audio and a display, so they are not part of the script): `pnpm player-check`, `pnpm smoke-check`,
`pnpm a11y-check`, `pnpm flash-check`, `pnpm perf-check`, and the soak (`pnpm soak-check`, 80 minutes). Their last results are in `docs/performance.md`,
`docs/accessibility.md` and `docs/testing.md`.

## Rights items (a person decides; `data/release.json`)

State on 2026-11-06 (from `docs/rights.md`; not legal advice):

| Item                                                                  | Status      | What is needed                                                                                                   |
| --------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| The recording (Marta Czech) on a public URL                           | **open**    | the performer's or the label's permission. Until then: private, non-profit preview, or a link to her video       |
| The score engraving and data drawn from it (CP 0101)                  | cleared     | CC BY-NC-SA 4.0 (read from the PDF); non-commercial use, credit, ShareAlike for derived data                      |
| The IMSLP file page still shows that licence                          | **open**    | look at IMSLP's page for the file once, before going public                                                      |
| The MusicXML (OpenScore)                                              | cleared     | CC0                                                                                                              |
| The piano samples (Salamander V3)                                     | cleared     | CC BY 3.0, credited                                                                                              |
| The sampler mode plays the recording's aligned timings                | **open**    | the owner's decision (`docs/sampler.md`): accept it, or build the even-tempo piano from the score                |

So today the answer to "ready for a public release?" is **no**: the recording's permission is the blocker, and it is not a technical one.
Ready for the **private preview**: yes, as far as the checks go; the preview itself has not been deployed (`docs/deploy.md`).

## Known limits to read before a release

- Nothing has been judged by eye or ear on a real phone, in Safari, or on iOS (README, "Status").
- The sync was measured on the waveform at 44 isolated attacks; the dense polyphony between them is not covered by a reference point (`docs/sync-report.md`). The owner has listened to all the pieces and judged the sync good (2026-11-06, `docs/listening-check.md`); that report has no numbers and no ear-checked points.
- The delay between the clock and the loudspeaker (output latency) is not calibrated (`docs/playback.md`).
- The GitHub Actions workflow has never run.
