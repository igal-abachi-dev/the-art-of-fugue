# web: the Art of Fugue site

SvelteKit (Svelte 5, TypeScript) static site with Three.js and the Web Audio API. The project overview, the data
pipeline and the rights are in the [repository README](../README.md); this file is about the app.

## Structure

| Path                                   | What it holds                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/data/`                        | Loaders for the manifest and the binary note chunks (`web/static/data/`).                                                                                   |
| `src/lib/playback/`                    | Audio graph, master clock, frame loop, playback engine, note-window query, deep links, Media Session, transport state. See `docs/playback.md`.              |
| `src/lib/visual/`                      | The Three.js stage: shaders, note buffer, key states, particles, scene system, palette, performance governor. See `docs/visual.md`.                         |
| `src/lib/notation/`                    | The score overlay: the engraved system that is playing, lit noteheads, the cursor. See `docs/notation.md`.                                                  |
| `src/routes/stage`, `src/routes/bench` | Development pages: the visuals on the real engine, and an engine bench. `/` is a placeholder until the interface exists.                                    |
| `static/data/`                         | Shipped data written by the pipeline (committed): `manifest.json`, `pieces/` (note chunks, events), `notation/` and `notation-verovio/` (score engravings). |
| `static/audio/`                        | Generated Opus and AAC encodes (not committed).                                                                                                             |
| `scripts/`                             | Pipeline entry points and the real-browser checks (Playwright).                                                                                             |

## Commands

```sh
pnpm dev                 # development server, http://localhost:5173
pnpm lint                # prettier and eslint
pnpm check               # svelte-check (types)
pnpm test                # vitest, 153 unit tests
pnpm build               # static output in build/
pnpm preview --port 4173 # serve the build, for the checks below

pnpm data                # rebuild all shipped data from ../data/raw (needs the Python tools and ffmpeg)
pnpm gen:types           # TypeScript types from ../schema

pnpm browser-check       # real browsers: playback, codecs, seeking, clock, range requests
pnpm visual-check        # the stage: frame times, seeks, crossfades, leaks, context loss
pnpm notation-check      # the score overlay, both engravings (Verovio's by default; add --source pdf for the PDF's)
pnpm slow-check          # the performance governor on a slowed machine
pnpm rate-check          # pitch preservation at 0.5x and 1.5x
pnpm scenes-check        # the per-piece scenes and annotation effects (E5)
pnpm ambient-check       # the MilkDrop layer, bloom, camera effects, signals (E6)
pnpm player-check        # the interface at / : every control, settings, deep link, phone size (E7)
pnpm sampler-check       # the piano (sampler) mode: lazy load, timing of the notes, pause, speed, failures (E8)
pnpm a11y-check          # axe-core over every state of the interface, and the contrast of the text over each scene (EN7.5)
pnpm flash-check         # WCAG 2.3.1 flashes of the combined frame, loudest part of every piece (EN7.5)
pnpm ambient-presets     # copy the curated presets from butterchurn-presets to static/data/ambient
pnpm ambient-curate      # render presets with the recording's audio and measure them (curation tool)
```

The browser checks drive Edge (Chromium), Firefox and WebKit through Playwright against the preview server. Install the
browsers once with `pnpm exec playwright install firefox webkit`; Edge is used as installed.

## Development pages

- `/stage`: the visuals driven by the real engine. Query parameters: `?hud` (performance HUD), `?q=0..5` (pin a quality
  level), `?scene=void|lanes|ember|plain`, `?codec=opus|aac`, `?score` (score overlay), `&notation=pdf` (the PDF's engraving; Verovio's is the default).
- `/bench`: the playback engine with its raw state and a clock-quality readout.
- Deep links on both: `?p=xii&bar=24` (piece and printed bar; `&pass=2` for the second pass of a repeated canon).
