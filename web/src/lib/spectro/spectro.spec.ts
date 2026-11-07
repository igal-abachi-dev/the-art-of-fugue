import { describe, expect, it } from 'vitest';
import {
	colourLut,
	columnAt,
	imageSpan,
	parseSpectro,
	rowOf,
	tileRanges,
	viewAt
} from './spectro.js';

function file(rows: number, cols: number, t0 = 100, dt = 0.05, lowest = 24, floor = -66) {
	const buf = new ArrayBuffer(32 + rows * cols);
	const v = new DataView(buf);
	new Uint8Array(buf, 0, 4).set([65, 70, 83, 49]); // AFS1
	v.setUint32(4, 1, true);
	v.setUint32(8, rows, true);
	v.setUint32(12, cols, true);
	v.setFloat32(16, t0, true);
	v.setFloat32(20, dt, true);
	v.setUint32(24, lowest, true);
	v.setInt32(28, floor, true);
	const data = new Uint8Array(buf, 32);
	for (let i = 0; i < data.length; i++) data[i] = i % 256;
	return buf;
}

/** a version-2 file: 36-byte header with rows per semitone */
function file2(rows: number, cols: number, perSemitone = 2) {
	const buf = new ArrayBuffer(36 + rows * cols);
	const v = new DataView(buf);
	new Uint8Array(buf, 0, 4).set([65, 70, 83, 50]); // AFS2
	v.setUint32(4, 2, true);
	v.setUint32(8, rows, true);
	v.setUint32(12, cols, true);
	v.setFloat32(16, 100, true);
	v.setFloat32(20, 0.0116, true);
	v.setUint32(24, 24, true);
	v.setInt32(28, -66, true);
	v.setUint32(32, perSemitone, true);
	new Uint8Array(buf, 36).fill(7);
	return buf;
}

describe('parseSpectro', () => {
	it('reads version 2 (quarter-tone rows) and still reads version 1 as one row a semitone', () => {
		const s = parseSpectro(file2(168, 30));
		expect([s.rows, s.cols, s.perSemitone, s.lowest]).toEqual([168, 30, 2, 24]);
		expect(s.dt).toBeCloseTo(0.0116, 6);
		expect(s.data.length).toBe(168 * 30);
		expect(s.data[0]).toBe(7);
		expect(parseSpectro(file(84, 10)).perSemitone).toBe(1);
		expect(() => parseSpectro(file2(167, 3))).toThrow(/rows per semitone/);
		expect(() => parseSpectro(file2(168, 30).slice(0, 400))).toThrow(/size/);
	});

	it('reads the header and the data without copying it', () => {
		const s = parseSpectro(file(84, 10));
		expect(s.rows).toBe(84);
		expect(s.cols).toBe(10);
		expect(s.t0).toBeCloseTo(100, 4);
		expect(s.dt).toBeCloseTo(0.05, 6);
		expect(s.lowest).toBe(24);
		expect(s.floorDb).toBe(-66);
		expect(s.data.length).toBe(840);
		expect(s.data[300]).toBe(300 % 256);
	});

	it('rejects a file that is not one, or is cut short', () => {
		const bad = new Uint8Array(file(2, 2));
		bad[0] = 88;
		expect(() => parseSpectro(bad.buffer)).toThrow(/not a spectrogram/);
		expect(() => parseSpectro(file(84, 10).slice(0, 500))).toThrow(/size/);
	});
});

describe('mapping', () => {
	const s = { t0: 100, dt: 0.05, lowest: 24 };
	it('turns time into a column and a pitch into a row', () => {
		expect(columnAt(s, 100)).toBe(0);
		expect(columnAt(s, 101)).toBeCloseTo(20, 6);
		expect(columnAt(s, 99)).toBeLessThan(0);
		expect(rowOf(s, 24)).toBe(0);
		expect(rowOf(s, 60)).toBe(36);
	});

	it('shows `seconds` of music with the playhead where asked, also past the ends', () => {
		const v = viewAt(s, 105, 10, 0.25);
		expect(v.x1 - v.x0).toBeCloseTo(200, 6);
		// the playhead column sits a quarter of the way across
		expect(columnAt(s, 105)).toBeCloseTo(v.x0 + 0.25 * 200, 6);
		expect(viewAt(s, 100, 10, 0.25).x0).toBeLessThan(0);
	});
});

describe('imageSpan and tileRanges', () => {
	it('puts a one-row-a-semitone picture on the semitone boxes, and a quarter-tone one a quarter row in', () => {
		expect(imageSpan({ rows: 84, perSemitone: 1 })).toEqual({ from: 0, to: 84 });
		const q = imageSpan({ rows: 168, perSemitone: 2 });
		expect(q.from).toBe(0.25); // row 0 is centred on semitone 0, the middle of box [0, 1): it spans 0.25 to 0.75
		expect(q.to).toBe(84.25);
	});

	it('cuts a long piece into tiles that cover every column once', () => {
		expect(tileRanges(10, 4)).toEqual([
			[0, 4],
			[4, 8],
			[8, 10]
		]);
		expect(tileRanges(0, 4)).toEqual([]);
		const t = tileRanges(41000);
		expect(t[0][0]).toBe(0);
		expect(t.at(-1)![1]).toBe(41000);
		expect(Math.max(...t.map(([a, b]) => b - a))).toBeLessThanOrEqual(8192);
	});
});

describe('colourLut', () => {
	it('has 256 entries, starts dark, ends bright and gets brighter', () => {
		const lut = colourLut();
		expect(lut.length).toBe(768);
		const lum = (i: number) => lut[i * 3] + lut[i * 3 + 1] + lut[i * 3 + 2];
		expect(lum(0)).toBeLessThan(60);
		expect(lum(255)).toBeGreaterThan(600);
		for (let i = 1; i < 256; i++) expect(lum(i)).toBeGreaterThanOrEqual(lum(i - 1) - 1);
	});
});
