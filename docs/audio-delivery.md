# Audio delivery: encodes, hosting, browser support (T2.1.3, T2.1.4, T2.1.5)

Numbers come from `python -m artfugue.encode_audio --all` and `python -m artfugue.codec_delay`
(`data/work/audio/enc/encodes.json`, `delay.json`). ffmpeg 9.0.2 (Gyan full build) with `libopus` and the
native `aac` encoder.

## The four candidates (T2.1.3)

The source is the 48 kHz / 16 bit stereo WAV (80:32.5), already a decode of a lossy YouTube stream. Output stays
48 kHz stereo (no resampling). Commands (see `tools/artfugue/encode_audio.py`):

- Opus: `-c:a libopus -b:a <rate> -vbr on -application audio -f webm`
- AAC-LC: `-c:a aac -b:a <rate> -movflags +faststart -f mp4`

| file                 | target       | real size | real mean rate | duration   | timing offset against the WAV |
| -------------------- | ------------ | --------- | -------------- | ---------- | ----------------------------- |
| `fugue-opus96.webm`  | 96 kbps VBR  | 69.3 MB   | 115 kbps       | 4832.498 s | 0 ms                          |
| `fugue-opus128.webm` | 128 kbps VBR | 91.1 MB   | 151 kbps       | 4832.498 s | 0 ms                          |
| `fugue-aac128.m4a`   | 128 kbps     | 78.1 MB   | 129 kbps       | 4832.491 s | about -11 ms (-21 to -11)     |
| `fugue-aac160.m4a`   | 160 kbps     | 97.5 MB   | 162 kbps       | 4832.491 s | about -11 ms (-21 to -11)     |

Findings:

- **Opus VBR overshoots its target on this material**: "128 kbps" gives a 151 kbps mean (91 MB), more than the
  80 MB target of the backlog. "96 kbps" (69 MB) is within it. libopus puts more bits into the dense, long-decay
  piano passages.
- **Duration**: both Opus files are 8 ms longer than the WAV (one 20 ms packet), the AAC files are identical.
- **Priming delay** was measured by decoding 20 s excerpts from six places and cross-correlating with the WAV
  (ffmpeg honours the Opus pre-skip and the MP4 edit list). Opus: 0 ms. AAC: -10.7 to -21.3 ms, that is 512 to
  1024 samples, one AAC frame, so the AAC file sounds about 11 ms earlier than the WAV. The manifest
  carries `offset_s` per source (Opus 0, AAC +0.0107 s) so the clock can compensate. Browsers differ in how they
  treat the edit list, so this must be re-checked in Safari (T2.1.5).
- **Chosen by ear, not by blind test:** the site ships the higher pair (Opus 128, AAC 160). The owner listened to those two files on 2026-11-06 and found them fine
  (`docs/listening-check.md`). A blind ABX against Opus 96 / AAC 128 was not run; choosing the lower pair would save 22 MB / 19 MB and would leave the AAC file 22 MB under Vercel's 100 MB limit.
- **Not done:** checking whether the original YouTube Opus stream could be used as it is (no re-encode). The
  stream is not in `data/raw/`; only the ripped WAV is.

## Hosting limits (T2.1.4)

Checked against Vercel's published limits (search of vercel.com/docs/limits; some pages disagree, so confirm on the
dashboard before relying on them):

| limit                          | Hobby           | Pro           |
| ------------------------------ | --------------- | ------------- |
| static file upload             | 100 MB per file | 1 GB per file |
| Fast Data Transfer (bandwidth) | 100 GB / month  | 1 TB / month  |

- Both shipped files fit: Opus 128 = 91.1 MB, AAC 160 = 97.5 MB. **The AAC file is only 2.5 MB below the
  100 MB limit**; if the encoder settings change, check this again. AAC 128 (78 MB) would leave room.
- One listener fetches one file, so 100 GB is about 1,000 full plays with Opus 128 (about 1,100 with Opus 96).
  The project is private and non-profit (`docs/rights.md`), which fits the Hobby plan's terms.
- Fallback if a limit is hit: object storage (Vercel Blob or Cloudflare R2) behind the same URLs; R2 has no egress
  fee, Blob is billed by transfer. Nothing needs to change in the app except the `src` in the manifest.
- **Not verified:** HTTP range requests (seeking) on the deployed file. Nothing has been deployed yet. Local check:
  `pnpm preview` serves static files with range support, and `pnpm deploy-check` repeats the range requests (206, to the end, 416 beyond) through an emulator of `vercel.json`, but the Vercel edge is what counts (`docs/deploy.md`). The `src` in the manifest now carries a hash of the file (`/audio/fugue.webm?v=…`), which is what makes a year-long immutable cache safe.

## Browser support (T2.1.5)

`web/src/lib/audio/source.ts` ranks the sources of the manifest list (Opus, then AAC-LC) by `canPlayType(type)`:
"probably" before "maybe", empty means no. The types carry full codec strings: `audio/webm; codecs=opus` and
`audio/mp4; codecs="mp4a.40.2"`. The engine plays the first and **falls back to the next** if the element gets no
data 10 s after Start or reports an undecodable file (`docs/playback.md`), because `canPlayType` can be wrong.

Measured on 2026-11-04 with `pnpm browser-check` (headless, Windows 11, local `vite preview`; details and the full
table in `docs/playback.md`):

| browser                                       | `canPlayType` Opus / AAC | file used                                                     | plays after Start                           | seek ok   | clock offset ok                   |
| --------------------------------------------- | ------------------------ | ------------------------------------------------------------- | ------------------------------------------- | --------- | --------------------------------- |
| Edge 156 (Chromium; stands in for Chrome)     | probably / probably      | Opus (AAC when forced)                                        | yes, both files, sound reaches the analyser | yes, both | not measurable without a listener |
| Firefox (Playwright build)                    | probably / probably      | Opus (AAC when forced)                                        | yes, both files                             | yes, both | not measurable without a listener |
| WebKit 27.2 (Playwright, Windows)             | probably / probably      | **Opus claimed but never loads; fell back to AAC after 10 s** | AAC yes; no Web Audio in this build         | yes (AAC) | not measurable                    |
| Chrome (retail), Safari (macOS), Safari (iOS) | –                        | –                                                             | **not tested**                              | –         | –                                 |

Playwright's WebKit for Windows is not Safari: it lacks Web Audio, Opus and the Media Session API altogether, so it
says nothing about how Safari behaves. The AAC offset (about −11 ms against the WAV, applied through the manifest's
`offset_s`) is the codec's priming delay measured offline; whether each browser honours the MP4 edit list the way
ffmpeg does is not verified here.
