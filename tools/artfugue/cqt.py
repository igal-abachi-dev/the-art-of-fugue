"""Semitone log-CQT of the recording (for note-level onset refinement and alignment checks).

Frames: hop 256 samples at 22.05 kHz (11.6 ms). Rows: 7 octaves * 24 bins from C1, folded to
84 semitone rows (max of the two bins of a semitone, so a slightly detuned piano still lands in
the right row). Cached as float16 in data/work/audio/cqt84.npy.
"""

from __future__ import annotations

import numpy as np

from .paths import AUDIO_WORK, wav_path

SR = 22050
HOP = 256
FPS = SR / HOP
FILE = AUDIO_WORK / "cqt84.npy"
LOWEST_MIDI = 24  # C1


def load_mono_22k() -> np.ndarray:
    import soundfile as sf
    from scipy.signal import resample_poly

    chunks = []
    with sf.SoundFile(wav_path()) as f:
        for block in f.blocks(blocksize=48000 * 300, dtype="float32"):
            mono = block.mean(axis=1) if block.ndim == 2 else block
            chunks.append(resample_poly(mono, 147, 320).astype(np.float32))
    return np.concatenate(chunks)


def tuning_cents(y: np.ndarray) -> float:
    import librosa

    seg = y[SR * 600 : SR * 660]
    return float(librosa.estimate_tuning(y=seg, sr=SR, bins_per_octave=24)) * 100  # cents of the semitone


def _magnitude(y: np.ndarray) -> np.ndarray:
    """(168, frames) CQT magnitude, 24 bins per octave from C1 (bin 2k is semitone k, bin 2k+1 the quarter tone above)."""
    import librosa

    block = HOP * 20000  # a multiple of the hop, otherwise every block drifts by a fraction of a frame
    pad = HOP * 64
    out = []
    for s in range(0, len(y), block):
        seg = y[max(0, s - pad) : s + block + pad]
        c = np.abs(librosa.cqt(seg, sr=SR, hop_length=HOP, fmin=librosa.midi_to_hz(LOWEST_MIDI),
                               n_bins=168, bins_per_octave=24, filter_scale=0.8))
        lead = (s - max(0, s - pad)) // HOP
        n = min(block, len(y) - s) // HOP + (1 if s + block >= len(y) else 0)
        out.append(c[:, lead : lead + n])
    return np.concatenate(out, axis=1)


def semitone_cqt(force: bool = False) -> np.ndarray:
    """(84, frames) log magnitude in dB relative to the maximum, float16."""
    if FILE.exists() and not force:
        return np.load(FILE)
    import librosa

    c = _magnitude(load_mono_22k())
    c = np.maximum(c[0::2], c[1::2])  # fold quarter-tone bins into semitones
    db = librosa.amplitude_to_db(c, ref=np.max, top_db=90.0)
    np.save(FILE, db.astype(np.float16))
    return db.astype(np.float16)


FILE_QUARTER = AUDIO_WORK / "cqt168.npy"


def quartertone_cqt(force: bool = False) -> np.ndarray:
    """(168, frames): the same transform as `semitone_cqt` without the fold (two rows a semitone), for the spectrogram view."""
    if FILE_QUARTER.exists() and not force:
        return np.load(FILE_QUARTER)
    import librosa

    db = librosa.amplitude_to_db(_magnitude(load_mono_22k()), ref=np.max, top_db=90.0).astype(np.float16)
    np.save(FILE_QUARTER, db)
    return db


BB_HOP = 128
BB_FILE = AUDIO_WORK / "onset_env.npy"
BB_FPS = SR / BB_HOP


def broadband_onset_envelope(force: bool = False) -> np.ndarray:
    """Spectral-flux onset strength with a short window (5.8 ms hop), cached."""
    if BB_FILE.exists() and not force:
        return np.load(BB_FILE)
    import librosa

    y = load_mono_22k()
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=BB_HOP, n_fft=1024, lag=1, max_size=1,
                                       aggregate=np.mean).astype(np.float32)
    np.save(BB_FILE, env)
    return env
