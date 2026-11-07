/**
 * The scene director (T5.1.1, T5.1.2, T5.5.2, T5.4.2): turns "which piece is playing and where" into what the stage shows.
 *
 * Once per frame, before the stage draws, `step(frame)`:
 *
 * * notices that the piece changed (a boundary of the manifest, or a seek into another piece) and fades to that piece's
 *   scene from `scenes.json`, or to the idle scene when no piece is sounding;
 * * once the piece's notes, events and (for a mirror piece) counterpart pitches have loaded, tells the stage what the
 *   annotations say: per-note tags, the ending, the mirror axis, and starts an event bus for the piece;
 * * lets the bus fire the clash and crossing events that the playhead passed, as shockwave rings at their pitch;
 * * starts the flip when a mirror piece follows its pair (rectus to inversus).
 *
 * Everything else the scenes do is a function of the playhead evaluated on the GPU, so it is seek-safe by construction.
 */

import type { PieceEntry, PieceEvent } from '../data/manifest.js';
import type { NoteColumns } from '../data/notes.js';
import type { NoteWindow } from '../playback/window.js';
import type { PieceFx } from '../visual/stage.js';
import { endingOf } from '../visual/effects.js';
import { KIND_CLASH, KIND_CROSSING } from '../visual/shock.js';
import type { SceneConfig } from '../visual/scene.js';
import { EventBus } from './eventbus.js';
import { BOOK, type SceneBook } from './scenes.js';
import { buildTags } from './tags.js';

/** the part of the stage the director drives */
export interface DirectorStage {
	setScene(config: SceneConfig, seconds?: number): void;
	setPieceFx(win: NoteWindow, fx: PieceFx): void;
	flip(): void;
	shock(t: number, pitch: number, voice: number, strength: number, kind: number): boolean;
}

/** the part of the playback engine the director reads */
export interface DirectorEngine {
	readonly piece: PieceEntry | null;
	window(id: string): NoteWindow | null;
	notes(id: string): Promise<NoteColumns>;
	events(id: string): Promise<PieceEvent[]>;
	mirror(id: string): Promise<Uint8Array | null>;
}

/** seconds a change from one scene to the next takes */
export const SCENE_FADE_S = 0.9;

/** how strongly a clash rings, by the interval between its two notes in semitones (seconds, tritones and sevenths bite) */
export function clashStrength(interval: unknown): number {
	if (typeof interval !== 'number') return 0.7;
	const c = ((Math.abs(interval) % 12) + 12) % 12;
	return c === 1 || c === 2 || c === 6 || c === 10 || c === 11 ? 1 : 0.7;
}

interface Loading {
	id: string;
	ready: boolean;
	events?: PieceEvent[];
	mirror?: Uint8Array | null;
}

export class Director {
	readonly #engine: DirectorEngine;
	readonly #stage: DirectorStage;
	readonly #book: SceneBook;
	#id: string | null | undefined = undefined;
	#lastPlayed: string | null = null;
	#bus: EventBus | null = null;
	/** the piece whose data is being waited for */
	#loading: Loading | null = null;
	#disposed = false;
	/** scene changes made, for tests and the HUD */
	changes = 0;

	constructor(engine: DirectorEngine, stage: DirectorStage, book: SceneBook = BOOK) {
		this.#engine = engine;
		this.#stage = stage;
		this.#book = book;
	}

	/** the id of the piece the director has set the scene for (null = idle, undefined = none yet) */
	get current(): string | null | undefined {
		return this.#id;
	}

	step(frame: { t: number; discontinuity: boolean }): void {
		if (this.#disposed) return;
		const piece = this.#engine.piece;
		const id = piece?.id ?? null;
		if (id !== this.#id) this.#enter(piece, id);
		if (this.#loading && !this.#loading.ready) this.#finishLoading(piece);
		this.#bus?.step(frame.t, frame.discontinuity);
	}

	#enter(piece: PieceEntry | null, id: string | null): void {
		const first = this.#id === undefined;
		this.#id = id;
		this.changes++;
		this.#bus = null;
		this.#loading = null;
		this.#stage.setScene(this.#book.forPiece(id), first ? 0 : SCENE_FADE_S);
		if (!piece || !id) return;
		// the second piece of a mirror pair, reached from the first: turn the picture over
		if (piece.mirror && this.#lastPlayed === piece.mirror.pair && id.endsWith('i'))
			this.#stage.flip();
		this.#lastPlayed = id;
		const load: Loading = { id, ready: false };
		this.#loading = load;
		void Promise.all([
			this.#engine.notes(id),
			this.#engine.events(id).catch(() => [] as PieceEvent[]),
			this.#engine.mirror(id).catch(() => null)
		]).then(([, events, mirror]) => {
			load.events = events;
			load.mirror = mirror;
		});
	}

	#finishLoading(piece: PieceEntry | null): void {
		const load = this.#loading;
		if (!load || !piece || piece.id !== load.id || !load.events) return;
		const win = this.#engine.window(load.id);
		if (!win) return; // the notes have arrived but the window is not built yet: next frame
		load.ready = true;
		const scene = this.#book.forPiece(load.id);
		const events = load.events;
		this.#stage.setPieceFx(win, {
			tags: buildTags(win.notes.n, events, load.mirror ?? null),
			ending: scene.ending ? endingOf(win) : null,
			axisSum: piece.mirror?.axis_sum ?? null,
			bars: piece.bars.map((b) => b.t)
		});
		const bus = new EventBus(events);
		const n = win.notes;
		bus.on('clash', (e) => {
			const p = e.data.pitches as number[] | undefined;
			const v = e.data.voices as number[] | undefined;
			if (!p || p.length < 2) return;
			this.#stage.shock(
				e.t,
				Math.round((p[0] + p[1]) / 2),
				v?.[0] ?? 1,
				clashStrength(e.data.interval),
				KIND_CLASH
			);
		});
		bus.on('crossing', (e) => {
			const idx = e.notes.filter((i) => i >= 0 && i < n.n);
			if (idx.length === 0) return;
			const pitch = Math.round(idx.reduce((a, i) => a + n.pitch[i], 0) / idx.length);
			const voice = Number(e.data.upper_voice) || 1;
			this.#stage.shock(e.t, pitch, voice, 0.6, KIND_CROSSING);
		});
		this.#bus = bus;
	}

	/** Events fired for the current piece so far. */
	get fired(): number {
		return this.#bus?.fired ?? 0;
	}

	dispose(): void {
		this.#disposed = true;
		this.#bus = null;
		this.#loading = null;
	}
}
