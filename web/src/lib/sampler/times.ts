/**
 * When the sampled instruments play each note: the aligned onset, with the notes that the score begins together pulled
 * together.
 *
 * The aligned onsets sit on the alignment's own frames (11.6 ms), and notes that share a tick of the score (the voices of one
 * chord, a note in each hand) come out 11.6 ms apart at the median, 35 ms at the 75th percentile and 76 ms at the 90th, in the
 * data (`docs/sampler.md`). The recording is smooth, a person playing a chord keeps it within a few milliseconds, and a sampler
 * that plays the scatter as it is sounds uneven, a flam where there should be none. So the notes of one tick (of one pass of a
 * repeat) whose onsets lie within `CHORD_MAX_S` of each other are moved most of the way (`CHORD_PULL`) to their median; a group
 * that is wider than that is an arpeggio or an alignment that is not to be trusted, and is left as it is.
 *
 * What was tried and left out: smoothing the whole curve of time against tick. Against the 44 reference points read off the
 * waveform it made the error larger (median absolute deviation 4.0 ms to 6.5 ms), because the recording's own rubato is not noise.
 * The notes' ends move with their starts, so a note keeps its length. Nothing in the data or the picture changes: this is read
 * by the sampler only.
 */

/** the largest spread of a group of notes that begin together that is taken for one chord, seconds */
export const CHORD_MAX_S = 0.09;
/** how much of the way to the group's median each note is moved, 0..1 */
export const CHORD_PULL = 0.8;

interface Columns {
	readonly n: number;
	readonly t_on: Float32Array;
	readonly tick: Uint32Array;
	readonly pass: Uint8Array;
}

const cache = new WeakMap<object, Float32Array>();

/** The time at which each note plays, in the order of the columns. Computed once per set of notes. */
export function playTimes(notes: Columns): Float32Array {
	const hit = cache.get(notes);
	if (hit) return hit;
	const out = Float32Array.from(notes.t_on.subarray(0, notes.n));
	const groups = new Map<number, number[]>();
	for (let i = 0; i < notes.n; i++) {
		const key = notes.tick[i] * 8 + (notes.pass[i] & 7);
		const g = groups.get(key);
		if (g) g.push(i);
		else groups.set(key, [i]);
	}
	for (const g of groups.values()) {
		if (g.length < 2) continue;
		const ts = g.map((i) => notes.t_on[i]).sort((a, b) => a - b);
		if (ts[ts.length - 1] - ts[0] > CHORD_MAX_S) continue;
		const mid =
			ts.length % 2 ? ts[(ts.length - 1) / 2] : (ts[ts.length / 2 - 1] + ts[ts.length / 2]) / 2;
		for (const i of g) out[i] = notes.t_on[i] + CHORD_PULL * (mid - notes.t_on[i]);
	}
	cache.set(notes, out);
	return out;
}
