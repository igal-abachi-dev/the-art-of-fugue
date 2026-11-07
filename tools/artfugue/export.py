"""Ship the timed data to the web app (T2.4.1, T2.4.2).

Run:  python -m artfugue.export [--fixture]
Writes into web/static/data/:
  manifest.json            pieces (title, audio span, bars with times, voices, chunk file names) and
                           the audio sources with their per-codec offset
  pieces/<id>.bin          columnar typed arrays of the timed notes (format below)
  pieces/<id>.events.json  annotations with their times
These files are fetched at runtime; nothing is imported into the JS bundle.

Binary format "AFN1" (little endian): 16-byte header: magic 'AFN1', u32 version (1), u32 n notes,
u32 0; then the columns listed in manifest.notes_format, in that order, each padded to 4 bytes.
Notes are sorted by t_on.
"""

from __future__ import annotations

import json
import shutil
import struct
import sys

import numpy as np

from .paths import AUDIO_WORK, ROOT, WORK

SCORE = WORK / "score"
TIMED = WORK / "timed"
DATA = ROOT / "web" / "static" / "data"
AUDIO_DST = ROOT / "web" / "static" / "audio"
FLAGS = ["grace", "trill", "mordent", "inverted-mordent", "turn", "inverted-turn", "fermata", "staccato"]
FORMAT = [
    ("t_on", "f4"), ("t_off", "f4"), ("tick", "u4"), ("pitch", "u1"), ("voice", "u1"), ("vel", "u1"),
    ("conf", "u1"), ("bar", "u2"), ("flags", "u2"), ("pass", "u1"),
]
MAGIC = b"AFN1"


def shipped_order(notes: list[dict]) -> list[dict]:
    """The order of the notes in a shipped chunk (the notation map refers to positions in it)."""
    return sorted(notes, key=lambda n: (n["t_on"], n["voice"], n["pitch"]))


def encode_notes(notes: list[dict]) -> bytes:
    n = len(notes)
    cols = {
        "t_on": np.array([x["t_on"] for x in notes], "<f4"),
        "t_off": np.array([x["t_off"] for x in notes], "<f4"),
        "tick": np.array([x["on"] for x in notes], "<u4"),
        "pitch": np.array([x["pitch"] for x in notes], "u1"),
        "voice": np.array([x["voice"] for x in notes], "u1"),
        "vel": np.array([round(255 * x.get("vel", 0.5)) for x in notes], "u1"),
        "conf": np.array([round(255 * x.get("conf", 0.5)) for x in notes], "u1"),
        "bar": np.array([x["bar"] for x in notes], "<u2"),
        "flags": np.array([sum(1 << FLAGS.index(f) for f in x.get("flags", [])) for x in notes], "<u2"),
        "pass": np.array([x.get("pass", 1) for x in notes], "u1"),
    }
    out = bytearray(MAGIC + struct.pack("<III", 1, n, 0))
    for name, _t in FORMAT:
        out += cols[name].tobytes()
        out += b"\0" * (-len(out) % 4)
    return bytes(out)


def decode_notes(buf: bytes) -> dict[str, np.ndarray]:
    """Reference decoder (the web loader does the same with typed-array views)."""
    assert buf[:4] == MAGIC
    _v, n, _r = struct.unpack("<III", buf[4:16])
    pos, out = 16, {}
    for name, t in FORMAT:
        dt = np.dtype("<" + t)
        out[name] = np.frombuffer(buf, dt, n, pos)
        pos += n * dt.itemsize
        pos += -pos % 4
    return out


def event_times(events: list[dict], notes: list[dict]) -> list[dict]:
    """Events with start time in seconds (and pass), from the timed notes they refer to."""
    by_id: dict[str, list[dict]] = {}
    index_of: dict[int, int] = {}  # position of each note in the shipped chunk (the scenes address notes by it)
    for i, n in enumerate(notes):
        by_id.setdefault(n.get("src", n["id"]), []).append(n)
        index_of[id(n)] = i
    bar_t: dict[tuple, float] = {}
    for n in notes:
        bar_t.setdefault((n["bar"], n.get("pass", 1)), n["t_on"])
    out = []
    for e in events:
        refs = [m for i in e.get("notes", []) for m in by_id.get(i, [])]
        passes = sorted({m.get("pass", 1) for m in refs}) or [1]
        for ps in passes:
            sel = [m for m in refs if m.get("pass", 1) == ps]
            if sel:
                t0, t1 = min(m["t_on"] for m in sel), max(m["t_off"] for m in sel)
            else:
                t0 = bar_t.get((e["bar"], ps))
                if t0 is None:
                    continue
                t1 = t0
            data = e["data"]
            idx = sorted(index_of[id(m)] for m in sel)
            if "leader_notes" in data:
                # canon links: follower and leader notes as chunk positions, paired, ordered by follower. A leader note
                # that does not exist in this pass (a repeat that differs) drops its link.
                if len(data["leader_notes"]) != len(e["notes"]):
                    raise ValueError(f"{e['id']}: {len(e['notes'])} follower notes but {len(data['leader_notes'])} leaders")
                pairs = []
                for fid, lid in zip(e["notes"], data["leader_notes"]):
                    f = [m for m in by_id.get(fid, []) if m.get("pass", 1) == ps]
                    l = [m for m in by_id.get(lid, []) if m.get("pass", 1) == ps]
                    if f and l:
                        pairs.append((index_of[id(f[0])], index_of[id(l[0])]))
                pairs.sort()
                idx = [f for f, _ in pairs]
                data = {**data, "leader_notes": [x for _, x in pairs]}
            out.append({**{k: e[k] for k in ("id", "type", "bar", "voice")}, "data": data, "pass": ps,
                        "notes": idx, "t": round(float(t0), 3), "t_end": round(float(t1), 3)})
    out.sort(key=lambda x: x["t"])
    return out


def main() -> None:
    pieces = json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))["pieces"]
    timing = json.loads((AUDIO_WORK / "timing.json").read_text(encoding="utf-8"))
    (DATA / "pieces").mkdir(parents=True, exist_ok=True)
    enc = {e["name"]: e for e in json.loads((AUDIO_WORK / "enc" / "encodes.json").read_text(encoding="utf-8"))}
    delay = json.loads((AUDIO_WORK / "enc" / "delay.json").read_text(encoding="utf-8"))
    audio = []
    for name, mime, dst in (("opus128", "audio/webm; codecs=opus", "fugue.webm"),
                            ("aac160", 'audio/mp4; codecs="mp4a.40.2"', "fugue.m4a")):
        if name not in enc:
            continue
        AUDIO_DST.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(AUDIO_WORK / "enc" / enc[name]["file"], AUDIO_DST / dst)
        lags = delay[enc[name]["file"]]["lag_ms"]
        audio.append({"type": mime, "src": f"/audio/{dst}", "bytes": enc[name]["bytes"],
                      "duration": enc[name]["duration"],
                      "offset_s": round(-float(np.median(lags)) / 1000, 4)})  # add to a time from the WAV
    man_pieces, total_bytes = [], 0
    shipped: dict[str, list[dict]] = {}
    for p in sorted(pieces, key=lambda p: p["order"]):
        if p["status"] == "excluded" or p["id"] not in timing:
            continue
        doc = json.loads((TIMED / f"{p['id']}.json").read_text(encoding="utf-8"))
        notes = shipped_order(doc["notes"])
        shipped[p["id"]] = notes
        blob = encode_notes(notes)
        (DATA / "pieces" / f"{p['id']}.bin").write_bytes(blob)
        ev_doc = json.loads((WORK / "score" / "events" / f"{p['id']}.json").read_text(encoding="utf-8"))
        ev = event_times(ev_doc["events"], notes)
        evp = DATA / "pieces" / f"{p['id']}.events.json"
        evp.write_text(json.dumps(ev, separators=(",", ":")) + chr(10), encoding="utf-8")
        t = timing[p["id"]]
        total_bytes += len(blob) + evp.stat().st_size
        man_pieces.append({
            "id": p["id"], "order": p["order"], "title": p["pdf_title"], "short": p["short"], "kind": p["kind"],
            "status": p["status"], "audio_start": t["audio_start"], "audio_end": t["audio_end"],
            "repeats_taken": t["repeats_taken"], "variant": doc.get("variant", "written"),
            "voices": [{"voice": v["voice"], "label": v["label"]} for v in p["voices"]],
            "bars": t["bars"], "n_notes": len(notes), "notes": f"pieces/{p['id']}.bin",
            "events": f"pieces/{p['id']}.events.json", "pdf_pages": sorted({b["pdf_page"] for b in p["bars"]}),
        })
    write_mirror(man_pieces, shipped)
    if audio and man_pieces:  # the last piece rings out into the recording's tail: its closing visuals need that time
        last = max(man_pieces, key=lambda m: m["audio_end"])
        last["tail_s"] = round(max(0.0, min(5.0, audio[0]["duration"] - last["audio_end"] - 0.5)), 2)
    manifest = {"version": 1, "ppq": 24, "duration": audio[0]["duration"] if audio else None, "audio": audio,
                "notes_format": [{"name": n, "type": t} for n, t in FORMAT], "flags": FLAGS,
                "pieces": man_pieces}
    (DATA / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + chr(10), encoding="utf-8")
    print(f"{len(man_pieces)} pieces, {total_bytes / 1e6:.2f} MB of chunks, manifest {(DATA / 'manifest.json').stat().st_size / 1e3:.0f} kB")
    if "--fixture" in sys.argv:
        write_fixture()


def write_mirror(man_pieces: list[dict], shipped: dict[str, list[dict]]) -> None:
    """For the four mirror pieces: the pitch of each note's counterpart in the other piece of its pair.

    ``pieces/<id>.mirror.bin`` is one byte per note, in the order of the note chunk (0 = no counterpart). The mirror scene
    draws the counterpart as a faint ghost, vertically mirrored, at the time of the note that is sounding.
    """
    links = json.loads((SCORE / "mirror_links.json").read_text(encoding="utf-8"))["pairs"]
    by_id = {pid: {n["id"]: i for i, n in enumerate(ns)} for pid, ns in shipped.items()}
    entry = {m["id"]: m for m in man_pieces}
    for pair in links:
        a, b = pair["a"], pair["b"]
        if a not in shipped or b not in shipped:
            continue
        ca = bytearray(len(shipped[a]))
        cb = bytearray(len(shipped[b]))
        for src, dst in pair["links"]:
            ia, ib = by_id[a].get(src), by_id[b].get(dst)
            if ia is None or ib is None:
                continue
            ca[ia] = shipped[b][ib]["pitch"]
            cb[ib] = shipped[a][ia]["pitch"]
        for pid, arr, other in ((a, ca, b), (b, cb, a)):
            (DATA / "pieces" / f"{pid}.mirror.bin").write_bytes(bytes(arr))
            entry[pid]["mirror"] = {"pair": other, "file": f"pieces/{pid}.mirror.bin", "axis_sum": pair["axis_sum"]}


def write_fixture() -> None:
    """Small fixture for the web loader test: the first 40 notes of Contrapunctus I."""
    doc = json.loads((TIMED / "c01.json").read_text(encoding="utf-8"))
    notes = sorted(doc["notes"], key=lambda n: (n["t_on"], n["voice"], n["pitch"]))[:40]
    fx = ROOT / "web" / "src" / "lib" / "data" / "fixtures"
    fx.mkdir(parents=True, exist_ok=True)
    blob = encode_notes(notes)
    (fx / "c01-head.bin").write_bytes(blob)
    dec = decode_notes(blob)
    expected = {k: [float(x) for x in v] for k, v in dec.items()}
    (fx / "c01-head.json").write_text(json.dumps({"format": [{"name": n, "type": t} for n, t in FORMAT],
                                                  "n": len(notes), "columns": expected}) + chr(10), encoding="utf-8")


if __name__ == "__main__":
    main()
