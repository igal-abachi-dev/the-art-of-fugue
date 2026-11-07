import { describe, expect, it } from 'vitest';
import { impulseResponse } from './reverb.js';

describe('impulseResponse', () => {
	const sr = 8000;
	const [l, r] = impulseResponse(sr, 1.5);
	const rms = (a: Float32Array, from: number, to: number) => {
		let s = 0;
		for (let i = from; i < to; i++) s += a[i] * a[i];
		return Math.sqrt(s / (to - from));
	};

	it('is a little longer than the reverb time, unit in energy, and the same every time', () => {
		expect(l.length).toBe(Math.round(sr * 1.5 * 1.1));
		expect(rms(l, 0, l.length) ** 2 * l.length).toBeCloseTo(1, 4);
		expect(Array.from(impulseResponse(sr, 1.5)[0].slice(0, 50))).toEqual(
			Array.from(l.slice(0, 50))
		);
	});

	it('has two channels that are not the same noise', () => {
		expect(Array.from(l.slice(100, 120))).not.toEqual(Array.from(r.slice(100, 120)));
	});

	it('falls about 60 dB in the reverb time and starts without a click', () => {
		const early = rms(l, Math.round(sr * 0.05), Math.round(sr * 0.15));
		const late = rms(l, Math.round(sr * 1.4), Math.round(sr * 1.5));
		const db = 20 * Math.log10(late / early);
		expect(db).toBeLessThan(-45);
		expect(db).toBeGreaterThan(-75);
		expect(Math.abs(l[0])).toBeLessThan(0.01 * Math.max(...l.slice(0, 400).map(Math.abs)));
	});
});
