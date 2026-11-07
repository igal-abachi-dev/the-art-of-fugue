import { describe, expect, it } from 'vitest';
import { syntheticNotes } from '../playback/synthetic.js';
import { NoteWindow } from '../playback/window.js';
import { emptyTags, TAG_INVERTED, TAG_SUBJECT } from '../scenes/tags.js';
import { pitchToX } from './keyboard.js';
import { NOTE_STRIDE, NoteBuffer } from './notebuffer.js';

const AHEAD = 6.5;
const BEHIND = 1.2;

/** every visible note must be resident with the right values */
function expectComplete(buf: NoteBuffer, win: NoteWindow, t: number) {
	const c = win.notes;
	let missing = 0;
	let wrong = 0;
	for (let i = 0; i < c.n; i++) {
		if (!(c.t_on[i] <= t + AHEAD && c.t_off[i] > t - BEHIND)) continue;
		const o = (i % buf.capacity) * NOTE_STRIDE;
		const d = buf.data;
		if (d[o + 1] !== c.t_on[i] || d[o + 2] !== c.t_off[i]) {
			missing++;
			continue;
		}
		if (
			d[o] !== Math.fround(pitchToX(c.pitch[i])) ||
			d[o + 3] !== c.voice[i] ||
			d[o + 6] !== c.pitch[i] ||
			d[o + 5] !== c.flags[i]
		) {
			wrong++;
		}
	}
	return { missing, wrong };
}

describe('NoteBuffer', () => {
	it('holds every visible note after any sequence of plays and seeks (never stale, never missing)', () => {
		const c = syntheticNotes(2500, 11);
		const win = new NoteWindow(c);
		const buf = new NoteBuffer(1024);
		buf.setWindow(win);
		const end = c.t_on[c.n - 1] + 15;
		let s = 5;
		const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
		let t = 0;
		let worstMissing = 0;
		let worstWrong = 0;
		for (let step = 0; step < 400; step++) {
			// mostly play on a frame, sometimes seek anywhere (also backwards, and past either end)
			t = rnd() < 0.12 ? rnd() * (end + 20) - 10 : t + 1 / 60;
			buf.update(t, AHEAD, BEHIND);
			expect(buf.truncated).toBe(false);
			if (step % 4 === 0 || rnd() < 0.3) {
				const r = expectComplete(buf, win, t);
				worstMissing = Math.max(worstMissing, r.missing);
				worstWrong = Math.max(worstWrong, r.wrong);
			}
		}
		expect(worstMissing).toBe(0);
		expect(worstWrong).toBe(0);
	});

	it('writes only the notes that entered the window while playing on', () => {
		const c = syntheticNotes(4000, 2);
		const win = new NoteWindow(c);
		const buf = new NoteBuffer(1024);
		buf.setWindow(win);
		buf.update(100, AHEAD, BEHIND);
		const first = buf.written;
		expect(first).toBeGreaterThan(20); // the whole window
		let total = 0;
		const frames = 600; // ten seconds at 60 fps
		for (let f = 1; f <= frames; f++) {
			buf.update(100 + f / 60, AHEAD, BEHIND);
			total += buf.written;
		}
		// each note enters once; ~8 notes per second here, so about 80 in ten seconds, not 600 × a window
		expect(total).toBeLessThan(140);
		expect(total).toBeLessThan(first * 8);
	});

	it('does nothing when the playhead has not moved, and does not bump the version', () => {
		const win = new NoteWindow(syntheticNotes(1000, 4));
		const buf = new NoteBuffer(512);
		buf.setWindow(win);
		buf.update(30, AHEAD, BEHIND);
		const v = buf.version;
		expect(buf.update(30, AHEAD, BEHIND)).toBe(false);
		expect(buf.version).toBe(v);
	});

	it('refills after invalidate (a lost GL context) and after switching pieces', () => {
		const a = new NoteWindow(syntheticNotes(800, 1));
		const b = new NoteWindow(syntheticNotes(800, 9));
		const buf = new NoteBuffer(512);
		buf.setWindow(a);
		buf.update(20, AHEAD, BEHIND);
		buf.invalidate();
		buf.update(20, AHEAD, BEHIND);
		expect(expectComplete(buf, a, 20)).toEqual({ missing: 0, wrong: 0 });
		buf.setWindow(b);
		buf.update(20, AHEAD, BEHIND);
		expect(expectComplete(buf, b, 20)).toEqual({ missing: 0, wrong: 0 });
	});

	it('shows nothing (every slot culled) before the first note and after the last', () => {
		const win = new NoteWindow(syntheticNotes(300, 6));
		const buf = new NoteBuffer(256);
		buf.setWindow(win);
		buf.update(-100, AHEAD, BEHIND);
		for (let s = 0; s < buf.capacity; s++) expect(buf.data[s * NOTE_STRIDE + 2]).toBeLessThan(-1e8);
		buf.update(1e6, AHEAD, BEHIND);
		expect(buf.written).toBe(0);
	});

	it('flags a window larger than the buffer and keeps the nearest notes', () => {
		const win = new NoteWindow(syntheticNotes(2000, 3));
		const buf = new NoteBuffer(16);
		buf.setWindow(win);
		buf.update(50, AHEAD, BEHIND);
		expect(buf.truncated).toBe(true);
		expect(buf.written).toBe(16);
	});

	it('allocates nothing after construction: the same array is updated in place', () => {
		const win = new NoteWindow(syntheticNotes(1000, 8));
		const buf = new NoteBuffer(512);
		const data = buf.data;
		buf.setWindow(win);
		for (let f = 0; f < 200; f++) buf.update(f / 10, AHEAD, BEHIND);
		expect(buf.data).toBe(data);
	});

	it('writes the scene tags and the mirror counterpart of each note, and rewrites them when they change', () => {
		const c = syntheticNotes(40, 3);
		const win = new NoteWindow(c);
		const buf = new NoteBuffer(64);
		buf.setWindow(win);
		const tags = emptyTags(c.n);
		tags.bits[2] = TAG_SUBJECT | TAG_INVERTED;
		tags.theme[2] = 3;
		tags.ratio[2] = 2;
		tags.ghost[2] = 70;
		buf.update(0, 1000, 1000);
		const slot = 2 * NOTE_STRIDE;
		expect(buf.data[slot + 12]).toBe(0); // no tags yet
		expect(buf.data[slot + 15]).toBe(0);
		buf.setTags(tags);
		const version = buf.version;
		buf.update(0, 1000, 1000);
		expect(buf.data[slot + 8]).toBeCloseTo(pitchToX(70), 5);
		expect(buf.data[slot + 9]).toBe(70);
		expect(buf.data[slot + 12]).toBe(TAG_SUBJECT | TAG_INVERTED);
		expect(buf.data[slot + 13]).toBe(3);
		expect(buf.data[slot + 14]).toBe(2);
		expect(buf.data[slot + 15]).toBe(1); // "this piece has tags", for the shader
		expect(buf.data[3 * NOTE_STRIDE + 12]).toBe(0);
		expect(buf.data[3 * NOTE_STRIDE + 9]).toBe(0);
		expect(buf.version).toBeGreaterThan(version);
	});

	it('ignores tags made for another piece, and forgets them with the window', () => {
		const win = new NoteWindow(syntheticNotes(40, 3));
		const buf = new NoteBuffer(64);
		buf.setWindow(win);
		buf.setTags(emptyTags(7));
		buf.update(0, 1000, 1000);
		expect(buf.data[15]).toBe(0);
		buf.setTags(emptyTags(40));
		buf.setWindow(win);
		buf.update(0, 1000, 1000);
		expect(buf.data[15]).toBe(0);
	});

	it('is far cheaper per frame than walking all notes', () => {
		const win = new NoteWindow(syntheticNotes(3100, 5)); // the size of the densest piece
		const buf = new NoteBuffer(1024);
		buf.setWindow(win);
		const t0 = performance.now();
		const frames = 20000;
		for (let f = 0; f < frames; f++) buf.update((f / frames) * 380, AHEAD, BEHIND);
		const per = (performance.now() - t0) / frames;
		expect(per).toBeLessThan(0.05); // ms; the budget for the whole frame is 16
	});
});
