# MVP vertical slice (T0.2.2)

## Slice

**Contrapunctus I**, the first piece in the work, plays with the real recording and
falling notes locked to it, on a private Vercel preview (milestone M1).

If the MXL does not start with Contrapunctus I, the slice is whichever piece T1.1.3
identifies as Contrapunctus I; the PDF is the source of truth for numbering (T1.1.2).

## In the slice

- Note JSON for that piece, with voices and bars (T1.1.3, T1.2.x).
- Opus/AAC audio and piece boundaries (T2.1.x).
- Chroma DTW alignment for that piece, QA report within the sync tolerance (T2.2.x, T2.3.x).
- Clock, transport, start screen (T3.1.x, T3.2.1, T7.1.1, T7.2.1).
- Piano roll with voice colours (T4.1.1, T4.2.x).
- Private preview deploy (T9.1.1).

## Not in the slice

Other pieces, annotations, scenes, butterchurn, bloom, sampler, accessibility polish,
score overlay. These come in M2 to M4.

## Exit criteria

The M1 exit list in `backlog.md` is confirmed as-is: it was reviewed against the
tasks above and is consistent with them. Sync tolerance: median onset error ≤ 30 ms,
95th percentile ≤ 80 ms.
