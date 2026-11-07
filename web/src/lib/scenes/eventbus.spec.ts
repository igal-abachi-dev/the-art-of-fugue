import { describe, expect, it } from 'vitest';
import type { PieceEvent } from '../data/manifest.js';
import { EventBus, MAX_STEP_S } from './eventbus.js';

const ev = (id: string, type: string, t: number): PieceEvent => ({
	id,
	type,
	bar: 1,
	voice: null,
	pass: 1,
	t,
	t_end: t + 1,
	notes: [],
	data: {}
});

const EVENTS = [
	ev('a', 'subject-entry', 1.0),
	ev('b', 'clash', 1.2),
	ev('c', 'bach', 3.0),
	ev('d', 'clash', 3.0),
	ev('e', 'subject-entry', 10.0)
];

/** play from `from` to `to` in frames of `dt`, returning the ids that fired in order */
function play(bus: EventBus, from: number, to: number, dt = 1 / 60, jump = false): string[] {
	const got: string[] = [];
	bus.on('*', (e) => got.push(e.id));
	bus.step(from, jump);
	for (let t = from + dt; t <= to + 1e-9; t += dt) bus.step(t, false);
	return got;
}

describe('EventBus', () => {
	it('fires every event once, in time order, whatever order they were given in', () => {
		const bus = new EventBus([...EVENTS].reverse());
		const got = play(bus, 0, 11);
		expect(got.slice(0, 2)).toEqual(['a', 'b']);
		expect(got.slice(2, 4).sort()).toEqual(['c', 'd']); // the two at 3.0 are simultaneous
		expect(got[4]).toBe('e');
		expect(bus.fired).toBe(5);
	});

	it('routes by type, with a wildcard, and listeners can be removed', () => {
		const bus = new EventBus(EVENTS);
		const clash: string[] = [];
		const off = bus.on('clash', (e) => clash.push(e.id));
		play(bus, 0, 2);
		expect(clash).toEqual(['b']);
		off();
		bus.step(2.9, false);
		bus.step(3.1, true);
		bus.step(3.2, false);
		expect(clash).toEqual(['b']);
	});

	it('does not fire what a seek jumps over, nor replay what came before', () => {
		const bus = new EventBus(EVENTS);
		const got: string[] = [];
		bus.on('*', (e) => got.push(e.id));
		bus.step(0, false);
		bus.step(0.4, false);
		bus.step(5.0, true); // seek forward over a, b, c, d
		expect(got).toEqual([]);
		bus.step(5.01, false);
		bus.step(0.9, true); // seek back: a and b are upcoming again, c and d are not
		for (let t = 0.9; t < 2; t += 1 / 60) bus.step(t, false);
		expect(got).toEqual(['a', 'b']);
		got.length = 0;
		bus.step(9.9, true);
		bus.step(10.05, false);
		expect(got).toEqual(['e']);
	});

	it('fires an event exactly at the landing time of a seek, once', () => {
		const bus = new EventBus(EVENTS);
		const got: string[] = [];
		bus.on('*', (e) => got.push(e.id));
		bus.step(1.0, true);
		bus.step(1.0, false); // paused on it: still nothing happens twice
		bus.step(1.016, false);
		bus.step(1.032, false);
		expect(got).toEqual(['a']);
	});

	it('stays quiet while paused, and treats a long stall like a jump', () => {
		const bus = new EventBus(EVENTS);
		const got: string[] = [];
		bus.on('*', (e) => got.push(e.id));
		bus.step(0.9, false);
		for (let i = 0; i < 100; i++) bus.step(0.9, false);
		expect(got).toEqual([]);
		bus.step(0.9 + MAX_STEP_S + 0.5, false); // the tab was hidden over a and b
		bus.step(1.5, false);
		expect(got).toEqual([]);
		bus.step(3.0, false); // 1.5 s step: also a stall
		expect(got).toEqual([]);
	});

	it('fires the same events at any frame rate and playback rate', () => {
		for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.2]) {
			const got = play(new EventBus(EVENTS), 0.5, 3.5, dt);
			expect(got, `dt ${dt}`).toEqual(['a', 'b', 'c', 'd']);
		}
	});

	it('does not allocate or fail with no events', () => {
		const bus = new EventBus([]);
		expect(bus.step(1, false)).toBe(0);
		expect(bus.step(1.1, false)).toBe(0);
	});
});
