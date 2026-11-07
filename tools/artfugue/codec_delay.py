"""T2.1.3: measure the timing offset of the encoded files against the WAV (decoder compensated).

Decodes 20 s from several positions of each file with ffmpeg and finds the lag by cross-correlation.
Run: python -m artfugue.codec_delay   -> data/work/audio/enc/delay.json
"""

from __future__ import annotations

import json
import subprocess

import numpy as np
from scipy.signal import correlate

from .paths import AUDIO_WORK, ffmpeg_tool, wav_path

POSITIONS = [30.0, 700.0, 1500.0, 2500.0, 3600.0, 4700.0]
LEN = 20.0


def decode(path, start: float) -> np.ndarray:
    raw = subprocess.run([ffmpeg_tool(), "-v", "error", "-ss", str(start), "-t", str(LEN), "-i", str(path),
                          "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def lag_samples(ref: np.ndarray, test: np.ndarray) -> int:
    n = min(len(ref), len(test))
    ref, test = ref[:n], test[:n]
    c = correlate(test, ref, mode="full", method="fft")
    return int(np.argmax(c) - (n - 1))


def main() -> None:
    enc = AUDIO_WORK / "enc"
    out = {}
    for f in sorted(enc.glob("fugue-*.*")):
        if f.suffix not in (".webm", ".m4a"):
            continue
        lags = [lag_samples(decode(wav_path(), t), decode(f, t)) for t in POSITIONS]
        out[f.name] = {"lag_samples": lags, "lag_ms": [round(1000 * x / 48000, 3) for x in lags]}
        print(f.name, out[f.name]["lag_ms"])
    (enc / "delay.json").write_text(json.dumps(out, indent=1) + chr(10), encoding="utf-8")


if __name__ == "__main__":
    main()
