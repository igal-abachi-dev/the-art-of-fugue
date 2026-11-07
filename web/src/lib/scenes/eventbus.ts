/**
 * Event bus for the annotation events of a piece (T5.1.2).
 *
 * The bus is driven by the playhead: `step(t, discontinuity)` fires, in order, every event whose time lies in the interval
 * the playhead covered since the previous step. It has no state besides the previous time, so it is safe against everything
 * a listener can do to the clock:
 *
 * * **seek (a discontinuity), a step backwards, a long stall:** nothing fires for the events that were jumped over, and
 *   nothing that happened earlier is replayed; the interval starts again at the new position, so events still to come
 *   (including one exactly at the landing time) fire when reached;
 * * **pause:** the time does not change, so nothing fires;
 * * **rate and frame rate:** an event fires once, in the frame that contains its time.
 */

import type { PieceEvent } from '../data/manifest.js';

/** a step longer than this is a stall (a hidden tab, a long frame), not playback: do not fire what it covers */
export const MAX_STEP_S = 0.5;
/** the interval after a jump starts this far before the landing time, so an event at the landing time still fires */
const LANDING_EPS = 1e-6;

export type EventHandler = (event: PieceEvent) => void;

export class EventBus {
	readonly events: readonly PieceEvent[];
	readonly #times: Float64Array;
	readonly #handlers = new Map<string, Set<EventHandler>>();
	#last = Number.NaN;
	/** events fired since construction, for tests and the HUD */
	fired = 0;

	constructor(events: readonly PieceEvent[]) {
		this.events = [...events].sort((a, b) => a.t - b.t);
		this.#times = Float64Array.from(this.events, (e) => e.t);
	}

	/** Listen for events of `type` (`'*'` for all). Returns the function that removes the listener. */
	on(type: string, fn: EventHandler): () => void {
		let set = this.#handlers.get(type);
		if (!set) this.#handlers.set(type, (set = new Set()));
		set.add(fn);
		return () => set.delete(fn);
	}

	/** Forget the previous time (a new piece, a lost context). */
	reset(): void {
		this.#last = Number.NaN;
	}

	/** First index whose time is greater than x. */
	#after(x: number): number {
		const a = this.#times;
		let lo = 0;
		let hi = a.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (a[mid] > x) hi = mid;
			else lo = mid + 1;
		}
		return lo;
	}

	/** Fire the events in (previous time, t]. Returns how many fired. */
	step(t: number, discontinuity: boolean): number {
		const last = this.#last;
		if (discontinuity || Number.isNaN(last) || t < last || t - last > MAX_STEP_S) {
			this.#last = t - LANDING_EPS;
			return 0;
		}
		this.#last = t;
		if (t === last) return 0;
		let n = 0;
		for (let i = this.#after(last); i < this.events.length && this.#times[i] <= t; i++) {
			const e = this.events[i];
			for (const fn of this.#handlers.get(e.type) ?? []) fn(e);
			for (const fn of this.#handlers.get('*') ?? []) fn(e);
			n++;
		}
		this.fired += n;
		return n;
	}
}
