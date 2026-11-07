# Shipped data format (T2.4.1, T2.4.2, T2.4.3)

Written by `python -m artfugue.export` (part of `pnpm data`) into `web/static/data/`. The web app fetches the files at
runtime (`web/src/lib/data/manifest.ts`, `notes.ts`); nothing is imported into the JavaScript bundle.

## Files

| File                      | Content                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.json`           | audio sources, the column layout, and one entry per piece: title, kind, `audio_start`/`audio_end`, `repeats_taken`, voices, **bars with times** (`n`, `t` seconds on the WAV timeline, `pass` when repeats are played, `conf`, `anchored`), file names of the two chunks |
| `pieces/<id>.bin`         | the timed notes of one piece as typed-array columns (below)                                                                                                                                                                                                              |
| `pieces/<id>.events.json` | annotations (subject entries, B-A-C-H, clashes, crossings, canon and mirror links) with start and end time in seconds, one record per pass for repeated pieces                                                                                                           |

20 pieces are shipped (`c01`-`c11`, `c12r`, `c12i`, `c13r`, `c13i`, `c14`, `k1`-`k4`). The four excluded early versions are not.

## Binary note chunk ("AFN1")

Little endian. 16-byte header (`'AFN1'`, u32 version = 1, u32 note count, u32 0), then the columns in the order of
`manifest.notes_format`, each padded to 4 bytes so a typed array can view it without copying:

`t_on` f32, `t_off` f32 (seconds on the WAV timeline), `tick` u32 (score onset, ppq 24), `pitch` u8 (MIDI), `voice` u8
(1 = highest), `vel` u8 (0-255), `conf` u8 (0-255), `bar` u16 (printed bar number), `flags` u16 (bit i = `manifest.flags[i]`:
grace, trill, mordent, inverted-mordent, turn, inverted-turn, fermata, staccato), `pass` u8.

Notes are sorted by `t_on`. For Canon 1 and 3 the notes are the played (unfolded) version. The time axis is the WAV's;
for a given audio source add its `offset_s` (Opus 0, AAC +0.0107 s, see `audio-delivery.md`).

## Size budget

|                                       | raw        | gzip -9                 |
| ------------------------------------- | ---------- | ----------------------- |
| all note chunks (20 files)            | 680 KB     | 321 KB                  |
| all event files                       | 183 KB     | not measured separately |
| manifest                              | 89 KB      | 22 KB                   |
| **total**                             | **952 KB** | **368 KB**              |
| largest chunk (XI, about 3,000 notes) | 64 KB      | 27 KB                   |

**Budget:** all shipped data below 2 MB raw, no single note chunk above 100 KB, manifest below 150 KB. The numbers above
are 48 % / 64 % / 59 % of that. The audio (91 + 97 MB) dwarfs all of it. Whether the host compresses `.bin` files
(binary content type) has not been checked; the chunks are small enough not to matter.

## Round trip test

`tools/artfugue/export.py --fixture` writes the first 40 notes of Contrapunctus I as `web/src/lib/data/fixtures/c01-head.bin`
plus the expected column values (`.json`). `data.spec.ts` parses the binary with the TypeScript loader and compares every
column; `tools/tests/test_audio_timing.py::test_binary_chunk_round_trip` does the same in Python.

## Rebuild

`pnpm data` (in `web/`) rebuilds everything from `data/raw/` in about one minute (55 s measured, without the ffmpeg
encodes and the QA clips). Options: `pnpm data -- --encode` (adds the four ffmpeg encodes, about 4 minutes more),
`--force-audio` (recomputes the cached audio analysis and piece search), `--no-qa`. The audio files are copied to
`web/static/audio/` (git-ignored).
