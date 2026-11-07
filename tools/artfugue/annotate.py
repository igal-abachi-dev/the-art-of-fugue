"""Musical annotations (T1.3.x): BACH motif, subject entries, clashes/crossings, mirror and canon links.

Input: ``data/work/score`` (from build_score). Output: ``data/work/score/events/<piece>.json``
(validated against schema/events.v1.json) and ``mirror_links.json``.

These detectors are deliberately simple and rule-based. Every event carries the evidence it was
found with (``data``), and the thresholds are module constants so they can be tuned.
"""

from __future__ import annotations

import collections
import json
import statistics
from dataclasses import dataclass

from .paths import WORK
from .validate import validate

SCORE = WORK / "score"
PPQ = 24

# --- tunables -------------------------------------------------------------------------------
BACH_MAX_GAP = 2 * PPQ  # max silence between consecutive notes of the motif (2 quarters)
SUBJECT_MIN_EXACT = 0.6  # share of intervals that must match exactly
SUBJECT_MAX_TONAL_DIFF = 2  # semitones; a 5th answered by a 4th differs by 2
SUBJECT_RATIOS = (1.0, 2.0, 0.5)
IOI_TOLERANCE = 0.2
SUBJECT_SCAN_LEN = 8  # notes of the first statement used as the search pattern
DISCOVERY_WINDOW = 8
DISCOVERY_MIN_SUPPORT = 3
DISCOVERY_MIN_REST = 1 * PPQ
CLASH_MIN_OVERLAP = PPQ  # a quarter note: shorter overlaps are passing dissonances
CLASH_MIN_DUR = PPQ


@dataclass
class N:
    id: str
    pitch: int
    on: int
    dur: int
    voice: int
    bar: int
    flags: tuple


def load_pieces() -> dict[str, dict]:
    doc = json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))
    return {p["id"]: p for p in doc["pieces"]}


def load_notes(pid: str) -> list[N]:
    doc = json.loads((SCORE / "notes" / f"{pid}.json").read_text(encoding="utf-8"))
    return [N(n["id"], n["pitch"], n["on"], n["dur"], n["voice"], n["bar"],
              tuple(n.get("flags", []))) for n in doc["notes"]]


def voice_lines(notes: list[N]) -> dict[int, list[N]]:
    """Melodic line per voice: grace notes dropped, one note per onset (the highest)."""
    lines: dict[int, dict[int, N]] = collections.defaultdict(dict)
    for n in notes:
        if "grace" in n.flags:
            continue
        cur = lines[n.voice].get(n.on)
        if cur is None or n.pitch > cur.pitch:
            lines[n.voice][n.on] = n
    return {v: [d[k] for k in sorted(d)] for v, d in lines.items()}


def _event(pid: str, k: int, typ: str, notes: list[N], voice, data=None, dur=None) -> dict:
    first, last = notes[0], notes[-1]
    return {
        "id": f"{pid}-e{k:04d}", "type": typ, "on": first.on,
        "dur": dur if dur is not None else last.on + last.dur - first.on,
        "bar": first.bar, "voice": voice, "notes": [n.id for n in notes],
        **({"data": data} if data else {}),
    }


# --- T1.3.2 BACH motif ---------------------------------------------------------------------
BACH_PC = (10, 9, 0, 11)  # B-flat, A, C, B-natural (German B-A-C-H)


def detect_bach(pid: str, lines: dict[int, list[N]]) -> list[dict]:
    out = []
    for v, line in lines.items():
        for i in range(len(line) - 3):
            w = line[i:i + 4]
            if any(w[j + 1].on - (w[j].on + w[j].dur) > BACH_MAX_GAP for j in range(3)):
                continue
            ps = [n.pitch for n in w]
            ivs = tuple(ps[j + 1] - ps[j] for j in range(3))
            pcs = tuple(p % 12 for p in ps)
            if pcs == BACH_PC and ivs == (-1, 3, -1):
                form = "exact"
            elif ivs == (-1, 3, -1):
                form = "transposed"
            elif ivs == (1, -3, 1):
                form = "retrograde" if pcs == (11, 0, 9, 10) else "inverted"
            else:
                continue
            out.append((w, v, {"form": form, "pitches": ps}))
    return [_event(pid, 0, "bach", w, v, d) for w, v, d in out]


# --- T1.3.1 subject entries -------------------------------------------------------------------
def _ratio_ok(ref_ioi: list[int], cand_ioi: list[int]) -> float | None:
    if not ref_ioi or len(ref_ioi) != len(cand_ioi) or min(ref_ioi) <= 0:
        return None
    rs = [c / r for r, c in zip(ref_ioi, cand_ioi)]
    med = statistics.median(rs)
    target = min(SUBJECT_RATIOS, key=lambda x: abs(x - med))
    if abs(med - target) > 0.15 * target:
        return None
    bad = sum(1 for x in rs if abs(x - target) > IOI_TOLERANCE * target)
    return target if bad <= max(1, len(rs) // 6) else None


def match_window(ref: list[N], cand: list[N]) -> dict | None:
    """Does ``cand`` restate ``ref`` (same, inverted, augmented or diminished)?"""
    if len(ref) != len(cand) or len(ref) < 4:
        return None
    r_iv = [ref[i + 1].pitch - ref[i].pitch for i in range(len(ref) - 1)]
    c_iv = [cand[i + 1].pitch - cand[i].pitch for i in range(len(cand) - 1)]
    r_ioi = [ref[i + 1].on - ref[i].on for i in range(len(ref) - 1)]
    c_ioi = [cand[i + 1].on - cand[i].on for i in range(len(cand) - 1)]
    ratio = _ratio_ok(r_ioi, c_ioi)
    if ratio is None:
        return None
    best = None
    for inverted in (False, True):
        tgt = [-x for x in r_iv] if inverted else r_iv
        diffs = [abs(a - b) for a, b in zip(c_iv, tgt)]
        if max(diffs) > SUBJECT_MAX_TONAL_DIFF:
            continue
        exact = sum(1 for d in diffs if d == 0) / len(diffs)
        if exact < SUBJECT_MIN_EXACT:
            continue
        if best is None or exact > best["exact"]:
            best = {"inverted": inverted, "ratio": ratio, "exact": round(exact, 3),
                    "tonal_adjustments": sum(1 for d in diffs if d)}
    if best is None:
        return None
    form = "inversus" if best["inverted"] else "rectus"
    if ratio == 2.0:
        form = "augmentation" + ("-inversus" if best["inverted"] else "")
    elif ratio == 0.5:
        form = "diminution" + ("-inversus" if best["inverted"] else "")
    best["form"] = form
    best["transposition"] = cand[0].pitch - ref[0].pitch
    return best


def find_subject(lines: dict[int, list[N]]) -> list[N] | None:
    firsts = sorted((line[0].on, v) for v, line in lines.items() if line)
    if not firsts:
        return None
    t0, v0 = firsts[0]
    t2 = next((t for t, v in firsts[1:] if t > t0), None)
    line = lines[v0]
    subj = [n for n in line if t2 is None or n.on < t2]
    if len(subj) < 5:
        subj = line[:8]
    return subj[:SUBJECT_SCAN_LEN]


def _scan(ref: list[N], lines: dict[int, list[N]], used: dict[int, int]) -> list[tuple]:
    hits = []
    for v, line in lines.items():
        i = 0
        while i <= len(line) - len(ref):
            m = match_window(ref, line[i:i + len(ref)]) if i >= used.get(v, 0) else None
            if m:
                hits.append((v, line[i:i + len(ref)], m))
                i += len(ref)
            else:
                i += 1
    return sorted(hits, key=lambda h: h[1][0].on)


def _seed_windows_from_words(words: list[dict], lines, bars: dict[int, int]) -> list[list[N]]:
    """For XIV the MXL labels the three subject expositions XIXa, XIXb, XIXc: take the first
    statement that starts at or after each label."""
    import re
    seeds = []
    for w in words:
        if re.match(r"^XIX\s*[abc]", w["text"]):
            on0 = bars[w["bar"]]
            cands = [(line[i].on, v, i) for v, line in lines.items() for i in range(len(line))
                     if line[i].on >= on0 and (i == 0 or line[i].on - (line[i - 1].on + line[i - 1].dur) >= PPQ)]
            if cands:
                _t, v, i = min(cands)
                seeds.append(lines[v][i:i + SUBJECT_SCAN_LEN])
    return seeds


def detect_subjects(pid: str, kind: str, lines: dict[int, list[N]], piece: dict | None = None
                    ) -> tuple[list[dict], dict]:
    subj = find_subject(lines)
    events, themes = [], {}
    if not subj:
        return events, themes
    themes["S1"] = {"start_bar": subj[0].bar, "notes": len(subj),
                    "pitches": [n.pitch for n in subj]}
    covered: dict[int, set[str]] = collections.defaultdict(set)
    for v, w, m in _scan(subj, lines, {}):
        events.append((w, v, {"theme": "S1", **m}))
        covered[v].update(n.id for n in w)

    seeds = []
    if piece and pid == "c14":
        bars = {b["n"]: b["on"] for b in piece["bars"]}
        seeds = _seed_windows_from_words(piece["words"], lines, bars)[1:]  # S1 is already known
        # the third subject (XIXc) opens with the exact B-A-C-H figure: use that as its seed
        exact = [e for e in detect_bach(pid, lines) if e["data"]["form"] == "exact"]
        if exact and len(seeds) >= 2:
            first_id = exact[0]["notes"][0]
            for line in lines.values():
                for i, n in enumerate(line):
                    if n.id == first_id:
                        seeds[-1] = line[i:i + SUBJECT_SCAN_LEN]
    for k, seed in enumerate(seeds, start=2):
        name = f"S{k}"
        themes[name] = {"start_bar": seed[0].bar, "notes": len(seed), "pitches": [n.pitch for n in seed],
                        "seeded_from": "MXL section label"}
        for v, w, m in _scan(seed, lines, {}):
            events.append((w, v, {"theme": name, **m}))
            covered[v].update(n.id for n in w)
    if not seeds and kind in ("double-fugue", "triple-fugue", "unfinished-fugue"):
        # discovery of further themes: entries after a rest that are not already explained
        cands = []
        for v, line in lines.items():
            for i in range(len(line) - DISCOVERY_WINDOW + 1):
                prev_end = line[i - 1].on + line[i - 1].dur if i else -10**9
                if line[i].on - prev_end < DISCOVERY_MIN_REST:
                    continue
                w = line[i:i + DISCOVERY_WINDOW]
                if any(n.id in covered[v] for n in w):
                    continue
                cands.append((v, w))
        protos: list[dict] = []
        for v, w in sorted(cands, key=lambda c: c[1][0].on):
            for p in protos:
                m = match_window(p["ref"], w)
                if m:
                    p["members"].append((v, w, m))
                    break
            else:
                protos.append({"ref": w, "members": [(v, w, {"form": "rectus", "ratio": 1.0,
                                                              "inverted": False, "exact": 1.0,
                                                              "tonal_adjustments": 0,
                                                              "transposition": 0})]})
        k = 2
        for p in sorted((p for p in protos if len(p["members"]) >= DISCOVERY_MIN_SUPPORT),
                        key=lambda p: p["ref"][0].on):
            name = f"S{k}"
            k += 1
            themes[name] = {"start_bar": p["ref"][0].bar, "notes": len(p["ref"]),
                            "pitches": [n.pitch for n in p["ref"]], "discovered": True,
                            "entries": len(p["members"])}
            for v, w, m in p["members"]:
                events.append((w, v, {"theme": name, **m, "discovered": True}))
    events.sort(key=lambda e: e[0][0].on)
    return [_event(pid, 0, "subject-entry", w, v, d) for w, v, d in events], themes


# --- T1.3.3 clashes and crossings ----------------------------------------------------------------
def detect_clashes(pid: str, notes: list[N]) -> list[dict]:
    ns = sorted((n for n in notes if "grace" not in n.flags and n.dur >= CLASH_MIN_DUR),
                key=lambda n: n.on)
    out, active = [], []
    seen = set()
    for n in ns:
        active = [a for a in active if a.on + a.dur > n.on]
        for a in active:
            if a.voice == n.voice:
                continue
            overlap = min(a.on + a.dur, n.on + n.dur) - n.on
            d = abs(a.pitch - n.pitch)
            if overlap >= CLASH_MIN_OVERLAP and d % 12 in (1, 11) and d <= 24:
                key = (a.id, n.id)
                if key not in seen:
                    seen.add(key)
                    pair = sorted((a, n), key=lambda x: x.voice)
                    out.append(([a, n], None,
                                {"interval": d, "voices": [pair[0].voice, pair[1].voice],
                                 "pitches": [pair[0].pitch, pair[1].pitch]}))
        active.append(n)
    return [_event(pid, 0, "clash", w, v, d, dur=min(x.on + x.dur for x in w) - w[-1].on)
            for w, v, d in out]


def detect_crossings(pid: str, notes: list[N]) -> list[dict]:
    ns = sorted((n for n in notes if "grace" not in n.flags), key=lambda n: n.on)
    out, last_on = [], {}
    for n in ns:
        for m in ns_active(ns, n):
            if m.voice == n.voice:
                continue
            hi, lo = (n, m) if n.voice < m.voice else (m, n)  # smaller rank = higher voice
            if hi.pitch < lo.pitch:
                key = (hi.voice, lo.voice)
                if n.on - last_on.get(key, -10**9) > PPQ:
                    out.append(([hi, lo], None, {"upper_voice": hi.voice, "lower_voice": lo.voice}))
                last_on[key] = n.on
    return [_event(pid, 0, "crossing", sorted(w, key=lambda x: x.on), v, d, dur=0)
            for w, v, d in out]


def ns_active(ns: list[N], n: N) -> list[N]:
    # small helper: notes sounding at n.on (linear scan limited to a window; fine for this size)
    return [m for m in ns if m.on <= n.on < m.on + m.dur and m is not n and abs(m.on - n.on) < 8 * PPQ]


# --- T1.3.4 mirror links -----------------------------------------------------------------------
def mirror_links(pieces: dict[str, dict]) -> list[dict]:
    out = []
    for pid, p in pieces.items():
        if p.get("status") != "derived":
            continue
        src = p["derived_from"]
        a, b = load_notes(src), load_notes(pid)
        assert len(a) == len(b)
        # each derived voice is the mirror of one voice of the source (they share the part it was read from);
        # the numbers are not simply reversed because voices are ranked by register (build_score.derive_piece)
        src_voice = {}
        for dv in p["voices"]:
            src_voice[dv["voice"]] = next(sv["voice"] for sv in pieces[src]["voices"] if sv["source"] == dv["source"])
        links = [[x.id, y.id] for x, y in zip(sorted(a, key=lambda n: (n.on, n.voice, n.pitch)),
                                              sorted(b, key=lambda n: (n.on, src_voice[n.voice], n.pitch)))]
        out.append({"a": src, "b": pid, "axis_sum": p["axis_sum"],
                    "verified": bool(p.get("verified")),
                    "rule": "same onset, duration and mirrored voice; pitch_b = axis_sum - pitch_a up to "
                            "the accidentals and octave placement engraved in the PDF",
                    "links": [[x, y] for x, y in links]})
    return out


# --- T1.3.5 canon links --------------------------------------------------------------------------
def canon_links(pid: str, lines: dict[int, list[N]]) -> list[dict]:
    """Link the follower (comes) to the leader (dux): the follower restates the leader's opening later,
    possibly transposed, inverted and/or augmented. Output: runs of >= 4 consecutive linked notes."""
    voices = sorted(lines, key=lambda v: lines[v][0].on if lines[v] else 10**9)
    if len(voices) < 2:
        return []
    lead_v, fol_v = voices[0], voices[1]
    lead, fol = lines[lead_v], lines[fol_v]
    L = 8
    ref = lead[:L]
    best = None
    for i in range(len(fol) - L + 1):
        m = match_window(ref, fol[i:i + L])
        if m and fol[i].on > lead[0].on and (best is None or m["exact"] > best[1]["exact"]):
            best = (i, m)
            if m["exact"] >= 0.8:  # the earliest good restatement is the canonical one
                break
    if best is None:
        return []
    i0, m0 = best
    r, inv = m0["ratio"], m0["inverted"]
    l0, f0 = lead[0], fol[i0]
    by_on = {n.on: n for n in lead}
    sign = -1 if inv else 1
    runs, run = [], []
    for n in fol[i0:]:
        ln = by_on.get(l0.on + round((n.on - f0.on) / r))
        if ln is not None and abs((n.pitch - f0.pitch) - sign * (ln.pitch - l0.pitch)) <= 2:
            run.append((n, ln))
        else:
            if len(run) >= 4:
                runs.append(run)
            run = []
    if len(run) >= 4:
        runs.append(run)
    return [_event(pid, 0, "canon-link", [f for f, _l in run], fol_v,
                   {"leader_voice": lead_v, "leader_notes": [l.id for _f, l in run],
                    "offset_ticks": f0.on - l0.on, "ratio": r, "inverted": inv,
                    "transposition": f0.pitch - l0.pitch, "form": m0["form"]})
            for run in runs]


# --- driver ----------------------------------------------------------------------------------------
def main() -> None:
    pieces = load_pieces()
    (SCORE / "events").mkdir(exist_ok=True)
    summary = {}
    links = mirror_links(pieces)
    mirror_of = {}
    for pair in links:
        mirror_of[pair["a"]] = (pair["b"], pair["axis_sum"])
        mirror_of[pair["b"]] = (pair["a"], pair["axis_sum"])
    for pid, p in pieces.items():
        if p["status"] not in ("ok", "derived"):
            continue
        notes = load_notes(pid)
        lines = voice_lines(notes)
        evs: list[dict] = []
        themes = {}
        evs += detect_bach(pid, lines)
        if p["kind"] != "canon":
            e, themes = detect_subjects(pid, p["kind"], lines, p)
            evs += e
        evs += detect_clashes(pid, notes)
        evs += detect_crossings(pid, notes)
        if p["kind"] == "canon":
            evs += canon_links(pid, lines)
        if pid in mirror_of:  # one event per bar; the per-note pairs are in mirror_links.json
            other, axis = mirror_of[pid]
            by_bar = collections.defaultdict(list)
            for n in notes:
                by_bar[n.bar].append(n)
            for bar in sorted(by_bar):
                evs.append(_event(pid, 0, "mirror-link", by_bar[bar], None,
                                  {"pair": other, "axis_sum": axis,
                                   "verified": bool(p.get("verified"))}))
        evs.sort(key=lambda e: (e["on"], e["type"]))
        for k, e in enumerate(evs):
            e["id"] = f"{pid}-e{k:04d}"
        doc = {"version": 1, "piece": pid, "events": evs}
        validate("events", doc)
        (SCORE / "events" / f"{pid}.json").write_text(
            json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
        c = collections.Counter(e["type"] for e in evs)
        summary[pid] = {"events": dict(c), "bars": p["n_bars"], "themes": themes}
    (SCORE / "mirror_links.json").write_text(
        json.dumps({"version": 1, "pairs": links}, separators=(",", ":")) + "\n", encoding="utf-8")
    (SCORE / "annotation_summary.json").write_text(json.dumps(summary, indent=1) + "\n",
                                                   encoding="utf-8")
    for pid, s in summary.items():
        print(pid, s["events"], {k: (v["start_bar"], v.get("entries")) for k, v in s["themes"].items()})


if __name__ == "__main__":
    main()
