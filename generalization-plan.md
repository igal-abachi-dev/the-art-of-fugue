# Plan: from the Art of Fugue to any classical work

Goal: take what was built for Bach's _Art of Fugue_ (the player, the stage, the score overlay, the spectrogram, the pipeline that aligns a score to a recording, the checks) and make it work for other
music, from whatever inputs exist: a recording (WAV), a score as a PDF, a score as MusicXML (MXL), or only some of them. Candidates named: the Well-Tempered Clavier (both books), the Musical Offering,
Beethoven's sonatas, Chopin's etudes, Mozart, Handel, Liszt.

Written 2026-11-06 from (a) reading this repository's code and (b) web and arXiv research. **Nothing in this plan has been built or tried.** Where a statement comes from a search snippet and not from
the full paper, it is marked _(snippet)_. The sizes and effort levels (S, M, L) are my estimates. Sources are listed at the end.

---

## 1. Summary

**What is general already.** The browser side is closer to general than I expected. The playback engine, clock, frame loop, note window, seek bar, sampler, governor, accessibility and flash checks,
spectrogram, overview, deployment and release checks contain no piece names (a search for `c01`, `BACH`, `c14` in `web/src/lib` hits only 5 files: `player/info.ts`, `scenes/tags.ts`, `visual/scene.ts`,
`visual/shaders.ts`, `visual/stage.ts`, plus the scene and credits data). The Python side is half general: the alignment core (`chroma`, `align`, `refine`, `timing`, `locate`), the export format, the
sync acceptance and the fingerprint are general in idea, but they read a hand-written table of the 20 pieces (`pieces.py`), one fixed MXL path and "exactly one WAV" (`paths.py`).

**What is Art-of-Fugue-only.** The subject-entry detector, the mirror pieces (derived by pitch mirroring), the two canon repeats, the BACH motif, the per-piece scenes and the text of the info panels. These
become _plug-ins and data_, not code in the core.

**The five things that will actually be hard** (everything else is plumbing):

1. **A voice is not a line in most piano music.** Fugues have 2–5 independent voices; sonatas, etudes and Liszt have hands, chords, melody over accompaniment. The "voice = rank by median pitch" rule and the
   five voice colours are fugue assumptions. Needs a second model (hands / streams / instruments) and a way to colour by it.
2. **Repeats, da capo, skipped repeats, cadenzas.** The performer may or may not take a repeat; the score says it exists. Our pipeline decided this by hand for two canons. Sonatas (exposition repeats),
   minuets (da capo) and Handel's arias need it everywhere, automatically, with a check.
3. **Timing accuracy on dense, pedalled, rubato playing.** Our 44 reference points are isolated attacks in Bach on one recording (median 26 ms). Chopin's etudes and Liszt will be 3–4 times denser and
   the sync tests we have do not reach there. The note-level step that found our real defects (entries after a rest, sparse notes) needs a harder test and, probably, a second source of evidence (a neural
   transcription).
4. **Time grid and score semantics.** `DIV = 24` ticks per quarter is asserted in `score.py`; quintuplets, septuplets and larger groups (common in Chopin and Liszt) do not fit it.
5. **Rights.** A public site needs a recording that may be hosted. The only strongly-open, high-quality piano recordings I found are Kimiko Ishizaka's CC0 releases (_Well-Tempered Clavier_ Book 1, _Goldberg
   Variations_) and datasets under CC BY-NC-SA (MAESTRO). Everything else is a private preview unless permission is obtained.

**Recommended order** (reasons in section 6):

| Step | Target                                                  | Why                                                                                                                                                  |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Refactor so the Art of Fugue is "project #1" and output is **byte-identical** | the regression gate for everything after                                                                                                |
| 1    | A synthetic open test project (CC0 score rendered to audio with a known tempo map) | the pipeline gets an end-to-end test with exact ground truth and no rights problem                                                  |
| 2    | **WTC Book 1** with Ishizaka's CC0 recording, MusicXML and PDF from the same release | all three inputs open; fugues use the existing machinery; first work that can be public; forces the multi-piece, many-audio-files, tonal-answer work |
| 3    | **Goldberg Variations** (Open Goldberg, CC0)            | one more open work; variations and repeats (the aria da capo, repeats in most variations) test the repeat logic                                       |
| 4    | Solo-piano research previews: **Chopin etudes, Beethoven sonatas, Mozart, Liszt** from MAESTRO + ASAP | private / non-commercial; the datasets already carry score↔performance alignments, so they test the visuals and the "streams" model without needing our aligner first |
| 5    | **Musical Offering**, Handel                            | ensembles and period pitch: instrument lanes, tuning offsets, other sample sets; recordings must be found and cleared                                 |

Orchestral and vocal music (symphonies, concertos, opera, oratorio) is **out of scope** until the solo-keyboard path is solid: alignment, transcription and OMR all get much worse with many instruments.

**Decisions needed from you** (section 9): scope (solo keyboard first?), one site per work or one library site, whether public releases are limited to openly licensed recordings, and how much hand
curation per work you accept (scenes, ear-checked sync points).

---

## 2. What exists and how general it is

Read from the code on 2026-11-06. "Config in code" means: general in logic, but a fact about the Art of Fugue is written into source and must move to data.

| Part                                                    | State                  | What ties it to the Art of Fugue                                                                                                                  | Work to generalize |
| ------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Playback engine, clock, frame loop, note window, links  | **general**            | pieces are positions in **one** audio file (`audio_start`, `audio_end` in the manifest); `engine.ts` seeks by absolute time                       | M: per-piece audio files (see 4.3) |
| Stage (notes, keyboard, particles, camera, governor)    | general                | an 88-key keyboard; 5 voice colours (`VOICE_COLOURS`); note buffer of 1024 notes, 4096 particles (`notebuffer.ts`, `particles.ts`)                 | M: colour modes, density tests, lanes for instruments |
| Scenes, tags, ambient presets                           | config in code         | `scenes.json` and `ambient/curated.json` are per piece id; `tags.ts` knows subjects, BACH, mirror ghosts and canon leaders                        | M: pick scenes by features, with per-piece overrides in project data |
| Player UI (toolbar, panels, seek bar, settings, keys)   | general                | texts in `info.ts`, `credits.ts`, the title card and start screen are Art of Fugue; the piece list assumes 20 pieces in one list                    | S–M: texts from project data; grouped piece lists for 48+ pieces |
| Score overlay, spectrogram, overview                    | general                | file paths fixed under `/data/`; the PDF engraving needs a **vector** PDF                                                                          | S |
| Sampler mode                                            | general logic          | one sample set: Salamander piano (CC BY 3.0)                                                                                                      | M: harpsichord, organ, other sets; rights per set |
| Deploy, caching, release, smoke, perf, soak checks      | general                | one manifest URL; `integrity.spec.ts` asserts exactly 20 pieces; `release.json` is one project's rights                                           | S: parametrize on a project |
| `paths.py`, `pieces.py`                                 | **hand-made for AoF**  | one MXL filename; exactly one WAV in `data/raw`; the table of 20 pieces with MXL measure ranges and kinds, used by ~10 modules                    | M: `project.json` per work |
| `score.py` (MXL parser)                                 | partly general         | `DIV = 24` asserted; staff is read but not shipped; no tempo map, no repeat/jump expansion except `unfold.py` for two canons                       | L: the core of the score model |
| `build_score.py`, `mxl_checked.py`, `pdfnotes.py`, `audit_pdf.py` | AoF-specific logic, general idea | mirror pieces are derived; the PDF is the source of truth for pitches. The **PDF-vs-MXL audit** is general and valuable, but it reads notes from a vector PDF's glyphs | M |
| `annotate.py`                                           | **AoF-specific**       | subject entries, BACH, clashes, mirror and canon links; the events schema has a closed list of 6 types and `additionalProperties: false`            | M: annotators as plug-ins; events schema v2 |
| `locate.py`, `align.py`, `refine.py`, `timing.py`       | general idea           | assumes one recording of all pieces in order, 3 s gap, nominal 0.575 s per quarter; piano CQT; written around a 13-minute DTW matrix limit        | L: see 5.1 |
| `syncref.py`, `qa.py`                                   | general                | 44 reference points of one recording                                                                                                              | M: reference points per project, plus external benchmarks |
| Binary note chunk                                       | general                | fields: `t_on, t_off, tick, pitch, voice, vel, conf, bar, flags, pass`: no staff/hand, no instrument; `bar` is `u2`; `ppq` 24                     | S–M: a v2 with `line` kind and staff |
| `synctoolbox` in `tools/requirements.txt`               | **listed, not used**   | a search of `tools/artfugue` finds no import                                                                                                      | see 5.1 |

---

## 3. The inputs, and what to do when some are missing

Today's path needs all three: MXL (notes), PDF (source of truth for pitches, and the engraving), WAV (timing). Every other combination below has a defined route. The shared idea: **normalise every
score source to one internal score model first, so nothing after that step cares where the notes came from.**

| Have                       | Route                                                                                                                                                                                         | What is lost / risk |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| WAV + PDF + MXL            | The full path (what we did). PDF audit of the MXL pitches, Verovio engraving from the MXL as a second source.                                                                                  | nothing             |
| WAV + MXL                  | Skip the PDF audit. Engraving from the MXL with Verovio (already built as the second engraving, `docs/notation.md`). Check pitches against the **audio** instead (`recording_vs_score.py` exists). | no independent check of the MXL's notes; MXLs from crowds contain errors (we found and fixed some in the Art of Fugue MXL) |
| WAV + PDF                  | OMR to MusicXML, then **human review**. For a vector PDF our `pdfnotes.py` already reads noteheads; for a scan only OMR works (Audiveris, homr, or an end-to-end model, section 5.5).             | OMR errors in rhythm, ties and voices; every work needs a correction pass; audio can flag bars that do not match |
| PDF + MXL (no recording)   | No alignment. A **synthetic clock** with a tempo map and the sampler as the sound ("score mode"). The engine already has `playback/synthetic.ts`; the sampler already plays notes. The even-tempo piano was already named as the rights fallback in `docs/sampler.md`. | no real performance; no spectrogram |
| WAV only                   | Transcribe the audio (piano: high-resolution neural transcription; other instruments: a general model). Spectrogram view works unchanged. No score overlay, no voices.                          | transcription errors on dense or non-piano music; voices must be guessed |
| MXL only / PDF only        | As "no recording", after OMR for the PDF.                                                                                                                                                      | as above            |
| MIDI, Humdrum `**kern`     | Convert to the internal score model (Humdrum has converters to MusicXML; Verovio reads Humdrum and MusicXML). KernScores is a large library in `**kern`.                                        | MIDI has no spelling, ties, voices or bars |
| Several recordings of the same work | One score data set, **one timing file per recording**. Switch performer in the player, or compare two.                                                                                 | needs the data split in 4.3 |

---

## 4. Architecture changes (work packages)

### 4.1 Project, work, recording: the data model (WP1, M)

Replace the hard-coded paths and `PIECES` with one description per work, kept in `projects/<slug>/project.json` (a JSON Schema in `schema/`, like the existing ones):

- **work**: title, composer, catalogue number, instrumentation, language of the texts, credits.
- **pieces**: id, title, kind, which measures of which score source, order, grouping (a book, a prelude+fugue pair, a sonata's movements), repeats policy, optional hand-made notes.
- **sources** (score): MXL / PDF / `**kern` / MIDI, each with licence, origin URL and the date it was checked. These feed `docs/rights.md` and the credits page automatically.
- **recordings**: file(s), performer, year, licence and evidence, layout (`single-file` with unknown boundaries, or `tracks` with a known mapping), tuning offset in cents (estimated, section 5.1), channel layout.
- **presentation**: colour mode, default scenes, texts for the info panel, theme.

An **auto-proposal tool** (`artfugue propose`) reads an MXL (movement titles, double barlines, part groups) and a PDF (table of contents) and writes a first `pieces` list for a person to correct. For the
Art of Fugue this table was made by hand over several tasks (T1.1.2 and T1.1.3); a proposal tool turns that into minutes.

`web/static/data/` becomes per work. Two layouts are possible (decision in section 9): one SvelteKit build per work (simple; rights and deploys per work), or one site with `/w/<slug>/` routes and a work
picker. **Start with one build per work**; the player already takes everything from one manifest.

### 4.2 The score model (WP2, L)

The Art of Fugue MXL is unusually tame (one voice per part, no pedal, no tuplets beyond triplets, no tempo changes). Other music is not. The internal score model has to hold, and the tests must cover:

- **A time grid that fits the music.** Replace the fixed `DIV = 24` with exact rationals (`fractions.Fraction`) or a per-piece grid that is the least common multiple of the divisions the file uses. The manifest
  already has a `ppq` field.
- **Repeats and jumps expanded exactly as the printed score says** (repeat bars, first/second endings, D.C., D.S., coda), with both versions kept: written order and performed order. Verovio's timemap
  can export an expansion map _(snippet)_; so can music21. Our `unfold.py` is the two-canon special case.
- **Tempo map and fermatas** (for the nominal tempo that starts the alignment, and for the synthetic clock).
- **Staves and cross-staff notes**, grace notes, trills (realised length), arpeggiation, ties across bars and pickup bars, transposing instruments (all notes in concert pitch).
- **Dynamics** as a velocity prior. Pedal marks as events (pedal blurs the audio, section 5.2).

### 4.3 Data and audio layout (WP3, M)

- **Audio per piece, not one file.** The Art of Fugue ships one 91 MB Opus file and one 98 MB AAC file because the recording is 80 minutes and fits Vercel's per-file limit with 2.5 MB to spare
  (`docs/audio-delivery.md`). Scaling by length (1.14 MB per minute of Opus 128 here): the WTC is roughly 4 hours ≈ 270 MB, over any single-file limit. Cut the recording into one file per piece
  (or per movement), keep `audio_start` as an offset into the piece file, and let the engine load the file of the piece being played (and preload the next). This also makes the first sound start faster
  and removes the 100 MB worry. Cost: gapless transitions between pieces need a preload and a crossfade or an accepted gap (the engine's piece-to-piece behaviour in `engine.ts` must be revisited).
- **Separate the score data from the timing data.** Today `pieces/<id>.bin` holds notes with times. Split into `score/<id>` (notes, voices, bars: shared by every recording) and
  `timing/<recording>/<id>` (onset, release, confidence). Then a second recording of the same work costs only an alignment, and the player can offer a performer switch.
- **Size budget** at the current rates (spectrogram 0.84 MB per minute, the PDF-derived engraving 25 MB + Verovio's 14 MB for 20 short pieces): a 4-hour work needs about 200 MB of spectrogram and
  tens of MB of engraving. Fine on object storage or Vercel Pro; tight on Hobby. Make the spectrogram resolution a project setting, and fetch tiles lazily (already the case).

### 4.4 Lines, voices and colours (WP4, M–L)

Generalise "voice" to **line** with a `kind`:

| kind            | when                                                         | how it is found                                                                                                         |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `voice`         | fugues, chorales, canons, trio sonatas                       | our rule (MusicXML part, or rank by median pitch)                                                                       |
| `hand`          | sonatas, etudes, Liszt                                       | the staff in the MXL (needs the staff field in the shipped note record)                                                  |
| `stream`        | homophonic piano with melody over accompaniment              | voice separation on the symbolic score: graph neural networks reach state of the art for classical piano _(snippet)_ (section 5.4) |
| `instrument`    | Musical Offering, trio sonatas, chamber music                | the MXL part; lanes per instrument                                                                                       |

And colour **modes**: by line (today), by hand, by instrument, by pitch class, by dynamics (velocity), by chord function or harmony where annotations exist. The player offers the modes that the project
declares. The colour-blind-safe palette (`palette.ts`, 5 colours) must grow, or rely on position and brightness when there are more lines than colours.

### 4.5 Annotations as plug-ins (WP5, M)

- Events schema v2: an open `type` (namespaced, e.g. `fugue/subject-entry`, `form/exposition`, `harmony/cadence`) with the owner of the type declared in the project. Today the enum has 6 values.
- Annotators run per piece `kind`. **Fugue**: needs the **tonal answer** (the subject enters on the dominant with small changes to keep the key; our detector finds exact transpositions). A paper on the WTC
  fugues reports 85 % of subject occurrences retrieved, with 66 % of subjects found with a musically relevant end _(snippet, HAL)_; use it as the reference to beat, and the hand-checked subjects in
  `docs/annotations.md` as a template for a hand list for the WTC. **Canon**: leader/follower links exist; add **retrograde** (the crab canon of the Musical Offering) and **spiral** (rising modulation)
  next to the existing mirror link. **Sonata form / harmony**: from published annotations where they exist (section 6), not from our own analysis.
- Scenes read events, not piece ids: a scene says "when `fugue/subject-entry`, do this".

### 4.6 Scenes without a hand-made table (WP6, M)

For 20 pieces we chose scenes by hand. For 48 preludes and fugues, 32 sonatas and 24 etudes, a hand table is a project of its own. Plan: keep the scene library; add a **picker** that selects from
features the pipeline already measures (note density per second, register, number of lines, mode, tempo, kind), with a per-piece override list in the project file for the pieces a person has looked at.
Taste decisions are made by trying them in the browser, as before (see the working rule in memory), but the picker's defaults must look acceptable unattended.

### 4.7 Interface for big works (WP7, S–M)

- Piece list grouped (Book I, Book II; sonata → movements), searchable, with deep links `?w=<work>&p=<piece>&bar=<n>`.
- Texts, credits and warnings from the project file; language from the project.
- Keyboard shortcuts that survive 48 pieces; a "go to bar" that understands the work's own bar numbers (and repeats).
- Density: measure `perf-check` on the densest passage of each work automatically (the script already picks a densest stretch for XI).

### 4.8 Sounds (WP8, M)

Add harpsichord, organ and (later) other sample sets for the sampler mode, each with its rights recorded in the project. Period pitch (A=415 or 392 Hz) and unequal temperaments affect both the sampler and
the alignment (section 5.1).

### 4.9 Tooling and tests (WP9, M)

- A real **DAG with caching** instead of the fixed sequence in `build_all.py`: each stage declares its inputs and outputs, hashes them, and reruns only what changed (the current full run is about 1.5
  minutes without audio encodes and 4 minutes more with; a 4-hour work is 3–4 times that).
- A **project doctor**: validates `project.json`, checks every input exists, prints what is missing and which route in section 3 applies.
- A **golden project**: a short open score rendered to audio by the sampler or FluidSynth with a known, deliberately uneven tempo map. The exact ground truth makes the aligner testable in CI with no
  rights issue and no hand-checked points. The existing `render_midi.py` is a start.
- Unit tests that count pieces or notes (`integrity.spec.ts`: 20 pieces) read the numbers from the project.

---

## 5. What the research says (and what it changes)

### 5.1 Alignment

- **Sync Toolbox** (Müller's group, MIT licence, `pip install synctoolbox`) implements multi-scale and memory-restricted DTW, plus a high-resolution synchronisation stage and an audio-to-score notebook
  with a Chopin prelude example. It is in our `requirements.txt` but unused. Use it to replace our "13 minutes per segment because the matrix must fit in 0.5 GB" limit and to compare against our own
  refinement. [1]
- **Precise and Simple Audio-to-Score Alignment** (Widmer, Hu, Peter; arXiv 2605.20014): onset and spectral features with dynamic programming, evaluated on ASAP solo piano, claimed to beat a traditional
  audio-to-audio baseline on several precision measures _(snippet)_. The closest published relative of what `refine.py` does; read it before designing the new refinement step. [2]
- **Snapping Matters** (Saha, Berendes; arXiv 2606.11903): DTW gives only a coarse correspondence; a refinement step snaps each score onset to a peak of an onset map, solved per pitch as bipartite matching
  instead of greedily _(snippet)_. This is the same problem as our two late-entry defects (a greedy window around the DTW time). Matching notes to peaks globally per pitch would have prevented them. [3]
- **Transcription as the evidence layer.** Kwon et al. (RNN-based transcription for piano alignment) report mean onset errors under 10 ms _(snippet)_; Simonetta et al. found the best alignment among
  those tested still used a piano-solo transcription model _(snippet)_; Kong et al. report 96.72 % onset F1 on MAESTRO for their high-resolution piano transcriber, with code and checkpoints public. [4][5][6]
  **Plan:** keep chroma DTW for the coarse path, add a neural onset map as a second evidence source for the refinement (piano), and compare it with the CQT-flux method on the reference points.
  Neither is trusted until it passes the project's acceptance (median 30 ms, 95th percentile 80 ms).
- **RUMAA** (arXiv 2507.12175) reports a score-informed piano model at 99.1 onset F1 on ASAP, and treats repeat-aware alignment _(snippet)_. Worth testing as an alternative front end. [7]
- **Tuning.** `cqt.tuning_cents` already estimates a recording's tuning. Period instruments (Handel, much of Bach on harpsichord) are often at A=415 Hz, a semitone below modern pitch; a pitch-resolved
  CQT refinement that assumes A=440 would look for every note in the wrong bin. Make the tuning offset an explicit, reported, per-recording value in `project.json`, and check that every pitch-resolved
  stage uses it (not yet verified in the code).
- **Repeats and jumps.** Our approach for the canons (align both written and unfolded, keep the cheaper) does not scale. JumpDTW (Fremerey et al., designed for Beethoven piano sonatas) needs the jump
  locations known; hierarchical DTW (Shan, Tsai) handles unknown ones and was reported better on several benchmarks _(snippet)_; "Just Label the Repeats" shows in-the-wild alignment improving from 33 % to
  82 % when the repeat structure is annotated _(snippet)_. Because **the score tells us where the repeats are**, JumpDTW's weakness (known block boundaries) is not ours. Plan: expand the score into
  blocks, let a jump-capable DTW choose per block between "taken" and "skipped", report the decision per repeat for a person to confirm. [8][9]

### 5.2 Where our sync tests fall short

- Our acceptance uses 44 reference points: isolated attacks, 4 of the 20 pieces without one, none by ear. For a new work, add reference points per piece by an assistant tool: play the piece with
  clicks at the aligned onsets and let a person tap corrections (the format is in `docs/sync-report.md`). Without one ear-checked point per piece, "passes the acceptance" means little.
- **Benchmark the aligner on public ground truth before trusting it on a new recording.** ASAP (and nASAP) pair 200+ scores with 1000+ MAESTRO performances with beat annotations and, in (n)ASAP,
  note-level alignments. A one-command benchmark on a sample of ASAP (Bach, Beethoven, Chopin, Liszt, Mozart are among its composers: _to verify against the repository's composer table_) gives numbers for exactly the repertoire in
  this plan. Vienna 4x22 (four excerpts played by 22 pianists, note-level) is a second, smaller set. [10][11]
- Pedal, dense chords and rubato blur onsets in audio: expect the "no clear onset" share (22–45 % of our notes) to be higher in Chopin and Liszt; the confidence field and the visual fallbacks matter more.

### 5.3 The faster path for MAESTRO pieces

MAESTRO is about 200 hours of paired audio and MIDI from the International Piano-e-Competition (CC BY-NC-SA 4.0); the MIDI comes from a Disklavier, so the performance MIDI and the audio are
recorded together. ASAP adds the scores and the score↔MIDI alignments. For pieces in both, **our note times can come from the dataset instead of from audio alignment**, which moves the question from
"can we align" to "can we show it". One caveat found in the search: I saw no published measurement of the audio↔MIDI alignment accuracy of MAESTRO; one paper only assumes it is perfect, and the
transcription literature notes that labels can be misaligned. Spot-check with the spectrogram view before relying on it. Licence: non-commercial, share-alike, attribution. [10][12]

### 5.4 Voices

The graph-neural-network approaches treat voice separation as predicting links between consecutive notes of the same voice (Karystinaios, Foscarin, Widmer 2023, arXiv 2304.14848) and, for piano, clustering
chords and predicting voice and staff together, including cross-staff voices (arXiv 2407.21030) _(snippets)_. Code and pretrained models exist. For Beethoven/Chopin/Liszt this replaces "median pitch";
for fugues keep our rule, which is exact when the MXL has one voice per part. [13][14]

### 5.5 Score input from PDF (OMR)

- Our PDF reading works because Contrapunctus Press' PDF is a clean vector engraving. Most IMSLP files are **scans**; those need OMR.
- A 2023 evaluation framework found the open-source Audiveris recovers noteheads, stems and beams with recall above 75 % but matched only about 45.8K of 52.9K ground-truth measures _(snippet)_.
  homr (reusing oemer's segmentation) focuses on pitch and rhythm and drops dynamics and articulation. Piano scores are hard for end-to-end OMR because they do not linearise well. [15][16]
- Newer: LEGATO (arXiv 2506.19065, ICLR 2026) is a transformer for multi-page typeset scores, reports large error reductions on a new IMSLP sample, and outputs ABC notation; end-to-end full-page pianoform OMR
  (Ríos-Vila et al., 2024) is a second line _(snippets)_. [17]
- **Consequence:** treat OMR output as a draft. Our audit method (compare OMR pitches with the audio and with a second source) is how it becomes trustworthy, and it is the single most valuable general tool
  we already have. Run a small head-to-head of Audiveris, homr and LEGATO on 5 pages of the target repertoire before choosing; the search found no such comparison.

### 5.6 Similar tools (what exists, what we can borrow)

- **Falling-note visualisers** (Synthesia-style): PianorollVis.js (waterfall and sequencer modes), synthviz (renders piano videos from MIDI or from audio via transcription), Pianola (GLSL piano roll), and
  WaveRoll (compares several MIDI piano rolls on a time-aligned grid with synchronised audio, built to evaluate transcription). None of the results was a score-and-recording aligned site like this one;
  **WaveRoll's idea of comparing two timing files on one grid is what the performer switch in 4.3 could grow into.** [18]
- **Score rendering**: Verovio reads MusicXML, Humdrum, MEI and others, exports a timemap and an expansion map, and warns that very large scores should be rendered server-side to SVG then driven by client
  JavaScript; our build-time SVG is that pattern. One `Toolkit` per thread. [19]
- **Libraries for alignment data**: partitura and the `match` file format for score↔performance alignments (used by ASAP and Vienna 4x22): adopt it as the exchange format if we import datasets. [10][20]
- I did not find an existing open tool that does what this project does end to end for classical recordings; absence of evidence from a few searches, not proof.

---

## 6. Material: which works, with what inputs, under which rights

I checked sources by search; **each licence must be re-read on its own page before use** (the OpenScore claim of CC0 came from a forum answer; Musopen's terms from secondary pages).

| Work                                   | Score (MXL / PDF)                                                                                         | Recording                                                                                                      | Notes |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----- |
| **WTC Book 1** (BWV 846–869)           | MuseScore's digital edition made for Ishizaka's release, public domain, with PDF and MusicXML [21]        | **Kimiko Ishizaka, CC0**, MP3 and FLAC, released 2015 [21]                                                     | all three inputs open; the best first public work |
| **WTC Book 2** (BWV 870–893)           | not found in the search; check OpenScore, Mutopia (CC BY-SA), KernScores, IMSLP                            | no open recording found; MAESTRO has some Bach                                                                 | the open recording ends with Book 1 as far as I found |
| **Goldberg Variations**                | Open Goldberg Variations score, public domain [21]                                                         | **Ishizaka's Open Goldberg, CC0** (same team) [21]                                                             | second open work; repeats in most variations |
| **Musical Offering** (BWV 1079)        | OpenScore or Mutopia if present (not checked); IMSLP scans                                                | needs a recording and its permission                                                                           | trio sonata + canons + the 3- and 6-part ricercars; instrument lanes; crab and spiral canons |
| **Beethoven piano sonatas**            | DCML lists a Beethoven piano sonatas repository in MuseScore format _(snippet; verify)_; KernScores; IMSLP; ASAP scores | MAESTRO (CC BY-NC-SA) has performances of some; others need permission                                       | repeats, da capo in minuets, dynamics range, cadenza-like passages, hands |
| **Chopin etudes**                      | ASAP (to verify which etudes); Mutopia; IMSLP; DCML covers Chopin's mazurkas, not the etudes                | MAESTRO (to verify)                                                                                            | 24 short, extremely dense pieces; tuplets of 5 and more; pedal and rubato; the hardest timing test |
| **Mozart sonatas**                     | KernScores has `mozart/sonatas` _(snippet)_; DCML Mozart sonatas _(snippet)_; Batik-plays-Mozart corpus links scores to performances [22] | Batik-plays-Mozart (check its licence); MAESTRO                                       | simpler texture, classical form, repeats |
| **Liszt**                              | IMSLP scans mostly; ASAP/MAESTRO for the popular pieces                                                    | MAESTRO                                                                                                        | densest of all; large scores; cadenzas; OMR would be poor |
| **Handel**                             | KernScores, Mutopia, OpenScore (check)                                                                     | needs a recording; period pitch likely                                                                         | da capo arias; harpsichord/organ sound; vocal works out of scope |

Rules that carry over from `docs/rights.md`:

- The **composition** is public domain for all of these composers. The **edition** (Henle, Bärenreiter) and the **recording** are not. A public site needs a recording whose licence says it may be hosted.
- Dataset licences (MAESTRO: CC BY-NC-SA 4.0) are fine for a private, non-commercial site with credit and share-alike for what we derive; they do not make a public release of the audio automatic.
- Shipped analyses of a recording (spectrogram tiles, loudness strip, note times) are not the audio but are derived from it. Ask for them to be covered when asking permission (also raised in `deployment.md`).
- Each work's rights live in its `project.json` and feed the credits page and `release-check`; the open/cleared list in `data/release.json` becomes per project.

---

## 7. Roadmap with gates

Each phase ends in a check that can fail. Effort is relative (S = days, M = 1–2 weeks, L = several weeks of focused work), my estimate, for one person.

| Phase | Content                                                                                                                                                                     | Effort | Gate (must pass to move on)                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Decisions in section 9. Choose directory layout (`projects/<slug>/`), naming, first targets.                                                                                | S      | the decisions are written into this file                                                                                                                 |
| **1** | **Refactor, no new features.** `project.json` for the Art of Fugue; `paths.py` and `pieces.py` read it; texts, credits, scenes and rights come from it; web asks for a project. | M      | the whole pipeline rerun produces **byte-identical** shipped data and the same build id; 412 unit tests and all browser checks still pass                |
| **2** | **Golden project + CI.** A short open score, rendered with a known uneven tempo map; the pipeline run end to end in CI; `artfugue doctor`; DAG with caching.                | M      | CI runs the full pipeline on the golden project; alignment error against the exact truth is measured and below the acceptance                            |
| **3** | **Score model v2.** Rationals, repeat/jump expansion with both orders, tempo map, staves, tuplets; shipped note record v2 (line kind, staff); events schema v2.             | L      | the Art of Fugue still byte-identical in meaning (a converter test); new fixtures with tuplets, repeats, da capo, two staves pass                         |
| **4** | **Audio v2.** Per-piece audio files, score/timing split, tuning offset, Sync Toolbox DTW, repeat decision per block, neural-onset evidence, benchmark on a sample of ASAP.   | L      | on ASAP sample: median ≤ 30 ms and 95th percentile ≤ 80 ms for the Bach and Mozart subsets, and the numbers for Chopin/Liszt reported honestly              |
| **5** | **Inputs missing.** No-PDF route, score mode (synthetic clock + sampler), audio-only route (transcription), OMR draft route with the audio audit.                            | L      | each route has a golden test; the player shows clearly which mode a work is in                                                                           |
| **6** | **Web v2.** Work shell and project data path, grouped piece lists, colour modes (line / hand / instrument / pitch class), scene picker, N-colour palette, density budget.   | M–L    | all existing browser checks pass on the Art of Fugue unchanged; `player-check` extended to a 48-piece work; `perf-check` on the densest passage per work  |
| **7** | **Target 1: WTC Book 1** (CC0). Fugue annotator with tonal answers; preludes by hands/streams; sync points by ear for each of the 48 pieces; public release possible.        | L      | `release-check --public` passes (all rights items cleared); soak test of the longest work; ear-checked reference point in every piece                      |
| **8** | Goldberg (CC0), then solo-piano previews from MAESTRO + ASAP (Chopin etudes, Beethoven, Mozart, Liszt) as private builds.                                                   | M each | per work: sync report, perf on the densest passage, rights file                                                                                          |
| **9** | Musical Offering, Handel: instrument lanes, harpsichord/organ samples, period tuning, retrograde and spiral canon links.                                                    | L      | tuning offset verified by ear; retrograde link verified against the score                                                                                |

---

## 8. Risks

| Risk                                                                                          | Why it matters                                                                                       | Mitigation                                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The refactor (phases 1–3) changes the Art of Fugue output by accident                         | the one finished work becomes a moving target                                                        | byte-identical gate in phase 1; keep the old data in git history (when you commit) and diff                          |
| The alignment is much worse on Chopin and Liszt than the Bach numbers suggest                 | our 44 points are isolated attacks in Bach; we found 250–300 ms errors there only because a test existed | benchmark on ASAP first (phase 4), report per composer; neural evidence layer; honest confidence in the UI            |
| Quality needs ears, and ears are one person's time                                            | 48 pieces × a few reference points; scenes to look at                                                | a tap-to-correct tool; accept "private preview, not yet heard" as a status in the project file                        |
| OMR on scans is not good enough                                                               | most IMSLP scores for Liszt/Handel are scans                                                         | prefer works with an MXL or `**kern`; budget a correction pass; use the audio audit                                    |
| Rights: no hostable recording for most of these works                                         | the site would stay private                                                                          | start with CC0 recordings; MAESTRO for non-commercial previews; ask permission early, including for derived analyses |
| Scope creep to orchestra and voice                                                            | alignment, transcription and OMR all degrade with many instruments                                   | state "solo keyboard first" in the project and refuse the rest for now                                                |
| Per-piece audio breaks gapless transitions and the single clock model                         | the engine was built around one file                                                                 | prototype on the golden project before touching the Art of Fugue; keep the single-file mode as a project option       |
| Performance on dense music (note buffer 1024, particles 4096)                                 | a Liszt passage may exceed the window                                                                | measure notes per second per work; the governor already lowers quality; raise the buffer if `truncated` ever fires    |
| Vercel Hobby limits for a 4-hour work (transfer 100 GB a month, per-file 100 MB)              | the Art of Fugue AAC file is already 97.5 MB                                                         | per-piece files; object storage if needed (`docs/audio-delivery.md`)                                                  |

---

## 9. Decisions for the owner

1. **Scope:** solo keyboard (piano, harpsichord, organ) first, ensembles later, orchestra and voice out? _(recommended: yes)_
2. **One site per work, or one library site with a work picker?** _(recommended: one build per work first; a library later, when there are three works)_
3. **Public releases only with openly licensed recordings** (Ishizaka CC0 and the like), everything else private? _(recommended: yes; it keeps `release-check --public` meaningful)_
4. **How much hand curation per work is acceptable** (ear-checked sync points per piece; scenes looked at)? This sets how many works are realistic.
5. **A name and a layout for the generalized project** (the repository is called art-of-fugue; `projects/<slug>/` keeps it, a rename is an option).
6. Whether to attempt **MAESTRO + ASAP previews** before the aligner is generalized (a fast path, non-commercial and share-alike; section 5.3).

---

## 10. Sources

Search results, read as snippets unless stated; none of the papers was read in full.

1. Sync Toolbox, Müller et al.: <https://github.com/meinardmueller/synctoolbox/> and the JOSS paper (DOI 10.21105/joss.03434).
2. Precise and Simple Audio-to-Score Alignment: <https://arxiv.org/pdf/2605.20014>
3. Snapping Matters: Context-Aware Onset Refinement for Automatic Music Transcription: <https://arxiv.org/pdf/2606.11903>
4. Audio-to-Score Alignment of Piano Music Using RNN-based Automatic Music Transcription (Kwon et al., 2017): <https://arxiv.org/pdf/1711.04480.pdf>
5. Audio-to-Score Alignment Using Deep Automatic Music Transcription (Simonetta et al., 2021): <https://arxiv.org/pdf/2107.12854>
6. High-resolution Piano Transcription with Pedals (Kong et al.): <https://arxiv.org/pdf/2010.01815>
7. RUMAA: Repeat-Aware Unified Music Audio Analysis: <https://arxiv.org/pdf/2507.12175>
8. Improved Handling of Repeats and Jumps in Audio–Sheet Image Synchronization (ISMIR 2020), arXiv 2007.14580: <https://arxiv.org/pdf/2007.14580.pdf>; Fremerey, Müller, Clausen, partial synchronisation and JumpDTW (ISMIR 2010).
9. Just Label the Repeats for In-The-Wild Audio-to-Score Alignment: <https://arxiv.org/pdf/2411.07428>; Real-time audio-to-score alignment with errors and arbitrary repeats and skips: <https://arxiv.org/pdf/1512.07748>
10. ASAP dataset: <https://www.github.com/fosfrancesco/asap-dataset>; (n)ASAP in TISMIR: <https://transactions.ismir.net/articles/333>; the match file format: <https://arxiv.org/pdf/2206.01104>
11. Vienna 4x22 and Saarland Music Data are described in the survey Musical Score Following and Audio Alignment (arXiv 2205.03247): <https://arxiv.org/pdf/2205.03247>
12. MAESTRO: <https://magenta.tensorflow.org/datasets/maestro>; GiantMIDI-Piano: <https://arxiv.org/pdf/2010.07061>
13. Voice separation by link prediction (Karystinaios, Foscarin, Widmer): <https://arxiv.org/abs/2304.14848>
14. Cluster and Separate: a GNN approach to voice and staff prediction for score engraving: <https://arxiv.deeppaper.ai/papers/2407.21030v1>
15. A Unified Representation Framework for the Evaluation of OMR Systems: <https://arxiv.org/pdf/2312.12908>
16. homr: <https://github.com/liebharc/homr>; piano OMR: <https://web3.arxiv.org/abs/2403.13763>
17. LEGATO: <https://arxiv.org/html/2506.19065v1>
18. PianorollVis.js <https://github.com/lukewys/PianorollVis.js>, WaveRoll <https://awesome.ecosyste.ms/projects/github.com%2Fcrescent-stdio%2Fwave-roll>, synthviz <https://awesome.ecosyste.ms/projects/github.com%2Fjxmorris12%2Fsynthviz>
19. Verovio: <https://github.com/rism-digital/verovio>, use cases <https://book.verovio.org/introduction/use-cases.html>
20. Subject and counter-subject detection for the WTC fugues (HAL): <https://hal.archives-ouvertes.fr/hal-00712554>
21. Open Well-Tempered Clavier (Ishizaka, CC0): <https://welltemperedclavier.org/kimiko-ishizaka-releases-open-well-tempered-clavier>; MuseScore/Libre Arts: <https://librearts.org/2015/03/kimiko-ishizaka-and-musescore-team-release-open-well-tempered-clavier/>
22. Batik-plays-Mozart corpus: <https://ar5iv.labs.arxiv.org/html/2309.02399>
23. DCML corpora: <https://github.com/DCMLab/dcml_corpora>; KernScores: <https://kernscores.stanford.edu>; OpenScore Lieder: <https://github.com/OpenScore/Lieder>; Mutopia licence: <https://ibiblio.org/mutopia/legal.html>; Musopen (public domain mark on Commons copies).
24. Gaps I could not fill: OpenScore's licence confirmed only by a forum answer; Basic Pitch and MT3 accuracy limits not retrieved (Basic Pitch is an instrument-agnostic model that "works best on one instrument at a time"); the head-to-head OMR comparison does not seem to exist; no published measurement of MAESTRO's audio↔MIDI alignment accuracy found; ASAP's composer breakdown not retrieved; WTC Book 2 open recording not found.

https://www.seemusicapp.com windows desktop app to youtube vid from mxl/midi