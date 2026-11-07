# Per-piece scenes (E5)

Each piece has a scene: a set of strengths for the shared visuals (`web/src/lib/visual`). Nothing is a separate renderer;
a scene turns effects up or down, and the shaders do the work from the playhead, so every effect is seek-safe.

## Where things are

| What                                                           | File                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Which piece gets which scene                                   | `web/src/lib/scenes/scenes.json` (`default`, `idle`, named `scenes`, `pieces`) |
| Scene fields and their checks                                  | `web/src/lib/visual/scene.ts` (`features`, `ending`, `palette.themes`)         |
| Annotation events on a bus (seek-safe)                         | `web/src/lib/scenes/eventbus.ts`                                               |
| Per-note tags from the events                                  | `web/src/lib/scenes/tags.ts`                                                   |
| Picks the scene at piece boundaries, starts rings and the flip | `web/src/lib/scenes/director.ts`                                               |
| Ending, flip, idle embers, shatter, canon links (CPU side)     | `web/src/lib/visual/effects.ts`                                                |
| Rate-capped shockwave rings                                    | `web/src/lib/visual/shock.ts`                                                  |
| Title card                                                     | `web/src/lib/scenes/TitleCard.svelte`                                          |

Try it: `/stage?scene=auto`. A piece missing from `pieces` gets `default`; between pieces the `idle` scene plays.

## The scenes

| Scene         | Pieces                 | What it does                                                                                                                       |
| ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| void          | I to IV                | no particles, no trails, subject entries brighter, others step back, inverted entries hollow with a bright rim                     |
| counter-fugue | V                      | a little glow and particles, subject highlights                                                                                    |
| ribbons       | VI, VII                | notes are wavy capsules; the annotation's ratio sets them: augmentation thick and slow, diminution thin and fast                   |
| themes        | VIII to XI             | colour by theme (S1 to S6), additive where themes overlap; clash and crossing rings                                                |
| mirror        | XII, XIII (both forms) | a faint ghost of the counterpart note in the paired piece, at the same time and voice; a flip when the inversus follows the rectus |
| unfinished    | XIV                    | themes, rings, white BACH notes, and the ending                                                                                    |
| canon         | Canons 1 to 4          | lanes layout; a thread from where each leader note sounded to where its follower will echo it                                      |

The choice follows the annotations, not the context notes: tests check that ribbons are on exactly where an entry has a ratio other than 1,
that highlights are on wherever the subject is inverted, and that links exist only where the annotations have canon links.

## Details worth knowing

- **BACH:** only the `exact` form lights up (10 statements in XIV). The transposed, inverted and retrograde matches are not shown.
- **Rings:** at most one every 0.36 s (under three a second) and 12 alive. They are rings, not screen flashes; the BACH notes are small areas. This keeps well inside the limits of T7.5.1.
- **Mirror ghost:** the counterpart pitch of each note comes from `pieces/<id>.mirror.bin` (one byte per note, 0 = none; every note of XII and XIII has one).
- **Canon links:** the leader note is already gone from the window when its follower is on screen (the offsets are longer than the look-ahead), so the thread starts on the hit line at the leader's pitch and ends at the follower. It shortens as the echo comes closer and brightens. Where a repeat has no counterpart for a leader note, that link is left out.
- **Piece tail:** the last piece (XIV) counts as playing for `tail_s` (5 s) after its audio end, so the ending can play out; without it the scene would switch to idle at the end.

## How to add a scene (T9.4.2)

A scene is a set of strengths, not a new renderer: you write a few lines of JSON and the shared shaders do the rest.

1. **Write the scene** in `web/src/lib/scenes/scenes.json`, under `scenes`. It is a *partial* configuration: say only what differs from `default`
   (the fields are in `web/src/lib/visual/scene.ts`: `effects` (glow, particles, trails, bloom, drift, shake, road, steer, each 0 to 1),
   `features` (highlight, ribbons, themeColour, ghost, shockwaves, bach, links), `palette`, `layout` (`keyboard` or `lanes`), `speed`, `camera`, `ambient`
   (`preset` from `web/src/lib/ambient/curated.json`, and `opacity`)).

   ```json
   "my-scene": { "id": "my-scene", "effects": { "glow": 0.7, "particles": 0.3 }, "ambient": { "preset": "escape", "opacity": 0.2 } }
   ```

2. **Give it to pieces** under `pieces` (`"c02": "my-scene"`, piece ids as in `docs/data-format.md`: `c01` to `c11`, `c12r`/`c12i`, `c13r`/`c13i`, `c14`, `k1` to `k4`).
   A piece that is not listed gets `default`.
3. **Run `pnpm test`.** A typo is reported with the entry it is in, for example `scenes.my-scene.effects.glwo: unknown key`, and so is a value out of range. The
   existing tests also pin which scene each piece has and why (ribbons exactly where an annotation has a ratio, links only where canons are annotated): changing a
   piece's scene means changing that expectation on purpose.
4. **Look at it**: `pnpm dev`, then `http://localhost:5173/stage?scene=auto&p=c02&bar=10` (the stage with the scene book; `&hud` for frame times, `&q=0` to pin the best quality).
5. **Check it**: `pnpm build && pnpm preview --port 4173`, then `pnpm scenes-check` (the right scene per piece), `pnpm flash-check` (a scene that glows or pulses harder must
   stay inside the WCAG 2.3.1 limits, `docs/accessibility.md`) and `pnpm perf-check` (the frame budget).
6. **A new effect** (something the shaders do not do yet) is code: a field in `scene.ts` (parsed and range-checked there), its use in `stage.ts`/`shaders.ts` or `effects.ts`
   (seek-safe: compute it from the playhead and the note data, never from state that depends on how you got there), a test next to it.

## The ending of Contrapunctus XIV (T5.7.2)

Measured from the data (WAV timeline, seconds):

|                          | time    |
| ------------------------ | ------- |
| last note onset (freeze) | 4824.67 |
| last note off            | 4824.93 |
| `audio_end` of XIV       | 4825.06 |
| shatter (freeze + 1.2 s) | 4825.87 |
| black (shatter + 3.2 s)  | 4829.07 |
| recording ends           | 4832.50 |

The freeze, shatter and fade are pure functions of the playhead: the notes stand still from the freeze, the picture breaks into particles at the shatter,
and everything fades to black by the end. Seeking back before the freeze restores the normal picture; seeking into the burst gives the same burst again.
`pnpm scenes-check` checks the held notes, the shatter, the black screen and the return after a seek in Edge and Firefox.

### Measured against the recording

The recording was measured (loudness in 50 ms steps and spectral flux) around the end:

|                                       | time (s)         | what the audio does                                                                                         |
| ------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| last clear attacks                    | 4823.70, 4824.06 | data onsets 4823.79 and 4824.02, within about 0.1 s                                                         |
| last note (D, voice 3, soft, bar 239) | 4824.67          | only a faint attack near 4824.78; the level is already falling (-32 dB, against -11 to -17 dB in the music) |
| freeze                                | 4824.67          | the picture holds the last note while it rings                                                              |
| shatter                               | 4825.87          | the tail is at about -47 dB, nearly gone, so the break comes as the sound ends                              |
| black                                 | 4829.07          | the room tone is about -63 dB until 4830, then the file fades to -87 dB                                     |

So the recording does end on the last notated bar: no further attack follows the last note, only the decay and room tone.
This is a reading of the data and the waveform, not a listening test; if the shatter feels early or late, the constants at the top of `web/src/lib/visual/effects.ts` (`FREEZE_S`, `BLACK_AFTER_S`) move it.

## Checks

`pnpm scenes-check` (needs `pnpm build` and `pnpm preview --port 4173`): scene choice, effect counts, pixels, ring rate, flip, ending, title card and idle, with screenshots in `docs/img/scene-*.png`.
