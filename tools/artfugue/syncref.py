"""Sync acceptance (T9.2.3): reference attack times measured on the recording, and the shipped timings checked against them.

Run:  python -m artfugue.syncref --measure     choose and measure reference points on the recording (needs data/raw), write
                                               data/sync-reference.json and docs/sync-report.md
      python -m artfugue.syncref [--check]     check the shipped note timings against the committed reference points and
                                               rewrite docs/sync-report.md; exit 1 if the sync tolerance is exceeded
                                               (this needs no recording, so CI and the release check run it)

The tolerance is the project's (backlog.md): the median |note onset error| <= 30 ms and the 95th percentile <= 80 ms.

**What a reference point is.** A note whose attack can be read off the waveform without the alignment, in two ways:

- ``broadband``: a note that stands alone in the music (every earlier note has ended at least GAP_BEFORE_S before it and the next
  one starts at least GAP_AFTER_S after it: the beginnings of pieces and the entries after a rest), where the recording has one
  attack and nothing else: the instant the level of the whole band (150 Hz to 6 kHz, in dB) rises fastest.
- ``partials``: a note no other note begins near (within NEIGHBOUR_S, whatever its pitch) and whose pitch is not already
  sounding: the instant the level at its own pitch and its first partials (each within a quarter tone) rises fastest.
  This reaches into the middle of the pieces. It is closer to what the alignment itself looks at (a level at the pitch of
  the note), but with another transform (a short-time Fourier transform with a window of 43 to 85 ms instead of the
  alignment's constant-Q transform) and read at the middle of its steepest rise.
 The search window is wide (-0.45 s to +0.30 s around where the alignment puts the
note), so an alignment that is far off is found to be far off rather than skipped. Points are skipped only when the recording
has no clear attack there (the level rises less than MIN_RISE_DB) or two comparable ones (so the note cannot be told apart).
That is a measurement that does not use the alignment's own signals (the chroma and the CQT flux), but it is **not** a person's
ear, and it is limited to isolated attacks (entries after a rest, piece beginnings, the notes after a fermata): the dense
polyphony in between is not covered. `source` says which: "waveform" for these, "ear" for a point a person has listened to
and written down (those are kept when the points are measured again, and are checked the same way).

The reference file is committed. Measuring is explicit and happens when the pipeline changes; checking is what a release does.
"""

from __future__ import annotations

import json
import sys

import numpy as np

from .export import decode_notes
from .paths import ROOT

DATA = ROOT / "web" / "static" / "data"
REFERENCE = ROOT / "data" / "sync-reference.json"
REPORT = ROOT / "docs" / "sync-report.md"

MEDIAN_LIMIT_MS = 30.0
P95_LIMIT_MS = 80.0
MIN_POINTS = 20
NEIGHBOUR_S = 0.2
TRIES_PER_PIECE = 40
NEAR_S = 0.4
CLASHING = (0, 1, 2, 3, 7, 12, 19, 24)  # semitones apart: the band overlaps or the partials coincide

GAP_BEFORE_S = 0.6
GAP_AFTER_S = 0.45
WINDOW_BEFORE_S = 0.45
WINDOW_AFTER_S = 0.30
PER_PIECE = 5
MIN_RISE_DB = 14.0
AMBIGUITY = 0.6  # the second-best rise must be below this fraction of the best
N_FFT = 1024
HOP = 64
RISE_FRAMES = 4  # the level is compared over 4 steps (about 6 ms)
BAND_HZ = (150.0, 6000.0)
SKIP_FLAGS = ("grace", "trill", "mordent", "inverted-mordent", "turn", "inverted-turn")


def load_manifest() -> dict:
    return json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))


def load_chunk(piece: dict) -> dict[str, np.ndarray]:
    return decode_notes((DATA / piece["notes"]).read_bytes())


def note_key(c: dict[str, np.ndarray], i: int) -> tuple[int, int, int, int]:
    return int(c["tick"][i]), int(c["pitch"][i]), int(c["voice"][i]), int(c["pass"][i])


# ---- choosing the notes

def isolated(c: dict[str, np.ndarray], flags: list[str]) -> list[int]:
    """Positions of the notes that stand alone (see the module doc), in time order."""
    n = len(c["t_on"])
    t_on = c["t_on"].astype("f8")
    t_off = c["t_off"].astype("f8")
    skip = sum(1 << flags.index(f) for f in SKIP_FLAGS if f in flags)
    ended = np.maximum.accumulate(t_off)  # the time by which everything before i is over
    out = []
    for i in range(n):
        if int(c["flags"][i]) & skip:
            continue
        before_ok = i == 0 or t_on[i] - ended[i - 1] >= GAP_BEFORE_S
        after_ok = i == n - 1 or t_on[i + 1] - t_on[i] >= GAP_AFTER_S
        if before_ok and after_ok:
            out.append(i)
    return out


def lonely(c: dict[str, np.ndarray], flags: list[str]) -> list[int]:
    """Notes no other note begins near and whose pitch is not sounding yet (see the module doc), in time order."""
    n = len(c["t_on"])
    t_on = c["t_on"].astype("f8")
    t_off = c["t_off"].astype("f8")
    pitch = c["pitch"]
    skip = sum(1 << flags.index(f) for f in SKIP_FLAGS if f in flags)
    out = []
    for i in range(n):
        if int(c["flags"][i]) & skip:
            continue
        lo = np.searchsorted(t_on, t_on[i] - NEIGHBOUR_S, "left")
        hi = np.searchsorted(t_on, t_on[i] + NEIGHBOUR_S, "right")
        if hi - lo != 1:  # another note begins within NEIGHBOUR_S
            continue
        # a note that begins a little further away at a pitch the band cannot tell from this one (a window of 43 to 85 ms
        # does not separate neighbouring semitones in the middle of the keyboard) or that shares its partials
        lo2 = np.searchsorted(t_on, t_on[i] - NEAR_S, "left")
        hi2 = np.searchsorted(t_on, t_on[i] + NEAR_S, "right")
        d = np.abs(pitch[lo2:hi2].astype(int) - int(pitch[i]))
        if np.any(np.isin(d, CLASHING) & (np.arange(lo2, hi2) != i)):
            continue
        # the same pitch must not be ringing (a repeated note has no clear rise at its own pitch)
        j = np.arange(max(0, lo - 40), i)
        if j.size and np.any((pitch[j] == pitch[i]) & (t_off[j] > t_on[i] - 0.08)):
            continue
        out.append(i)
    return out


def spread(idx: list[int], k: int) -> list[int]:
    """k positions of idx: the first, and the rest spread evenly over the others."""
    if len(idx) <= k:
        return idx
    picks = [0] + [round(j * (len(idx) - 1) / (k - 1)) for j in range(1, k)]
    return [idx[p] for p in dict.fromkeys(picks)]


# ---- measuring

def partial_band(f: np.ndarray, pitch: int) -> np.ndarray:
    """Bins within a quarter tone of the pitch's fundamental and its next three partials (up to 6 kHz)."""
    f0 = 440.0 * 2 ** ((pitch - 69) / 12)
    band = np.zeros(f.shape, bool)
    for k in range(1, 5):
        if k * f0 > BAND_HZ[1]:
            break
        band |= np.abs(np.log2(np.maximum(f, 1e-9) / (k * f0))) < 1 / 24
    return band


def level_db(y: np.ndarray, sr: int, pitch: int | None = None) -> tuple[np.ndarray, float, int]:
    """Level of y in dB per step of HOP samples (the band of the pitch's partials, or the whole band), the step in
    seconds, and the window length used (the frame centre lies half of it after its first sample)."""
    from scipy.signal import stft

    n_fft = N_FFT if pitch is None else (4096 if pitch < 43 else 2048)  # a window long enough to resolve the pitch
    f, _t, z = stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft - HOP, boundary=None, padded=False)
    band = (f >= BAND_HZ[0]) & (f <= BAND_HZ[1]) if pitch is None else partial_band(f, pitch)
    p = (np.abs(z[band]) ** 2).sum(axis=0) + 1e-12
    db = 10 * np.log10(p)
    smooth = np.convolve(np.pad(db, 1, mode="edge"), np.ones(3) / 3, mode="valid")  # edges repeated: no step at the ends
    return smooth, HOP / sr, n_fft


def attack(y: np.ndarray, sr: int, pitch: int | None = None) -> tuple[float, float] | None:
    """Time (in the window of y, seconds) and size in dB of the one clear attack in y, or None."""
    db, step, n_fft = level_db(y, sr, pitch)
    if len(db) < 3 * RISE_FRAMES:
        return None
    rise = db[RISE_FRAMES:] - db[:-RISE_FRAMES]  # rise[k] is the change from frame k to frame k + RISE_FRAMES
    k = int(np.argmax(rise))
    best = float(rise[k])
    if best < MIN_RISE_DB:
        return None
    guard = int(0.06 / step)
    rest = np.concatenate([rise[: max(0, k - guard)], rise[k + guard :]])
    if rest.size and float(rest.max()) > AMBIGUITY * best:
        return None
    centre = k + RISE_FRAMES / 2  # the steepest part of the rise lies in the middle of the 4 steps
    return (centre * HOP + n_fft / 2) / sr, best


def measure() -> list[dict]:
    import soundfile as sf

    from .paths import wav_path

    manifest = load_manifest()
    flags = manifest["flags"]
    sr = sf.info(wav_path()).samplerate
    kept = []
    if REFERENCE.exists():
        kept = [p for p in json.loads(REFERENCE.read_text(encoding="utf-8"))["points"] if p.get("source") != "waveform"]
    points, tried, rejected = [], 0, 0
    with sf.SoundFile(wav_path()) as wav:

        def read(t_guess: float) -> tuple[np.ndarray, float]:
            first = max(0, int((t_guess - WINDOW_BEFORE_S) * sr))
            wav.seek(first)
            y = wav.read(int((WINDOW_BEFORE_S + WINDOW_AFTER_S) * sr), dtype="float32", always_2d=True).mean(axis=1)
            return y, first / sr

        def point(piece: dict, c: dict, i: int, method: str, t_ref: float, rise: float) -> dict:
            return {
                "piece": piece["id"], "kind": piece["kind"], "bar": int(c["bar"][i]), "tick": int(c["tick"][i]),
                "pitch": int(c["pitch"][i]), "voice": int(c["voice"][i]), "pass": int(c["pass"][i]),
                "t_ref": round(t_ref, 4), "rise_db": round(rise, 1), "method": method, "source": "waveform",
            }

        for piece in manifest["pieces"]:
            c = load_chunk(piece)
            got: list[dict] = []
            for i in spread(isolated(c, flags), 2):  # the entries after a rest, whole band
                y, first = read(float(c["t_on"][i]))
                tried += 1
                a = attack(y, sr, None)
                if a is None:
                    rejected += 1
                else:
                    got.append(point(piece, c, i, "broadband", first + a[0], a[1]))
            lone = lonely(c, flags)
            step = max(1, len(lone) // TRIES_PER_PIECE)
            found = []
            for i in lone[::step][:TRIES_PER_PIECE]:  # evenly over the piece, at the note's own partials
                y, first = read(float(c["t_on"][i]))
                tried += 1
                a = attack(y, sr, int(c["pitch"][i]))
                if a is None:
                    rejected += 1
                else:
                    found.append(point(piece, c, i, "partials", first + a[0], a[1]))
            take = spread(list(range(len(found))), max(1, PER_PIECE - len(got)))
            points += got + [found[k] for k in take]
    print(f"{len(points)} reference points measured on the recording; {rejected} of {tried} candidates had no clear attack and were skipped")
    return sorted(points, key=lambda p: (p["piece"], p["t_ref"])) + kept


# ---- checking

def evaluate(points: list[dict]) -> dict:
    manifest = load_manifest()
    by_id = {p["id"]: p for p in manifest["pieces"]}
    chunks: dict[str, tuple[dict, dict]] = {}
    rows = []
    for pt in points:
        piece = by_id[pt["piece"]]
        if pt["piece"] not in chunks:
            c = load_chunk(piece)
            chunks[pt["piece"]] = (c, {note_key(c, i): i for i in range(len(c["t_on"]))})
        c, index = chunks[pt["piece"]]
        i = index.get((pt["tick"], pt["pitch"], pt["voice"], pt["pass"]))
        if i is None:
            rows.append({**pt, "error_ms": None})
            continue
        rows.append({**pt, "t_on": float(c["t_on"][i]), "error_ms": (float(c["t_on"][i]) - pt["t_ref"]) * 1000.0})
    ok = [r for r in rows if r["error_ms"] is not None]
    err = np.array([r["error_ms"] for r in ok])
    kinds = sorted({r["kind"] for r in ok})

    def stats(sel: np.ndarray) -> dict:
        return {"n": int(sel.size), "median": float(np.median(np.abs(sel))), "p95": float(np.percentile(np.abs(sel), 95)),
                "bias": float(np.median(sel)), "max": float(np.abs(sel).max())}

    out = {
        "points": len(points), "matched": len(ok), "missing": [r for r in rows if r["error_ms"] is None],
        "all": stats(err) if err.size else None,
        "by_kind": {k: stats(np.array([r["error_ms"] for r in ok if r["kind"] == k])) for k in kinds},
        "pieces": sorted({r["piece"] for r in ok}), "rows": rows,
    }
    problems = []
    if out["missing"]:
        problems.append(f"{len(out['missing'])} reference notes are not in the shipped chunks any more")
    if len(ok) < MIN_POINTS:
        problems.append(f"only {len(ok)} reference points (at least {MIN_POINTS} are needed)")
    if err.size:
        if out["all"]["median"] > MEDIAN_LIMIT_MS:
            problems.append(f"median error {out['all']['median']:.1f} ms exceeds {MEDIAN_LIMIT_MS:.0f} ms")
        if out["all"]["p95"] > P95_LIMIT_MS:
            problems.append(f"95th percentile {out['all']['p95']:.1f} ms exceeds {P95_LIMIT_MS:.0f} ms")
    all_kinds = {p["kind"] for p in manifest["pieces"]}
    if all_kinds - set(kinds):
        problems.append("no reference point for piece types: " + ", ".join(sorted(all_kinds - set(kinds))))
    out["problems"] = problems
    return out


def write_report(result: dict, doc: dict) -> None:
    a = result["all"]
    lines = [
        "# Sync acceptance report (T9.2.3)",
        "",
        "Generated by `python -m artfugue.syncref` from `data/sync-reference.json` and the note chunks that ship",
        "(`web/static/data/pieces`). Do not edit by hand.",
        "",
        "**Tolerance** (backlog.md): median |note onset error| <= 30 ms and 95th percentile <= 80 ms.",
        "",
        f"**Result: {'PASS' if not result['problems'] else 'FAIL'}.** "
        + (f"{result['matched']} reference points in {len(result['pieces'])} pieces and {len(result['by_kind'])} piece types: "
           f"median {a['median']:.1f} ms, 95th percentile {a['p95']:.1f} ms, worst {a['max']:.1f} ms, "
           f"the aligned onset is a median of {a['bias']:+.1f} ms from the reference (signed)." if a else "no points"),
        "",
    ]
    for p in result["problems"]:
        lines.append(f"- **PROBLEM:** {p}")
    if result["problems"]:
        lines.append("")
    sources = {}
    for r in result["rows"]:
        sources[r["source"]] = sources.get(r["source"], 0) + 1
    have = set(result["pieces"])
    none = [p["id"] for p in load_manifest()["pieces"] if p["id"] not in have]
    lines += [
        "Pieces without a reference point (no note there stands alone with a clear attack): " + (", ".join(none) or "none") + ".",
        "",
        "## What the reference points are, and are not",
        "",
        "- " + ", ".join(f"{n} read off the **{s}**" for s, n in sorted(sources.items()))
        + ". \"waveform\": the instant the level of the recording rises fastest, searched in a window of "
        f"-{WINDOW_BEFORE_S} s to +{WINDOW_AFTER_S} s around the aligned time, by one of two methods: `broadband` (the whole band, 150 Hz to 6 kHz, "
        f"for a note that stands alone: everything before it ended at least {GAP_BEFORE_S} s earlier and the next note is at least {GAP_AFTER_S} s later) "
        f"or `partials` (the level at the note's own pitch and its first partials, for a note no other note begins within {NEIGHBOUR_S} s of, "
        "and none within 0.4 s at a pitch that would blur with it). \"ear\": a person listened and wrote the time down.",
        ("- The waveform points do not use the alignment's own signals, but they are **not a person's ear**, and they are "
        "**isolated attacks only**: entries after a rest, piece beginnings, notes after a fermata. The dense polyphony in between "
        "is covered by no reference point; for that the evidence is the onset hit rates in `alignment-report.md` and looking at "
        "`/stage?spectro`. Points are skipped only where the recording has no clear attack (a rise under "
        f"{MIN_RISE_DB:.0f} dB) or two comparable ones; a point where the alignment is far off is *not* skipped, it counts as the error it is."),
        ("- To add points that count more, listen at a place in the spectrogram view and append "
        "`{\"piece\": ..., \"tick\": ..., \"pitch\": ..., \"voice\": ..., \"pass\": 1, \"t_ref\": <seconds>, \"source\": \"ear\", "
        "\"kind\": ..., \"bar\": ...}` to `data/sync-reference.json`; they are kept when the points are measured again."),
        ("- A person has also listened: on 2026-11-06 the owner listened to all pieces and judged the sync good (`listening-check.md`). That report has no "
        "numbers and wrote no reference point, so it is not part of the figures above."),
        ("- The error is the shipped onset minus the reference, in the recording's own timeline. It does not include the delay "
        "between the clock and what comes out of the loudspeaker (output latency: not calibrated, see `playback.md`)."),
        "",
        "## By piece type",
        "",
        "| piece type | points | median ms | 95th pct ms | worst ms | signed median ms |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for k, s in result["by_kind"].items():
        lines.append(f"| {k} | {s['n']} | {s['median']:.1f} | {s['p95']:.1f} | {s['max']:.1f} | {s['bias']:+.1f} |")
    by_method = {}
    for r in result["rows"]:
        if r["error_ms"] is not None:
            by_method.setdefault(r.get("method", r["source"]), []).append(r["error_ms"])
    lines += ["", "By method (signed median, spread): " + "; ".join(
        f"{m} {len(v)} points, {float(np.median(v)):+.1f} ms, {float(np.std(v)):.1f} ms" for m, v in sorted(by_method.items())) + ".", ""]
    lines += ["", "## Every point", "", "| piece | bar | pass | pitch | voice | reference s | shipped s | error ms | rise dB | source |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in sorted(result["rows"], key=lambda r: (r["piece"], r["t_ref"])):
        if r["error_ms"] is None:
            lines.append(f"| {r['piece']} | {r['bar']} | {r['pass']} | {r['pitch']} | {r['voice']} | {r['t_ref']:.3f} | missing | | | {r['source']} |")
        else:
            lines.append(f"| {r['piece']} | {r['bar']} | {r['pass']} | {r['pitch']} | {r['voice']} | {r['t_ref']:.3f} | {r['t_on']:.3f} | {r['error_ms']:+.1f} | {r.get('rise_db', '')} | {r['source']} |")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if "--measure" in sys.argv:
        pts = measure()
        doc = {"version": 1, "tolerance": {"median_ms": MEDIAN_LIMIT_MS, "p95_ms": P95_LIMIT_MS}, "points": pts}
        REFERENCE.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    doc = json.loads(REFERENCE.read_text(encoding="utf-8"))
    result = evaluate(doc["points"])
    write_report(result, doc)
    a = result["all"]
    if a:
        print(f"{result['matched']} points, {len(result['pieces'])} pieces, {len(result['by_kind'])} types: median {a['median']:.1f} ms, "
              f"p95 {a['p95']:.1f} ms, worst {a['max']:.1f} ms, signed median {a['bias']:+.1f} ms")
    for p in result["problems"]:
        print("PROBLEM:", p)
    return 1 if result["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
