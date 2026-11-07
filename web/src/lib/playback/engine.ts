/**
 * Playback engine: one `<audio>` element, its Web Audio graph, the master clock and the piece data.
 *
 * Framework-agnostic on purpose (the reactive store in `transport.svelte.ts` wraps it); everything the
 * browser provides is injected, so the state machine is unit-tested against a fake element.
 *
 * Time everywhere in this class is **seconds on the WAV timeline**, the timeline of all bar and note data.
 * The element's own time differs by the chosen source's `offset_s` (AAC plays ~11 ms early).
 */

import { browserCanPlay, rankAudioSources, type CanPlay } from '../audio/source.js';
import {
	barAt,
	SEEK_SLACK,
	loadPieceEvents,
	loadPieceMirror,
	loadPieceNotes,
	pieceAt,
	type AudioSource,
	type Manifest,
	type PieceEntry,
	type PieceEvent
} from '../data/manifest.js';
import type { NoteColumns } from '../data/notes.js';
import { MasterClock } from './clock.js';
import { AudioGraph, setMediaSource } from './graph.js';
import { playOrder, seekTime, type Place } from './links.js';
import { NoteWindow } from './window.js';

export type Status =
	'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;

/** What the engine needs from the element beyond `MediaLike`. `HTMLAudioElement` satisfies it. */
export type EngineElement = HTMLMediaElement;

export interface EngineOptions {
	graph?: AudioGraph;
	canPlay?: CanPlay;
	perfNow?: () => number;
	pageOrigin?: string;
	fetchFn?: (input: string) => Promise<Response>;
	dataBase?: string;
	/**
	 * How long after Start the browser may produce no data at all (no metadata, no error) before the next
	 * audio source is tried. Default 10 s.
	 */
	fallbackMs?: number;
}

/** MediaError codes for a file the decoder cannot use (`MEDIA_ERR_DECODE`, `MEDIA_ERR_SRC_NOT_SUPPORTED`). */
const UNPLAYABLE = [3, 4];

export interface BarRef {
	n: number;
	pass: number;
}

export class PlaybackEngine {
	readonly element: EngineElement;
	readonly manifest: Manifest;
	readonly clock: MasterClock;
	readonly graph: AudioGraph | null;

	/** reasons for each switch to the next audio source, oldest first (for the HUD and the browser check) */
	readonly fallbacks: string[] = [];

	status: Status = 'idle';
	error: string | null = null;
	rate = 1;
	/** piece being heard at the last `update()`, null in a gap between pieces */
	piece: PieceEntry | null = null;
	bar: BarRef | null = null;

	readonly #listeners = new Set<(e: PlaybackEngine) => void>();
	readonly #notes = new Map<string, Promise<NoteColumns>>();
	readonly #windows = new Map<string, NoteWindow>();
	readonly #events = new Map<string, Promise<PieceEvent[]>>();
	readonly #mirrors = new Map<string, Promise<Uint8Array | null>>();
	readonly #fetch: ((input: string) => Promise<Response>) | undefined;
	readonly #base: string | undefined;
	readonly #order: PieceEntry[];
	readonly #candidates: AudioSource[];
	readonly #pageOrigin: string;
	readonly #fallbackMs: number;
	#index = 0;
	#watchdog: ReturnType<typeof setTimeout> | null = null;
	#started = false;
	#disposed = false;
	readonly #onMedia = () => this.#refresh();
	readonly #onError = () => {
		const code = this.element.error?.code ?? 0;
		if (UNPLAYABLE.includes(code) && this.#fallback(`media error ${code}`)) return;
		this.#refresh();
	};
	static readonly #MEDIA_EVENTS = [
		'loadstart',
		'loadedmetadata',
		'durationchange',
		'canplay',
		'playing',
		'pause',
		'waiting',
		'seeking',
		'seeked',
		'stalled',
		'ended',
		'error',
		'progress',
		'ratechange',
		'emptied'
	];

	constructor(element: EngineElement, manifest: Manifest, opts: EngineOptions = {}) {
		this.element = element;
		this.manifest = manifest;
		this.#order = playOrder(manifest);
		this.#fetch = opts.fetchFn;
		this.#base = opts.dataBase;
		this.graph = opts.graph ?? null;
		this.#candidates = rankAudioSources(manifest.audio, opts.canPlay ?? browserCanPlay());
		this.#pageOrigin = opts.pageOrigin ?? location.origin;
		this.#fallbackMs = opts.fallbackMs ?? 10_000;
		this.clock = new MasterClock(element, {
			perfNow: opts.perfNow,
			offset: this.source?.offset_s ?? 0
		});
		for (const e of PlaybackEngine.#MEDIA_EVENTS) {
			element.addEventListener(e, e === 'error' ? this.#onError : this.#onMedia);
		}
		if (this.source) {
			element.preload = 'metadata'; // do not fetch ~90 MB until the listener presses Start
			setMediaSource(element, this.source.src, this.#pageOrigin);
			this.status = 'loading';
		} else {
			this.status = 'error';
			this.error = 'This browser cannot play Opus or AAC audio.';
		}
	}

	/** The audio file in use: the preferred playable one, or the next after a fallback. */
	get source(): AudioSource | null {
		return this.#candidates[this.#index] ?? null;
	}

	subscribe(fn: (e: PlaybackEngine) => void): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	get duration(): number {
		const d = this.element.duration;
		return Number.isFinite(d) && d > 0
			? d + (this.source?.offset_s ?? 0)
			: (this.manifest.duration ?? 0);
	}

	/** Fraction (0..1) of the audio file that has been fetched (sum of buffered ranges / duration). */
	get loadedFraction(): number {
		const b = this.element.buffered;
		const d = this.element.duration;
		if (!b || !Number.isFinite(d) || d <= 0) return 0;
		let sum = 0;
		for (let i = 0; i < b.length; i++) sum += b.end(i) - b.start(i);
		return Math.min(1, sum / d);
	}

	/** Seconds buffered ahead of the playhead (0 when the playhead is outside every buffered range). */
	get bufferedAhead(): number {
		const b = this.element.buffered;
		const t = this.element.currentTime;
		if (!b) return 0;
		for (let i = 0; i < b.length; i++) {
			if (t >= b.start(i) && t <= b.end(i)) return b.end(i) - t;
		}
		return 0;
	}

	/** Call from the Start click (or any gesture): unlocks the audio graph and plays. */
	async start(): Promise<void> {
		if (!this.source || this.#disposed) return;
		this.#started = true;
		this.element.preload = 'auto';
		// Synchronous parts first: iOS wants play() in the same turn as the gesture.
		const unlocked = this.graph?.unlock() ?? Promise.resolve();
		const playing = this.element.play();
		this.#armWatchdog();
		try {
			await Promise.all([unlocked, playing]);
		} catch (e) {
			this.#fail(e);
		}
		this.#refresh();
	}

	/**
	 * Begin fetching the audio ahead of the first play: the welcome shows for a moment before the music is asked to start, and
	 * the start is quicker for the data being on its way. Only the start of the file is buffered, as the browser decides.
	 */
	prefetch(): void {
		if (this.#started || this.#disposed || !this.source) return;
		this.element.preload = 'auto';
	}

	/**
	 * Start without a gesture, where the browser allows a page to play by itself (a returning visitor in Chrome or Edge, a
	 * site the listener has allowed). Where it does not, nothing happens and false comes back: the audio context stays
	 * suspended, the recording stays paused, no error is raised, and the first click or key press calls `start()`.
	 */
	async autostart(waitMs = 800): Promise<boolean> {
		if (!this.source || this.#disposed || this.#started) return this.#started;
		const g = this.graph;
		if (g) {
			const unlocked = g.unlock();
			// where the browser can say that it will not let the page play (Firefox, Safari), there is nothing to wait for
			const nav = globalThis.navigator as Navigator & { getAutoplayPolicy?: (t: string) => string };
			let policy = '';
			try {
				policy = nav?.getAutoplayPolicy?.('audiocontext') ?? '';
			} catch {
				/* not supported for this type */
			}
			if (policy === 'disallowed') return false;
			// a context that may run does so within a few milliseconds, but a first one can take a few hundred (the audio
			// backend starting); one that may not stays suspended for good, and that is known after waitMs
			const state = await Promise.race([
				unlocked.then(() => 'running'),
				new Promise<string>((r) => setTimeout(() => r(g.context?.state ?? 'running'), waitMs))
			]);
			if (state !== 'running') return false;
		}
		try {
			this.element.preload = 'auto';
			await this.element.play();
		} catch {
			return false; // NotAllowedError: the page has not been touched yet
		}
		this.#started = true;
		this.#armWatchdog();
		this.#refresh();
		return true;
	}

	async play(): Promise<void> {
		if (!this.source || this.#disposed) return;
		if (!this.#started) return this.start();
		this.#armWatchdog();
		try {
			await Promise.all([this.graph?.ensureRunning(), this.element.play()]);
		} catch (e) {
			this.#fail(e);
		}
		this.#refresh();
	}

	pause(): void {
		this.element.pause();
		this.#refresh();
	}

	toggle(): Promise<void> | void {
		return this.element.paused ? this.play() : this.pause();
	}

	/** Seek to a WAV-timeline time. The clock reads the new time on the very next frame. */
	seek(t: number): void {
		if (!this.source) return;
		const max = Math.max(0, this.duration - 0.05);
		const target = Math.max(0, Math.min(max, t));
		this.element.currentTime = Math.max(0, target - this.source.offset_s);
		this.#track();
		this.#emit();
	}

	seekBy(dt: number): void {
		this.seek(this.clock.now() + dt);
	}

	/** Seek to a piece, optionally at a printed bar. Returns false if the bar does not exist. */
	seekPlace(place: Place): boolean {
		const t = seekTime(place);
		if (t === null) return false;
		this.seek(t);
		return true;
	}

	/** Previous/next piece in the order of the recording. From mid-piece, "previous" restarts the piece. */
	step(direction: 1 | -1): boolean {
		const t = this.clock.now();
		const cur = this.#order.findLastIndex(
			(p) => t >= p.audio_start - SEEK_SLACK && t < p.audio_end
		);
		let idx: number;
		if (cur < 0) {
			idx =
				direction > 0
					? this.#order.findIndex((p) => p.audio_start > t)
					: this.#order.findLastIndex((p) => p.audio_end <= t);
		} else if (direction < 0 && t - this.#order[cur].audio_start > 3) {
			idx = cur;
		} else {
			idx = cur + direction;
		}
		if (idx < 0 || idx >= this.#order.length) return false;
		return this.seekPlace({ piece: this.#order[idx] });
	}

	setRate(r: number): void {
		const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, r));
		this.rate = rate;
		const el = this.element as HTMLMediaElement & {
			webkitPreservesPitch?: boolean;
			mozPreservesPitch?: boolean;
		};
		el.preservesPitch = true;
		el.webkitPreservesPitch = true;
		el.mozPreservesPitch = true;
		el.defaultPlaybackRate = rate;
		el.playbackRate = rate;
		this.#refresh();
	}

	setVolume(v: number): void {
		if (this.graph) this.graph.setVolume(v);
		else this.element.volume = Math.max(0, Math.min(1, v));
	}

	/** Silence that keeps the volume setting (unmuting returns to it). */
	setMuted(muted: boolean): void {
		if (this.graph) this.graph.setMuted(muted);
		else this.element.muted = muted;
	}

	/**
	 * Stop, as a desktop player does: pause and go back to the start of the piece being heard (or the one just before the
	 * playhead in a gap, or the start of the recording).
	 */
	stop(): void {
		this.element.pause();
		const t = this.clock.now();
		const here =
			this.#order.find((p) => t >= p.audio_start && t < p.audio_end + (p.tail_s ?? 0)) ??
			this.#order.findLast((p) => p.audio_start <= t);
		if (here) this.seekPlace({ piece: here });
		else this.seek(0);
		this.#refresh();
	}

	/** Recompute the current piece and bar from the clock, load its data, and tell listeners if it changed. */
	update(): void {
		if (this.#track()) this.#emit();
	}

	#track(): boolean {
		const t = this.clock.now();
		const p = pieceAt(this.manifest, t);
		const b = p ? barAt(p, t + SEEK_SLACK) : null;
		const bar = b ? { n: b.n, pass: b.pass ?? 1 } : null;
		const changed = p !== this.piece || bar?.n !== this.bar?.n || bar?.pass !== this.bar?.pass;
		this.piece = p;
		this.bar = bar;
		if (p) this.#warm(p);
		return changed;
	}

	/** The piece's notes, fetched on first use and cached. */
	notes(id: string): Promise<NoteColumns> {
		let p = this.#notes.get(id);
		if (!p) {
			p = loadPieceNotes(this.manifest, id, this.#fetch, this.#base);
			this.#notes.set(id, p);
			p.then((cols) => this.#windows.set(id, new NoteWindow(cols))).catch(() =>
				this.#notes.delete(id)
			);
		}
		return p;
	}

	/** The piece's annotation events (sorted by time), fetched on first use and cached. */
	events(id: string): Promise<PieceEvent[]> {
		let p = this.#events.get(id);
		if (!p) {
			p = loadPieceEvents(this.manifest, id, this.#fetch, this.#base);
			this.#events.set(id, p);
			p.catch(() => this.#events.delete(id));
		}
		return p;
	}

	/** For a mirror piece: the pitch of each note's counterpart in the paired piece (null for other pieces). */
	mirror(id: string): Promise<Uint8Array | null> {
		let p = this.#mirrors.get(id);
		if (!p) {
			p = loadPieceMirror(this.manifest, id, this.#fetch, this.#base);
			this.#mirrors.set(id, p);
			p.catch(() => this.#mirrors.delete(id));
		}
		return p;
	}

	/** Query structure for a piece whose notes have loaded (null before that). */
	window(id: string): NoteWindow | null {
		return this.#windows.get(id) ?? null;
	}

	/** Re-request the audio after a network error, keeping the position. */
	reload(): void {
		if (!this.source) return;
		const t = this.clock.now();
		this.error = null;
		this.element.load();
		this.element.addEventListener('loadedmetadata', () => this.seek(t), { once: true });
		this.#refresh();
	}

	/**
	 * `canPlayType` is only a hint: an engine can claim WebM/Opus and then never load it, without any error
	 * event (seen in Playwright's WebKit). If the element has produced no metadata a while after Start, or
	 * reports an undecodable file, switch to the next playable source and carry on from the same position.
	 */
	#armWatchdog(): void {
		if (this.#watchdog !== null) clearTimeout(this.#watchdog);
		this.#watchdog = null;
		if (this.#index >= this.#candidates.length - 1) return; // nothing to fall back to
		this.#watchdog = setTimeout(() => {
			this.#watchdog = null;
			if (!this.#disposed && this.element.readyState === 0 && !this.element.error) {
				this.#fallback('no data from the source');
			}
		}, this.#fallbackMs);
	}

	#fallback(reason: string): boolean {
		if (this.#index >= this.#candidates.length - 1) return false;
		if (this.#watchdog !== null) clearTimeout(this.#watchdog);
		this.#watchdog = null;
		const t = this.clock.now();
		const wasPlaying = this.#started && !this.element.paused;
		this.fallbacks.push(`${this.source?.type}: ${reason}`);
		this.#index++;
		const next = this.source!;
		this.error = null;
		this.clock.setOffset(next.offset_s);
		setMediaSource(this.element, next.src, this.#pageOrigin);
		this.element.preload = this.#started ? 'auto' : 'metadata';
		this.element.addEventListener(
			'loadedmetadata',
			() => {
				this.seek(t);
				if (wasPlaying) void this.play();
			},
			{ once: true }
		);
		this.#armWatchdog();
		this.#refresh();
		return true;
	}

	dispose(): void {
		this.#disposed = true;
		if (this.#watchdog !== null) clearTimeout(this.#watchdog);
		for (const e of PlaybackEngine.#MEDIA_EVENTS) {
			this.element.removeEventListener(e, e === 'error' ? this.#onError : this.#onMedia);
		}
		this.clock.dispose();
		this.#listeners.clear();
		// A detached <audio> keeps playing, and one with a load in flight is kept alive by the browser. Stop it,
		// drop the file and close the audio context so the page can be left and re-entered any number of times.
		const el = this.element;
		el.pause?.();
		el.removeAttribute?.('src');
		el.load?.();
		this.graph?.dispose();
	}

	/** Load the piece being played and prefetch the one after it. */
	#warm(p: PieceEntry): void {
		void this.notes(p.id).catch(() => {});
		const i = this.#order.indexOf(p);
		const next = this.#order[i + 1];
		if (next) void this.notes(next.id).catch(() => {});
	}

	#fail(e: unknown): void {
		const name = e instanceof DOMException ? e.name : '';
		// A play() that is interrupted by pause() or a new load is not an error.
		if (name === 'AbortError') return;
		this.error =
			name === 'NotAllowedError'
				? 'The browser blocked playback; press Play again.'
				: e instanceof Error
					? e.message
					: String(e);
	}

	#compute(): Status {
		const el = this.element;
		if (!this.source) return 'error';
		if (el.error) {
			this.error ??= `Audio error ${el.error.code}`;
			return 'error';
		}
		if (el.readyState < 1) return 'loading';
		if (el.ended) return 'ended';
		if (!el.paused) {
			if (el.seeking || el.readyState < 3) return 'buffering';
			this.error = null;
			return 'playing';
		}
		if (el.seeking && el.readyState < 3) return 'buffering';
		return this.#started ? 'paused' : 'ready';
	}

	#refresh(): void {
		if (this.#disposed) return;
		this.status = this.#compute();
		this.rate = this.element.playbackRate;
		this.#track();
		this.#emit();
	}

	#emit(): void {
		for (const fn of this.#listeners) fn(this);
	}
}
