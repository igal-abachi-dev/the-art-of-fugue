import { describe, expect, it } from 'vitest';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import { keyIndex } from './keyboard.js';
import {
	ATTACK_S,
	computeKeyStates,
	createKeyStates,
	FLARE_TAU,
	KEY_STATE_STRIDE,
	RELEASE_S
} from './keystate.js';

function notes(
	list: { on: number; off: number; pitch: number; voice: number; vel: number }[]
): NoteColumns {
	const n = list.length;
	const c: NoteColumns = {
		n,
		t_on: Float32Array.from(list.map((x) => x.on)),
		t_off: Float32Array.from(list.map((x) => x.off)),
		tick: new Uint32Array(n),
		pitch: Uint8Array.from(list.map((x) => x.pitch)),
		voice: Uint8Array.from(list.map((x) => x.voice)),
		vel: Uint8Array.from(list.map((x) => x.vel)),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
	return c;
}

const state = (out: Float32Array, pitch: number) => {
	const o = keyIndex(pitch) * KEY_STATE_STRIDE;
	return { voice: out[o], press: out[o + 1], glow: out[o + 2], flare: out[o + 3] };
};

function at(c: NoteColumns, t: number) {
	const w = new NoteWindow(c);
	w.query(t, 6, 2);
	const out = createKeyStates();
	computeKeyStates(w, t, out);
	return out;
}

describe('computeKeyStates', () => {
	const c = notes([
		{ on: 10, off: 12, pitch: 60, voice: 2, vel: 255 },
		{ on: 11, off: 11.5, pitch: 72, voice: 1, vel: 128 }
	]);

	it('leaves keys untouched before their note and long after', () => {
		expect(state(at(c, 9), 60)).toEqual({ voice: 0, press: 0, glow: 0, flare: 0 });
		expect(state(at(c, 13), 60)).toEqual({ voice: 0, press: 0, glow: 0, flare: 0 });
	});

	it('presses the key in the voice of its note while the note sounds', () => {
		const s = state(at(c, 11), 60);
		expect(s.voice).toBe(2);
		expect(s.press).toBe(1);
		expect(s.glow).toBeCloseTo(1, 6);
		expect(state(at(c, 11), 72).voice).toBe(1);
	});

	it('flares at the onset in proportion to velocity and decays', () => {
		const loud = state(at(c, 10 + 1e-4), 60).flare;
		expect(loud).toBeCloseTo(1, 2);
		const later = state(at(c, 10 + FLARE_TAU), 60).flare;
		expect(later).toBeCloseTo(Math.exp(-1), 2);
		const soft = state(at(c, 11 + 1e-4), 72).flare;
		expect(soft).toBeCloseTo(128 / 255, 2);
		expect(state(at(c, 11.8), 60).flare).toBeLessThan(0.01);
	});

	it('eases the key down over the attack time', () => {
		const half = state(at(c, 10 + ATTACK_S / 2), 60).press;
		expect(half).toBeCloseTo(0.5, 1);
	});

	it('releases over the release time after the note ends', () => {
		const mid = state(at(c, 12 + RELEASE_S / 2), 60);
		expect(mid.press).toBeCloseTo(0.5, 1);
		expect(mid.glow).toBeGreaterThan(0);
		expect(state(at(c, 12 + RELEASE_S + 0.01), 60).press).toBe(0);
	});

	it('depends only on the playhead, not on how it got there (seeks, pauses)', () => {
		const w = new NoteWindow(c);
		const a = createKeyStates();
		const b = createKeyStates();
		w.query(11, 6, 2);
		computeKeyStates(w, 11, a);
		w.query(30, 6, 2);
		computeKeyStates(w, 30, b); // somewhere else first
		w.query(5, 6, 2);
		computeKeyStates(w, 5, b);
		w.query(11, 6, 2);
		computeKeyStates(w, 11, b);
		expect(Array.from(b)).toEqual(Array.from(a));
	});

	it('lets the stronger of two notes on one key decide its voice', () => {
		const u = notes([
			{ on: 1, off: 5, pitch: 64, voice: 3, vel: 40 },
			{ on: 2, off: 5, pitch: 64, voice: 1, vel: 250 }
		]);
		expect(state(at(u, 2.01), 64).voice).toBe(1);
	});
});
