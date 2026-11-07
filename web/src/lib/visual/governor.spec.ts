import { describe, expect, it } from 'vitest';
import {
	DOWN_AFTER_S,
	DOWN_FPS,
	Governor,
	HOLD_S,
	LEVELS,
	MAX_LEVEL,
	SLOW_MAX_S,
	SLOW_RUN,
	SLOW_SPAN_S,
	STALL_S,
	UP_AFTER_S,
	UP_FPS
} from './governor.js';

/** run `seconds` of frames at `fps`, returning the number of level changes */
function run(g: Governor, fps: number, seconds: number): number {
	const before = g.changes;
	const dt = 1 / fps;
	for (let t = 0; t < seconds; t += dt) g.frame(dt);
	return g.changes - before;
}

describe('Governor', () => {
	it('stays at full quality at 60 fps', () => {
		const g = new Governor();
		run(g, 60, 120);
		expect(g.level).toBe(0);
		expect(g.fps).toBeGreaterThan(58);
	});

	it('recovers on a display that runs at 57 Hz, which is what the browser sees on the reference machine', () => {
		const g = new Governor();
		run(g, 30, 4); // a seek that hurt: down two levels
		const low = g.level;
		expect(low).toBeGreaterThan(0);
		run(g, 57, 400); // and then the frames hold the display's rate
		expect(g.level).toBe(0);
	});

	it('does not react to a brief dip shorter than the delay', () => {
		const g = new Governor();
		run(g, 60, 5);
		run(g, 30, DOWN_AFTER_S - 0.6);
		run(g, 60, 5);
		expect(g.level).toBe(0);
	});

	it('steps down one level after a sustained drop, then again, down to the floor', () => {
		const g = new Governor();
		run(g, 35, DOWN_AFTER_S + 0.6);
		expect(g.level).toBe(1);
		run(g, 35, DOWN_AFTER_S + 0.6);
		expect(g.level).toBe(2);
		run(g, 35, 60);
		expect(g.level).toBe(MAX_LEVEL);
	});

	it('degrades effects in a fixed order: resolution, particles, bloom, trails, glow, then the ambient layer', () => {
		const levels = LEVELS;
		for (let i = 1; i < levels.length; i++) {
			expect(levels[i].dprCap).toBeLessThanOrEqual(levels[i - 1].dprCap);
			expect(levels[i].particleCap).toBeLessThanOrEqual(levels[i - 1].particleCap);
			if (!levels[i - 1].trails) expect(levels[i].trails).toBe(false);
			if (!levels[i - 1].glow) expect(levels[i].glow).toBe(false);
			if (!levels[i - 1].bloom) expect(levels[i].bloom).toBe(false);
			expect(levels[i].ambientScale).toBeLessThanOrEqual(levels[i - 1].ambientScale);
		}
		expect(levels[0]).toMatchObject({ trails: true, glow: true, bloom: true });
		expect(levels[MAX_LEVEL]).toMatchObject({
			particleCap: 0,
			trails: false,
			glow: false,
			bloom: false,
			ambientScale: 0
		});
	});

	it('comes back up only after a long steady stretch, and not right after a drop', () => {
		const g = new Governor();
		run(g, 30, 3);
		expect(g.level).toBe(1);
		run(g, 60, Math.min(UP_AFTER_S, HOLD_S) - 1);
		expect(g.level).toBe(1);
		run(g, 60, UP_AFTER_S + 1);
		expect(g.level).toBe(0);
	});

	it('settles instead of oscillating when level 0 cannot be held', () => {
		const g = new Governor();
		let changes = 0;
		// 60 fps at level 1 and above, 30 fps at level 0: every attempt to go up fails
		for (let cycle = 0; cycle < 12; cycle++) {
			for (let s = 0; s < 120; s += 0.5) {
				const fps = g.level === 0 ? 30 : 60;
				const before = g.changes;
				run(g, fps, 0.5);
				changes += g.changes - before;
			}
		}
		// 1440 s. A fixed 12 s retry would fail and step back about 100 times (about 200 changes); the doubling
		// wait (12, 24, 48, 96 s, then 96 s) leaves about a dozen failed attempts
		expect(changes).toBeLessThan(45);
		expect(g.level).toBe(1);
	});

	it('ignores stalls such as a hidden tab', () => {
		const g = new Governor();
		for (let i = 0; i < 100; i++) g.frame(STALL_S * 4);
		expect(g.level).toBe(0);
		expect(g.frame(0)).toBe(false);
		expect(g.frame(-1)).toBe(false);
		expect(g.frame(NaN)).toBe(false);
	});

	it('takes a hiccup of a few long frames, even a second or two of them, for a stall', () => {
		const g = new Governor();
		for (let i = 0; i < SLOW_RUN - 1; i++) g.frame(0.3); // five long frames in a row
		g.frame(1 / 60); // a normal frame ends the run
		for (let i = 0; i < 20; i++) {
			g.frame(0.3); // long frames that are not in a row never count
			g.frame(1 / 60);
		}
		expect(g.level).toBe(0);
		// six long frames in a row that together are still under SLOW_SPAN_S are not yet a slow machine either
		const h = new Governor();
		for (let i = 0; i < SLOW_RUN; i++) h.frame(0.26);
		expect(0.26 * SLOW_RUN).toBeLessThan(SLOW_SPAN_S);
		expect(h.fps).toBe(60); // nothing was measured from them
	});

	it('steps down on a machine that makes 3 to 4 frames a second, which used to look like one long stall', () => {
		const g = new Governor();
		let t = 0;
		while (t < 40 && g.level < 5) {
			g.frame(0.28);
			t += 0.28;
		}
		expect(g.level).toBeGreaterThanOrEqual(1);
		expect(g.fps).toBeLessThan(5);
		// all the way down to the bare piano roll in well under a minute
		let more = 0;
		while (g.level < 5 && more < 60) {
			g.frame(0.28);
			more += 0.28;
		}
		expect(g.level).toBe(5);
	});

	it('still ignores gaps beyond SLOW_MAX_S however many come in a row (a frozen or hidden page)', () => {
		const g = new Governor();
		for (let i = 0; i < 50; i++) g.frame(SLOW_MAX_S + 0.1);
		expect(g.level).toBe(0);
	});

	it('can be pinned to a level and then no longer adapts', () => {
		const g = new Governor();
		g.force(3);
		expect(g.level).toBe(3);
		expect(g.quality.particleCap).toBe(1024);
		run(g, 10, 60);
		expect(g.level).toBe(3);
		g.force(undefined);
		run(g, 10, 20);
		expect(g.level).toBeGreaterThan(3);
	});

	it('clamps out-of-range levels', () => {
		expect(new Governor(99).level).toBe(MAX_LEVEL);
		expect(new Governor(-4).level).toBe(0);
	});

	it('documents thresholds that match the code', () => {
		expect(DOWN_FPS).toBe(50);
		expect(UP_FPS).toBe(55);
	});
});
