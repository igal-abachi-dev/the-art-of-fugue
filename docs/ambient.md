# Ambient layer and reactive effects (E6)

Behind the notes there is a MilkDrop picture (butterchurn); on top of them a bloom that breathes with the sound, a slow
camera drift and a small shake on the loudest passages. Everything is optional, lazy and falls away on a slow machine.

Try it: `/stage?scene=auto` (each scene has its preset). `?ambient=0` / `?bloom=0` turn the layers off, `?reduced` acts as the
system's reduced-motion setting (no drift, no shake, no ambient layer), `?hud` shows bloom and ambient strength.
`pnpm build && pnpm preview --port 4173`, then `pnpm ambient-check` (40 checks, Edge and Firefox).

## Where things are

| What                                                                   | File                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The layer (butterchurn under the notes): lazy load, blend, pause, size | `web/src/lib/ambient/ambient.ts`                                                               |
| Which presets exist and why                                            | `web/src/lib/ambient/curated.json` → `pnpm ambient-presets` → `static/data/ambient/<id>.json`  |
| Which scene shows which preset and how strongly                        | `web/src/lib/scenes/scenes.json` (`ambient: { preset, opacity }`, `effects.bloom/drift/shake`) |
| Signals from the sound: energy, three bands, onset pulse (T6.3.1)      | `web/src/lib/visual/signals.ts`                                                                |
| Energy of each voice from the notes (T6.3.2)                           | `web/src/lib/visual/voiceenergy.ts`                                                            |
| Bloom (T6.2.1)                                                         | `web/src/lib/visual/post.ts`                                                                   |
| Camera drift, shake, reduced motion (T6.2.2)                           | `web/src/lib/visual/motion.ts`                                                                 |
| Quality ladder (bloom at level 2, ambient layer at level 4)            | `web/src/lib/visual/governor.ts`, `docs/visual.md`                                             |
| Glue: canvases, audio feed, background colour                          | `web/src/lib/visual/Stage.svelte`, `stage.ts` (`listen`, `e6Info`)                             |
| Preset sweep and contact sheets                                        | `web/scripts/ambient-curate.mjs` (`pnpm ambient-curate`)                                       |
| The check                                                              | `web/scripts/ambient-check.mjs` (`pnpm ambient-check`, `--bench`, `--uncapped`)                |

## T6.1.1 Spike: butterchurn on the shared audio graph

**It works on the same `AudioContext` and the same `AnalyserNode`.** The layer asks the graph's analyser for its newest 1024
time-domain samples each frame and hands them to butterchurn as `audioLevels` (butterchurn's `render` accepts them), instead
of letting butterchurn tap the graph with analysers of its own. The graph's context is passed to `createVisualizer` (it
creates its nodes there, unconnected). While the music is paused the layer stops drawing and the picture holds still; it
feeds silence (128) when there is no analyser. Seeking does not reset it: it is a soft picture of the sound, not a function of
the playhead (the note effects are; see `docs/scenes.md`).

### Two ways to composite

|                                            | A: two canvases, stacked (chosen)                                                                                      | B: butterchurn drawn into a texture of the Three.js scene                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GL contexts                                | two (butterchurn owns its own)                                                                                         | two (the same)                                                                                       |
| Per frame, extra work                      | none: the browser composites the layers                                                                                | copy of butterchurn's canvas into a texture of the other context                                     |
| Measured (640 × 360, Edge, RTX 2070 SUPER) | 0                                                                                                                      | median 0.30 ms, p95 2.6 ms                                                                           |
| The notes over the picture                 | the Three.js canvas is transparent (`alpha: true`, cleared with alpha 0 while the layer shows)                         | exact blending inside one canvas                                                                     |
| Cost of being wrong                        | an additive glow is colour with alpha 0 (see `shaders.ts`); a compositor adds it over the layer, which is what we want | none                                                                                                 |
| Where it gets hard                         | the scene's background colour has to be given to the page behind the canvas (`Stage.backgroundCss`)                    | a copy between contexts is slow where the browser reads back through the CPU (Firefox has done this) |

**Recommendation: A.** It adds nothing per frame, keeps the Three.js canvas opaque (drawn exactly as before) whenever the
layer is off, and the layer can be turned off by a CSS `display: none` and no draw call. B only pays off if something has to
be blended inside the notes' shader, which nothing needs.

Frame rate, 1280 × 720, Edge on an RTX 2070 SUPER, playing Contrapunctus V, rAF with the frame-rate limit lifted
(`pnpm ambient-check --bench --uncapped`). The count is what the page can issue per second, so it ranks the cost, it does not
say how fast a given machine is:

|                                   | frames per second (unlimited) | stage JS per frame | butterchurn per frame |
| --------------------------------- | ----------------------------- | ------------------ | --------------------- |
| notes only (`?ambient=0&bloom=0`) | 4685                          | 0.07 ms            | –                     |
| + bloom                           | 3080                          | 0.85 ms            | –                     |
| + ambient layer                   | 660                           | 0.06 ms            | 1.4 ms (at 640 × 360) |
| both                              | 617                           | 0.19 ms            | 1.4 ms                |

With the limit on, all four give 60 fps on this machine, so there is plenty of room here; the governor is what protects a weaker
one. The ambient layer is the expensive part (about 7 times the work of the notes alone), the bloom about 1.5 times. That
is why the ladder gives the bloom up at level 2 and the ambient layer at level 4, and why the layer is drawn at 0.5 to 0.3 of
the stage's size (it is a soft background and the browser scales it up).

### Bundle and loading

|                                      | size                                           | when it loads                                          |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| three.js (already there)             | 743 KB, 185 KB gzip                            | with the stage                                         |
| butterchurn                          | 191 KB, 40 KB gzip                             | the first time a scene shows a preset (dynamic import) |
| bloom passes (composer, bloom, copy) | about 48 KB, 16 KB gzip                        | with the stage                                         |
| the 8 curated presets                | 51 KB in all (6.5 to 10.6 KB each), 16 KB gzip | one fetch per preset, when its scene first shows       |

`butterchurn-presets` has 1754 presets in about 3 MB; it is never bundled. Only the chosen ones are copied out of the
package (`pnpm ambient-presets`). The check proves that a page that never shows the layer fetches neither butterchurn nor a
preset, and that a visit fetches only the presets it needs.

## T6.1.2 Presets

The presets are chosen for the music, not for a show: plain stone for the plain fugues, a calm lake for the silences.
All 1754 were rendered with the recording's own audio (`pnpm ambient-curate stats`: 4 s at 30 frames a second, 320 × 180) and
measured: mean and peak luminance, the share of bright pixels, how much edge detail there is, and how many frames a second jump
in brightness by more than a tenth. 238 passed (dim, nothing bright over a large area, no flashing, still moving). About 50
of those were looked at on contact sheets, and the finalists were measured again over 20 s at three places in the recording
(Contrapunctus V, VIII and XIV): one that spiked to white later on (`martin - reflections on black tiles`, peak 1.0) was
dropped.

| scene (pieces)                 | preset id              | original                          | opacity | why                                                    |
| ------------------------------ | ---------------------- | --------------------------------- | ------- | ------------------------------------------------------ |
| idle (the gaps between pieces) | `blue-mountains`       | martin - blue mountains           | 0.50    | nothing to cover, so the most picture-like             |
| void (I to IV)                 | `underwater-cathedral` | Martin - underwater cathedral     | 0.16    | stone arches, no colour to compete with the voices     |
| counter-fugue (V)              | `night-forest`         | martin - night in the forest      | 0.25    | darker and more restless, still nearly black           |
| ribbons (VI, VII)              | `jellyfish-dance`      | martin - jellyfish dance          | 0.30    | flowing shapes that echo the wavy notes                |
| themes (VIII to XI)            | `hyperspace`           | Rovastar - Hyperspace             | 0.25    | grey, so the theme colours stay the only colour        |
| mirror (XII, XIII)             | `golden-mirror`        | martin - golden mirror            | 0.30    | a picture that is its own reflection                   |
| unfinished (XIV)               | `stormy-sea`           | martin - stormy sea (2010 update) | 0.35    | a horizon and nothing above it; fades with the ending  |
| canon (Canons 1 to 4)          | `escape`               | Che - Escape                      | 0.25    | lines receding to a point, one voice following another |

Measured over 20 s at the three places (full scale 1.0): mean luminance 0.04 to 0.27, at most 0.26 of the frames in a second
jump by a tenth. At the opacities above, the picture alone (notes hidden) has a mean brightness of about 9 out of 255 in the top
quarter of the screen and nothing brighter than about 27; with the notes the layer lifts that part of the screen by about 2.
The `ambient-check` checks it stays under mean 70 and peak 220.

A scene change blends the preset over `BLEND_S` = 2.5 s (butterchurn's own cross-blend), together with the scene's own fade
(0.9 s) of the opacity. During a blend butterchurn draws its blend pattern (rectangles and waves), which is short and only
shows at piece changes.

Credits: butterchurn and butterchurn-presets are MIT-licensed; each preset's author is in its name (martin, Rovastar, Che,
...). `curated.json` keeps the original names; the credits page (T7.5.3) takes them from there.

## T6.2.1 Bloom

`EffectComposer` with `UnrealBloomPass`, strength from the smoothed loudness of the sound (`signals.energy`): about 0.2 of the
scene's `effects.bloom` in silence rising to 1.0 at the loudest (`bloomStrength`). The threshold (0.93) sits above the resting
keys (about 0.9 at their brightest), so only lit notes, flares and pressed keys glow and the keyboard is not washed out. Under
a strength of 0.02 the stage skips the post chain and draws straight to the canvas. The governor turns it off at level 2
and frees its render targets; `?bloom=0` and the scene (`effects.bloom: 0`) turn it off too.

Two details that are easy to get wrong (and were): the canvas can be transparent, so the bloom's blend adds colour and leaves
alpha alone; and three converts a clear colour when it is set (to the canvas's space), so the bloom's render target is
cleared with the same colour object as the canvas and the final pass is a plain copy, not three's `OutputPass`. The check
compares the bloom path's empty background with the direct path's.

## T6.2.2 Camera

Drift: two slow sines (periods 47 and 29 s, 31 and 19 s), at most 0.55 × 0.3 world units (the keyboard is 88 keys of about
0.4 units), a function of the playhead. Shake: smooth noise at 11 Hz, at most 0.075 units, only when the **notes** are loud
(total voice energy above 0.74, full at 0.92: about the loudest tenth of the early pieces; the canons never reach it), times the
scene's `effects.shake`. Nothing rotates; the view slides. Both are pure functions of the playhead and the notes, so a seek lands
on the same camera as playing to it (checked). `?reduced` and the system setting turn both off. The idle scene has no shake.

## T6.3.1 Signals from the sound

`AudioSignals` reads the analyser's spectrum (`getFloatFrequencyData`) and keeps, smoothed (attack 40 ms, release 350 ms), all
0 to 1: overall `energy`, `low` (40 to 250 Hz), `mid` (250 Hz to 2 kHz), `high` (2 to 8 kHz), the spectral `flux` and an onset
`pulse` (jumps to 1, falls over 0.22 s, never twice within 0.18 s, so it fires at most 5 times a second; nothing in the picture flashes
with it today, it is there for the effects that follow). Each band is measured against its own slowly falling peak (42 dB range), so the level of
the recording does not matter. They are exposed on `Stage.signals` and in `e6Info()`; the bloom uses `energy`. The FFT is not
used to separate voices.

## T6.3.2 Voice energy from the notes

`voiceEnergy` gives each voice a 0 to 1 value from the notes sounding now and just ended: velocity times an envelope (bright
attack settling to 55 %, a 250 ms release), summed per voice and bent with `1 - exp(-1.4 x)`. It is a function of the playhead
alone (a test runs the queries in any order and gets the same values) and goes to the shaders as `uVoiceE[5]`. In the shaders it
makes the notes still to come for a voice glow more while that voice is playing hard; the notes that are sounding keep their E5
look (an earlier version brightened those too and blurred the white BACH notes). The shake also reads it.

## Quality and safety

| level | bloom | ambient layer (fraction of the stage) |
| ----- | ----- | ------------------------------------- |
| 0, 1  | on    | 0.5                                   |
| 2     | off   | 0.4                                   |
| 3     | off   | 0.3                                   |
| 4, 5  | off   | off                                   |

- The layer is drawn only when its opacity is above 0.004, hides its canvas otherwise, and is off in reduced motion.
- Bloom strength and the layer's opacity change smoothly (signals are smoothed; the scene fades the opacity). The presets chosen
  do not flash; the sweep counted frames whose mean brightness jumps by more than 0.1 and the picked ones are at most 0.26 a second.
- The ending of XIV fades the layer out with everything else (`dim`); the check shows it gone at the black.
- No WebGL2, a preset that does not load or a context that fails leaves the layer off and everything else running
  (`AmbientLayer.status`).
- Leaving the stage and coming back 8 times leaves one stage alive and no "too many WebGL contexts" warning (the layer
  loses its context when the stage is disposed).

## What is not judged

- The look. The screenshots are `docs/img/ambient-*.png` (the layer alone, the layer under the notes, bloom, the idle gap and
  reduced motion): whether the pictures suit each piece and are quiet enough for the user's eye, and whether the bloom is too faint
  now that the keyboard is spared, is for them.
- Frame rates on slower machines, Safari and phones (nothing here was run on WebKit).
- The preset sweep used the recording's audio at 30 frames a second in one browser (Edge on a GPU); butterchurn is audio-driven, so a preset can look different at another moment.
