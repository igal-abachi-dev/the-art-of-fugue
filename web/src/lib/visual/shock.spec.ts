import { describe, expect, it } from 'vitest';
import { KIND_CLASH, KIND_CROSSING, MIN_GAP_S, SHOCK_CAP, ShockPool } from './shock.js';

describe('ShockPool', () => {
	it('starts empty: every ring is far in the past', () => {
		const p = new ShockPool();
		expect(p.alive(100)).toBe(0);
	});

	it('refuses a ring that comes too soon after the last, and accepts it later', () => {
		const p = new ShockPool();
		expect(p.emit(10, 0, 60, 1, 1, KIND_CLASH)).toBe(true);
		expect(p.emit(10 + MIN_GAP_S * 0.5, 0, 60, 1, 1, KIND_CLASH)).toBe(false);
		expect(p.emit(10 + MIN_GAP_S + 0.01, 0, 60, 1, 1, KIND_CROSSING)).toBe(true);
		expect(p.emitted).toBe(2);
		expect(p.refused).toBe(1);
	});

	it('never exceeds three rings in any second, however many events arrive', () => {
		const p = new ShockPool();
		const births: number[] = [];
		for (let t = 0; t < 30; t += 0.01) if (p.emit(t, 0, 60, 1, 1, KIND_CLASH)) births.push(t);
		for (let i = 0; i + 3 < births.length; i++)
			expect(births[i + 3] - births[i]).toBeGreaterThan(1);
	});

	it('keeps at most SHOCK_CAP rings, reusing the oldest slot', () => {
		const p = new ShockPool();
		for (let i = 0; i < SHOCK_CAP + 5; i++) p.emit(i * 5, i, 60, 1, 1, KIND_CLASH);
		const births = Array.from({ length: SHOCK_CAP }, (_, i) => p.a[i * 4 + 1]).sort(
			(a, b) => a - b
		);
		expect(births[0]).toBe(5 * 5);
		expect(births[SHOCK_CAP - 1]).toBe((SHOCK_CAP + 4) * 5);
	});

	it('accepts a ring after the playhead went back (a seek), where the cap is measured from the new time', () => {
		const p = new ShockPool();
		p.emit(100, 0, 60, 1, 1, KIND_CLASH);
		expect(p.emit(20, 0, 60, 1, 1, KIND_CLASH)).toBe(true);
		p.clear();
		expect(p.alive(100)).toBe(0);
		expect(p.emitted).toBe(0);
	});

	it('clamps the strength', () => {
		const p = new ShockPool();
		p.emit(1, 0, 60, 1, 7, KIND_CLASH);
		expect(p.a[2]).toBe(1);
	});
});
