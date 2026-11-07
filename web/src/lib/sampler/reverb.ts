/**
 * A room for the sampled instruments: a synthetic impulse response (decaying noise, darker as it goes), convolved in the browser.
 *
 * The piano's samples are recorded close to the strings and are dry; the recording they are compared with has the room it was
 * played in. A short reverb brings the one a little nearer the other. Nothing is measured here: the reverb time and the mix are
 * set per instrument in its list (`reverb`), and an instrument without one has none (the harpsichord and the organ sound as they were
 * sampled). The noise is seeded, so the room is the same every time.
 */

export interface Reverb {
	/** seconds for the tail to fall 60 dB */
	rt60: number;
	/** how much of the instrument goes through the room, 0..1 (the dry sound is not lowered) */
	mix: number;
}

/** A small deterministic generator of numbers in (-1, 1) (mulberry32), so that the room does not change from visit to visit. */
function noise(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
	};
}

/** The two channels of an impulse response of this length: a soft start, an exponential decay, a tail that loses its treble. */
export function impulseResponse(sampleRate: number, rt60: number): [Float32Array, Float32Array] {
	const n = Math.max(1, Math.round(sampleRate * rt60 * 1.1));
	const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
	out.forEach((ch, c) => {
		const rnd = noise(0x9e3779b9 + c * 7919);
		let lp = 0;
		let energy = 0;
		for (let i = 0; i < n; i++) {
			const t = i / sampleRate;
			const decay = Math.exp((-6.9078 * t) / rt60);
			const attack = Math.min(1, t / 0.004); // no click at the start
			// the tail loses its treble: a one-pole low pass whose cutoff falls from about 8 kHz to 1.5 kHz
			const k = 0.75 - 0.6 * Math.min(1, t / rt60);
			lp += k * (rnd() - lp);
			ch[i] = lp * decay * attack;
			energy += ch[i] * ch[i];
		}
		const norm = 1 / Math.sqrt(energy || 1);
		for (let i = 0; i < n; i++) ch[i] *= norm;
	});
	return out;
}
