/**
 * Repeat modes and the A-B loop (T7.2.5), as plain logic with no browser in it.
 *
 * `LoopController.check()` is asked for the playhead a few dozen times a second and says where to jump, if anywhere. The
 * loop points snap to bar lines (`nearestBar`). A seek on a streamed `<audio>` element is not gapless (docs/interface.md
 * has the measured gap), so this promises a loop, not a seamless one; the visuals follow the clock and loop cleanly.
 */

import { pieceAt, SEEK_SLACK, type Manifest, type PieceEntry } from '../data/manifest.js';
import type { RepeatMode } from './settings.js';

/** the shortest loop, seconds */
export const MIN_LOOP_S = 0.5;
/** a playhead this far past a boundary is a seek that left it behind, not playback reaching it */
const CROSSED_S = 0.75;

export interface LoopRegion {
	a: number;
	b: number;
}

export interface JumpContext {
	/** the piece under the playhead (null in a gap) and its span */
	pieceStart: number | null;
	pieceEnd: number | null;
	/** length of the recording */
	duration: number;
	/** the media element has reached its end */
	ended: boolean;
}

export interface Jump {
	to: number;
	/** the element is paused (it ended) and must be started again */
	play: boolean;
}

export class LoopController {
	repeat: RepeatMode = 'off';
	region: LoopRegion | null = null;

	/** Set the loop between two playhead times (any order). False if they are closer than `MIN_LOOP_S`. */
	setRegion(a: number, b: number): boolean {
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		if (hi - lo < MIN_LOOP_S) return false;
		this.region = { a: lo, b: hi };
		return true;
	}

	clear(): void {
		this.region = null;
	}

	/**
	 * The listener moved the playhead to `t`. A jump outside the loop ends it (no surprise loops); true if it did.
	 */
	userSeek(t: number): boolean {
		const r = this.region;
		if (r && (t < r.a - 0.05 || t >= r.b)) {
			this.region = null;
			return true;
		}
		return false;
	}

	/** The playhead is somewhere that is not the loop (a seek from elsewhere, such as the media keys): the loop is over. */
	outside(t: number): boolean {
		const r = this.region;
		return !!r && (t < r.a - 0.3 || t >= r.b + CROSSED_S);
	}

	/** Where to jump now, or null to keep playing. */
	check(t: number, ctx: JumpContext): Jump | null {
		const r = this.region;
		if (r && t >= r.b && t < r.b + CROSSED_S) return { to: r.a, play: false };
		if (ctx.ended) {
			if (r) return { to: r.a, play: true };
			if (this.repeat === 'all') return { to: 0, play: true };
			return null;
		}
		if (this.repeat === 'piece' && ctx.pieceStart !== null && ctx.pieceEnd !== null) {
			if (t >= ctx.pieceEnd - 0.02 && t < ctx.pieceEnd + CROSSED_S)
				return { to: ctx.pieceStart, play: false };
		}
		if (this.repeat === 'all' && t >= ctx.duration - 0.06) return { to: 0, play: false };
		return null;
	}
}

export interface BarPoint {
	piece: PieceEntry;
	bar: number;
	pass: number;
	/** playhead time of the bar line */
	t: number;
}

/** The bar line nearest to `t` in the piece under it (or the nearest piece in a gap); null if the manifest has no bars. */
export function nearestBar(m: Manifest, t: number): BarPoint | null {
	let best: BarPoint | null = null;
	let bestD = Infinity;
	for (const p of m.pieces) {
		if (p.bars.length === 0) continue;
		// a piece that cannot hold the nearest bar by more than its own span plus a little is skipped
		if (t < p.audio_start - 30 || t > p.audio_end + 30) continue;
		for (const b of p.bars) {
			const d = Math.abs(b.t - t);
			if (d < bestD) {
				bestD = d;
				best = { piece: p, bar: b.n, pass: b.pass ?? 1, t: b.t };
			}
		}
	}
	return best;
}

/** The previous or next bar line from `t` in the piece under it; null at the ends of the piece or in a gap. */
export function stepBar(m: Manifest, t: number, direction: 1 | -1): BarPoint | null {
	const p = pieceAt(m, t);
	if (!p || t >= p.audio_end || p.bars.length === 0) return null;
	// the playhead counts as `SEEK_SLACK` ahead, as everywhere else: a seek to a bar starts a little before it
	const at = t + SEEK_SLACK;
	const mk = (i: number): BarPoint => ({
		piece: p,
		bar: p.bars[i].n,
		pass: p.bars[i].pass ?? 1,
		t: p.bars[i].t
	});
	if (direction > 0) {
		const i = p.bars.findIndex((b) => b.t > at + 0.05);
		return i < 0 ? null : mk(i);
	}
	// "previous" first goes to the start of the bar being played, and only from near its start to the bar before
	let cur = -1;
	for (let i = 0; i < p.bars.length; i++) if (p.bars[i].t <= at) cur = i;
	if (cur < 0) return null;
	if (at - p.bars[cur].t > 0.6) return mk(cur);
	return cur > 0 ? mk(cur - 1) : null;
}
