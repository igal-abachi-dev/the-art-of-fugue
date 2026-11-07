import type { NoteColumns } from '../data/notes.js';

/**
 * A pseudo-random piece for tests and benchmarks: a note about every 0.12 s, lengths 0.1-0.7 s with a few
 * held notes of 2-12 s, pitches 36-96 over four voices.
 */
export function syntheticNotes(n: number, seed = 1): NoteColumns {
	let s = seed;
	const rnd = () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
	const c: NoteColumns = {
		n,
		t_on: new Float32Array(n),
		t_off: new Float32Array(n),
		tick: new Uint32Array(n),
		pitch: new Uint8Array(n),
		voice: new Uint8Array(n),
		vel: new Uint8Array(n),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
	let t = 0;
	for (let i = 0; i < n; i++) {
		t += rnd() * 0.24;
		c.t_on[i] = t;
		c.t_off[i] = t + (rnd() < 0.02 ? 2 + rnd() * 10 : 0.1 + rnd() * 0.6);
		c.voice[i] = 1 + Math.floor(rnd() * 4);
		c.pitch[i] = 36 + Math.floor(rnd() * 60);
		c.vel[i] = 80 + Math.floor(rnd() * 175);
		c.flags[i] = rnd() < 0.05 ? 2 : 0;
		c.bar[i] = 1 + Math.floor(i / 8);
	}
	return c;
}
