import { describe, expect, it } from 'vitest';
import curated from '../ambient/curated.json';
import { presetAuthors, presetCredits } from './credits.js';

describe('presetCredits', () => {
	it('splits the pack name into author and title, one credit per shipped preset', () => {
		const c = presetCredits({
			presets: {
				a: { source: 'martin - blue mountains' },
				b: { source: 'Rovastar - Hyperspace' },
				c: { source: 'Martin - underwater cathedral' },
				d: { source: 'nameless' }
			}
		});
		expect(c.map((x) => [x.id, x.author, x.title])).toEqual([
			['a', 'martin', 'blue mountains'],
			['c', 'Martin', 'underwater cathedral'],
			['b', 'Rovastar', 'Hyperspace'],
			['d', 'unknown', 'nameless']
		]);
	});

	it('lists each author once, whatever the capitalisation', () => {
		const credits = presetCredits(curated);
		expect(credits).toHaveLength(Object.keys(curated.presets).length);
		const authors = presetAuthors(credits);
		expect(new Set(authors.map((a) => a.toLowerCase())).size).toBe(authors.length);
		expect(authors.map((a) => a.toLowerCase())).toContain('martin');
		expect(credits.every((x) => x.author !== 'unknown')).toBe(true);
	});
});
