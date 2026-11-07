/**
 * The semitone spectrogram of the recording, per piece (`python -m artfugue.spectro`), and the arithmetic to show it.
 * No DOM here except `buildImage`, which makes the picture once per piece.
 *
 * File: 'AFS2', u32 version (2), u32 rows, u32 cols, f32 t0, f32 dt, u32 lowest midi, i32 floor dB, u32 rows per semitone,
 * then rows x cols bytes (row 0 = the lowest pitch; row r is centred on semitone `lowest + r / perSemitone`). t0 is the
 * left edge of column 0 on the WAV timeline, dt the seconds per column. The first version ('AFS1', 32-byte header, one row
 * per semitone, no rows-per-semitone field) is still read.
 */

import { versioned } from '../data/version.js';

export interface Spectro {
	rows: number;
	cols: number;
	t0: number;
	dt: number;
	lowest: number;
	floorDb: number;
	/** rows per semitone: 1 for the first version of the file, 2 (quarter tones) for the current one */
	perSemitone: number;
	/** rows x cols, row-major, 0 = at or below the floor, 255 = as loud as the loudest sound in the recording */
	data: Uint8Array;
}

const HEADER_V1 = 32;
const HEADER_V2 = 36;
/** the widest strip of the picture kept in one canvas (browsers refuse canvases wider than 16384 to 32767 pixels) */
export const TILE_COLS = 8192;

export function parseSpectro(buf: ArrayBuffer): Spectro {
	const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
	if (magic !== 'AFS1' && magic !== 'AFS2') throw new Error(`not a spectrogram (magic ${magic})`);
	const v = new DataView(buf);
	const version = magic === 'AFS1' ? 1 : 2;
	if (v.getUint32(4, true) !== version)
		throw new Error(`unsupported spectrogram version ${v.getUint32(4, true)}`);
	const rows = v.getUint32(8, true);
	const cols = v.getUint32(12, true);
	const header = version === 1 ? HEADER_V1 : HEADER_V2;
	const perSemitone = version === 1 ? 1 : v.getUint32(32, true);
	if (perSemitone < 1 || rows % perSemitone !== 0)
		throw new Error('spectrogram: bad rows per semitone');
	if (buf.byteLength !== header + rows * cols)
		throw new Error('spectrogram: size does not match its header');
	return {
		rows,
		cols,
		t0: v.getFloat32(16, true),
		dt: v.getFloat32(20, true),
		lowest: v.getUint32(24, true),
		floorDb: v.getInt32(28, true),
		perSemitone,
		data: new Uint8Array(buf, header, rows * cols)
	};
}

type Fetch = (input: string) => Promise<Response>;

export async function loadSpectro(
	id: string,
	fetchFn: Fetch = fetch,
	base = '/data/spectro/'
): Promise<Spectro> {
	const res = await fetchFn(versioned(`${base}${id}.bin`));
	if (!res.ok) throw new Error(`spectrogram ${id}: HTTP ${res.status}`);
	return parseSpectro(await res.arrayBuffer());
}

/** Column that holds time `t` (may be outside 0..cols-1). */
export const columnAt = (s: Pick<Spectro, 't0' | 'dt'>, t: number): number => (t - s.t0) / s.dt;

/**
 * Where a MIDI pitch sits, in semitones from the bottom of the picture: the pitch's own box spans [row, row + 1) of the
 * semitone scale that `imageSpan` also uses.
 */
export const rowOf = (s: Pick<Spectro, 'lowest'>, midi: number): number => midi - s.lowest;

/**
 * The picture's vertical extent on that semitone scale. Row r is centred on semitone r / perSemitone, i.e. the middle of
 * the box [r / perSemitone, r / perSemitone + 1), so the picture runs from `0.5 - 0.5 / perSemitone` upward by
 * `rows / perSemitone` (for one row per semitone, exactly [0, rows)).
 */
export function imageSpan(s: Pick<Spectro, 'rows' | 'perSemitone'>): { from: number; to: number } {
	const from = 0.5 - 0.5 / s.perSemitone;
	return { from, to: from + s.rows / s.perSemitone };
}

/** Column ranges [c0, c1) of the tiles a picture of `cols` columns is cut into. */
export function tileRanges(cols: number, tile = TILE_COLS): [number, number][] {
	const out: [number, number][] = [];
	for (let c = 0; c < cols; c += tile) out.push([c, Math.min(cols, c + tile)]);
	return out;
}

export interface View {
	/** source rectangle in the picture, in columns (may extend past either end) */
	x0: number;
	x1: number;
	/** where `t` falls across the view, 0..1 */
	playhead: number;
}

/** What to show when the playhead is at `t`: `seconds` of music, with the playhead `playhead` of the way across. */
export function viewAt(
	s: Pick<Spectro, 't0' | 'dt'>,
	t: number,
	seconds: number,
	playhead: number
): View {
	const x0 = columnAt(s, t - seconds * playhead);
	return { x0, x1: x0 + seconds / s.dt, playhead };
}

/** Dark to bright: black, indigo, magenta, orange, white (256 RGB entries, 3 bytes each). */
export function colourLut(): Uint8Array {
	const stops: [number, number, number, number][] = [
		[0, 4, 4, 14],
		[0.25, 40, 20, 110],
		[0.5, 150, 40, 130],
		[0.75, 240, 120, 40],
		[1, 255, 250, 220]
	];
	const lut = new Uint8Array(256 * 3);
	for (let i = 0; i < 256; i++) {
		const x = i / 255;
		let k = 0;
		while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
		const [xa, ...a] = stops[k];
		const [xb, ...b] = stops[k + 1];
		const f = (x - xa) / (xb - xa);
		for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
	}
	return lut;
}

export interface Tile {
	canvas: HTMLCanvasElement;
	/** columns [c0, c1) of the spectrogram this canvas holds */
	c0: number;
	c1: number;
}

/** The whole piece as a row of pictures (cols x rows, row 0 at the bottom), made once. */
export function buildImage(s: Spectro): Tile[] {
	const lut = colourLut();
	return tileRanges(s.cols).map(([c0, c1]) => {
		const w = c1 - c0;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = s.rows;
		const ctx = canvas.getContext('2d')!;
		const img = ctx.createImageData(w, s.rows);
		for (let r = 0; r < s.rows; r++) {
			const y = s.rows - 1 - r;
			for (let c = 0; c < w; c++) {
				const v = s.data[r * s.cols + c0 + c];
				const o = (y * w + c) * 4;
				img.data[o] = lut[v * 3];
				img.data[o + 1] = lut[v * 3 + 1];
				img.data[o + 2] = lut[v * 3 + 2];
				img.data[o + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return { canvas, c0, c1 };
	});
}
