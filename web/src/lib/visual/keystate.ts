/**
 * Key press and landing flare (T4.2.4), computed as a pure function of the playhead.
 *
 * Nothing here remembers the previous frame, so a seek, a pause or a rate change always shows the right keys:
 * a key is down if a note is sounding at t, it is released over `RELEASE_S` after the note ends, and the
 * landing flare is `velocity × exp(−age / FLARE_TAU)` of the note's age since its onset.
 *
 * Output per key (index = midi − 21), four floats: voice (0 = none, else 1..), press 0..1, glow 0..1, flare 0..1.
 */

import { KEY_COUNT, keyIndex } from './keyboard.js';
import type { NoteWindow } from '../playback/window.js';

export const KEY_STATE_STRIDE = 4;
/** seconds for a key to go down after the onset */
export const ATTACK_S = 0.025;
/** seconds for a key to come up after the note ends */
export const RELEASE_S = 0.14;
/** decay time constant of the landing flare, seconds */
export const FLARE_TAU = 0.13;
/** flares older than this are zero */
export const FLARE_WINDOW = 0.9;

export function createKeyStates(): Float32Array {
	return new Float32Array(KEY_COUNT * KEY_STATE_STRIDE);
}

/**
 * Fill `out` for time `t`. `win` must have been queried for `t` with a look-behind of at least `RELEASE_S`
 * and `FLARE_WINDOW` (the stage queries with the scene's `behind`, which is longer).
 */
export function computeKeyStates(win: NoteWindow, t: number, out: Float32Array): void {
	out.fill(0);
	const n = win.notes;

	const put = (i: number, press: number, glow: number, flare: number) => {
		const o = keyIndex(n.pitch[i]) * KEY_STATE_STRIDE;
		// when two notes share a key, the stronger one wins
		if (press + glow + flare >= out[o + 1] + out[o + 2] + out[o + 3]) {
			out[o] = n.voice[i];
		}
		if (press > out[o + 1]) out[o + 1] = press;
		if (glow > out[o + 2]) out[o + 2] = glow;
		if (flare > out[o + 3]) out[o + 3] = flare;
	};

	for (let k = 0; k < win.activeCount; k++) {
		const i = win.active[k];
		const age = t - n.t_on[i];
		const vel = n.vel[i] / 255;
		const press = Math.min(1, age / ATTACK_S);
		const glow = 0.55 + 0.45 * vel;
		const flare = age < FLARE_WINDOW ? vel * Math.exp(-age / FLARE_TAU) : 0;
		put(i, press, glow, flare);
	}
	for (let k = 0; k < win.endedCount; k++) {
		const i = win.ended[k];
		const since = t - n.t_off[i];
		if (since >= RELEASE_S) continue;
		const rest = 1 - since / RELEASE_S;
		const vel = n.vel[i] / 255;
		const age = t - n.t_on[i];
		const flare = age < FLARE_WINDOW ? vel * Math.exp(-age / FLARE_TAU) : 0;
		put(i, rest, (0.55 + 0.45 * vel) * rest, flare);
	}
}
