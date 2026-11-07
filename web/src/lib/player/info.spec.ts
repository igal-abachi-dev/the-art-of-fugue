import { describe, expect, it } from 'vitest';
import type { PieceEvent } from '../data/manifest.js';
import { activeSentences, describeEvent, voiceName } from './info.js';

const piece = {
	voices: [
		{ voice: 1, label: 'S' },
		{ voice: 2, label: 'A' },
		{ voice: 3, label: 'T' },
		{ voice: 4, label: 'B' }
	]
};
const ev = (
	type: string,
	t: number,
	tEnd: number,
	data: Record<string, unknown>,
	voice: number | null = null
) =>
	({
		id: `${type}-${t}`,
		type,
		bar: 3,
		voice,
		pass: 1,
		t,
		t_end: tEnd,
		notes: [],
		data
	}) as PieceEvent;

describe('describeEvent', () => {
	it('says who enters, and how', () => {
		expect(
			describeEvent(ev('subject-entry', 0, 5, { theme: 'S1', form: 'rectus' }, 3), piece).text
		).toBe('The subject enters in the tenor');
		expect(
			describeEvent(ev('subject-entry', 0, 5, { theme: 'S1', form: 'inversus' }, 2), piece).text
		).toBe('The subject enters in the alto (inverted)');
		expect(
			describeEvent(ev('subject-entry', 0, 5, { theme: 'S3', form: 'diminution' }, 1), piece).text
		).toContain('Theme 3 enters in the soprano (in diminution');
	});

	it('names clashes, crossings, B-A-C-H, mirrors and canons', () => {
		expect(
			describeEvent(ev('clash', 0, 1, { interval: 11, voices: [1, 3], pitches: [71, 60] }), piece)
				.text
		).toBe('A sharp major seventh between the soprano and the tenor');
		expect(
			describeEvent(ev('crossing', 0, 1, { upper_voice: 1, lower_voice: 2 }), piece).text
		).toBe('The soprano and the alto cross');
		expect(describeEvent(ev('bach', 0, 1, { form: 'retrograde' }, 3), piece).text).toBe(
			"The composer's name, B-A-C-H, in the tenor backwards"
		);
		expect(describeEvent(ev('mirror-link', 0, 1, {}), piece).text).toContain('mirror image');
		expect(describeEvent(ev('canon-link', 0, 1, { leader_voice: 1 }, 2), piece).text).toBe(
			'The alto follows the soprano note for note'
		);
	});

	it('copes with data it does not know', () => {
		expect(describeEvent(ev('weird', 0, 1, {}), piece).text).toBe('weird');
		expect(describeEvent(ev('clash', 0, 1, {}), piece).text).toContain('A sharp');
		expect(voiceName({ voices: [] }, 7)).toBe('voice 7');
		expect(voiceName(piece, null)).toBe('a voice');
	});
});

describe('activeSentences', () => {
	const list = [
		ev('subject-entry', 0, 10, { theme: 'S1', form: 'rectus' }, 1),
		ev('crossing', 4, 6, { upper_voice: 1, lower_voice: 2 }),
		ev('clash', 20, 22, { interval: 1, voices: [1, 2] })
	];
	it('lists the events that cover the time, newest first', () => {
		expect(activeSentences(list, piece, 5).map((s) => s.type)).toEqual([
			'crossing',
			'subject-entry'
		]);
		expect(activeSentences(list, piece, 7).map((s) => s.type)).toEqual(['subject-entry']);
		expect(activeSentences(list, piece, 15)).toEqual([]);
		expect(activeSentences(list, piece, 5, 1)).toHaveLength(1);
	});
});
