# The Art of Fugue: an interactive audio-visual site

A static web site that plays a real recording of Bach's _The Art of Fugue_ (BWV 1080) and draws the music as it
sounds: falling notes on a concert-grand keyboard, one colour per voice, particles, a MilkDrop-style picture behind
them, and the engraved score and the recording's spectrogram with the sounding notes lit. Everything on screen follows the recording, not a synthesizer: the score was aligned to the audio note by
note, and the audio element is the master clock.

J.S Bach bwv1080 visual analysis/reverse engineering of the fugues, and musicology utilities, and sampler....


Built with SvelteKit (Svelte 5), Three.js and the Web Audio API, hosted as plain static files. The data pipeline is Python.
No server code runs at play time.


**Status: built, not deployed; the sync has been listened to and judged good by the owner (`docs/listening-check.md`).** The data pipeline, the playback engine, the visual core, the score overlay and spectrogram,
the per-piece creative scenes (E5), the ambient MilkDrop layer with the bloom and camera effects (E6), the player interface (E7), the sampler mode (E8) and the
quality and release work (E9: deployment settings and caching, tests, the frame budget, the low-power fallback, the soak test, the release checks) are built and
measured (see [Status](#status)). **Nothing is deployed**, the recording may not be hosted publicly without the performer's permission (`docs/release.md`),
and nobody has yet judged how it looks, moves and sounds on a real phone or in Safari. The audio-to-picture sync was measured on the waveform (44 points) and then listened to by the owner across all pieces, who found it good; that listening gave no millisecond numbers.

## Build it and hear it at localhost:4173

You need Node 20.19 or newer and pnpm (`corepack enable pnpm`). Nothing else: the shipped data (`web/static/data/`) is in the repository.

```powershell
cd web
pnpm install
pnpm build
pnpm preview --port 4173
```

Or run **`.\run.ps1`** from the repository root: it does the same steps (installing and building only when needed), refuses to start if something else already uses the port (a leftover server would show an old build; `-KillOld` stops it), and opens the browser. `-Rebuild` forces a build, `-Port 4180` picks another port. If PowerShell refuses to run scripts: `powershell -ExecutionPolicy Bypass -File .\run.ps1`.

Open **http://localhost:4173**, click **Begin** (browsers keep the sound off until you click) and choose a piece. Stop the server with Ctrl+C.
Use Edge, Chrome or Firefox; Safari and phones are not tested. `pnpm preview` serves the finished build in `web/build`, so run `pnpm build` again after you change anything.
If the port is busy, Vite takes the next one and prints it; add `--strictPort` to make it fail instead.

**The sound needs the two audio files** in `web/static/audio/`: `fugue.webm` (Opus, 91 MB) and `fugue.m4a` (AAC, 98 MB). They are generated from the recording, not committed, and
`pnpm build` copies them into `web/build/audio/`. Check with `dir web\static\audio`. Without them the pages, the score and the spectrogram all load, but nothing plays. To make them you need the source files in
`data/raw/` (see [Source files](#source-files)), Python 3.12 with the tools' virtual environment and ffmpeg (see [Windows setup](#windows-setup-from-nothing)):

```powershell
cd web
pnpm data -- --encode      # rebuilds the shipped data from data/raw and encodes the audio: about six minutes
pnpm build
pnpm preview --port 4173
```

To work on the code instead of listening: `pnpm dev` serves it with hot reload at http://localhost:5173 (the audio is served the same way). Putting it on GitHub and on Vercel: [`deployment.md`](deployment.md).

## What is in it

- **Score data for all 20 pieces** (Contrapunctus I to XIV with both versions of the mirror fugues, and the four canons): notes with voices,
  bars and ornaments from the OpenScore MusicXML, checked against the engraved PDF notehead by notehead, with the two
  pieces the MXL lacks supplied (`docs/mxl-pdf-check.md`).
- **Audio alignment**: the 80-minute recording is cut into pieces and every note gets an onset and a release time
  (chroma DTW, then onset refinement), with a confidence. Opus (primary) and AAC (fallback) encodes, served as static files
  with range requests.
- **Playback engine**: a master clock interpolated from the audio element, seeking, speed 0.5x to 1.5x with the pitch
  preserved, deep links (`?p=xii&bar=24`), Media Session controls, a note-window query for the renderers.
- **The player** (`/`, E7): one toolbar over the stage. Views (score, spectrogram) at the left; repeat and A–B loop, the
  transport (previous piece, −10 s, play/pause, stop, +10 s, next piece) and the time display in the middle; voices,
  volume fader, speed and the panel buttons (pieces, what am I hearing, effects, go to, copy a link, help, fullscreen) at
  the right. The seek bar is a DJ-style overview of the whole recording: loudness as a waveform with each voice's pitch
  drawn on it, a number at every piece, the loop as a band. Begin opens the list of pieces to choose from. Keyboard
  shortcuts for everything (`?` lists them), settings remembered, a start screen with a warning about moving light and a
  calm start, a credits page. The skin is hardware-like: brushed graphite, red felt pinstripe, walnut cheeks, red LEDs.
- **Sampler mode** (E8): the piano button (or `S`) plays the notes of the piece on a sampled grand piano (Salamander, CC BY 3.0, 2 MB, fetched on first use) at the recording's timings, while the recording runs silent as the clock; the picture does not change. `docs/sampler.md`.
- **Visual core** (`/stage`, and behind the player): instanced falling notes on an 88-key concert-grand keyboard (ivory and
  polished ebony keys, black lacquer, red felt) or in lanes, a SkyRoads-like road with lane and bar lines, lanes of light
  over the sounding keys and a camera that leans toward the notes, trails, spark and ember particles, a scene system with
  crossfades and per-piece scenes (E5), a colour-blind-safe palette, and a performance governor that lowers quality when
  frames get slow.
- **Ambient layer** (E6): MilkDrop presets (butterchurn) chosen per piece behind the notes, a bloom that follows the
  loudness, camera drift and shake; all of it off with "calm".
- **Spectrogram** (`/stage?spectro`, and the player's button): the recording's quarter-tone spectrogram (168 rows, 86 frames
  a second, drawn up to 4096 px wide, translucent) scrolling past a playhead with every note drawn on it in its voice
  colour, to judge by eye whether the notes sit on the sound.
- **Score overlay** (`/stage?score`, and the player's button): the engraved system that is playing, as vector graphics on
  cream, slightly see-through paper, with the sounding noteheads lit in their voice colour and a cursor that follows the
  performance. Two engravings: Verovio's from the MXL (default) and the PDF's own (`&notation=pdf`, or the effects menu).

## How it fits together

```
 data/raw/ (not in the repository)            tools/ (Python)                       web/ (SvelteKit)
 ------------------------------------         ---------------------------------     ------------------------------
 OpenScore MXL  ----------------------+       score:    MXL -> notes, voices, bars
 Contrapunctus Press PDF -------------+--->    audit:    PDF noteheads vs notes       web/static/data/   (committed)
 recording (WAV) ---------------------+       audio:    chroma DTW + onsets    --->    manifest, note chunks, events,
                                              export:   typed-array note chunks        notation (PDF and Verovio)
                                              notation: engraved systems + heads      web/static/audio/  (generated,
                                              spectro:  quarter-tone spectrogram         not committed: Opus + AAC)
                                              overview: loudness + voice pitches
                                              checked MXL: data/derived/
```

At run time the page fetches `manifest.json`, one note chunk per piece and, for the overlay, one notation file per
piece. Three.js and the overlay load lazily, so the first page stays small.

## Repository layout

| Path                                           | What it holds                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/`                                         | The SvelteKit app: playback engine, visual core, score overlay, development pages (`/bench`, `/stage`), real-browser check scripts. See `web/README.md`. |
| `tools/`                                       | The Python data pipeline (`artfugue` package) and its tests.                                                                                             |
| `data/derived/`                                | `art-of-fugue.pdf-checked.mxl`: the MXL with the PDF's pitches and the two missing pieces.                                                               |
| `data/anchors.json`, `data/pdf_overrides.json` | Hand-made inputs: bar times that override the alignment, and pitch changes confirmed by hand with their evidence.                                        |
| `data/raw/`, `data/work/`                      | Source files and intermediate output. Git-ignored; `raw` is never committed.                                                                             |
| `schema/`                                      | JSON Schemas of the pipeline's files; `pnpm gen:types` turns them into TypeScript types.                                                                 |
| `docs/`                                        | Design notes, measurements, decisions and rights. Start with the index below.                                                                            |
| `generalization-plan.md`                       | The plan for using the player and the tools on other works (the WTC, Beethoven, Chopin, ...), with the research behind it.                                |
| `deployment.md`                                | How to put it on GitHub and Vercel, and how to publish a private preview with the audio.                                                                 |
| `backlog.md`                                   | The plan as epics, stories and subtasks with acceptance criteria and status.                                                                             |
| `plan.md`, `context.md`                        | The first brainstorm and the creative direction the backlog grew from.                                                                                   |

## Getting started

Needs Node 20.19 or newer with pnpm, and for the data pipeline Python 3.12 (the librosa/numba stack does not support 3.14), ffmpeg
and the source files in `data/raw/`. Developed and tested on Windows 11 (PowerShell, Git Bash).

### Windows setup, from nothing

```powershell
# tools (once)
winget install OpenJS.NodeJS.LTS Python.Python.3.12 Gyan.FFmpeg astral-sh.uv Git.Git
corepack enable pnpm              # or: npm install -g pnpm   (a new terminal after the winget installs)

# the web app
cd web
pnpm install
pnpm exec playwright install firefox webkit    # for the browser checks; Edge is the installed one (channel "msedge")
pnpm dev                          # http://localhost:5173  (the player at /; development pages: /stage, /bench)
pnpm lint; pnpm check; pnpm test  # formatting, types, unit tests (about 20 s together)
pnpm build                        # the static site, in web/build

# the data pipeline (needs data/raw, see below)
cd ..\tools
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
cd ..\web
pnpm data                         # rebuild everything shipped from data/raw (about a minute and a half)
pnpm data -- --encode             # also the Opus and AAC encodes (about four more minutes; ffmpeg is found on PATH or in winget's folder)
```

`web/static/data/` is committed, so the app runs without the pipeline. The audio files (`web/static/audio/`, 91 and 98 MB)
are generated and not committed: without them the pages load and draw, but nothing plays. On Linux or macOS the same commands work
with `.venv/bin/python` and forward slashes.

### From raw to data to site

```
data/raw/ (MXL, PDF, WAV) --pnpm data--> data/work/ (intermediate, git-ignored) --> web/static/data/ + web/static/audio/ --pnpm build--> web/build --> host
```

`pnpm data` is `python -m artfugue.build_all`, in this order (each step is also a module you can run alone, `python -m artfugue.<name>`):

| Step | Module(s)                                | Reads                      | Writes                                                                                  |
| ---- | ---------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| 1    | `build_score`, `annotate`                | the MXL, the PDF audit     | `data/work/score/`: notes, voices, bars, ornaments, subject entries and other events     |
| 2    | `audio_analysis`, `locate`, `timing`     | the WAV                    | `data/work/audio/`, `data/work/timed/`: where each piece lies in the recording, every note's onset and release |
| 3    | `qa`                                     | the above                  | listening clips, spectrograms, `docs/alignment-report.md`                                |
| 4    | `export`                                 | `data/work/timed`          | `web/static/data/manifest.json`, `pieces/*.bin` (typed-array note chunks), events; the audio copies |
| 5    | `notation`, `spectro`, `overview`        | the PDF, the WAV, the notes | the score overlay data, the spectrogram tiles, the seek bar's strip                       |
| 6    | `samples`                                | the Internet, once         | the piano samples for the sampler mode                                                   |
| 7    | `fingerprint`                            | `web/static/`              | the build id in the manifest and a hash in each audio `src` (what the long cache is safe because of, `docs/deploy.md`) |
| 8    | `make_docs.py`                           | the above                  | the tables in `docs/`                                                                    |

Not in `pnpm data`: the Verovio engraving (`python -m artfugue.notation_mxl`, `node web/scripts/notation-verovio.mjs`, `python -m artfugue.notation_verovio`;
`docs/notation.md`) and `python -m artfugue.syncref --measure` (new reference points for the sync acceptance, `docs/testing.md`).
After changing anything that moves note times, run `python -m artfugue.notation_verovio` and `python -m artfugue.fingerprint` again.

### Adding a scene

A scene is a few lines of JSON in `web/src/lib/scenes/scenes.json` and a line saying which pieces get it; the unit tests catch typos and the
browser checks look at the result. Step by step in `docs/scenes.md`, "How to add a scene".

### Source files

Not in the repository, put them in `data/raw/`:

| File                                              | Source                                                 |
| ------------------------------------------------- | ------------------------------------------------------ |
| `bach-the-art-of-the-fugue.mxl`                   | OpenScore transcription, CC0                           |
| `IMSLP742925-PMLP5843-...Contrapunctus_Press.pdf` | Contrapunctus Press reference score CP 0101, via IMSLP |
| `... Marta Czech [p1Sq1HOYglU].wav`               | the recording (see Rights)                             |

## Tests and checks

| Command (in `web/` unless noted)             | What it checks                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm check`, `pnpm test`       | formatting, types, 412 unit tests (clock and its edge cases, engine, note window, the integrity of the shipped data, scene system, governor, overlay, player logic, ...)                                                                                                         |
| `pytest -q` and `ruff check .` (in `tools/`) | 68 tests of the pipeline and the shipped data (the spectrogram and overview files, the build id, the sync acceptance); the ones that need `data/raw` skip without it                                                                                     |
| `pnpm browser-check`                         | playback in real browsers: codec choice and fallback, seeking, the clock, range requests                                                                                                                                   |
| `pnpm visual-check`                          | the Three.js stage in Edge, Firefox and WebKit: frame times, note residency after seeks, crossfades (including a pop test), leaks, context loss                                                                            |
| `pnpm notation-check`                        | the score overlay in both engravings: the right system, lit noteheads, the cursor                                                                                                                                          |
| `pnpm slow-check`                            | the performance governor on a slowed machine (software rendering, CPU throttled 4x and 8x)                                                                                                                                 |
| `pnpm scenes-check`                          | the per-piece scenes (E5): the right scene per piece, highlights, ribbons, themes, ghost, links, BACH, the ending (30 checks)                                                                                              |
| `pnpm player-check`                          | the interface at `/` in Edge and Firefox (103 checks each): every control and the state it leaves, the toolbar order, score and spectrogram, deep link, stored settings, auto-hide, a phone-sized window, the credits page |
| `node scripts/look.mjs`, `look-player.mjs`   | not checks: screenshots of the stage and of the player (controls, panels) for looking at                                                                                                                                   |
| `pnpm ambient-check`                         | the ambient layer and the reactive effects (E6): lazy loading, presets per piece, bloom, camera, signals, leaks, no black frames with bloom (41 checks)                                                                    |
| `pnpm spectro-check`                         | the spectrogram view in real browsers: tiles, width, the notes on the sound                                                                                                                                                |
| `pnpm sampler-check`                         | the piano mode in Edge and Firefox (21 checks each): lazy load, silent recording, the notes on the aligned onsets, pause, speed, switching back, failures                                                                  |
| `pnpm a11y-check`                            | axe-core over every state of the interface (Edge and Firefox), the contrast of every text and icon on pixels, and of the title card over each piece's scene                                                                |
| `pnpm flash-check`                           | WCAG 2.3.1 flashes of the combined frame, the loudest 15 s of each piece, the end of the last fugue and a positive control (Edge)                                                                                          |
| `pnpm deploy-check`                          | the Vercel settings against the build: every file immutable or revalidated as it should be, the build id and audio hashes, byte ranges and headers through an emulator of `vercel.json` (`docs/deploy.md`) |
| `pnpm smoke-check`                           | the first minute of a listener, through the real interface in Edge and Firefox: Begin, play, seek, switch piece, pause; fails on any console error or failed request (`docs/testing.md`) |
| `pnpm perf-check`                            | the frame budget at 1080p and 4K-class on the densest piece, and the low-power fallback on an emulated phone and a very weak machine (`docs/performance.md`) |
| `pnpm soak-check`                            | the whole recording (80 minutes) in one page: memory, dropped audio, clock drift (`docs/performance.md`) |
| `pnpm release-check [--public]`              | the release checklist: nothing forbidden in the build, the sync acceptance, the warning, the credits, the open rights items (`docs/release.md`) |
| `pnpm rate-check`                            | that the pitch is preserved at 0.5x and 1.5x, measured with the analyser                                                                                                                                                   |

The browser checks need `pnpm build && pnpm preview --port 4173` running, and Playwright's browsers. **Run them one at a time**: two browsers at once slow the page enough for the performance governor to step down, and checks that need the whole picture then fail for no fault of the page. They run real
browsers on a real machine; they cannot say how it looks or sounds. Checked so far: Edge (Chromium) and Playwright's
Firefox and WebKit. Safari, iOS and phones are not tested. A GitHub Actions workflow (`.github/workflows/ci.yml`) is
written but has not yet run. On the development machine Edge sees the 4K display at about 57 Hz, and Playwright's Firefox did not keep a steady frame rhythm in some runs, which made the one `player-check` check that waits for a steady 55 fps on a phone profile fail there once or twice; the last full sequential pass is 103/103 in both (`docs/performance.md`).

## Documentation

| Document                                                                                                      | Content                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/mxl-pdf-check.md`                                                                                       | Do the MXL, the PDF and the recording agree? The corrections, the added pieces, the repeats, the end of the last fugue, and the bars still in doubt. |
| `docs/mxl-pdf-rhythm.md`                                                                                      | The same comparison for note values, ties, ornaments and staccato (a screening, with its limits).                                                    |
| `docs/recording-vs-score.md`                                                                                  | Where the recording plays a semitone away from the printed note (a checklist for comparing with the Henle edition).                                  |
| `docs/score-data.md`, `docs/data-format.md`                                                                   | The note data and the shipped binary format.                                                                                                         |
| `docs/mxl-inventory.md`, `docs/mxl-vs-pdf.md`, `docs/pdf-audit.md`, `docs/voices.md`, `docs/annotations.md`   | What is in the MXL, how it maps to the PDF, the notehead audit, voice assignment, subject entries and other annotations.                             |
| `docs/audio-analysis.md`, `docs/audio-delivery.md`, `docs/alignment-report.md`, `docs/decisions/alignment.md` | The recording, the encodes and hosting, the alignment method and its measured quality.                                                               |
| `docs/playback.md`                                                                                            | The clock, the engine, source fallback, seeking, speed.                                                                                              |
| `docs/visual.md`                                                                                              | The visual core, the governor, the palette, measured results.                                                                                        |
| `docs/scenes.md`                                                                                              | The per-piece scenes, the annotation effects and the ending of XIV.                                                                                  |
| `docs/ambient.md`                                                                                             | The MilkDrop layer, bloom, camera drift and shake, the signals; the compositing spike and the preset curation.                                       |
| `docs/sampler.md`                                                                                             | The sampler mode: samples, scheduler, timing source and the rights question, what was measured.                                                      |
| `docs/accessibility.md`                                                                                       | Less motion, flashes (measured against WCAG 2.3.1), phones, axe-core and contrast: methods, numbers, what was found.                                 |
| `docs/interface.md`                                                                                           | The player: controls against a desktop player's, how it is built, what was found, what was measured.                                                 |
| `docs/notation.md`                                                                                            | The score overlay and its two engravings.                                                                                                            |
| `docs/spectrogram.md`                                                                                         | The spectrogram view: the recording's sound with the notes on it.                                                                                    |
| `deployment.md` (root), `docs/deploy.md`, `docs/testing.md`, `docs/performance.md`, `docs/sync-report.md`, `docs/release.md` | Deployment and caching, the tests and the sync acceptance, the frame budget / low power / soak, the sync report, and the release checklist. |
| `docs/listening-check.md`                                                                                     | The owner's listening check of 2026-11-06: what was heard and judged, and what it does not settle.                                                   |
| `docs/rights.md`, `docs/mvp.md`                                                                               | Licences and rights, and the first vertical slice.                                                                                                   |

## Status

| Epic                              |                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E0 Foundations and decisions      | done                       | tooling, rights audit, MVP slice, schemas                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E1 Score data pipeline            | built                      | review items remain (subject detector against the score; CI has not run)                                                                                                                                                                                                                                                                                                                                                                                              |
| E2 Audio and timing alignment     | built, listened to: good   | the owner listened to all pieces (2026-11-06); no written-down timing positions exist, the waveform points are the only numbers                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E3 Playback engine and clock      | built                      | Safari and iOS untested; hosting limits not tested on the deployed site                                                                                                                                                                                                                                                                                                                                                                                               |
| E4 Visual core and score overlay  | built                      | the overlay's sync judged good by the owner; the stage's look not separately reviewed                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E5 Per-piece creative scenes      | built                      | not yet judged by eye; the ending's sync was measured on the waveform, not heard; Safari untested                                                                                                                                                                                                                                                                                                                                                                     |
| E6 Ambient (MilkDrop-style) layer | built                      | the pictures and the bloom strength not yet judged by eye; Safari and weaker machines untested                                                                                                                                                                                                                                                                                                                                                                        |
| E7 Interface                      | built                      | the player at `/` (hardware-panel skin; DJ-style overview seek bar; transport, volume, speed, repeat and A–B loop, voices, score and spectrogram buttons, effects menu, piece list, info, go to, help, start screen, credits); `pnpm player-check`. Open: picture-in-picture, a level meter, a gapless loop, iPhone fullscreen; accessibility, flashes and the phone start are measured (`docs/accessibility.md`); not judged by eye on a real phone; Safari untested |
| E8 Sampler mode                   | built                      | the piano switch at the recording's timings (`docs/sampler.md`, `pnpm sampler-check`); listened to: a little off in rhythm and without the recording's room, accepted; an even-tempo piano, Safari and iOS not done                                                                                                                                                                                                                                                                                                                  |
| E9 Quality, performance, release  | built, not deployed        | Vercel settings and cache versioning (`docs/deploy.md`), CI written (never run), the smoke test, the sync acceptance (44 waveform reference points: median 26 ms, 95th percentile 35 ms; it found and fixed entries 250-300 ms late), the frame budget (a frame at every refresh at 1080p and at 4K-class, `docs/performance.md`), the low-power fallback (found and fixed a governor that never reacted at 4 fps), an 80-minute soak (no dropped audio, memory settles), the release checks (`docs/release.md`). **Open:** nothing is deployed; the recording's permission for a public release; output latency; not judged by eye or ear; Safari and phones |                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

The backlog has the detail, including what is open in each finished epic.

## Rights

Private, non-profit use. What the repository contains and what it does not:

- **The recording** (Marta Czech, BWV 1080) belongs to the performer and the label. It is not in the repository and
  must not be hosted publicly without permission; the Opus and AAC encodes are generated locally and git-ignored.
- **The score engraving** is the Contrapunctus Press reference score (CP 0101, Dr. Dominic Florence), licensed
  CC BY-NC-SA 4.0. Data and drawings derived from it (the notehead positions, the SVG pages, the pitch spellings of
  the checked MXL) carry the same licence and the credit, which the app shows under the score.
- **The MusicXML** is the OpenScore transcription, CC0.
- **Libraries**: Three.js (MIT), butterchurn (MIT), Svelte and SvelteKit (MIT). Verovio (LGPL-3.0) runs at build time
  only and nothing of it is shipped to the browser.
- A licence file for the project's own code has not been chosen yet.

Details and open questions: `docs/rights.md`.
