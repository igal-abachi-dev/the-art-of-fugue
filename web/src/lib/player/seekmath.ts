/**
 * The arithmetic of the seek bar and the time display (T7.2.1), apart from the DOM so that it can be tested.
 */

import { barAt, pieceAt, SEEK_SLACK, type Manifest, type PieceEntry } from '../data/manifest.js';

/** `m:ss`, or `h:mm:ss` from an hour. Negative or non-finite values read as 0. */
export function formatTime(seconds: number): string {
	const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0
		? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
		: `${m}:${String(sec).padStart(2, '0')}`;
}

/** The time at a pointer position: `x` pixels from the left of a bar `width` wide, for a recording of `duration`. */
export function timeAtPixel(x: number, width: number, duration: number): number {
	if (!(width > 0) || !(duration > 0)) return 0;
	return Math.min(duration, Math.max(0, (x / width) * duration));
}

/**
 * Snap `t` to the start of a piece when it is within `thresholdPx` pixels of it. `Infinity`-width bars (a test) or a
 * threshold of 0 snap nothing.
 */
export function snapToPieceStart(
	m: Pick<Manifest, 'pieces'>,
	t: number,
	width: number,
	duration: number,
	thresholdPx = 7
): number {
	if (!(width > 0) || !(duration > 0) || thresholdPx <= 0) return t;
	const secondsPerPx = duration / width;
	let best = t;
	let bestD = thresholdPx * secondsPerPx;
	for (const p of m.pieces) {
		const d = Math.abs(p.audio_start - t);
		if (d < bestD) {
			bestD = d;
			best = p.audio_start;
		}
	}
	return best;
}

/** What a tooltip or a screen reader says about a time: the piece, the bar and the clock. */
export interface Describe {
	piece: PieceEntry | null;
	bar: number | null;
	pass: number;
	/** `Contrapunctus VIII · bar 25 · 2:31`, or just the clock in a gap */
	text: string;
	/** seconds into the piece (or into the recording in a gap) */
	into: number;
}

export function describeTime(m: Manifest, t: number): Describe {
	const piece = pieceAt(m, t);
	if (!piece) return { piece: null, bar: null, pass: 1, text: formatTime(t), into: t };
	const b = barAt(piece, t + SEEK_SLACK);
	const into = Math.max(0, t - piece.audio_start);
	const parts = [piece.title];
	if (b) parts.push(`bar ${b.n}`);
	parts.push(formatTime(into));
	return { piece, bar: b?.n ?? null, pass: b?.pass ?? 1, text: parts.join(' · '), into };
}

export interface ClockText {
	/** `2:31` or `−2:32` */
	left: string;
	/** `5:03` */
	right: string;
	/** the time over the whole recording, for a tooltip */
	whole: string;
}

/**
 * The time display: seconds into the piece against its length, or the remaining time of the piece, or in a gap between
 * pieces the position in the recording.
 */
export function clockText(m: Manifest, t: number, remaining: boolean, duration: number): ClockText {
	const piece = pieceAt(m, t);
	const whole = `${formatTime(t)} of ${formatTime(duration)}`;
	if (!piece) return { left: formatTime(t), right: formatTime(duration), whole };
	const len = piece.audio_end - piece.audio_start;
	const into = Math.min(len, Math.max(0, t - piece.audio_start));
	return {
		left: remaining ? `−${formatTime(len - into)}` : formatTime(into),
		right: formatTime(len),
		whole
	};
}

/** Pieces' share of the bar for the tick marks, 0..1, in recording order. */
export function pieceTicks(
	m: Pick<Manifest, 'pieces'>,
	duration: number
): { f: number; title: string; short: string }[] {
	if (!(duration > 0)) return [];
	return [...m.pieces]
		.sort((a, b) => a.audio_start - b.audio_start)
		.map((p) => ({
			f: Math.min(1, p.audio_start / duration),
			title: p.title,
			short: p.short ?? p.title
		}));
}

/** Buffered ranges of a media element as fractions of its duration. */
export function bufferedFractions(
	ranges: { length: number; start(i: number): number; end(i: number): number } | null | undefined,
	duration: number
): [number, number][] {
	const out: [number, number][] = [];
	if (!ranges || !(duration > 0)) return out;
	for (let i = 0; i < ranges.length; i++)
		out.push([Math.max(0, ranges.start(i) / duration), Math.min(1, ranges.end(i) / duration)]);
	return out;
}
