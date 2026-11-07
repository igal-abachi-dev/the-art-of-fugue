/** Test doubles for the playback code: a virtual clock and a media element that behaves like a browser's. */

import type { MediaLike } from './clock.js';

export class VirtualTime {
	ms = 1000;
	now = (): number => this.ms;
}

/**
 * Behaves like an `<audio>` element for the properties the clock reads:
 * `currentTime` is the true position rounded down to `quantum` seconds (browsers update it in steps),
 * `seeking` is true from the assignment until `finishSeek()`, and `readyState` can be dropped to simulate a stall.
 * `speed` is the true speed of the audio hardware relative to the clock (1.001 = runs 0.1 % fast).
 */
export class FakeMedia extends EventTarget implements MediaLike {
	paused = true;
	ended = false;
	src = '';
	crossOrigin: string | null = null;
	preload = 'none';
	volume = 1;
	preservesPitch = false;
	defaultPlaybackRate = 1;
	error: { code: number } | null = null;
	/** buffered ranges as [start, end] pairs; defaults to everything */
	ranges: [number, number][] = [[0, 5000]];
	loads = 0;
	playRejects: string | null = null;
	seeking = false;
	readyState = 4;
	playbackRate = 1;
	duration = 4832.498;
	speed = 1;
	quantum: number;
	#truth = 0;
	readonly #time: VirtualTime;

	constructor(time: VirtualTime, quantum = 0.02) {
		super();
		this.#time = time;
		this.quantum = quantum;
	}

	get currentTime(): number {
		return this.quantum > 0 ? Math.floor(this.#truth / this.quantum) * this.quantum : this.#truth;
	}

	set currentTime(v: number) {
		this.#truth = v;
		this.seeking = true;
		this.emit('seeking');
	}

	/** the true, unquantized position */
	get truth(): number {
		return this.#truth;
	}

	override addEventListener(type: string, listener: () => void): void {
		super.addEventListener(type, listener);
	}

	override removeEventListener(type: string, listener: () => void): void {
		super.removeEventListener(type, listener);
	}

	emit(type: string): void {
		this.dispatchEvent(new Event(type));
	}

	get buffered() {
		const r = this.ranges;
		return {
			get length() {
				return r.length;
			},
			start: (i: number) => r[i][0],
			end: (i: number) => r[i][1]
		};
	}

	removeAttribute(name: string): void {
		if (name === 'crossorigin') this.crossOrigin = null;
		if (name === 'src') this.src = '';
	}

	load(): void {
		this.loads++;
		this.emit('loadstart');
		this.emit('loadedmetadata');
	}

	play(): Promise<void> {
		if (this.playRejects) return Promise.reject(new DOMException('blocked', this.playRejects));
		this.paused = false;
		this.emit('play');
		this.emit('playing');
		return Promise.resolve();
	}

	pause(): void {
		this.paused = true;
		this.emit('pause');
	}

	finishSeek(): void {
		this.seeking = false;
		this.emit('seeked');
	}

	setRate(r: number): void {
		this.playbackRate = r;
		this.emit('ratechange');
	}

	stall(): void {
		this.readyState = 2;
		this.emit('waiting');
	}

	recover(): void {
		this.readyState = 4;
		this.emit('canplay');
		this.emit('playing');
	}

	/** move virtual time forward `ms` in steps of `stepMs`, calling `each` after every step */
	run(ms: number, stepMs = 4, each?: () => void): void {
		let left = ms;
		while (left > 0) {
			const d = Math.min(stepMs, left);
			left -= d;
			this.#time.ms += d;
			if (!this.paused && !this.ended && !this.seeking && this.readyState >= 3) {
				this.#truth += (d / 1000) * this.playbackRate * this.speed;
			}
			each?.();
		}
	}
}
