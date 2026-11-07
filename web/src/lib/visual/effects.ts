/**
 * The CPU side of the scene effects (E5), kept free of Three.js so it can be tested in Node.
 *
 * * the ending of Contrapunctus XIV (T5.7.2): freeze, shatter, fade to black, all pure functions of the playhead;
 * * the mirror flip (T5.5.2): a short animation clock;
 * * the calm ember drift of the idle scene (T5.8.1);
 * * the shatter burst, and the canon link threads (T5.6.1).
 */

import type { NoteWindow } from '../playback/window.js';
import type { NoteTags } from '../scenes/tags.js';
import { pitchToX } from './keyboard.js';
import { EMBER, hash01, ParticlePool, SPARK } from './particles.js';

// ---- the ending

/** seconds the picture stands still on the last note before it breaks */
export const FREEZE_S = 1.2;
/** seconds the notes take to vanish into the burst */
export const SHATTER_FADE_S = 0.3;
/** seconds after the shatter at which the screen is fully black */
export const BLACK_AFTER_S = 3.2;
/** the burst's particles live this long, seconds */
export const SHATTER_LIFE_S = 2.4;

export interface EndingPlan {
	/** the playhead time at which the notes stop moving: the onset of the last note */
	freezeAt: number;
	/** the time at which the picture shatters into particles */
	shatterAt: number;
	/** the time at which the screen is black */
	blackAt: number;
}

export function planEnding(lastOnset: number): EndingPlan {
	const shatterAt = lastOnset + FREEZE_S;
	return { freezeAt: lastOnset, shatterAt, blackAt: shatterAt + BLACK_AFTER_S };
}

export interface EndingState {
	/** playhead time the notes are held at (1e9 = not held) */
	hold: number;
	/** how visible the notes are: 1, then 0 once they have shattered */
	notes: number;
	/** how visible everything else is: 1, then 0 at black */
	dim: number;
}

export function createEndingState(): EndingState {
	return { hold: 1e9, notes: 1, dim: 1 };
}

const smooth = (a: number, b: number, x: number) => {
	const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return k * k * (3 - 2 * k);
};

/** Where the ending stands at playhead time `t` (a pure function: a seek or a pause shows the right frame). */
export function endingState(plan: EndingPlan | null, t: number, out: EndingState): EndingState {
	if (!plan) {
		out.hold = 1e9;
		out.notes = 1;
		out.dim = 1;
		return out;
	}
	out.hold = plan.freezeAt;
	out.notes = 1 - smooth(plan.shatterAt, plan.shatterAt + SHATTER_FADE_S, t);
	out.dim = 1 - smooth(plan.shatterAt + 0.6, plan.blackAt, t);
	return out;
}

/** The ending of a piece from its notes: it freezes at the onset of the last note. */
export function endingOf(win: NoteWindow): EndingPlan | null {
	const n = win.notes;
	return n.n > 0 ? planEnding(n.t_on[n.n - 1]) : null;
}

/** Burst particles per sounding note at full quality. */
const SHATTER_PER_NOTE = 70;

/**
 * Break the notes that stand frozen at `plan.freezeAt` into particles born at `plan.shatterAt`. Deterministic, so
 * emitting it again after a seek into the burst gives the same picture.
 */
export function shatter(
	win: NoteWindow,
	plan: EndingPlan,
	pool: ParticlePool,
	intensity: number
): number {
	if (pool.cap === 0 || intensity <= 0) return 0;
	win.query(plan.freezeAt, 0, 0.3);
	const n = win.notes;
	let made = 0;
	const per = Math.max(4, Math.round(SHATTER_PER_NOTE * intensity));
	for (let k = 0; k < win.activeCount; k++) {
		const i = win.active[k];
		for (let j = 0; j < per; j++) {
			const r = hash01(i * 131 + j * 7 + 3);
			pool.emit(
				pitchToX(n.pitch[i]),
				plan.shatterAt,
				SHATTER_LIFE_S * (0.55 + 0.45 * r),
				j % 3 === 0 ? EMBER : SPARK,
				n.voice[i],
				n.pitch[i],
				hash01(i * 17 + j * 5 + 1),
				0.1 + 0.12 * r
			);
			made++;
		}
	}
	return made;
}

// ---- the mirror flip

/** seconds the flip takes */
export const FLIP_S = 1.6;

export class FlipAnim {
	#k = 1;

	/** begin turning over: the picture starts mirrored and settles as written */
	start(): void {
		this.#k = 0;
	}

	get running(): boolean {
		return this.#k < 1;
	}

	/** Advance by `dt` seconds. Returns the value for `uFlip`: -1 at the start, 1 at the end, 1 when idle. */
	update(dt: number): number {
		if (this.#k >= 1) return 1;
		this.#k = Math.min(1, this.#k + Math.max(0, dt) / FLIP_S);
		return -Math.cos(Math.PI * this.#k);
	}

	cancel(): void {
		this.#k = 1;
	}
}

/** The pitch at the centre of a mirror and its x on the keyboard, from the pair's pitch sum. */
export function mirrorAxis(axisSum: number): { pitch: number; x: number } {
	const pitch = axisSum / 2;
	const lo = Math.floor(pitch);
	const hi = Math.ceil(pitch);
	return { pitch, x: (pitchToX(lo) + pitchToX(hi)) / 2 };
}

// ---- the idle drift

/** seconds between two embers of the idle scene at full strength */
export const IDLE_GAP_S = 0.28;

export class IdleDrift {
	#acc = 0;
	#n = 0;

	reset(): void {
		this.#acc = 0;
	}

	/** Let embers rise from the keyboard. Quiet: a few a second, slow, and none after a stall. */
	step(t: number, dt: number, pool: ParticlePool, intensity: number): number {
		if (intensity <= 0 || pool.cap === 0 || dt <= 0 || dt > 0.25) return 0;
		this.#acc += dt * intensity;
		let made = 0;
		while (this.#acc >= IDLE_GAP_S) {
			this.#acc -= IDLE_GAP_S;
			const r = hash01(this.#n++);
			const pitch = 36 + Math.floor(r * 49);
			pool.emit(
				pitchToX(pitch),
				t,
				3.2 + 1.6 * hash01(this.#n * 3),
				EMBER,
				1 + (this.#n % 4),
				pitch,
				hash01(this.#n * 11),
				0.08 + 0.06 * hash01(this.#n * 5)
			);
			made++;
		}
		return made;
	}
}

// ---- canon links

/** floats per link instance in each of the two arrays: x, voice, pitch, t_on */
export const LINK_STRIDE = 4;
export const LINK_CAP = 16;

/**
 * The threads of a canon at playhead time `t`: for each follower note that will begin within `ahead` seconds, whose
 * leader has already begun, one link from the leader's place on the hit line to the follower's place in the window.
 * Nearest first, at most `LINK_CAP`. Writes `from` (leader) and `to` (follower) and returns how many.
 */
export function gatherLinks(
	win: NoteWindow,
	tags: NoteTags,
	t: number,
	ahead: number,
	from: Float32Array,
	to: Float32Array
): number {
	win.startedBetween(t, t + ahead);
	const n = win.notes;
	let k = 0;
	for (let i = win.startedStart; i < win.startedEnd && k < LINK_CAP; i++) {
		const l = tags.leader[i];
		if (l < 0 || n.t_on[l] > t) continue;
		const o = k * LINK_STRIDE;
		from[o] = pitchToX(n.pitch[l]);
		from[o + 1] = n.voice[l];
		from[o + 2] = n.pitch[l];
		from[o + 3] = n.t_on[l];
		to[o] = pitchToX(n.pitch[i]);
		to[o + 1] = n.voice[i];
		to[o + 2] = n.pitch[i];
		to[o + 3] = n.t_on[i];
		k++;
	}
	return k;
}
