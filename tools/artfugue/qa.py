"""Alignment QA (T2.3.5): listening clips, spectrogram overlays and the numbers behind the report.

Run:  python -m artfugue.qa [piece ...]
Writes data/work/qa/<piece>_<k>.wav   recording + the aligned notes as short tones (a misaligned
                                      note is heard as a flam against the piano)
       data/work/qa/<piece>_<k>.png   CQT of the same excerpt with the aligned notes drawn on it
       data/work/qa/summary.json      per piece: low-confidence bars, tempo outliers, onset hit rates
"""

from __future__ import annotations

import json
import sys

import numpy as np

from .cqt import FPS as CQT_FPS
from .cqt import LOWEST_MIDI, load_mono_22k, semitone_cqt
from .paths import AUDIO_WORK, WORK

OUT = WORK / "qa"
TIMED = WORK / "timed"
EXCERPT_S = 14.0
SR = 22050


def load_timed(pid: str) -> dict:
    return json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))


def synth(notes: list[dict], t0: float, t1: float) -> np.ndarray:
    """Short decaying tones at the aligned note times (sine with one overtone), mono."""
    n = int((t1 - t0) * SR)
    y = np.zeros(n, np.float32)
    for note in notes:
        if note["t_on"] >= t1 or note["t_on"] < t0 or "grace" in note.get("flags", []):
            continue
        f = 440.0 * 2 ** ((note["pitch"] + 12 - 69) / 12)  # an octave up so it stands out of the piano
        length = min(max(note["t_off"] - note["t_on"], 0.08), 0.35)
        m = int(length * SR)
        tt = np.arange(m) / SR
        env = np.exp(-tt / (length * 0.45)) * np.minimum(tt / 0.004, 1.0)
        tone = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)
        i = int((note["t_on"] - t0) * SR)
        y[i : i + m] += (0.08 * env * tone)[: max(0, n - i)][: m]
    return y


def excerpts(meta: dict, k: int = 3) -> list[tuple[float, float]]:
    a, b = meta["audio_start"], meta["audio_end"]
    span = b - a
    starts = [a + 0.06 * span, a + 0.5 * span, max(a, b - EXCERPT_S - 0.06 * span)]
    return [(s, min(s + EXCERPT_S, b)) for s in starts[:k]]


def write_clip(path, y: np.ndarray, clicks: np.ndarray) -> None:
    import soundfile as sf

    mix = 0.8 * y + clicks
    sf.write(path, np.clip(mix, -1, 1), SR, subtype="PCM_16")


def write_png(path, db: np.ndarray, notes: list[dict], t0: float, t1: float, title: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    f0, f1 = int(t0 * CQT_FPS), int(t1 * CQT_FPS)
    fig, ax = plt.subplots(figsize=(14, 5))
    ax.imshow(db[:, f0:f1], origin="lower", aspect="auto", extent=[t0, t1, LOWEST_MIDI, LOWEST_MIDI + db.shape[0]],
              cmap="magma", vmin=-70, vmax=0)
    for n in notes:
        if n["t_on"] < t1 and n["t_off"] > t0:
            ax.plot([max(n["t_on"], t0), min(n["t_off"], t1)], [n["pitch"] + 0.5] * 2,
                    color=plt.cm.tab10((n["voice"] - 1) % 10), lw=2, alpha=0.9)
            ax.plot([n["t_on"]], [n["pitch"] + 0.5], "w|", ms=6)
    ax.set_xlim(t0, t1)
    ax.set_ylim(LOWEST_MIDI + 12, LOWEST_MIDI + 72)
    ax.set_xlabel("seconds in the recording")
    ax.set_ylabel("MIDI pitch")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def bar_report(pid: str, meta: dict, notes: list[dict]) -> dict:
    """Low-confidence bars and tempo outliers (ritardando / fermata candidates)."""
    bars = meta["bars"]
    by_bar: dict[tuple, list[float]] = {}
    for n in notes:
        by_bar.setdefault((n["bar"], n.get("pass", 1)), []).append(n["conf"])
    low = [b["n"] for b in bars if b.get("pass", 1) and np.median(by_bar.get((b["n"], b.get("pass", 1)), [1.0])) < 0.4]
    ts = np.array([b["t"] for b in bars])
    dur = np.diff(ts)
    med = float(np.median(dur)) if len(dur) else 1.0
    slow = [bars[i]["n"] for i in range(len(dur)) if dur[i] > 1.4 * med]
    fast = [bars[i]["n"] for i in range(len(dur)) if dur[i] < 0.7 * med]
    return {"low_conf_bars": low, "slow_bars": slow, "fast_bars": fast, "median_bar_s": round(med, 3)}


def velocity_check(y: np.ndarray, timing: dict) -> dict:
    """Spearman correlation between the mean note velocity and the loudness (RMS) of 8 s windows."""
    from scipy.stats import spearmanr

    win = 8.0
    vel_by, rms_by = [], []
    for pid in timing:
        notes = load_timed(pid)["notes"]
        t = np.array([n["t_on"] for n in notes])
        v = np.array([n["vel"] for n in notes])
        a, b = timing[pid]["audio_start"], timing[pid]["audio_end"]
        for s in np.arange(a, b - win, win):
            m = (t >= s) & (t < s + win)
            seg = y[int(s * SR) : int((s + win) * SR)]
            if m.sum() >= 8 and len(seg):
                vel_by.append(float(v[m].mean()))
                rms_by.append(float(np.sqrt(np.mean(seg**2))))
    rho, _p = spearmanr(vel_by, rms_by)
    return {"windows": len(vel_by), "spearman": round(float(rho), 3)}


def main(only: set[str] | None = None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    timing = json.loads((AUDIO_WORK / "timing.json").read_text(encoding="utf-8"))
    y = load_mono_22k()
    db = semitone_cqt().astype(np.float32)
    summary = {}
    for pid, meta in timing.items():
        if only and pid not in only:
            continue
        notes = load_timed(pid)["notes"]
        for k, (t0, t1) in enumerate(excerpts(meta), 1):
            seg = y[int(t0 * SR) : int(t1 * SR)]
            write_clip(OUT / f"{pid}_{k}.wav", seg, synth(notes, t0, t0 + len(seg) / SR)[: len(seg)])
            write_png(OUT / f"{pid}_{k}.png", db, notes, t0, t1, f"{pid} excerpt {k}: {t0:.1f}-{t1:.1f} s")
        summary[pid] = {"audio_start": meta["audio_start"], "audio_end": meta["audio_end"], **meta["stats"],
                        **bar_report(pid, meta, notes),
                        "excerpts": [[round(a, 1), round(b, 1)] for a, b in excerpts(meta)]}
        print(pid, summary[pid]["low_conf_bars"][:8], "slow", summary[pid]["slow_bars"][:8])
    summary["_velocity"] = velocity_check(y, timing)
    print("velocity vs loudness", summary["_velocity"])
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1) + chr(10), encoding="utf-8")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
