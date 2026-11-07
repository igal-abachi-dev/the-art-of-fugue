import { describe, expect, it } from 'vitest';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import { Emitter, EMBER, hash01, PA, ParticlePool, SPARK } from './particles.js';

function notes(
	list: { on: number; off: number; pitch?: number; vel?: number; voice?: number }[]
): NoteColumns {
	const n = list.length;
	return {
		n,
		t_on: Float32Array.from(list.map((x) => x.on)),
		t_off: Float32Array.from(list.map((x) => x.off)),
		tick: new Uint32Array(n),
		pitch: Uint8Array.from(list.map((x) => x.pitch ?? 60)),
		voice: Uint8Array.from(list.map((x) => x.voice ?? 1)),
		vel: Uint8Array.from(list.map((x) => x.vel ?? 255)),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
}

const live = (pool: ParticlePool, t: number) => {
	let n = 0;
	for (let i = 0; i < pool.cap; i++) {
		const age = t - pool.a[i * PA + 1];
		if (age >= 0 && age < pool.a[i * PA + 2]) n++;
	}
	return n;
};

describe('Emitter', () => {
	const c = notes([
		{ on: 1.0, off: 1.1 }, // spark
		{ on: 2.0, off: 4.0 }, // ember
		{ on: 2.01, off: 2.1 }
	]);

	it('emits when a note begins during the step, and only then', () => {
		const win = new NoteWindow(c);
		const pool = new ParticlePool(256);
		const em = new Emitter();
		em.step(win, 0.9, false, pool, 1);
		expect(em.step(win, 0.95, false, pool, 1)).toBe(0);
		expect(pool.emitted).toBe(0);
		expect(em.step(win, 1.01, false, pool, 1)).toBe(1);
		expect(pool.emitted).toBeGreaterThan(0);
		const before = pool.emitted;
		em.step(win, 1.05, false, pool, 1);
		expect(pool.emitted).toBe(before);
	});

	it('makes sparks for short notes and embers for long ones', () => {
		const win = new NoteWindow(c);
		const pool = new ParticlePool(256);
		const em = new Emitter();
		em.step(win, 0.99, false, pool, 1);
		em.step(win, 1.01, false, pool, 1);
		const kinds = new Set<number>();
		for (let i = 0; i < pool.emitted; i++) kinds.add(pool.a[i * PA + 3]);
		expect([...kinds]).toEqual([SPARK]);
		em.step(win, 1.99, false, pool, 1);
		const n0 = pool.emitted;
		em.step(win, 2.005, false, pool, 1);
		expect(pool.a[n0 * PA + 3]).toBe(EMBER);
		// embers live longer than sparks
		expect(pool.a[n0 * PA + 2]).toBeGreaterThan(pool.a[2]);
	});

	it('emits nothing for a seek: a discontinuity, a jump back or a long step', () => {
		const win = new NoteWindow(c);
		const pool = new ParticlePool(256);
		const em = new Emitter();
		em.step(win, 0.5, false, pool, 1);
		expect(em.step(win, 2.5, true, pool, 1)).toBe(0); // flagged
		em.step(win, 2.6, false, pool, 1);
		expect(em.step(win, 0.9, false, pool, 1)).toBe(0); // backwards
		expect(em.step(win, 5, false, pool, 1)).toBe(0); // a long step without a flag
		expect(pool.emitted).toBe(0);
		// and the next ordinary step after the seek works from the new place
		em.step(win, 0.98, true, pool, 1);
		expect(em.step(win, 1.02, false, pool, 1)).toBe(1);
	});

	it('scales with intensity and is off at zero', () => {
		const win = new NoteWindow(c);
		const full = new ParticlePool(256);
		const half = new ParticlePool(256);
		const off = new ParticlePool(256);
		for (const [pool, k] of [
			[full, 1],
			[half, 0.5],
			[off, 0]
		] as const) {
			const em = new Emitter();
			em.step(win, 0.99, false, pool, k);
			em.step(win, 1.01, false, pool, k);
		}
		expect(full.emitted).toBeGreaterThan(half.emitted);
		expect(half.emitted).toBeGreaterThan(0);
		expect(off.emitted).toBe(0);
	});

	it('never exceeds the cap: the ring overwrites the oldest', () => {
		const many = notes(
			Array.from({ length: 200 }, (_, i) => ({ on: 1 + i * 0.001, off: 1.05 + i * 0.001 }))
		);
		const win = new NoteWindow(many);
		const pool = new ParticlePool(64);
		const em = new Emitter();
		em.step(win, 0.99, false, pool, 1);
		em.step(win, 1.3, false, pool, 1);
		expect(pool.emitted).toBeGreaterThan(64);
		expect(live(pool, 1.3)).toBeLessThanOrEqual(64);
		pool.setCap(16);
		expect(pool.cap).toBe(16);
		pool.setCap(1e6);
		expect(pool.cap).toBe(64);
	});

	it('limits one frame to a bounded burst', () => {
		const many = notes(Array.from({ length: 300 }, (_, i) => ({ on: 1 + i * 0.0005, off: 1.05 })));
		const win = new NoteWindow(many);
		const pool = new ParticlePool(4096);
		const em = new Emitter();
		em.step(win, 0.99, false, pool, 1);
		expect(em.step(win, 1.2, false, pool, 1)).toBeLessThanOrEqual(48);
	});

	it('does not allocate: the arrays are updated in place', () => {
		const win = new NoteWindow(c);
		const pool = new ParticlePool(128);
		const { a, b } = pool;
		const em = new Emitter();
		for (let t = 0.5; t < 3; t += 1 / 60) em.step(win, t, false, pool, 1);
		expect(pool.a).toBe(a);
		expect(pool.b).toBe(b);
	});

	it('hashes to 0..1 and deterministically', () => {
		for (let i = 0; i < 1000; i++) {
			const h = hash01(i);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThan(1);
			expect(hash01(i)).toBe(h);
		}
	});
});
