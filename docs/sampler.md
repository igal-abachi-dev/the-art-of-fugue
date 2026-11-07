# The sampler mode (E8): the piece played on a piano, a harpsichord or a pipe organ, not by the recording

The sound button in the toolbar (the keys icon; `S` goes to the next sound) opens a small menu: **the recording**, **piano**, **harpsichord**,
**pipe organ**. The three instruments play the notes of the piece from samples; the picture, the bar numbers, the score, the loop, the seek
bar, the speed and the volume do not change, because the recording keeps running, silent, as the master clock. The menu also holds two
controls for the sampled sounds: **Tone** (darker or brighter, a shelf at the top of the sound, 9 dB either way) and **Timing** (earlier or
later by 5 ms steps, 100 ms either way). Nothing of an instrument is fetched until it is chosen the first time; a second choice is instant;
a file that cannot be fetched leaves what was sounding.

Code: `web/src/lib/sampler/` (`bank.ts` the sample sets and layers, `sampler.ts` the scheduler, `registration.ts` the organ's score,
`times.ts`, `reverb.ts`), the switch in `web/src/lib/player/player.svelte.ts`, the menu in `Controls.svelte`. The data is made by
`tools/artfugue/instruments.py` (the samples), `registration.py` (the organ's score) and checked by `pnpm sampler-check`
(which uses `sampler_timing.py`) and `tools/artfugue/piano_compare.py` (a one-off comparison used to choose and tune the piano).

## The samples

All three come from the **Versilian Community Sample Library (VCSL, Versilian Studios LLC), CC0 1.0** (public domain; credited on the credits page
anyway). The raw 24-bit WAV files (about 1 GB) are cached under `data/work/instruments/vcsl` and are not shipped; what ships is prepared by
`python -m artfugue.instruments` (a step of `pnpm data`) into `web/static/samples/<id>/` with an `index.json` that lists every file, its
measured pitch and tuning, where the note is struck, and the instrument's settings.

| instrument  | what it is                                                                                           | layers                              | files | size     |
| ----------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- | ----- | -------- |
| piano       | VCSL "Grand Piano, Steinway B" (close microphones), a whole tone apart, stereo MP3                    | 3 dynamic layers (soft, mezzo, forte) | 117   | 12.7 MB  |
| harpsichord | VCSL "Harpsichord, Flemish", the lower 8-foot register, far microphone, 28 notes, MP3                | 1                                   | 28    | 1.9 MB   |
| organ       | VCSL "Pipe Organ" (Ivy Audio, a church organ): the quiet rank, the open rank, and the pedal; FLAC    | 2 ranks (the flute, the full rank)  | 48    | 6.9 MB   |

- **The names of the library's files are not trusted.** The pitch of every sample is measured (autocorrelation of its steady part) and the note it
  is taken for is that pitch rounded, its tuning against equal temperament (A = 440 Hz) the remainder (`cents`), which the sampler corrects when it
  re-pitches. (The open rank's "A4" sounds an octave and a half above its "A1"; the harpsichord's names were checked and are right.)
- **A pipe sounds as long as the key is held**, so each organ sample is its attack and a seamless cross-faded loop of its steady part (1.2 s,
  35 ms cross-fade; the seam is checked to be smaller than a step of the wave). FLAC, because a loop has to be exact to the sample in every browser
  (an MP3's encoder delay differs between them).
- **Levelled within a layer; the layers keep their loudness against each other.** The library's piano files are normalised (every layer peaks alike),
  so the layers' loudness is set here: 7 dB a step.
- **Not Tone.js**: about 400 lines on the audio graph the player already has, because the sound has to go through the player's analyser (the bloom and
  the glow follow what is heard).
- **Where a sound begins.** Browsers disagree about the encoder delay of an MP3, so the loader finds the start of each decoded sample itself (the first
  value above 1.5 % of the loudest in the first half second) and plays from there; where the note is *struck* is read when the file is made
  (`strike_of`: the instant the level at the note's pitch rises fastest, the way the recording's reference points are read) and is stored as a time
  after that first sound.

## What plays which note

- **The piano's layers are crossfaded by the note's loudness** (the loudness of each note comes from the recording: `vel`, 61 to 245 at the 5th and 95th
  percentile). A note between two layers sounds both, at equal power. The strike is taken as 85 % of its loudness when it picks its layers (softer
  hammers are less hard-edged).
- **The organ is registered by a score, not by each note's loudness** (`docs/organ-registration.md` below). Crossfading the two ranks note by note made
  every note choose for itself and the voices flickered between a flute and a plenum.
- **The harpsichord has one layer and no dynamics**: every note is as loud as any other.

## The organ's registration score

`web/static/data/organ-registration.json`, made by `python -m artfugue.registration` (a step of `pnpm data`), read by the sampler: for each piece and
each of its voices, `[start, end, "full" | "flute"]` segments in seconds on the recording's timeline. Nothing is decided in the browser. The owner's
corrections go in `data/organ-registration-overrides.json` (committed; `_about` explains the format) and are written over the score.

It is made from the **notes of the MusicXML** (pitch, voice, the subject entries the analysis found), the **recording's loudness and brightness over
time** (read from the waveform: RMS and spectral centroid, a second at a time, against the piece's own range), and the **bar lines**; each voice by
itself, in this order:

0. *The whole texture, from the recording.* Where the recording is at the top of the piece's range of loudness and brightness (a climax) every voice is
   the full rank, except in the high octaves; where it is at the bottom (a hush) every voice is the flute, the subject too.
1. *The subject.* The notes of an entry of the subject are the full rank for the whole entry, in whichever voice states it (a secondary theme of a
   multiple fugue is the flute, as a colour against the first), unless the passage lies in the high octaves.
2. *Focus and background.* The voice with the greatest salience (the loudness of its notes in the recording, how busy it is, how high it lies among
   the voices), held for a few seconds at a time, is in focus; the others are the background and are the flute, except the bass, which is the foundation
   and stays full. (Not in the canons, whose two voices are of equal weight.)
3. *The voice's own dynamics.* The full rank is the main voice; a quiet or slow passage of a voice (against that voice's own median) is the flute.
4. *The register.* In an ordinary passage the low and middle of the compass are the full rank and the high octaves (the passage's median pitch at A♯4 or
   above, back below F4) the flute: the full rank's treble is hard, the flute's sweet. A voice changes this at most once in 15 s.

Every decision is then made constant over a voice's notes in a bar (a registration is changed at a bar line). The bass is the pedal by its pitch (the
samples of both ranks have the pedal's below the manuals'). Each piece also has a **character** (`PROFILES` in `registration.py`: how far it leans to the
full rank or to the flute, and whether its secondary themes take the flute), which is my reading of the music and not an authority.

**What it is not.** It was **not made by listening** and it **does not copy any organist**: three videos of organists were given as examples, but the
pages of the videos carry no registration information (only titles) and I cannot hear. What was done with them: their audio was downloaded for private
analysis (`data/work/refs`, git-ignored, not shipped) and two of the three (BWV 542's fugue, 6.5 min, and Koopman's BWV 578, 3.2 min; the third, BWV 542
"Great", refused the download) were read for how often the **brightness of the whole sound** changes by 3 dB or more: about **twice a minute** (every 18 to
24 s). The dwell times of the score are set from that. Which stops they used, and on which manual, cannot be read from audio this way.

## The scheduler

Every 40 ms `Sampler.tick()` reads the clock and hands the audio context every note that starts in the next 0.3 s of the piece, once, at the moment
the recording would play it. Pitch is the sample re-pitched; the speed moves the notes in time and never the samples (so the pitch is kept at 0.5 to 1.5
times). Notes that the score begins together (the voices of one chord) are pulled to their median (`times.ts`: the aligned onsets sit on the alignment's
own 11.6 ms frames, and notes of one tick come out 11.6 ms apart at the median and 76 ms at the 90th percentile; smoothing the whole curve of time
against tick was tried and made the error against the waveform larger, 4.0 to 6.5 ms).

- **Where a note lands.** The aligned onset of a note lies a median 26 ms *after* the instant the recording's level rises fastest, so the sampler lines
  the sample's strike up with the aligned onset less 26 ms (in the recording's time: at half speed it is twice as long), then by the instrument's own
  measured `delay_s` (and, for the organ, each rank's own `delay_s`). `ctx.currentTime` moves in steps of one output buffer, so the relation between the
  clock and the context's time is held (the upper quartile of the last second), not read afresh.
- **Pause, seek, a stall, a change of speed:** everything scheduled is thrown away and every voice damped in 30 ms, and scheduling begins again from the
  playhead. **A hidden tab** schedules 1.6 s ahead. **At most 96 sources** at once (a note of two layers is two).
- **The release.** A harpsichord note and an organ note are damped quickly (50 and 80 ms); the piano's notes fall away with a time constant of 0.3 s, as the
  recording's do (its pedal and room hold them: the recording's partials are 7 dB down 0.25 s after the aligned end of a note, where a damper of 70 ms would
  take 30 dB off).
- **The piano's tone and swell** (`index.json`: `eq`, `sustain`, `reverb`, `vel_scale`). Measured against the recording's 44 reference notes, the Steinway's close
  microphones carry **18 to 22 dB more energy above 2.5 kHz** (−22 to −27 dB of the total, against the recording's −41 to −45) and its notes fall faster (−6 dB
  half a second after the strike, against −1 to −4). That is a bright, plucked sound. So: a shelf of −18 dB from 2 kHz, another −6 dB from 4 kHz, a low pass at
  6 kHz, a little body at 750 Hz and 1.4 kHz, a swell that holds each note up (+3 dB at 0.5 s, +7 at 1 s, +9 at 2 s) and a synthetic room (`reverb.ts`: decaying
  noise, 2.0 s, 30 % wet). Simulated on the samples (`scipy` biquads and the swell), that gives a spectral centroid of 440 to 500 Hz (the recording's: 456 to 567),
  0.5 s decay −3 to −5 dB (−1 to −7.5), 1 s decay −7 to −8 dB (−4 to −7.4) and 2.5 kHz+ energy of −38 to −42 dB (−40 to −45). **What it sounds like is for the
  owner's ear**; the Tone control moves the top either way. The harpsichord has a small swell (+1.5 dB at 0.5 s, +4 at 1 s, +6 at 2 s) from a played harpsichord
  recording (−3.4 dB at 0.5 s, −4.9 at 1 s; the samples alone: −4.8 and −9.1).

## What was measured (`pnpm sampler-check`, Edge and Firefox, 52 checks each, all passing, 2026-11-07)

The recording is tapped where it leaves the element (before the gain that silences it) and the instrument where everything joins, by an AudioWorklet that saves
raw samples with the context's own time stamp, in the same run. The page seeks to 1.3 s before each of 22 reference points of the sync check (notes whose attack
stands alone in the recording) and plays through it; `sampler_timing.py` reads the instant the level at the note's pitch rises fastest in both taps and takes
the difference. **Instrument minus recording, the median over 19 to 21 of the 22 notes:**

| instrument  | Edge       | Firefox    | spread (10 to 90 %)               |
| ----------- | ---------- | ---------- | --------------------------------- |
| piano       | 0.0 ms     | +1.5 ms    | about 16 ms (−10 to +7)           |
| harpsichord | +1.5 ms    | 0.0 ms     | about 13 ms                       |
| organ       | +1.5 ms    | +2.2 ms    | about 80 ms (the soft rank's attack is slow: its strike can be read to ±40 ms only) |

Before the strike was lined up and the delays measured, the instruments struck 17 ms (piano), 26 ms (harpsichord) and 17 ms (organ) before the recording in both
browsers; and the 4 ms-polled measurement of the first version (piano −4 ms in Edge, +20 ms in Firefox) was too coarse to see either. The recording itself is heard
−10 to +5 ms from the clock, so the picture and the sound agree. Also checked: nothing is fetched before an instrument is asked for; exactly its files, once; a
second choice needs no download; the recording silent and still the clock; each instrument sounds and the previous one is silent after a switch; the menu, the
`S` key cycling, the tone and timing controls kept in the settings; a file that cannot be fetched leaves what was sounding (also while another instrument
sounds); choosing the recording while one loads cancels it.

## Listened to, by the owner

- 2026-11-06 (the Salamander piano, the first version): a bit off in rhythm compared with the recording, acceptable; lacks the recording's room, depth,
  texture and articulations, understood and accepted. (`docs/listening-check.md`)
- 2026-11-07 (after the timing was lined up and the harpsichord and organ added): the harpsichord's sound is great; the organ "sounds great"; the piano is
  **too bright, plucked like a guitar, not dark enough for a Bösendorfer nor rich enough for a Steinway**: that is what the measurements above were
  made for (the first Steinway B setting; a second one is in, unheard). The owner asked for a Steinway D, a Bösendorfer Imperial, a C. Bechstein, a Hoffmann
  T-128, a Boston UP-126 or a Petrof 125: none of these is available here under a licence this project can ship (VCSL's piano choices are a Steinway B, which
  is used, and a Kawai grand, which was compared and was further from the recording; a set of a Hamburg Steinway D and a Bösendorfer Imperial exists for
  free in SFZ form, 4.3 GB, with a licence not found).

## Not judged, not done

- **How any of it sounds.** Nothing here has been heard by its author; the tone, the registration and the swell are settings made from measurements and from
  my reading of the music, to be corrected by ear. The organ's registration is a *proposal*: the overrides file is how an ear's judgement is written down.
- Safari and iOS (the AudioContext of iOS, FLAC and MP3 decoding, the background timers), a phone.
- The sampler plays the **aligned timings of the recording** (her phrasing), which is a rights question for a public release (`docs/rights.md` item 4); an
  even-tempo performance from the score would avoid it and is not built.
- The note data is the MXL's: a wrong or missing note is a wrong or missing note in the instruments. No sympathetic resonance, no pedal noise, no key or damper
  noise, no release samples; the harpsichord has no register changes (one 8-foot rank); the organ has no tremulant and no real stop list.
