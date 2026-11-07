import { parseNotes, type ColumnSpec, type NoteColumns } from './notes.js';
import { setBuild, versioned } from './version.js';

export interface AudioSource {
	type: string;
	src: string;
	bytes: number;
	duration: number;
	/** seconds to add to a time measured on the WAV to get the time in this file */
	offset_s: number;
}

export interface BarTime {
	n: number;
	t: number;
	pass?: number;
	anchored?: boolean;
	/** median confidence of the notes that start in the bar, 0..1 */
	conf?: number | null;
}

export interface PieceEntry {
	id: string;
	order: number;
	title: string;
	short: string;
	kind: string;
	status: 'ok' | 'derived';
	audio_start: number;
	audio_end: number;
	/** seconds after `audio_end` during which the piece still counts as playing (the last piece's ring-out and ending) */
	tail_s?: number;
	repeats_taken: boolean | null;
	variant: 'written' | 'unfolded';
	voices: { voice: number; label: string }[];
	bars: BarTime[];
	n_notes: number;
	notes: string;
	events: string;
	/** mirror pieces only: the counterpart piece and the file with the pitch of each note's counterpart */
	mirror?: { pair: string; file: string; axis_sum: number };
	pdf_pages: number[];
}

export interface Manifest {
	version: 1;
	/** id of this build of the data files (`python -m artfugue.fingerprint`); URLs ask for `?v=<build>` (see `version.ts`) */
	build?: string;
	ppq: number;
	duration: number | null;
	audio: AudioSource[];
	notes_format: ColumnSpec[];
	flags: string[];
	pieces: PieceEntry[];
}

export interface PieceEvent {
	id: string;
	type: string;
	bar: number;
	voice: number | null;
	pass: number;
	t: number;
	t_end: number;
	/** positions in the piece's note chunk of the notes the event is about, ascending */
	notes: number[];
	data: Record<string, unknown>;
}

type Fetch = (input: string) => Promise<Response>;

export async function loadManifest(fetchFn: Fetch = fetch, base = '/data/'): Promise<Manifest> {
	const res = await fetchFn(`${base}manifest.json`);
	if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
	const m = (await res.json()) as Manifest;
	setBuild(m.build);
	return m;
}

/** One piece's notes, fetched lazily. */
export async function loadPieceNotes(
	m: Manifest,
	id: string,
	fetchFn: Fetch = fetch,
	base = '/data/'
): Promise<NoteColumns> {
	const p = m.pieces.find((x) => x.id === id);
	if (!p) throw new Error(`unknown piece ${id}`);
	const res = await fetchFn(versioned(base + p.notes));
	if (!res.ok) throw new Error(`${p.notes}: HTTP ${res.status}`);
	return parseNotes(await res.arrayBuffer(), m.notes_format);
}

export async function loadPieceEvents(
	m: Manifest,
	id: string,
	fetchFn: Fetch = fetch,
	base = '/data/'
): Promise<PieceEvent[]> {
	const p = m.pieces.find((x) => x.id === id);
	if (!p) throw new Error(`unknown piece ${id}`);
	const res = await fetchFn(versioned(base + p.events));
	if (!res.ok) throw new Error(`${p.events}: HTTP ${res.status}`);
	return (await res.json()) as PieceEvent[];
}

/** The pitch of each note's counterpart in the paired mirror piece (0 = none), in the order of the note chunk. */
export async function loadPieceMirror(
	m: Manifest,
	id: string,
	fetchFn: Fetch = fetch,
	base = '/data/'
): Promise<Uint8Array | null> {
	const p = m.pieces.find((x) => x.id === id);
	if (!p) throw new Error(`unknown piece ${id}`);
	if (!p.mirror) return null;
	const res = await fetchFn(versioned(base + p.mirror.file));
	if (!res.ok) throw new Error(`${p.mirror.file}: HTTP ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

/**
 * A seek to a bar or a piece starts a little before it so that the decoder does not clip the first attack (`PREROLL`,
 * 0.08 s). For finding the piece and bar at a time, the next bar and piece therefore begin this much early: a seek to
 * bar 25 reads as bar 25 (and a link made from it as bar 25), not as the end of bar 24.
 */
export const SEEK_SLACK = 0.1;

/**
 * Piece whose audio span contains t (seconds on the WAV timeline), or null in a gap. A piece counts from `SEEK_SLACK`
 * before its start, and where two pieces overlap by that slack (they run into each other) the later one wins.
 */
export function pieceAt(m: Manifest, t: number): PieceEntry | null {
	let best: PieceEntry | null = null;
	for (const p of m.pieces) {
		if (t >= p.audio_start - SEEK_SLACK && t < p.audio_end + (p.tail_s ?? 0)) {
			if (!best || p.audio_start > best.audio_start) best = p;
		}
	}
	return best;
}

/** Bar being played at t (last bar whose start is <= t), or null before the first bar. */
export function barAt(p: PieceEntry, t: number): BarTime | null {
	let lo = 0;
	let hi = p.bars.length - 1;
	if (hi < 0 || t < p.bars[0].t) return null;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (p.bars[mid].t <= t) lo = mid;
		else hi = mid - 1;
	}
	return p.bars[lo];
}
