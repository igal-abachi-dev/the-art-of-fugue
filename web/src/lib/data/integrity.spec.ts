import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Manifest, PieceEvent } from './manifest.js';
import { parseNotes } from './notes.js';

/**
 * The data that ships (T9.2.1): the committed manifest and every note chunk are loaded by the same loader the page uses
 * and checked against each other. This is what stands between a broken pipeline run and a broken site; it needs no
 * recording and runs in CI.
 */

const DATA = new URL('../../../static/data/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, DATA));
const manifest = JSON.parse(read('manifest.json').toString('utf8')) as Manifest;
const buf = (rel: string) => {
	const b = read(rel);
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('the shipped manifest', () => {
	it('lists the twenty pieces once each, in order, inside the recording', () => {
		expect(manifest.pieces).toHaveLength(20);
		expect(new Set(manifest.pieces.map((p) => p.id)).size).toBe(20);
		const orders = manifest.pieces.map((p) => p.order);
		expect(orders).toEqual([...orders].sort((a, b) => a - b));
		for (const p of manifest.pieces) {
			expect(p.audio_start, p.id).toBeGreaterThanOrEqual(0);
			expect(p.audio_end, p.id).toBeGreaterThan(p.audio_start);
			expect(p.audio_end, p.id).toBeLessThanOrEqual((manifest.duration ?? 0) + 0.01);
		}
	});

	it('has a build id and audio sources that carry their hash', () => {
		expect(manifest.build).toMatch(/^[0-9a-f]{10}$/);
		expect(manifest.audio.length).toBeGreaterThanOrEqual(2);
		for (const a of manifest.audio) expect(a.src).toMatch(/^\/audio\/fugue\.\w+\?v=[0-9a-f]{10}$/);
		expect(manifest.audio.map((a) => a.type)[0]).toMatch(/opus/);
	});

	it('has bars that run forward in time within each pass and stay inside their piece', () => {
		for (const p of manifest.pieces) {
			expect(p.bars.length, p.id).toBeGreaterThan(10);
			let prev = -Infinity;
			for (const b of p.bars) {
				expect(b.t, `${p.id} bar ${b.n}`).toBeGreaterThan(prev);
				expect(b.t, `${p.id} bar ${b.n}`).toBeGreaterThanOrEqual(p.audio_start - 0.5);
				expect(b.t, `${p.id} bar ${b.n}`).toBeLessThanOrEqual(p.audio_end + 0.5);
				prev = b.t;
			}
		}
	});

	it('refers only to files that exist', () => {
		for (const p of manifest.pieces) {
			for (const rel of [p.notes, p.events, p.mirror?.file].filter((x): x is string => !!x))
				expect(existsSync(new URL(rel, DATA)), rel).toBe(true);
			expect(existsSync(new URL(`notation/${p.id}.json`, DATA)), `notation ${p.id}`).toBe(true);
			expect(existsSync(new URL(`notation-verovio/${p.id}.json`, DATA)), `verovio ${p.id}`).toBe(
				true
			);
			expect(existsSync(new URL(`spectro/${p.id}.bin`, DATA)), `spectro ${p.id}`).toBe(true);
		}
		expect(existsSync(new URL('overview.bin', DATA))).toBe(true);
	});
});

describe('every shipped note chunk', () => {
	for (const p of manifest.pieces) {
		it(`${p.id}: loads, has the notes the manifest says, in order, inside its piece`, () => {
			const c = parseNotes(buf(p.notes), manifest.notes_format);
			expect(c.n).toBe(p.n_notes);
			const voices = new Set(p.voices.map((v) => v.voice));
			const bars = new Set(p.bars.map((b) => b.n));
			const lo = p.audio_start - 2;
			const hi = p.audio_end + (p.tail_s ?? 0) + 2;
			let bad = '';
			for (let i = 0; i < c.n && !bad; i++) {
				if (i > 0 && c.t_on[i] < c.t_on[i - 1]) bad = `note ${i} is before the one before it`;
				else if (!(c.t_off[i] > c.t_on[i]))
					bad = `note ${i} ends at ${c.t_off[i]}, not after ${c.t_on[i]}`;
				else if (c.t_on[i] < lo || c.t_on[i] > hi)
					bad = `note ${i} at ${c.t_on[i]} s is outside the piece`;
				else if (c.pitch[i] < 21 || c.pitch[i] > 108) bad = `note ${i} has pitch ${c.pitch[i]}`;
				else if (!voices.has(c.voice[i])) bad = `note ${i} has voice ${c.voice[i]}`;
				else if (!bars.has(c.bar[i]))
					bad = `note ${i} is in bar ${c.bar[i]}, which the piece does not have`;
				else if (c.vel[i] === 0) bad = `note ${i} has no velocity`;
			}
			expect(bad).toBe('');
		});

		it(`${p.id}: its events point at notes that exist and run forward`, () => {
			const events = JSON.parse(read(p.events).toString('utf8')) as PieceEvent[];
			expect(events.length).toBeGreaterThan(0);
			const ids = new Set<string>();
			for (const e of events) {
				expect(ids.has(`${e.id}#${e.pass}`), e.id).toBe(false); // unfolded pieces repeat an event once per pass
				ids.add(`${e.id}#${e.pass}`);
				expect(e.t_end, e.id).toBeGreaterThanOrEqual(e.t);
				for (const n of e.notes) {
					expect(n, e.id).toBeGreaterThanOrEqual(0);
					expect(n, e.id).toBeLessThan(p.n_notes);
				}
				expect(e.notes, e.id).toEqual([...e.notes].sort((a, b) => a - b));
			}
		});

		if (p.mirror) {
			it(`${p.id}: its mirror file has one pitch per note`, () => {
				expect(statSync(new URL(p.mirror!.file, DATA)).size).toBe(p.n_notes);
			});
		}
	}
});
