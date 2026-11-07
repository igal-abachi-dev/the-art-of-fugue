/**
 * The sample sets of the sampler mode (T8.1.1): which sample plays which pitch at which loudness, and loading them.
 *
 * Three instruments are sampled, all from the Versilian Community Sample Library (CC0; `tools/artfugue/instruments.py` prepares
 * them and writes an `index.json` next to the files): a Steinway B piano in three dynamic layers, a harpsichord, and a pipe organ
 * in two layers (a soft rank, and an open rank with the pedal). A note is played by the nearest sample of a layer, sped up or
 * slowed down by the difference (and by the sample's own tuning error, `cents`); a sample is only re-pitched, never stretched in
 * time, as a sampler does. A note between two layers' loudnesses sounds both, crossfaded (`SampleBank.voices`), so a crescendo in
 * the recording is a crescendo here, in timbre as well as in level. A pipe's sample carries a loop (`loop`, in seconds), so that
 * it sounds as long as the key is down.
 *
 * The files are decoded by the browser (`decodeAudioData`), whose idea of where an MP3 begins differs from one engine to the
 * next (the encoder's delay is trimmed or not), and a note is placed by its attack. So the loader finds the start of the sound
 * itself (`findAttack`) and, as the place the ear takes for the note's time, the instant its level rises fastest (`findRise`,
 * which is also how the alignment of the recording is judged, `docs/sync-report.md`). The sampler lines that instant up.
 */

import { versioned } from '../data/version.js';
import type { Reverb } from './reverb.js';

/** One band of the tone correction of an instrument. */
export interface EqBand {
	type: 'lowshelf' | 'highshelf' | 'peaking' | 'lowpass';
	/** Hz */
	freq: number;
	/** dB */
	gain: number;
	q?: number;
}

/** The index of the value of `midis` (ascending) that is nearest to `pitch`; the lower one where two are equally near. */
export function nearestIndex(midis: readonly number[], pitch: number): number {
	let best = 0;
	for (let i = 1; i < midis.length; i++) {
		if (Math.abs(midis[i] - pitch) < Math.abs(midis[best] - pitch)) best = i;
	}
	return best;
}

/**
 * Where the sound begins in a decoded sample, in seconds: the first sample that rises above 1.5 % (-36 dB) of the loudest
 * one in the first half second, less a couple of milliseconds so that the hammer's first touch is not clipped.
 */
export function findAttack(data: Float32Array, sampleRate: number): number {
	const n = Math.min(data.length, Math.floor(sampleRate * 0.5));
	let peak = 0;
	for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
	if (peak === 0) return 0;
	const floor = peak * 0.015;
	for (let i = 0; i < n; i++) {
		if (Math.abs(data[i]) >= floor) return Math.max(0, i / sampleRate - 0.002);
	}
	return 0;
}

/**
 * Where in a decoded sample the note is struck, as the alignment of the recording reads it (`tools/artfugue/syncref.py`): the
 * middle of the steepest rise of the level, in dB, over 6 ms (3 ms windows, 1 ms steps), looked for in the first 0.4 s and
 * only where the level it reaches is within 40 dB of the loudest, so that the first grains of dither do not count. Seconds
 * from the start of the buffer; 0 for silence.
 */
export function findRise(data: Float32Array, sampleRate: number): number {
	const win = Math.max(2, Math.round(sampleRate * 0.003));
	const hop = Math.max(1, Math.round(sampleRate * 0.001));
	const span = 6;
	const limit = Math.min(data.length, Math.floor(sampleRate * 0.4));
	const db: number[] = [];
	for (let i = 0; i + win <= limit; i += hop) {
		let s = 0;
		for (let k = i; k < i + win; k++) s += data[k] * data[k];
		db.push(10 * Math.log10(s / win + 1e-12));
	}
	if (db.length <= span) return 0;
	const peak = Math.max(...db);
	if (peak < -90) return 0;
	let best = -Infinity;
	let at = 0;
	for (let k = 0; k + span < db.length; k++) {
		if (db[k + span] < peak - 40) continue;
		const rise = db[k + span] - db[k];
		if (rise > best) {
			best = rise;
			at = k;
		}
	}
	return ((at + span / 2) * hop + win / 2) / sampleRate;
}

/**
 * The strike of the recording comes this long before the aligned onset of its note, seconds (the median of the 44 reference
 * points of `docs/sync-report.md`, signed). It is in the recording's own time: at half speed it is twice as long.
 */
export const DEFAULT_LEAD_S = 0.026;

export interface Sample {
	name: string;
	midi: number;
	buffer: AudioBuffer;
	/** seconds into the buffer at which to start it */
	attack: number;
	/** seconds into the buffer at which the note is struck, as the ear takes it (the steepest rise of the level) */
	rise: number;
	/** how far the sample is above equal temperament at A = 440 Hz, in cents (its re-pitching takes it into account) */
	cents: number;
	/** a pipe: the part of the buffer, in seconds, that repeats for as long as the key is held */
	loop?: [number, number];
}

/** One sample to play a note with: re-pitched by `rate`, and as loud as `gain` (1 unless it is one of two layers crossfaded). */
export interface Voice {
	sample: Sample;
	rate: number;
	gain?: number;
	/** this layer's own delay on top of the instrument's, seconds (a soft attack is read later than a hard one) */
	delay?: number;
}

/** What the sampler needs from a bank (so tests can use a stub). */
export interface Bank {
	voice(pitch: number): Voice | null;
	/** the samples that play a note of this pitch and loudness (0..255): one, or two layers crossfaded */
	voices?(pitch: number, vel: number): Voice[];
	/** the loudness of the whole instrument in the sampler, 0..1 */
	readonly level?: number;
	/** time constant of the key's release, seconds */
	readonly releaseTau?: number;
	/**
	 * How much later than the rule (strike where the recording strikes, `DEFAULT_LEAD_S` before the aligned onset) this
	 * instrument has to strike, seconds. It is measured, per instrument, by `pnpm sampler-check`: the instrument's strike read in
	 * the output the way the recording's is, against the recording's, over the reference points of the sync check.
	 */
	readonly delay?: number;
	/** the strike's strength changes the loudness of a single layer; false: layers carry the dynamics, or there are none */
	readonly dynamics?: boolean;
	/** a room for the instrument (it is dry as sampled); none if absent */
	readonly reverb?: Reverb;
	/** the strike's loudness (0..255) is multiplied by this before it chooses its layers: below 1 favours the softer layers, the softer hammers */
	readonly velScale?: number;
	/**
	 * A swell that holds a note up as it dies away: pairs of (seconds after the note begins, dB), joined by straight lines in
	 * amplitude and held after the last. The samples of a close-microphoned piano fall faster than the recorded piano, whose room and
	 * pedal hold its notes; this brings the one near the other (`tools/artfugue/instruments.py`). None if absent.
	 */
	readonly sustain?: [number, number][];
	/** a tone correction of the whole instrument (peaking and shelving filters), measured against the recording; none if absent */
	readonly eq?: EqBand[];
	/** 'terraced': which layer plays a note is decided by section, not by the note's loudness (`registration.ts`); default 'crossfade' */
	readonly registration?: 'crossfade' | 'terraced';
	/** the samples that play a note of this pitch in one layer alone (a terraced instrument's rank) */
	voicesIn?(pitch: number, layer: number): Voice[];
}

export interface SampleSpec {
	name: string;
	midi: number;
	file: string;
	cents: number;
	loop?: [number, number];
	/**
	 * Where the note is struck, seconds after the first sound, as measured when the file was made the way the recording's reference
	 * points are read (`tools/artfugue/instruments.py`). Absent: the loader finds the steepest rise of the level itself.
	 */
	rise?: number;
}

/** A loudness of the instrument: its samples, and the loudness of a note (0..255) it is made for. */
export interface LayerSpec {
	name: string;
	vel: number;
	/** this layer's delay on top of the instrument's, seconds: measured the same way (`pnpm sampler-check`) */
	delay?: number;
	samples: SampleSpec[];
}

/** One instrument's files: what its `index.json` lists. */
export interface InstrumentSpec {
	id: string;
	title: string;
	/** the folder of the files, with the trailing slash */
	base: string;
	level: number;
	releaseTau: number;
	delay: number;
	dynamics: boolean;
	reverb?: Reverb;
	eq?: EqBand[];
	velScale?: number;
	sustain?: [number, number][];
	registration?: 'crossfade' | 'terraced';
	layers: LayerSpec[];
}

interface BankLayer {
	vel: number;
	delay: number;
	samples: Map<number, Sample>;
	midis: number[];
}

/** The weights of two neighbouring layers for a note of loudness `vel` (equal power); one layer outside their range. */
export function layerWeights(
	vels: readonly number[],
	vel: number
): [index: number, gain: number][] {
	if (vels.length === 1 || vel <= vels[0]) return [[0, 1]];
	const last = vels.length - 1;
	if (vel >= vels[last]) return [[last, 1]];
	let i = 0;
	while (vel > vels[i + 1]) i++;
	const x = (vel - vels[i]) / (vels[i + 1] - vels[i]);
	const out: [number, number][] = [
		[i, Math.sqrt(1 - x)],
		[i + 1, Math.sqrt(x)]
	];
	return out.filter(([, g]) => g > 0.03);
}

export class SampleBank implements Bank {
	readonly layers: BankLayer[] = [];
	level = 0.5;
	releaseTau = 0.07;
	delay = 0;
	dynamics = false;
	reverb?: Reverb;
	eq?: EqBand[];
	velScale = 1;
	sustain?: [number, number][];
	registration: 'crossfade' | 'terraced' = 'crossfade';

	addLayer(vel: number, delay = 0): Map<number, Sample> {
		const samples = new Map<number, Sample>();
		this.layers.push({ vel, delay, samples, midis: [] });
		return samples;
	}

	#voiceIn(layer: BankLayer, pitch: number): Voice | null {
		if (!layer.midis.length) layer.midis = [...layer.samples.keys()].sort((a, b) => a - b);
		if (!layer.midis.length) return null;
		const midi = layer.midis[nearestIndex(layer.midis, pitch)];
		const sample = layer.samples.get(midi);
		return sample
			? { sample, rate: 2 ** ((pitch - midi - sample.cents / 100) / 12), delay: layer.delay }
			: null;
	}

	voices(pitch: number, vel: number): Voice[] {
		const out: Voice[] = [];
		const vels = this.layers.map((l) => l.vel);
		for (const [i, gain] of layerWeights(vels, vel)) {
			const v = this.#voiceIn(this.layers[i], pitch);
			if (v) out.push({ ...v, gain });
		}
		return out;
	}

	/** The samples that play a note in one layer alone (the index of the layer, the softest 0). */
	voicesIn(pitch: number, layer: number): Voice[] {
		const l = this.layers[Math.min(this.layers.length - 1, Math.max(0, layer))];
		const v = l ? this.#voiceIn(l, pitch) : null;
		return v ? [{ ...v, gain: 1 }] : [];
	}

	/** The voice of the middle layer, for a note of middling loudness. */
	voice(pitch: number): Voice | null {
		return this.voices(pitch, 128)[0] ?? null;
	}

	/** Samples in all, over all layers. */
	get size(): number {
		return this.layers.reduce((a, l) => a + l.samples.size, 0);
	}
}

export interface LoadOptions {
	/** which instrument */
	spec: InstrumentSpec;
	/** where the files are; default the instrument's own folder */
	base?: string;
	fetchFn?: (input: string) => Promise<Response>;
	/** called with the number of samples loaded so far and the total */
	onProgress?: (done: number, total: number) => void;
	/** how many files are fetched at once */
	parallel?: number;
	/** set to stop loading (the listener switched back) */
	cancelled?: () => boolean;
}

export class LoadCancelled extends Error {
	constructor() {
		super('cancelled');
	}
}

interface IndexDoc {
	instrument?: string;
	level?: number;
	release_tau?: number;
	delay_s?: number;
	dynamics?: boolean;
	reverb?: Reverb;
	eq?: EqBand[];
	vel_scale?: number;
	sustain?: [number, number][];
	registration?: string;
	layers?: { name?: string; vel?: number; delay_s?: number; samples?: SampleSpec[] }[];
	samples?: SampleSpec[];
}

/** The list of an instrument's files (its `index.json`): its layers, or a single one if it has only `samples`. */
export async function fetchSpec(
	id: string,
	fetchFn: (input: string) => Promise<Response> = (u) => fetch(u)
): Promise<InstrumentSpec> {
	const base = `/samples/${id}/`;
	const res = await fetchFn(versioned(`${base}index.json`));
	if (!res.ok) throw new Error(`${id}: index.json ${res.status}`);
	const doc = (await res.json()) as IndexDoc;
	const raw = doc.layers ?? (doc.samples ? [{ name: 'all', vel: 128, samples: doc.samples }] : []);
	const layers = raw
		.filter((l) => l.samples?.length)
		.map((l, i) => ({
			name: l.name ?? `layer ${i + 1}`,
			vel: l.vel ?? 128,
			delay: Number.isFinite(l.delay_s) ? l.delay_s : 0,
			samples: (l.samples ?? []).map((s) => ({
				name: s.name,
				midi: s.midi,
				file: s.file,
				cents: s.cents ?? 0,
				loop: s.loop,
				rise: s.rise
			}))
		}))
		.sort((a, b) => a.vel - b.vel);
	if (!layers.length) throw new Error(`${id}: the list of samples is empty`);
	return {
		id,
		title: doc.instrument ?? id,
		base,
		level: doc.level ?? 0.5,
		releaseTau: doc.release_tau ?? 0.07,
		delay: doc.delay_s ?? 0,
		dynamics: doc.dynamics ?? false,
		reverb: doc.reverb && doc.reverb.mix > 0 ? doc.reverb : undefined,
		eq: (doc.eq ?? []).filter(
			(b) =>
				['lowshelf', 'highshelf', 'peaking', 'lowpass'].includes(b.type) &&
				Number.isFinite(b.freq) &&
				Number.isFinite(b.gain) &&
				Math.abs(b.gain) <= 12
		),
		sustain: (doc.sustain ?? []).filter(
			(p) =>
				Array.isArray(p) &&
				Number.isFinite(p[0]) &&
				Number.isFinite(p[1]) &&
				p[0] >= 0 &&
				Math.abs(p[1]) <= 18
		),
		velScale: Number.isFinite(doc.vel_scale) && (doc.vel_scale ?? 1) > 0 ? doc.vel_scale : 1,
		registration: doc.registration === 'terraced' ? 'terraced' : 'crossfade',
		layers
	};
}

/**
 * Fetch and decode all samples. Rejects if any file cannot be fetched or decoded (a bank with holes would play the wrong
 * pitches' neighbours), or with `LoadCancelled`.
 */
export async function loadBank(
	ctx: Pick<BaseAudioContext, 'decodeAudioData'>,
	opts: LoadOptions
): Promise<SampleBank> {
	const spec = opts.spec;
	const base = opts.base ?? spec.base;
	const get = opts.fetchFn ?? ((u: string) => fetch(u));
	const bank = new SampleBank();
	bank.level = spec.level;
	bank.releaseTau = spec.releaseTau;
	bank.delay = spec.delay;
	bank.dynamics = spec.dynamics;
	bank.reverb = spec.reverb;
	bank.eq = spec.eq?.length ? spec.eq : undefined;
	bank.velScale = spec.velScale ?? 1;
	bank.sustain = spec.sustain?.length ? spec.sustain : undefined;
	bank.registration = spec.registration ?? 'crossfade';
	const into = spec.layers.map((l) => bank.addLayer(l.vel, l.delay ?? 0));
	const queue = spec.layers.flatMap((l, li) => l.samples.map((f) => ({ f, li })));
	const total = queue.length;
	let done = 0;
	const worker = async () => {
		for (;;) {
			if (opts.cancelled?.()) throw new LoadCancelled();
			const job = queue.shift();
			if (job === undefined) return;
			const { f, li } = job;
			const res = await get(versioned(`${base}${f.file}`));
			if (!res.ok) throw new Error(`sample ${f.name}: ${res.status}`);
			const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
			const data = buffer.getChannelData(0);
			const attack = findAttack(data, buffer.sampleRate);
			into[li].set(f.midi, {
				name: f.name,
				midi: f.midi,
				buffer,
				attack,
				// measured when the file was made, from the first sound, or (a list without it) found here
				rise: f.rise !== undefined ? attack + f.rise : findRise(data, buffer.sampleRate),
				cents: f.cents,
				loop: f.loop
			});
			opts.onProgress?.(++done, total);
		}
	};
	await Promise.all(Array.from({ length: opts.parallel ?? 6 }, worker));
	if (opts.cancelled?.()) throw new LoadCancelled();
	return bank;
}
