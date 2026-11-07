import { describe, expect, it } from 'vitest';
import {
	columnRange,
	levelRange,
	parseOverview,
	peakLevel,
	pitchY,
	voicePitch
} from './overview.js';

/** the bytes `artfugue.overview.encode` makes: 3 columns, 2 voices */
function file(): ArrayBuffer {
	const columns = 3;
	const buf = new ArrayBuffer(16 + 4 + 2 * columns + 2);
	const dv = new DataView(buf);
	dv.setUint32(0, 0x314f4641, true);
	dv.setUint32(4, columns, true);
	dv.setFloat32(8, 0.5, true);
	dv.setUint32(12, 2, true);
	new Uint8Array(buf, 16, 3).set([0, 128, 255]);
	new Uint8Array(buf, 20, 6).set([60, 0, 62, 0, 0, 40]);
	return buf;
}

describe('overview', () => {
	it('reads the file the pipeline writes', () => {
		const o = parseOverview(file());
		expect(o.columns).toBe(3);
		expect(o.step).toBe(0.5);
		expect([...o.level]).toEqual([0, 128, 255]);
		expect([...o.pitch[0]]).toEqual([60, 0, 62]);
		expect([...o.pitch[1]]).toEqual([0, 0, 40]);
	});

	it('refuses other files and truncated ones', () => {
		expect(() => parseOverview(new ArrayBuffer(8))).toThrow();
		expect(() => parseOverview(file().slice(0, 22))).toThrow();
	});

	it('maps pixels to columns, with at least one column per pixel', () => {
		const o = parseOverview(file());
		expect(columnRange(o, 0, 3)).toEqual([0, 1]);
		expect(columnRange(o, 2, 3)).toEqual([2, 3]);
		expect(columnRange(o, 0, 1)).toEqual([0, 3]); // narrow: one pixel takes all
		const [a, b] = columnRange(o, 5, 12); // wide: several pixels share a column
		expect(b).toBeGreaterThan(a);
		expect(b).toBeLessThanOrEqual(3);
	});

	it('takes the peak level and the highest pitch of a range', () => {
		const o = parseOverview(file());
		expect(peakLevel(o, 0, 2)).toBeCloseTo(128 / 255);
		expect(peakLevel(o, 0, 3)).toBe(1);
		expect(peakLevel(o, 0, 1)).toBe(0); // silent
		expect(peakLevel(o, 1, 2, 100, 200)).toBeCloseTo(0.28); // stretched over a range
		expect(peakLevel(o, 1, 2, 128, 255)).toBeCloseTo(0.04); // never quite nothing where there is sound
		expect(voicePitch(o, 0, 0, 3)).toBe(62);
		expect(voicePitch(o, 5, 0, 3)).toBe(0);
	});

	it('stretches the loudness over the range that is used', () => {
		const o = parseOverview(file());
		const [lo, hi] = levelRange(o);
		expect(lo).toBeGreaterThanOrEqual(128);
		expect(hi).toBeGreaterThan(lo);
	});

	it('keeps pitch heights in 0..1', () => {
		expect(pitchY(0)).toBe(0);
		expect(pitchY(200)).toBe(1);
		expect(pitchY(61)).toBeGreaterThan(0.4);
	});
});
