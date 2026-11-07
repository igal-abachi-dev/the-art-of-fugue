import { describe, expect, it } from 'vitest';
import type { BarTime } from '../data/manifest.js';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import { CursorTrack, markSounding, NotationIndex, type NotationDoc } from './notation.js';

// two bars of four notes each (bar 1 at 10 s, bar 2 at 14 s; one note per second), the voice-2 note of bar 1
// held for the whole bar
function fixture() {
	const rows = [
		{ on: 10, off: 11, v: 1 },
		{ on: 11, off: 12, v: 1 },
		{ on: 12, off: 13, v: 1 },
		{ on: 13, off: 14, v: 1 },
		{ on: 10, off: 14, v: 2 },
		{ on: 14, off: 15, v: 1 },
		{ on: 15, off: 16, v: 1 },
		{ on: 16, off: 17, v: 1 },
		{ on: 17, off: 18, v: 1 }
	].sort((a, b) => a.on - b.on || a.v - b.v);
	const n = rows.length;
	const notes: NoteColumns = {
		n,
		t_on: Float32Array.from(rows.map((r) => r.on)),
		t_off: Float32Array.from(rows.map((r) => r.off)),
		tick: new Uint32Array(n),
		pitch: new Uint8Array(n).fill(60),
		voice: Uint8Array.from(rows.map((r) => r.v)),
		vel: new Uint8Array(n),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
	const at = (on: number, v: number) => rows.findIndex((r) => r.on === on && r.v === v);
	const doc: NotationDoc = {
		version: 1,
		piece: 'x',
		source: 'pdf',
		credit: 'c',
		systems: [
			{
				page: 1,
				svg: 'pdf/p001.svg',
				size: [600, 800],
				crop: [0, 0, 600, 100],
				bars: [
					{ n: 1, x0: 40, x1: 140 },
					{ n: 2, x0: 140, x1: 240 }
				],
				heads: [
					[60, 10, 0, at(10, 1)],
					[80, 10, 0, at(11, 1)],
					[100, 10, 0, at(12, 1)],
					[120, 10, 0, at(13, 1)],
					[60, 40, 1, at(10, 2)],
					[160, 10, 0, at(14, 1)],
					[180, 10, 0, at(15, 1)],
					[200, 10, 0, at(16, 1)],
					[220, 10, 0, at(17, 1)]
				]
			}
		]
	};
	const bars: BarTime[] = [
		{ n: 1, t: 10 },
		{ n: 2, t: 14 }
	];
	return { notes, doc, bars, win: new NoteWindow(notes) };
}

describe('NotationIndex', () => {
	it('maps notes to noteheads and bars to systems', () => {
		const { notes, doc } = fixture();
		const ix = new NotationIndex(doc, notes.n);
		expect(ix.systemOfBar(1)).toBe(0);
		expect(ix.systemOfBar(2)).toBe(0);
		expect(ix.systemOfBar(3)).toBe(-1);
		// every note has exactly one head here
		for (let i = 0; i < notes.n; i++) expect(ix.start[i + 1] - ix.start[i]).toBe(1);
		expect(ix.headX(0, 0)).toBeGreaterThan(0);
		expect(ix.headX(0, 5)).toBeNaN();
	});

	it('ignores note positions beyond the chunk', () => {
		const { notes, doc } = fixture();
		doc.systems[0].heads.push([10, 10, 0, 9999]);
		const ix = new NotationIndex(doc, notes.n);
		expect(ix.system.length).toBe(notes.n);
	});

	it('lets a note own several heads (a tie) and a head several notes (two passes)', () => {
		const { notes, doc } = fixture();
		doc.systems[0].heads.push([130, 10, 0, 0]);
		doc.systems[0].heads[1].push(5);
		const ix = new NotationIndex(doc, notes.n);
		expect(ix.start[1] - ix.start[0]).toBe(2);
		let found = 0;
		for (let k = 0; k < ix.system.length; k++) if (ix.head[k] === 1) found++;
		expect(found).toBe(2);
	});
});

describe('markSounding', () => {
	it('marks the heads of the sounding notes with their voice, and nothing else', () => {
		const { notes, doc, win } = fixture();
		const ix = new NotationIndex(doc, notes.n);
		const out = new Uint8Array(doc.systems[0].heads.length);
		const set = markSounding(ix, win, notes, 11.5, 0, out);
		expect(set).toBe(2);
		const lit = [...out].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
		expect(lit.length).toBe(2);
		expect(out.filter((v) => v === 2).length).toBe(1);
		out.fill(0);
		expect(markSounding(ix, win, notes, 9, 0, out)).toBe(0);
		out.fill(0);
		expect(markSounding(ix, win, notes, 18.5, 0, out)).toBe(0);
	});

	it('does not mark heads of another system', () => {
		const { notes, doc, win } = fixture();
		const ix = new NotationIndex(doc, notes.n);
		const out = new Uint8Array(20);
		expect(markSounding(ix, win, notes, 11.5, 3, out)).toBe(0);
	});
});

describe('CursorTrack', () => {
	it('finds the bar and the system at a time', () => {
		const { notes, doc, bars, win } = fixture();
		const c = new CursorTrack(new NotationIndex(doc, notes.n), win, bars, 18);
		expect(c.barIndexAt(9)).toBe(-1);
		expect(c.barIndexAt(10)).toBe(0);
		expect(c.barIndexAt(13.99)).toBe(0);
		expect(c.barIndexAt(14)).toBe(1);
		expect(c.systemAt(9)).toBe(-1);
		expect(c.systemAt(12)).toBe(0);
	});

	it('moves left to right, at each noteheads x when its note starts', () => {
		const { notes, doc, bars, win } = fixture();
		const c = new CursorTrack(new NotationIndex(doc, notes.n), win, bars, 18);
		// note at 11 s has its head at x = 80, the cursor sits 3 points left of the head centre
		expect(c.x(11)).toBeCloseTo(77, 5);
		expect(c.x(12)).toBeCloseTo(97, 5);
		expect(c.x(11.5)).toBeCloseTo(87, 5);
		let prev = -Infinity;
		for (let t = 10; t < 18; t += 0.05) {
			const x = c.x(t);
			expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
			prev = x;
		}
	});

	it('starts the first bar of a system by the first notehead, not by the clef, and ends at the barline', () => {
		const { notes, doc, bars, win } = fixture();
		const c = new CursorTrack(new NotationIndex(doc, notes.n), win, bars, 18);
		// first column of bar 1 is a chord at x 60 (voice 1) and 60 (voice 2): cursor at 57
		expect(c.x(10)).toBeCloseTo(57, 5);
		expect(c.x(13.999)).toBeLessThan(140);
		expect(c.x(13.999)).toBeGreaterThan(120);
		// bar 2 starts at the left edge of the bar until its first note, which is on the downbeat
		expect(c.x(14)).toBeCloseTo(157, 5);
	});

	it('ignores a note that starts a little before the barline but is engraved in the next bar', () => {
		const { notes, doc, win } = fixture();
		// bar 2 is timed at 14.02 s; its first note starts at 14.00 s (head at x 160, inside bar 2)
		const bars: BarTime[] = [
			{ n: 1, t: 10 },
			{ n: 2, t: 14.02 }
		];
		const c = new CursorTrack(new NotationIndex(doc, notes.n), win, bars, 18);
		for (const t of [13.9, 14.0, 14.01, 14.019]) expect(c.x(t)).toBeLessThanOrEqual(140);
		expect(c.x(14.03)).toBeGreaterThan(140);
	});

	it('copes with a bar that has no matching noteheads', () => {
		const { notes, doc, bars, win } = fixture();
		doc.systems[0].heads = [];
		const c = new CursorTrack(new NotationIndex(doc, notes.n), win, bars, 18);
		const x = c.x(11);
		expect(Number.isFinite(x)).toBe(true);
	});

	it('returns NaN before the first bar and for a bar the notation does not have', () => {
		const { notes, doc, bars, win } = fixture();
		const c = new CursorTrack(new NotationIndex(doc, notes.n), win, [...bars, { n: 9, t: 18 }], 20);
		expect(c.x(5)).toBeNaN();
		expect(c.x(19)).toBeNaN();
	});
});
