/**
 * Reactive transport state for the UI (T3.2.1).
 *
 * Only what the interface shows lives in `$state`: status, piece, bar, a coarse position (10 Hz at most)
 * and a few flags. The render loop never reads this: it asks `engine.clock.now()` every frame, so
 * nothing in Svelte re-renders at 60 Hz.
 */

import type { PlaybackEngine, Status } from './engine.js';

/** Interval of the coarse position used for the time label and the seek bar. */
export const POSITION_MS = 100;
/** Buffering shorter than this is not shown as a spinner (a seek inside buffered audio takes a few ms). */
export const SPINNER_DELAY_MS = 250;

export class Transport {
	status = $state<Status>('idle');
	duration = $state(0);
	/** seconds on the WAV timeline, updated at most every POSITION_MS */
	position = $state(0);
	pieceId = $state<string | null>(null);
	bar = $state<number | null>(null);
	pass = $state(1);
	rate = $state(1);
	/** 0..1 of the audio file fetched so far */
	loaded = $state(0);
	/** true when audio has been buffering for longer than SPINNER_DELAY_MS */
	spinner = $state(false);
	error = $state<string | null>(null);

	readonly engine: PlaybackEngine;
	#timer: ReturnType<typeof setInterval> | null = null;
	#spin: ReturnType<typeof setTimeout> | null = null;
	#off: () => void;

	constructor(engine: PlaybackEngine) {
		this.engine = engine;
		this.#off = engine.subscribe(() => this.#sync());
		// the engine only re-reads the piece and bar on media events, and a buffered file fires none while it plays
		this.#timer = setInterval(() => {
			engine.update();
			this.#sync();
		}, POSITION_MS);
		this.#sync();
	}

	get isPlaying(): boolean {
		return this.status === 'playing' || this.status === 'buffering';
	}

	#sync(): void {
		const e = this.engine;
		this.status = e.status;
		this.duration = e.duration;
		this.position = e.clock.now();
		this.pieceId = e.piece?.id ?? null;
		this.bar = e.bar?.n ?? null;
		this.pass = e.bar?.pass ?? 1;
		this.rate = e.rate;
		this.loaded = e.loadedFraction;
		this.error = e.error;
		this.#updateSpinner(e.status === 'buffering');
	}

	#updateSpinner(buffering: boolean): void {
		if (buffering) {
			if (!this.spinner && this.#spin === null) {
				this.#spin = setTimeout(() => {
					this.#spin = null;
					this.spinner = this.engine.status === 'buffering';
				}, SPINNER_DELAY_MS);
			}
		} else {
			if (this.#spin !== null) clearTimeout(this.#spin);
			this.#spin = null;
			this.spinner = false;
		}
	}

	dispose(): void {
		this.#off();
		if (this.#timer !== null) clearInterval(this.#timer);
		if (this.#spin !== null) clearTimeout(this.#spin);
		this.#timer = null;
		this.#spin = null;
	}
}
