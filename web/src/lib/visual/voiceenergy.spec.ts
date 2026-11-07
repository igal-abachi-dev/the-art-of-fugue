import { describe, expect, it } from 'vitest';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import { noteEnergy, totalEnergy, voiceEnergy } from './voiceenergy.js';

/** notes as [t_on, t_off, voice, velocity 0..255] */
function piece(rows: [number, number, number, number][]): NoteColumns {
	const n = rows.length;
	return {
		n,
		t_on: Float32Array.from(rows.map((r) => r[0])),
		t_off: Float32Array.from(rows.map((r) => r[1])),
		tick: new Uint32Array(n),
		pitch: new Uint8Array(n).fill(60),
		voice: Uint8Array.from(rows.map((r) => r[2])),
		vel: Uint8Array.from(rows.map((r) => r[3])),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	};
}

function at(win: NoteWindow, t: number): number[] {
	win.query(t, 0, 1);
	const out = new Float32Array(5);
	voiceEnergy(win, t, out);
	return [...out];
}

describe('noteEnergy', () => {
	it('is bright at the attack, settles to the sustain, and dies after the note ends', () => {
		expect(noteEnergy(1, -0.1, 1)).toBe(0);
		expect(noteEnergy(1, 0, 1)).toBeCloseTo(1, 6);
		expect(noteEnergy(1, 0.2, 5)).toBeLessThan(noteEnergy(1, 0, 5));
		expect(noteEnergy(1, 4, 5)).toBeGreaterThan(0.55);
		expect(noteEnergy(1, 4, 5)).toBeLessThan(0.6);
		const justOff = noteEnergy(1, 1, 1);
		expect(noteEnergy(1, 1.2, 1)).toBeLessThan(justOff);
		expect(noteEnergy(1, 2, 1)).toBeLessThan(0.02);
	});

	it('scales with velocity', () => {
		expect(noteEnergy(0.5, 0.3, 2)).toBeCloseTo(0.5 * noteEnergy(1, 0.3, 2), 9);
	});
});

describe('voiceEnergy', () => {
	const win = new NoteWindow(
		piece([
			[1, 3, 1, 200], // voice 1 sounds 1..3
			[2, 2.5, 2, 100], // voice 2 sounds 2..2.5
			[2, 2.5, 4, 255],
			[2.1, 2.6, 4, 255] // voice 4 plays two notes at once
		])
	);

	it('is 0 for every voice before the piece and long after it', () => {
		expect(at(win, 0)).toEqual([0, 0, 0, 0, 0]);
		expect(at(win, 10)).toEqual([0, 0, 0, 0, 0]);
	});

	it('rises for the voice that plays and only for it', () => {
		const e = at(win, 1.05);
		expect(e[0]).toBeGreaterThan(0.5);
		expect(e.slice(1)).toEqual([0, 0, 0, 0]);
	});

	it('is louder with more notes in a voice and with higher velocity, but never above 1', () => {
		const e = at(win, 2.2);
		expect(e[3]).toBeGreaterThan(e[1]);
		for (const v of e) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});

	it('falls away after a voice stops', () => {
		const during = at(win, 2.4)[1];
		const after = at(win, 2.8)[1];
		expect(after).toBeLessThan(during * 0.5);
		expect(at(win, 3.6)[1]).toBeLessThan(0.01);
	});

	it('is a function of the playhead only: any order of queries gives the same values', () => {
		const times = [2.2, 0.5, 1.05, 2.8, 2.2, 1.9];
		const first = times.map((t) => at(win, t));
		const second = [...times].reverse().map((t) => at(win, t));
		expect(second.reverse()).toEqual(first);
	});
});

describe('totalEnergy', () => {
	it('is 0 when silent, 1 when every voice is full, and between for one voice', () => {
		expect(totalEnergy([0, 0, 0, 0, 0])).toBe(0);
		expect(totalEnergy([1, 1, 1, 1, 0])).toBe(1);
		const one = totalEnergy([1, 0, 0, 0, 0]);
		expect(one).toBeGreaterThan(0.3);
		expect(one).toBeLessThan(0.8);
	});
});
