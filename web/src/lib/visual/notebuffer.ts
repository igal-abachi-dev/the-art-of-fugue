/**
 * The per-instance data of the falling notes (T4.2.2), kept resident in one Float32Array that backs the
 * GPU instance attributes.
 *
 * Notes are sorted by onset, so the notes that can be on screen at time t are one index range
 * [lo, hi) (`NoteWindow.range`). Note `i` always lives in slot `i % capacity`; any window of at most
 * `capacity` indices therefore has no two notes in the same slot. Moving the playhead forward just writes
 * the few notes that entered the range; a seek writes the notes of the new range that were not already
 * resident. Slots that hold a note outside the range are stale but harmless: a note below `lo` ended before
 * the visible past began, a note at or above `hi` starts after the visible future ends, and the vertex shader
 * culls both by time. Nothing here allocates after construction, and nothing walks all the notes of a piece.
 *
 * Per instance, four vec4:
 *   a0 = x (key centre), t_on, t_off, voice
 *   a1 = velocity 0..1, flags, pitch, key width
 *   a2 = x, pitch and key width of the note's mirror counterpart (pitch 0 = none)
 *   a3 = scene tag bits (`TAG_*`), theme 0..6, time-scaling class (`RATIO_*`), 0
 */

import { pitchToX, pitchWidth } from './keyboard.js';
import type { NoteWindow } from '../playback/window.js';
import type { NoteTags } from '../scenes/tags.js';

export const NOTE_STRIDE = 16;
/** t_on / t_off of an empty slot: far in the past, so the shader culls it */
const NEVER = -1e9;

export class NoteBuffer {
	readonly capacity: number;
	readonly data: Float32Array;
	/** increases whenever `data` changed, for the renderer to upload */
	version = 0;
	/** notes written by the last `update` */
	written = 0;
	/** the visible range had more notes than the buffer holds; the farthest-future ones are left out */
	truncated = false;
	/** total notes written since `setWindow` (for tests and the HUD) */
	totalWritten = 0;

	#win: NoteWindow | null = null;
	#tags: NoteTags | null = null;
	#lo = 0;
	#hi = 0;
	#valid = false;

	constructor(capacity = 1024) {
		this.capacity = capacity;
		this.data = new Float32Array(capacity * NOTE_STRIDE);
		this.#clear();
	}

	/** the resident index range after the last update */
	get range(): readonly [number, number] {
		return [this.#lo, this.#hi];
	}

	/** Switch to the notes of another piece (or none). */
	setWindow(win: NoteWindow | null): void {
		this.#win = win;
		this.#tags = null;
		this.invalidate();
	}

	/** Annotation tags of the current piece's notes (or none); the notes are rewritten on the next update. */
	setTags(tags: NoteTags | null): void {
		this.#tags = tags && tags.n === this.#win?.notes.n ? tags : null;
		this.invalidate();
	}

	/** Forget what is resident (a lost GL context, a changed piece): the next update rewrites the whole range. */
	invalidate(): void {
		this.#valid = false;
		this.#clear();
		this.version++;
	}

	#clear(): void {
		const d = this.data;
		for (let s = 0; s < this.capacity; s++) {
			const o = s * NOTE_STRIDE;
			d[o] = 0;
			d[o + 1] = NEVER;
			d[o + 2] = NEVER;
			d[o + 3] = 0;
			d[o + 4] = 0;
			d[o + 5] = 0;
			d[o + 6] = 0;
			d[o + 7] = 0;
			for (let k = 8; k < NOTE_STRIDE; k++) d[o + k] = 0;
		}
	}

	#write(i: number): void {
		const n = this.#win!.notes;
		const o = (i % this.capacity) * NOTE_STRIDE;
		const d = this.data;
		const pitch = n.pitch[i];
		d[o] = pitchToX(pitch);
		d[o + 1] = n.t_on[i];
		d[o + 2] = n.t_off[i];
		d[o + 3] = n.voice[i];
		d[o + 4] = n.vel[i] / 255;
		d[o + 5] = n.flags[i];
		d[o + 6] = pitch;
		d[o + 7] = pitchWidth(pitch);
		const tags = this.#tags;
		const g = tags ? tags.ghost[i] : 0;
		d[o + 8] = g ? pitchToX(g) : 0;
		d[o + 9] = g;
		d[o + 10] = g ? pitchWidth(g) : 0;
		d[o + 11] = 0;
		d[o + 12] = tags ? tags.bits[i] : 0;
		d[o + 13] = tags ? tags.theme[i] : 0;
		d[o + 14] = tags ? tags.ratio[i] : 0;
		d[o + 15] = tags ? 1 : 0;
	}

	/**
	 * Make the notes that are visible at `t` (seconds), with `ahead` seconds of future and `behind` of past,
	 * resident. Returns true if anything was written.
	 */
	update(t: number, ahead: number, behind: number): boolean {
		const win = this.#win;
		this.written = 0;
		if (!win) return false;
		win.range(t, ahead, behind);
		const lo = win.rangeStart;
		let hi = win.rangeEnd;
		this.truncated = hi - lo > this.capacity;
		if (this.truncated) hi = lo + this.capacity;

		let count = 0;
		if (!this.#valid || hi <= this.#lo || lo >= this.#hi) {
			// first fill, or a seek that left nothing in common
			for (let i = lo; i < hi; i++) this.#write(i);
			count = hi - lo;
		} else {
			// write the part of [lo, hi) outside the old resident range [#lo, #hi)
			const left = Math.min(hi, this.#lo);
			for (let i = lo; i < left; i++) this.#write(i);
			count += Math.max(0, left - lo);
			const from = Math.max(lo, this.#hi);
			for (let i = from; i < hi; i++) this.#write(i);
			count += Math.max(0, hi - from);
		}
		this.#lo = lo;
		this.#hi = hi;
		this.#valid = true;
		this.written = count;
		this.totalWritten += count;
		if (count > 0) this.version++;
		return count > 0;
	}
}
