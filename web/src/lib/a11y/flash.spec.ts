import { describe, expect, it } from 'vitest';
import {
	AREA_LIMIT,
	BRIGHT_CAP,
	FlashAnalyser,
	FlashTracker,
	GENERAL_DELTA,
	RED_DELTA,
	redMeasure,
	relativeLuminance
} from './flash.js';

/** frames of `n` pixels at `fps` for `seconds`; `value(frame, pixel)` gives each pixel's measure */
function run(
	t: FlashTracker,
	fps: number,
	seconds: number,
	value: (frame: number, pixel: number) => number
) {
	const frames = Math.round(fps * seconds);
	const v = new Float32Array(t.size);
	for (let f = 0; f < frames; f++) {
		for (let i = 0; i < t.size; i++) v[i] = value(f, i);
		t.push((f * 1000) / fps, v);
	}
}
const general = (n = 100) => new FlashTracker(n, { delta: GENERAL_DELTA, brightCap: BRIGHT_CAP });
/** a square wave between lo and hi at `hz` */
const square = (hz: number, fps: number, lo: number, hi: number) => (f: number) =>
	Math.floor((f * hz * 2) / fps) % 2 === 0 ? lo : hi;

describe('luminance and red measures', () => {
	it('white and black, and the weight of the channels', () => {
		expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
		expect(relativeLuminance(0, 0, 0)).toBe(0);
		expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
		expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
	});

	it('only a saturated red has a red measure', () => {
		expect(redMeasure(255, 0, 0)).toBeCloseTo(320, 3);
		expect(redMeasure(255, 255, 255)).toBe(0);
		expect(redMeasure(213, 94, 0)).toBeGreaterThan(100); // the orange of voice 3 counts as a saturated red
		expect(redMeasure(200, 120, 100)).toBe(0); // a salmon does not
		expect(redMeasure(0, 0, 0)).toBe(0);
	});
});

describe('FlashTracker (general flashes)', () => {
	it('sees nothing in a still picture or a slow fade', () => {
		const t = general();
		run(t, 60, 2, () => 0.4);
		expect(t.maxFraction).toBe(0);
		const u = general();
		run(u, 60, 3, (f) => f / 180); // 0 to 1 over three seconds: one rise
		expect(u.maxFraction).toBe(0);
		expect(u.maxChanges).toBeLessThanOrEqual(1);
	});

	it('passes a full-screen flash at three a second and fails four', () => {
		const three = general();
		run(three, 60, 3, square(3, 60, 0, 1)); // 6 changes a second: three flashes
		expect(three.maxFraction).toBe(0);
		const four = general();
		run(four, 60, 3, square(4, 60, 0, 1)); // 8 changes a second
		expect(four.maxFraction).toBe(1);
		expect(four.ok).toBe(false);
	});

	it('ignores swings below the threshold and between two bright values', () => {
		const small = general();
		run(small, 60, 2, square(10, 60, 0.4, 0.45));
		expect(small.maxFraction).toBe(0);
		const bright = general();
		run(bright, 60, 2, square(10, 60, 0.85, 1)); // 0.15 swing, but both are above 0.8
		expect(bright.maxFraction).toBe(0);
		const dark = general();
		run(dark, 60, 2, square(10, 60, 0.6, 0.75)); // 0.15 swing, the darker is under 0.8
		expect(dark.maxFraction).toBe(1);
	});

	it('measures the area that flashes', () => {
		const t = general(1000);
		run(t, 60, 2, (f, i) => (i < 10 ? square(10, 60, 0, 1)(f) : 0)); // 1 % of the frame
		expect(t.maxFraction).toBeCloseTo(0.01, 5);
		expect(t.ok).toBe(true); // under the 2.5 % limit
		const big = general(1000);
		run(big, 60, 2, (f, i) => (i < 100 ? square(10, 60, 0, 1)(f) : 0)); // 10 %
		expect(big.maxFraction).toBeCloseTo(0.1, 5);
		expect(big.maxFraction).toBeGreaterThan(AREA_LIMIT);
		expect(big.ok).toBe(false);
	});

	it('forgets: a burst that stops is not counted again a second later, but the worst is kept', () => {
		const t = general();
		run(t, 60, 1, square(10, 60, 0, 1));
		const worst = t.maxFraction;
		expect(worst).toBe(1);
		const v = new Float32Array(100).fill(0);
		const last = t.push(5000, v);
		expect(last).toBe(0);
		expect(t.maxFraction).toBe(worst);
	});
});

describe('red flashes', () => {
	it('uses its own threshold', () => {
		const t = new FlashTracker(50, { delta: RED_DELTA });
		run(t, 60, 2, (f) => square(5, 60, 0, 320)(f) as number);
		expect(t.maxFraction).toBe(1);
		const calm = new FlashTracker(50, { delta: RED_DELTA });
		run(calm, 60, 2, (f) => square(5, 60, 0, 10)(f) as number); // under 20
		expect(calm.maxFraction).toBe(0);
	});
});

describe('FlashAnalyser on RGBA frames', () => {
	it('catches a red-and-black strobe in both measures', () => {
		const px = 64;
		const a = new FlashAnalyser(px);
		const rgba = new Uint8ClampedArray(px * 4);
		for (let f = 0; f < 120; f++) {
			const on = Math.floor((f * 10) / 60) % 2 === 0;
			for (let i = 0; i < px; i++) {
				rgba[i * 4] = on ? 255 : 0;
				rgba[i * 4 + 3] = 255;
			}
			a.pushRgba((f * 1000) / 60, rgba);
		}
		expect(a.result.red).toBe(1);
		expect(a.result.general).toBe(1); // red alone is 0.21 luminance: a swing over 0.1, so it is a general flash too
		expect(a.result.ok).toBe(false);
	});
});
