import { describe, expect, it } from 'vitest';
import {
	cameraDrift,
	cameraShake,
	cameraSteer,
	DRIFT_X,
	DRIFT_Y,
	noise1,
	SHAKE_AMP,
	SHAKE_FROM,
	SHAKE_FULL,
	shakeLevel,
	STEER_AHEAD,
	STEER_BEHIND,
	STEER_ROLL,
	STEER_X,
	type Offset,
	type Steer
} from './motion.js';

const o = (): Offset => ({ x: 0, y: 0 });

describe('cameraDrift', () => {
	it('is slow and small: bounded by its amplitudes, and moving about a tenth of a unit a second at most', () => {
		const a = o();
		const b = o();
		let worst = 0;
		for (let t = 0; t < 600; t += 0.05) {
			cameraDrift(t, 1, a);
			expect(Math.abs(a.x)).toBeLessThanOrEqual(DRIFT_X + 1e-9);
			expect(Math.abs(a.y)).toBeLessThanOrEqual(DRIFT_Y + 1e-9);
			cameraDrift(t + 1, 1, b);
			worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y));
		}
		expect(worst).toBeLessThan(0.12);
	});

	it('is a function of time alone, and zero at strength 0', () => {
		const a = cameraDrift(123.4, 1, o());
		cameraDrift(5, 1, o());
		expect(cameraDrift(123.4, 1, o())).toEqual(a);
		const zero = cameraDrift(123.4, 0, o());
		expect(Math.abs(zero.x) + Math.abs(zero.y)).toBe(0);
	});

	it('does not repeat within ten minutes', () => {
		const seen = new Set<string>();
		for (let t = 0; t < 600; t += 1) {
			const d = cameraDrift(t, 1, o());
			seen.add(`${d.x.toFixed(4)},${d.y.toFixed(4)}`);
		}
		expect(seen.size).toBe(600);
	});
});

describe('cameraShake', () => {
	it('is off below the loudness threshold and when the strength is 0 or the loudness is high but the scene says no', () => {
		expect(shakeLevel(0)).toBe(0);
		expect(shakeLevel(SHAKE_FROM)).toBe(0);
		expect(shakeLevel(SHAKE_FULL)).toBe(1);
		expect(shakeLevel(1)).toBe(1);
		expect(cameraShake(3.3, SHAKE_FROM - 0.01, 1, o())).toEqual({ x: 0, y: 0 });
		expect(cameraShake(3.3, 1, 0, o())).toEqual({ x: 0, y: 0 });
	});

	it('is small even at full strength, and never more than its amplitude', () => {
		const s = o();
		let peak = 0;
		for (let t = 0; t < 120; t += 0.01) {
			cameraShake(t, 1, 1, s);
			peak = Math.max(peak, Math.abs(s.x), Math.abs(s.y));
		}
		expect(peak).toBeLessThanOrEqual(SHAKE_AMP);
		expect(peak).toBeGreaterThan(SHAKE_AMP * 0.5); // it does move
	});

	it('is smooth: successive frames differ by a small fraction of the amplitude', () => {
		const a = o();
		const b = o();
		let worst = 0;
		for (let t = 0; t < 60; t += 1 / 60) {
			cameraShake(t, 1, 1, a);
			cameraShake(t + 1 / 60, 1, 1, b);
			worst = Math.max(worst, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
		}
		expect(worst).toBeLessThan(SHAKE_AMP * 0.6);
	});

	it('is the same for the same playhead (seek-safe)', () => {
		const a = cameraShake(77.77, 0.9, 1, o());
		cameraShake(1, 1, 1, o());
		expect(cameraShake(77.77, 0.9, 1, o())).toEqual(a);
	});
});

describe('noise1', () => {
	it('stays in -1..1 and is continuous', () => {
		let prev = noise1(0);
		let worstStep = 0;
		let peak = 0;
		for (let x = 0.01; x < 500; x += 0.01) {
			const v = noise1(x);
			peak = Math.max(peak, Math.abs(v));
			worstStep = Math.max(worstStep, Math.abs(v - prev));
			prev = v;
		}
		expect(peak).toBeLessThanOrEqual(1);
		expect(worstStep).toBeLessThan(0.05);
	});
});

describe('cameraSteer', () => {
	const STRIDE = 16;
	const HALF = 26;
	/** notes as the buffer holds them: x at 0, onset at 1, velocity at 4 */
	const notes = (list: { x: number; t: number; vel?: number }[]) => {
		const d = new Float32Array(list.length * STRIDE);
		list.forEach((n, i) => {
			d[i * STRIDE] = n.x;
			d[i * STRIDE + 1] = n.t;
			d[i * STRIDE + 4] = n.vel ?? 1;
		});
		return d;
	};
	const steer = (): Steer => ({ x: 0, y: 0, roll: 0 });

	it('is still with no notes, and with the strength at 0', () => {
		const out = steer();
		cameraSteer(notes([]), STRIDE, HALF, 10, 1, out);
		expect([out.x, out.y, out.roll]).toEqual([0, 0, 0]);
		cameraSteer(notes([{ x: 20, t: 10.2 }]), STRIDE, HALF, 10, 0, out);
		expect([out.x, out.roll]).toEqual([0, 0]);
	});

	it('leans toward the notes, and banks the other way round the view axis', () => {
		const right = steer();
		const left = steer();
		const many = (x: number) => Array.from({ length: 8 }, (_, i) => ({ x, t: 10 + i * 0.2 }));
		cameraSteer(notes(many(20)), STRIDE, HALF, 10, 1, right);
		cameraSteer(notes(many(-20)), STRIDE, HALF, 10, 1, left);
		expect(right.x).toBeGreaterThan(0.5);
		expect(left.x).toBeCloseTo(-right.x, 6);
		expect(right.roll).toBeLessThan(0);
		expect(left.roll).toBeCloseTo(-right.roll, 9);
	});

	it('stays within its amplitudes, and a single stray note does not drag the view across', () => {
		const out = steer();
		const crowd = Array.from({ length: 200 }, (_, i) => ({ x: HALF, t: 10 + (i % 20) * 0.1 }));
		cameraSteer(notes(crowd), STRIDE, HALF, 10, 1, out);
		expect(out.x).toBeLessThanOrEqual(STEER_X + 1e-9);
		expect(Math.abs(out.roll)).toBeLessThanOrEqual(STEER_ROLL + 1e-9);
		cameraSteer(notes([{ x: HALF, t: 10.4 }]), STRIDE, HALF, 10, 1, out);
		expect(out.x).toBeLessThan(0.45 * STEER_X);
	});

	it('is continuous in the playhead: notes enter and leave the window with no weight', () => {
		const d = notes([
			{ x: 18, t: 10 },
			{ x: -12, t: 11 },
			{ x: 5, t: 12.5 },
			{ x: -20, t: 9.6 }
		]);
		const a = steer();
		const b = steer();
		let worst = 0;
		for (let t = 8; t < 16; t += 0.001) {
			cameraSteer(d, STRIDE, HALF, t, 1, a);
			cameraSteer(d, STRIDE, HALF, t + 0.001, 1, b);
			worst = Math.max(worst, Math.abs(b.x - a.x));
		}
		expect(worst).toBeLessThan(0.01);
		cameraSteer(d, STRIDE, HALF, 10 + STEER_AHEAD + 0.01 + 2, 1, a); // all gone
		expect(a.x).toBe(0);
		cameraSteer(d, STRIDE, HALF, 12.5 - STEER_AHEAD - 0.001, 1, a);
		expect(Math.abs(a.x)).toBeLessThan(0.5); // only the far notes are near the window's edge
		expect(STEER_BEHIND).toBeGreaterThan(0);
	});
});
