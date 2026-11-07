# Playback engine and master clock (E3)

Code: `web/src/lib/playback/`. Bench page: `/bench` (a stand-in for the stage and interface of E4/E7).
Real-browser check: `pnpm build && pnpm preview --port 4173`, then `pnpm browser-check` (in `web/`).

## Pieces

| file                  | what it does                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph.ts`            | `<audio>` → `MediaElementSource` → `Analyser` → `Gain` → destination. Built only in `unlock()`, which the Start click calls. Falls back to a prefixed `webkitAudioContext`; without Web Audio the element still plays, only analysis is lost. `needsCors`/`setMediaSource` set `crossOrigin` before `src` for a file from another origin. |
| `clock.ts`            | `MasterClock.now()`: smooth seconds on the WAV timeline.                                                                                                                                                                                                                                                                                  |
| `frameloop.ts`        | One `requestAnimationFrame` loop that reads the clock imperatively and keeps running while paused.                                                                                                                                                                                                                                        |
| `window.ts`           | `NoteWindow.query(t, lookAhead, lookBehind)`: active, upcoming and recently ended notes.                                                                                                                                                                                                                                                  |
| `engine.ts`           | `PlaybackEngine`: element, graph, clock, source choice and fallback, seeking, rate, per-piece data. Framework-agnostic.                                                                                                                                                                                                                   |
| `transport.svelte.ts` | `Transport`: Svelte 5 runes state for the interface (status, piece, bar, coarse position, spinner).                                                                                                                                                                                                                                       |
| `links.ts`            | Piece/bar addressing and deep links (`/?p=xii&bar=24`, `&pass=2` in the repeated canons).                                                                                                                                                                                                                                                 |
| `mediasession.ts`     | Media Session API: title, play/pause/seek, previous/next piece.                                                                                                                                                                                                                                                                           |
| `session.ts`          | `openSession(audioEl)`: manifest, graph, engine, transport, Media Session and the deep-link URL (written only when it changes) in one call; used by `/bench` and `/stage`.                                                                                                                                                                |
| `fakes.ts`            | Fake media element and virtual time for the tests.                                                                                                                                                                                                                                                                                        |

## The clock (T3.1.2)

`currentTime` of a media element moves in coarse steps (10 to 70 ms depending on browser) and jumps. The clock
interpolates between steps with `performance.now()` and bends the interpolation toward each fresh sample at
no more than 25 % of real time, so the output never goes backwards and never steps by more than a fraction of a
frame while correcting drift.

- **Paused, seeking, stalled, ended** (`paused || seeking || ended || readyState < 3`): returns the element's own time.
  A seek is therefore visible on the very next read, also while paused.
- **Playing**: `anchor + (now − anchorPerf) × rate`, corrected toward the element's time by at most `0.25 × dt` per
  call. A sample more than 0.2 s from the prediction is treated as a discontinuity: the clock snaps and counts it
  in `snaps`.
- **Discontinuities** increase `clock.epoch`: at once on a jump of more than 0.2 s that is read while the clock is not
  advancing (a seek, whose `seeking` event the browser dispatches a task later), and on every media event that
  re-anchors. Renderers refill their buffers when the epoch changes. (A first version missed this: the frame
  after a seek had the new time but no discontinuity flag. The browser check showed it.)
- **Rate change**: re-anchored from the prediction, not the element, so there is no jump.
- **Offset**: the result is on the WAV timeline: element time + the source's `offset_s` (AAC +10.7 ms) − `latency`.
  `latency` (output latency) is 0 until it is calibrated (T9.2.3).
- **Known bias**: a fresh sample is on average half a step old, so the clock runs about half a step (5 to 35 ms)
  behind the element's true position. This is inside the sync tolerance only if that tolerance is wider than
  the step; it is the first thing to check in T9.2.3.

## Current piece and bar (found in E4)

`engine.piece` and `engine.bar` are recomputed by `engine.update()`. Until E4 that happened only on media events
(`playing`, `seeked`, `progress` and so on), which a fully buffered local file hardly fires while it plays: in a browser
run `engine.bar` still said 1 after 17 s of playback (Contrapunctus I has a new bar every 2 s). Anything that reads
`engine.piece` per frame (the stage, the score overlay) would have kept the old piece after a piece boundary until an
event came. Now `Transport` calls `engine.update()` on its 10 Hz timer and the stage and overlay call it on every
frame (two binary searches). Regression test: `transport.spec.ts`, "follows the bar and the piece through
uninterrupted playback".

## Speed and pitch (T3.1.3)

`setRate` clamps to 0.5 to 1.5 and sets `preservesPitch`. `pnpm rate-check` measures the result in the browser instead
of by ear: it plays the same 8 s of Contrapunctus I at 1x, 0.5x and 1.5x through the page's analyser, and compares the
pitch-class profile (best circular shift between the profiles, correlation) and the spectral centroid. Edge 156 and
Firefox: shift 0 semitones, correlation 0.997 at 0.5x and 0.99 at 1.5x, centroid ratio 0.99 and 1.02. The control, the
same at 1.5x with `preservesPitch` off, reads 7 semitones sharp and a centroid ratio of 1.53 in both, so the check can
see a shift when there is one. This says the pitch is preserved, not that the time stretch sounds good (smearing of
attacks at 0.5x is for a listener to judge).

## Note window (T3.1.4)

Notes are sorted by `t_on`. Upcoming notes are one index range (two binary searches). Active and recently ended
notes may start far back (held notes), so a prefix maximum of `t_off` bounds the scan. All output goes to
preallocated typed arrays; a query allocates nothing. On the densest piece (Contrapunctus XI, 3,035 notes) one
query takes about 0.1 µs in Node (the budget is 1 ms). A test compares it against a brute-force scan at 400 times
including before, between and after the notes.

## Source choice and fallback (T2.1.5, T3.2.3)

`rankAudioSources` lists the playable sources, "probably" before "maybe", Opus before AAC. The element gets the
first. **`canPlayType` can be wrong**: Playwright's WebKit answers "probably" for WebM/Opus and then never
loads it, with no error event. So the engine arms a watchdog on Start: if the element still has no metadata
after 10 s (or reports `MEDIA_ERR_DECODE`/`MEDIA_ERR_SRC_NOT_SUPPORTED`), it switches to the next source, applies
that source's offset and continues from the same position. `engine.fallbacks` records why. A network error
(`MEDIA_ERR_NETWORK`) does not trigger a fallback; `reload()` retries with the same file.

Before Start the element has `preload="metadata"`, so opening the page does not fetch the ~90 MB file.

**Teardown.** `engine.dispose()` pauses the element, removes its source (`load()` with no source aborts a download in
flight) and closes the audio context (`AudioGraph.dispose()`). Without it a detached `<audio>` keeps playing after
the page is left, and every visit would leave a context open (found by the E4 leak check, `docs/visual.md`).

## Deep links (T3.2.2)

`/?p=xii&bar=24` (slugs: `i`…`xiv`, `xii-inv`, `xiii-inv`, `canon-1`…`canon-4`; the data ids also work).
`pass=2` selects the second hearing of a printed bar in Canons 1 and 3. A seek lands 80 ms before the bar line.
The bench page updates the URL (`history.replaceState`) when paused or when the piece changes, and restores it on load.
Unknown pieces are ignored; an unknown bar falls back to the piece start.

## What was checked, and how

### Unit tests (`pnpm test`, 75 tests in 11 files, 63 of them for playback)

Clock (interpolation within one quantum, smoother than raw, seek while playing and paused, stall, pause, rate
change without a jump, 0.5 % hardware drift over 10 minutes with no step above one frame and no snap, snap on a
silent jump, offset), frame loop (keeps ticking while paused, shows the paused seek on the next frame), graph
(nothing created before `unlock()`, synchronous connection, no Web Audio, iOS interruption, CORS order),
note window (brute force comparison, held notes, truncation, no allocation, speed), engine (state machine,
buffering and recovery, blocked play, seek by piece/bar/offset, rate, lazy data, fallback), transport (coarse
position, spinner delay), links, Media Session (with a fake session).

### Real browsers (`pnpm browser-check`, 2026-11-04, Windows 11)

Playwright drives the installed **Microsoft Edge 156 (Chromium)**, **Playwright's Firefox**, and **Playwright's WebKit
27.2 (Windows build)**; headless, no audio hardware, local `vite preview` server (HTTP 206 range responses).
"auto" lets the page choose the codec; "opus"/"aac" force one.

| engine  | codec | file used                                     | sound in analyser          | clock vs wall over 5 s | seek while playing, to 3000 s: ms until >0.2 s played | paused seek shown in next frame, 60 fps | 1.5×: clock s per 3 s wall | max step error | max distance from element |
| ------- | ----- | --------------------------------------------- | -------------------------- | ---------------------- | ----------------------------------------------------- | --------------------------------------- | -------------------------- | -------------- | ------------------------- |
| Edge    | auto  | Opus                                          | yes                        | 5.21 / 5.21            | 223                                                   | yes                                     | 4.48                       | 6.6 ms         | 13.6 ms                   |
| Edge    | opus  | Opus                                          | yes                        | 5.22 / 5.22            | 235                                                   | yes                                     | 4.48                       | 7.0 ms         | 8.1 ms                    |
| Edge    | aac   | AAC                                           | yes                        | 5.20 / 5.19            | 237                                                   | yes                                     | 4.51                       | 6.5 ms         | 17.4 ms                   |
| Firefox | auto  | Opus                                          | yes                        | 5.15 / 5.20            | 308                                                   | yes                                     | 4.53                       | 8.8 ms         | 71 ms                     |
| Firefox | opus  | Opus                                          | yes                        | 5.16 / 5.20            | 302                                                   | yes                                     | 4.55                       | 8.8 ms         | 73 ms                     |
| Firefox | aac   | AAC                                           | yes                        | 5.22 / 5.24            | 246                                                   | yes                                     | 4.53                       | 8.8 ms         | 43 ms                     |
| WebKit  | auto  | Opus claimed, **fell back to AAC after 10 s** | no Web Audio in this build | 5.22 / 5.23            | 244                                                   | yes                                     | 4.51                       | 6.4 ms         | 19 ms                     |
| WebKit  | aac   | AAC                                           | no Web Audio in this build | 5.17 / 5.19            | 242                                                   | yes                                     | 4.52                       | 28.8 ms        | 24 ms                     |
| WebKit  | opus  | never loads (no fallback when forced)         | –                          | –                      | –                                                     | –                                       | –                          | –              | –                         |

Also seen in all three: `Accept-Ranges: bytes` and `206` responses for both files; the URL follows the position
(`?p=viii&bar=25` after a paused seek to 1500 s) and a reload with it comes back in Contrapunctus VIII, paused;
Edge and Firefox published the piece title through `navigator.mediaSession`.

**How to read this.**

- It shows that the code path works in the Chromium, Gecko and WebKit engines, that both files seek and play,
  that the clock follows real time, and that a seek or a rate change never makes it jump. The largest step
  error is below one frame (16.7 ms) except one 28.8 ms sample in WebKit with forced AAC (a single run, not
  investigated).
- It does **not** show what a person hears. There is no audio hardware, so the analyser proves that decoded sound
  reaches the graph, not that it is in sync with the picture. Edge is Chromium but not Chrome; Playwright's
  Firefox is not the retail build; **Playwright's WebKit for Windows is not Safari** (no Web Audio at all,
  no Opus, no Media Session). Safari on macOS and iOS are therefore still untested, and iOS-specific behaviour
  (play() inside the gesture, `interrupted` context state, read-only `volume`, `preservesPitch` on
  `playbackRate`) is handled in the code from documentation only.
- "Max distance from element" is how far the smoothed clock is from `currentTime`. In Firefox the element's own time
  moves in steps of up to about 70 ms, which is where the large figure comes from; the clock is the smoother
  of the two.
- Seek cost (220 to 310 ms) includes the 0.2 s of playback the check waits for, so the audio itself resumed within
  about 20 to 110 ms of a seek into unbuffered data on a local server. On a deployed server it will be longer.

## Not done / open

- Safari (macOS, iOS) and retail Chrome: not run. The table in `audio-delivery.md` records only what was measured.
- Output latency calibration (`MasterClock.setLatency`) and the real audio-to-visual offset: needs a person (T9.2.3 measured the data's side: the shipped onsets are a median of +26 ms after the waveform's steepest rise, `docs/testing.md`; the clock's own edge cases are tested, `clock.edge.spec.ts`).
- Range requests and seek latency on the deployed Vercel file: nothing is deployed; the range answers and headers were checked through an emulator of `vercel.json` (`docs/deploy.md`).
- Webm Cues: the Opus file's seek index position was not checked; seeking works over 206 responses in Chromium and Gecko.
