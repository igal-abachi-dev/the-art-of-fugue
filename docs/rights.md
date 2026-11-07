# Rights and licensing audit (T0.2.1)

Status: first pass, **not legal advice**. Items marked UNVERIFIED need a human check
before any public release.

## Decision (from the project owner)

- Deployment is a **private preview**, **non-profit**.
- Where possible, **link to the performer's video** instead of treating the recording as a public asset.
- Whether the encoded audio may be hosted publicly stays **open** (see "Open items").

## Assets

| Asset                                      | What it is                                                                                                                            | Status                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording (Marta Czech, BWV 1080)          | WAV ripped from a YouTube video (id in the filename). Copyright belongs to the performer and/or label.                                | Fine for local development. Public hosting needs the performer's permission.                                                                                                                                                                                                                                                            |
| Score PDF                                  | IMSLP file PMLP5843, "Reference Score", CP 0101, edited and engraved by Dr. Dominic Florence, (c) 2021 Contrapunctus Press.           | **Verified from the PDF's own page 3: "licensed for distribution under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License".** Fine for private, non-profit use with attribution. Data derived from the engraving (page/system layout, bar numbers) should carry the same licence and credit if shared. |
| MusicXML (`.mxl`)                          | OpenScore transcription (MuseScore 2.1.0, encoded 2017-10-11), source <http://musescore.com/openscore-transcriptions/scores/4707641>. | **Verified from the file's identification block: "Creative Commons copyright waiver (CC0 1.0 Universal)".** No restriction; credit OpenScore as a courtesy.                                                                                                                                                                             |
| Henle HN 423                               | Mentioned in `context.md`. Only referenced, not in the folder.                                                                        | Not used as data. Do not reproduce its engraving.                                                                                                                                                                                                                                                                                       |
| Salamander Grand Piano (optional, E8)      | Samples by Alexander Holm.                                                                                                            | **CC BY 3.0** (attribution required), per the SFZ Instruments catalogue and repository (E8, `docs/sampler.md`; one source says public domain since 2022, not confirmed). Credited on the credits page; 2 MB of the Tone.js-hosted velocity layer are in `web/static/samples/`.                                                          |
| butterchurn, butterchurn-presets, three.js | Open-source libraries (butterchurn and the preset pack are MIT).                                                                      | Eight of the pack's presets are copied into `static/data/ambient/` (list and original names with their authors in `web/src/lib/ambient/curated.json`, authors named in each preset's name: martin, Rovastar, Che). Credit them and the libraries on the credits page (T7.5.3).                                                          |

## Open items

1. Can the encoded recording be hosted on a public URL? Needs the performer's (or rights-holder's) permission. A draft request is only needed if public hosting is wanted.
2. (resolved) Licence of the PDF is CC BY-NC-SA 4.0 and the MXL is CC0; both read from the files themselves. Re-check on IMSLP's file page before any public release.
3. Whether the preview can be password-protected or unlisted, so the audio is not publicly reachable. Vercel protects previews with its own login by default and Password Protection is a paid add-on; `noindex` and `robots.txt` keep the page out of search (`docs/deploy.md`). Nothing is deployed yet, and a host holds a copy of the file even behind a login.
4. The sampler mode (E8) plays the notes at the **aligned timings**, which were measured from the recording (the chosen method, T2.2.3, aligns the score to the recording): it uses none of the performer's sound but it keeps her phrasing. Whether that matters for a public release is for the project owner; the private, non-profit decision stands. An even-tempo piano from the score would avoid it and is not built (`docs/sampler.md`).

## Rules for the repo

- `data/raw/`, WAV and generated audio are git-ignored (see `.gitignore`). Nothing from them is committed.
- The deployed build must not contain the raw WAV: checked by `pnpm release-check` (T9.4.1, `docs/release.md`), which scans `build/`.
- Credits and attributions are shown in the app (T7.5.3).
