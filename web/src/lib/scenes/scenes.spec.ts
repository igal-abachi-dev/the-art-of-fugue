import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SceneError } from '../visual/scene.js';
import { BOOK, parseBook } from './scenes.js';

const manifest = JSON.parse(
	readFileSync(new URL('../../../static/data/manifest.json', import.meta.url), 'utf8')
) as { pieces: { id: string; kind: string }[] };

describe('the scene book that ships', () => {
	it('names only pieces that exist, and every piece has a scene of its own', () => {
		const ids = new Set(manifest.pieces.map((p) => p.id));
		for (const id of BOOK.bespoke) expect(ids.has(id), id).toBe(true);
		expect(BOOK.bespoke.length).toBe(manifest.pieces.length);
	});

	it('falls back to the default for an unknown piece and to idle for none', () => {
		expect(BOOK.forPiece('no-such-piece')).toBe(BOOK.default);
		expect(BOOK.forPiece(null)).toBe(BOOK.idle);
		expect(BOOK.idle.effects.particles).toBeGreaterThan(0); // a few embers drift in the gaps
		expect(BOOK.idle.effects.particles).toBeLessThan(0.7);
	});

	it('follows the plan: void, ribbons, themes, ghost, links, ending', () => {
		for (const id of ['c01', 'c02', 'c03', 'c04']) {
			const s = BOOK.forPiece(id);
			expect(s.id).toBe('void');
			expect(s.effects.particles).toBe(0);
			expect(s.effects.trails).toBe(0);
			expect(s.features.themeColour).toBe(0);
		}
		for (const id of ['c06', 'c07']) expect(BOOK.forPiece(id).features.ribbons).toBe(1);
		for (const id of ['c08', 'c09', 'c10', 'c11', 'c14']) {
			expect(BOOK.forPiece(id).features.themeColour).toBe(1);
			expect(BOOK.forPiece(id).features.shockwaves).toBeGreaterThan(0);
		}
		for (const id of ['c12r', 'c12i', 'c13r', 'c13i'])
			expect(BOOK.forPiece(id).features.ghost).toBe(1);
		for (const id of ['k1', 'k2', 'k3', 'k4']) {
			expect(BOOK.forPiece(id).features.links).toBe(1);
			expect(BOOK.forPiece(id).layout).toBe('lanes');
		}
		expect(BOOK.bespoke.filter((id) => BOOK.forPiece(id).ending)).toEqual(['c14']);
		expect(BOOK.forPiece('c14').features.bach).toBe(1);
	});
});

describe('the scenes agree with the annotations', () => {
	const events = (id: string) =>
		JSON.parse(
			readFileSync(
				new URL(`../../../static/data/pieces/${id}.events.json`, import.meta.url),
				'utf8'
			)
		) as { type: string; data: Record<string, unknown> }[];

	it('uses ribbons exactly in the pieces whose subject is augmented or diminished', () => {
		for (const p of manifest.pieces) {
			const scaled = events(p.id).some(
				(e) => e.type === 'subject-entry' && typeof e.data.ratio === 'number' && e.data.ratio !== 1
			);
			expect(BOOK.forPiece(p.id).features.ribbons > 0, p.id).toBe(scaled);
		}
	});

	it('highlights subject entries in every piece where the subject is inverted', () => {
		for (const p of manifest.pieces) {
			const inverted = events(p.id).some(
				(e) => e.type === 'subject-entry' && e.data.inverted === true
			);
			if (inverted) expect(BOOK.forPiece(p.id).features.highlight, p.id).toBeGreaterThan(0);
		}
	});

	it('shows canon links only where the annotations have them', () => {
		for (const p of manifest.pieces) {
			const linked = events(p.id).some((e) => e.type === 'canon-link');
			expect(BOOK.forPiece(p.id).features.links > 0, p.id).toBe(linked);
		}
	});
});

describe('parseBook', () => {
	it('fills a partial scene from the default; a piece can name a scene or give one inline', () => {
		const b = parseBook({
			default: { speed: 3 },
			scenes: { a: { layout: 'lanes' } },
			pieces: { x: 'a', y: { ahead: 5 } }
		});
		expect(b.forPiece('x').speed).toBe(3);
		expect(b.forPiece('x').layout).toBe('lanes');
		expect(b.forPiece('y').ahead).toBe(5);
		expect(b.forPiece('z').layout).toBe('keyboard');
	});

	it('reports every mistake with the entry it is in', () => {
		let err: SceneError | null = null;
		try {
			parseBook({
				scenes: { s: { features: { highlight: 7 } } },
				pieces: { c01: 'missing', c02: { colour: 'red' } },
				extra: 1
			});
		} catch (e) {
			err = e as SceneError;
		}
		const text = err!.problems.join('\n');
		expect(text).toContain('scenes.s.features.highlight');
		expect(text).toContain('pieces.c01: no scene named "missing"');
		expect(text).toContain('pieces.c02.colour: unknown key');
		expect(text).toContain('extra: unknown key');
	});

	it('rejects something that is not an object', () => {
		expect(() => parseBook([])).toThrow(SceneError);
	});
});

describe('the ambient layer of the scenes (E6)', () => {
	const curated = JSON.parse(
		readFileSync(new URL('../ambient/curated.json', import.meta.url), 'utf8')
	) as { presets: Record<string, { source: string; scenes: string[] }> };
	const shipped = (id: string) =>
		new URL(`../../../static/data/ambient/${id}.json`, import.meta.url);

	const scenes = () => {
		const out = new Map<string, { preset: string | null; opacity: number }>();
		out.set('idle', BOOK.idle.ambient);
		for (const id of BOOK.bespoke) out.set(BOOK.forPiece(id).id, BOOK.forPiece(id).ambient);
		return out;
	};

	it('names only presets that are curated, and every scene that shows the layer names one', () => {
		for (const [name, a] of scenes()) {
			if (a.opacity > 0) expect(a.preset, name).not.toBeNull();
			if (a.preset) expect(curated.presets[a.preset], `${name}: ${a.preset}`).toBeDefined();
		}
	});

	it('curates no preset that no scene uses, and says which scene uses it', () => {
		const used = new Map<string, string[]>();
		for (const [name, a] of scenes())
			if (a.preset) used.set(a.preset, [...(used.get(a.preset) ?? []), name]);
		for (const [id, p] of Object.entries(curated.presets)) {
			expect(used.has(id), `${id} is unused`).toBe(true);
			expect([...(used.get(id) ?? [])].sort(), id).toEqual([...p.scenes].sort());
		}
	});

	it('ships every curated preset as a file the layer can load', () => {
		for (const id of Object.keys(curated.presets)) {
			const preset = JSON.parse(readFileSync(shipped(id), 'utf8')) as Record<string, unknown>;
			for (const k of ['baseVals', 'shapes', 'waves', 'warp', 'comp', 'frame_eqs_str'])
				expect(preset[k], `${id}.${k}`).toBeDefined();
		}
	});

	it('keeps the layer restrained: faint behind notes, stronger in the gaps, none in the ending’s black', () => {
		for (const [name, a] of scenes()) expect(a.opacity, name).toBeLessThanOrEqual(0.5);
		expect(BOOK.idle.ambient.opacity).toBeGreaterThan(BOOK.forPiece('c05').ambient.opacity);
		expect(BOOK.forPiece('c01').ambient.opacity).toBeLessThan(0.2); // the plain fugues stay plain
		expect(BOOK.idle.effects.shake).toBe(0); // nothing to shake between pieces
	});
});
