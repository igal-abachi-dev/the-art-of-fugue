/**
 * The overview strip of the seek bar (T7.2.6): the file `overview.bin` ("AFO1", written by `python -m artfugue.overview`)
 * holds, for every half second of the recording, its loudness and the pitch each voice sounds. `drawOverview` paints it
 * as a DJ program paints a track: a waveform of the loudness with the voices' contours on it in their colours.
 */

import { versioned } from '../data/version.js';

export interface Overview {
	/** seconds per column */
	step: number;
	columns: number;
	/** loudness 0..255 per column */
	level: Uint8Array;
	/** per voice, the MIDI pitch per column (0 = silent) */
	pitch: Uint8Array[];
}

const MAGIC = 0x314f4641; // "AFO1" read as a little-endian u32

export function parseOverview(buf: ArrayBuffer): Overview {
	const dv = new DataView(buf);
	if (buf.byteLength < 16 || dv.getUint32(0, true) !== MAGIC) throw new Error('not an AFO1 file');
	const columns = dv.getUint32(4, true);
	const step = dv.getFloat32(8, true);
	const voices = dv.getUint32(12, true);
	let pos = 16;
	const level = new Uint8Array(buf, pos, columns);
	pos += columns;
	pos += -pos & 3;
	const need = pos + voices * columns;
	if (need > buf.byteLength || !(step > 0)) throw new Error('truncated AFO1 file');
	const pitch: Uint8Array[] = [];
	for (let v = 0; v < voices; v++) pitch.push(new Uint8Array(buf, pos + v * columns, columns));
	return { step, columns, level, pitch };
}

export async function loadOverview(
	fetchFn: typeof fetch = fetch,
	url = '/data/overview.bin'
): Promise<Overview | null> {
	try {
		const res = await fetchFn(versioned(url));
		if (!res.ok) return null;
		return parseOverview(await res.arrayBuffer());
	} catch {
		return null; // the strip is an extra: the bar works without it
	}
}

/** Lowest and highest pitch drawn: the work lies between C2 and D6 (a little room at both ends). */
export const PITCH_LOW = 34;
export const PITCH_HIGH = 88;

/** A column's x range for a canvas `width` px wide (columns per pixel may be above or below one). */
export function columnRange(o: Overview, x: number, width: number): [number, number] {
	const a = Math.floor((x / width) * o.columns);
	const b = Math.max(a + 1, Math.ceil(((x + 1) / width) * o.columns));
	return [Math.min(o.columns - 1, a), Math.min(o.columns, b)];
}

/**
 * The loudness range worth drawing: from the 5th to the 99th percentile of the columns that are not silent. A recording
 * that is steady would otherwise be a block; stretched over this range its swells and its quiet places show.
 */
export function levelRange(o: Overview): [number, number] {
	const sorted = Array.from(o.level)
		.filter((v) => v > 0)
		.sort((a, b) => a - b);
	if (sorted.length === 0) return [0, 255];
	const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
	const lo = at(0.05);
	const hi = Math.max(at(0.99), lo + 8);
	return [lo, hi];
}

/** Peak loudness 0..1 over a range of columns, 0 at `lo` and 1 at `hi` (default: the whole scale). */
export function peakLevel(o: Overview, a: number, b: number, lo = 0, hi = 255): number {
	let m = 0;
	for (let i = a; i < b; i++) if (o.level[i] > m) m = o.level[i];
	return m <= 0 ? 0 : Math.min(1, Math.max(0.04, (m - lo) / (hi - lo)));
}

/** Pitch of a voice over a range of columns: the highest sounding one, or 0. */
export function voicePitch(o: Overview, v: number, a: number, b: number): number {
	const row = o.pitch[v];
	if (!row) return 0;
	let m = 0;
	for (let i = a; i < b; i++) if (row[i] > m) m = row[i];
	return m;
}

/** Height 0..1 of a pitch on the strip. */
export function pitchY(p: number): number {
	return Math.min(1, Math.max(0, (p - PITCH_LOW) / (PITCH_HIGH - PITCH_LOW)));
}

export interface DrawOptions {
	/** fraction 0..1 of the recording already played (drawn brighter) */
	played: number;
	voiceColours: readonly string[];
	/** which voices are shown (the voice buttons) */
	mask: readonly number[];
	/** colour of the waveform before and after the playhead */
	wavePlayed: string;
	waveToCome: string;
	pixelRatio: number;
}

/** Paint the strip into a canvas 2D context of `w` x `h` device pixels. */
export function drawOverview(
	ctx: CanvasRenderingContext2D,
	o: Overview,
	w: number,
	h: number,
	opt: DrawOptions
): void {
	ctx.clearRect(0, 0, w, h);
	const mid = h / 2;
	const [lo, hi] = levelRange(o);
	const playedX = opt.played * w;
	// the waveform, mirrored about the middle, one pixel column at a time (a loudness curve, not a sample plot)
	for (let x = 0; x < w; x++) {
		const [a, b] = columnRange(o, x, w);
		const lv = peakLevel(o, a, b, lo, hi);
		if (lv <= 0) continue;
		const half = Math.max(0.5, lv * (mid - 1) * 0.92);
		ctx.fillStyle = x < playedX ? opt.wavePlayed : opt.waveToCome;
		ctx.fillRect(x, mid - half, 1, half * 2);
	}
	// the voices' contours: a short coloured dash per pixel column at the height of the pitch
	const dash = Math.max(1, Math.round(opt.pixelRatio * 1.5));
	for (let v = o.pitch.length - 1; v >= 0; v--) {
		if (opt.mask[v] === 0) continue;
		ctx.fillStyle = opt.voiceColours[v] ?? '#fff';
		for (let x = 0; x < w; x++) {
			const [a, b] = columnRange(o, x, w);
			const p = voicePitch(o, v, a, b);
			if (!p) continue;
			const y = (1 - pitchY(p)) * (h - dash * 2) + dash * 0.5;
			ctx.globalAlpha = x < playedX ? 1 : 0.55;
			ctx.fillRect(x, y, 1, dash);
		}
	}
	ctx.globalAlpha = 1;
}
