/**
 * Signals from the sound itself (T6.3.1): overall energy, three bands and an onset pulse, all smoothed, all 0 to 1.
 *
 * They come from the shared analyser's spectrum (`getFloatFrequencyData`, in dB) and are used for things that breathe
 * with the sound as a whole: the bloom, the ambient layer. The FFT is *not* used to tell the voices apart (the four
 * voices overlap in frequency); per-voice energy comes from the note data (`voiceenergy.ts`).
 *
 * The level of a recording is not known in advance, so each band is measured against its own slowly falling peak: a
 * band reads 1 at its recent loudest and 0 when it is `RANGE_DB` below that. Rising and falling are smoothed
 * separately (quick attack, slower release). The pulse is a spectral-flux onset detector: it jumps to 1 when the sum of
 * the spectrum's rises is well above its recent average, then falls away; two pulses are never closer than
 * `REFRACTORY_S` (which also keeps whatever follows the pulse under three flashes a second).
 */

/** band edges in Hz: low, mid, high (a piano is below 4.2 kHz in its fundamentals; the top band is the brightness) */
export const BANDS: readonly [number, number][] = [
	[40, 250],
	[250, 2000],
	[2000, 8000]
];
/** dB below a band's recent peak that reads as 0 */
export const RANGE_DB = 42;
/** the peak falls this many dB a second when the band is quieter than it */
export const PEAK_FALL_DB_S = 0.8;
export const ATTACK_S = 0.04;
export const RELEASE_S = 0.35;
export const PULSE_FALL_S = 0.22;
export const REFRACTORY_S = 0.18;
/** the flux must exceed its mean by this many standard deviations, and by at least `MIN_FLUX_DB` per bin */
export const FLUX_SIGMAS = 2.2;
export const MIN_FLUX_DB = 0.35;
const FLUX_HISTORY_S = 1.5;
/** a floor so that digital silence (-Infinity dB) does not poison the sums */
const FLOOR_DB = -120;

const smoothTo = (cur: number, target: number, dt: number): number => {
	const tau = target > cur ? ATTACK_S : RELEASE_S;
	return cur + (target - cur) * (1 - Math.exp(-dt / tau));
};

export interface SignalValues {
	energy: number;
	low: number;
	mid: number;
	high: number;
	flux: number;
	pulse: number;
}

export class AudioSignals implements SignalValues {
	/** all of the spectrum between 40 Hz and 8 kHz */
	energy = 0;
	low = 0;
	mid = 0;
	high = 0;
	/** the latest spectral flux in dB per bin, as a 0 to 1 value against `4 * MIN_FLUX_DB` */
	flux = 0;
	/** 1 at an onset, falling to 0 */
	pulse = 0;
	/** onsets detected since construction, for tests and the HUD */
	onsets = 0;

	readonly #peak = [FLOOR_DB, FLOOR_DB, FLOOR_DB, FLOOR_DB];
	#prev: Float32Array | null = null;
	readonly #hist: number[] = [];
	#histSum = 0;
	#histSq = 0;
	#since = Infinity;

	/**
	 * Feed one spectrum: `dB` as `AnalyserNode.getFloatFrequencyData` gives it (bin i is at i * sampleRate / (2 * (length)))
	 * and the time since the previous call in seconds. Calls with `dt <= 0` are ignored.
	 */
	update(dB: Float32Array, sampleRate: number, dt: number): void {
		if (!(dt > 0)) return;
		const binHz = sampleRate / 2 / dB.length;
		const lv = this.#levels(dB, binHz);
		for (let b = 0; b < 4; b++) {
			if (lv[b] > this.#peak[b]) this.#peak[b] = lv[b];
			else this.#peak[b] = Math.max(lv[b], this.#peak[b] - PEAK_FALL_DB_S * dt);
		}
		const norm = (b: number) =>
			Math.min(1, Math.max(0, (lv[b] - (this.#peak[b] - RANGE_DB)) / RANGE_DB));
		this.low = smoothTo(this.low, norm(0), dt);
		this.mid = smoothTo(this.mid, norm(1), dt);
		this.high = smoothTo(this.high, norm(2), dt);
		this.energy = smoothTo(this.energy, norm(3), dt);

		// onsets: how much of the spectrum got louder since the last call
		const flux = this.#fluxOf(dB, binHz);
		this.flux = Math.min(1, flux / (4 * MIN_FLUX_DB));
		this.#since += dt;
		this.pulse *= Math.exp(-dt / PULSE_FALL_S);
		const n = this.#hist.length;
		const mean = n ? this.#histSum / n : 0;
		const sd = n ? Math.sqrt(Math.max(0, this.#histSq / n - mean * mean)) : 0;
		if (
			n > 8 &&
			flux > MIN_FLUX_DB &&
			flux > mean + FLUX_SIGMAS * sd &&
			this.#since >= REFRACTORY_S
		) {
			this.pulse = 1;
			this.#since = 0;
			this.onsets++;
		}
		this.#hist.push(flux);
		this.#histSum += flux;
		this.#histSq += flux * flux;
		const keep = Math.max(8, Math.round(FLUX_HISTORY_S / dt));
		while (this.#hist.length > keep) {
			const old = this.#hist.shift()!;
			this.#histSum -= old;
			this.#histSq -= old * old;
		}
	}

	/** No sound to read (paused, no analyser): everything relaxes to 0. */
	idle(dt: number): void {
		if (!(dt > 0)) return;
		for (const k of ['energy', 'low', 'mid', 'high', 'flux'] as const)
			this[k] = smoothTo(this[k], 0, dt);
		this.pulse *= Math.exp(-dt / PULSE_FALL_S);
	}

	reset(): void {
		this.energy = this.low = this.mid = this.high = this.flux = this.pulse = 0;
		this.#peak.fill(FLOOR_DB);
		this.#prev = null;
		this.#hist.length = 0;
		this.#histSum = this.#histSq = 0;
		this.#since = Infinity;
	}

	/** mean power of each band and of the whole range, in dB */
	#levels(dB: Float32Array, binHz: number): number[] {
		const out: number[] = [];
		const edges = [...BANDS, [BANDS[0][0], BANDS[BANDS.length - 1][1]] as [number, number]];
		for (const [lo, hi] of edges) {
			// bins whose frequency is in [lo, hi): neighbouring bands share no bin
			const a = Math.max(1, Math.ceil(lo / binHz));
			const b = Math.min(dB.length - 1, Math.ceil(hi / binHz) - 1);
			let sum = 0;
			for (let i = a; i <= b; i++) sum += Math.pow(10, Math.max(FLOOR_DB, dB[i]) / 10);
			const n = Math.max(1, b - a + 1);
			out.push(10 * Math.log10(sum / n + 1e-12));
		}
		return out;
	}

	#fluxOf(dB: Float32Array, binHz: number): number {
		const a = Math.max(1, Math.ceil(BANDS[0][0] / binHz));
		const b = Math.min(dB.length - 1, Math.ceil(BANDS[BANDS.length - 1][1] / binHz) - 1);
		const prev = this.#prev;
		let sum = 0;
		if (prev && prev.length === dB.length) {
			for (let i = a; i <= b; i++) {
				const d = Math.max(FLOOR_DB, dB[i]) - Math.max(FLOOR_DB, prev[i]);
				if (d > 0) sum += d;
			}
		}
		if (!prev || prev.length !== dB.length) this.#prev = new Float32Array(dB.length);
		this.#prev!.set(dB);
		return sum / Math.max(1, b - a + 1);
	}
}
