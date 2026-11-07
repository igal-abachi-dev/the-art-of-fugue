import { describe, expect, it } from 'vitest';
import type { Manifest, PieceEntry } from '../data/manifest.js';
import {
	bufferedFractions,
	clockText,
	describeTime,
	formatTime,
	pieceTicks,
	snapToPieceStart,
	timeAtPixel
} from './seekmath.js';

const p = (id: string, title: string, start: number, end: number): PieceEntry =>
	({
		id,
		title,
		audio_start: start,
		audio_end: end,
		bars: [
			{ n: 1, t: start + 1 },
			{ n: 2, t: start + 5 },
			{ n: 3, t: start + 9 }
		]
	}) as unknown as PieceEntry;
const m = {
	pieces: [p('b', 'Two', 200, 300), p('a', 'One', 20, 120)]
} as unknown as Manifest;

describe('formatTime', () => {
	it('writes minutes and seconds, and hours from an hour', () => {
		expect(formatTime(0)).toBe('0:00');
		expect(formatTime(59.9)).toBe('0:59');
		expect(formatTime(151)).toBe('2:31');
		expect(formatTime(3600)).toBe('1:00:00');
		expect(formatTime(4825.4)).toBe('1:20:25');
		expect(formatTime(-3)).toBe('0:00');
		expect(formatTime(Number.NaN)).toBe('0:00');
	});
});

describe('pointer to time', () => {
	it('maps pixels onto the recording and stays inside it', () => {
		expect(timeAtPixel(500, 1000, 4800)).toBe(2400);
		expect(timeAtPixel(-40, 1000, 4800)).toBe(0);
		expect(timeAtPixel(1400, 1000, 4800)).toBe(4800);
		expect(timeAtPixel(5, 0, 4800)).toBe(0);
	});

	it('snaps to the start of a piece within a few pixels, and only there', () => {
		// 1000 px for 1000 s: one pixel a second
		expect(snapToPieceStart(m, 23, 1000, 1000)).toBe(20);
		expect(snapToPieceStart(m, 195, 1000, 1000)).toBe(200);
		expect(snapToPieceStart(m, 30, 1000, 1000)).toBe(30);
		expect(snapToPieceStart(m, 23, 1000, 1000, 0)).toBe(23);
		// a wider bar means fewer seconds a pixel, so the snap reaches less far
		expect(snapToPieceStart(m, 23, 4000, 1000)).toBe(23);
	});
});

describe('describeTime and clockText', () => {
	it('names the piece, the bar and the time into the piece', () => {
		const d = describeTime(m, 26);
		expect(d.piece?.id).toBe('a');
		expect(d.bar).toBe(2);
		expect(d.text).toBe('One · bar 2 · 0:06');
		expect(describeTime(m, 150).piece).toBeNull();
		expect(describeTime(m, 150).text).toBe('2:30');
	});

	it('shows time into the piece against its length, or what remains', () => {
		expect(clockText(m, 50, false, 400)).toMatchObject({ left: '0:30', right: '1:40' });
		expect(clockText(m, 50, true, 400)).toMatchObject({ left: '−1:10', right: '1:40' });
		expect(clockText(m, 150, false, 400)).toMatchObject({ left: '2:30', right: '6:40' });
		expect(clockText(m, 50, false, 400).whole).toBe('0:50 of 6:40');
	});
});

describe('pieceTicks and bufferedFractions', () => {
	it('puts the pieces in recording order along the bar', () => {
		const t = pieceTicks(m, 400);
		expect(t.map((x) => x.title)).toEqual(['One', 'Two']);
		expect(t[0].f).toBeCloseTo(0.05, 9);
		expect(pieceTicks(m, 0)).toEqual([]);
	});

	it('reads the buffered ranges as fractions', () => {
		const ranges = {
			length: 2,
			start: (i: number) => [0, 200][i],
			end: (i: number) => [100, 500][i]
		};
		expect(bufferedFractions(ranges, 400)).toEqual([
			[0, 0.25],
			[0.5, 1]
		]);
		expect(bufferedFractions(null, 400)).toEqual([]);
	});
});
