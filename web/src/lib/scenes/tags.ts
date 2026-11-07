/**
 * Per-note scene tags (T5.2.2, T5.3.1, T5.4.1, T5.5.1, T5.7.1): what the annotations say about each note of a piece, in the
 * shape the shaders read.
 *
 * The events name their notes by position in the piece's note chunk, so the tags are four small arrays with one entry
 * per note, filled once when a piece's events have loaded. Nothing here depends on the playhead, so a seek cannot leave a
 * note wrongly marked.
 */

import type { PieceEvent } from '../data/manifest.js';

/** bits of `NoteTags.bits` */
export const TAG_SUBJECT = 1;
export const TAG_INVERTED = 2;
export const TAG_BACH = 4;

/** values of `NoteTags.ratio` */
export const RATIO_NORMAL = 0;
export const RATIO_DIMINUTION = 1;
export const RATIO_AUGMENTATION = 2;

export interface NoteTags {
	n: number;
	/** `TAG_*` bits */
	bits: Uint8Array;
	/** 1..6 for a note of subject S1..S6, 0 for none */
	theme: Uint8Array;
	/** `RATIO_*`: how the statement the note belongs to is scaled in time */
	ratio: Uint8Array;
	/** MIDI pitch of the note's counterpart in the paired mirror piece, 0 for none */
	ghost: Uint8Array;
	/** for a note that echoes another in a canon: the position of the note it follows, else -1 */
	leader: Int32Array;
}

export function emptyTags(n: number): NoteTags {
	return {
		n,
		bits: new Uint8Array(n),
		theme: new Uint8Array(n),
		ratio: new Uint8Array(n),
		ghost: new Uint8Array(n),
		leader: new Int32Array(n).fill(-1)
	};
}

/** The theme number of "S3" (3), or 0. */
export function themeNumber(s: unknown): number {
	const m = typeof s === 'string' ? /^S(\d)$/.exec(s) : null;
	return m ? Math.min(6, Number(m[1])) : 0;
}

/** Ratio of a statement against the subject (0.5 = twice as fast, 2 = twice as slow) as a `RATIO_*` class. */
export function ratioClass(ratio: unknown): number {
	if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return RATIO_NORMAL;
	if (ratio < 0.9) return RATIO_DIMINUTION;
	if (ratio > 1.1) return RATIO_AUGMENTATION;
	return RATIO_NORMAL;
}

/**
 * Tags for a piece of `n` notes. Only BACH statements in the exact form (the pitches B♭ A C B♮ as written) mark notes: the
 * transposed, inverted and retrograde forms are the annotation pipeline's looser matches and are not shown.
 */
export function buildTags(
	n: number,
	events: readonly PieceEvent[],
	mirror: Uint8Array | null = null
): NoteTags {
	const tags = emptyTags(n);
	for (const e of events) {
		const d = e.data;
		if (e.type === 'subject-entry') {
			const theme = themeNumber(d.theme);
			const ratio = ratioClass(d.ratio);
			for (const i of e.notes) {
				if (i < 0 || i >= n) continue;
				tags.bits[i] |= TAG_SUBJECT | (d.inverted === true ? TAG_INVERTED : 0);
				if (theme) tags.theme[i] = theme;
				tags.ratio[i] = ratio;
			}
		} else if (e.type === 'canon-link') {
			const lead = Array.isArray(d.leader_notes) ? (d.leader_notes as number[]) : [];
			for (let k = 0; k < e.notes.length && k < lead.length; k++) {
				const f = e.notes[k];
				const l = lead[k];
				if (f >= 0 && f < n && l >= 0 && l < n && l !== f) tags.leader[f] = l;
			}
		} else if (e.type === 'bach' && d.form === 'exact') {
			for (const i of e.notes) if (i >= 0 && i < n) tags.bits[i] |= TAG_BACH;
		}
	}
	if (mirror) tags.ghost.set(mirror.subarray(0, n));
	return tags;
}
