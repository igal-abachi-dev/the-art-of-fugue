/**
 * Piece/bar addressing and deep links (T3.2.2): `/?p=xii&bar=24` and `/?p=canon-1&bar=9&pass=2`.
 *
 * Slugs are the Roman numeral of the Contrapunctus (`xii`, `xii-inv` for the inverted version) and
 * `canon-<n>`; the data ids (`c12r`, `k1`) are accepted as well. Bar numbers are the printed bar numbers
 * of the engraved score. In the two canons that are played with their repeats (1 and 3) a printed bar is
 * heard twice, so `pass` selects which one (default 1).
 */

import {
	barAt,
	pieceAt,
	SEEK_SLACK,
	type BarTime,
	type Manifest,
	type PieceEntry
} from '../data/manifest.js';

/** Start a little before a bar line so the attack of the first note is not clipped by the decoder. */
export const PREROLL = 0.08;

const ROMAN = [
	'',
	'i',
	'ii',
	'iii',
	'iv',
	'v',
	'vi',
	'vii',
	'viii',
	'ix',
	'x',
	'xi',
	'xii',
	'xiii',
	'xiv'
];

export function pieceSlug(p: Pick<PieceEntry, 'id'>): string {
	const c = /^c(\d+)([ri])?$/.exec(p.id);
	if (c) return ROMAN[Number(c[1])] + (c[2] === 'i' ? '-inv' : '');
	const k = /^k(\d+)$/.exec(p.id);
	if (k) return `canon-${k[1]}`;
	return p.id;
}

export function findPiece(m: Manifest, slugOrId: string): PieceEntry | null {
	const s = slugOrId.trim().toLowerCase();
	return m.pieces.find((p) => p.id === s || pieceSlug(p) === s) ?? null;
}

/** Pieces in the order they are heard on the recording (the manifest `order` is the score's order). */
export function playOrder(m: Manifest): PieceEntry[] {
	return [...m.pieces].sort((a, b) => a.audio_start - b.audio_start);
}

export function findBar(p: PieceEntry, n: number, pass?: number): BarTime | null {
	for (const b of p.bars) {
		if (b.n === n && (pass === undefined || (b.pass ?? 1) === pass)) return b;
	}
	return null;
}

export interface Place {
	piece: PieceEntry;
	bar?: number;
	pass?: number;
}

/** Where to seek (WAV seconds) for a piece, optionally at a bar. Null if the bar does not exist. */
export function seekTime(place: Place): number | null {
	const { piece, bar, pass } = place;
	if (piece.bars.length === 0) return null;
	if (bar === undefined) return Math.max(0, piece.bars[0].t - PREROLL);
	const b = findBar(piece, bar, pass);
	return b ? Math.max(0, b.t - PREROLL) : null;
}

/** Parse the query string of a deep link. Unknown pieces and bars give null. */
export function parseDeepLink(search: string, m: Manifest): Place | null {
	const q = new URLSearchParams(search);
	const slug = q.get('p');
	if (!slug) return null;
	const piece = findPiece(m, slug);
	if (!piece) return null;
	const place: Place = { piece };
	const barStr = q.get('bar');
	if (barStr !== null && /^\d+$/.test(barStr)) {
		const bar = Number(barStr);
		const passStr = q.get('pass');
		const pass = passStr !== null && /^[12]$/.test(passStr) ? Number(passStr) : undefined;
		if (findBar(piece, bar, pass) === null) return { piece };
		place.bar = bar;
		if (pass !== undefined) place.pass = pass;
	}
	return place;
}

/** Query string (with the leading `?`) for a place. `pass` is written only where it matters. */
export function formatDeepLink(place: Place): string {
	const q = new URLSearchParams();
	q.set('p', pieceSlug(place.piece));
	if (place.bar !== undefined) {
		q.set('bar', String(place.bar));
		if (place.pass !== undefined && place.pass > 1) q.set('pass', String(place.pass));
	}
	return `?${q.toString()}`;
}

/** The place being played at time t, for keeping the URL up to date. Null in a gap between pieces. */
export function placeAt(m: Manifest, t: number): Place | null {
	const piece = pieceAt(m, t);
	if (!piece || t >= piece.audio_end) return null;
	// a bar counts from `SEEK_SLACK` early, so that a link made from a seek to a bar names that bar
	const b = barAt(piece, t + SEEK_SLACK);
	if (!b) return { piece };
	const place: Place = { piece, bar: b.n };
	if (b.pass !== undefined && piece.repeats_taken) place.pass = b.pass;
	return place;
}
