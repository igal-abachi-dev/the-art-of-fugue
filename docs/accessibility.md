# Accessibility, safety and credits (EN7.5)

What the interface does for a listener who needs less motion, for a flash-sensitive listener, for a phone, for a keyboard
or screen reader, and how each of those was measured. Code: `web/src/lib/player/`, `web/src/lib/a11y/flash.ts`. Browser
checks: `pnpm a11y-check`, `pnpm flash-check`, and the parts of `pnpm player-check` named below.

## Less motion (T7.5.1)

- **The system setting is followed while the page is open.** `watchReducedMotion` (`device.ts`) listens to
  `prefers-reduced-motion`; the player keeps `systemReduced`, and the stage, the interface and the effects menu follow it at once,
  without recreating the stage. The "Calm" box in the effects menu then shows the state and cannot be switched off (it says why).
  Checked by emulating the setting on and off in `pnpm player-check`.
- **What less motion turns off:** camera drift, shake and steering, the MilkDrop layer, the burst of particles when the last
  fugue shatters (the picture just goes dark), and the loudness bloom is cut to 40 % (`REDUCED_BLOOM`) so that it flickers less.
  In the interface nothing slides or fades (`transition: none` under `.app.calm`); the loading spinner turns slowly, since it is
  what says that something is loading. The listener's own "Calm" choice and "Begin calmly" do the same as the system setting.

## Flashes (T7.5.1)

`pnpm flash-check` measures the frames the listener sees against WCAG 2.3.1 (three flashes or below threshold).

**The method** (`src/lib/a11y/flash.ts`, unit-tested on synthetic sequences: still and fading pictures, three and four flashes a
second, swings under the threshold and between two bright values, the area that flashes, red). A general flash is a pair of
opposing changes of relative luminance of 0.1 or more where the darker value is below 0.8; a red flash is the same for a
saturated red (`R/(R+G+B) >= 0.8` on linear values, change of `(R-G-B)*320` of 20 or more). Per pixel the tracker records
each change, and a pixel that changes more than six times in a second (more than three flashes) is flashing too often. The
frame fails if more than **2.5 %** of its pixels flash too often: that is a quarter of a 10° field of view at the usual
1024×768 reading size (2.8 % of the screen), counted over the whole frame, so scattered pixels count too, which the standard
would not do. Note that the orange of voice 3 (`#D55E00`) is a saturated red by this definition.

**What is measured:** for every one of the 20 pieces the loudest 15 seconds (found from the recording's own loudness,
`overview.bin`) played in real time in Edge at 1280×720 on `/stage?scene=auto` with the ambient layer and the bloom on; in
every animation frame the page's own picture is composed (the scene's background, the MilkDrop canvas at its opacity, the
notes over it) at 128×72 and fed to the tracker. Also the end of the last fugue (the freeze, the shatter, the black), the
boundary between two pieces, and the idle scene. The interface's own elements are not in the picture (they do not flash).

**Results** (Edge on Windows 11, 1280×720, 59 to 60 frames a second in every window, the longest gap between two frames
17 ms, apart from one of 50 ms at the start of the first window and one of 183 ms at the end of the last fugue, where the
picture goes dark):

| Window                                             | General flashes (area) | Red flashes (area) |
| -------------------------------------------------- | ---------------------- | ------------------ |
| the loudest 15 s of each of the 20 pieces          | 0.00 % to 0.30 %       | 0.00 % to 0.59 %   |
| the end of the last fugue (freeze, shatter, black) | 0.01 %                 | 0.00 %             |
| the boundary between two pieces (II into III)      | 0.00 %                 | 0.18 %             |
| the idle scene before the first piece              | 0.00 %                 | 0.08 %             |
| **limit**                                          | **2.5 %**              | **2.5 %**          |

The worst of all is 0.59 % of the frame (a red flash, in Contrapunctus III). What those pixels are was not looked at (the
sparks and the lit note ends are the likely ones). **A positive control** proves the measurement can
fail: with the page's background flipped between black and white five times a second under the layers, 83 % of the frame is
reported as flashing (the script counts a control that is _not_ caught as a failure). Not measured: Firefox, reduced motion (it removes the shatter's burst and cuts the bloom, so it should be lower; not measured), a faster or slower machine than this one, the
interface's own elements (the title card fades slowly and the bar fades over 0.35 s; neither flashes).

## A phone (T7.5.2)

- A phone (a coarse pointer on a screen whose short side is at most 820 px) **starts the quality ladder at level 2**: no bloom, at
  most 2048 particles, dpr at most 1.25 (`PHONE_START_LEVEL`); the governor adapts from there as everywhere.
- **The ambient layer waits for a frame budget** (`AmbientBudget`): it comes on after the frame rate has held the governor's
  step-up mark (58 fps) for 6 seconds of playing in a row, and then the governor's ladder takes it away again if the frames get
  slow. A device that is not a phone has it from the start. Unit-tested; `pnpm player-check` checks the level and the layer in
  a phone-sized touch window in Edge. **Not tried on a real phone.**

## Keyboard, screen reader, contrast (T7.5.4)

`pnpm a11y-check` (Edge and Firefox):

- **axe-core 4.14** (WCAG 2.0, 2.1 and 2.2 A and AA, and best practice) on the start screen, the player with the piece list open
  (as Begin leaves it), with each of the other panels open (what am I hearing, effects, go to, help), with all panels closed, the
  credits page, and a phone-sized window: **no violations at all** in either browser (0 serious or critical, 0 lesser).
- **Contrast.** axe cannot judge text over a canvas or a gradient (it reports "to judge"), so the script does: it collects every
  text and every icon on show (the colour, the opacity of it and of its parents, the size), hides all of them, takes a screenshot,
  and measures each against the pixels that were under it (the lightest 2 % of them), 4.5:1 for text, 3:1 for large text
  (24 px, or 19 px bold) and for icons. **Every state passes**: 21 to 111 texts and icons per state, the tightest 4.96:1 (the
  speed button) and 5.1:1 in the others. The title card, the only text straight on the picture, is measured on the composite of
  the scene's background, the MilkDrop layer and the notes for every one of the 20 pieces' scenes: at least 5.4:1 for the small
  "kind" line (4.5 needed) and 14.4:1 for the name (3 needed).
- **What it found and what was done:** the time button's accessible name did not contain its visible text (WCAG 2.5.3; now
  "Time 0:36 / 2:53. Switch ..."); the help and "what am I hearing" panels scroll but could not be reached from the keyboard (they
  take the focus now and keep the arrows, Page Up and Down, Home, End and Space for scrolling, `data-own-keys`); the page had no
  `main` landmark; the red of the display and the speed button was 3.98:1 on the button (now lighter, 5.1:1), the dim part of
  the display 2.55:1, the column heads of the piece list 4.28:1, the numbers on the seek strip 2.4:1 (they have a dark plate
  now) and the start screen let the picture through enough for its small text to dip under 4.5:1 (it is more opaque).
- Before this: every control has an accessible name, a role and its state (`aria-pressed`, `aria-expanded`, slider values as words),
  the whole interface works from the keyboard in a logical order with a visible focus ring, panels return the focus, changes of
  piece are announced in a live region (all in `pnpm player-check`).

## Not done

- A screen reader was not used; names, roles, states and the live region are in place and checked by axe and `player-check`.
- A real phone, Safari and iOS. A high-contrast or forced-colours mode.
- The flash check ran in Edge; the same composition in Firefox was not measured.
