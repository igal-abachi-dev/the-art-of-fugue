import { describe, expect, it } from 'vitest';
import { CHORD_MAX_S, CHORD_PULL, playTimes } from './times.js';

const cols = (rows: [t: number, tick: number, pass?: number][]) => ({
	n: rows.length,
	t_on: Float32Array.from(rows.map((r) => r[0])),
	tick: Uint32Array.from(rows.map((r) => r[1])),
	pass: Uint8Array.from(rows.map((r) => r[2] ?? 1))
});

describe('playTimes', () => {
	it('pulls the notes of one tick toward their median, most of the way', () => {
		const t = playTimes(
			cols([
				[10.0, 24],
				[10.03, 24],
				[10.06, 24]
			])
		);
		expect(t[1]).toBeCloseTo(10.03, 5); // the median stays
		expect(t[0]).toBeCloseTo(10.0 + CHORD_PULL * 0.03, 5);
		expect(t[2]).toBeCloseTo(10.06 - CHORD_PULL * 0.03, 5);
		expect(t[2] - t[0]).toBeLessThan(0.02);
	});

	it('leaves single notes and notes of different ticks alone', () => {
		const t = playTimes(
			cols([
				[10.0, 24],
				[10.5, 36],
				[11.0, 48]
			])
		);
		expect(Array.from(t)).toEqual([10.0, 10.5, 11.0].map((x) => Math.fround(x)));
	});

	it('leaves a group wider than a chord (an arpeggio, a doubtful alignment) as it is', () => {
		const t = playTimes(
			cols([
				[10.0, 24],
				[10.0 + CHORD_MAX_S + 0.01, 24]
			])
		);
		expect(t[0]).toBeCloseTo(10.0, 5);
		expect(t[1]).toBeCloseTo(10.0 + CHORD_MAX_S + 0.01, 5);
	});

	it('keeps the two passes of a repeat apart even where they share a tick', () => {
		const t = playTimes(
			cols([
				[10.0, 24, 1],
				[70.0, 24, 2]
			])
		);
		expect(t[0]).toBeCloseTo(10, 5);
		expect(t[1]).toBeCloseTo(70, 5);
	});

	it('is computed once per set of notes', () => {
		const c = cols([
			[1, 1],
			[1.02, 1]
		]);
		expect(playTimes(c)).toBe(playTimes(c));
	});
});
