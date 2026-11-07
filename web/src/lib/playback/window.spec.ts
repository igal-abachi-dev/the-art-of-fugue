import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNotes, type ColumnSpec, type NoteColumns } from '../data/notes.js';
import { NoteWindow } from './window.js';
import { syntheticNotes } from './synthetic.js';

function synthetic(n: number, seed = 1): NoteColumns {
	// pseudo-random piece: notes every ~0.12 s on average, lengths 0.1-12 s (a few held notes)
	let s = seed;
	const rnd = () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
	const t_on = new Float32Array(n);
	const t_off = new Float32Array(n);
	let t = 0;
	for (let i = 0; i < n; i++) {
		t += rnd() * 0.24;
		t_on[i] = t;
		t_off[i] = t + (rnd() < 0.02 ? 2 + rnd() * 10 : 0.1 + rnd() * 0.6);
	}
	const z = (C: typeof Uint8Array) => new C(n);
	return {
		n,
		t_on,
		t_off,
		tick: new Uint32Array(n),
		pitch: z(Uint8Array),
		voice: z(Uint8Array),
		vel: z(Uint8Array),
		conf: z(Uint8Array),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: z(Uint8Array)
	};
}

function naive(c: NoteColumns, t: number, ahead: number, behind: number) {
	const active: number[] = [];
	const ended: number[] = [];
	const upcoming: number[] = [];
	for (let i = 0; i < c.n; i++) {
		if (c.t_on[i] <= t && c.t_off[i] > t) active.push(i);
		else if (c.t_on[i] <= t && c.t_off[i] > t - behind) ended.push(i);
		else if (c.t_on[i] > t && c.t_on[i] <= t + ahead) upcoming.push(i);
	}
	return { active, ended, upcoming };
}

describe('NoteWindow', () => {
	it('agrees with a brute-force scan at random times, including before, between and after the notes', () => {
		const c = synthetic(2000);
		const w = new NoteWindow(c, 4096);
		const end = c.t_off[c.n - 1] + 30;
		for (let k = 0; k < 400; k++) {
			const t = -2 + (k / 399) * (end + 2);
			const ref = naive(c, t, 3, 0.5);
			w.query(t, 3, 0.5);
			expect([...w.active.subarray(0, w.activeCount)]).toEqual(ref.active);
			expect([...w.ended.subarray(0, w.endedCount)]).toEqual(ref.ended);
			const up: number[] = [];
			for (let i = w.upcomingStart; i < w.upcomingEnd; i++) up.push(i);
			expect(up).toEqual(ref.upcoming);
			expect(w.truncated).toBe(false);
		}
	});

	it('finds a long held note that started far back', () => {
		const c = synthetic(500);
		c.t_off[3] = c.t_on[3] + 40; // held for 40 s while 300 more notes start
		const w = new NoteWindow(c);
		const t = c.t_on[3] + 30;
		w.query(t, 1, 0.2);
		expect([...w.active.subarray(0, w.activeCount)]).toContain(3);
	});

	it('flags truncation when the output arrays are too small instead of overflowing', () => {
		const c = synthetic(200);
		const w = new NoteWindow(c, 2);
		w.query(c.t_on[100], 1, 100);
		expect(w.activeCount).toBeLessThanOrEqual(2);
		expect(w.endedCount).toBe(2);
		expect(w.truncated).toBe(true);
	});

	it('handles an empty piece', () => {
		const w = new NoteWindow(synthetic(0));
		w.query(5, 1, 1);
		expect(w.activeCount + w.endedCount + (w.upcomingEnd - w.upcomingStart)).toBe(0);
	});

	it('does not allocate: the output arrays are the same objects after a query', () => {
		const c = synthetic(300);
		const w = new NoteWindow(c);
		const a = w.active;
		const e = w.ended;
		w.query(10, 2, 1);
		expect(w.active).toBe(a);
		expect(w.ended).toBe(e);
	});
});

// The real chunks exist only after `pnpm data`; the benchmark uses them when present and a synthetic
// piece of the same density otherwise.
const DATA = resolve(import.meta.dirname, '../../../static/data');

function densest(): { name: string; cols: NoteColumns } {
	const manifestPath = resolve(DATA, 'manifest.json');
	if (existsSync(manifestPath)) {
		const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
			notes_format: ColumnSpec[];
			pieces: { id: string; n_notes: number; notes: string }[];
		};
		const p = [...m.pieces].sort((a, b) => b.n_notes - a.n_notes)[0];
		const buf = readFileSync(resolve(DATA, p.notes));
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
		return { name: p.id, cols: parseNotes(ab, m.notes_format) };
	}
	return { name: 'synthetic', cols: synthetic(3200) };
}

describe('NoteWindow speed (T3.1.4: well under 1 ms per frame)', () => {
	it('answers a query on the densest piece in far less than a millisecond', () => {
		const { name, cols } = densest();
		const w = new NoteWindow(cols);
		const last = cols.t_off[cols.n - 1];
		const N = 20000;
		// warm up the JIT
		for (let i = 0; i < 2000; i++) w.query((i / 2000) * last, 3, 0.5);
		const t0 = performance.now();
		let sink = 0;
		for (let i = 0; i < N; i++) {
			w.query((i / N) * last, 3, 0.5);
			sink += w.activeCount + w.endedCount;
		}
		const per = (performance.now() - t0) / N;
		console.info(
			`NoteWindow on ${name} (${cols.n} notes): ${(per * 1000).toFixed(2)} microseconds per query`
		);
		expect(sink).toBeGreaterThan(0);
		expect(per).toBeLessThan(0.1); // 10x inside the 1 ms budget, to stay stable on a loaded machine
	});
});

describe('NoteWindow.range and startedBetween', () => {
	it('range holds every note that is visible at t and none that cannot be', () => {
		const c = syntheticNotes(1500, 7);
		const w = new NoteWindow(c);
		let misses = 0;
		let tooEarly = 0;
		let tooLate = 0;
		for (let k = 0; k < 120; k++) {
			const t = (k / 120) * (c.t_on[c.n - 1] + 20) - 5;
			w.range(t, 6.5, 1.2);
			for (let i = 0; i < c.n; i++) {
				const visible = c.t_on[i] <= t + 6.5 && c.t_off[i] > t - 1.2;
				const inside = i >= w.rangeStart && i < w.rangeEnd;
				if (visible && !inside) misses++;
				if (i < w.rangeStart && c.t_off[i] > t - 1.2) tooEarly++;
				if (i >= w.rangeEnd && c.t_on[i] <= t + 6.5) tooLate++;
			}
		}
		expect(misses).toBe(0);
		expect(tooEarly).toBe(0);
		expect(tooLate).toBe(0);
	});

	it('startedBetween gives exactly the notes with a < t_on <= b', () => {
		const c = syntheticNotes(500, 3);
		const w = new NoteWindow(c);
		for (const [a, b] of [
			[-1, 0],
			[0, 5],
			[3.3, 3.31],
			[20, 20],
			[40, 1e6]
		]) {
			w.startedBetween(a, b);
			const want: number[] = [];
			for (let i = 0; i < c.n; i++) if (c.t_on[i] > a && c.t_on[i] <= b) want.push(i);
			const got: number[] = [];
			for (let i = w.startedStart; i < w.startedEnd; i++) got.push(i);
			expect(got).toEqual(want);
		}
	});

	it('are empty on an empty piece', () => {
		const w = new NoteWindow(syntheticNotes(0));
		w.range(5, 6, 1);
		w.startedBetween(0, 10);
		expect(w.rangeEnd - w.rangeStart).toBe(0);
		expect(w.startedEnd - w.startedStart).toBe(0);
	});
});
