/**
 * The scene book (T5.1.1): which scene plays for which piece.
 *
 * `scenes.json` has a `default` (what a piece without a scene of its own gets), an `idle` scene for the silent gaps between
 * pieces, named `scenes`, and `pieces`: for a piece id, either the name of a scene or an inline scene. Every scene is a
 * *partial* config, filled in from the default by `parseScene` (so the file only says what differs) and checked for typos
 * and out-of-range values; a mistake is reported with the entry it is in. The director (`director.ts`) asks the book for
 * the scene whenever the piece changes.
 */

import raw from './scenes.json';
import { DEFAULT_SCENE, parseScene, SceneError, type SceneConfig } from '../visual/scene.js';

export class SceneBook {
	readonly default: SceneConfig;
	readonly idle: SceneConfig;
	readonly #pieces: ReadonlyMap<string, SceneConfig>;

	constructor(def: SceneConfig, idle: SceneConfig, pieces: Map<string, SceneConfig>) {
		this.default = def;
		this.idle = idle;
		this.#pieces = pieces;
	}

	/** The scene of a piece; the default if it has none of its own, the idle scene if no piece is playing. */
	forPiece(id: string | null | undefined): SceneConfig {
		if (id == null) return this.idle;
		return this.#pieces.get(id) ?? this.default;
	}

	/** The piece ids that have a scene of their own. */
	get bespoke(): string[] {
		return [...this.#pieces.keys()];
	}
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseBook(doc: unknown): SceneBook {
	if (!isObject(doc)) throw new SceneError(['scenes.json must be an object']);
	const problems: string[] = [];
	for (const k of Object.keys(doc))
		if (!['default', 'idle', 'scenes', 'pieces'].includes(k)) problems.push(`${k}: unknown key`);

	const one = (path: string, v: unknown, base: SceneConfig): SceneConfig => {
		try {
			return parseScene(v ?? {}, base);
		} catch (e) {
			if (!(e instanceof SceneError)) throw e;
			problems.push(...e.problems.map((p) => `${path}.${p}`));
			return base;
		}
	};
	const def = one('default', doc.default, DEFAULT_SCENE);
	const idle = one('idle', doc.idle, def);

	const named = new Map<string, SceneConfig>();
	if (doc.scenes !== undefined && !isObject(doc.scenes))
		problems.push('scenes: expected an object');
	else
		for (const [name, v] of Object.entries(doc.scenes ?? {}))
			named.set(name, one(`scenes.${name}`, v, def));

	const pieces = new Map<string, SceneConfig>();
	if (doc.pieces !== undefined && !isObject(doc.pieces))
		problems.push('pieces: expected an object');
	else
		for (const [id, v] of Object.entries(doc.pieces ?? {})) {
			if (typeof v === 'string') {
				const s = named.get(v);
				if (s) pieces.set(id, s);
				else problems.push(`pieces.${id}: no scene named "${v}"`);
			} else pieces.set(id, one(`pieces.${id}`, v, def));
		}
	if (problems.length) throw new SceneError(problems);
	return new SceneBook(def, idle, pieces);
}

/** The book that ships. */
export const BOOK = parseBook(raw);
