# Annotations (T1.3.x)

Rule-based detectors in `tools/artfugue/annotate.py`; output in `data/work/score/events/<piece>.json`
(schema `schema/events.v1.json`). All thresholds are constants at the top of the module.

| piece | bars | subject entries | B-A-C-H | clashes | crossings | canon links | themes (first bar) |
|---|---|---|---|---|---|---|---|
| c01 | 78 | 10 | 3 | 5 | 13 | 0 | S1@1 |
| c02 | 84 | 11 | 1 | 3 | 5 | 0 | S1@1 |
| c03 | 72 | 7 | 0 | 0 | 0 | 0 | S1@1 |
| c04 | 138 | 12 | 2 | 6 | 12 | 0 | S1@1 |
| c05 | 90 | 16 | 1 | 4 | 8 | 0 | S1@1 |
| c06 | 79 | 27 | 0 | 0 | 13 | 0 | S1@1 |
| c07 | 61 | 21 | 0 | 2 | 17 | 0 | S1@1 |
| c08 | 188 | 45 | 13 | 4 | 11 | 0 | S1@1, S2@39, S3@42, S4@94, S5@95, S6@96 |
| c09 | 130 | 14 | 0 | 7 | 16 | 0 | S1@1, S2@45, S3@59 |
| c10 | 120 | 23 | 0 | 6 | 5 | 0 | S1@1, S2@23, S3@53 |
| c11 | 184 | 41 | 10 | 4 | 22 | 0 | S1@1, S2@8, S3@28, S4@34, S5@89, S6@97 |
| c12r | 56 | 4 | 1 | 3 | 21 | 0 | S1@1 |
| c12i | 56 | 4 | 1 | 2 | 21 | 0 | S1@1 |
| c13r | 71 | 6 | 0 | 0 | 5 | 0 | S1@0 |
| c13i | 71 | 5 | 0 | 0 | 8 | 0 | S1@0 |
| c14 | 239 | 41 | 14 | 29 | 12 | 0 | S1@1, S2@121, S3@193 |
| k1 | 103 | 0 | 0 | 0 | 1 | 1 |  |
| k2 | 82 | 0 | 0 | 0 | 4 | 6 |  |
| k3 | 78 | 0 | 0 | 0 | 0 | 10 |  |
| k4 | 109 | 0 | 2 | 0 | 2 | 1 |  |

## Subject relations between pieces (first 7 intervals, ignoring rhythm)

Contrapunctus I's subject has intervals 7, -4, -3, -1, 1, 2, 1.

| piece | first intervals | relation to Contrapunctus I |
|---|---|---|
| c02 | [7, -4, -3, -1, 1, 2, 1] | same intervals (7/7 exact, rest within 2 semitones) |
| c03 | [-5, 3, 4, 1, -1, -2, -1] | inverted intervals (4/7 exact, rest within 2 semitones) |
| c04 | [-7, 3, 4, 1, -1, -2, -2] | inverted intervals (4/7 exact, rest within 2 semitones) |
| c05 | [-7, 2, 1, 2, 2, 1, -1] | different subject |
| c06 | [7, -2, -2, -1, -2, -1, 1] | different subject |
| c07 | [7, -2, -2, -1, -2] | different subject |
| c08 | [-2, 5, -6, -1, -1, 5, -7] | different subject |
| c09 | [12, -1, -2, -2, -2, -2, -1] | different subject |
| c10 | [1, -5, 8, -1, 5, -7, 2] | different subject |
| c11 | [7, -2, -2, -1, -2, -1, 1] | different subject |
| c12r | [7, -4, -3, -1, 1, 2, 1] | same intervals (7/7 exact, rest within 2 semitones) |
| c13i | [5, -12, 2, 1, -1, 1, 2] | different subject |
| c14 | [7, -2, -2, 2, 2, -7] | different subject |

Reading: II shares the subject of I; III and IV use its inversion (III with tonal adjustments
in the first intervals); XII (rectus) has the same intervals as I with different note values (the
rhythm check excludes it from the subject search, which is by interval and rhythm). V, VI, VII,
VIII-XI, XIII and XIV have their own subjects. Within pieces, the detector finds diminution and
inversion in VI (the "French style" piece), augmentation in VII and inversion in V. This agrees
with the grouping in `context.md` for VI-VII; V is a counter-fugue by inversion and stretto rather
than by augmentation or diminution, so the ribbon scene (augmentation/diminution) belongs to VI and
VII. Diminution in VII was not detected (the detector may miss it where notes are ornamented).

## What each detector does, and its limits

- **Subject entries (T1.3.1).** The subject is the first 8 notes of the first voice's opening line
  (up to the second voice's entry). Search finds windows with the same intervals (rectus), the
  negated intervals (inversus), or the same intervals at twice or half the note spacing
  (augmentation, diminution). Tonal answers are tolerated (intervals may differ by up to 2 semitones
  in a minority of positions). In Contrapunctus I the exposition comes out right: alto bar 1,
  soprano 5, bass 9, tenor 13. Limits: other themes of double/triple fugues are *discovered*
  (entries after a rest that repeat at least 3 times), which can miss or invent themes; Contrapunctus XIV
  uses the MXL's own section labels (XIXa/b/c) and the exact B-A-C-H as seeds for its three subjects.
  Pieces V-VII (counter-fugues) give 16-27 hits; confirming which of them are inversions,
  augmentations or diminutions against the score (and against the claims in `context.md`) is still
  to be done by listening/reading, so the `kind` values in `pieces.json` stay provisional.
- **B-A-C-H (T1.3.2).** Four consecutive notes in one voice with intervals -1, +3, -1. `form` is
  `exact` (pitch classes 10, 9, 0, 11, any octave), `transposed`, `inverted` or `retrograde`. Only
  `exact` events should drive visuals: the transposed and inverted interval patterns also occur by
  chance (13 hits in Contrapunctus VIII, 8 in XI). In XIV the first exact hit is at bar 193, where
  the MXL labels the third subject's exposition, and there are six exact hits there.
- **Clashes and crossings (T1.3.3).** A clash is a minor second / major seventh (or compound) between
  two voices sounding together for at least a quarter note. A crossing is an upper voice sounding
  below a lower voice. Counts are small enough to be used as shockwave triggers (at most about 0.2
  per bar).
- **Mirror links (T1.3.4).** `mirror_links.json` links each note of a derived piece to its source
  note (same onset and duration, mirrored pitch); `events/` also carries one `mirror-link` event per
  bar of the four mirror pieces. The derived XII and XIII pieces are checked against the PDF noteheads
  (`verified: true`, `pdf-audit.md`).
- **Canon links (T1.3.5).** The follower's restatement of the leader's opening (earliest match with
  at least 80 % identical intervals) is found with the same matcher (transposition, inversion,
  augmentation), and runs of at least 4 linked notes are recorded with offset, ratio and
  transposition. Results:

| canon | relation found | linked / follower notes |
|---|---|---|
| k1 | rectus, transposition -12 semitones, x1, offset 2.2 whole notes | 639 / 646 |
| k2 | rectus, transposition +19 semitones, x1, offset 12.0 whole notes | 41 / 713 |
| k3 | rectus, transposition +19 semitones, x1, offset 8.0 whole notes | 255 / 520 |
| k4 | augmentation-inversus, transposition -5 semitones, x2, offset 4.0 whole notes | 188 / 690 |

  Canon 1 (alla Ottava) and Canon 4 (augmentation in contrary motion) come out as expected. Canon 2
  and 3 are only partly linked: they are canons at the 10th and 12th with free counterpoint
  between the strict passages, and a plain interval matcher does not follow those.
