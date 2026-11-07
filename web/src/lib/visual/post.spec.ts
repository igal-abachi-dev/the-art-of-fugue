import { describe, expect, it } from 'vitest';
import { bloomStrength, MIN_STRENGTH } from './post.js';

describe('bloomStrength', () => {
	it('is zero when the scene has no bloom, whatever the sound', () => {
		for (const e of [0, 0.5, 1]) expect(bloomStrength(0, e)).toBe(0);
	});

	it('always glows a little in a scene that has bloom, and more as the sound gets louder', () => {
		const quiet = bloomStrength(0.5, 0);
		expect(quiet).toBeGreaterThan(MIN_STRENGTH); // not skipped when silent: the notes keep a faint glow
		let prev = quiet;
		for (let e = 0.1; e <= 1.0001; e += 0.1) {
			const s = bloomStrength(0.5, e);
			expect(s).toBeGreaterThanOrEqual(prev);
			prev = s;
		}
		expect(bloomStrength(0.5, 1)).toBeGreaterThan(quiet * 2);
	});

	it('scales with the scene and stays bounded for any input', () => {
		expect(bloomStrength(1, 1)).toBeGreaterThan(bloomStrength(0.25, 1));
		for (const [s, e] of [
			[5, 5],
			[-1, 0.5],
			[1, -3]
		] as const) {
			const v = bloomStrength(s, e);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});

	it('is low enough in the quietest scene (the plain fugues) to be skipped at silence', () => {
		expect(bloomStrength(0.1, 0)).toBeLessThan(MIN_STRENGTH * 2);
	});
});
