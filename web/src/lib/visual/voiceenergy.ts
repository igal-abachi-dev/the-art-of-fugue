/**
 * Energy of each voice from the notes (T6.3.2): a number from 0 to 1 per voice that rises when that voice plays and
 * falls when it stops, from the note data and the playhead alone, so a seek gives the same value as playing to it.
 *
 * Each note that sounds, or sounded a moment ago, adds `velocity * envelope(t)`: a bright attack that settles to a
 * sustain while the note is held and dies away after it ends. The sum of a voice's notes is bent into 0..1 with
 * `1 - exp(-GAIN * sum)`, so two or three notes at once do not simply add up past the top. The FFT is not involved: the
 * voices overlap in frequency and cannot be told apart from the spectrum.
 *
 * `voiceEnergy` reads the window's `active` and `ended` lists as the last `NoteWindow.query` left them (the stage runs
 * that query for the key states already), so it costs one pass over the few notes sounding now.
 */

import type { NoteWindow } from '../playback/window.js';

export const VOICE_SLOTS = 5;
/** how long the look-behind of the query must be for the release to be complete */
export const RELEASE_S = 0.25;
/** seconds for the attack's extra brightness to settle to the sustain */
export const ATTACK_DECAY_S = 0.35;
/** the share of the peak that a held note keeps */
export const SUSTAIN = 0.55;
export const GAIN = 1.4;

/** the contribution of one note of velocity 0..1 that began `age` seconds ago, `held` seconds long (`held` < age once over) */
export function noteEnergy(vel: number, age: number, held: number): number {
	if (age < 0) return 0;
	const level = (s: number) => SUSTAIN + (1 - SUSTAIN) * Math.exp(-s / ATTACK_DECAY_S);
	if (age <= held) return vel * level(age);
	return vel * level(held) * Math.exp(-(age - held) / RELEASE_S);
}

/** Fill `out[0..4]` (voice 1 to 5) for the playhead `t`. `win.query(t, 0, lookBehind >= RELEASE_S * 4)` must have been run for `t`. */
export function voiceEnergy(win: NoteWindow, t: number, out: Float32Array | number[]): void {
	const n = win.notes;
	const sum = [0, 0, 0, 0, 0];
	const add = (i: number) => {
		const v = Math.min(VOICE_SLOTS, Math.max(1, n.voice[i])) - 1;
		const on = n.t_on[i];
		sum[v] += noteEnergy(n.vel[i] / 255, t - on, n.t_off[i] - on);
	};
	for (let k = 0; k < win.activeCount; k++) add(win.active[k]);
	for (let k = 0; k < win.endedCount; k++) add(win.ended[k]);
	for (let v = 0; v < VOICE_SLOTS; v++) out[v] = 1 - Math.exp(-GAIN * sum[v]);
}

/** the loudness of the whole texture: the mean of the voices' energies that are playing, 0..1 */
export function totalEnergy(e: ArrayLike<number>): number {
	let s = 0;
	let m = 0;
	for (let v = 0; v < VOICE_SLOTS; v++) {
		s += e[v];
		if (e[v] > m) m = e[v];
	}
	return Math.min(1, 0.5 * m + 0.5 * (s / 4));
}
