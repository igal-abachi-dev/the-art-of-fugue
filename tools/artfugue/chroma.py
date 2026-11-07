"""Chroma features for the recording and for the score (symbolic chroma)."""

from __future__ import annotations

import numpy as np

from .paths import AUDIO_WORK, wav_path

SR = 22050
HOP = 2205  # 10 frames per second
FPS = SR / HOP
CHROMA_FILE = AUDIO_WORK / "chroma10.npy"


def recording_chroma(force: bool = False) -> np.ndarray:
    """Chroma of the whole recording, shape (12, frames) at 10 frames/s (cached)."""
    if CHROMA_FILE.exists() and not force:
        return np.load(CHROMA_FILE)
    import librosa
    import soundfile as sf
    from scipy.signal import resample_poly

    AUDIO_WORK.mkdir(parents=True, exist_ok=True)
    chunks = []
    with sf.SoundFile(wav_path()) as f:
        assert f.samplerate == 48000
        # stream in 5-minute blocks: the whole file is 900 MB as 16-bit PCM
        for block in f.blocks(blocksize=48000 * 300, dtype="float32"):
            mono = block.mean(axis=1) if block.ndim == 2 else block
            chunks.append(resample_poly(mono, 147, 320).astype(np.float32))
    y = np.concatenate(chunks)
    # long CQT in blocks, aligned to the hop, to keep memory modest
    out = []
    step = HOP * 3000
    for s in range(0, len(y), step):
        seg = y[s : s + step + HOP * 8]
        c = librosa.feature.chroma_cqt(y=seg, sr=SR, hop_length=HOP, n_chroma=12, fmin=librosa.note_to_hz("C2"),
                                       n_octaves=6, norm=None)
        out.append(c[:, : min(3000, int(np.ceil(min(step, len(y) - s) / HOP)))])
    chroma = np.concatenate(out, axis=1).astype(np.float32)
    np.save(CHROMA_FILE, chroma)
    return chroma


# partials of a piano tone: (semitones above the fundamental, relative weight)
PARTIALS = [(0, 1.0), (12, 0.6), (19, 0.4), (24, 0.3), (28, 0.2), (31, 0.15)]


def score_chroma(notes, sec_per_tick: float, fps: float = FPS, legato: float = 0.9,
                 times: tuple[np.ndarray, np.ndarray] | None = None, n_frames: int | None = None) -> np.ndarray:
    """Chroma of a score, one column per frame. ``times`` = (t_on, t_off) overrides the tick times."""
    if times is None:
        t_on = np.array([n["on"] for n in notes], float) * sec_per_tick
        t_off = t_on + np.array([max(n["dur"], 6) for n in notes], float) * sec_per_tick * legato
    else:
        t_on, t_off = times
    pcs = np.array([n["pitch"] for n in notes], int)
    T = n_frames or int(np.ceil(t_off.max() * fps)) + 1
    c = np.zeros((12, T + 1), np.float32)
    f0 = np.floor(t_on * fps).astype(int)
    f1 = np.maximum(np.ceil(t_off * fps).astype(int), f0 + 1)
    for k in range(len(notes)):
        if f0[k] > T:
            continue
        for semi, w in PARTIALS:
            c[(pcs[k] + semi) % 12, f0[k] : min(f1[k], T + 1)] += w
    return c[:, :T]


def normalize(c: np.ndarray, smooth: int = 5) -> np.ndarray:
    """Smooth along time and scale every frame to unit length."""
    if smooth > 1:
        from scipy.ndimage import uniform_filter1d

        c = uniform_filter1d(c, size=smooth, axis=1, mode="nearest")
    c = c + 1e-3 * max(float(c.max()), 1e-6)  # keeps silent frames from having zero length
    n = np.linalg.norm(c, axis=0, keepdims=True)
    return (c / n).astype(np.float32)
