# The interface (E7)

The page at `/` is a music player with the stage behind it: the recording, its notes falling onto a keyboard, and the
controls a listener expects from Winamp, foobar2000 or MusicBee, in one bar over the picture. Code: `web/src/lib/player/`.
Browser check: `pnpm player-check` (T7.6.1). Look at it: `node scripts/look-player.mjs --panels pieces,effects`.

## What a desktop player has, and where it is here

| Desktop-player control             | Here                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play, pause, stop                  | buttons and `Space`/`K` (stop pauses and returns to the start of the piece)                                                                                       |
| Previous / next track              | previous / next **piece** (`[` `]`); previous restarts a piece first                                                                                              |
| Seek bar, elapsed / remaining time | seek bar over the whole recording with a tick at every piece, the buffered range and a tooltip (piece, bar, time); click the time to switch elapsed and remaining |
| Seek ±, frame step                 | ±5 s and ±30 s (arrows), ±10 s (buttons), previous / next **bar** (`,` `.`) in place of the frame                                                                 |
| Volume, mute                       | slider with a square law (gain = slider²), wheel, `↑` `↓`, `M`; muting keeps the slider's place                                                                   |
| Playback speed                     | 0.5× to 1.5× (menu, `Shift+,` `Shift+.`, `Backspace`), pitch always kept                                                                                          |
| Repeat one / all, A–B repeat       | `R` cycles off, piece, all; `A` marks start, end, clear; Alt-drag on the bar; points snap to bar lines                                                            |
| Shuffle                            | not applicable: the order is the work                                                                                                                             |
| Playlist                           | the piece list (`P`): lengths, current piece marked, keyboard as a listbox                                                                                        |
| Now playing, tags                  | the title and bar beside the buttons, in the page title, and "what am I hearing" (`I`)                                                                            |
| Visualiser                         | the stage; the effects menu (`E`) chooses scene, ambient picture, glow and calm                                                                                   |
| Equaliser, DSP, plug-ins, skins    | not adopted: one recording, one designed look                                                                                                                     |
| Media keys, lock screen            | Media Session (T3.2.4)                                                                                                                                            |
| Remembered settings                | `localStorage`; a link's position wins; nothing plays until Begin                                                                                                 |
| Hotkeys                            | `?` shows them (generated from the same table that binds them)                                                                                                    |
| Fullscreen                         | button, `F`, double click                                                                                                                                         |

Also: show or hide voices 1 to 4 on the stage (`1`–`4`, Shift to solo; the sound is the recording and is not affected),
"copy a link to this bar", a start screen with a warning about moving light and a calm start, a credits page.

## The skin (T7.2.6, T7.7.1)

The look takes two models. **The panel** is hardware, after a Moog, a Virus TI, a Nord, a Clavinova and the racks of Reason: brushed
graphite with a **red felt pinstripe** along the top (the red of the keys' felt), **walnut cheeks** at its ends, banks of buttons sunk
into the face with a red LED over the ones that are on, a big round play button with a ring of light while it plays, a **red
display** (title, bar, time; click the time to switch elapsed and remaining), the volume as a **fader** with a red line on its cap,
and the voices as lenses of their own colours. **The seek bar and the lists** are a DJ program's, after Rekordbox, Serato, Traktor,
VirtualDJ and djay Pro:

| DJ program                                  | Here                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Track overview (the whole waveform)         | the seek bar is the whole recording: its loudness as a waveform (stretched between the 5th and 99th percentile, so swells show) with each voice's pitch drawn on it in the voice's colour |
| Played part bright, rest dimmed             | the part still to come is dimmed                                                                                                                                                          |
| Playhead, cue points                        | a red playhead with a cap, a hairline and the number of every piece at its start (a number is left out where the next piece is too near)                                                  |
| Loop brackets                               | the A–B loop is an amber band with brackets at both ends                                                                                                                                  |
| Library table: columns, zebra, loaded track | the piece list has column heads (piece, voices, bars, time), alternate rows, the voices as coloured dots, and the playing piece marked with a red bar and a red wash                      |

The overview is one small file, `overview.bin` (48 kB: 9 665 columns of half a second, each with the loudness and four voices' pitch),
made by `python -m artfugue.overview` from the recording and the timed notes, and drawn once into a canvas (again only when the width,
the data or the voice buttons change; the playhead is an element, so a tick of the clock costs no drawing). Without the file the bar
still works. **Judged from screenshots only**; the red display and the felt are a matter of taste, and the touch layout (a
phone) was looked at in one window size.

## The toolbar, left to right

The **views** (score `N`, spectrogram `V`) at the left edge; in the middle **repeat and A–B loop**, the **transport** (previous piece, −10 s, play/pause, stop, +10 s, next piece) and the **time display** (title, bar, time; click the time for remaining); at the right the **voices**, the **piano** switch (the keys icon, `S`: the notes of the piece on a sampled piano instead of the recording, `docs/sampler.md`), the **volume** fader, the **speed** and the panel buttons (pieces, what am I hearing, effects, go to, copy a link, help, fullscreen). The score is the engraving of the piece over the stage (cream paper, as the Henle Urtext prints it; the paper colour is my choice, as no published specification of it was found), and the spectrogram is the recording's own. The score rides above the bar and drops when the bar fades. **Begin opens the list of pieces** to choose from, unless a link already says what to hear. The piece list's scrollbar is black with a wine-red thumb.

**Settings that were only reachable by a link or a key before:** the score's engraving (Verovio's, the default, or the printed score's) is in the effects menu; the go-to dialog has a button. **Still without a control** (by design or not yet): previous and next bar (`,` `.`), ±5 s and ±30 s (arrow keys), restart of the piece (`Home`), solo of a voice (Shift-click, `Shift+1`–`4`), the A–B loop by Alt-drag, the picture quality level of the governor (`/stage?q=`) and the length of the spectrogram's window; the benchmark page `/bench`. They are in the help (`?`) or in the tooltips.

## How it is built

- **State and actions** in one class, `Player` (`player.svelte.ts`): settings, the open panel, the loop, messages. The
  components show it and call its methods; the keyboard table calls `run(action)`. Nothing is read per frame: the stage
  reads the clock itself, and the interface sees the transport's 10 Hz position.
- **Pure logic with tests**: `settings.ts` (checked, stored settings), `loop.ts` (repeat, A–B, bar stepping), `keys.ts`
  (the shortcut table), `seekmath.ts` (time text, pointer to time, snapping to a piece start, tick marks), `info.ts` (the
  sentences of "what am I hearing"), `credits.ts` (preset authors from `curated.json`).
- **Components**: `Player.svelte` (layout, keyboard, fading, fullscreen, taps), `Controls.svelte`, `SeekBar.svelte`,
  `Panels.svelte` (pieces, info, effects, go to, help), `StartScreen.svelte`, `Icon.svelte`.
- **The stage takes the choices while running** (`Stage.setEffects`, `setVoiceMask`, `setHighlight`, and the director is made
  or dropped when "auto" is switched): nothing is recreated and playback does not restart.
- **Controls fade** after 3 s without input while playing, never while paused, with the pointer or keyboard focus in them or
  a panel open. On touch a tap shows or hides them and a double tap on either side jumps 10 s.

## Things found by building it

- **A seek to a bar read as the bar before.** Seeks start 80 ms early so that the decoder does not clip the attack, which
  is inside the previous bar (and for a piece that follows another at once, inside the previous piece). The bar readout,
  and a link made from it, said "bar 24" after a seek to bar 25, so a link lost a bar every time it was reloaded. Piece and
  bar lookup now treat the next one as starting 0.1 s early (`SEEK_SLACK`).
- **Shortcuts and focus.** Space on a button must press the button, not also pause; arrows on a slider move the slider; a
  text field keeps every key. `keys.ts` holds the rules and its tests the cases.
- **A loop is not gapless.** The audio is a streamed `<audio>` element, and a seek to a new place is not instant; see the
  measurement below. The pictures follow the clock and loop cleanly.

## Checks

`pnpm player-check` (Edge and Firefox, Windows 11, 1280×720 and a 390×844 touch window): **84 checks in each**, all passing
at the time of writing. They drive the controls and read the state they leave: the start screen and a deep link (nothing
plays before Begin), play, pause, stop, jumps by 5 s, 30 s and 10 s, previous and next bar and piece, Home, seek by click,
drag and hover tooltip, the time display, volume (square law, mute and unmute to the same level), speed (pitch preserved),
the three repeat modes, the A–B loop, voice toggles and solo (faded on the stage, audio untouched), the effects menu (and that
the stage is not recreated), the piece list, the info panel, go to, help, the keys leaving text fields alone, auto-hide,
accessible names, announcements, settings kept across a reload with a link's position winning, the calm start, a phone-sized
window (nothing sticks out, 44 px targets) and the credits page. The screenshots `docs/img/player-*.png` are for looking at.

**The loop.** In Edge the seek from B back to A on buffered audio took 0.5 ms from `seeking` to `seeked`; the loop is checked
every 25 ms, so it can play up to 25 ms past B first, and the output has its own latency. The pause that is heard was not
measured by ear. It is not gapless; a gapless loop (decode the region into a buffer) is not built.

## Not judged / not done

- Accessibility, flashes, a phone's start and the system's motion setting are in `docs/accessibility.md` (EN7.5): axe-core, contrast on pixels, the WCAG 2.3.1 flash measurement.
- Safari and iOS (touch, fullscreen on iPhone, the `interrupted` audio state), weaker machines, a real phone.
- Screen reader use was not tried; names, roles and live regions are in place and checked for presence only.
