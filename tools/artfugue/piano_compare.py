"""How like the recording's piano each candidate set of piano samples is (a one-off comparison, run when choosing the piano).

Run:  python -m artfugue.piano_compare            (needs data/raw, and the candidates cached under data/work/instruments)

The recording is what the listener knows as "the piano" here. For every reference point of the sync check (`data/sync-reference.json`:
a note whose attack stands alone in the recording) the note is cut from the recording and the same note is made from each candidate
(the nearest sample, re-pitched as the sampler re-pitches it; for a set with dynamic layers, the layer that fits best). Two things
are compared, both at the note's own pitch, so that the other voices ringing in the recording matter little:

* the **timbre**: the levels of the first ten partials (a piano's are stretched a little by the stiffness of its strings, so each is
  searched within 2 %), each against the total, from 50 to 450 ms after the strike; the distance is the root mean square of the
  differences in dB, between the candidate and the recording;
* the **decay**: how far the level of the first four partials has fallen 0.25, 0.5 and 1.0 s after the strike, in dB. A plucked
  string (a harpsichord, a guitar) falls fast and evenly; a piano, held by its pedal and the room of the recording, falls
  more slowly. The recording's own decay includes its room and pedal; what is compared is how near each set comes to it.

It says which set is nearer the recording in these two respects. It does not say which pleases, and it knows nothing of the attack's
hammer noise, the release, or the room.
"""

from __future__ import annotations

import json
import sys
from math import gcd

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from . import syncref
from .instruments import RAW, measure_pitch
from .paths import ROOT, wav_path

SR = 44_100
WORK = ROOT / "data" / "work" / "instruments"
PARTIALS = 10


def mono(y: np.ndarray) -> np.ndarray:
    return y.mean(axis=1) if y.ndim > 1 else y


def to_sr(y: np.ndarray, sr: int) -> np.ndarray:
    if sr == SR:
        return y
    g = gcd(SR, sr)
    return resample_poly(y, SR // g, sr // g)


def load_set(name: str) -> list[dict]:
    """The candidate's samples: [{layer, midi, y}] with the pitch measured, not read from the name."""
    out: list[dict] = []
    if name == "steinway":
        groups = {
            f"vl{k}": sorted((RAW / "steinway-b").glob(f"*_vl{k}_rr1.wav")) for k in (2, 3, 4)
        }
    elif name == "kawai":
        groups = {"v3": sorted((RAW / "kawai-v3").glob("*.wav"))}
    else:
        groups = {"single": sorted((WORK / "salamander").glob("*.mp3"))}
    for layer, files in groups.items():
        for f in files:
            y, sr = sf.read(f, always_2d=True, dtype="float64")
            m = to_sr(mono(y), sr)
            hz = measure_pitch(m, SR)
            if hz is None:
                continue
            midi = 69 + 12 * np.log2(hz / 440)
            if abs(midi - round(midi)) > 0.4:
                continue
            out.append({"layer": layer, "midi": round(midi), "exact": midi, "y": m[: 4 * SR]})
    return out


def partial_levels(y: np.ndarray, f0: float, start: int, length: int) -> np.ndarray | None:
    """Levels in dB of the first PARTIALS partials, each against the total of them, in y[start:start+length]."""
    seg = y[start : start + length]
    if len(seg) < length:
        return None
    n = 1 << 17
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    freqs = np.fft.rfftfreq(n, 1 / SR)
    amps = []
    for k in range(1, PARTIALS + 1):
        fc = f0 * k
        if fc > 9000:
            return None
        sel = (freqs > fc * 0.98) & (freqs < fc * 1.02)
        amps.append(spec[sel].max())
    a = np.array(amps) ** 2
    return 10 * np.log10(a / a.sum() + 1e-12)


def band_decay(y: np.ndarray, f0: float, strike: int) -> np.ndarray | None:
    """Level of the first four partials 0.25, 0.5 and 1.0 s after the strike, in dB below their level at 0.1 s."""

    def level(t: float) -> float | None:
        a = int(strike + t * SR)
        seg = y[a : a + int(0.1 * SR)]
        if len(seg) < int(0.1 * SR):
            return None
        n = 1 << 16
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)) ** 2
        freqs = np.fft.rfftfreq(n, 1 / SR)
        e = 0.0
        for k in range(1, 5):
            sel = (freqs > f0 * k * 0.98) & (freqs < f0 * k * 1.02)
            e += spec[sel].sum()
        return 10 * np.log10(e + 1e-12)

    base = level(0.1)
    vals = [level(t) for t in (0.25, 0.5, 1.0)]
    if base is None or any(v is None for v in vals):
        return None
    return np.array([v - base for v in vals])


def strike_index(y: np.ndarray, midi: int) -> int | None:
    """Sample index of the strike in a window that begins with silence (padded), by syncref.attack."""
    pad = int(0.3 * SR)
    a = syncref.attack(np.concatenate([np.zeros(pad), y[: int(0.8 * SR)]]), SR, midi)
    return None if a is None else max(0, round((a[0] - 0.3) * SR))


def candidate_note(samples: list[dict], pitch: int, layer: str) -> tuple[np.ndarray, int] | None:
    cand = [s for s in samples if s["layer"] == layer]
    if not cand:
        return None
    s = min(cand, key=lambda x: abs(x["midi"] - pitch))
    ratio = 2 ** ((pitch - s["exact"]) / 12)  # play it faster to raise it
    y = resample_poly(s["y"], 1000, round(1000 * ratio))
    return y, pitch


def main() -> int:
    ref = [
        p
        for p in json.loads(syncref.REFERENCE.read_text(encoding="utf-8"))["points"]
        if 33 < p["pitch"] < 85
    ]
    info = sf.info(wav_path())
    sets = {n: load_set(n) for n in ("salamander", "steinway", "kawai")}
    for n, s in sets.items():
        print(f"{n}: {len(s)} samples, layers {sorted({x['layer'] for x in s})}", file=sys.stderr)
    results = {n: {"timbre": [], "decay": []} for n in sets}
    rec_decay = []
    used = 0
    with sf.SoundFile(wav_path()) as wav:
        for p in ref:
            f0 = 440 * 2 ** ((p["pitch"] - 69) / 12)
            first = max(0, int((p["t_ref"] - 0.45) * info.samplerate))
            wav.seek(first)
            seg = wav.read(int(3.0 * info.samplerate), dtype="float64", always_2d=True)
            y = to_sr(mono(seg), info.samplerate)
            strike = int(0.45 * SR)
            t_rec = partial_levels(y, f0, strike + int(0.05 * SR), int(0.4 * SR))
            d_rec = band_decay(y, f0, strike)
            if t_rec is None or d_rec is None:
                continue
            used += 1
            rec_decay.append(d_rec)
            for name, samples in sets.items():
                best = None
                for layer in sorted({s["layer"] for s in samples}):
                    made = candidate_note(samples, p["pitch"], layer)
                    if made is None:
                        continue
                    ys, _ = made
                    k = strike_index(ys, p["pitch"])
                    if k is None:
                        continue
                    t_c = partial_levels(ys, f0, k + int(0.05 * SR), int(0.4 * SR))
                    d_c = band_decay(ys, f0, k)
                    if t_c is None or d_c is None:
                        continue
                    dist = float(np.sqrt(np.mean((t_c - t_rec) ** 2)))
                    if best is None or dist < best[0]:
                        best = (dist, d_c)
                if best:
                    results[name]["timbre"].append(best[0])
                    results[name]["decay"].append(best[1] - d_rec)
    print(f"{used} reference notes of the recording (MIDI 34 to 84) compared\n")
    print(
        f"the recording itself: partials fall by {np.median(rec_decay, axis=0).round(1)} dB at 0.25, 0.5, 1.0 s"
    )
    print(
        f"{'set':12s} {'timbre distance (dB, lower is nearer)':40s} decay minus the recording's at 0.25 / 0.5 / 1.0 s (dB; 0 is alike, negative falls faster)"
    )
    for name, r in results.items():
        t = np.array(r["timbre"])
        d = np.array(r["decay"])
        print(
            f"{name:12s} median {np.median(t):5.2f}  (p25 {np.percentile(t, 25):.2f}, p75 {np.percentile(t, 75):.2f}, n={len(t)})".ljust(
                54
            )
            + f"{np.median(d, axis=0).round(1)}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
