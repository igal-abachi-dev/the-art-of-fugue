"""The piano, harpsichord and pipe organ of the sampler mode: fetched from the VCSL, prepared, listed.

Run:  python -m artfugue.instruments
Writes web/static/samples/{piano,harpsichord,organ}/ (the audio files and an index.json each).

Source: the Versilian Community Sample Library (VCSL, Versilian Studios LLC), released under CC0 1.0 (public domain; no credit is
required, it is given anyway). The raw 24-bit WAV files (about 1 GB) are cached under data/work/instruments/vcsl and are not
shipped; what ships is prepared here.

* piano: "Grand Piano, Steinway B" (recorded as "JHPiano", close microphones), three velocity layers (vl2, vl3, vl4), 42 notes a
  whole tone apart in each, as stereo MP3 cut to 9, 7 or 5 s by pitch (the treble dies away sooner) with a fade.
* harpsichord: "Harpsichord, Flemish", the low register, far microphone, 28 notes a whole tone apart, 6.5 s, MP3.
* organ: "Pipe Organ" (Ivy Audio, a church organ, manual 3 open and quiet ranks, and pedal), two layers, a soft one (the quiet
  rank) and a full one (the open rank, with the pedal below it), which the sampler crossfades by the note's loudness in the
  recording: the organ follows the recording's crescendo and diminuendo as a registrant would. Where the open rank has no
  sample, and above its range, the full layer is made of the quiet rank too (the open rank's treble has about 20 % of its
  energy above 5 kHz, a hard, noisy sound; the quiet rank has none). A pipe sounds as long as the key is held: each sample is its
  attack and a seamless cross-faded loop of its steady part. FLAC, lossless, so the loop points are exact in every browser.

The names of the VCSL's files are not to be trusted (the open rank's "A4" sounds an octave and a half above its "A1"), so the
pitch of every sample is measured (autocorrelation of its steady part) and the note it is taken for is that pitch rounded,
its tuning against equal temperament at A = 440 Hz (`cents`) the remainder; the sampler corrects it when it re-pitches.

Every sample is levelled within its layer to the layer's own loudness (the layers keep their loudness against each other: that is
what the velocity crossfade is for). `delay_s` is measured, not chosen: see `docs/sampler.md`.
"""

from __future__ import annotations

import json
import re
import subprocess
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

from . import syncref
from .paths import ROOT

RAW = ROOT / "data" / "work" / "instruments" / "vcsl"
OUT = ROOT / "web" / "static" / "samples"
RAW_URL = "https://raw.githubusercontent.com/sgossner/VCSL/master/"
TREE_URL = "https://api.github.com/repos/sgossner/VCSL/git/trees/master?recursive=1"
CREDIT = "Versilian Community Sample Library (VCSL), Versilian Studios LLC, released under CC0 1.0 (public domain)"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
SOURCE_URL = "https://github.com/sgossner/VCSL"

SAMPLE_RATE = 44_100
PRE_ROLL_S = 0.004  # silence kept before the first sound
TARGET_DB = -20.0  # RMS of the played part of the loudest layer's samples
PEAK_LIMIT = 0.9


@dataclass(frozen=True)
class Part:
    """Some of the files of one folder of the library, taken into a layer."""

    raw: str  # the name of the cache folder under RAW
    folder: str  # path inside the repository, ending in "/"
    pattern: str  # file name pattern; group 1 is the note's name (not trusted for the pitch)
    lo: int = 0  # keep samples whose measured pitch is in [lo, hi]
    hi: int = 127
    fill: bool = False  # only where the layer has no sample within a semitone yet
    names: bool = False  # take the pitch from the file's name (C3 = middle C), measuring only the tuning: for a set that is named right


@dataclass(frozen=True)
class Layer:
    name: str
    vel: int  # the loudness of a note (0..255 as in the notes' data) that this layer is made for
    parts: tuple[Part, ...]
    level_db: float | None = None  # loudness against the loudest layer; None: as the files are
    delay_s: float = (
        0.0  # this layer's delay on top of the instrument's (measured: a soft attack is read later)
    )


@dataclass(frozen=True)
class Spec:
    id: str
    title: str
    kind: str  # "decay" (a struck or plucked string) or "sustain" (a pipe, looped)
    ext: str
    level: float  # the gain of the whole instrument in the sampler
    release_tau: float  # seconds: how fast the key's release silences the note
    delay_s: float  # seconds later than the plain rule this instrument must strike (measured)
    note: str
    layers: tuple[Layer, ...]
    cut_s: tuple[tuple[int, float], ...] = (
        (0, 6.5),
    )  # decay: (from this pitch up, the sample's length in seconds)
    mp3_quality: int = 3
    loop: tuple[float, float, float] = (
        0.0,
        0.0,
        0.0,
    )  # sustain: loop start, loop length, cross-fade (seconds)
    reverb: tuple[float, float] | None = (
        None  # (reverb time in s, mix 0..1): a room for a dry instrument
    )
    # a tone correction of the whole instrument: (type, Hz, dB, Q), measured against the recording (`piano_compare --eq`)
    eq: tuple[tuple[str, float, float, float], ...] = ()
    sustain: tuple[
        tuple[float, float], ...
    ] = ()  # (seconds into the note, dB): a swell that holds it up as it dies away
    vel_scale: float = 1.0  # the strike's loudness is multiplied by this before it picks its layers (below 1: softer hammers)
    registration: str = "crossfade"  # "terraced": the sampler picks the layer by section (web/src/lib/sampler/registration.ts)
    dynamics: bool = False  # the strike's strength changes the loudness of a single layer (no layers to crossfade)


def _steinway(vl: int) -> Part:
    return Part(
        "steinway-b",
        "Chordophones/Zithers/Grand Piano, Steinway B/Sus/",
        rf"JHPiano_Sus_Close_([A-G]#?\d)_vl{vl}_rr1\.wav",
    )


_PIPE = "Aerophones/Edge-blown Aerophones/Pipe Organ/"

SPECS = [
    Spec(
        id="piano",
        title="Piano",
        kind="decay",
        ext="mp3",
        level=0.55,
        # the recording's notes are not damped at their aligned end: the pianist's fingers, the pedal and the room let them fall
        # about 7 dB in the 0.25 s after it where a damper of 70 ms would take them 30 dB down; a time constant of 0.3 s is about
        # what is heard (the piano's own decay does the rest)
        release_tau=0.3,
        delay_s=-0.0059,
        cut_s=((0, 9.0), (48, 7.0), (72, 5.0)),
        mp3_quality=2,
        # Measured against the recording's reference notes (`python -m artfugue.piano_compare` and the filter simulation in its docstring):
        # over the whole spectrum the Steinway's close microphones carry 18 to 22 dB more energy above 2.5 kHz than the recorded piano
        # (-22 to -27 dB of the total against -41 to -45), and its notes fall faster (-6 dB half a second after the strike against
        # -1 to -4 dB for the recording, whose pedal and room hold them). That was the brightness of a plucked string. The top is
        # taken down (a shelf of -18 dB from 2 kHz, another -6 dB from 4 kHz, a low pass at 6 kHz), a little body is added in the lower
        # middle and the middle, and a swell of +3 dB at 0.5 s, +7 dB at 1 s and +9 dB at 2 s holds each note up. Simulated on the samples,
        # that puts the centroid at 440 to 500 Hz (the recording's: 456 to 567), the energy above 2.5 kHz at -38 to -42 dB (the
        # recording's: -40 to -45) and the fall at 0.5 and 1 s at -3 to -5 and -7 to -8 dB (the recording's: -1 to -7.5 and -4 to -7.4).
        # What it sounds like is for the owner's ear: the tone control of the sound menu moves the top either way. The strike is taken as
        # 85 % of its loudness when it picks its layers (the softer layers' hammers are less hard-edged).
        eq=(
            ("lowshelf", 180.0, 1.5, 0.7),
            ("peaking", 750.0, 5.0, 0.8),
            ("peaking", 1400.0, 2.0, 0.9),
            ("highshelf", 2000.0, -18.0, 0.7),
            ("highshelf", 4000.0, -6.0, 0.7),
            ("lowpass", 6000.0, 0.0, 0.7),
        ),
        sustain=((0.0, 0.0), (0.5, 3.0), (1.0, 7.0), (2.0, 9.0)),
        vel_scale=0.85,
        note="Steinway B grand, close microphones, three dynamic layers",
        layers=(
            # the library's piano files are normalised (every layer peaks alike), so the layers' loudness against each other is
            # set here: about 7 dB a step, as a piano's pp to ff is a matter of loudness as much as of timbre
            Layer("soft", 85, (_steinway(2),), level_db=-14.0),
            Layer("mezzo", 165, (_steinway(3),), level_db=-7.0),
            Layer("forte", 235, (_steinway(4),), level_db=0.0),
        ),
    ),
    Spec(
        id="harpsichord",
        title="Harpsichord",
        kind="decay",
        ext="mp3",
        level=0.6,
        release_tau=0.05,
        delay_s=-0.0015,
        cut_s=((0, 6.5),),
        # a played harpsichord (a reference recording, `data/work/refs`) keeps a note 3.4 dB down at 0.5 s and 4.9 dB at 1 s, in its room; the
        # samples are 4.8 and 9.1 dB down: a small swell (+1.5 dB at 0.5 s, +4 at 1 s, +6 at 2 s) brings them to 3.3 and 5.1
        sustain=((0.0, 0.0), (0.5, 1.5), (1.0, 4.0), (2.0, 6.0)),
        note="Flemish harpsichord, the lower 8-foot register, a far microphone; every note decays by itself",
        layers=(
            Layer(
                "all",
                128,
                (
                    Part(
                        "flemish-low",
                        "Chordophones/Zithers/Harpsichord, Flemish/Sustains/Low/",
                        r"HarpsiRH_Low_Far_([A-G]#?\d)_rr1\.wav",
                        names=True,  # named right, and what it sounded like when it was listened to and liked: unchanged
                    ),
                ),
            ),
        ),
    ),
    Spec(
        id="organ",
        title="Pipe organ",
        kind="sustain",
        ext="flac",
        level=0.5,
        release_tau=0.08,
        delay_s=-0.0109,
        loop=(1.0, 1.2, 0.35),
        registration="terraced",
        note="a church organ: the quiet rank for soft notes, the open rank and the pedal for full ones; a pipe sounds while the key is held",
        layers=(
            Layer(
                "soft",
                60,
                (
                    Part(
                        "pipe-quiet-pedal",
                        _PIPE + "Quiet Pedal/",
                        r"NT5_PedalQuiet_([A-G]#?\d)_rr1\.wav",
                        hi=47,
                    ),
                    Part("pipe-quiet", _PIPE + "Quiet/", r"NT5_Man3Quiet_([A-G]#?\d)_rr1\.wav"),
                ),
                level_db=-9.0,
                # measured with the registration score (`pnpm sampler-check`): on the flute the strike was read 29 ms later than the
                # recording's (17 of 18 reference notes are on it); the full rank was read within 3 ms (but 1 note)
                delay_s=-0.029,
            ),
            Layer(
                "full",
                230,
                (
                    Part(
                        "pipe-loud-pedal",
                        _PIPE + "Loud Pedal/",
                        r"Rode_Pedal_([A-G]#?\d)\.wav",
                        hi=51,
                    ),
                    Part(
                        "pipe-loud",
                        _PIPE + "Loud/",
                        r"Rode_Man3Open_([A-G]#?\d)\.wav",
                        lo=52,
                        hi=76,
                    ),
                    Part(
                        "pipe-quiet",
                        _PIPE + "Quiet/",
                        r"NT5_Man3Quiet_([A-G]#?\d)_rr1\.wav",
                        fill=True,
                    ),
                ),
                level_db=0.0,
            ),
        ),
    ),
]


DEST_NAMES = [spec.id for spec in SPECS]


def fetch_part(part: Part) -> list[tuple[str, Path]]:
    """Download the WAV files of a part (once) and return (note name, path) of those that match its pattern."""
    dst = RAW / part.raw
    dst.mkdir(parents=True, exist_ok=True)
    if not any(dst.glob("*.wav")):
        with urllib.request.urlopen(TREE_URL, timeout=60) as r:
            tree = json.loads(r.read())
        for t in tree["tree"]:
            p = t["path"]
            if t["type"] == "blob" and p.startswith(part.folder) and p.endswith(".wav"):
                with urllib.request.urlopen(RAW_URL + urllib.parse.quote(p), timeout=300) as r:
                    (dst / p.rsplit("/", 1)[1]).write_bytes(r.read())
    out = []
    for f in sorted(dst.glob("*.wav")):
        m = re.fullmatch(part.pattern, f.name)
        if m:
            out.append((m.group(1), f))
    return out


def measure_pitch(m: np.ndarray, sr: int) -> float | None:
    """The fundamental in Hz of the steady part of a sound, by autocorrelation (the first strong peak of the lag), or None."""
    seg = m[int(0.5 * sr) : int(1.7 * sr)] if len(m) > 1.7 * sr else m[len(m) // 4 :]
    if len(seg) < sr // 4:
        return None
    seg = seg - seg.mean()
    ac = fftconvolve(seg, seg[::-1], mode="full")[len(seg) - 1 :]
    if ac[0] <= 0:
        return None
    ac = ac / ac[0]
    lo, hi = int(sr / 2400), min(int(sr / 20), len(ac) - 2)
    win = ac[lo:hi]
    best = win.max()
    peaks = [
        i
        for i in range(1, len(win) - 1)
        if win[i] > win[i - 1] and win[i] >= win[i + 1] and win[i] > 0.85 * best
    ]
    if not peaks:
        return None
    t = peaks[0] + lo
    a, b, c = ac[t - 1], ac[t], ac[t + 1]
    denom = a - 2 * b + c
    if denom != 0:
        t += 0.5 * (a - c) / denom
    return sr / t


NOTE_INDEX = {
    "C": 0,
    "C#": 1,
    "D": 2,
    "D#": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "G": 7,
    "G#": 8,
    "A": 9,
    "A#": 10,
    "B": 11,
}


def midi_of(name: str) -> int:
    """MIDI number of a VCSL note name such as "F#2" where the library counts C3 as middle C (MIDI 60)."""
    m = re.fullmatch(r"([A-G]#?)(\d)", name)
    if not m:
        raise ValueError(name)
    return 12 * (int(m.group(2)) + 2) + NOTE_INDEX[m.group(1)]


def start_of_sound(m: np.ndarray, sr: int) -> int:
    """The first sample above -50 dB of the loudest one in the first half second."""
    n = min(len(m), sr // 2)
    peak = float(np.abs(m[:n]).max())
    above = np.nonzero(np.abs(m[:n]) >= peak * 10 ** (-50 / 20))[0]
    return int(above[0]) if len(above) else 0


def first_sound(y: np.ndarray, sr: int) -> float:
    """Where the sound begins, as the browser finds it (`findAttack` in web/src/lib/sampler/bank.ts): the first sample above 1.5 %
    of the loudest in the first half second, less 2 ms. Seconds."""
    n = min(len(y), sr // 2)
    peak = float(np.abs(y[:n]).max())
    if peak == 0:
        return 0.0
    above = np.nonzero(np.abs(y[:n]) >= peak * 0.015)[0]
    return max(0.0, float(above[0]) / sr - 0.002) if len(above) else 0.0


def strike_of(y: np.ndarray, sr: int, midi: int) -> float | None:
    """Where the note is struck in a prepared sample, read the way the recording's reference points are read (`syncref.attack`: the
    instant the level at the note's pitch and its first partials rises fastest), seconds after the first sound (`first_sound`).
    The browser measures the first sound itself in what it decodes, so the strike is given from there: an encoder's delay does
    not matter. None where no clear attack is found."""
    m = y.mean(axis=1) if y.ndim > 1 else y
    # silence before it, as a note has in the music: the transform's first window must not already hold the attack
    pad = int(0.3 * sr)
    seg = np.concatenate([np.zeros(pad), m[: int(0.6 * sr)]])
    a = syncref.attack(seg, sr, midi) or syncref.attack(seg, sr, None)
    return None if a is None else a[0] - pad / sr - first_sound(m, sr)


def played_part(spec: Spec, m: np.ndarray, sr: int, start: int) -> np.ndarray:
    """The part of a sample that the level is measured on: the first half second of a decay; the loop of a sustain."""
    if spec.kind == "sustain":
        a = start + int(spec.loop[0] * sr)
        return m[a : a + int(spec.loop[1] * sr)]
    return m[start : start + int(0.5 * sr)]


def cut_for(spec: Spec, midi: int) -> float:
    secs = spec.cut_s[0][1]
    for from_midi, s in spec.cut_s:
        if midi >= from_midi:
            secs = s
    return secs


def prepare(
    spec: Spec, y: np.ndarray, sr: int, midi: int, gain: float, start: int
) -> tuple[np.ndarray, dict]:
    """Cut, scale and (for a sustained sound) loop one sample. Returns the audio and its index fields."""
    y = y * gain
    peak = float(np.abs(y[start : start + 4 * sr]).max())
    if peak > PEAK_LIMIT:
        y = y * (PEAK_LIMIT / peak)
    y = y[start:]
    extra: dict = {}
    if spec.kind == "decay":
        n = int(cut_for(spec, midi) * sr)
        y = y[:n].copy()
        fade = int(0.6 * sr)
        y[-fade:] *= np.linspace(1, 0, fade)[:, None]
    else:
        a, length, cross = (int(x * sr) for x in spec.loop)
        b = a + length
        y = y[: b + 1].copy()
        # seamless loop: the last `cross` samples are faded into the audio that precedes the loop's start, so that the sample
        # at the loop's end continues into the sample at its start
        w = np.linspace(0, 1, cross, endpoint=False)[:, None]
        y[b - cross : b] = (1 - w) * y[b - cross : b] + w * y[a - cross : a]
        y = y[:b]
        extra["loop"] = [round(a / sr, 5), round(b / sr, 5)]
    return y.astype(np.float32), extra


def write_audio(spec: Spec, path: Path, y: np.ndarray) -> None:
    if spec.ext == "flac":
        sf.write(path, y, SAMPLE_RATE, subtype="PCM_16")
        return
    tmp = path.with_suffix(".tmp.wav")
    sf.write(tmp, y, SAMPLE_RATE, subtype="PCM_16")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(tmp),
                "-codec:a",
                "libmp3lame",
                "-q:a",
                str(spec.mp3_quality),
                str(path),
            ],
            check=True,
        )
    finally:
        tmp.unlink(missing_ok=True)


def collect(layer: Layer) -> list[dict]:
    """The samples of a layer: for each, its audio, its measured pitch (rounded) and tuning, in pitch order."""
    chosen: dict[int, dict] = {}
    for part in layer.parts:
        found = []
        for name, path in fetch_part(part):
            y, sr = sf.read(path, always_2d=True, dtype="float64")
            if sr != SAMPLE_RATE:
                raise ValueError(f"{path.name}: expected {SAMPLE_RATE} Hz, got {sr}")
            hz = measure_pitch(y.mean(axis=1), sr)
            if part.names:
                # the name says the note (C3 = 60); the measurement is only used for the tuning, and only if it agrees
                midi = midi_of(name)
                exact = 69 + 12 * np.log2(hz / 440) if hz else float(midi)
                if abs(exact - midi) > 0.5:
                    exact = float(midi)
            else:
                if hz is None:
                    print(f"  {path.name}: no pitch found, left out")
                    continue
                exact = 69 + 12 * np.log2(hz / 440)
                midi = round(exact)
            if not part.lo <= midi <= part.hi:
                continue
            found.append({"name": name, "midi": midi, "cents": float((exact - midi) * 100), "y": y})
        found.sort(key=lambda s: s["midi"])
        had = list(
            chosen
        )  # what the earlier parts brought: a filling part adds only where they left a gap
        for s in found:
            if part.fill and any(abs(s["midi"] - m) <= 1 for m in had):
                continue
            if s["midi"] in chosen:
                continue
            chosen[s["midi"]] = s
    return [chosen[k] for k in sorted(chosen)]


def measure_rises(spec_id: str) -> int:
    """Put into an instrument's list where each shipped sample is struck, read from the files as they are (decoded as the browser
    decodes them, so that what an encoder did is in it). Returns how many samples have a reading."""
    dst = OUT / spec_id
    path = dst / "index.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for layer in doc["layers"]:
        for entry in layer["samples"]:
            y, sr = sf.read(dst / entry["file"], always_2d=True, dtype="float64")
            rise = strike_of(y, sr, entry["midi"])
            entry.pop("rise", None)
            if rise is not None:
                entry["rise"] = round(rise, 4)
                n += 1
    path.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    total = sum(len(layer["samples"]) for layer in doc["layers"])
    print(f"{spec_id}: where the note is struck is read in {n} of {total} samples")
    return n


def build(spec: Spec) -> dict:
    dst = OUT / spec.id
    dst.mkdir(parents=True, exist_ok=True)
    for old in dst.glob("*"):
        old.unlink()
    layers = [(layer, collect(layer)) for layer in spec.layers]
    # the level of a layer: as the files are (the median of its samples) unless the layer says how far below the loudest it is
    raw_db = []
    for _layer, samples in layers:
        levels = []
        for s in samples:
            m = s["y"].mean(axis=1)
            start = max(0, start_of_sound(m, SAMPLE_RATE) - int(PRE_ROLL_S * SAMPLE_RATE))
            part = played_part(spec, m, SAMPLE_RATE, start)
            s["start"] = start
            s["rms"] = float(np.sqrt(np.mean(part**2))) or 1e-9
            levels.append(20 * np.log10(s["rms"]))
        raw_db.append(float(np.median(levels)))
    rel = [
        layer.level_db if layer.level_db is not None else raw_db[i] - max(raw_db)
        for i, (layer, _) in enumerate(layers)
    ]
    top = max(rel)
    out_layers = []
    for (layer, samples), r in zip(layers, rel, strict=True):
        target = TARGET_DB + (r - top)
        entries = []
        for s in samples:
            gain = 10 ** (target / 20) / s["rms"]
            audio, extra = prepare(spec, s["y"], SAMPLE_RATE, s["midi"], gain, s["start"])
            file = f"{layer.name}-{s['midi']}.{spec.ext}"
            write_audio(spec, dst / file, audio)
            entries.append(
                {
                    "name": f"{layer.name} {s['name']} -> {s['midi']}",
                    "midi": s["midi"],
                    "file": file,
                    "cents": round(s["cents"], 1),
                    "bytes": (dst / file).stat().st_size,
                    **extra,
                }
            )
        out_layers.append(
            {
                "name": layer.name,
                "vel": layer.vel,
                "level_db": round(r, 1),
                "delay_s": layer.delay_s,
                "samples": entries,
            }
        )
        print(
            f"  {spec.id}/{layer.name}: {len(entries)} samples, pitches {entries[0]['midi']}..{entries[-1]['midi']}, level {r:.1f} dB"
        )
    doc = {
        "id": spec.id,
        "instrument": spec.title,
        "note": spec.note,
        "credit": CREDIT,
        "license": "CC0 1.0",
        "license_url": LICENSE_URL,
        "source_url": SOURCE_URL,
        "format": spec.ext,
        "level": spec.level,
        "release_tau": spec.release_tau,
        "delay_s": spec.delay_s,
        "reverb": {"rt60": spec.reverb[0], "mix": spec.reverb[1]} if spec.reverb else None,
        "eq": [{"type": t, "freq": f, "gain": g, "q": q} for t, f, g, q in spec.eq],
        "vel_scale": spec.vel_scale,
        "sustain": [list(p) for p in spec.sustain],
        "registration": spec.registration,
        "dynamics": spec.dynamics,
        "sustained": spec.kind == "sustain",
        "layers": out_layers,
    }
    (dst / "index.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    total = sum(e["bytes"] for layer in out_layers for e in layer["samples"])
    print(
        f"{spec.id}: {sum(len(layer['samples']) for layer in out_layers)} samples, {total / 1e6:.2f} MB, in {dst}"
    )
    measure_rises(spec.id)
    return doc


def main() -> None:
    for spec in SPECS:
        build(spec)


if __name__ == "__main__":
    main()
