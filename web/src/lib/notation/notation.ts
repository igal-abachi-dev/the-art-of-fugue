/**
 * Score overlay data and logic (T4.4.1). No DOM here.
 *
 * `python -m artfugue.notation` writes, per piece, `notation/<id>.json`: the engraved systems (a vector page file,
 * a crop rectangle, the bars' x ranges and every notehead with the positions of its notes in the note chunk). This
 * module loads that file, indexes it by note, and answers two questions per frame without allocating:
 * which noteheads of the system on screen are sounding, and where the play cursor is.
 */

import type { BarTime } from '../data/manifest.js';
import type { NoteColumns } from '../data/notes.js';
import type { NoteWindow } from '../playback/window.js';
import { versioned } from '../data/version.js';

export interface NotationBar {
	n: number;
	x0: number;
	x1: number;
}

export interface NotationSystem {
	page: number;
	/** file under the notation folder (vector, one per PDF page or per system) */
	svg: string;
	/** size of the file's coordinate space */
	size: [number, number];
	/** [x, y, width, height] of the system inside the file */
	crop: [number, number, number, number];
	bars: NotationBar[];
	/** `[x, y, staff, ...note positions]` */
	heads: number[][];
}

export interface NotationDoc {
	version: 1;
	piece: string;
	source: 'pdf' | 'verovio';
	credit: string;
	/** one staff space in the file's coordinates (4.98 for the PDF, 180 for Verovio's drawing units) */
	unit?: number;
	systems: NotationSystem[];
}

type Fetch = (input: string) => Promise<Response>;

export async function loadNotation(
	id: string,
	fetchFn: Fetch = fetch,
	base = '/data/notation/'
): Promise<NotationDoc> {
	const res = await fetchFn(versioned(`${base}${id}.json`));
	if (!res.ok) throw new Error(`notation ${id}: HTTP ${res.status}`);
	const doc = (await res.json()) as NotationDoc;
	if (doc.version !== 1) throw new Error(`notation ${id}: unsupported version ${doc.version}`);
	return doc;
}

/** Index of a note -> its noteheads, and printed bar -> system. */
/** One staff space of the PDF's engraving, in points. */
export const PDF_UNIT = 4.98;

export class NotationIndex {
	readonly doc: NotationDoc;
	readonly nNotes: number;
	/** noteheads of note i are entries [start[i], start[i+1]) of `system` / `head` */
	readonly start: Int32Array;
	readonly system: Int32Array;
	readonly head: Int32Array;
	readonly #barSystem = new Map<number, number>();

	constructor(doc: NotationDoc, nNotes: number) {
		this.doc = doc;
		this.nNotes = nNotes;
		const counts = new Int32Array(nNotes + 1);
		let total = 0;
		doc.systems.forEach((s, si) => {
			for (const b of s.bars) if (!this.#barSystem.has(b.n)) this.#barSystem.set(b.n, si);
			for (const h of s.heads)
				for (let k = 3; k < h.length; k++) {
					if (h[k] < nNotes) {
						counts[h[k] + 1]++;
						total++;
					}
				}
		});
		for (let i = 0; i < nNotes; i++) counts[i + 1] += counts[i];
		this.start = counts;
		this.system = new Int32Array(total);
		this.head = new Int32Array(total);
		const fill = counts.slice(0, nNotes);
		doc.systems.forEach((s, si) => {
			s.heads.forEach((h, hi) => {
				for (let k = 3; k < h.length; k++) {
					if (h[k] >= nNotes) continue;
					const at = fill[h[k]]++;
					this.system[at] = si;
					this.head[at] = hi;
				}
			});
		});
	}

	/** index of the system that engraves printed bar `n`, or -1 */
	systemOfBar(n: number): number {
		return this.#barSystem.get(n) ?? -1;
	}

	/** x of the first notehead of note `i` that is in `system`, or NaN */
	headX(i: number, system: number): number {
		for (let k = this.start[i]; k < this.start[i + 1]; k++) {
			if (this.system[k] === system) return this.doc.systems[system].heads[this.head[k]][0];
		}
		return NaN;
	}
}

/**
 * The play cursor: piecewise linear between the onsets of the notes of the current bar (measured from the
 * recording), from the left edge of the bar to its right edge. Built once per bar, then one interpolation per frame.
 */
export class CursorTrack {
	readonly #index: NotationIndex;
	readonly #win: NoteWindow;
	readonly #bars: BarTime[];
	readonly #end: number;
	#built = -1;
	#kt: number[] = [];
	#kx: number[] = [];
	#system = -1;

	constructor(index: NotationIndex, win: NoteWindow, bars: BarTime[], pieceEnd: number) {
		this.#index = index;
		this.#win = win;
		this.#bars = bars;
		this.#end = pieceEnd;
	}

	/** Index into `bars` of the bar playing at `t` (the last one that began), or -1 before the first. */
	barIndexAt(t: number): number {
		const b = this.#bars;
		let lo = 0;
		let hi = b.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (b[mid].t <= t) lo = mid + 1;
			else hi = mid;
		}
		return lo - 1;
	}

	/** system on screen at `t`, or -1 */
	systemAt(t: number): number {
		const i = this.barIndexAt(t);
		return i < 0 ? -1 : this.#index.systemOfBar(this.#bars[i].n);
	}

	#build(bi: number): void {
		const bars = this.#bars;
		const bar = bars[bi];
		const sys = this.#index.systemOfBar(bar.n);
		this.#built = bi;
		this.#system = sys;
		this.#kt = [];
		this.#kx = [];
		if (sys < 0) return;
		const system = this.#index.doc.systems[sys];
		const box = system.bars.find((b) => b.n === bar.n);
		if (!box) return;
		const t0 = bar.t;
		const t1 = bi + 1 < bars.length ? bars[bi + 1].t : this.#end;
		let firstHead = Infinity;
		for (const h of system.heads) firstHead = Math.min(firstHead, h[0]);
		const u = (this.#index.doc.unit ?? PDF_UNIT) / PDF_UNIT; // 1 for the PDF; Verovio draws about 36 times bigger
		const isFirst = system.bars[0].n === bar.n;
		const left =
			isFirst && Number.isFinite(firstHead) ? Math.max(box.x0, firstHead - 9 * u) : box.x0;

		this.#win.startedBetween(t0 - 0.001, t1 - 0.001);
		const a = this.#win.startedStart;
		const b = this.#win.startedEnd;
		const { t_on } = this.#win.notes;
		const kt = this.#kt;
		const kx = this.#kx;
		let i = a;
		while (i < b) {
			// notes within 40 ms of each other are one column: their cursor position is the mean x
			const t = t_on[i];
			let sum = 0;
			let n = 0;
			let j = i;
			while (j < b && t_on[j] - t < 0.04) {
				const x = this.#index.headX(j, sys);
				// a note whose head is in the next bar can start a few ms before the bar's time: not this bar's
				if (!Number.isNaN(x) && x >= box.x0 - u && x <= box.x1) {
					sum += x;
					n++;
				}
				j++;
			}
			if (n) {
				const x = sum / n;
				if (kt.length === 0 || (t > kt[kt.length - 1] && x >= kx[kx.length - 1])) {
					kt.push(t);
					kx.push(x - 3 * u);
				}
			}
			i = j;
		}
		if (kt.length === 0 || kt[0] > t0) {
			kt.unshift(t0);
			kx.unshift(left);
		}
		if (kt[kt.length - 1] < t1) {
			kt.push(t1);
			kx.push(box.x1 - 2 * u);
		}
	}

	/** Cursor x (in the system's file coordinates) at `t` on the system returned by `systemAt`, NaN if none. */
	x(t: number): number {
		const bi = this.barIndexAt(t);
		if (bi < 0) return NaN;
		if (bi !== this.#built) this.#build(bi);
		const kt = this.#kt;
		if (kt.length === 0) return NaN;
		if (t <= kt[0]) return this.#kx[0];
		let k = 1;
		while (k < kt.length - 1 && kt[k] < t) k++;
		const span = kt[k] - kt[k - 1];
		const u = span > 0 ? Math.min(1, Math.max(0, (t - kt[k - 1]) / span)) : 1;
		return this.#kx[k - 1] + (this.#kx[k] - this.#kx[k - 1]) * u;
	}

	get system(): number {
		return this.#system;
	}
}

/**
 * Which noteheads of `system` are sounding at `t`: writes the head index into `out` (a preallocated Uint8Array
 * with one slot per head: 0 = silent, otherwise the voice number of a sounding note) and returns how many
 * slots were set. The caller zeroes `out` before each call.
 */
export function markSounding(
	index: NotationIndex,
	win: NoteWindow,
	notes: NoteColumns,
	t: number,
	system: number,
	out: Uint8Array
): number {
	win.query(t, 0, 0);
	let set = 0;
	for (let a = 0; a < win.activeCount; a++) {
		const i = win.active[a];
		for (let k = index.start[i]; k < index.start[i + 1]; k++) {
			if (index.system[k] !== system) continue;
			const h = index.head[k];
			if (!out[h]) set++;
			out[h] = notes.voice[i];
		}
	}
	return set;
}
