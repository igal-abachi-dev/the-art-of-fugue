"""Project paths shared by the pipeline scripts."""

import glob
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
MXL = RAW / "bach-the-art-of-the-fugue.mxl"
OVERRIDES = ROOT / "data" / "pdf_overrides.json"  # hand-confirmed pitch changes the automatic audit may not make
AUDIO_WORK = WORK / "audio"


def wav_path() -> Path:
    """The ripped recording (the only .wav in data/raw)."""
    found = sorted(RAW.glob("*.wav"))
    if len(found) != 1:
        raise FileNotFoundError(f"expected exactly one .wav in {RAW}, found {len(found)}")
    return found[0]


def ffmpeg_tool(name: str = "ffmpeg") -> str:
    """Path of ffmpeg/ffprobe: PATH first, then the winget install location."""
    exe = shutil.which(name)
    if exe:
        return exe
    home = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    hits = glob.glob(str(home / "Gyan.FFmpeg*" / "ffmpeg-*" / "bin" / f"{name}.exe"))
    if not hits:
        raise FileNotFoundError(f"{name} not found (install ffmpeg, e.g. winget install Gyan.FFmpeg)")
    return hits[0]
