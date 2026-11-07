import { describe, expect, it } from 'vitest';
import { AmbientBudget, isPhone, PHONE_START_LEVEL } from './device.js';
import { LEVELS } from '../visual/governor.js';

describe('isPhone', () => {
	it('is a finger on a small screen', () => {
		expect(isPhone({ coarse: true, shortSide: 390 })).toBe(true);
		expect(isPhone({ coarse: true, shortSide: 820 })).toBe(true);
		expect(isPhone({ coarse: true, shortSide: 1024 })).toBe(false); // a tablet
		expect(isPhone({ coarse: false, shortSide: 390 })).toBe(false); // a narrow desktop window
		expect(isPhone(null)).toBe(false);
	});

	it('starts a phone at a level with the bloom already off and a smaller ambient layer', () => {
		const q = LEVELS[PHONE_START_LEVEL];
		expect(q.bloom).toBe(false);
		expect(q.ambientScale).toBeLessThan(LEVELS[0].ambientScale);
		expect(q.ambientScale).toBeGreaterThan(0); // the ladder has room to take the layer away below it
	});
});

describe('AmbientBudget', () => {
	it('is on from the start where the device is not a phone', () => {
		expect(new AmbientBudget(true).allowed).toBe(true);
	});

	it('comes on after six seconds of a held frame rate, not before', () => {
		const b = new AmbientBudget(false);
		for (let i = 0; i < 11; i++) b.observe(60, 0.5, true);
		expect(b.allowed).toBe(false); // 5.5 s
		b.observe(60, 0.5, true);
		expect(b.allowed).toBe(true); // 6 s
	});

	it('comes on on a 57 Hz display too (the frames cannot be faster than the display)', () => {
		const b = new AmbientBudget(false);
		for (let i = 0; i < 12; i++) b.observe(57, 0.5, true);
		expect(b.allowed).toBe(true);
	});

	it('starts the count again at a slow reading, in a pause and in the middle band', () => {
		const b = new AmbientBudget(false);
		for (let i = 0; i < 10; i++) b.observe(60, 0.5, true);
		b.observe(40, 0.5, true); // a slow half second
		for (let i = 0; i < 10; i++) b.observe(60, 0.5, true);
		expect(b.allowed).toBe(false);
		b.observe(60, 0.5, false); // paused
		for (let i = 0; i < 11; i++) b.observe(60, 0.5, true);
		expect(b.allowed).toBe(false);
		const c = new AmbientBudget(false);
		for (let i = 0; i < 40; i++) c.observe(54, 0.5, true); // between the two marks: neither good nor bad enough
		expect(c.allowed).toBe(false);
	});

	it('stays on once it is on', () => {
		const b = new AmbientBudget(false);
		for (let i = 0; i < 12; i++) b.observe(60, 0.5, true);
		b.observe(10, 0.5, true);
		expect(b.allowed).toBe(true);
	});
});
