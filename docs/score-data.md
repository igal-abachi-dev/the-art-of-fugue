# Score data format and rules (E1)

Produced by `tools/artfugue/build_score.py` and `annotate.py` into `data/work/score/` (git-ignored,
rebuilt on demand). Schemas: `schema/notes.v1.json`, `schema/pieces.v1.json`,
`schema/events.v1.json`; TypeScript types are generated from them (`pnpm gen:types` in `web/`, output
`web/src/lib/types/score.generated.ts`).

## Rebuild

```powershell
cd tools
.venv/Scripts/python.exe -m artfugue.build_score     # notes/*.json, pieces.json, validation.json
.venv/Scripts/python.exe -m artfugue.annotate        # events/*.json, mirror_links.json
.venv/Scripts/python.exe -m artfugue.render_midi     # data/work/midi/*.mid for listening checks
.venv/Scripts/python.exe -m artfugue.audit_pdf       # lists bars that still differ from the PDF
.venv/Scripts/python.exe make_docs.py                # regenerate docs/*.md tables
.venv/Scripts/python.exe -m pytest -q                # rebuilds everything and runs the checks
```

## Files

| File                                         | Content                                                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pieces.json`                                | one record per piece (20 PDF pieces, 4 excluded early versions): title, kind, status, voices, bars (with PDF page and system), time signatures, tempos, repeats |
| `notes/<id>.json`                            | the notes of one piece, sorted by onset                                                                                                                         |
| `notes/<id>.unfolded.json`                   | the same with repeats taken (only Canon 1 and 3 among used pieces)                                                                                              |
| `events/<id>.json`                           | annotations: subject entries, BACH, clashes, crossings, canon links                                                                                             |
| `mirror_links.json`                          | note-to-note links of the derived mirror pieces                                                                                                                 |
| `pdf_corrections.json`                       | every pitch changed because the engraving disagreed with the MXL, and the bars that still differ                                                                |
| `validation.json`, `annotation_summary.json` | numbers behind the checks                                                                                                                                       |

## Time and addressing

- **Ticks:** `on` and `dur` are integer ticks, `ppq` = 24 ticks per quarter note (exact for triplets
  and sextuplets). `on` counts from the start of the piece.
- **Bars:** `bar` is the **printed bar number** of the PDF (0 = pickup, then 1, 2, ...). `beat` is the
  tick offset inside the bar. Each bar record has `pdf_page` (physical page of the Contrapunctus
  Press PDF) and `pdf_system` (0 = top system). This is the key for mapping the audio to the PDF.
- **Voices:** see `voices.md`. `part` keeps the original MusicXML part.
- E2 adds `t_on`, `t_off`, `vel`, `conf` per note and `t` per bar, with no change to the above.

## Rules applied when reading the MXL

| Topic                 | Rule                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden notes          | 49 notes with `print-object="no"` are skipped                                                                                                                                 |
| 5th part "Combined"   | ignored when parts 1-4 have notes (duplicate reduction); the only source for the four canons                                                                                  |
| Ties                  | merged into one longer note (same part, voice and pitch, end = next start)                                                                                                    |
| Grace notes           | kept, flagged `grace`, `dur` 0, onset = onset of the following principal note                                                                                                 |
| Ornaments             | trills, mordents, turns are **not expanded**; the written note carries a flag (`trill`, `mordent`, `inverted-mordent`, `turn`) so alignment can allow a flurry of notes there |
| Fermata, staccato     | flagged `fermata`, `staccato`                                                                                                                                                 |
| Chords                | each chord note is its own note (same onset)                                                                                                                                  |
| Same-onset duplicates | 5 cases (ornament-related duplicates of one pitch with different durations) are kept as written                                                                               |
| Final bars            | the last bar of a piece may be longer or shorter than the time signature (final chord with fermata); tests allow this for the last bar and for pickups only                   |
| Repeats               | both written and unfolded forms exist; which one the pianist plays is decided after alignment                                                                                 |
| Excluded pieces       | `x1`-`x4`: early versions and the 4-voice XIII version; present in the data with `status: excluded`                                                                           |
| Derived pieces        | `c12i`, `c13r`: mirrors of their partner (rhythm, onsets, voices) whose pitches are then read from the PDF noteheads (`status: derived`, `verified: true`)                    |
| PDF audit             | every pitch of the 18 MXL pieces is compared with the engraved noteheads; wrong notes are corrected when the corrected bar then agrees completely (`docs/pdf-audit.md`)       |

## Known data limits

- Pitches are audited against the PDF noteheads bar by bar (`docs/pdf-audit.md`): 84 notes were
  corrected, 23 bars still differ and are listed there. Durations, ornaments and voice assignment
  are not audited against the PDF.
- The derived pieces take rhythm and voices from their partner piece; only their pitches are read
  from the engraving.
- `kind` in `pieces.json` is provisional (from music theory and `context.md`); the annotation work
  confirms or corrects it (see `annotations.md`).
