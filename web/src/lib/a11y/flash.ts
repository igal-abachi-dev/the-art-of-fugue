/**
 * Flash analysis of the frames the listener sees (T7.5.1), after WCAG 2.3.1 "Three Flashes or Below Threshold".
 *
 * A **general flash** is a pair of opposing changes in the relative luminance of a pixel of 10 % of the maximum (0.1 on the 0..1
 * scale) or more, where the darker of the two values is below 0.80. A **red flash** is the same for a transition to or from a
 * saturated red (`R / (R + G + B) >= 0.8`), with the change measured in `(R - G - B) * 320` and a threshold of 20. The page
 * fails when more than three flashes happen in any one second over an area of more than a quarter of a 10° field of view.
 * At the usual 1024 x 768 reading size that field is 341 x 256 px, so a quarter of it is 2.8 % of the screen.
 *
 * This is a stricter measure than the standard asks for: it counts the pixels that flash anywhere on the frame, scattered or
 * together, against that 2.8 % (the standard counts them inside one field of view, so a scatter that is spread wider than a
 * field would pass it). It works on frames downscaled to a small grid, so single-pixel sparkle of the particles is averaged
 * into its neighbours, which is also how the eye sees a spark of that size from a reading distance.
 *
 * The tracker keeps, per pixel, the last extreme and the direction of travel, and records the time of each change that
 * is at least the threshold in the opposite direction. A pair of opposing changes is a flash, so a second with more than
 * six changes holds more than three flashes.
 */

/** the area of a field of view that may flash, as a fraction of the frame (a quarter of 341 x 256 of 1024 x 768) */
export const AREA_LIMIT = 0.025;
/** transitions in one second above which a pixel flashes too often (more than three flashes = more than six changes) */
export const CHANGES_LIMIT = 6;
export const GENERAL_DELTA = 0.1;
export const BRIGHT_CAP = 0.8;
export const RED_DELTA = 20;
const RING = 8;
const WINDOW_MS = 1000;

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
	const c = i / 255;
	LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** relative luminance (0..1) of an sRGB colour given as 8-bit channels */
export function relativeLuminance(r: number, g: number, b: number): number {
	return 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
}

/** the red measure of a colour: `(R - G - B) * 320` on linear values if it is a saturated red, else 0 */
export function redMeasure(r: number, g: number, b: number): number {
	const R = LIN[r];
	const G = LIN[g];
	const B = LIN[b];
	const sum = R + G + B;
	if (sum <= 0 || R / sum < 0.8) return 0;
	return Math.max(0, (R - G - B) * 320);
}

export interface TrackerOptions {
	/** the change that counts as a transition */
	delta: number;
	/** a transition between two values that are both at or above this does not count (0.8 for luminance) */
	brightCap?: number;
}

export class FlashTracker {
	readonly size: number;
	readonly #delta: number;
	readonly #cap: number;
	readonly #ext: Float32Array;
	readonly #dir: Int8Array;
	readonly #times: Float64Array;
	readonly #pos: Uint8Array;
	#started = false;
	/** the largest fraction of the frame that was flashing too often, over everything pushed so far */
	maxFraction = 0;
	/** the most changes any pixel had in one second */
	maxChanges = 0;
	frames = 0;

	constructor(size: number, opts: TrackerOptions) {
		this.size = size;
		this.#delta = opts.delta;
		this.#cap = opts.brightCap ?? Infinity;
		this.#ext = new Float32Array(size);
		this.#dir = new Int8Array(size);
		this.#times = new Float64Array(size * RING).fill(-Infinity);
		this.#pos = new Uint8Array(size);
	}

	/** One frame, `values[i]` the measure of pixel i, at `tMs` milliseconds. Returns the fraction flashing too often now. */
	push(tMs: number, values: ArrayLike<number>): number {
		const n = this.size;
		if (!this.#started) {
			for (let i = 0; i < n; i++) this.#ext[i] = values[i];
			this.#started = true;
			this.frames = 1;
			return 0;
		}
		this.frames++;
		// the window is open at its far end by half a millisecond, so that a change exactly one second ago (and the rounding of
		// the clock) is not counted in two windows
		const from = tMs - WINDOW_MS + 0.5;
		let over = 0;
		for (let i = 0; i < n; i++) {
			const v = values[i];
			const e = this.#ext[i];
			const d = this.#dir[i];
			let changed = false;
			if (d === 0) {
				// not yet moved: the first move of at least the threshold sets the direction and counts as a change
				if (Math.abs(v - e) >= this.#delta) {
					this.#dir[i] = v > e ? 1 : -1;
					this.#ext[i] = v;
					changed = Math.min(v, e) < this.#cap;
				}
			} else if (d === 1) {
				// rising: follow the peak up, and a fall of at least the threshold from it is a change
				if (v >= e) this.#ext[i] = v;
				else if (e - v >= this.#delta) {
					this.#dir[i] = -1;
					this.#ext[i] = v;
					changed = v < this.#cap;
				}
			} else if (v <= e) this.#ext[i] = v;
			else if (v - e >= this.#delta) {
				this.#dir[i] = 1;
				this.#ext[i] = v;
				changed = e < this.#cap;
			}
			if (changed) {
				const p = this.#pos[i];
				this.#times[i * RING + p] = tMs;
				this.#pos[i] = (p + 1) % RING;
			}
			let count = 0;
			const base = i * RING;
			for (let k = 0; k < RING; k++) if (this.#times[base + k] > from) count++;
			if (count > this.maxChanges) this.maxChanges = count;
			if (count > CHANGES_LIMIT) over++;
		}
		const f = over / n;
		if (f > this.maxFraction) this.maxFraction = f;
		return f;
	}

	get ok(): boolean {
		return this.maxFraction <= AREA_LIMIT;
	}
}

/** One frame of RGBA bytes to the two measures the trackers take. */
export function measures(
	rgba: Uint8ClampedArray | Uint8Array,
	luma: Float32Array,
	red: Float32Array
): void {
	for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
		luma[i] = relativeLuminance(rgba[p], rgba[p + 1], rgba[p + 2]);
		red[i] = redMeasure(rgba[p], rgba[p + 1], rgba[p + 2]);
	}
}

/** The general and the red tracker for frames of `size` pixels. */
export class FlashAnalyser {
	readonly general: FlashTracker;
	readonly red: FlashTracker;
	readonly #luma: Float32Array;
	readonly #redv: Float32Array;

	constructor(size: number) {
		this.general = new FlashTracker(size, { delta: GENERAL_DELTA, brightCap: BRIGHT_CAP });
		this.red = new FlashTracker(size, { delta: RED_DELTA });
		this.#luma = new Float32Array(size);
		this.#redv = new Float32Array(size);
	}

	pushRgba(tMs: number, rgba: Uint8ClampedArray | Uint8Array): void {
		measures(rgba, this.#luma, this.#redv);
		this.general.push(tMs, this.#luma);
		this.red.push(tMs, this.#redv);
	}

	get result(): { general: number; red: number; maxChanges: number; frames: number; ok: boolean } {
		return {
			general: this.general.maxFraction,
			red: this.red.maxFraction,
			maxChanges: Math.max(this.general.maxChanges, this.red.maxChanges),
			frames: this.general.frames,
			ok: this.general.ok && this.red.ok
		};
	}
}
