/**
 * The organ's registration score: for each piece and each of its voices, when the organ plays the full rank (1) and when the flute (0).
 *
 * Nothing is decided here. The score is made in the data pipeline (`tools/artfugue/registration.py`, from the notes of the MusicXML,
 * the subject entries found in them, the recording's loudness and brightness, the bar lines and a short character of each piece) and
 * written to `data/organ-registration.json`, with the owner's own corrections (`data/organ-registration-overrides.json`) applied over
 * it, so that the organ is registered the same way every time, in every browser, and a person can read it and change it. This module
 * only reads the score: `{ pieces: { c01: { "1": [[start, end, "full" | "flute"], ...], ... } } }`, seconds on the recording's timeline.
 */

import { versioned } from '../data/version.js';

export type Segment = [start: number, end: number, rank: 'full' | 'flute'];

export interface RegistrationDoc {
	version: number;
	pieces: Record<string, Record<string, Segment[]>>;
}

/** The rank a note of this voice has at this time: 1 the full rank, 0 the flute. */
export type RankOf = (voice: number, t: number) => 0 | 1;

/** A score from untrusted JSON: segments that are not three-part, or out of order, are dropped; a voice with none has the full rank. */
export function parseRegistration(raw: unknown): RegistrationDoc {
	const pieces: RegistrationDoc['pieces'] = {};
	const doc = (typeof raw === 'object' && raw !== null ? raw : {}) as {
		pieces?: Record<string, unknown>;
	};
	for (const [id, voices] of Object.entries(doc.pieces ?? {})) {
		if (typeof voices !== 'object' || voices === null) continue;
		const out: Record<string, Segment[]> = {};
		for (const [voice, segs] of Object.entries(voices as Record<string, unknown>)) {
			if (!Array.isArray(segs)) continue;
			const clean: Segment[] = [];
			for (const s of segs) {
				if (
					Array.isArray(s) &&
					typeof s[0] === 'number' &&
					typeof s[1] === 'number' &&
					s[1] > s[0] &&
					(s[2] === 'full' || s[2] === 'flute') &&
					(clean.length === 0 || s[0] >= clean[clean.length - 1][0])
				)
					clean.push([s[0], s[1], s[2]]);
			}
			out[voice] = clean;
		}
		pieces[id] = out;
	}
	return { version: 1, pieces };
}

/** The lookup for one piece; a piece or a voice the score does not have is the full rank, the organ's main voice. */
export function rankLookup(doc: RegistrationDoc, pieceId: string): RankOf {
	const voices = doc.pieces[pieceId];
	return (voice, t) => {
		const segs = voices?.[String(voice)];
		if (!segs?.length) return 1;
		// the last segment that begins at or before t
		let lo = 0;
		let hi = segs.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (segs[mid][0] <= t) lo = mid;
			else hi = mid - 1;
		}
		const s = segs[lo];
		if (t < s[0]) return 1; // before the voice's first note
		return s[2] === 'flute' ? 0 : 1;
	};
}

/** Fetch the score (a small file, once). */
export async function loadRegistration(
	fetchFn: (input: string) => Promise<Response> = (u) => fetch(u)
): Promise<RegistrationDoc> {
	const res = await fetchFn(versioned('/data/organ-registration.json'));
	if (!res.ok) throw new Error(`organ-registration.json ${res.status}`);
	return parseRegistration(await res.json());
}
