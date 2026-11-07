# Deployment (EN9.1: T9.1.1, T9.1.2, T9.1.3)

This is the reference (settings, caching, what was checked). The step-by-step guide, for GitHub, for Vercel and for the private preview with the audio, is [`deployment.md`](../deployment.md) at the repository root.

The site is plain static files (`web/build`, made by `adapter-static`; every page is prerendered and client-only). Nothing runs
on a server at play time. Hosting is Vercel, as the plan said; **nothing has been deployed yet**: that needs the owner's Vercel
account and a decision to upload the recording (see "What is not done").

## Settings (`web/vercel.json`)

| Setting          | Value                                                         | Why                                                                 |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Root directory   | `web` (in the project settings)                               | the repository root also holds `tools/`, `docs/`, `data/`           |
| Framework        | SvelteKit (static adapter)                                    |                                                                     |
| Install command  | `pnpm install --frozen-lockfile`                              | Node 20.19 or newer; the lockfile is `web/pnpm-lock.yaml`           |
| Build command    | `pnpm build`                                                  | `vite build`; output `web/build`                                    |
| Output directory | `build`                                                       |                                                                     |
| Environment      | none                                                          | there are no secrets and no server code                             |
| Clean URLs       | on                                                            | `/credits` and `/stage` are `credits.html` and `stage.html`         |
| Every response   | `X-Robots-Tag: noindex, nofollow`, `nosniff`, `Referrer-Policy: same-origin` | a private preview; `robots.txt` disallows everything |

### Caching (T9.1.2)

The data files and the piano samples keep their names, so a long cache is only safe if the **URL changes when the file does**.
That is what the build id is for: `python -m artfugue.fingerprint` (the last step of `pnpm data`) hashes every file under
`web/static/data` and `web/static/samples` and writes the first ten characters into the manifest as `build`; the app asks for
every one of those files as `…?v=<build>` (`web/src/lib/data/version.ts`). Each audio file carries the hash of its own bytes in
the `src` the manifest gives (`/audio/fugue.webm?v=570fde579f`). The manifest, the pages and `_app/version.json` are not versioned and are
revalidated on every visit (`max-age=0, must-revalidate`); they are what says which versions are current.

| Path                                                                                         | `Cache-Control`                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `/_app/immutable/*` (hashed by Vite), `/audio/*`, `/data/{pieces,spectro,notation,notation-verovio,ambient}/*`, `/data/overview.bin`, `/samples/*` | `public, max-age=31536000, immutable`    |
| `/data/manifest.json`, the pages, `robots.txt`, the favicon, `/_app/version.json`            | `public, max-age=0, must-revalidate`     |

Audio is also sent with `Accept-Ranges: bytes`; Vercel serves static files with byte ranges (206).

**Checked** (`pnpm build && pnpm deploy-check`): every file of the build is either immutable or revalidated as the table says
(nothing that can change under its URL is immutable), each header rule matches files, the manifest has a build id and each audio `src` the
hash of its file, no file reaches Vercel's 100 MB per static file (the AAC file is 97.5 MB). Then the build is served by
`scripts/vercel-emulator.mjs`, a small server that applies `vercel.json` and answers byte ranges, and the headers per URL are read as
the app asks for them: 206 with `Content-Range` for a range of the audio, to the end of the file, 416 beyond it. `pnpm browser-check
--url <the emulator>` plays both codecs in Edge and Firefox through it (the sound reaches the analyser, seeks resume, the clock keeps real time).
**This is an emulation written from Vercel's documented behaviour. What the edge does is only known after a deploy.**

## Deploying (when the owner decides to)

The audio files are generated and git-ignored, so a deploy that builds from Git would have **no audio**. Build locally and upload the
result:

```sh
cd web
pnpm data -- --encode      # only if web/static/audio is missing
pnpm build && pnpm deploy-check --require-audio
npx vercel build           # reads web/vercel.json, writes web/.vercel/output (the audio included)
npx vercel deploy --prebuilt          # a preview URL
```

- **Private preview (T9.1.1).** Vercel protects preview deployments with its own login by default ("Vercel Authentication"), so the
  preview URL is private to the team; "Password Protection" is a paid add-on and is the alternative for sharing with people outside
  it. Either keeps the page out of search (`noindex` and `robots.txt` do it as well). The production alias is a public URL unless
  protected too: do not promote a preview to production before `docs/release.md` is satisfied.
- **Size and traffic.** Hobby: 100 MB per static file and 100 GB a month of transfer; the AAC file is 97.5 MB, 2.5 MB under the limit
  (`docs/audio-delivery.md`, which also describes the move to object storage if a limit is hit). Only one of the two audio files is fetched
  per listener.
- **Rights.** Uploading the recording to a host is publishing it, even behind a login. The owner's decision so far is private,
  non-profit use; `docs/rights.md` and the release checklist (`docs/release.md`) say what is open.

## CI (T9.1.3, `.github/workflows/ci.yml`)

On every push and pull request: in `web/` the lint (prettier and eslint), `svelte-check`, the unit tests (which include the integrity of
the shipped data), the build and `deploy-check`; in `tools/` `ruff` and `pytest` (the tests that need the recording, the MXL or the
PDF skip themselves; the ones on the shipped data, the build id and the sync acceptance run). **Written, never run on GitHub**: the first push is
its first test. It does not run the real-browser checks (they need the audio and a display).

## What is not done

- Nothing is deployed: the preview URL, the Vercel edge's actual headers and ranges, and the speed of a 97 MB file from the CDN are unmeasured.
- The workflow has not run.
