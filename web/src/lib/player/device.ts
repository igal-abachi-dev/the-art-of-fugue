/**
 * What the interface asks of the device (T7.5.1, T7.5.2): whether it is a phone, whether the system wants less motion,
 * and the budget a phone has to show before the ambient layer comes on.
 */

import { DOWN_FPS, UP_FPS } from '../visual/governor.js';

/** A phone starts the quality ladder at this level instead of the top (bloom off, 2048 particles, dpr at most 1.25). */
export const PHONE_START_LEVEL = 2;

export interface DeviceInfo {
	/** the primary pointer is coarse (a finger) */
	coarse: boolean;
	/** the shorter side of the screen in CSS pixels */
	shortSide: number;
}

/** A coarse pointer on a screen whose short side is at most 820 px (a tablet in portrait is 768 to 834; phones are under 500). */
export function isPhone(d: DeviceInfo | null = readDevice()): boolean {
	return !!d && d.coarse && d.shortSide <= 820;
}

export function readDevice(): DeviceInfo | null {
	try {
		if (typeof window === 'undefined') return null;
		return {
			coarse: window.matchMedia('(pointer: coarse)').matches,
			shortSide: Math.min(window.screen.width, window.screen.height, window.innerWidth || Infinity)
		};
	} catch {
		return null;
	}
}

/** Whether the system asks for less motion right now. */
export function systemWantsLessMotion(): boolean {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

/** Tell `fn` whenever the system's reduced-motion setting changes; returns the function that stops it. */
export function watchReducedMotion(fn: (reduced: boolean) => void): () => void {
	try {
		const q = window.matchMedia('(prefers-reduced-motion: reduce)');
		const on = (e: MediaQueryListEvent) => fn(e.matches);
		q.addEventListener('change', on);
		return () => q.removeEventListener('change', on);
	} catch {
		return () => {};
	}
}

/**
 * The frame budget a phone has to show before the ambient (MilkDrop) layer is switched on: the frame rate has held the
 * governor's "step up" mark for `NEED_S` seconds of playing in a row. Until then the picture is the notes alone. Once on,
 * the governor's own ladder takes the layer away again if the frames get slow (level 4). A device that is not a phone
 * has the layer from the start.
 */
export class AmbientBudget {
	static readonly NEED_S = 6;
	#row = 0;
	#on: boolean;

	constructor(startOn: boolean) {
		this.#on = startOn;
	}

	get allowed(): boolean {
		return this.#on;
	}

	/** One reading: the frame rate over the last half second, the seconds since the last reading, and whether it is playing. */
	observe(fps: number, dt: number, playing: boolean): void {
		if (this.#on) return;
		if (!playing || fps < DOWN_FPS) {
			this.#row = 0;
			return;
		}
		this.#row = fps >= UP_FPS ? this.#row + dt : 0;
		if (this.#row >= AmbientBudget.NEED_S) this.#on = true;
	}
}
