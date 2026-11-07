import { describe, expect, it } from 'vitest';
import { loadRegistration, parseRegistration, rankLookup } from './registration.js';

const doc = parseRegistration({
	version: 1,
	pieces: {
		c01: {
			'1': [
				[10, 20, 'flute'],
				[20, 40, 'full'],
				[40, 99, 'flute']
			],
			'2': [[12, 99, 'full']]
		}
	}
});

describe('rankLookup', () => {
	const rank = rankLookup(doc, 'c01');

	it('reads the rank of a voice at a time from its segments, a segment beginning where it says', () => {
		expect(rank(1, 10)).toBe(0);
		expect(rank(1, 19.99)).toBe(0);
		expect(rank(1, 20)).toBe(1);
		expect(rank(1, 39.9)).toBe(1);
		expect(rank(1, 40)).toBe(0);
		expect(rank(1, 70)).toBe(0);
	});

	it('keeps the voices apart: each has its own score', () => {
		expect(rank(1, 15)).toBe(0);
		expect(rank(2, 15)).toBe(1);
	});

	it('is the full rank, the main voice, before a voice begins and for a voice, a piece or a score it has not got', () => {
		expect(rank(1, 3)).toBe(1);
		expect(rank(3, 15)).toBe(1);
		expect(rankLookup(doc, 'c99')(1, 15)).toBe(1);
		expect(rankLookup(parseRegistration(null), 'c01')(1, 15)).toBe(1);
	});
});

describe('parseRegistration', () => {
	it('drops what is not a segment, or is out of order, and keeps the rest', () => {
		const d = parseRegistration({
			pieces: {
				c01: {
					'1': [
						[0, 5, 'flute'],
						[4, 9, 'full'], // begins before the one before it ended: kept (the lookup goes by beginnings)
						[3, 2, 'full'], // ends before it begins
						[10, 12, 'oboe'], // not a rank
						'x',
						[1, 2, 'full'] // begins before the one before it
					],
					'2': 'not a list'
				},
				c02: null
			}
		});
		expect(d.pieces.c01['1']).toEqual([
			[0, 5, 'flute'],
			[4, 9, 'full']
		]);
		expect(d.pieces.c01['2']).toBeUndefined();
		expect(d.pieces.c02).toBeUndefined();
	});
});

describe('loadRegistration', () => {
	it('fetches the score once and parses it', async () => {
		const asked: string[] = [];
		const d = await loadRegistration((u) => {
			asked.push(u);
			return Promise.resolve(
				Response.json({ version: 1, pieces: { c01: { '1': [[0, 9, 'flute']] } } })
			);
		});
		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain('/data/organ-registration.json');
		expect(rankLookup(d, 'c01')(1, 4)).toBe(0);
	});

	it('fails when there is no score', async () => {
		await expect(
			loadRegistration(() => Promise.resolve(new Response('', { status: 404 })))
		).rejects.toThrow(/organ-registration/);
	});
});
