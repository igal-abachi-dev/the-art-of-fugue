import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barAt, pieceAt, type Manifest, type PieceEntry } from './manifest.js';
import { parseNotes, type ColumnSpec } from './notes.js';

const fx = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe('note chunk loader', () => {
	const expected = JSON.parse(readFileSync(fx('c01-head.json'), 'utf8')) as {
		format: ColumnSpec[];
		n: number;
		columns: Record<string, number[]>;
	};
	const bin = readFileSync(fx('c01-head.bin'));
	const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);

	it('round-trips the fixture written by the Python exporter', () => {
		const cols = parseNotes(buf, expected.format);
		expect(cols.n).toBe(expected.n);
		for (const { name } of expected.format) {
			expect(Array.from((cols as unknown as Record<string, ArrayLike<number>>)[name])).toEqual(
				expected.columns[name]
			);
		}
	});

	it('rejects a buffer that is not a note chunk', () => {
		expect(() => parseNotes(new ArrayBuffer(32), expected.format)).toThrow(/not a note chunk/);
	});

	it('rejects a chunk that was cut short, with a message that says so', () => {
		expect(() => parseNotes(buf.slice(0, 8), expected.format)).toThrow(/truncated/);
		expect(() => parseNotes(buf.slice(0, buf.byteLength - 40), expected.format)).toThrow(
			/truncated/
		);
		expect(() => parseNotes(buf.slice(0, 16), expected.format)).toThrow(/truncated/); // header only, notes promised
	});

	it('rejects a chunk of another version', () => {
		const copy = buf.slice(0);
		new DataView(copy).setUint32(4, 2, true);
		expect(() => parseNotes(copy, expected.format)).toThrow(/version 2/);
	});

	it('accepts a chunk with no notes', () => {
		const empty = buf.slice(0, 16);
		new DataView(empty).setUint32(8, 0, true);
		expect(parseNotes(empty, expected.format).n).toBe(0);
	});

	it('notes are sorted by onset time', () => {
		const t = parseNotes(buf, expected.format).t_on;
		for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
	});
});

describe('piece and bar lookup', () => {
	const piece = (id: string, a: number, b: number, bars: number[]): PieceEntry =>
		({
			id,
			audio_start: a,
			audio_end: b,
			bars: bars.map((t, i) => ({ n: i + 1, t }))
		}) as PieceEntry;
	const m = { pieces: [piece('a', 10, 20, [10, 12, 15]), piece('b', 25, 30, [25])] } as Manifest;

	it('finds the piece in a span and none in a gap', () => {
		expect(pieceAt(m, 12)?.id).toBe('a');
		expect(pieceAt(m, 22)).toBeNull();
		expect(pieceAt(m, 25)?.id).toBe('b');
	});

	it('counts a piece from a moment before its start, and the later of two that run into each other', () => {
		// a seek to a piece starts 0.08 s early for the attack: still that piece
		expect(pieceAt(m, 24.95)?.id).toBe('b');
		expect(pieceAt(m, 24.5)).toBeNull();
		const touching = {
			pieces: [piece('a', 10, 20, [10]), piece('b', 20, 30, [20])]
		} as Manifest;
		expect(pieceAt(touching, 19.5)?.id).toBe('a');
		expect(pieceAt(touching, 19.95)?.id).toBe('b');
		expect(pieceAt(touching, 20)?.id).toBe('b');
	});

	it('finds the bar being played', () => {
		const a = m.pieces[0];
		expect(barAt(a, 9)).toBeNull();
		expect(barAt(a, 10)?.n).toBe(1);
		expect(barAt(a, 14.9)?.n).toBe(2);
		expect(barAt(a, 19)?.n).toBe(3);
	});
});
