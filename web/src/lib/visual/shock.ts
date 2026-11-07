/**
 * Shockwave rings (T5.4.2): a small ring buffer of instances for the clash and crossing rings.
 *
 * A ring is born at a playhead time and its look is a function of its age in the shader, so a pause or a seek needs no
 * care here: a ring younger than zero (the playhead went back) is hidden, one older than its life is gone. The pool
 * enforces the rate cap that keeps the picture calm and keeps the flash rate far below the limit of T7.5.1: at most one
 * ring per `MIN_GAP_S`, and at most `CAP` alive.
 */

export const SHOCK_CAP = 12;
/** at least this long between two rings (about three a second at most) */
export const MIN_GAP_S = 0.36;
/** how long a ring lives, seconds (the shader has the same constant) */
export const SHOCK_LIFE_S = 1.1;
export const SHOCK_STRIDE = 4;

export const KIND_CLASH = 0;
export const KIND_CROSSING = 1;

export class ShockPool {
	/** x, birth, strength, voice per ring */
	readonly a = new Float32Array(SHOCK_CAP * SHOCK_STRIDE);
	/** pitch, kind per ring */
	readonly b = new Float32Array(SHOCK_CAP * SHOCK_STRIDE);
	version = 0;
	/** rings accepted and refused by the rate cap since the last `clear`, for tests and the HUD */
	emitted = 0;
	refused = 0;

	#next = 0;
	#lastBirth = -Infinity;

	constructor() {
		this.clear();
	}

	clear(): void {
		this.a.fill(0);
		this.b.fill(0);
		for (let i = 0; i < SHOCK_CAP; i++) this.a[i * SHOCK_STRIDE + 1] = -1e9;
		this.#next = 0;
		this.#lastBirth = -Infinity;
		this.emitted = 0;
		this.refused = 0;
		this.version++;
	}

	/** Start a ring at playhead time `t`. Returns false if the rate cap refused it. */
	emit(
		t: number,
		x: number,
		pitch: number,
		voice: number,
		strength: number,
		kind: number
	): boolean {
		if (t - this.#lastBirth < MIN_GAP_S && t >= this.#lastBirth) {
			this.refused++;
			return false;
		}
		this.#lastBirth = t;
		const o = this.#next * SHOCK_STRIDE;
		this.#next = (this.#next + 1) % SHOCK_CAP;
		this.a[o] = x;
		this.a[o + 1] = t;
		this.a[o + 2] = Math.max(0, Math.min(1, strength));
		this.a[o + 3] = voice;
		this.b[o] = pitch;
		this.b[o + 1] = kind;
		this.emitted++;
		this.version++;
		return true;
	}

	/** Rings alive at playhead time `t`. */
	alive(t: number): number {
		let n = 0;
		for (let i = 0; i < SHOCK_CAP; i++) {
			const age = t - this.a[i * SHOCK_STRIDE + 1];
			if (age >= 0 && age <= SHOCK_LIFE_S) n++;
		}
		return n;
	}
}
