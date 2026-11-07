/**
 * Particle bookkeeping for note-on bursts (T4.3.1). No Three.js here: this is the CPU side that decides when
 * and what to emit, so it can be tested in Node. The GPU side (stage.ts) draws the pool as one `Points` object
 * and computes every particle's position from its age in the vertex shader, so a frame costs no per-particle
 * CPU work at all; only a new burst writes a few floats.
 *
 * Particles are a ring buffer: the n-th emitted one goes to slot `n % cap`, overwriting the oldest. Nothing is
 * allocated after construction. Because position is a function of (now − birth), a seek needs no cleanup:
 * going forward ages everything out, going back makes ages negative and the shader hides them.
 */

import type { NoteWindow } from '../playback/window.js';
import { pitchToX } from './keyboard.js';

/** per particle, array A: x of the key, birth time, life, kind (0 spark, 1 ember) */
export const PA = 4;
/** per particle, array B: voice, pitch, random 0..1, size */
export const PB = 4;

export const SPARK = 0;
export const EMBER = 1;
/** notes shorter than this (seconds) make sparks, longer ones embers */
export const SPARK_MAX_DURATION = 0.28;
/** most notes handled in one frame (a jump of the clock must not flood the pool) */
export const MAX_ONSETS_PER_FRAME = 48;
/** a clock step larger than this is a seek, not playback, and emits nothing */
export const MAX_STEP_S = 0.4;

export class ParticlePool {
	/** slots allocated; the draw range is `cap` */
	readonly capacity: number;
	readonly a: Float32Array;
	readonly b: Float32Array;
	/** increases whenever data changed, for the renderer to upload */
	version = 0;
	/** active slots (≤ capacity); 0 = particles off */
	cap: number;
	emitted = 0;
	#head = 0;

	constructor(capacity = 4096) {
		this.capacity = capacity;
		this.cap = capacity;
		this.a = new Float32Array(capacity * PA);
		this.b = new Float32Array(capacity * PB);
		this.clear();
	}

	setCap(n: number): void {
		this.cap = Math.max(0, Math.min(this.capacity, Math.floor(n)));
		if (this.#head >= this.cap) this.#head = 0;
	}

	clear(): void {
		// born far in the future: negative age, so hidden
		for (let i = 0; i < this.capacity; i++) this.a[i * PA + 1] = 1e9;
		this.#head = 0;
		this.version++;
	}

	emit(
		x: number,
		birth: number,
		life: number,
		kind: number,
		voice: number,
		pitch: number,
		rnd: number,
		size: number
	): void {
		if (this.cap === 0) return;
		const s = this.#head;
		this.#head = (s + 1) % this.cap;
		const a = s * PA;
		const b = s * PB;
		this.a[a] = x;
		this.a[a + 1] = birth;
		this.a[a + 2] = life;
		this.a[a + 3] = kind;
		this.b[b] = voice;
		this.b[b + 1] = pitch;
		this.b[b + 2] = rnd;
		this.b[b + 3] = size;
		this.emitted++;
		this.version++;
	}
}

/** A deterministic hash to 0..1, so a given note always makes the same burst (and tests are exact). */
export function hash01(n: number): number {
	let x = (n | 0) + 0x9e3779b9;
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
	x ^= x >>> 16;
	return (x >>> 0) / 4294967296;
}

/** Watches the playhead and turns note onsets into particles. */
export class Emitter {
	#last = Number.NaN;

	/** forget the previous time (a new piece or a lost context) */
	reset(): void {
		this.#last = Number.NaN;
	}

	/**
	 * Emit for every note that began since the previous call. `intensity` (0..1) scales how many particles each
	 * note makes. Returns the number of notes that emitted. A discontinuity, a step backwards or a step longer
	 * than `MAX_STEP_S` emits nothing.
	 */
	step(
		win: NoteWindow,
		t: number,
		discontinuity: boolean,
		pool: ParticlePool,
		intensity: number
	): number {
		const last = this.#last;
		this.#last = t;
		if (discontinuity || Number.isNaN(last) || t <= last || t - last > MAX_STEP_S) return 0;
		if (intensity <= 0 || pool.cap === 0) return 0;
		win.startedBetween(last, t);
		const n = win.notes;
		let from = win.startedStart;
		const to = win.startedEnd;
		if (to - from > MAX_ONSETS_PER_FRAME) from = to - MAX_ONSETS_PER_FRAME;
		for (let i = from; i < to; i++) {
			const pitch = n.pitch[i];
			const vel = n.vel[i] / 255;
			const dur = n.t_off[i] - n.t_on[i];
			const spark = dur < SPARK_MAX_DURATION;
			const count = Math.round((spark ? 3 + 6 * vel : 2 + 3 * vel) * intensity);
			for (let k = 0; k < count; k++) {
				const r = hash01(i * 31 + k);
				pool.emit(
					pitchToX(pitch),
					n.t_on[i],
					spark ? 0.45 + 0.35 * r : 1.5 + 1.2 * r,
					spark ? SPARK : EMBER,
					n.voice[i],
					pitch,
					hash01(i * 17 + k * 5 + 1),
					spark ? 0.09 + 0.06 * vel : 0.16 + 0.1 * r
				);
			}
		}
		return to - from;
	}
}
