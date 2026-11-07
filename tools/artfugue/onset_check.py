"""Let the recording count the onsets in a bar (where the printed page cannot).

``pdf_rhythm.py`` compares the number of distinct time positions of a bar's noteheads with the number of distinct onsets of
the MXL's notes; in dense runs of triplets the heads are too close to tell apart and the page undercounts. The recording does
not have that problem. For a bar it is asked two things:

* **every written onset is heard**: at the aligned time of each distinct onset, does some note of it show an attack at its own
  pitch (the level of its semitone jumps by at least ``RISE_DB``) or does the broadband onset envelope peak there?
* **nothing else is heard**: peaks of the broadband onset envelope inside the bar that lie more than ``NEAR_S`` from every
  written onset of the piece are attacks the score does not have.

A bar passes when it is within what ordinary bars of the same piece do (the 10th percentile of the share of written onsets
heard, the 90th percentile of the number of unexplained peaks, over a random sample of the bars that agree with the PDF).

Run:  python -m artfugue.onset_check      (writes data/work/onset_check.json)
"""

from __future__ import annotations

import bisect
import json
import random
import statistics

import numpy as np
from scipy.signal import find_peaks

from .audio_check import cqt
from .cqt import BB_FPS, FPS, LOWEST_MIDI, broadband_onset_envelope
from .paths import WORK

TIMED = WORK / "timed"
SCORE = WORK / "score"
RISE_DB = 6.0
NEAR_S = 0.05
PEAK_PROMINENCE = 1.0


def attack_rise(db: np.ndarray, t: float, midi: int) -> float | None:
    r = midi - LOWEST_MIDI
    if not 0 <= r < db.shape[0]:
        return None
    a0, a1 = int((t - 0.16) * FPS), int((t - 0.03) * FPS)
    b0, b1 = int((t + 0.01) * FPS), int((t + 0.11) * FPS)
    if a0 < 0 or b1 >= db.shape[1]:
        return None
    return float(db[r, b0:b1].max() - db[r, a0:a1].mean())


def bars_of(piece: dict, notes: list[dict]) -> dict[int, dict]:
    """Per printed bar (first pass): the time span and the distinct onsets with their notes."""
    bars = [b for b in piece["bars"] if b.get("pass", 1) == 1 and "t" in b]
    out = {}
    for i, b in enumerate(bars):
        t0 = b["t"]
        t1 = bars[i + 1]["t"] if i + 1 < len(bars) else piece["audio_end"]
        out[b["n"]] = {"t0": t0, "t1": t1, "onsets": {}}
    for n in notes:
        if "grace" in n.get("flags", []) or n.get("pass", 1) != 1 or n["bar"] not in out:
            continue
        out[n["bar"]]["onsets"].setdefault(n["on"], []).append(n)
    return out


def analyse_bar(info: dict, db: np.ndarray, peaks: np.ndarray, all_onsets: list[float]) -> dict:
    heard, total = 0, 0
    for notes in info["onsets"].values():
        t = statistics.median(n["t_on"] for n in notes)
        total += 1
        rises = [r for n in notes if (r := attack_rise(db, t, n["pitch"])) is not None]
        near_peak = bool(len(peaks) and np.min(np.abs(peaks - t)) <= 0.035)
        if (rises and max(rises) >= RISE_DB) or near_peak:
            heard += 1
    inside = peaks[(peaks >= info["t0"] + 0.03) & (peaks < info["t1"] - 0.03)]
    extra = 0
    for p in inside:
        k = bisect.bisect_left(all_onsets, p)
        near = min((abs(all_onsets[j] - p) for j in (k - 1, k) if 0 <= j < len(all_onsets)), default=9.0)
        extra += near > NEAR_S
    return {"onsets": total, "heard": heard, "extra_peaks": int(extra)}


def main() -> None:
    db = cqt()
    env = broadband_onset_envelope()
    idx, _ = find_peaks(env, prominence=PEAK_PROMINENCE, distance=max(1, int(0.04 * BB_FPS)))
    peaks = idx / BB_FPS
    rd = json.loads((WORK / "pdf_rhythm.json").read_text(encoding="utf-8"))
    pieces = {p["id"]: p for p in json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]}
    rng = random.Random(5)
    result = {}
    for pid, x in rd.items():
        notes = json.loads((TIMED / f"{pid}.json").read_text(encoding="utf-8"))["notes"]
        bars = bars_of(pieces[pid], notes)
        all_onsets = sorted(n["t_on"] for n in notes if n.get("pass", 1) == 1)
        flagged = {e["bar"] for e in x["onsets"]}
        agree = [b for b in bars if b not in flagged and bars[b]["onsets"]]
        control = [analyse_bar(bars[b], db, peaks, all_onsets) for b in rng.sample(agree, min(60, len(agree)))]
        share = sorted(c["heard"] / c["onsets"] for c in control)
        extras = sorted(c["extra_peaks"] for c in control)
        lo = share[int(0.1 * len(share))]
        hi = extras[min(len(extras) - 1, int(0.9 * len(extras)))]
        rows = []
        for e in x["onsets"]:
            r = analyse_bar(bars[e["bar"]], db, peaks, all_onsets) if e["bar"] in bars and bars[e["bar"]]["onsets"] else None
            if r is None:
                continue
            ok = r["heard"] / r["onsets"] >= lo and r["extra_peaks"] <= hi
            rows.append({"bar": e["bar"], "pdf": e["pdf_positions"], "mxl": e["mxl_positions"], **r, "recording_agrees": ok})
        result[pid] = {"control_share_p10": round(lo, 2), "control_extra_p90": hi, "bars": rows}
        print(f"{pid}: {len(rows)} flagged bars, the recording agrees with the MXL's onsets in {sum(r['recording_agrees'] for r in rows)} "
              f"(ordinary bars: at least {lo:.2f} of onsets heard, at most {hi} extra peaks)")
    (WORK / "onset_check.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    flagged_all = [r for v in result.values() for r in v["bars"]]
    print(f"{len(flagged_all)} bars flagged by the page; the recording agrees with the MXL in {sum(r['recording_agrees'] for r in flagged_all)}")


if __name__ == "__main__":
    main()
