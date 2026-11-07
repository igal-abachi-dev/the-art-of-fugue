import { describe, expect, it } from 'vitest';
import type { Manifest, PieceEntry } from '../data/manifest.js';
import { LoopController, MIN_LOOP_S, nearestBar, stepBar, type JumpContext } from './loop.js';

const piece = (id: string, start: number, end: number, barEvery = 3): PieceEntry =>
	({
		id,
		audio_start: start,
		audio_end: end,
		bars: Array.from({ length: Math.floor((end - start) / barEvery) }, (_, i) => ({
			n: i + 1,
			t: start + i * barEvery
		}))
	}) as unknown as PieceEntry;

const m = { pieces: [piece('a', 10, 40), piece('b', 50, 80)] } as unknown as Manifest;

const ctx = (over: Partial<JumpContext> = {}): JumpContext => ({
	pieceStart: 10,
	pieceEnd: 40,
	duration: 100,
	ended: false,
	...over
});

describe('LoopController', () => {
	it('does nothing with no repeat and no loop', () => {
		const c = new LoopController();
		expect(c.check(39.99, ctx())).toBeNull();
		expect(c.check(40.5, ctx({ ended: false }))).toBeNull();
	});

	it('wraps from B to A, in either order of setting, and only when playback reaches B', () => {
		const c = new LoopController();
		expect(c.setRegion(30, 20)).toBe(true);
		expect(c.region).toEqual({ a: 20, b: 30 });
		expect(c.check(29.9, ctx())).toBeNull();
		expect(c.check(30.01, ctx())).toEqual({ to: 20, play: false });
		// a playhead far past B (the listener seeked there) is not playback reaching B
		expect(c.check(35, ctx())).toBeNull();
	});

	it('refuses a loop that is too short, and drops it when the listener seeks outside it', () => {
		const c = new LoopController();
		expect(c.setRegion(20, 20 + MIN_LOOP_S - 0.1)).toBe(false);
		expect(c.region).toBeNull();
		c.setRegion(20, 30);
		expect(c.userSeek(25)).toBe(false);
		expect(c.region).not.toBeNull();
		expect(c.userSeek(31)).toBe(true);
		expect(c.region).toBeNull();
		c.setRegion(20, 30);
		expect(c.userSeek(5)).toBe(true);
	});

	it('repeats the piece at its end, but not when the playhead merely is somewhere else', () => {
		const c = new LoopController();
		c.repeat = 'piece';
		expect(c.check(39.9, ctx())).toBeNull();
		expect(c.check(40.0, ctx())).toEqual({ to: 10, play: false });
		expect(c.check(45, ctx({ pieceStart: null, pieceEnd: null }))).toBeNull();
	});

	it('starts the recording again at its end when asked to repeat all, and plays', () => {
		const c = new LoopController();
		c.repeat = 'all';
		expect(c.check(99.0, ctx())).toBeNull();
		expect(c.check(99.97, ctx())).toEqual({ to: 0, play: false });
		expect(c.check(100, ctx({ ended: true }))).toEqual({ to: 0, play: true });
		c.repeat = 'off';
		expect(c.check(100, ctx({ ended: true }))).toBeNull();
	});

	it('knows when the playhead has left the loop by some other way', () => {
		const c = new LoopController();
		c.setRegion(20, 30);
		expect(c.outside(25)).toBe(false);
		expect(c.outside(19.8)).toBe(false);
		expect(c.outside(30.4)).toBe(false); // just crossed B: the wrap is about to happen
		expect(c.outside(31)).toBe(true);
		expect(c.outside(10)).toBe(true);
		c.clear();
		expect(c.outside(10)).toBe(false);
	});

	it('a loop wins over the end of the recording', () => {
		const c = new LoopController();
		c.repeat = 'all';
		c.setRegion(90, 99);
		expect(c.check(100, ctx({ ended: true }))).toEqual({ to: 90, play: true });
	});
});

describe('bars', () => {
	it('finds the nearest bar line in the piece under the time', () => {
		const b = nearestBar(m, 21.4)!;
		expect([b.piece.id, b.bar, b.t]).toEqual(['a', 5, 22]);
		expect(nearestBar(m, 60.2)!.t).toBe(59);
		expect(nearestBar(m, 45)!.piece.id).toBeDefined(); // in a gap: the nearest
		expect(nearestBar(m, 5000)).toBeNull();
	});

	it('steps to the next bar, and to the start of this bar before the one before', () => {
		expect(stepBar(m, 21.4, 1)!.bar).toBe(5);
		expect(stepBar(m, 21.4, -1)!.bar).toBe(4); // 2.4 s into bar 4: to the start of bar 4
		expect(stepBar(m, 21.0, -1)!.bar).toBe(4);
		expect(stepBar(m, 19.3, -1)!.bar).toBe(3); // 0.3 s into bar 4: the one before
		expect(stepBar(m, 12.0, -1)!.bar).toBe(1); // inside bar 1: back to its start
		expect(stepBar(m, 10.2, -1)).toBeNull(); // at the start of the piece
		expect(stepBar(m, 38.5, 1)).toBeNull(); // the last bar line is behind
		expect(stepBar(m, 45, 1)).toBeNull(); // in a gap
	});
});
