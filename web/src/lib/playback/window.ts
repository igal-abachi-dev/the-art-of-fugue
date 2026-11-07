/**
 * Note window query (T3.1.4): which notes of a piece are sounding, about to sound, or just ended at time t.
 *
 * Notes are stored sorted by `t_on`, so the notes that start in (t, t+lookAhead] are one contiguous index
 * range. "Active" and "recently ended" notes started at or before t but can start much earlier (a held
 * note); a prefix maximum of `t_off` (non-decreasing, so binary-searchable) bounds how far back the scan
 * must start. Everything is written into preallocated typed arrays: a query allocates nothing.
 */

import type { NoteColumns } from '../data/notes.js';

export class NoteWindow {
	readonly notes: NoteColumns;
	/** prefix maximum of t_off */
	readonly maxOff: Float32Array;

	/** indices (into the note columns) of notes with t_on <= t < t_off */
	readonly active: Int32Array;
	activeCount = 0;
	/** indices of notes with t - lookBehind < t_off <= t, i.e. ended within the look-behind */
	readonly ended: Int32Array;
	endedCount = 0;
	/** notes with t < t_on <= t + lookAhead are the index range [upcomingStart, upcomingEnd) */
	upcomingStart = 0;
	upcomingEnd = 0;
	/** true if `active` or `ended` was too small and some indices were dropped */
	truncated = false;
	/** `range()`: every note that can be on screen is in the index range [rangeStart, rangeEnd) */
	rangeStart = 0;
	rangeEnd = 0;
	/** `startedBetween()`: notes that began in the interval are the index range [startedStart, startedEnd) */
	startedStart = 0;
	startedEnd = 0;

	constructor(notes: NoteColumns, capacity = 1024) {
		this.notes = notes;
		this.active = new Int32Array(capacity);
		this.ended = new Int32Array(capacity);
		const m = new Float32Array(notes.n);
		let run = -Infinity;
		for (let i = 0; i < notes.n; i++) {
			if (notes.t_off[i] > run) run = notes.t_off[i];
			m[i] = run;
		}
		this.maxOff = m;
	}

	/** First index whose `t_on` is greater than x (n if none). */
	#firstStartAfter(x: number): number {
		const a = this.notes.t_on;
		let lo = 0;
		let hi = this.notes.n;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (a[mid] > x) hi = mid;
			else lo = mid + 1;
		}
		return lo;
	}

	/** First index from which some note can still be sounding at x, i.e. prefix max of t_off > x. */
	#firstMaybeSounding(x: number): number {
		const a = this.maxOff;
		let lo = 0;
		let hi = this.notes.n;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (a[mid] > x) hi = mid;
			else lo = mid + 1;
		}
		return lo;
	}

	/** Fill `active`, `ended` and the upcoming range for time `t` (seconds on the WAV timeline). */
	query(t: number, lookAhead: number, lookBehind: number): void {
		const { t_off } = this.notes;
		const hi = this.#firstStartAfter(t);
		this.upcomingStart = hi;
		this.upcomingEnd = this.#firstStartAfter(t + lookAhead);
		let na = 0;
		let ne = 0;
		this.truncated = false;
		const capA = this.active.length;
		const capE = this.ended.length;
		for (let i = this.#firstMaybeSounding(t - lookBehind); i < hi; i++) {
			const off = t_off[i];
			if (off > t) {
				if (na < capA) this.active[na++] = i;
				else this.truncated = true;
			} else if (off > t - lookBehind) {
				if (ne < capE) this.ended[ne++] = i;
				else this.truncated = true;
			}
		}
		this.activeCount = na;
		this.endedCount = ne;
	}

	/**
	 * The index range [rangeStart, rangeEnd) of every note that is, or will be within `lookAhead`, or was within
	 * `lookBehind`, on screen at `t`. Notes outside it are certainly invisible; some inside it may already be
	 * (a note held over from before, or one that has ended) and the renderer culls those by time.
	 */
	range(t: number, lookAhead: number, lookBehind: number): void {
		this.rangeStart = this.#firstMaybeSounding(t - lookBehind);
		this.rangeEnd = this.#firstStartAfter(t + lookAhead);
		if (this.rangeEnd < this.rangeStart) this.rangeEnd = this.rangeStart;
	}

	/** The notes with a < t_on <= b, as the index range [startedStart, startedEnd). */
	startedBetween(a: number, b: number): void {
		this.startedStart = this.#firstStartAfter(a);
		this.startedEnd = Math.max(this.startedStart, this.#firstStartAfter(b));
	}
}
