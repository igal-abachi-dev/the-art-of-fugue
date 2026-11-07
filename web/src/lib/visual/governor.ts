/**
 * Performance governor (T4.1.3).
 *
 * It watches frame times and steps through a ladder of quality levels: level 0 is everything on; each step
 * down costs the least visible thing next, and level 5 is the bare piano roll (bloom goes at level 2, the ambient layer at level 4). Stepping is deliberately slow
 * and sticky so the picture does not flicker between settings.
 *
 * Thresholds (all exported, all documented in docs/visual.md):
 * - the frame rate is measured over 0.5 s windows;
 * - below `DOWN_FPS` (50) for `DOWN_AFTER_S` (2 s) in a row: one level down;
 * - at or above `UP_FPS` (55) for `UP_AFTER_S` (12 s) in a row: one level up (it was 58, which a display that runs at 57 Hz,
 *   as the one the T9.3.1 numbers were taken on does, can never reach: the governor then could never step back up, and the
 *   phone's ambient layer, which waits for the same rate, never came on; found when `pnpm player-check` failed in Edge);
 * - after a step down, no step up for `HOLD_S` (8 s); if the level above was left less than `RELAPSE_S` (30 s)
 *   ago, the wait before trying it again doubles (up to `MAX_UP_AFTER_S`), so a scene the GPU cannot hold
 *   settles instead of oscillating;
 * - a gap over `STALL_S` (0.25 s) between frames (a hidden tab, a debugger, a seek that loads data) is ignored, **unless**
 *   `SLOW_RUN` (6) of them come in a row, none is over `SLOW_MAX_S` (0.8 s) and together they last `SLOW_SPAN_S` (2 s): that
 *   is a machine that renders 1 to 4 frames a second, not a stall (a stage compiling its shaders, a seek that loads data, make a
 *   few long frames and not two seconds of them), and its frames count (found by `pnpm perf-check`: a software-rendered, 8x slowed machine made about
 *   4 frames a second and the governor, taking every gap for a stall, never lowered anything).
 *
 * The target is 60 fps. A display that refreshes at 30 Hz sits below `DOWN_FPS` and ends at the lowest level;
 * that is accepted (such displays are very rare).
 */

export const DOWN_FPS = 50;
export const UP_FPS = 55;
export const DOWN_AFTER_S = 2;
export const UP_AFTER_S = 12;
export const HOLD_S = 8;
export const RELAPSE_S = 30;
export const MAX_UP_AFTER_S = 96;
export const STALL_S = 0.25;
export const SLOW_RUN = 6;
export const SLOW_SPAN_S = 2;
export const SLOW_MAX_S = 0.8;
const WINDOW_S = 0.5;

export interface Quality {
	level: number;
	/** upper bound for the device pixel ratio */
	dprCap: number;
	/** most particles alive at once; 0 turns them off */
	particleCap: number;
	trails: boolean;
	glow: boolean;
	/** the loudness bloom (T6.2.1), a full-screen post-process: the first thing to go */
	bloom: boolean;
	/**
	 * size of the ambient MilkDrop layer as a fraction of the stage's CSS size (0 = layer off). It is a soft background,
	 * so it is drawn small and scaled up by the browser.
	 */
	ambientScale: number;
}

/** The ladder, best first. */
export const LEVELS: readonly Quality[] = [
	{
		level: 0,
		dprCap: 2,
		particleCap: 4096,
		trails: true,
		glow: true,
		bloom: true,
		ambientScale: 0.5
	},
	{
		level: 1,
		dprCap: 1.5,
		particleCap: 4096,
		trails: true,
		glow: true,
		bloom: true,
		ambientScale: 0.5
	},
	{
		level: 2,
		dprCap: 1.25,
		particleCap: 2048,
		trails: true,
		glow: true,
		bloom: false,
		ambientScale: 0.4
	},
	{
		level: 3,
		dprCap: 1,
		particleCap: 1024,
		trails: false,
		glow: true,
		bloom: false,
		ambientScale: 0.3
	},
	{
		level: 4,
		dprCap: 1,
		particleCap: 0,
		trails: false,
		glow: false,
		bloom: false,
		ambientScale: 0
	},
	{
		level: 5,
		dprCap: 0.75,
		particleCap: 0,
		trails: false,
		glow: false,
		bloom: false,
		ambientScale: 0
	}
];

export const MAX_LEVEL = LEVELS.length - 1;

export class Governor {
	#level: number;
	#lowFor = 0; // seconds in a row under DOWN_FPS
	#highFor = 0; // seconds in a row at or above UP_FPS
	#sinceDown = Infinity;
	#upAfter = UP_AFTER_S;
	#sinceUp = Infinity;
	#acc = 0;
	#longRun = 0; // frames in a row that took longer than STALL_S, and how long they took together
	#longSpan = 0;
	#frames = 0;
	#fps = 60;
	/** levels changed since construction, for the HUD and tests */
	changes = 0;
	/** fixed levels (from a URL or the user) are never changed automatically */
	locked = false;

	constructor(startLevel = 0) {
		this.#level = Math.min(MAX_LEVEL, Math.max(0, startLevel));
	}

	get level(): number {
		return this.#level;
	}

	get quality(): Quality {
		return LEVELS[this.#level];
	}

	/** frames per second over the last window (about half a second) */
	get fps(): number {
		return this.#fps;
	}

	/** Pin the level and stop adapting (`undefined` frees it again). */
	force(level: number | undefined): void {
		if (level === undefined) {
			this.locked = false;
			return;
		}
		this.locked = true;
		this.#set(level);
	}

	/** Feed the time between two frames in seconds. Returns true when the level changed. */
	frame(dt: number): boolean {
		if (dt > STALL_S && dt <= SLOW_MAX_S) {
			this.#longRun++;
			this.#longSpan += dt;
		} else {
			this.#longRun = 0;
			this.#longSpan = 0;
		}
		if (
			!(dt > 0) ||
			(dt > STALL_S && (this.#longRun < SLOW_RUN || this.#longSpan < SLOW_SPAN_S)) ||
			dt > SLOW_MAX_S
		) {
			// a stall is not a measurement; start the current window over
			this.#acc = 0;
			this.#frames = 0;
			return false;
		}
		this.#sinceDown += dt;
		this.#sinceUp += dt;
		this.#acc += dt;
		this.#frames++;
		if (this.#acc < WINDOW_S) return false;

		this.#fps = this.#frames / this.#acc;
		const span = this.#acc;
		this.#acc = 0;
		this.#frames = 0;
		if (this.locked) return false;

		if (this.#fps < DOWN_FPS) {
			this.#lowFor += span;
			this.#highFor = 0;
			if (this.#lowFor >= DOWN_AFTER_S && this.#level < MAX_LEVEL) {
				this.#lowFor = 0;
				// coming back down soon after going up means that level cannot be held: wait longer next time
				if (this.#sinceUp < RELAPSE_S) this.#upAfter = Math.min(MAX_UP_AFTER_S, this.#upAfter * 2);
				this.#sinceDown = 0;
				this.#set(this.#level + 1);
				return true;
			}
			return false;
		}
		this.#lowFor = 0;
		if (this.#fps >= UP_FPS) {
			this.#highFor += span;
			if (this.#highFor >= this.#upAfter && this.#sinceDown >= HOLD_S && this.#level > 0) {
				this.#highFor = 0;
				this.#sinceUp = 0;
				this.#set(this.#level - 1);
				return true;
			}
		} else {
			this.#highFor = 0;
		}
		return false;
	}

	#set(level: number): void {
		const next = Math.min(MAX_LEVEL, Math.max(0, level));
		if (next !== this.#level) this.changes++;
		this.#level = next;
	}
}
