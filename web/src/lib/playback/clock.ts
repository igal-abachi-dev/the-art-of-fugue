/**
 * Master clock (T3.1.2).
 *
 * `HTMLMediaElement.currentTime` is the only honest source of "what is being heard", but it is updated
 * in coarse steps (about 10-50 ms depending on browser and platform) and it jumps. A render loop that
 * reads it directly shows stair-stepped motion. This clock interpolates between those steps with
 * `performance.now()` and corrects the interpolation toward each fresh sample at a bounded rate, so:
 *
 * - while playing, `now()` is strictly increasing and moves at most `SLEW` (25 %) faster or slower than
 *   real time while it catches up, never by a jump;
 * - on a seek, a stall, a pause or a rate change it re-anchors at once and returns the element's own time;
 * - a sample that disagrees by more than `SNAP_S` is treated as a discontinuity (a jump we were not told
 *   about) and the clock snaps to it, counting it in `snaps`.
 *
 * The result is in seconds on the **WAV timeline** (the timeline of all note and bar data): the element's
 * time plus the source's `offset_s` (AAC plays about 11 ms early against the WAV), minus `latency`.
 */

export interface MediaLike {
	currentTime: number;
	readonly paused: boolean;
	readonly ended: boolean;
	readonly seeking: boolean;
	readonly playbackRate: number;
	readonly readyState: number;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

export interface ClockOptions {
	/** monotonic milliseconds; defaults to `performance.now` */
	perfNow?: () => number;
	/** seconds added to the element's time to get WAV time (`AudioSource.offset_s`) */
	offset?: number;
	/** seconds between a sample leaving the decoder and reaching the ear; subtracted */
	latency?: number;
}

/** Largest rate at which the interpolation is bent toward the element's time (fraction of real time). */
export const SLEW = 0.25;
/** A sample this far from the prediction is a discontinuity, not drift. */
export const SNAP_S = 0.2;
const HAVE_FUTURE_DATA = 3;

const RE_ANCHOR = [
	'seeking',
	'seeked',
	'play',
	'playing',
	'pause',
	'waiting',
	'stalled',
	'ended',
	'emptied',
	'canplay',
	'loadedmetadata'
] as const;

export class MasterClock {
	/** increases by one at every discontinuity (seek, snap, new source), so renderers can refill buffers */
	epoch = 0;
	/** discontinuities that were not announced by a media event */
	snaps = 0;

	readonly #media: MediaLike;
	readonly #perf: () => number;
	#offset: number;
	#latency: number;

	#anchorMedia = 0; // element time at #anchorPerf
	#anchorPerf = 0;
	#rate = 1;
	#lastRaw = Number.NaN;
	#lastMedia = 0; // element-timeline value returned by the last now()
	#lastPerf = 0;
	#pending = 0; // part of the last sample's error not yet absorbed
	#advancing = false;
	readonly #listener = () => this.#onEvent();
	readonly #rateListener = () => this.#onRate();

	constructor(media: MediaLike, opts: ClockOptions = {}) {
		this.#media = media;
		this.#perf = opts.perfNow ?? (() => performance.now());
		this.#offset = opts.offset ?? 0;
		this.#latency = opts.latency ?? 0;
		for (const e of RE_ANCHOR) media.addEventListener(e, this.#listener);
		media.addEventListener('ratechange', this.#rateListener);
		this.#reset(this.#perf());
		this.#lastMedia = media.currentTime;
		this.#rate = media.playbackRate;
	}

	/** Smooth WAV-timeline seconds. Cheap enough to call many times per frame. */
	now(): number {
		const m = this.#media;
		const perf = this.#perf();
		const raw = m.currentTime;
		const adv = this.#isAdvancing();

		if (!adv) {
			// paused, seeking, stalled or ended: the element's time is exact and not moving
			this.#advancing = false;
			// A big move while not advancing is a seek. The element announces it with an event, but the event
			// is dispatched a task later, and the frame in between must already see a discontinuity.
			if (Math.abs(raw - this.#lastMedia) > SNAP_S) this.epoch++;
			this.#anchorMedia = raw;
			this.#anchorPerf = perf;
			this.#lastPerf = perf;
			this.#lastMedia = raw;
			return raw + this.#offset - this.#latency;
		}
		if (!this.#advancing) {
			this.#advancing = true;
			this.#anchorMedia = raw;
			this.#anchorPerf = perf;
			this.#lastRaw = raw;
			this.#lastPerf = perf;
			this.#pending = 0;
			if (Math.abs(raw - this.#lastMedia) > SNAP_S) this.epoch++;
			this.#lastMedia = raw;
			return raw + this.#offset - this.#latency;
		}

		const dtS = Math.max(0, (perf - this.#lastPerf) / 1000);
		this.#lastPerf = perf;
		let predicted = this.#anchorMedia + ((perf - this.#anchorPerf) * this.#rate) / 1000;

		if (raw !== this.#lastRaw) {
			// a fresh sample from the element
			this.#lastRaw = raw;
			const err = raw - predicted;
			if (Math.abs(err) > SNAP_S) {
				this.snaps++;
				this.epoch++;
				this.#anchorMedia = raw;
				this.#anchorPerf = perf;
				this.#pending = 0;
				predicted = raw;
			} else {
				this.#pending = err;
			}
		}
		if (this.#pending !== 0) {
			const lim = SLEW * dtS * this.#rate;
			const c = Math.max(-lim, Math.min(lim, this.#pending));
			this.#anchorMedia += c;
			this.#pending -= c;
			predicted += c;
		}
		this.#lastMedia = predicted;
		return predicted + this.#offset - this.#latency;
	}

	/** The element's own time on the WAV timeline, without interpolation (for debugging and tests). */
	rawNow(): number {
		return this.#media.currentTime + this.#offset - this.#latency;
	}

	get playing(): boolean {
		return this.#isAdvancing();
	}

	get rate(): number {
		return this.#rate;
	}

	setOffset(seconds: number): void {
		this.#offset = seconds;
	}

	setLatency(seconds: number): void {
		this.#latency = seconds;
	}

	dispose(): void {
		for (const e of RE_ANCHOR) this.#media.removeEventListener(e, this.#listener);
		this.#media.removeEventListener('ratechange', this.#rateListener);
	}

	#isAdvancing(): boolean {
		const m = this.#media;
		return !m.paused && !m.ended && !m.seeking && m.readyState >= HAVE_FUTURE_DATA;
	}

	#reset(perf: number): void {
		this.#anchorMedia = this.#media.currentTime;
		this.#anchorPerf = perf;
		this.#lastPerf = perf;
		this.#lastRaw = Number.NaN;
		this.#pending = 0;
		this.#advancing = false;
	}

	#onEvent(): void {
		this.epoch++;
		this.#reset(this.#perf());
	}

	#onRate(): void {
		// continue from where the old rate had us, then run at the new rate: no jump
		const perf = this.#perf();
		if (this.#advancing) {
			this.#anchorMedia += ((perf - this.#anchorPerf) * this.#rate) / 1000;
			this.#anchorPerf = perf;
			this.#lastPerf = perf;
		}
		this.#rate = this.#media.playbackRate;
	}
}
