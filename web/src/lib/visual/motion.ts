/**
 * Camera motion (T6.2.2): a slow drift and a small shake on loud passages, and the reduced-motion switch.
 *
 * Both are pure functions of the playhead, so a seek lands on the same camera as playing to it. The drift is two slow
 * sines of unrelated periods (it never repeats exactly and never stops being slow). The shake is smooth value noise at
 * about 11 Hz, scaled by how loud the *notes* are (note velocities through `voiceenergy.ts`, not the FFT), and it only
 * starts above `SHAKE_FROM` (the loudest tenth of the recording), so it is an accent and not a constant tremble.
 * Amplitudes are in world units; the keyboard is 88 keys of about 0.4 units, so the largest shake is a few pixels
 * and nothing rotates. `reducedMotion` turns all of it off.
 */

/** drift amplitudes in world units (x, y) and periods in seconds */
export const DRIFT_X = 0.55;
export const DRIFT_Y = 0.3;
export const DRIFT_PERIODS: readonly [number, number, number, number] = [47, 29, 31, 19];
/** shake starts at this total energy and is full at `SHAKE_FULL` */
export const SHAKE_FROM = 0.74;
export const SHAKE_FULL = 0.92;
export const SHAKE_AMP = 0.075;
export const SHAKE_HZ = 11;

export interface Offset {
	x: number;
	y: number;
}

const TAU = Math.PI * 2;

/** The slow camera offset at playhead `t` for a strength 0..1. */
export function cameraDrift(t: number, strength: number, out: Offset): Offset {
	const [px, px2, py, py2] = DRIFT_PERIODS;
	out.x =
		strength * DRIFT_X * (0.7 * Math.sin((TAU * t) / px) + 0.3 * Math.sin((TAU * t) / px2 + 1.3));
	out.y =
		strength *
		DRIFT_Y *
		(0.7 * Math.sin((TAU * t) / py + 0.6) + 0.3 * Math.sin((TAU * t) / py2 + 2.1));
	return out;
}

/** a hash of an integer to -1..1 */
function hash(i: number): number {
	let x = Math.imul(i | 0, 0x27d4eb2d) ^ 0x165667b1;
	x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
	return (((x ^ (x >>> 16)) >>> 0) / 0x100000000) * 2 - 1;
}

/** smooth noise in -1..1: values at integers from the hash, joined with a smoothstep */
export function noise1(x: number, seed = 0): number {
	const i = Math.floor(x);
	const f = x - i;
	const s = f * f * (3 - 2 * f);
	return hash(i * 2 + seed * 7919) * (1 - s) + hash(i * 2 + 2 + seed * 7919) * s;
}

/** 0 below `SHAKE_FROM`, 1 at `SHAKE_FULL`, smooth in between */
export function shakeLevel(loudness: number): number {
	const k = Math.min(1, Math.max(0, (loudness - SHAKE_FROM) / (SHAKE_FULL - SHAKE_FROM)));
	return k * k * (3 - 2 * k);
}

/** The shake offset at playhead `t` for note loudness 0..1 and scene strength 0..1. */
export function cameraShake(t: number, loudness: number, strength: number, out: Offset): Offset {
	const a = strength * SHAKE_AMP * shakeLevel(loudness);
	out.x = a === 0 ? 0 : a * noise1(t * SHAKE_HZ, 1);
	out.y = a === 0 ? 0 : a * noise1(t * SHAKE_HZ, 2);
	return out;
}

/**
 * Steering (T6.4.2), the one idea of SkyRoads that is about the camera: the view leans toward where the music is. It
 * slides sideways and banks a little toward the middle of the notes that sound around now (a bump of weight peaking
 * 0.4 s ahead, from `STEER_BEHIND` s back to `STEER_AHEAD` s ahead, scaled by velocity), so a bass line on the left and
 * a soprano on the right move the picture a little each way. The weights fall to zero at the ends of the window, so the
 * result is continuous in time and a function of the playhead alone.
 */
export const STEER_X = 3.2;
export const STEER_ROLL = 0.012;
export const STEER_BEHIND = 0.5;
export const STEER_AHEAD = 3;
export const STEER_PEAK = 0.4;
/** keeps a single stray note from dragging the view all the way across */
const STEER_SOFT = 2;

export interface Steer extends Offset {
	/** radians about the view axis */
	roll: number;
}

/**
 * `data` is the note buffer's instance data: per note `stride` floats, x at 0, onset at 1, velocity at 4. `halfWidth` is
 * half the keyboard's width in the same units as x.
 */
export function cameraSteer(
	data: Float32Array,
	stride: number,
	halfWidth: number,
	t: number,
	strength: number,
	out: Steer
): Steer {
	out.x = out.y = out.roll = 0;
	if (strength <= 0) return out;
	let sw = 0;
	let swx = 0;
	for (let o = 0; o + 4 < data.length; o += stride) {
		const d = data[o + 1] - t;
		if (d <= -STEER_BEHIND || d >= STEER_AHEAD) continue;
		const bump =
			d < STEER_PEAK
				? (d + STEER_BEHIND) / (STEER_PEAK + STEER_BEHIND)
				: (STEER_AHEAD - d) / (STEER_AHEAD - STEER_PEAK);
		const w = bump * (0.4 + 0.6 * data[o + 4]);
		sw += w;
		swx += w * data[o];
	}
	const m = swx / (sw + STEER_SOFT) / halfWidth; // about -1..1
	out.x = strength * STEER_X * m;
	out.roll = -strength * STEER_ROLL * m || 0;
	return out;
}

/** Whether the user asked their system for less motion (`prefers-reduced-motion: reduce`). */
export function prefersReducedMotion(): boolean {
	try {
		return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
	} catch {
		return false;
	}
}
