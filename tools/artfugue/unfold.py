"""Repeat unfolding (T1.2.4).

Only Canon 1 and Canon 3 carry forward/backward repeat marks among the pieces in the PDF.
Whether the pianist takes them is a performance decision, so both versions are written:
``notes/<id>.json`` (as written) and ``notes/<id>.unfolded.json`` (repeats taken once).
The decision is recorded per piece in ``pieces.json`` (``repeats_taken``) after alignment (T2.3.3).
"""

from __future__ import annotations


def unfold(piece: dict, notes: list[dict]) -> list[dict] | None:
    """Return the notes with every forward..backward section played twice, or None if no repeats."""
    marks = piece.get("repeats") or []
    fwd = [m["bar"] for m in marks if m["type"] == "forward"]
    bwd = [m["bar"] for m in marks if m["type"] == "backward"]
    if not marks or len(fwd) != len(bwd):
        return None
    bars = {b["n"]: b for b in piece["bars"]}
    last_bar = max(bars)
    # sections: (start_bar, end_bar_inclusive, times)
    sections, cur = [], piece["bars"][0]["n"]
    for f, b in zip(sorted(fwd), sorted(bwd)):
        if f > cur:
            sections.append((cur, f - 1, 1))
        sections.append((f, b, 2))
        cur = b + 1
    if cur <= last_bar:
        sections.append((cur, last_bar, 1))

    out, shift, k = [], 0, 0
    for a, b, times in sections:
        on0 = bars[a]["on"]
        end = bars[b]["on"] + bars[b]["len"]
        span = end - on0
        for rep in range(times):
            for n in notes:
                if on0 <= n["on"] < end:
                    m = dict(n)
                    m["on"] = n["on"] - on0 + shift
                    m["src"] = n["id"]
                    m["pass"] = rep + 1
                    k += 1
                    m["id"] = f"{piece['id']}-u{k:04d}"
                    out.append(m)
            shift += span
    out.sort(key=lambda n: (n["on"], n["voice"], n["pitch"]))
    return out


def unfolded_bars(piece: dict) -> list[dict] | None:
    """Bar sequence of the unfolded piece: [{n, on, len, pass}], on = ticks in the unfolded piece."""
    marks = piece.get("repeats") or []
    fwd = sorted(m["bar"] for m in marks if m["type"] == "forward")
    bwd = sorted(m["bar"] for m in marks if m["type"] == "backward")
    if not marks or len(fwd) != len(bwd):
        return None
    bars = {b["n"]: b for b in piece["bars"]}
    order = [b["n"] for b in piece["bars"]]
    out, shift, cur = [], 0, order[0]
    sections = []
    for f, b in zip(fwd, bwd):
        if f > cur:
            sections.append((cur, f - 1, 1))
        sections.append((f, b, 2))
        cur = b + 1
    if cur <= order[-1]:
        sections.append((cur, order[-1], 1))
    for a, b, times in sections:
        for rep in range(times):
            for n in order:
                if a <= n <= b:
                    out.append({"n": n, "on": bars[n]["on"] - bars[a]["on"] + shift, "len": bars[n]["len"],
                                "pass": rep + 1})
            shift += bars[b]["on"] + bars[b]["len"] - bars[a]["on"]
    return out
