# Visual core (E4)

Code: `web/src/lib/visual/`. Page for developing scenes: `/stage` (`?hud` shows the performance HUD, `?q=0..5` pins a
quality level, `?scene=void|lanes|ember|plain`, `?codec=opus|aac`). The real interface (E7) will embed the same
`Stage.svelte` component.

Real-browser checks: `pnpm build && pnpm preview --port 4173`, then `pnpm visual-check` (frame times, seeks, crossfades,
pop test, leaks), `pnpm slow-check` (the governor on a slowed machine) and, for the score overlay, `pnpm notation-check`
(`docs/notation.md`), all in `web/`. Screenshots from the last run are in `docs/img/`. `/stage?score` adds the overlay.

## Pieces

| file                      | what it does                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyboard.ts`             | 88-key geometry (A0-C8: 52 white, 36 black, black keys offset as on a piano). `pitchToX(midi)` is the one mapping used by the keys and the notes.                                            |
| `palette.ts`, `colour.ts` | Design tokens: voice colours, background, key colours; `applyTokens()` sets them as `--voice-1`... on the document. Colour maths (Lab distance, colour-blindness simulation) for the checks. |
| `scene.ts`                | Scene config (palette, layout `keyboard`/`lanes`, camera, speed, window, effect strengths), `parseScene()` with path-reporting validation, `SceneManager` crossfade.                         |
| `presets.ts`              | `void` (default), `lanes`, `ember` (other palette), `plain` (no effects). E5 adds one scene per piece.                                                                                       |
| `notebuffer.ts`           | The note instance data, resident in one `Float32Array` (see below).                                                                                                                          |
| `keystate.ts`             | Pure function of the playhead: key down / glow / landing flare per key.                                                                                                                      |
| `particles.ts`            | Pool and emitter for note-on bursts (CPU side, no Three.js).                                                                                                                                 |
| `governor.ts`             | Performance governor: frame times in, quality level out.                                                                                                                                     |
| `shaders.ts`              | GLSL: notes, trails, keys, particles.                                                                                                                                                        |
| `stage.ts`                | `Stage`: the Three.js renderer, scene graph and per-frame work. Three.js is loaded with a dynamic import.                                                                                    |
| `Stage.svelte`            | Component: one canvas, one `Stage`, one frame loop; everything released on destroy.                                                                                                          |

## How a frame is drawn

1. `FrameLoop` reads the master clock (E3) and calls `stage.render(frame, notes)`.
2. The scene manager writes the current scene state (a crossfade is a blend of numbers).
3. `NoteBuffer.update` asks the note window for the index range that can be on screen and writes only the notes that
   entered it since the last frame (usually none). Note `i` lives in slot `i % capacity`, so a window of at most
   `capacity` notes never collides. A seek writes only what the new range does not already hold. Stale slots are
   harmless because the vertex shader culls by time (an old note is in the past, a far one in the future).
4. Key states are computed from the notes sounding now (88 × 4 floats).
5. Particle bursts are emitted for notes that began since the last frame. A seek, a jump back or a clock step over
   0.4 s emits nothing.
6. Uniforms are set and Three.js draws 5 calls: keys, trails, notes, hit line(s), particles.

The vertex shader derives every note's position from its start time and the time uniform, so the CPU does no per-note
work per frame. No object, colour or array is allocated per frame (checked by unit tests for the buffer, the emitter
and the scene manager).

## Layouts and crossfades

`keyboard`: notes fall onto an 88-key keyboard in perspective. `lanes`: time runs along x, one horizontal lane per
voice (lane centre by the voice's median pitch, pitch moves a note a little inside its lane).

The two layouts use perpendicular axes, so there is no sensible in-between shape (a first version blended the
positions and the notes collapsed into diagonal slivers halfway). A layout change is therefore a _dip crossfade_:
before the middle of the fade everything is laid out as the keyboard, after it as lanes, and the notes, trails and
particles fade out and back in around the middle (the keys are gone by the middle). Colours, camera, speed and
effect strengths blend linearly (smoothstep easing). Interrupting a fade starts the next one from the picture on
screen, so nothing jumps.

## The road, the lit lanes, steering and the keyboard (S6.4)

The keyboard with its lanes of falling notes is the picture of SkyRoads (1993): a ship on a road in perspective. What was taken
from it, and why that and not more:

| SkyRoads                          | Here                                                                                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lines on the road that give speed | faint lines between the keys' lanes (stronger at every C) and a line across the road at the start of every bar, scrolling with the notes; the bar lines are the real bar times of the piece, so the road also says where the bars fall                     |
| tiles that light under the ship   | under each sounding key a lane of light in its voice's colour, thinning away up the road                                                                                                                                                                   |
| the road comes from a horizon     | everything on the road fades toward the far end                                                                                                                                                                                                            |
| the ship leans into turns         | the view slides up to 3.2 units and banks up to 0.7° toward the middle of the notes that sound around now (`cameraSteer`: a bump of weight from 0.5 s back to 3 s ahead, peaking 0.4 s ahead, by velocity; a function of the playhead, continuous, tested) |
| obstacles, jumps, fuel gauges     | not taken: they are a game; the road must stay a background for the notes                                                                                                                                                                                  |

All of it belongs to the keyboard layout (it is gone in the lanes layout), is scaled by the scene's `effects.road` and `effects.steer`,
and is switched off by reduced motion (steering) and by the governor's glow level (road).

**A trap in the bloom path.** The bloom works in a half-float target. One NaN pixel there (a `pow` of a number slightly below zero at
the edge of a quad; a `smoothstep` with equal edges) is spread by the blur over the whole frame, which then goes black, or half
black while the NaN comes and goes with the frame. It showed as "with bloom on everything flashes to black". The road shaders now
clamp every `pow` base, floor every anti-aliasing width and force a finite output, and `pnpm ambient-check` renders eight frames
with bloom and requires none to lose its picture.

**The keyboard.** After the Hamburg Steinway D and the Bösendorfer Imperial: ivory-white keys with a polished rounded front edge,
dark gaps between them and a shade toward the back where they go under the fallboard; ebony black keys narrower at the top with
a sloping front, polished so that a studio softbox shows in their tops and edges; keys that pivot about their back end; and the
woodwork in black piano lacquer: a key slip with a thin gold line along the front, a block at each end and the bed under the keys.
A strip of **red felt** runs along the back of the keys, where they go under the fallboard, as on a Yamaha NU1 or a Steinway (and thin ones down the inside of the key
blocks, hardly visible from the viewing angle): matte wine red with a fibre grain (`FELT_FRAG`). Nothing but a lit key reaches the bloom threshold. The Imperial's extra nine bass keys (97 keys, the lowest nine black) are not
drawn: the music never goes below A0, and the keyboard would be wider on screen for nothing. Judged from screenshots only.

## Performance governor (T4.1.3)

Frame rate is measured over 0.5 s windows; the target is 60 fps.

| rule                                                | value                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| step **down** one level when fps is below           | `DOWN_FPS` = 50, for `DOWN_AFTER_S` = 2 s in a row                                            |
| step **up** one level when fps is at least          | `UP_FPS` = 55 (58 before T9.3.1: a 57 Hz display could never reach it), for `UP_AFTER_S` = 12 s in a row, and not within `HOLD_S` = 8 s of a step down |
| going up fails again within `RELAPSE_S` = 30 s      | the wait before the next attempt doubles (up to 96 s), so it settles                          |
| a gap longer than `STALL_S` = 0.25 s between frames | ignored (hidden tab, debugger, a seek that loads data) **unless** `SLOW_RUN` = 4 come in a row and none is over `SLOW_MAX_S` = 0.8 s: that is a machine making 1 to 4 frames a second, and its frames count (found in T9.3.3, `docs/performance.md`) |

| level | resolution cap (device pixel ratio) | particles | trails | glow | bloom (E6) | ambient layer (E6, size of the stage) |
| ----- | ----------------------------------- | --------- | ------ | ---- | ---------- | ------------------------------------- |
| 0     | 2                                   | 4096      | on     | on   | on         | 0.5                                   |
| 1     | 1.5                                 | 4096      | on     | on   | on         | 0.5                                   |
| 2     | 1.25                                | 2048      | on     | on   | off        | 0.4                                   |
| 3     | 1                                   | 1024      | off    | on   | off        | 0.3                                   |
| 4     | 1                                   | off       | off    | off  | off        | off                                   |
| 5     | 0.75                                | off       | off    | off  | off        | off                                   |

The order is cheapest-to-lose first. The HUD (`?hud`) shows fps, level, dpr, JavaScript ms per frame, draw calls,
triangles and the geometry/texture/program counts. `?q=N` pins a level and turns adaptation off. A 30 Hz display would
sit below 50 fps and end at level 5; that is accepted.

## Palette (T4.2.3)

| voice                          | colour    | name       |
| ------------------------------ | --------- | ---------- |
| 1 (highest)                    | `#F0E442` | yellow     |
| 2                              | `#009E73` | green      |
| 3                              | `#D55E00` | vermillion |
| 4                              | `#B79CFF` | lavender   |
| 5 (none of the pieces has one) | `#4FE3D1` | cyan       |

Four of them are from the Okabe-Ito colour-blind-safe set; the combination was chosen by a search over candidates. In
`palette.spec.ts` the four voices are at least 25 apart (CIE76; about 31 in the worst pair) for normal vision and for
simulated protanopia, deuteranopia and tritanopia (Machado 2009 matrices), the fifth is at least 15 from the others,
and every colour has a contrast ratio above 4.5 against the background `#05060a`. This is a simulation, not a test
with people who are colour blind.

## What was checked, and how

### Unit tests (`pnpm test`, 153 tests in 19 files; 11 of them for the score overlay)

Keyboard (counts, known pitches, spacing, monotone, black keys between whites), palette (the checks above), scene
(validation errors with paths, blending, crossfade length and smoothness, interruption, no allocation), note buffer
(compared against a brute-force scan after 400 random plays and seeks, including backwards and past either end; cost
per frame; no allocation), key states (onset, release, flare decay, same result however the playhead got
there), particles (sparks vs embers, nothing on a seek, cap and ring, bounded burst), governor (down, up, no
oscillation over 24 minutes, stalls, pinning), plus the new `range`/`startedBetween` queries of the note window and the
teardown of the audio graph and engine.

### Real browsers (`pnpm visual-check`, 2026-11-04, Windows 11, 1280×720)

Contrapunctus XI at its densest stretch (87 notes starting in one 6.5 s window), `/stage`, local `vite preview`.

| engine                             | GL renderer                                           | frame gap median / p95 / max (ms) | late frames (> 1.5 intervals) | JS per frame mean / p95 (ms) | longest gap during 4 crossfades |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------- | ----------------------------- | ---------------------------- | ------------------------------- |
| Edge 156 (Chromium)                | NVIDIA GeForce RTX 2070 SUPER (ANGLE, Direct3D 11)    | 16.7 / 16.8 / 16.9                | 0 of 481                      | 0.12 / 0.20                  | 17 ms                           |
| Firefox (Playwright)               | NVIDIA, name hidden by Firefox ("GTX 980 or similar") | 16.66 / 16.68 / 16.68             | 0 of 481                      | 0.23 / 1.00                  | 16.7 ms                         |
| WebKit (Playwright, Windows build) | "Apple GPU" (not real)                                | 16 / 17 / 267                     | 9 of 488                      | 0.15 / 1.00                  | 31 ms                           |

Same in all three: after 60 random seeks every visible note (3,698 checked) was resident with the right values (0
missing, 0 wrong); going elsewhere and back gave the same picture, pixel for pixel (same hash, 119,292 lit pixels in
all three); the governor went from level 0 down to 4 under 10 s of 20 fps frames and back to 0 under 66 s of 60 fps;
a lost WebGL context (`WEBGL_lose_context`) was flagged, restored and the picture came back; no shader program or
geometry was created during crossfades; 20 client-side trips away from the page and back left one live stage and the
same geometry/texture/program counts. In Chromium, a full heap snapshot after garbage collection showed 0 detached
DOM nodes and one renderer, and the same number of audio contexts, canvases and audio elements as after the second trip.

### Crossfade pop test (T4.1.2)

While the clock is paused only the scene changes. After every render the picture is read at 160x90 and the
frame-to-frame difference is computed (per 1/60 s, so a late frame does not count as a bigger step). A smooth fade is a
bell-shaped series; a pop is one step far above the median of the six steps around it. Six fades (void, lanes, ember,
void, plain, void), worst ratio of a step to its neighbours: **Edge 3.0, Firefox 3.05** (limit 4; 1.0 = nothing stands out). It was
1.8 before the keyboard rework and the wider framing (`HALF_WIDTH + 4.4`, so that the key blocks are not cut off); the limit was 2.5.
The ratio depends on how the thin lanes happen to fall on the 160x90 sampling grid while the camera moves: with the old framing
the same flow gives 2.2, and with the camera held still 1.6, with nothing visibly different, so this measures the phase of the
aliasing and not a jump. A real pop (the whole picture changing in one frame) would be a ratio many times higher. The layout
change (keyboard to lanes) is the noisiest, and its step at the swap point is the _smallest_ one of the fade (about 0.2 of 255
against a typical 1 to 2.5), as designed: everything is faded out there. The check for the same picture after a seek away and
back now allows blocks of 8x8 pixels to differ by 2 levels of 255: the trails leave a few dozen pixels (of 920,000) one to three
levels apart between two renders of the same frame (found while reworking the keyboard; not looked into further).
Steps below 1 of 255 are ignored: they are the 8-bit quantisation of a slow colour change. This finds a one-frame jump; it
cannot judge shimmer or whether a fade _looks_ good.

### Slow machines (T4.1.3, T4.2.2)

There is no weak machine here, so `pnpm slow-check` makes one: Edge with the GPU off (WebGL on SwiftShader, a software
renderer) at 1280x720 on the densest stretch of Contrapunctus XI, the governor free, 70 s each:

| machine                    | fps at start | level after                      | fps at the end | seconds below 50 fps after the first 15 s |
| -------------------------- | ------------ | -------------------------------- | -------------- | ----------------------------------------- |
| software GL                | 61           | 0 (never needed to adapt)        | 61             | 0 of 55                                   |
| software GL, CPU 4x slower | 54           | 3 (pixel ratio 1, trails off)    | 59             | 3 of 54                                   |
| software GL, CPU 8x slower | 40           | 5 (pixel ratio 0.75, no effects) | 56             | 3 of 54                                   |

The governor lowers the level until the frame rate recovers, settles, and now and then tries one level up (each try
costs about 2 s a little under 60 fps; the wait between tries grows). It never oscillated. This is a stress test of the
mechanism, not a measurement of a real phone or laptop: a real weak GPU is limited by fill rate, not by the CPU the way
this is.

**The reference machine (T4.2.2), as defined here:** the owner's desktop (RTX 2070 SUPER, Edge) is the reference for "60
fps on the densest piece": measured, 16.7 ms median frame gap, 0 of 481 frames late, 0.12 ms of JavaScript per frame.
Anything weaker is the governor's job, which the table above exercises. If another reference machine is meant (a given
laptop, a given phone), run `pnpm visual-check` and `pnpm slow-check` on it and replace this paragraph.

**How to read this.**

- The frame times are those of a desktop GPU (RTX 2070 SUPER) at 1280×720: 60 fps with 0.1 ms of JavaScript per
  frame says the CPU side is not the limit, not that a laptop or a phone will keep 60. There is no "reference
  machine" in this project yet; the governor is the answer for weaker ones, and it has only been exercised with
  synthetic slow frames, not on slow hardware.
- WebKit's numbers are not meaningful: Playwright's Windows WebKit reports a made-up GPU, and its animation frames
  arrive at irregular intervals (median 8 ms, one 267 ms gap). It shows the code runs and renders there, not how
  Safari behaves. Safari (macOS, iOS) is untested, as is retail Chrome.
- A picture hash equal in three engines shows the pixels are the same on these three, not that they look good. The
  screenshots (`docs/img/stage-*.png`) are the only record of how it looks; nobody has watched it move.
- Heap numbers: Chromium's DOM counters and `queryObjects` count garbage that has not been swept yet and showed a
  steady "growth" of about 70 nodes per trip; a heap snapshot after forced GC showed none of it was reachable. The
  heap itself grew by about 30 KB per trip, all V8 compiled code and feedback vectors (warm-up), no app objects.

## Bugs the browser run found

1. **Notes missing in the lanes layout.** The lane mapping swaps the along/across axes, which mirrors the quads, and
   Three.js culled them as back faces. The materials are now double-sided.
2. **Notes collapsed into slivers halfway through a layout change** (see "Layouts and crossfades"): replaced by a dip
   crossfade.
3. **Leaving the page did not stop the audio or close the audio context.** `PlaybackEngine.dispose()` removed its
   listeners and nothing else; a playing `<audio>` keeps playing when detached, and each visit left an `AudioContext`
   open. It now pauses, drops the source (aborting a download in flight) and closes the context
   (`AudioGraph.dispose()`).
4. **`history.replaceState` on every media event.** While paused, the URL was rewritten on every engine event (many a
   second); Firefox answers after about 200 calls in 10 s with "Too many attempts to navigate or modify history". It is
   now written only when it changes. (The bench page had the same code; both now use `openSession`.)

5. **`engine.piece` and `engine.bar` went stale during continuous playback** (found by the score overlay, see
   `docs/notation.md`): they were refreshed on media events only, which a buffered file hardly fires. The stage reads
   `engine.piece` each frame, so after a piece boundary it could have kept drawing the old piece. Fixed in the
   transport timer and the frame loops of the stage and the overlay (`docs/playback.md`).

One run in four of the WebKit check (Playwright's Windows build) once reported a different picture after seeking away
and back (183 of 119,000 lit pixels); two repeats were identical and the cause was not found. Edge and Firefox were
identical in every run. Treated as that build's frame-pacing irregularity, not proven.

## Not done / open

- **T4.4.1 notation overlay**: done, see `docs/notation.md` (Verovio's engraving by default, with the PDF's as the second source).
- **By eye**: whether the scenes look good, whether a layout change is free of a visible pop, whether the key flare
  and the sparks read well, whether the colours work for you. Only screenshots exist.
- **A real slow machine**: the governor's thresholds are reasoned and were exercised on a software-rendered, CPU-throttled
  browser (above), not tuned on a real weak laptop or phone.
- **Safari, retail Chrome, mobile**: untested. The camera fits the width of the keyboard, so on a narrow portrait screen
  the keyboard is small (layout for phones is E6).
- Per-voice median pitch for the lanes is computed once per piece when it is loaded (a pass over its notes).
