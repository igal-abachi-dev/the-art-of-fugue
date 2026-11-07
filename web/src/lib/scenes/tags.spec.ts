import { describe, expect, it } from 'vitest';
import type { PieceEvent } from '../data/manifest.js';
import {
	buildTags,
	RATIO_AUGMENTATION,
	RATIO_DIMINUTION,
	RATIO_NORMAL,
	ratioClass,
	TAG_BACH,
	TAG_INVERTED,
	TAG_SUBJECT,
	themeNumber
} from './tags.js';

const ev = (type: string, notes: number[], data: Record<string, unknown>): PieceEvent => ({
	id: 'x',
	type,
	bar: 1,
	voice: 1,
	pass: 1,
	t: 0,
	t_end: 1,
	notes,
	data
});

describe('buildTags', () => {
	it('marks subject entries with their theme, inversion and time scaling', () => {
		const tags = buildTags(8, [
			ev('subject-entry', [0, 1, 2], { theme: 'S1', inverted: false, ratio: 1 }),
			ev('subject-entry', [4, 5], { theme: 'S3', inverted: true, ratio: 0.5 }),
			ev('subject-entry', [6], { theme: 'S2', inverted: false, ratio: 2 })
		]);
		expect([...tags.bits]).toEqual([
			TAG_SUBJECT,
			TAG_SUBJECT,
			TAG_SUBJECT,
			0,
			TAG_SUBJECT | TAG_INVERTED,
			TAG_SUBJECT | TAG_INVERTED,
			TAG_SUBJECT,
			0
		]);
		expect([...tags.theme]).toEqual([1, 1, 1, 0, 3, 3, 2, 0]);
		expect([...tags.ratio]).toEqual([
			0,
			0,
			0,
			0,
			RATIO_DIMINUTION,
			RATIO_DIMINUTION,
			RATIO_AUGMENTATION,
			0
		]);
	});

	it('marks only the exact form of BACH', () => {
		const tags = buildTags(6, [
			ev('bach', [0, 1, 2, 3], { form: 'exact' }),
			ev('bach', [4, 5], { form: 'transposed' }),
			ev('bach', [5], { form: 'inverted' })
		]);
		expect([...tags.bits]).toEqual([4, 4, 4, 4, 0, 0].map((b) => b & TAG_BACH));
	});

	it('ignores indices outside the piece, and events of other types', () => {
		const tags = buildTags(2, [
			ev('subject-entry', [1, 7, -1], { theme: 'S1', inverted: false, ratio: 1 }),
			ev('clash', [0], {})
		]);
		expect([...tags.bits]).toEqual([0, TAG_SUBJECT]);
	});

	it('links each follower note of a canon to the note it follows', () => {
		const tags = buildTags(6, [ev('canon-link', [3, 4, 5, 9], { leader_notes: [0, 1, 2, 3] })]);
		expect([...tags.leader]).toEqual([-1, -1, -1, 0, 1, 2]);
		expect([...buildTags(2, []).leader]).toEqual([-1, -1]);
	});

	it('carries the counterpart pitches of a mirror piece', () => {
		const tags = buildTags(3, [], Uint8Array.of(60, 0, 72, 99));
		expect([...tags.ghost]).toEqual([60, 0, 72]);
		expect([...buildTags(3, []).ghost]).toEqual([0, 0, 0]);
	});
});

describe('classifiers', () => {
	it('reads theme numbers and ratios', () => {
		expect(themeNumber('S4')).toBe(4);
		expect(themeNumber('B')).toBe(0);
		expect(themeNumber(undefined)).toBe(0);
		expect(ratioClass(1)).toBe(RATIO_NORMAL);
		expect(ratioClass(0.5)).toBe(RATIO_DIMINUTION);
		expect(ratioClass(2)).toBe(RATIO_AUGMENTATION);
		expect(ratioClass(null)).toBe(RATIO_NORMAL);
	});
});
