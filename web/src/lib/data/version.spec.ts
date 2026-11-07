import { afterEach, describe, expect, it } from 'vitest';
import { loadManifest, loadPieceNotes } from './manifest.js';
import { currentBuild, setBuild, versioned } from './version.js';

afterEach(() => setBuild(''));

describe('versioned URLs', () => {
	it('adds the build id as a query, once, and leaves URLs alone without one', () => {
		expect(versioned('/data/pieces/c01.bin')).toBe('/data/pieces/c01.bin');
		setBuild('abc123');
		expect(versioned('/data/pieces/c01.bin')).toBe('/data/pieces/c01.bin?v=abc123');
		expect(versioned('/audio/fugue.webm?v=feed')).toBe('/audio/fugue.webm?v=feed');
		setBuild(null);
		expect(currentBuild()).toBe('');
	});

	it('is taken from the manifest, which itself is fetched without a version', async () => {
		const asked: string[] = [];
		const manifest = {
			version: 1,
			build: 'b00b1e',
			notes_format: [],
			pieces: [{ id: 'x', notes: 'pieces/x.bin' }]
		};
		const fetchFn = async (u: string) => {
			asked.push(u);
			return u.endsWith('.bin')
				? new Response(new ArrayBuffer(8))
				: new Response(JSON.stringify(manifest));
		};
		const m = await loadManifest(fetchFn);
		expect(asked).toEqual(['/data/manifest.json']);
		expect(currentBuild()).toBe('b00b1e');
		await loadPieceNotes(m, 'x', fetchFn).catch(() => undefined); // the fixture is not a real chunk
		expect(asked[1]).toBe('/data/pieces/x.bin?v=b00b1e');
	});

	it('forgets the id when the next manifest has none', async () => {
		setBuild('old');
		await loadManifest(async () => new Response(JSON.stringify({ version: 1, pieces: [] })));
		expect(currentBuild()).toBe('');
	});
});
