import { describe, expect, it } from 'vitest';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import { emptyTags } from '../scenes/tags.js';
import {
	BLACK_AFTER_S,
	createEndingState,
	endingOf,
	endingState,
	FLIP_S,
	FlipAnim,
	FREEZE_S,
	gatherLinks,
	IDLE_GAP_S,
	IdleDrift,
	LINK_CAP,
	LINK_STRIDE,
	mirrorAxis,
	planEnding,
	SHATTER_LIFE_S,
	shatter
} from './effects.js';
import { pitchToX } from './keyboard.js';
import { ParticlePool } from './particles.js';

function columns(on: number[], off: number[], pitch: number[], voice: number[] = []): NoteColumns {
	const n = on.length;
	return {
		n,
		t_on: Float32Array.from(on),
		t_off: Float32Array.from(off),
		tick: new Uint32Array(n),
		pitch: Uint8Array.from(pitch),
		voice: Uint8Array.from(voice.length ? voice : on.map(() => 1)),
		vel: new Uint8Array(n).fill(90),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
}

describe('the ending', () => {
	const plan = planEnding(100);

	it('freezes at the last onset, shatters after the freeze and is black after the fade', () => {
		expect(plan.freezeAt).toBe(100);
		expect(plan.shatterAt).toBeCloseTo(100 + FREEZE_S, 6);
		expect(plan.blackAt).toBeCloseTo(plan.shatterAt + BLACK_AFTER_S, 6);
	});

	it('is a pure function of the playhead: the same time gives the same state, forwards or backwards', () => {
		const a = endingState(plan, 103, createEndingState());
		endingState(plan, 90, createEndingState());
		const b = endingState(plan, 103, createEndingState());
		expect(a).toEqual(b);
	});

	it('holds the notes from the freeze on, keeps them until the shatter, then fades them and the rest', () => {
		const s = createEndingState();
		expect(endingState(plan, 50, s)).toEqual({ hold: 100, notes: 1, dim: 1 });
		expect(endingState(plan, plan.shatterAt - 0.01, s).notes).toBe(1);
		expect(endingState(plan, plan.shatterAt + 0.3, s).notes).toBeLessThan(0.01);
		expect(endingState(plan, plan.shatterAt + 0.3, s).dim).toBe(1);
		const mid = endingState(plan, (plan.shatterAt + plan.blackAt) / 2, s).dim;
		expect(mid).toBeGreaterThan(0.1);
		expect(mid).toBeLessThan(0.9);
		expect(endingState(plan, plan.blackAt, s).dim).toBe(0);
		expect(endingState(plan, plan.blackAt + 100, s).dim).toBe(0);
	});

	it('does nothing without a plan', () => {
		expect(endingState(null, 5, createEndingState())).toEqual({ hold: 1e9, notes: 1, dim: 1 });
	});

	it('takes the freeze from the onset of the last note of a piece', () => {
		const win = new NoteWindow(columns([1, 2, 7.5], [2, 3, 9], [60, 62, 64]));
		expect(endingOf(win)!.freezeAt).toBeCloseTo(7.5, 5);
		expect(endingOf(new NoteWindow(columns([], [], [])))).toBeNull();
	});
});

describe('shatter', () => {
	const win = new NoteWindow(columns([1, 5, 9], [2, 12, 12], [60, 62, 64], [1, 2, 3]));
	const plan = planEnding(9);

	it('bursts from the notes that stand frozen, born at the shatter time', () => {
		const pool = new ParticlePool(4096);
		const made = shatter(win, plan, pool, 1);
		expect(made).toBeGreaterThan(100); // two notes are sounding at the freeze
		for (let i = 0; i < made; i++) {
			expect(pool.a[i * 4 + 1]).toBeCloseTo(plan.shatterAt, 5);
			expect(pool.a[i * 4 + 2]).toBeLessThanOrEqual(SHATTER_LIFE_S);
		}
		const voices = new Set(Array.from({ length: made }, (_, i) => pool.b[i * 4]));
		expect([...voices].sort()).toEqual([2, 3]);
	});

	it('is exactly repeatable and respects the particle budget', () => {
		const a = new ParticlePool(4096);
		const b = new ParticlePool(4096);
		shatter(win, plan, a, 1);
		shatter(win, plan, b, 1);
		expect(a.a).toEqual(b.a);
		expect(a.b).toEqual(b.b);
		const none = new ParticlePool(4096);
		none.setCap(0);
		expect(shatter(win, plan, none, 1)).toBe(0);
		expect(shatter(win, plan, new ParticlePool(64), 0)).toBe(0);
	});
});

describe('FlipAnim', () => {
	it('starts mirrored, turns over through zero and settles as written', () => {
		const f = new FlipAnim();
		expect(f.update(1)).toBe(1);
		f.start();
		expect(f.running).toBe(true);
		expect(f.update(0)).toBeCloseTo(-1, 6);
		const mid = f.update(FLIP_S / 2);
		expect(Math.abs(mid)).toBeLessThan(1e-6);
		expect(f.update(FLIP_S)).toBeCloseTo(1, 6);
		expect(f.running).toBe(false);
		expect(f.update(1)).toBe(1);
	});

	it('can be cancelled, and ignores negative steps', () => {
		const f = new FlipAnim();
		f.start();
		f.update(-5);
		expect(f.update(0)).toBeCloseTo(-1, 6);
		f.cancel();
		expect(f.update(0.1)).toBe(1);
	});
});

describe('mirrorAxis', () => {
	it('puts the axis between the two keys of an odd pitch sum', () => {
		const a = mirrorAxis(119);
		expect(a.pitch).toBe(59.5);
		expect(a.x).toBeCloseTo((pitchToX(59) + pitchToX(60)) / 2, 6);
		expect(mirrorAxis(120).x).toBeCloseTo(pitchToX(60), 6);
	});
});

describe('IdleDrift', () => {
	it('lets a few embers rise, at a steady slow rate', () => {
		const pool = new ParticlePool(4096);
		const d = new IdleDrift();
		let made = 0;
		for (let t = 0; t < 10; t += 1 / 60) made += d.step(t, 1 / 60, pool, 1);
		expect(made).toBeGreaterThanOrEqual(Math.floor(10 / IDLE_GAP_S) - 1);
		expect(made).toBeLessThanOrEqual(Math.ceil(10 / IDLE_GAP_S));
	});

	it('is quiet when off, paused, stalled or without a pool', () => {
		const d = new IdleDrift();
		const pool = new ParticlePool(64);
		expect(d.step(1, 1 / 60, pool, 0)).toBe(0);
		expect(d.step(1, 0, pool, 1)).toBe(0);
		expect(d.step(1, 5, pool, 1)).toBe(0);
		pool.setCap(0);
		expect(d.step(1, 1 / 60, pool, 1)).toBe(0);
	});
});

describe('gatherLinks', () => {
	// leader notes 0..3 at t = 0..3, followers 4..7 echo them 10 s later
	const win = new NoteWindow(
		columns(
			[0, 1, 2, 3, 10, 11, 12, 13],
			[1, 2, 3, 4, 11, 12, 13, 14],
			[60, 62, 64, 65, 48, 50, 52, 53],
			[1, 1, 1, 1, 2, 2, 2, 2]
		)
	);
	const tags = emptyTags(8);
	for (let i = 0; i < 4; i++) tags.leader[4 + i] = i;
	const from = new Float32Array(LINK_CAP * LINK_STRIDE);
	const to = new Float32Array(LINK_CAP * LINK_STRIDE);

	it('links each follower about to begin to the leader that already did, nearest first', () => {
		const n = gatherLinks(win, tags, 8, 4, from, to); // followers at 10, 11, 12 are within 4 s
		expect(n).toBe(3);
		expect(from[2]).toBe(60); // the leader's pitch
		expect(to[2]).toBe(48);
		expect(to[3]).toBe(10);
		expect(from[LINK_STRIDE + 3]).toBe(1);
		expect(to[LINK_STRIDE + 3]).toBe(11);
		expect(from[0]).toBeCloseTo(pitchToX(60), 5);
	});

	it('has none before the leader began, none for notes beyond the window, none when nothing is tagged', () => {
		const late = emptyTags(8);
		late.leader[4] = 3; // its leader begins at 3
		late.leader[5] = 1;
		expect(gatherLinks(win, late, 2, 9, from, to)).toBe(1); // only the follower whose leader has begun by t = 2
		expect(to[3]).toBe(11);
		expect(gatherLinks(win, tags, 8, 0.5, from, to)).toBe(0);
		expect(gatherLinks(win, emptyTags(8), 8, 4, from, to)).toBe(0);
	});
});
