import { describe, expect, it } from 'vitest';
import type { PieceEntry, PieceEvent } from '../data/manifest.js';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import type { PieceFx } from '../visual/stage.js';
import { Director, clashStrength, type DirectorEngine, type DirectorStage } from './director.js';
import { parseBook } from './scenes.js';

function columns(n: number): NoteColumns {
	const t_on = Float32Array.from({ length: n }, (_, i) => 10 + i);
	return {
		n,
		t_on,
		t_off: t_on.map((x) => x + 0.5),
		tick: new Uint32Array(n),
		pitch: Uint8Array.from({ length: n }, (_, i) => 60 + i),
		voice: new Uint8Array(n).fill(1),
		vel: new Uint8Array(n).fill(80),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
}

const entry = (id: string, extra: Partial<PieceEntry> = {}) =>
	({ id, bars: [{ n: 1, t: 0 }], ...extra }) as PieceEntry;
const ev = (
	type: string,
	t: number,
	notes: number[],
	data: Record<string, unknown>
): PieceEvent => ({
	id: `${type}-${t}`,
	type,
	bar: 1,
	voice: 1,
	pass: 1,
	t,
	t_end: t + 1,
	notes,
	data
});

class FakeStage implements DirectorStage {
	scenes: { id: string; seconds: number | undefined }[] = [];
	fx: PieceFx[] = [];
	flips = 0;
	shocks: { t: number; pitch: number; kind: number }[] = [];
	setScene(c: { id: string }, seconds?: number) {
		this.scenes.push({ id: c.id, seconds });
	}
	setPieceFx(_w: NoteWindow, fx: PieceFx) {
		this.fx.push(fx);
	}
	flip() {
		this.flips++;
	}
	shock(t: number, pitch: number, _v: number, _s: number, kind: number) {
		this.shocks.push({ t, pitch, kind });
		return true;
	}
}

class FakeEngine implements DirectorEngine {
	piece: PieceEntry | null = null;
	windows = new Map<string, NoteWindow>();
	events_: Record<string, PieceEvent[]> = {};
	async notes(id: string) {
		const cols = columns(6);
		this.windows.set(id, new NoteWindow(cols));
		return cols;
	}
	async events(id: string) {
		return this.events_[id] ?? [];
	}
	async mirror() {
		return null;
	}
	window(id: string) {
		return this.windows.get(id) ?? null;
	}
}

const BOOK = parseBook({
	default: { id: 'default' },
	idle: { id: 'idle' },
	scenes: { a: { id: 'a' }, e: { id: 'e', ending: true } },
	pieces: { p1: 'a', p2: 'a', last: 'e', m: 'a', mi: 'a' }
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const frame = (t: number, discontinuity = false) => ({ t, discontinuity });

describe('Director', () => {
	it('sets the scene of each piece at the boundary, and the idle scene in a gap', () => {
		const eng = new FakeEngine();
		const st = new FakeStage();
		const d = new Director(eng, st, BOOK);
		eng.piece = null;
		d.step(frame(0));
		eng.piece = entry('p1');
		d.step(frame(10));
		d.step(frame(10.1));
		eng.piece = null;
		d.step(frame(20));
		eng.piece = entry('other');
		d.step(frame(21));
		expect(st.scenes.map((s) => s.id)).toEqual(['idle', 'a', 'idle', 'default']);
		expect(st.scenes[0].seconds).toBe(0); // the first scene appears at once
		expect(st.scenes[1].seconds).toBeGreaterThan(0);
	});

	it('hands the stage the tags and the ending once the data has loaded', async () => {
		const eng = new FakeEngine();
		eng.events_.last = [ev('subject-entry', 10, [0, 1], { theme: 'S2', inverted: true, ratio: 1 })];
		const st = new FakeStage();
		const d = new Director(eng, st, BOOK);
		eng.piece = entry('last');
		d.step(frame(10));
		expect(st.fx).toHaveLength(0);
		await settle();
		d.step(frame(10.1));
		expect(st.fx).toHaveLength(1);
		expect(st.fx[0].tags!.theme[0]).toBe(2);
		expect(st.fx[0].ending!.freezeAt).toBeCloseTo(15, 3); // the onset of the last of six notes
		expect(st.fx[0].axisSum).toBeNull();
		d.step(frame(10.2));
		expect(st.fx).toHaveLength(1); // only once
	});

	it('gives no ending to a piece whose scene does not ask for one', async () => {
		const eng = new FakeEngine();
		const st = new FakeStage();
		const d = new Director(eng, st, BOOK);
		eng.piece = entry('p1');
		d.step(frame(10));
		await settle();
		d.step(frame(10.1));
		expect(st.fx[0].ending).toBeNull();
	});

	it('fires clash and crossing rings once, at the event time, and not for a seek over them', async () => {
		const eng = new FakeEngine();
		eng.events_.p1 = [
			ev('clash', 11, [], { interval: 11, voices: [2, 3], pitches: [54, 43] }),
			ev('crossing', 13, [2, 3], { upper_voice: 1, lower_voice: 2 })
		];
		const st = new FakeStage();
		const d = new Director(eng, st, BOOK);
		eng.piece = entry('p1');
		d.step(frame(10));
		await settle();
		for (let t = 10.1; t < 14; t += 1 / 60) d.step(frame(t));
		expect(st.shocks.map((s) => [s.t, s.pitch, s.kind])).toEqual([
			[11, 49, 0],
			[13, 63, 1]
		]);
		d.step(frame(10.5, true)); // seek back
		d.step(frame(10.52));
		expect(st.shocks).toHaveLength(2); // nothing replayed
		d.step(frame(11.5, true)); // and over the first one
		for (let t = 11.52; t < 14; t += 1 / 60) d.step(frame(t));
		expect(st.shocks).toHaveLength(3); // only the crossing, which was ahead
	});

	it('flips when a mirror piece follows its pair, not otherwise', async () => {
		const eng = new FakeEngine();
		const st = new FakeStage();
		const d = new Director(eng, st, BOOK);
		const m = entry('m', { mirror: { pair: 'mi', file: 'x', axis_sum: 119 } });
		const mi = entry('mi', { mirror: { pair: 'm', file: 'y', axis_sum: 119 } });
		eng.piece = entry('p1');
		d.step(frame(1));
		eng.piece = mi; // from an unrelated piece
		d.step(frame(2));
		expect(st.flips).toBe(0);
		eng.piece = m;
		d.step(frame(3));
		eng.piece = mi; // rectus to inversus
		d.step(frame(4));
		expect(st.flips).toBe(1);
		await settle();
		d.step(frame(4.1));
		expect(st.fx.at(-1)!.axisSum).toBe(119);
	});
});

describe('clashStrength', () => {
	it('rings hardest for seconds, sevenths and tritones', () => {
		expect(clashStrength(11)).toBe(1);
		expect(clashStrength(13)).toBe(1);
		expect(clashStrength(6)).toBe(1);
		expect(clashStrength(7)).toBe(0.7);
		expect(clashStrength(undefined)).toBe(0.7);
	});
});
