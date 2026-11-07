"""Note-level refinement of the DTW times with pitch-resolved onset detection (T2.3.2), and the
alignment check numbers used in the QA report (T2.3.5).

For a note of pitch p the onset curve is the sum of positive level changes (dB per frame) in the
CQT rows of its fundamental and its partials. A note's predicted time is moved to the strongest
peak inside a window around it, when that peak is clear enough; otherwise the DTW time is kept.
"""

from __future__ import annotations

import itertools

import numpy as np

from .cqt import FPS as CQT_FPS
from .cqt import LOWEST_MIDI, semitone_cqt

WINDOW_S = 0.15  # search window around the DTW time
LAMBDA = 15.0  # dB-equivalent penalty per second of distance from the DTW time
MIN_FLUX = 6.0  # summed dB rise needed to trust a peak
CQT_BIAS_S = 0.019  # the CQT flux peak comes this much before the attack (measured against a 5.8 ms spectral flux, constant for all 20 pieces)
ROWS = 84


class Onsets:
    def __init__(self) -> None:
        db = semitone_cqt().astype(np.float32)
        self.db = db
        flux = np.maximum(db[:, 1:] - db[:, :-1], 0.0)
        flux = np.concatenate([np.zeros((ROWS, 1), np.float32), flux], axis=1)
        k = np.array([0.25, 0.5, 0.25], np.float32)  # light smoothing across frames
        self.flux = np.stack([np.convolve(r, k, mode="same") for r in flux]).astype(np.float32)
        self.frames = db.shape[1]

    @staticmethod
    def rows_weights(pitch: int) -> list[tuple[int, float]]:
        r = pitch - LOWEST_MIDI
        spec = [(0, 1.0), (12, 0.7), (19, 0.5), (24, 0.4)] if pitch >= 48 else [(0, 0.3), (12, 1.0), (19, 0.8), (24, 0.6)]
        return [(r + o, w) for o, w in spec if 0 <= r + o < ROWS]

    def curve(self, pitch: int, f0: int, f1: int) -> np.ndarray:
        out = np.zeros(f1 - f0, np.float32)
        for r, w in self.rows_weights(pitch):
            out += w * self.flux[r, f0:f1]
        return out

    def level(self, pitch: int, f0: int, f1: int) -> np.ndarray:
        rows = self.rows_weights(pitch)
        ws = np.array([w for _r, w in rows], np.float32)
        lv = np.stack([self.db[r, f0:f1] for r, _w in rows])
        return (lv * ws[:, None]).sum(axis=0) / ws.sum()


def refine_onsets(ons: Onsets, pitches: np.ndarray, t_pred: np.ndarray, key: np.ndarray | None = None):
    """Return (t_refined, strength, found). ``key`` lets neighbours of equal pitch limit the window."""
    n = len(pitches)
    t_ref = t_pred.copy()
    strength = np.zeros(n, np.float32)
    found = np.zeros(n, bool)
    # neighbouring onsets of the same pitch (predicted) bound the window
    order = np.lexsort((t_pred, pitches))
    prev_t = np.full(n, -np.inf)
    next_t = np.full(n, np.inf)
    for a, b in itertools.pairwise(order):
        if pitches[a] == pitches[b]:
            next_t[a] = t_pred[b]
            prev_t[b] = t_pred[a]
    w = round(WINDOW_S * CQT_FPS)
    for k in range(n):
        p = int(pitches[k])
        if not LOWEST_MIDI <= p < LOWEST_MIDI + ROWS:
            continue
        f0 = round(t_pred[k] * CQT_FPS)
        lo = max(f0 - w, round((t_pred[k] + prev_t[k]) / 2 * CQT_FPS) if np.isfinite(prev_t[k]) else 0, 1)
        hi = min(f0 + w + 1, round((t_pred[k] + next_t[k]) / 2 * CQT_FPS) if np.isfinite(next_t[k]) else ons.frames,
                 ons.frames - 1)
        if hi - lo < 3:
            continue
        c = ons.curve(p, lo, hi)
        score = c - LAMBDA * np.abs(np.arange(lo, hi) - f0) / CQT_FPS
        j = int(np.argmax(score))
        peak = float(c[j])
        if peak >= MIN_FLUX and peak >= 1.5 * float(np.median(c)):
            t_ref[k] = (lo + j) / CQT_FPS + CQT_BIAS_S
            strength[k] = peak
            found[k] = True
    return t_ref, strength, found


def onset_contrast(ons: Onsets, pitches: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Level after minus level before the onset (dB) in the note's rows: > 0 means the note starts there."""
    out = np.zeros(len(t), np.float32)
    b0, b1 = int(0.12 * CQT_FPS), int(0.02 * CQT_FPS)
    for k, (p, tk) in enumerate(zip(pitches, t)):
        if not LOWEST_MIDI <= p < LOWEST_MIDI + ROWS:
            continue
        f = round(tk * CQT_FPS)
        if f - b0 < 0 or f + b0 + 1 >= ons.frames:
            continue
        before = ons.level(int(p), f - b0, f - b1).mean()
        after = ons.level(int(p), f + b1, f + b0).max()
        out[k] = after - before
    return out


class BroadbandPeaks:
    """Peaks of a 5.8 ms spectral flux: an alignment check that does not use the CQT."""

    def __init__(self) -> None:
        from scipy.signal import find_peaks

        from .cqt import BB_FPS, broadband_onset_envelope

        env = broadband_onset_envelope()
        env = env / np.percentile(env, 99)
        idx, _ = find_peaks(env, height=0.25, distance=3)
        self.t = idx / BB_FPS

    def hit_rate(self, t: np.ndarray, tol: float = 0.03) -> float:
        """Fraction of the times with a flux peak within +-tol seconds."""
        i = np.searchsorted(self.t, t)
        left = np.abs(t - self.t[np.clip(i - 1, 0, len(self.t) - 1)])
        right = np.abs(self.t[np.clip(i, 0, len(self.t) - 1)] - t)
        return float((np.minimum(left, right) <= tol).mean())
