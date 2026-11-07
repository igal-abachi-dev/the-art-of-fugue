"""The organ's registration score: for each piece and each of its voices, when the organ plays the full rank and when the flute.

Run:  python -m artfugue.registration
Writes web/static/data/organ-registration.json (the sampler's organ reads it; nothing is decided in the browser).

Why a score and not a rule in the player: an organist decides the registration of a piece once, in the study, and plays it the same
way every time. A rule run in the browser gives the same answer too, but it cannot be read, checked or corrected by a person. The
score can: it is a small file of ``[start, end, rank]`` segments per voice, and ``data/organ-registration-overrides.json`` (committed)
is applied over it, so a passage that sounds wrong to the owner's ear is fixed by writing it down, not by changing a rule.

How the score is made (the rule, the same for every piece). It reads three things: the **notes** of the MusicXML (pitch, voice, the
subject entries the analysis found in them), the **recording's loudness and brightness** over time (read from the waveform: the RMS
level and the spectral centroid of the recording, one second at a time), and the **bar lines** (a registration is changed at a bar
line, as a hand changes manuals, not in the middle of a bar). In this order:

(Each piece also has a **character**, my reading of the music and no more than that, below `PROFILES`: how far it leans to the full
rank or to the flute, and whether the secondary themes of a multiple fugue take the flute for contrast with the first.)

(An organist registers a fugue by **focus**: the voice that has the music's attention at a moment, the theme or the line that leads, is
given the prominent registration, and the voices that accompany it sit behind it on a quieter one. So in an ordinary texture the voice
in focus keeps the rules below, and a voice in the background is the flute, except the bass, which is the foundation and stays full.
The voice in focus is the one with the greatest salience (the loudness of its notes in the recording, how busy it is, and how high it
lies among the voices), held for a few seconds at a time, and the voice that states the subject is in focus for the whole entry.)

0. **The whole texture, from the recording.** Where the recording is at its loudest and brightest (the top of the piece's own range:
   the climaxes, the stretti, the plenum) every voice is the full rank, except in the high octaves (3). Where it is at its softest and
   darkest (the hushed passages) every voice is the flute, subject included. In between each voice decides for itself:

1. **The subject.** The notes of an entry of the subject (the analysis marks them, ``subject-entry`` events) are the full rank for
   the whole entry, so that the theme is heard in whichever voice states it, unless that passage lies in the high octaves (3).
2. **The voice's own dynamics.** The full rank is the main voice. A passage of a voice is *delicate*, and the flute, when the voice
   is quiet (the mean velocity of its notes within WINDOW_S seconds each side, which comes from the recording's loudness, is
   SOFT_BELOW or more under the voice's median) or slow (fewer than SLOW_BELOW times the voice's median number of notes in that
   window); it is dramatic again when it is no longer slow and is within FULL_ABOVE of its median; in between it stays as it was (a
   dead band), and it changes at most once in DWELL_S seconds.
3. **The register.** In a dramatic passage the low and middle of the compass are the full rank and the high octaves the flute (the
   full rank's treble is hard, the flute's is sweet). The median pitch of the voice's notes within PASSAGE_S seconds says where the
   passage lies (a single high note in a low phrase does not move it); the voice goes to the flute at HIGH_FROM or above and back to
   the full rank below LOW_BELOW, not more than once in VOICE_DWELL_S seconds.

Every decision is then made constant over a voice's notes in a bar: the rank of the bar is the rank most of its notes had (the
subject's own notes are not outvoted: an entry is full from its first note to its last).

The bass is the pedal by its pitch (the samples of both ranks have the pedal's below the manuals'), so it is not decided here.

Pace: two organists' recordings (BWV 542's fugue and Koopman's BWV 578), read for how often the brightness of the whole sound changes by 3 dB
or more, change about twice a minute; the dwell times are set so that no voice changes oftener than that, and the voices together a few
times that.

What this is not: it was not made by listening, and it does not copy any organist. The numbers were chosen by looking at how often the
ranks change and at where the compass lies (MIDI 35 to 88). The owner's ear decides; the overrides file is how the ear is heard.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass

import numpy as np

from . import syncref
from .paths import ROOT, wav_path

DATA = ROOT / "web" / "static" / "data"
OUT = DATA / "organ-registration.json"
OVERRIDES = ROOT / "data" / "organ-registration-overrides.json"

WINDOW_S = 5.0
FULL_ABOVE = -12.0
SOFT_BELOW = -30.0
SLOW_BELOW = 0.5
DWELL_S = 20.0
HIGH_FROM = 70
LOW_BELOW = 65
PASSAGE_S = 3.5
VOICE_DWELL_S = 15.0
MIN_NOTES = 12
STEP_S = 0.5
# the recording's texture: a score of the loudness and the brightness against the piece's own range
TUTTI_ENTER, TUTTI_LEAVE = 0.8, 0.3
HUSH_ENTER, HUSH_LEAVE = -1.0, -0.5
BRIGHTNESS_WEIGHT = 0.5
# the voice in focus
FOCUS_WINDOW_S = 2.5
FOCUS_MARGIN = (
    0.4  # another voice must be this much more salient than the one in focus to take its place...
)
FOCUS_DWELL_S = 8.0  # ...and not within this long of the last change
TEXTURE_DWELL_S = 20.0

FULL, FLUTE = "full", "flute"


@dataclass(frozen=True)
class Profile:
    """How a piece is to be registered, beyond the rules that are the same for all of them."""

    bias: int = 0  # +1: leans to the full rank (it is harder to go to the flute); -1: to the flute; 0: balanced
    focus: bool = True  # voices in the background are the flute: a fugue's voices are not of equal weight (the canons' are)
    contrast: bool = False  # the secondary themes (S2, S3, ...) of a multiple fugue are the flute: a colour against the first theme


# My reading of each piece (the Art of Fugue as it is generally understood), not a measurement and not an authority: the owner's ear
# can overrule any of it in the overrides file, or here.
PROFILES: dict[str, Profile] = {
    "c01": Profile(0),  # the simple fugue in stile antico: even, serene
    "c02": Profile(1),  # dotted rhythms, a grave majesty
    "c03": Profile(-1),  # the chromatic one, the subject inverted: quiet, sorrowing
    "c04": Profile(0),  # the long, graceful inversion
    "c05": Profile(1),  # the first counter-fugue, with stretti: vigorous
    "c06": Profile(1),  # in the French style, dotted, with diminution: brilliant
    "c07": Profile(1),  # augmentation and diminution together: the grandest of the counter-fugues
    "c08": Profile(0, contrast=True),  # triple fugue: the second theme is a new colour
    "c09": Profile(0, contrast=True),  # double fugue
    "c10": Profile(1, contrast=True),  # double fugue, vigorous
    "c11": Profile(0, contrast=True),  # triple fugue
    "c12r": Profile(0),  # the mirror fugues: the two forms are registered alike
    "c12i": Profile(0),
    "c13r": Profile(0),
    "c13i": Profile(0),
    "c14": Profile(0, contrast=True),  # the unfinished triple fugue
    # the canons: two voices of equal weight, each registered as the other
    "k1": Profile(0, focus=False),
    "k2": Profile(0, focus=False),
    "k3": Profile(0, focus=False),
    "k4": Profile(0, focus=False),
}


def texture(piece: dict, step: float = STEP_S) -> tuple[float, np.ndarray]:
    """The recording's texture over a piece: (start time, drama) at every STEP_S, where drama is the loudness (RMS, dB) and the
    brightness (spectral centroid) of one second of the recording around the step, each as a score against the piece's own median
    and spread, loudness plus half the brightness. Positive is louder and brighter than the piece usually is."""
    import soundfile as sf

    with sf.SoundFile(wav_path()) as wav:
        sr = wav.samplerate
        t0 = float(piece["audio_start"])
        n = int((float(piece["audio_end"]) - t0) // step) + 1
        db = np.zeros(n)
        cent = np.zeros(n)
        win = int(sr * 1.0)
        window = np.hanning(win)
        freqs = np.fft.rfftfreq(win, 1 / sr)
        for k in range(n):
            wav.seek(max(0, int((t0 + k * step - 0.5) * sr)))
            y = wav.read(win, dtype="float32", always_2d=True).mean(axis=1)
            if len(y) < win:
                y = np.pad(y, (0, win - len(y)))
            db[k] = 10 * np.log10(float(np.mean(y.astype("f8") ** 2)) + 1e-12)
            mag = np.abs(np.fft.rfft(y * window))
            cent[k] = float((freqs * mag).sum() / (mag.sum() + 1e-9))

    def score(x: np.ndarray) -> np.ndarray:
        med = float(np.median(x))
        mad = float(np.median(np.abs(x - med))) * 1.4826 or 1.0
        return np.clip((x - med) / mad, -3, 3)

    # the loudness is smoothed over the same 5 s on each side that the voices' dynamics are read over
    k = int(WINDOW_S / step) * 2 + 1
    drama = np.convolve(
        np.pad(score(db) + BRIGHTNESS_WEIGHT * score(cent), k // 2, mode="edge"),
        np.ones(k) / k,
        "valid",
    )
    return t0, drama


def modes_of(drama: np.ndarray, step: float = STEP_S, bias: int = 0) -> np.ndarray:
    """Per step: +1 where the texture is a climax (every voice full), -1 where it is a hush (every voice the flute), 0 between."""
    out = np.zeros(len(drama), int)
    mode = 0
    last = -np.inf
    tutti = TUTTI_ENTER - 0.4 * bias
    hush = HUSH_ENTER - 0.5 * bias
    for k, d in enumerate(drama):
        want = mode
        if mode == 0 and d > tutti:
            want = 1
        elif mode == 0 and d < hush:
            want = -1
        elif mode == 1 and d < TUTTI_LEAVE or mode == -1 and d > HUSH_LEAVE:
            want = 0
        if want != mode and k * step - last >= TEXTURE_DWELL_S:
            mode = want
            last = k * step
        out[k] = mode
    return out


def dynamics(t: np.ndarray, v: np.ndarray, bias: int = 0) -> np.ndarray:
    """Per step of half a second from t[0]: True where the voice's passage is dramatic, False where it is delicate."""
    n = len(t)
    median = float(np.sort(v)[n // 2])
    sums = np.concatenate([[0.0], np.cumsum(v - median)])
    steps = int((t[-1] - t[0]) // STEP_S) + 1
    g = t[0] + np.arange(steps) * STEP_S
    a = np.searchsorted(t, g - WINDOW_S, "left")
    b = np.searchsorted(t, g + WINDOW_S, "left")
    cnt = b - a
    loud = np.where(cnt > 0, (sums[b] - sums[a]) / np.maximum(cnt, 1), 0.0)
    dense = cnt / (2 * WINDOW_S)
    median_density = float(np.sort(dense)[steps // 2])
    out = np.zeros(steps, bool)
    soft_below = (
        SOFT_BELOW - 10 * bias
    )  # a piece that leans to the full rank is harder to take to the flute, and the reverse
    full_above = FULL_ABOVE - 6 * bias
    current = loud[0] >= soft_below and not dense[0] < SLOW_BELOW * median_density
    last = -np.inf
    for k in range(steps):
        slow = dense[k] < SLOW_BELOW * median_density
        want = current
        if loud[k] > full_above and not slow:
            want = True
        elif loud[k] < soft_below or slow:
            want = False
        if want != current and g[k] - last >= DWELL_S:
            current = want
            last = g[k]
        out[k] = current
    return out


def focus_track(
    c: dict[str, np.ndarray], t0: float, steps: int, entries: list[tuple[int, float, float]]
) -> np.ndarray:
    """The voice in focus at every step of STEP_S from t0 (0 where nothing sounds). The salience of a voice is the loudness of its
    notes within FOCUS_WINDOW_S each side (a score against the piece's velocities), plus how busy it is (notes against the piece's
    median), plus a little for the highest voice and less for the lowest; the voice in focus is changed only when another is
    clearly more salient and not too soon; a voice stating the subject (`entries`: voice, start, end) is in focus throughout."""
    t_all = c["t_on"].astype("f8")
    vel = c["vel"].astype("f8")
    vmed = float(np.median(vel))
    vsd = float(np.std(vel)) or 1.0
    grid = t0 + np.arange(steps) * STEP_S
    voices = [int(v) for v in np.unique(c["voice"])]
    sal = np.full((len(voices), steps), -3.0)
    mean_pitch = np.zeros((len(voices), steps))
    dens_all = []
    per: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for v in voices:
        idx = np.nonzero(c["voice"] == v)[0]
        idx = idx[np.argsort(t_all[idx], kind="stable")]
        per.append((t_all[idx], vel[idx], c["pitch"][idx].astype("f8")))
    for k, (t, vv, pp) in enumerate(per):
        a = np.searchsorted(t, grid - FOCUS_WINDOW_S, "left")
        b = np.searchsorted(t, grid + FOCUS_WINDOW_S, "left")
        cnt = b - a
        cv = np.concatenate([[0.0], np.cumsum(vv)])
        cp = np.concatenate([[0.0], np.cumsum(pp)])
        with np.errstate(invalid="ignore", divide="ignore"):
            loud = np.where(cnt > 0, (cv[b] - cv[a]) / np.maximum(cnt, 1), vmed)
            mean_pitch[k] = np.where(cnt > 0, (cp[b] - cp[a]) / np.maximum(cnt, 1), 0.0)
        dens = cnt / (2 * FOCUS_WINDOW_S)
        dens_all.append(dens)
        sal[k] = np.where(cnt > 0, (loud - vmed) / vsd, -3.0)
    med_density = (
        float(
            np.median(np.concatenate([d[d > 0] for d in dens_all if (d > 0).any()] or [np.ones(1)]))
        )
        or 1.0
    )
    for k in range(len(voices)):
        sal[k] += np.where(dens_all[k] > 0, 0.5 * (dens_all[k] / med_density - 1.0), 0.0)
    # the highest voice carries the line a little more, the lowest a little less
    for g in range(steps):
        sounding = [k for k in range(len(voices)) if dens_all[k][g] > 0]
        if len(sounding) >= 2:
            order = sorted(sounding, key=lambda k: mean_pitch[k, g])
            sal[order[-1], g] += 0.4
            sal[order[0], g] -= 0.2
    focus = np.zeros(steps, int)
    cur = int(np.argmax(sal[:, 0]))
    last = -np.inf
    for g in range(steps):
        best = int(np.argmax(sal[:, g]))
        if (
            best != cur
            and sal[best, g] > sal[cur, g] + FOCUS_MARGIN
            and grid[g] - last >= FOCUS_DWELL_S
        ):
            cur = best
            last = grid[g]
        focus[g] = voices[cur] if sal[cur, g] > -3.0 else 0
    for v, start, end in entries:  # the theme is always in focus
        lo = max(0, int((start - t0) // STEP_S))
        hi = min(steps, int((end - t0) // STEP_S) + 1)
        focus[lo:hi] = v
    return focus


def ranks_of(
    c: dict[str, np.ndarray],
    subject: set[int],
    modes: np.ndarray | None = None,
    t_start: float = 0.0,
    profile: Profile | None = None,
    theme: dict[int, str] | None = None,
    entries: list[tuple[int, float, float]] | None = None,
) -> np.ndarray:
    """The rank of every note of a piece's chunk: True for the full rank, False for the flute. `modes` is the recording's texture
    from `modes_of` (steps of STEP_S from `t_start`); without it every voice decides for itself."""
    profile = profile or Profile()
    n = len(c["t_on"])
    out = np.ones(n, bool)
    t_all = c["t_on"].astype("f8")
    t0 = float(t_all.min()) if n else 0.0
    steps_all = int((float(t_all.max()) - t0) // STEP_S) + 1 if n else 0
    focus = focus_track(c, t0, steps_all, entries or []) if (profile.focus and n) else None
    for voice in np.unique(c["voice"]):
        idx = np.nonzero(c["voice"] == voice)[0]
        if len(idx) < MIN_NOTES:
            continue
        idx = idx[np.argsort(t_all[idx], kind="stable")]
        t = t_all[idx]
        dramatic = dynamics(t, c["vel"][idx].astype("f8"), profile.bias)
        pitch = c["pitch"][idx].astype(int)
        rank = True
        since = -np.inf
        mode = "dramatic"
        a = b = 0
        for j, i in enumerate(idx):
            now = t[j]
            while t[a] < now - PASSAGE_S:
                a += 1
            while b < len(idx) and t[b] <= now + PASSAGE_S:
                b += 1
            here = float(np.sort(pitch[a:b])[(b - a) // 2])
            high = here >= HIGH_FROM
            step = min(len(dramatic) - 1, round((now - t[0]) / STEP_S))
            texture_mode = 0
            if modes is not None:
                texture_mode = int(
                    modes[min(len(modes) - 1, max(0, round((now - t_start) / STEP_S)))]
                )
            if texture_mode < 0:
                mode = "delicate"  # a hush in the recording: the flute throughout, the theme too
                rank = False
            elif texture_mode > 0:
                mode = "subject"  # a climax in the recording: the full rank, unless the voice is up in the high octaves
                rank = not high
            elif int(i) in subject:
                mode = "subject"
                secondary = profile.contrast and (theme or {}).get(int(i), "S1") != "S1"
                rank = (
                    not high and not secondary
                )  # the first theme is the full rank, a secondary theme is the flute's colour
            elif not dramatic[step]:
                mode = "delicate"
                rank = False
            else:
                if mode != "dramatic":
                    mode = "dramatic"
                    rank = not high
                    since = now
                want = rank
                if high:
                    want = False
                elif here < LOW_BELOW:
                    want = True
                if want != rank and now - since >= VOICE_DWELL_S:
                    rank = want
                    since = now
            final = rank
            if focus is not None and texture_mode == 0 and int(i) not in subject and dramatic[step]:
                gstep = min(len(focus) - 1, max(0, round((now - t0) / STEP_S)))
                if int(focus[gstep]) != int(voice):
                    # in the background: the flute, except the bass, which is the foundation
                    final = here < LOW_BELOW
            out[i] = final
    # constant over a voice's notes in a bar: the rank most of them had; the notes of an entry of the subject keep their own
    bar = c["bar"].astype(int)
    pas = c["pass"].astype(int)
    groups: dict[tuple[int, int, int], list[int]] = {}
    for i in range(n):
        if i not in subject:
            groups.setdefault((int(c["voice"][i]), int(pas[i]), int(bar[i])), []).append(i)
    for members in groups.values():
        full = int(out[members].sum())
        out[members] = full * 2 >= len(members)
    return out


def segments(t: np.ndarray, full: np.ndarray, end: float) -> list[list]:
    """Runs of one rank along a voice's notes, as [start, end, "full"|"flute"] with the last one reaching `end`. A segment begins
    at the first note of its run, with its time cut down to the millisecond (never up, so the note is inside its own segment). Notes
    of a voice that sound together and differ in rank (a chord in one voice) leave no segment of no length: the later one wins."""
    out: list[list] = []
    for k in range(len(t)):
        name = FULL if full[k] else FLUTE
        start = math.floor(float(t[k]) * 1000) / 1000
        if out and out[-1][0] == start:
            out[-1][2] = name  # the same moment: this rank, not the one before it
            if len(out) > 1 and out[-2][2] == name:
                out[-2][1] = end
                out.pop()
            continue
        if not out or out[-1][2] != name:
            if out:
                out[-1][1] = start
            out.append([start, end, name])
    return out


def apply_overrides(pieces: dict, overrides: dict) -> int:
    """Write the overrides over the computed score: {"c01": {"2": [[start, end, "flute"], ...]}} (seconds on the recording's timeline).
    Within [start, end) the voice has that rank; the segments around it are cut to make room. Returns how many were applied."""
    applied = 0
    for pid, voices in overrides.items():
        if pid.startswith("_") or pid not in pieces:
            continue
        for voice, edits in voices.items():
            segs = pieces[pid].get(voice)
            if segs is None:
                continue
            for start, end, name in edits:
                if name not in (FULL, FLUTE) or not end > start:
                    raise ValueError(f"bad override {pid}/{voice}: {[start, end, name]}")
                cut: list[list] = []
                for s0, s1, sn in segs:
                    if s1 <= start or s0 >= end:
                        cut.append([s0, s1, sn])
                        continue
                    if s0 < start:
                        cut.append([s0, start, sn])
                    if s1 > end:
                        cut.append([end, s1, sn])
                cut.append([start, end, name])
                cut.sort(key=lambda s: s[0])
                merged: list[list] = []
                for s in cut:
                    if merged and merged[-1][2] == s[2] and merged[-1][1] == s[0]:
                        merged[-1][1] = s[1]
                    else:
                        merged.append(s)
                segs[:] = merged
                applied += 1
    return applied


def build() -> dict:
    manifest = syncref.load_manifest()
    pieces: dict[str, dict] = {}
    for p in manifest["pieces"]:
        c = syncref.load_chunk(p)
        events = json.loads((DATA / p["events"]).read_text(encoding="utf-8"))
        subject = {i for e in events if e["type"] == "subject-entry" for i in e["notes"]}
        theme = {
            i: str(e["data"].get("theme", "S1"))
            for e in events
            if e["type"] == "subject-entry"
            for i in e["notes"]
        }
        profile = PROFILES.get(p["id"], Profile())
        t_start, drama = texture(p)
        entries = [
            (int(e["voice"]), float(e["t"]), float(e["t_end"]))
            for e in events
            if e["type"] == "subject-entry"
        ]
        full = ranks_of(
            c, subject, modes_of(drama, bias=profile.bias), t_start, profile, theme, entries
        )
        t = c["t_on"].astype("f8")
        end = round(float(p["audio_end"]) + 1.0, 3)
        voices: dict[str, list] = {}
        for voice in np.unique(c["voice"]):
            idx = np.nonzero(c["voice"] == voice)[0]
            idx = idx[np.argsort(t[idx], kind="stable")]
            voices[str(int(voice))] = segments(t[idx], full[idx], end)
        pieces[p["id"]] = voices
    applied = 0
    if OVERRIDES.exists():
        applied = apply_overrides(pieces, json.loads(OVERRIDES.read_text(encoding="utf-8")))
    doc = {
        "version": 1,
        "about": "The organ's registration score: per piece and voice, [start, end, rank] in seconds on the recording's timeline. "
        "Made by tools/artfugue/registration.py; hand edits go in data/organ-registration-overrides.json.",
        "rules": {
            "window_s": WINDOW_S,
            "full_above": FULL_ABOVE,
            "soft_below": SOFT_BELOW,
            "slow_below": SLOW_BELOW,
            "dwell_s": DWELL_S,
            "high_from": HIGH_FROM,
            "low_below": LOW_BELOW,
            "passage_s": PASSAGE_S,
            "voice_dwell_s": VOICE_DWELL_S,
        },
        "overrides_applied": applied,
        "pieces": pieces,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    return doc


def main() -> int:
    doc = build()
    total = 0
    for pid, voices in doc["pieces"].items():
        flips = sum(len(s) - 1 for s in voices.values())
        total += flips
        share = []
        for voice, segs in voices.items():
            full_s = sum(s1 - s0 for s0, s1, name in segs if name == FULL)
            all_s = sum(s1 - s0 for s0, s1, _ in segs) or 1
            share.append(f"{voice}:{100 * full_s / all_s:.0f}%")
        print(
            f"{pid:5s} changes {flips:3d} over {len(voices)} voices   full share by voice {' '.join(share)}"
        )
    print(f"{total} changes in all; {doc['overrides_applied']} overrides applied; written to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
