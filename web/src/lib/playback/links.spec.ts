import { describe, expect, it } from 'vitest';
import type { Manifest, PieceEntry } from '../data/manifest.js';
import {
	PREROLL,
	findBar,
	findPiece,
	formatDeepLink,
	parseDeepLink,
	pieceSlug,
	placeAt,
	playOrder,
	seekTime
} from './links.js';

function piece(
	id: string,
	start: number,
	end: number,
	bars: PieceEntry['bars'],
	extra = {}
): PieceEntry {
	return {
		id,
		order: 0,
		title: id,
		short: id,
		kind: 'x',
		status: 'ok',
		audio_start: start,
		audio_end: end,
		repeats_taken: null,
		variant: 'written',
		voices: [],
		bars,
		n_notes: 0,
		notes: '',
		events: '',
		pdf_pages: [],
		...extra
	};
}

const bars = (t0: number, n: number, step = 2) =>
	Array.from({ length: n }, (_, i) => ({ n: i + 1, t: t0 + i * step }));

const m = {
	version: 1,
	ppq: 24,
	duration: 1000,
	audio: [],
	notes_format: [],
	flags: [],
	pieces: [
		piece('c12r', 500, 600, bars(500, 50)),
		piece('c01', 10, 100, bars(10, 40)),
		piece('c12i', 600, 700, bars(600, 50)),
		piece('c13r', 700, 800, [{ n: 0, t: 700 }, ...bars(702, 40)]),
		piece(
			'k1',
			800,
			900,
			[
				...Array.from({ length: 8 }, (_, i) => ({ n: i + 1, t: 800 + i * 2, pass: 1 })),
				...Array.from({ length: 4 }, (_, i) => ({ n: i + 5, t: 816 + i * 2, pass: 2 })),
				{ n: 9, t: 824, pass: 1 }
			],
			{ repeats_taken: true }
		)
	]
} as unknown as Manifest;

describe('slugs', () => {
	it('maps ids to Roman numerals, -inv and canon-n', () => {
		expect(pieceSlug({ id: 'c01' })).toBe('i');
		expect(pieceSlug({ id: 'c12r' })).toBe('xii');
		expect(pieceSlug({ id: 'c12i' })).toBe('xii-inv');
		expect(pieceSlug({ id: 'c13i' })).toBe('xiii-inv');
		expect(pieceSlug({ id: 'c14' })).toBe('xiv');
		expect(pieceSlug({ id: 'k3' })).toBe('canon-3');
	});

	it('finds a piece by slug or by id, case-insensitively', () => {
		expect(findPiece(m, 'xii')?.id).toBe('c12r');
		expect(findPiece(m, 'XII-INV')?.id).toBe('c12i');
		expect(findPiece(m, 'c12i')?.id).toBe('c12i');
		expect(findPiece(m, 'nope')).toBeNull();
	});

	it('lists pieces in the order of the recording, not of the manifest', () => {
		expect(playOrder(m).map((p) => p.id)).toEqual(['c01', 'c12r', 'c12i', 'c13r', 'k1']);
	});
});

describe('deep links', () => {
	it('parses /?p=xii&bar=24', () => {
		const pl = parseDeepLink('?p=xii&bar=24', m);
		expect(pl?.piece.id).toBe('c12r');
		expect(pl?.bar).toBe(24);
		expect(seekTime(pl!)).toBeCloseTo(500 + 23 * 2 - PREROLL, 6);
	});

	it('falls back to the piece when the bar does not exist, and to null for an unknown piece', () => {
		expect(parseDeepLink('?p=xii&bar=999', m)).toEqual({ piece: m.pieces[0] });
		expect(parseDeepLink('?p=zz', m)).toBeNull();
		expect(parseDeepLink('?bar=3', m)).toBeNull();
		expect(parseDeepLink('?p=xii&bar=abc', m)).toEqual({ piece: m.pieces[0] });
	});

	it('addresses the first and second pass of a repeated bar', () => {
		expect(findBar(m.pieces[4], 5)?.t).toBe(808);
		expect(findBar(m.pieces[4], 5, 2)?.t).toBe(816);
		expect(findBar(m.pieces[4], 9)?.t).toBe(824);
		const pl = parseDeepLink('?p=canon-1&bar=6&pass=2', m);
		expect(seekTime(pl!)).toBeCloseTo(818 - PREROLL, 6);
	});

	it('round-trips: format then parse gives the same place', () => {
		for (const q of ['?p=i', '?p=xii-inv&bar=7', '?p=canon-1&bar=6&pass=2', '?p=xiii&bar=0']) {
			const pl = parseDeepLink(q, m)!;
			expect(formatDeepLink(pl)).toBe(q);
		}
	});

	it('a link made from a seek to a bar names that bar, so links do not drift back a bar on every reload', () => {
		const m = {
			pieces: [
				piece(
					'c01',
					0,
					60,
					[1, 2, 3, 4].map((n) => ({ n, t: 10 * n }))
				)
			]
		} as unknown as Manifest;
		const first = seekTime({ piece: m.pieces[0], bar: 3 })!;
		expect(first).toBeCloseTo(30 - PREROLL, 6);
		const place = placeAt(m, first)!;
		expect(place.bar).toBe(3);
		expect(formatDeepLink(place)).toBe('?p=i&bar=3');
		// and again from that link: the same bar, the same time
		const again = parseDeepLink(formatDeepLink(place), m)!;
		expect(seekTime(again)).toBe(first);
	});

	it('starts a piece slightly before its first bar and never before zero', () => {
		expect(seekTime({ piece: m.pieces[1] })).toBeCloseTo(10 - PREROLL, 6);
		expect(seekTime({ piece: piece('z', 0, 5, bars(0.02, 3)) })).toBe(0);
	});

	it('knows which place a time belongs to, with the pass for repeated pieces', () => {
		expect(placeAt(m, 55)?.piece.id).toBe('c01');
		expect(placeAt(m, 55)?.bar).toBe(23);
		expect(placeAt(m, 450)).toBeNull();
		const k = placeAt(m, 817);
		expect(k?.piece.id).toBe('k1');
		expect(k?.bar).toBe(5);
		expect(k?.pass).toBe(2);
	});
});
