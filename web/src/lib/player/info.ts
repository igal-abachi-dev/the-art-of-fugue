/**
 * The words of the "what am I hearing" panel (T7.4.2): the annotations of the piece (`events.json`) that are happening
 * at the playhead, as sentences. The same events drive the scene effects (E5), so what is said here is what the picture
 * is doing.
 */

import type { PieceEntry, PieceEvent } from '../data/manifest.js';

const VOICE_NAMES: Record<string, string> = {
	S: 'soprano',
	A: 'alto',
	T: 'tenor',
	B: 'bass',
	upper: 'upper voice',
	middle: 'middle voice',
	lower: 'lower voice'
};

const INTERVALS = [
	'unison',
	'minor second',
	'major second',
	'minor third',
	'major third',
	'fourth',
	'tritone',
	'fifth',
	'minor sixth',
	'major sixth',
	'minor seventh',
	'major seventh'
];

export function voiceName(piece: Pick<PieceEntry, 'voices'>, voice: number | null): string {
	if (voice === null) return 'a voice';
	const label = piece.voices.find((v) => v.voice === voice)?.label;
	return label ? (VOICE_NAMES[label] ?? label) : `voice ${voice}`;
}

const FORMS: Record<string, string> = {
	rectus: '',
	inversus: ' (inverted)',
	diminution: ' (in diminution: twice as fast)',
	'diminution-inversus': ' (inverted, in diminution)',
	augmentation: ' (in augmentation: twice as slow)',
	'augmentation-inversus': ' (inverted, in augmentation)'
};

export interface Described {
	id: string;
	type: string;
	text: string;
	/** playhead seconds */
	t: number;
	tEnd: number;
	bar: number;
}

/** One event as a sentence. */
export function describeEvent(ev: PieceEvent, piece: Pick<PieceEntry, 'voices'>): Described {
	const d = ev.data;
	let text: string;
	switch (ev.type) {
		case 'subject-entry': {
			const theme = String(d.theme ?? 'S1');
			const what = theme === 'S1' ? 'The subject' : `Theme ${theme.replace(/^S/, '')}`;
			text = `${what} enters in the ${voiceName(piece, ev.voice)}${FORMS[String(d.form)] ?? ''}`;
			break;
		}
		case 'crossing': {
			text = `The ${voiceName(piece, Number(d.upper_voice))} and the ${voiceName(piece, Number(d.lower_voice))} cross`;
			break;
		}
		case 'clash': {
			const names = (Array.isArray(d.voices) ? d.voices : []).map((v) =>
				voiceName(piece, Number(v))
			);
			const iv = Number(d.interval);
			const name = Number.isFinite(iv) ? INTERVALS[((iv % 12) + 12) % 12] : 'dissonance';
			text = `A sharp ${name}${names.length === 2 ? ` between the ${names[0]} and the ${names[1]}` : ''}`;
			break;
		}
		case 'bach': {
			const form = String(d.form ?? '');
			const how =
				form === 'retrograde'
					? ' backwards'
					: form === 'inverted'
						? ' upside down'
						: form === 'transposed'
							? ' transposed'
							: '';
			text = `The composer's name, B-A-C-H, in the ${voiceName(piece, ev.voice)}${how}`;
			break;
		}
		case 'mirror-link':
			text = 'This piece is the mirror image of its partner: every note has a counterpart';
			break;
		case 'canon-link':
			text = `The ${voiceName(piece, ev.voice)} follows the ${voiceName(piece, Number(d.leader_voice))} note for note`;
			break;
		default:
			text = ev.type;
	}
	return { id: ev.id, type: ev.type, text, t: ev.t, tEnd: ev.t_end, bar: ev.bar };
}

/** The sentences for the events that cover time `t`, newest first, at most `limit`. `events` must be sorted by start. */
export function activeSentences(
	events: readonly PieceEvent[],
	piece: Pick<PieceEntry, 'voices'>,
	t: number,
	limit = 4
): Described[] {
	const out: Described[] = [];
	for (const e of events) {
		if (e.t > t) break;
		if (t < e.t_end) out.push(describeEvent(e, piece));
	}
	return out.sort((a, b) => b.t - a.t).slice(0, limit);
}
