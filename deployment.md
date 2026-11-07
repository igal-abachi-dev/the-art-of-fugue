# Deployment: GitHub, Vercel, and a private preview with the audio

Three jobs, in this order:

1. [Put the repository on GitHub](#1-put-the-repository-on-github): the code, the pipeline, the docs and the shipped data. **Not** the audio, the recording, the PDF.
2. [Serve the repository on Vercel](#2-serve-the-repository-on-vercel): what Vercel builds from Git. It has **no audio**, so it is a silent site.
3. [Publish a private preview with the audio](#3-private-preview-with-the-audio-opus-aac-spectrogram-engravings): the real thing, uploaded from your machine. Only after the rights are in hand.

The settings and the caching rules behind this are in [`docs/deploy.md`](docs/deploy.md); the checklist in [`docs/release.md`](docs/release.md); the rights in
[`docs/rights.md`](docs/rights.md).

**What has and has not been tried.** Everything that runs on this machine has been: the build, `pnpm deploy-check` (the headers and byte ranges, through an emulator of `vercel.json`),
`pnpm release-check`, the browser checks against `localhost:4173`. **Nothing here has been run against GitHub or Vercel**: no account was used, the CI workflow has never run, `vercel build`
has not been run on this app, and the Vercel edge's own headers and range answers are unmeasured. The steps below are written from Vercel's and GitHub's documentation; the places where
something may differ are marked **(verify)**.

---

## 1. Put the repository on GitHub

### What goes up, and what stays home

`.gitignore` already keeps the heavy and the private files out. As of 2026-11-06 Git would add **662 files, about 140 MB**; the largest file is 7 MB.

| Goes up (committed)                                                                          | Size      | Why                                                                                         |
| -------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `web/` source, `web/vercel.json`, `web/pnpm-lock.yaml`                                       | < 2 MB    | the app and the deployment settings                                                         |
| `web/static/data/`: manifest, note chunks, spectrogram tiles, both engravings, overview, ambient presets | 106 MB    | **the data the page needs to run**, so the app works without the Python pipeline            |
| `web/static/samples/` (30 MP3, Salamander piano)                                             | 2 MB      | the sampler mode                                                                            |
| `tools/` (Python pipeline and its tests), `schema/`                                          | < 2 MB    | how the data was made                                                                       |
| `data/derived/`, `data/anchors.json`, `data/pdf_overrides.json`, `data/sync-reference.json`, `data/release.json` | 1 MB      | the checked MXL and the hand-made inputs                                                    |
| `docs/` (with 100 screenshots), `README.md`, `deployment.md`, `backlog.md`, `plan.md`, `context.md`, `.github/` | 27 MB     | documentation, CI                                                                           |

| Stays home (git-ignored)                                     | Why                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `data/raw/`: the WAV, the PDF, the MXL                       | third-party material; the recording is not yours to publish                      |
| `data/work/`                                                 | intermediate output (gigabytes)                                                  |
| `web/static/audio/` (`fugue.webm` 91 MB, `fugue.m4a` 98 MB)  | generated from the recording; also near GitHub's 100 MB per-file limit           |
| `*.wav *.flac *.opus *.webm *.m4a *.ogg`                     | audio in any form, anywhere                                                      |
| `node_modules/`, `tools/.venv/`, `web/build/`, `web/.svelte-kit/`, `web/.vercel/`, `.env*` | rebuilt or secret                                                                |

Two things to decide **before the repository is public** (a private repository does not need either yet):

- **A licence for the project's own code** has not been chosen (`docs/rights.md`). The data derived from the Contrapunctus Press score (the notehead positions, the SVG pages, the
  checked MXL) must stay CC BY-NC-SA 4.0 with the credit; the OpenScore MXL is CC0.
- **The shipped spectrogram tiles, the loudness strip and every note's time are measurements of the recording.** They are not the audio and cannot be played back, but `docs/rights.md` does not
  say whether publishing them is covered by the permission you ask for. Include them in the question to the performer or label.

So: **create the repository as Private.** Make it public only after both are settled.

### Steps (PowerShell, from the repository root)

```powershell
cd D:\Libraries\Repositories\art-of-fugue

# 1. what would go up: nothing from data\raw, data\work, static\audio, no audio file, nothing big
git ls-files --others --exclude-standard | Measure-Object                       # about 662 files
git ls-files --others --exclude-standard | Select-String -Pattern '\.(wav|webm|m4a|opus|flac|ogg|pdf)$|data/(raw|work)/|static/audio'   # must print nothing
git ls-files --others --exclude-standard | ForEach-Object { Get-Item $_ } | Where-Object Length -gt 20MB                              # must print nothing

# 2. the first commit (you do this; the files are untracked until you do)
git add .
git commit -m "The Art of Fugue: interactive audio-visual site"
```

3. On github.com: **New repository**, name `art-of-fugue`, **Private**, and leave "Add a README", ".gitignore" and "licence" **unticked** (the repository has them or does not want them).
4. Connect and push (the page shows these two lines with your user name):

```powershell
git remote add origin https://github.com/<your-user>/art-of-fugue.git
git push -u origin main
```

With the GitHub CLI instead (`winget install GitHub.cli`, then `gh auth login`): `gh repo create art-of-fugue --private --source . --push`.

5. **Look at the Actions tab.** The push starts `.github/workflows/ci.yml` (lint, types, 412 unit tests, build, `deploy-check`, `release-check`, `ruff`, `pytest`; no audio needed). It has **never run**,
   so a first red run is a likely and cheap thing to fix, not a sign of a broken site; read the log of the failing step.

The first push uploads about 140 MB; it takes a few minutes.

---

## 2. Serve the repository on Vercel

Vercel can build the site straight from the GitHub repository. Because the audio is not in Git, **that build has no audio**: the player, the score, the spectrogram, the scenes and the
sampler piano all load, but the recording does not play. That is useful to see that the build works on Vercel's machines; it is not the finished site (section 3 is).

1. vercel.com, sign in (**Continue with GitHub** is the simplest), **Add New, Project**, import `art-of-fugue` (give Vercel access to that one repository only).
2. In the configuration screen:
   - **Root Directory: `web`** (the repository root also holds `tools/`, `docs/`, `data/`).
   - Framework: SvelteKit. Install, build and output come from `web/vercel.json` (`pnpm install --frozen-lockfile`, `pnpm build`, `build`). Leave them.
   - Environment variables: none. Node 20.19 or newer (the project setting defaults to a current version) **(verify)**.
3. **Deploy.** Every push to `main` is then a Production deployment, every other branch a Preview.

What to know:

- **Deployment Protection** (project Settings, Deployment Protection): *Vercel Authentication* is on by default and covers Preview URLs. On the Hobby plan the **production** URL
  (`art-of-fugue.vercel.app`) stays public **(verify: Vercel's pages disagree)**. For the silent build that is harmless (the score engraving is CC BY-NC-SA and credited), but read section 3 before any audio is
  attached to a project.
- The site sends `X-Robots-Tag: noindex, nofollow` and `robots.txt` disallows everything, so search engines are asked to stay away. That asks; it does not lock anything.
- If you will deploy the audio yourself (section 3), a project that also builds from Git will replace nothing and add a **silent** build at every push. Either use a separate project for
  the audio deploys, or stop the Git builds: Settings, Git, **Ignored Build Step**, command `exit 0`.
- Hobby is Vercel's non-commercial plan, which fits a private, non-profit project.

---

## 3. Private preview with the audio (Opus, AAC, spectrogram, engravings)

Do this only when the rights are in hand. **Uploading the recording to a host is publishing it**, even behind a login: Vercel stores the file on its servers and serves it. The words
"private", "unlisted" and "preview" describe who is *shown* the URL, not who is *allowed* to fetch the files if they find it.

### 3.1 The rights first

| Item                                                          | What you need                                                                                              | Where it is recorded |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| The recording (Marta Czech)                                   | the performer's or the label's **written** permission for the kind of access you will give (private to you, a named few, anyone with the link) | `data/release.json`  |
| The score engraving and the data drawn from it (CP 0101)      | already CC BY-NC-SA 4.0 (read from the PDF): non-commercial, credit, the same licence for derived data. **Open: look once at IMSLP's page for the file** to confirm it still says so | `data/release.json`  |
| The MusicXML (OpenScore)                                      | CC0, nothing to ask                                                                                        | `data/release.json`  |
| The piano samples (Salamander)                                | CC BY 3.0, credited on the credits page                                                                    | `data/release.json`  |
| The sampler plays the recording's aligned timings (her phrasing) | your decision: accept it, or have the permission cover it                                               | `data/release.json`  |

When an item is settled, change its `"status"` in `data/release.json` from `"open"` to `"cleared"` and write the evidence in `"evidence"` (who, when, what they said). The script reads the file;
it cannot judge the evidence, you can.

### 3.2 What Vercel must receive

The finished build, `web/build`, is **289 MB in 337 files**. For the site to run on Vercel exactly as it runs on `localhost:4173`, every row has to be in it:

| In `web/build/`                              | Size   | What it is                                                                                   | Where it comes from                         |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `audio/fugue.webm`                           | 91 MB  | the recording as **Opus** (primary)                                                          | `web/static/audio/`, **not in Git**         |
| `audio/fugue.m4a`                            | 98 MB  | the recording as **AAC** (fallback: Safari, and any browser that refuses the Opus)           | `web/static/audio/`, **not in Git**         |
| `data/manifest.json`                         | 88 KB  | the pieces, the two audio files with their hashes, the build id                              | `web/static/data/`                          |
| `data/pieces/*.bin`, `*.events.json`         | 1 MB   | every note of every piece (position, voice, time) and the annotations                        | `web/static/data/`                          |
| `data/spectro/*.bin`                         | 67 MB  | the **spectrogram** tiles, one file per piece                                                | `web/static/data/`                          |
| `data/notation/` and `data/notation-verovio/` | 25 + 14 MB | the **engravings**: the PDF's own and Verovio's, as SVG with the notehead positions        | `web/static/data/`                          |
| `data/overview.bin`, `data/ambient/`         | 0.1 MB | the seek bar's loudness strip; the MilkDrop presets                                          | `web/static/data/`                          |
| `samples/*.mp3`                              | 2 MB   | the piano for the sampler mode                                                               | `web/static/samples/`                       |
| `_app/`, the pages, `robots.txt`, `favicon.svg` | 1.3 MB | the app itself                                                                               | `pnpm build`                                |

Everything but the two audio files is in Git, so a Git build already has it. **The audio is why the upload is made from your machine**, as a prebuilt deployment: you build locally (where the
audio is), and send Vercel the finished `build` folder instead of asking it to build.

A limit to know: Vercel's Hobby plan lists **100 MB per static file**; the AAC file is 97.5 MB, 2.5 MB under it. If you re-encode, check the size again (`pnpm deploy-check` fails above 100 MB). Transfer is
100 GB a month on Hobby, about 1,000 full plays with Opus (`docs/audio-delivery.md`). The CLI's own documentation also mentions upload limits for *source* files; a prebuilt upload sends the build output
**(verify the first upload)**.

### 3.3 Steps (PowerShell)

```powershell
cd D:\Libraries\Repositories\art-of-fugue\web

# 1. the audio must be there (both files); if not: pnpm data -- --encode   (needs data\raw, Python, ffmpeg)
dir static\audio                                    # fugue.webm about 91 MB, fugue.m4a about 98 MB

# 2. build and check, with the audio required
pnpm install --frozen-lockfile
pnpm build
pnpm deploy-check --require-audio                   # headers, cache rules, hashes, byte ranges, the 100 MB limit
pnpm release-check --require-audio --public         # fails while a rights item in data\release.json is open

# 3. the Vercel command line, once: log in, and create the project from this folder
npx vercel login
npx vercel link                                     # "Set up?" yes; scope: yours; "Link to existing?" no; name: art-of-fugue; directory: ./  (that is web)
npx vercel pull --yes --environment=preview         # fetches the project's settings into web\.vercel

# 4. build the way Vercel would, then look at what will be uploaded
npx vercel build                                    # reads web\vercel.json; writes web\.vercel\output
dir .vercel\output\static\audio                     # BOTH audio files must be listed here; also .vercel\output\static\data
# (this step has not been run on this app: if .vercel\output\static is empty or lacks build\'s files, see "If it does not work")

# 5. upload as a PREVIEW (no --prod)
npx vercel deploy --prebuilt                        # prints https://art-of-fugue-<hash>-<you>.vercel.app
```

Re-deploying after a change is steps 2, 4 and 5 again; Vercel uploads only the files whose bytes changed (the 180 MB of audio is sent once).
**Never add `--prod` and never promote the preview** unless you mean it to be at the project's public address (3.4).

Keep the project's folder `.vercel/` out of Git (it is in `.gitignore`).

### 3.4 Who can open it

Vercel has no "unlisted" setting. It is made of three things: no link anywhere, a URL nobody guesses, and the site's own `noindex` header and `robots.txt` (already in `web/vercel.json` and
`web/static/robots.txt`). Whether the files can also be *fetched* by someone who has the URL is what the protection setting decides (Project, Settings, **Deployment Protection**):

| Setting                                         | Who gets the audio                                                    | Plan                       | Use it for                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| **Vercel Authentication** (default for previews) | only people signed in to your Vercel team (you)                       | Hobby and up               | **the private preview; recommended** while the permission is not wider       |
| Password Protection                             | anyone with the URL and the password                                  | a paid add-on (Pro) **(verify)** | showing it to a few people without Vercel accounts                         |
| Shareable link of a protected deployment        | whoever you give a link to, for as long as it lives                   | **(verify the plan)**      | one person for a while, without a password                                  |
| Protection off                                  | **anyone who has the URL**                                            | any                        | an unlisted link. This is publication of the recording: only with a permission that covers it |

**Check that the protection works, before anything else**, from a browser where you are *not* signed in to Vercel (a private window), or:

```powershell
curl.exe -I https://art-of-fugue-<hash>-<you>.vercel.app/audio/fugue.webm       # expect 401 (the login), not 200 or 206
```

A Vercel community post describes a Hobby-plan preview made with the CLI that was not protected **(unconfirmed; it is an unofficial post)**. If it answers 200 or 206, open
Settings, Deployment Protection and switch Vercel Authentication on for Preview deployments, or delete the deployment (Vercel dashboard, Deployments, the three dots, Delete) until it is.

The production address (`art-of-fugue.vercel.app`) is public on the Hobby plan **(verify)**; `vercel deploy` without `--prod` does not touch it. Do not add a custom domain until the release is public.
`pnpm release-check` includes the check that the build says `noindex`; if you ever list the site publicly, change `web/vercel.json` and `web/static/robots.txt` on purpose and adjust that check.

### 3.5 Look at it once it is up (by hand)

The automated browser checks cannot get past the Vercel login, so this one is yours. Signed in to Vercel, open the preview URL and:

1. The start screen, the warning about moving light, **Begin**; the first piece plays and the notes fall on the sound.
2. Drag the seek bar to the middle of a piece, to the end, to another piece: playing resumes at once each time (that is the **byte-range** answer of Vercel's edge, never measured).
3. The score button (both engravings in the effects menu) and the spectrogram button show the system and the sound with the notes on it.
4. The piano button plays the sampled piano; the second click returns to the recording.
5. In Safari, on an iPhone and on a weaker laptop, if you have them: this has never been tried (README, "Tests and checks").

In the browser's developer tools, Network tab: the audio answers **206** with `Content-Range`, the `/data/...` files `immutable`, and no red lines. The 100 MB limit, the 100 GB
transfer and the speed of a 98 MB file from Vercel's network are all unmeasured; if the start is slow, `docs/audio-delivery.md` describes moving the audio to object storage.

### 3.6 If it does not work

| What you see                                                    | Likely cause and what to do                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vercel build` ends with 404 on `/`, or `.vercel\output\static` lacks `audio` or `data` | The SvelteKit preset did not take `build/` as the output. In `web/vercel.json` change `"framework": "sveltekit"` to `"framework": null`, run `vercel pull` and `vercel build` again |
| The page loads, nothing plays                                   | the audio is not in the deployment: it was built from Git, or `static\audio` was empty when you ran `pnpm build`. Rebuild with the files in place and redeploy |
| The audio does not seek                                         | the edge answered 200 where 206 was expected: look at the Network tab (`Accept-Ranges`, `Content-Range`); `pnpm deploy-check` shows what the emulation expects |
| `Error: ... exceeds ... limit` on upload                        | the AAC file is over the plan's size for one file; re-encode smaller (`tools/artfugue/encode_audio.py`, AAC 128 is 78 MB) or move the audio to object storage |
| A hash mismatch or a stale file after a change                  | the page asks for `?v=<build id>`; run `pnpm data` (it ends with the fingerprint step) or `python -m artfugue.fingerprint`, then build and deploy again      |

### 3.7 Taking it down

Vercel dashboard, the project, Deployments, the three dots, **Delete**; or `npx vercel remove art-of-fugue`. Deleting the project removes everything it served. A copy of the files may sit in Vercel's
cache for a short while; and if the repository ever held the audio, deleting it from the working tree does not remove it from Git's history. That is why the audio is kept out of Git.

---

## 4. Is Vercel the right free host? Other hosts, and putting the files in a database

Asked 2026-11-06: "I do not want to pay; should I use Render, Netlify, Cloudflare Pages, Surge, Cloud Run, or put the large files in a database like Neon instead?"

**Answer: stay on Vercel Hobby for now, and do not put files in a database.** Vercel Hobby is free (no card), it fits the two audio files (the AAC file is 97.5 MB against a 100 MB limit), and its login protection for
previews is free. The things in this project that decide the choice are: two audio files of 91 and 98 MB with byte-range requests, an access control that is free (the recording's rights), and a build that already
exists. Limits below come from search results on 2026-11-06; **third-party pages are marked; confirm each on the host's own pricing page before relying on it. None of these hosts was tried.**

| Host                          | Free?                                              | Fits our files?                                                                                       | Free way to keep it private                                      | Verdict |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------- |
| **Vercel Hobby** (now)        | yes, non-commercial use                            | 100 MB per static file, 100 GB a month ([limits](https://vercel.com/docs/limits)); AAC is 97.5 MB       | Vercel Authentication on previews ([docs](https://vercel.com/docs/deployments/deployment-protection)); the production URL stays public (docs disagree) | **keep** |
| Cloudflare Pages              | yes                                                | **25 MiB per file**, 20,000 files ([limits](https://developers.cloudflare.com/pages/platform/limits)): our audio does not fit as one file | Cloudflare Access is free for 50 users (third-party pages; whether it covers `*.pages.dev` without your own domain is **unconfirmed**) | the upgrade path for the audio, see below |
| Cloudflare R2 (audio only)    | 10 GB stored, no egress fee ([limits](https://developers.cloudflare.com/r2/platform/limits)) | yes; the `r2.dev` address is rate-limited and "not for production", so a custom domain (a few euros a year) is needed | by the Access policy on that domain                              | best place for the audio if traffic grows |
| GitHub Pages                  | only for **public** repositories ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) | site up to 1 GB, soft 100 GB a month                                  | none: everything is public                                       | only for an openly licensed recording |
| Netlify                       | free plan is now **300 credits a month, a hard limit**; bandwidth costs credits (10 or 20 per GB, sources disagree) and the sites pause when they run out ([third party](https://netli.fyi/blog/netlify-free-plan-limits-2026)) | would pause after roughly 15–30 GB of audio, 150–330 full plays | password protection needs a paid plan                            | worse than Vercel |
| Render (static)               | 100 GB a month included, then **$0.10 per GB with no hard cap** ([forum](https://community.render.com/t/usage-100gb-for-a-static-site/2000)) | fits                                                                                                  | none that I found                                                | a surprise bill is possible |
| Surge.sh                      | yes ([plans](https://surge.sh/docs/platform/plans))  | size limits not stated                                                                                | password protection is a paid feature                            | no |
| Google Cloud Run              | needs a billing account; 1 GiB free outbound data a month ([pricing](https://cloud.google.com/run/pricing)) | a full Opus play is 91 MB: about 11 plays and the free traffic is gone | none                                                             | wrong tool (it runs containers) |

### Files in a database (Neon or any Postgres): no

A database is the wrong place for the audio, and what the project does now (static files behind a CDN) is the standard right design:

- A page cannot read a database. You would write and host a server that reads the bytes and answers **byte-range requests** correctly (seeking depends on them), and that server is the thing that needs hosting and a free plan.
- No CDN or browser cache sits in front of it: every play goes through the server and the database, with compute hours, cold starts and traffic limits of the free plan (I did not search Neon's limits; check them).
- The files would then be 180 MB of binary in a table you back up and restore with the rest of the data.
- Object storage (R2, B2, S3) is built for exactly this: cheap, ranges, CDN, and for R2 no egress fee.

### When to change, and how

Watch these three; nothing needs changing before one of them happens:

1. **More than about 1,000 full plays a month** (100 GB divided by 91 MB), or Vercel pausing the project. Move **only the audio** to Cloudflare R2 behind a custom domain, keep the site on Vercel. The app is ready for it:
   `web/src/lib/playback/graph.ts` already sets `crossOrigin` for audio from another origin, which the Web Audio graph needs. You must set the bucket's CORS to allow your site's origin (`Access-Control-Allow-Origin`, and
   `Range` and `Content-Range` exposed), and write the audio's absolute URL into the manifest `src` (the fingerprint step writes the `?v=` hash; the host part is the only change). Not tried.
2. **You want to show it privately to named people for free.** Vercel's free protection is for your own account. Cloudflare Access (free for 50 users, third-party sources) in front of your own domain does that. Not tried.
3. **A file grows past 100 MB, or a longer work arrives.** Cut the audio into one file per piece (`generalization-plan.md`, 4.3). Per-piece files would also fit Cloudflare Pages' 25 MiB limit (the longest piece, Contrapunctus XIV at 8 min 19 s, is about 9 MB as Opus 128, by the file's average rate), so
   the whole site could move there with no object storage. The engine is built around one file today; this is a real change.

Money: the only cost that could appear on a free route is a domain name (Access and R2 production use need one). Vercel Hobby, R2's free tier and GitHub Pages cost nothing, but **Render and R2 charge past
their free amounts if a card is on file**, and Netlify pauses its sites instead of charging (Vercel Hobby's over-limit behaviour I did not check).
