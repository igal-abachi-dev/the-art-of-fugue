"""Where the sampled instruments strike, against where the recording strikes (the timing check of the sampler mode).

Run:  python -m artfugue.sampler_timing <run.json> [<run.json> ...]    (the runs `web/scripts/sampler-check.mjs` saves)

A run is the recording and an instrument, tapped at the same time by an AudioWorklet in the browser (the recording where it
leaves the element, before the gain that silences it in sampler mode; the instrument where everything joins), as raw samples with
the context's own time stamp, plus pairs of (context time, clock time) read all along and the list of reference points that were
played. The reference points are those of ``data/sync-reference.json`` (``syncref``): notes whose attack stands alone in the
recording, read off its waveform, so the strike of every one is known and clean. For each the page sought to just before it and
played through it; here the strike is read in both taps in the same way (``syncref.attack``: the instant the level, at the
note's own pitch and its first partials or over the whole band, rises fastest) and:

* ``instrument_minus_recording``: how much later (+) or earlier (-) the instrument strikes than the recording, on the
  context's clock, note by note. This is the number the sampler's timing is made to bring to zero.
* ``recording_late``: how much later the recording is heard than the clock says (the reference point against its place on the
  context's clock). It is the delay of the element's path; the instrument is scheduled directly on the context and has not got it.

What it does not say: how late either is against the loudspeaker (both pass the same output), and anything about the notes
between the reference points.
"""

from __future__ import annotations

import base64
import json
import sys
from math import gcd

import numpy as np

from . import syncref

SR = 44_100  # the rate the attack reading is made at (the recording's own, which `syncref` was built for)
PRE_S = 0.45
POST_S = 0.30
MIN_POINTS = 8
LOOSE_MIN_RISE_DB = (
    6.0  # a pipe's attack is soft: the strict reading of syncref wants 14 dB over 6 ms
)
SEARCH_S = (-0.16, 0.12)  # where, around the reference time, the loose reading looks
LOOSE_AMBIGUITY = 0.8


def _wave(tap: dict, sr: int) -> np.ndarray:
    """The tap's samples, at SR (the browser's context may run at 48 or 96 kHz; the reading's windows are made for 44.1)."""
    y = np.frombuffer(base64.b64decode(tap["b64"]), dtype="<f4").astype("f8")
    if sr == SR:
        return y
    from scipy.signal import resample_poly

    g = gcd(SR, sr)
    return resample_poly(y, SR // g, sr // g)


def loose(y: np.ndarray, sr: int, pitch: int | None) -> float | None:
    """Like ``syncref.attack`` but content with a rise of 6 dB, and looking only near where the reference puts the note."""
    db, step, n_fft = syncref.level_db(y, sr, pitch)
    r = syncref.RISE_FRAMES
    if len(db) < 3 * r:
        return None
    rise = db[r:] - db[:-r]
    centre = (np.arange(len(rise)) + r / 2) * syncref.HOP / sr + n_fft / 2 / sr  # seconds into y
    inside = (centre >= PRE_S + SEARCH_S[0]) & (centre <= PRE_S + SEARCH_S[1])
    if not inside.any():
        return None
    k = int(np.argmax(np.where(inside, rise, -np.inf)))
    best = float(rise[k])
    if best < LOOSE_MIN_RISE_DB:
        return None
    guard = int(0.06 / step)
    rest = np.concatenate([rise[: max(0, k - guard)], rise[k + guard :]])
    if rest.size and float(rest.max()) > LOOSE_AMBIGUITY * best:
        return None
    return float(centre[k])


def read_both(a: np.ndarray, b: np.ndarray, pitch: int | None) -> tuple[float, float, str] | None:
    """The strike (seconds into the window) in two taps, read the same way: strictly if both allow it, loosely otherwise."""
    ra, rb = syncref.attack(a, SR, pitch), syncref.attack(b, SR, pitch)
    if ra is not None and rb is not None:
        return ra[0], rb[0], "strict"
    la, lb = loose(a, SR, pitch), loose(b, SR, pitch)
    if la is not None and lb is not None:
        return la, lb, "loose"
    return None


def organ_rank(ref: dict, chunks: dict, score: dict) -> str | None:
    """Which rank ("full" or "flute") the organ plays a reference note on, from the registration score (None if it cannot be told)."""
    c = chunks.get(ref["piece"])
    if c is None:
        c = chunks[ref["piece"]] = syncref.load_chunk(
            next(p for p in syncref.load_manifest()["pieces"] if p["id"] == ref["piece"])
        )
    m = (
        (c["tick"] == ref["tick"])
        & (c["pitch"] == ref["pitch"])
        & (c["voice"] == ref["voice"])
        & (c["pass"] == ref["pass"])
    )
    idx = np.nonzero(m)[0]
    if len(idx) != 1:
        return None
    t = float(c["t_on"][idx[0]])
    for s0, s1, name in score.get(ref["piece"], {}).get(str(int(ref["voice"])), []):
        if s0 <= t < s1:
            return name
    return None


def analyse(run: dict) -> dict:
    run_sr = int(run["sr"])
    rec, ins = _wave(run["rec"], run_sr), _wave(run["ins"], run_sr)
    t_rec, t_ins = float(run["rec"]["t0"]), float(run["ins"]["t0"])
    pairs = np.array(run["pairs"], dtype="f8")  # (context time, clock time)
    rows = []
    score = None
    if run.get("instrument") == "organ":
        from .registration import OUT as REGISTRATION

        if REGISTRATION.exists():
            score = json.loads(REGISTRATION.read_text(encoding="utf-8"))["pieces"]
    chunks: dict = {}
    for ref in run["refs"]:
        t_ref = float(ref["t_ref"])
        near = pairs[(pairs[:, 1] > t_ref - 1.0) & (pairs[:, 1] < t_ref + 0.3)]
        if len(near) < 5:
            continue
        ctx_ref = t_ref - float(
            np.median(near[:, 1] - near[:, 0])
        )  # where the reference falls on the context's clock
        pitch = int(ref["pitch"]) if ref.get("method") == "partials" else None
        wins = []
        for wave, t0 in ((rec, t_rec), (ins, t_ins)):
            first = round((ctx_ref - PRE_S - t0) * SR)
            n = int((PRE_S + POST_S) * SR)
            if first < 0 or first + n > len(wave):
                break
            wins.append((wave[first : first + n], first / SR + t0))
        if len(wins) != 2:
            continue
        got = read_both(wins[0][0], wins[1][0], pitch)
        if got is None:
            continue
        s_rec, s_ins = wins[0][1] + got[0], wins[1][1] + got[1]
        rows.append(
            {
                "piece": ref["piece"],
                "bar": ref.get("bar"),
                "pitch": ref["pitch"],
                "method": ref.get("method"),
                "reading": got[2],
                "instrument_minus_recording_ms": round((s_ins - s_rec) * 1000, 1),
                "recording_late_ms": round((s_rec - ctx_ref) * 1000, 1),
                "instrument_late_ms": round((s_ins - ctx_ref) * 1000, 1),
                "rank": organ_rank(ref, chunks, score) if score else None,
            }
        )
    d = np.array([r["instrument_minus_recording_ms"] for r in rows])
    late = np.array([r["recording_late_ms"] for r in rows])
    pct = (lambda a, q: round(float(np.percentile(a, q)), 1)) if len(rows) else (lambda a, q: 0.0)
    return {
        "points": len(run["refs"]),
        "read": len(rows),
        "median_ms": pct(d, 50),
        "mean_ms": round(float(d.mean()), 1) if len(rows) else 0.0,
        "sd_ms": round(float(d.std()), 1) if len(rows) else 0.0,
        "p10_ms": pct(d, 10),
        "p90_ms": pct(d, 90),
        "recording_late_median_ms": pct(late, 50),
        "recording_late_sd_ms": round(float(late.std()), 1) if len(rows) else 0.0,
        "by_rank": {
            name: {
                "n": sum(1 for r in rows if r["rank"] == name),
                "median_ms": round(
                    float(
                        np.median(
                            [r["instrument_minus_recording_ms"] for r in rows if r["rank"] == name]
                        )
                    ),
                    1,
                ),
            }
            for name in ("full", "flute")
            if any(r["rank"] == name for r in rows)
        },
        "enough": len(rows) >= MIN_POINTS,
        "rows": rows,
    }


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    out = {}
    for path in argv:
        with open(path, encoding="utf-8") as f:
            out[path] = analyse(json.load(f))
    if len(argv) == 1:
        print(json.dumps(out[argv[0]]))
    else:
        for path, r in out.items():
            print(
                f"{path}: {r['read']}/{r['points']} reference points read; instrument minus recording: median "
                f"{r['median_ms']:+.1f} ms (mean {r['mean_ms']:+.1f}, sd {r['sd_ms']:.1f}, 10 to 90 %: {r['p10_ms']:+.1f} to "
                f"{r['p90_ms']:+.1f}); the recording is heard {r['recording_late_median_ms']:+.1f} ms (sd {r['recording_late_sd_ms']:.1f}) "
                "from the clock"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
