"""T2.1.1: measure the recording (duration, format, loudness, peak, silent gaps).

Run:  python -m artfugue.audio_analysis      -> data/work/audio/analysis.json (docs via make_docs.py)
"""

from __future__ import annotations

import json
import re
import subprocess

from .paths import AUDIO_WORK, ffmpeg_tool, wav_path


def probe(path) -> dict:
    out = subprocess.run(
        [ffmpeg_tool("ffprobe"), "-v", "error", "-show_entries",
         "format=duration,size,bit_rate:stream=codec_name,sample_rate,channels,bits_per_sample",
         "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    s = j["streams"][0]
    return {"codec": s["codec_name"], "sample_rate": int(s["sample_rate"]), "channels": s["channels"],
            "bits": s["bits_per_sample"], "duration": float(j["format"]["duration"]),
            "bytes": int(j["format"]["size"])}


def _ffmpeg(path, af: str) -> str:
    r = subprocess.run([ffmpeg_tool(), "-hide_banner", "-nostats", "-i", str(path), "-af", af,
                        "-f", "null", "-"], capture_output=True, text=True, check=True)
    return r.stderr


def loudness(path) -> dict:
    err = _ffmpeg(path, "ebur128=peak=true:framelog=quiet")
    summ = err[err.rindex("Summary:"):]
    get = lambda pat: float(re.search(pat, summ).group(1))
    return {"integrated_lufs": get(r"I:\s+(-?[\d.]+) LUFS"), "lra_lu": get(r"LRA:\s+(-?[\d.]+) LU"),
            "true_peak_dbfs": get(r"Peak:\s+(-?[\d.]+) dBFS")}


def silences(path, noise_db: int, min_d: float) -> list[dict]:
    err = _ffmpeg(path, f"silencedetect=noise={noise_db}dB:d={min_d}")
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    ends = re.findall(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", err)
    out = []
    for i, st in enumerate(starts):
        if i < len(ends):
            out.append({"start": max(st, 0.0), "end": float(ends[i][0]), "dur": float(ends[i][1])})
        else:  # silence runs to the end of the file
            out.append({"start": st, "end": None, "dur": None})
    return out


def main() -> None:
    path = wav_path()
    info = probe(path)
    res = {"file": path.name, **info, **loudness(path)}
    res["silences"] = {"-40dB/1.5s": silences(path, -40, 1.5), "-50dB/1.0s": silences(path, -50, 1.0)}
    for gaps in res["silences"].values():
        if gaps and gaps[-1]["end"] is None:
            gaps[-1].update(end=info["duration"], dur=info["duration"] - gaps[-1]["start"])
    AUDIO_WORK.mkdir(parents=True, exist_ok=True)
    (AUDIO_WORK / "analysis.json").write_text(json.dumps(res, indent=1) + chr(10), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k != "silences"}, indent=1))


if __name__ == "__main__":
    main()
