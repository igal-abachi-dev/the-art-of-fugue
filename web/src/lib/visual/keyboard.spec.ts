import { describe, expect, it } from 'vitest';
import {
	BLACK_WIDTH,
	HALF_WIDTH,
	isBlack,
	KEY_COUNT,
	KEY_FIRST,
	KEY_LAST,
	KEYS,
	keyIndex,
	pitchToX,
	pitchWidth,
	WHITE_COUNT
} from './keyboard.js';

describe('keyboard geometry', () => {
	it('has 88 keys: 52 white and 36 black, from A0 to C8', () => {
		expect(KEY_COUNT).toBe(88);
		expect(KEY_FIRST).toBe(21);
		expect(KEY_LAST).toBe(108);
		const black = KEYS.black.reduce((a, b) => a + b, 0);
		expect(black).toBe(36);
		expect(KEY_COUNT - black).toBe(WHITE_COUNT);
	});

	it('knows which pitch classes are black (known pitches)', () => {
		expect(isBlack(21)).toBe(false); // A0
		expect(isBlack(22)).toBe(true); // A#0
		expect(isBlack(60)).toBe(false); // C4
		expect(isBlack(61)).toBe(true); // C#4
		expect(isBlack(66)).toBe(true); // F#4
		expect(isBlack(64)).toBe(false); // E4
		expect(isBlack(65)).toBe(false); // F4
		expect(isBlack(108)).toBe(false); // C8
	});

	it('places the white keys one unit apart, filling [-26, 26]', () => {
		const whites: number[] = [];
		for (let m = KEY_FIRST; m <= KEY_LAST; m++) if (!isBlack(m)) whites.push(pitchToX(m));
		expect(whites).toHaveLength(52);
		expect(whites[0]).toBeCloseTo(-HALF_WIDTH + 0.5, 6);
		expect(whites[51]).toBeCloseTo(HALF_WIDTH - 0.5, 6);
		for (let i = 1; i < whites.length; i++) expect(whites[i] - whites[i - 1]).toBeCloseTo(1, 6);
	});

	it('puts middle C one octave-and-a-bit from the middle: C4 is the 24th white key', () => {
		// white keys before C4: A0 B0 + 3 octaves (C1..B3) of 7 = 2 + 21 = 23
		expect(pitchToX(60)).toBeCloseTo(23 + 0.5 - 26, 6);
	});

	it('increases strictly with pitch (so lines never swap places)', () => {
		for (let m = KEY_FIRST + 1; m <= KEY_LAST; m++) {
			expect(pitchToX(m)).toBeGreaterThan(pitchToX(m - 1));
		}
	});

	it('sits every black key between its two white neighbours, near the boundary', () => {
		for (let m = KEY_FIRST; m <= KEY_LAST; m++) {
			if (!isBlack(m)) continue;
			const lo = pitchToX(m - 1);
			const hi = pitchToX(m + 1);
			expect(pitchToX(m)).toBeGreaterThan(lo);
			expect(pitchToX(m)).toBeLessThan(hi);
			expect(Math.abs(pitchToX(m) - (lo + 0.5))).toBeLessThanOrEqual(0.15);
			expect(pitchWidth(m)).toBeCloseTo(BLACK_WIDTH, 5);
		}
	});

	it('draws no two white keys overlapping, and no two black keys overlapping', () => {
		for (const kind of [0, 1]) {
			let prev = -Infinity;
			for (let i = 0; i < KEY_COUNT; i++) {
				if (KEYS.black[i] !== kind) continue;
				const left = KEYS.x[i] - KEYS.width[i] / 2;
				expect(left).toBeGreaterThanOrEqual(prev - 1e-6);
				prev = KEYS.x[i] + KEYS.width[i] / 2;
			}
		}
	});

	it('clamps pitches outside the keyboard instead of failing', () => {
		expect(keyIndex(0)).toBe(0);
		expect(keyIndex(200)).toBe(87);
		expect(pitchToX(0)).toBe(pitchToX(21));
	});
});
