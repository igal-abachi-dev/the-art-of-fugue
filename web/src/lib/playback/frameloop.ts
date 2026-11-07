/**
 * Render-loop driver (T3.1.2, T3.2.1).
 *
 * One `requestAnimationFrame` loop reads the master clock *imperatively* each frame and hands the time
 * to the renderers. It keeps running while the audio is paused: a seek made while paused must redraw the
 * right frame, and a loop that only ticks while playing (the pasted snippet this replaces) leaves the old
 * picture on screen. A frame reports `moved` (time changed since the last frame) and `discontinuity`
 * (the clock's epoch changed: a seek, a snap, a new source), so renderers can skip work when nothing
 * changed and refill their buffers when something jumped. Nothing here touches Svelte state, so the UI
 * is not re-rendered per frame.
 */

import type { MasterClock } from './clock.js';

export interface Frame {
	/** WAV-timeline seconds */
	t: number;
	/** seconds since the previous frame (0 on the first) */
	dt: number;
	/** the time differs from the previous frame's */
	moved: boolean;
	/** the clock jumped (seek, snap, new source) since the previous frame */
	discontinuity: boolean;
	/** performance.now() at the start of the frame */
	wall: number;
}

export type FrameCallback = (frame: Frame) => void;

export interface Scheduler {
	request(cb: (ms: number) => void): number;
	cancel(id: number): void;
}

export const browserScheduler: Scheduler = {
	request: (cb) => requestAnimationFrame(cb),
	cancel: (id) => cancelAnimationFrame(id)
};

export class FrameLoop {
	readonly #clock: MasterClock;
	readonly #sched: Scheduler;
	readonly #subs = new Set<FrameCallback>();
	#id = 0;
	#running = false;
	#lastT = Number.NaN;
	#lastWall = Number.NaN;
	#lastEpoch = -1;
	/** reused every frame: callbacks must not keep a reference */
	readonly #frame: Frame = { t: 0, dt: 0, moved: false, discontinuity: false, wall: 0 };
	/** frames delivered since start, for tests and the HUD */
	frames = 0;

	constructor(clock: MasterClock, sched: Scheduler = browserScheduler) {
		this.#clock = clock;
		this.#sched = sched;
	}

	get running(): boolean {
		return this.#running;
	}

	subscribe(cb: FrameCallback): () => void {
		this.#subs.add(cb);
		return () => this.#subs.delete(cb);
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		this.#lastWall = Number.NaN;
		this.#id = this.#sched.request(this.#tick);
	}

	stop(): void {
		this.#running = false;
		this.#sched.cancel(this.#id);
	}

	readonly #tick = (wall: number): void => {
		if (!this.#running) return;
		this.#id = this.#sched.request(this.#tick);
		const t = this.#clock.now();
		const f = this.#frame;
		f.wall = wall;
		f.t = t;
		f.dt = Number.isNaN(this.#lastWall) ? 0 : Math.max(0, (wall - this.#lastWall) / 1000);
		f.moved = t !== this.#lastT;
		f.discontinuity = this.#clock.epoch !== this.#lastEpoch;
		this.#lastT = t;
		this.#lastWall = wall;
		this.#lastEpoch = this.#clock.epoch;
		this.frames++;
		for (const cb of this.#subs) cb(f);
	};
}
