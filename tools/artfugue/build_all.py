"""One command that rebuilds all shipped data from data/raw/ (T2.4.3).

Run:  python -m artfugue.build_all [--force-audio] [--encode] [--no-qa]
      (from web/:  pnpm data)

Steps (whole run measured at 55 s without --encode and --no-qa on this machine; QA adds 25 s, --encode
about 4 minutes of ffmpeg):
  1. score:     MXL -> notes, pieces, corrections against the PDF, annotations
  2. audio:     analysis, piece search, DTW alignment, refinement (cached parts skipped)
  3. merge:     score data gets the audio placement; annotations again
  4. qa:        listening clips and spectrograms (data/work/qa)   (--no-qa skips)
  5. export:    web/static/data (manifest, note chunks, events) + audio copies
  6. notation:  web/static/data/notation (engraved systems and notehead maps from the PDF)
  7. spectro:   web/static/data/spectro (the recording's semitone spectrogram per piece)
     overview:  web/static/data/overview.bin (loudness and the voices' pitch per half second, for the seek bar)
  8. fingerprint: the build id in the manifest and the hash in each audio src (T9.1.2)
  9. docs:      docs/*.md tables
--encode also runs ffmpeg for the four Opus/AAC candidates and the codec delay check.
Cached: data/work/audio/{analysis.json, layout.json, chroma10.npy, cqt84.npy, onset_env.npy}; --force-audio
recomputes them.
"""

from __future__ import annotations

import subprocess
import sys
import time

from . import (
    annotate,
    audio_analysis,
    build_score,
    export,
    fingerprint,
    instruments,
    locate,
    notation,
    overview,
    qa,
    registration,
    spectro,
    timing,
)
from .paths import AUDIO_WORK, ROOT


def step(name: str):
    print(f"\n=== {name}", flush=True)
    return time.time()


def done(t0: float) -> None:
    print(f"    ({time.time() - t0:.0f} s)", flush=True)


def main() -> None:
    force = "--force-audio" in sys.argv
    t = step("score")
    build_score.main()
    annotate.main()
    done(t)

    t = step("audio")
    if force or not (AUDIO_WORK / "analysis.json").exists():
        audio_analysis.main()
    if "--encode" in sys.argv or not (AUDIO_WORK / "enc" / "encodes.json").exists():
        from . import codec_delay, encode_audio

        encode_audio.main_all()
        codec_delay.main()
    if force or not (AUDIO_WORK / "layout.json").exists():
        locate.main()
    timing.main()
    done(t)

    t = step("merge timing into the score data")
    build_score.main()
    annotate.main()
    done(t)

    if "--no-qa" not in sys.argv:
        t = step("qa")
        qa.main()
        done(t)

    t = step("export")
    sys.argv = [a for a in sys.argv if a != "--fixture"]
    export.main()
    done(t)

    t = step("notation (score overlay data from the PDF)")
    notation.main()
    done(t)

    t = step("spectrograms (the spectrogram view)")
    spectro.main()
    done(t)

    t = step("overview (the seek bar's strip)")
    overview.main()
    done(t)

    t = step("piano, harpsichord and organ samples (the sampler mode; fetched once, about 1 GB cached, 15 MB shipped)")
    instruments.main()
    done(t)

    t = step("organ registration score (which rank each voice plays when; from the notes, the subject entries and the recording)")
    registration.main()
    done(t)

    t = step("fingerprint (the build id the files are cached by)")
    fingerprint.main()
    done(t)

    t = step("docs")
    subprocess.run([sys.executable, str(ROOT / "tools" / "make_docs.py")], check=True, cwd=ROOT / "tools")
    done(t)


if __name__ == "__main__":
    main()
