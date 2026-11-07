"""T2.1.3: encode the WAV to Opus (primary) and AAC-LC (fallback) with ffmpeg.

Run:  python -m artfugue.encode_audio [--all]
Default: the chosen bitrates (Opus 128 kbps VBR, AAC-LC 160 kbps). --all also writes the lower
candidates (Opus 96, AAC 128) for the listening test. Output: data/work/audio/enc/.
Both files keep 48 kHz stereo. The AAC file uses +faststart; the Opus file is a WebM container.
"""

from __future__ import annotations

import json
import subprocess
import sys

from .paths import AUDIO_WORK, ffmpeg_tool, wav_path

OUT = AUDIO_WORK / "enc"
CANDIDATES = {
    "opus128": ["-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-application", "audio", "-f", "webm"],
    "opus96": ["-c:a", "libopus", "-b:a", "96k", "-vbr", "on", "-application", "audio", "-f", "webm"],
    "aac160": ["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-f", "mp4"],
    "aac128": ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "mp4"],
}


def encode(name: str) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"fugue-{name}.{'webm' if name.startswith('opus') else 'm4a'}"
    cmd = [ffmpeg_tool(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav_path()),
           "-map_metadata", "-1", "-ar", "48000", "-ac", "2", *CANDIDATES[name], str(dst)]
    subprocess.run(cmd, check=True)
    probe = json.loads(subprocess.run(
        [ffmpeg_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration,size,bit_rate:stream=start_time",
         "-of", "json", str(dst)], capture_output=True, text=True, check=True).stdout)
    return {"name": name, "file": dst.name, "bytes": dst.stat().st_size,
            "duration": float(probe["format"]["duration"]),
            "kbps": round(float(probe["format"].get("bit_rate", 0)) / 1000, 1),
            "start_time": float(probe["streams"][0].get("start_time", 0) or 0)}


def main_all() -> None:
    """All four candidates (the listening test needs the lower pair too)."""
    sys.argv.append("--all")
    main()


def main() -> None:
    names = list(CANDIDATES) if "--all" in sys.argv else ["opus128", "aac160"]
    res = [encode(n) for n in names]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "encodes.json").write_text(json.dumps(res, indent=1) + chr(10), encoding="utf-8")
    for r in res:
        print(r)


if __name__ == "__main__":
    main()
