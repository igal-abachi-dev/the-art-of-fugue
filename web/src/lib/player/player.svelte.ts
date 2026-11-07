/**
 * The interface's state and actions (E7). One `Player` per page wraps a playback `Session` and holds what the listener
 * chose (`settings`, kept in `localStorage`), which panel is open, the loop, and the short messages. The components only
 * show it and call its methods; the keyboard table (`keys.ts`) calls `run()`.
 *
 * Nothing here is read per frame: the stage reads the clock itself (T3.2.1). The reactive position is the transport's
 * 10 Hz one.
 */

import { barAt } from '../data/manifest.js';
import { findPiece, playOrder } from '../playback/links.js';
import type { Session } from '../playback/session.js';
import type { Action } from './keys.js';
import { LoopController, nearestBar, stepBar, type LoopRegion } from './loop.js';
import {
	DEFAULTS,
	TONE_LIMIT_DB,
	browserStorage,
	clearSettings,
	loadSettings,
	saveSettings,
	voiceMask,
	type RepeatMode,
	type Settings,
	type StorageLike
} from './settings.js';
import { describeTime } from './seekmath.js';
import type { SampleBank } from '../sampler/bank.js';
import type { Sampler } from '../sampler/sampler.js';
import { rankLookup, type RegistrationDoc } from '../sampler/registration.js';
import { AmbientBudget, isPhone, systemWantsLessMotion, watchReducedMotion } from './device.js';

export type Panel = 'pieces' | 'info' | 'effects' | 'help' | 'jump' | null;

/** What is heard: the recording, or the notes of the piece played by one of three sampled instruments (E8). */
export type Instrument = 'recording' | 'piano' | 'harpsichord' | 'organ';

export const INSTRUMENTS: readonly { id: Instrument; label: string; hint: string }[] = [
	{ id: 'recording', label: 'The recording', hint: 'Marta Czech at the piano' },
	{ id: 'piano', label: 'Piano', hint: 'Salamander grand, sampled' },
	{ id: 'harpsichord', label: 'Harpsichord', hint: 'a Flemish harpsichord, sampled' },
	{ id: 'organ', label: 'Pipe organ', hint: 'a baroque-style organ, full chorus, sampled' }
];

const instrumentLabel = (id: Instrument) => INSTRUMENTS.find((i) => i.id === id)?.label ?? id;

/** The listener's timing correction of the sampled instruments, in milliseconds either way. */
export const OFFSET_LIMIT_MS = 100;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;
const SPEED_STEP = 0.05;
const VOLUME_STEP = 0.05;
/** how long the loop and repeat checks wait between looks at the clock, milliseconds */
const TICK_MS = 25;

const round = (v: number, step: number) => Math.round(v / step) * step;

export class Player {
	readonly session: Session;
	settings = $state<Settings>({ ...DEFAULTS, voices: [...DEFAULTS.voices] });
	panel = $state<Panel>(null);
	/** the A-B loop, null when there is none */
	region = $state<LoopRegion | null>(null);
	/** the first mark of a loop being set (A), waiting for B */
	pendingA = $state<number | null>(null);
	/** a short message for the toast ("Loop off", "Link copied") */
	toast = $state('');
	/** what a screen reader is told about: the piece that began, the loop that was set */
	announcement = $state('');
	/** the listener has chosen to begin (the start screen is gone) */
	begun = $state(false);
	/** the system asks for less motion (followed while the page is open, T7.5.1) */
	systemReduced = $state(false);
	/** this device is a phone: the quality ladder starts lower and the ambient layer waits for a frame budget (T7.5.2) */
	readonly phone: boolean;
	/** the ambient layer may show: always, except on a phone until its frame rate has held */
	ambientOk = $state(true);
	/**
	 * What is heard (E8): the recording, or an instrument (piano, harpsichord, organ) that plays the notes of the piece from
	 * samples in the recording's time while the recording runs silent as the clock. Not stored: every visit begins with the
	 * recording.
	 */
	instrument = $state<Instrument>('recording');
	/** the instrument being fetched (the one before it keeps sounding until the new one is ready), or null */
	instrumentLoading = $state<Instrument | null>(null);
	/** how much of that instrument has loaded, 0..1 */
	instrumentProgress = $state(0);
	/**
	 * The browser keeps the sound off until the listener touches the page (most do on a first visit): the music waits, and
	 * the first click, tap or key starts it.
	 */
	waiting = $state(false);
	/** the page was opened on a bar (a link with a piece and bar): the welcome is skipped and the music plays at once */
	readonly linked: boolean;
	/** reduced motion is on, by the listener's choice or the system's */
	get calm(): boolean {
		return this.settings.reducedMotion || this.systemReduced;
	}

	readonly #loop = new LoopController();
	readonly #storage: StorageLike | null;
	#timer: ReturnType<typeof setInterval> | null = null;
	/** the last piece the playhead was in, so that a tick that lands just after its end still knows which piece ended */
	#lastPiece: { audio_start: number; audio_end: number } | null = null;
	#toastTimer: ReturnType<typeof setTimeout> | null = null;
	#lastPieceId: string | null = null;
	#budget: AmbientBudget;
	#unwatch: () => void;
	readonly #samplers: Partial<Record<Instrument, Sampler>> = {};
	readonly #banks: Partial<Record<Instrument, SampleBank>> = {};
	/** the organ's registration score (fetched when the organ is first chosen) and, for each piece, its lookup */
	#registration: RegistrationDoc | null = null;
	readonly #windowPiece = new WeakMap<object, string>();
	/** changes at every switch, so that a load that was overtaken knows it was */
	#instrumentToken = 0;
	/** called for the browser-only actions the components handle */
	onfullscreen: () => void = () => {};
	onjump: () => void = () => {};

	constructor(session: Session, storage: StorageLike | null = browserStorage()) {
		this.session = session;
		this.#storage = storage;
		this.linked = session.transport.position > 1;
		// without a link the recording is ready at the first piece, not in the silence before it
		if (!this.linked) {
			const first = playOrder(session.manifest)[0];
			if (first) session.engine.seekPlace({ piece: first });
		}
		this.settings = loadSettings(storage);
		this.#applyAudio();
		this.phone = isPhone();
		this.#budget = new AmbientBudget(!this.phone);
		this.ambientOk = this.#budget.allowed;
		this.systemReduced = systemWantsLessMotion();
		this.#unwatch = watchReducedMotion((r) => {
			this.systemReduced = r;
			this.say(r ? 'Less motion, as your system asks' : 'Your system allows motion again');
		});
		// the loop and the repeat modes look at the clock often (a transport tick of 100 ms would make a loop sloppy)
		this.#timer = setInterval(() => this.#tick(), TICK_MS);
		session.engine.subscribe(() => this.#followPiece());
	}

	get engine() {
		return this.session.engine;
	}
	get transport() {
		return this.session.transport;
	}
	get manifest() {
		return this.session.manifest;
	}
	get repeat(): RepeatMode {
		return this.settings.repeat;
	}
	/** voices of the piece being heard (1 to 4) */
	get voiceCount(): number {
		// read the reactive piece id first: `engine.piece` is not reactive, and a count that stopped depending on the id would
		// never change when the listener moves to a piece with other voices
		const id = this.transport.pieceId;
		const p = this.manifest.pieces.find((x) => x.id === id) ?? this.engine.piece;
		return Math.min(4, Math.max(2, p?.voices.length ?? 4));
	}
	get mask(): number[] {
		return voiceMask(this.settings);
	}

	// ---- settings

	/** Change settings and keep them. */
	set(patch: Partial<Settings>): void {
		this.settings = { ...this.settings, ...patch };
		this.#applyAudio();
		this.#loop.repeat = this.settings.repeat;
		saveSettings(this.#storage, this.settings);
	}

	resetSettings(): void {
		clearSettings(this.#storage);
		this.settings = { ...DEFAULTS, voices: [...DEFAULTS.voices] };
		this.#applyAudio();
		this.#loop.repeat = 'off';
		this.say('Settings reset');
	}

	#applyAudio(): void {
		const e = this.engine;
		e.setVolume(this.settings.volume);
		e.setMuted(this.settings.muted);
		e.setRate(this.settings.rate);
		for (const sampler of Object.values(this.#samplers))
			sampler.setTone(this.settings.instrumentTone);
		this.#loop.repeat = this.settings.repeat;
	}

	// ---- messages

	say(text: string): void {
		this.toast = text;
		if (this.#toastTimer) clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => (this.toast = ''), 1800);
	}

	#announce(text: string): void {
		this.announcement = text;
	}

	/** Tell a screen reader when the piece changes. */
	#followPiece(): void {
		const id = this.engine.piece?.id ?? null;
		if (id !== this.#lastPieceId) {
			this.#lastPieceId = id;
			if (this.begun)
				this.#announce(id ? `Now playing: ${this.engine.piece!.title}` : 'Between pieces');
		}
	}

	// ---- transport

	/**
	 * Start the music. Called by a click, a tap or a key (the browser then lets the sound begin), or by `welcome()` when the
	 * browser lets a page play at once.
	 */
	async begin(opts: { calm?: boolean } = {}): Promise<void> {
		if (opts.calm) this.set({ reducedMotion: true, ambient: false, bloom: false });
		this.#open();
		this.waiting = false;
		await this.engine.start();
	}

	/** The start screen is gone: the player shows. A link already says what to hear; otherwise the piece list opens. */
	#open(): void {
		if (this.begun) return;
		this.begun = true;
		// a tick later: the click that started the music must not also be the outside click that closes the list it opens
		if (!this.linked) setTimeout(() => (this.panel ??= 'pieces'), 0);
	}

	/**
	 * The welcome: the start screen shows for `showMs`, then fades out and the music begins by itself (a link to a bar skips
	 * the screen). Where the browser will not play without a touch, the player appears paused and says so; the first touch
	 * plays. Returns when the screen may go.
	 */
	async welcome(showMs: number, linked: boolean): Promise<void> {
		if (this.begun) return;
		this.engine.prefetch();
		if (!linked) await new Promise((r) => setTimeout(r, showMs));
		if (this.begun) return; // a click during the welcome has started it already
		const ok = await this.engine.autostart();
		if (this.begun) return;
		this.#open();
		if (!ok) {
			this.waiting = true;
			this.say('Click, tap or press Space to play');
		}
	}

	toggle(): void {
		void this.engine.toggle();
	}

	/** A seek the listener asked for: a loop that it leaves ends, and says so. */
	seekTo(t: number): void {
		if (this.#loop.userSeek(t)) {
			this.region = null;
			this.say('Loop off');
		}
		this.engine.seek(t);
	}

	seekBy(dt: number): void {
		this.seekTo(this.engine.clock.now() + dt);
	}

	/** Previous or next piece; false at either end of the recording. */
	stepPiece(direction: 1 | -1): boolean {
		const before = this.#loop.region;
		const ok = this.engine.step(direction);
		if (ok && before) this.#dropLoop();
		return ok;
	}

	stepBar(direction: 1 | -1): void {
		const b = stepBar(this.manifest, this.engine.clock.now(), direction);
		if (b) this.seekTo(b.t);
		else this.say(direction > 0 ? 'No later bar in this piece' : 'At the start of the piece');
	}

	restartPiece(): void {
		const t = this.engine.clock.now();
		const piece = this.engine.piece ?? playOrder(this.manifest).findLast((p) => p.audio_start <= t);
		this.#dropLoop();
		if (piece) this.engine.seekPlace({ piece });
		else this.engine.seek(0);
	}

	stop(): void {
		this.#dropLoop();
		this.engine.stop();
	}

	/** Go to a piece (by slug or id) and optionally a bar. Returns an error text, or null. */
	jump(pieceText: string, barText: string): string | null {
		const piece = findPiece(this.manifest, pieceText);
		if (!piece) return `No piece called "${pieceText}"`;
		const bar = barText.trim() === '' ? undefined : Number(barText);
		if (bar !== undefined && !Number.isInteger(bar)) return 'The bar is a number';
		this.#dropLoop();
		return this.engine.seekPlace({ piece, bar }) ? null : `No bar ${barText} in ${piece.title}`;
	}

	// ---- sound

	setVolume(v: number): void {
		const volume = Math.min(1, Math.max(0, round(v, 0.01)));
		this.set({ volume, muted: volume === 0 ? this.settings.muted : false });
	}

	nudgeVolume(sign: 1 | -1): void {
		this.setVolume(this.settings.volume + sign * VOLUME_STEP);
		this.say(`Volume ${Math.round(this.settings.volume * 100)} %`);
	}

	toggleMute(): void {
		this.set({ muted: !this.settings.muted });
		this.say(this.settings.muted ? 'Muted' : 'Sound on');
	}

	setRate(r: number): void {
		this.set({ rate: Math.min(1.5, Math.max(0.5, round(r, 0.01))) });
	}

	nudgeRate(sign: 1 | -1): void {
		this.setRate(this.settings.rate + sign * SPEED_STEP);
		this.say(`Speed ${this.settings.rate.toFixed(2)}×`);
	}

	// ---- repeat and loop

	cycleRepeat(): void {
		const next: RepeatMode = { off: 'piece', piece: 'all', all: 'off' }[
			this.settings.repeat
		] as RepeatMode;
		this.set({ repeat: next });
		this.say(
			{ off: 'Repeat off', piece: 'Repeat this piece', all: 'Repeat the whole recording' }[next]
		);
	}

	/** `A`: mark the start of a loop, then its end, then clear it. Both marks snap to bar lines. */
	markLoop(): void {
		if (this.region) return this.clearLoop();
		const b = nearestBar(this.manifest, this.engine.clock.now());
		const t = b?.t ?? this.engine.clock.now();
		if (this.pendingA === null) {
			this.pendingA = t;
			this.say(b ? `Loop starts at bar ${b.bar}` : 'Loop start set');
			return;
		}
		if (this.#loop.setRegion(this.pendingA, t)) {
			this.region = this.#loop.region;
			this.pendingA = null;
			this.say(b ? `Looping to bar ${b.bar}` : 'Looping');
			this.#announce('Loop set');
		} else {
			this.say('The loop would be too short');
		}
	}

	/** Set the loop from two times (from dragging on the seek bar); both snap to bar lines. */
	setLoop(a: number, b: number): boolean {
		const sa = nearestBar(this.manifest, a)?.t ?? a;
		const sb = nearestBar(this.manifest, b)?.t ?? b;
		if (!this.#loop.setRegion(sa, sb)) return false;
		this.region = this.#loop.region;
		this.pendingA = null;
		return true;
	}

	clearLoop(): void {
		this.#loop.clear();
		this.region = null;
		this.pendingA = null;
		this.say('Loop off');
	}

	#dropLoop(): void {
		if (this.#loop.region || this.pendingA !== null) {
			this.#loop.clear();
			this.region = null;
			this.pendingA = null;
			this.say('Loop off');
		}
	}

	#tick(): void {
		const e = this.engine;
		if (!this.begun) return;
		const playing = e.status === 'playing' || e.status === 'buffering';
		const ended = e.status === 'ended';
		if (!playing && !ended) return;
		const t = e.clock.now();
		if (this.#loop.outside(t)) {
			this.#dropLoop(); // the playhead was moved by something that is not this panel
			return;
		}
		if (e.piece) this.#lastPiece = e.piece;
		// at the end of a piece the engine already says "between pieces": the 25 ms tick would miss the 20 ms in which "repeat
		// the piece" is due, so the piece that has just ended still counts for a moment
		const last = this.#lastPiece;
		const piece = e.piece ?? (last && t >= last.audio_end && t < last.audio_end + 1 ? last : null);
		const jump = this.#loop.check(t, {
			pieceStart: piece?.audio_start ?? null,
			pieceEnd: piece?.audio_end ?? null,
			duration: e.duration,
			ended
		});
		if (!jump) return;
		e.seek(jump.to);
		if (jump.play) void e.play();
	}

	// ---- voices and view

	toggleVoice(i: number): void {
		const v = [...this.settings.voices] as Settings['voices'];
		v[i - 1] = !v[i - 1];
		this.set({ voices: v, solo: 0 });
		this.say(`Voice ${i} ${v[i - 1] ? 'shown' : 'hidden'}`);
	}

	soloVoice(i: number): void {
		const solo = this.settings.solo === i ? 0 : i;
		this.set({ solo });
		this.say(solo ? `Voice ${i} alone` : 'All voices');
	}

	togglePanel(p: Exclude<Panel, null>): void {
		this.panel = this.panel === p ? null : p;
	}

	closePanel(): boolean {
		if (!this.panel) return false;
		this.panel = null;
		return true;
	}

	/** The words for the bar under the playhead, for a link or a screen reader. */
	where(): string {
		return describeTime(this.manifest, this.engine.clock.now()).text;
	}

	/** Copy the link to this bar (the session keeps the URL in step with the position). */
	async copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(location.href);
			this.say('Link copied');
		} catch {
			this.say('Copy the address from the browser');
		}
	}

	/** The listener's key presses and buttons end up here. */
	run(action: Action): void {
		switch (action) {
			case 'toggle':
				return this.toggle();
			case 'back5':
				return this.seekBy(-5);
			case 'forward5':
				return this.seekBy(5);
			case 'back30':
				return this.seekBy(-30);
			case 'forward30':
				return this.seekBy(30);
			case 'prevPiece':
				return void this.stepPiece(-1);
			case 'nextPiece':
				return void this.stepPiece(1);
			case 'prevBar':
				return this.stepBar(-1);
			case 'nextBar':
				return this.stepBar(1);
			case 'restartPiece':
				return this.restartPiece();
			case 'volumeUp':
				return this.nudgeVolume(1);
			case 'volumeDown':
				return this.nudgeVolume(-1);
			case 'mute':
				return this.toggleMute();
			case 'slower':
				return this.nudgeRate(-1);
			case 'faster':
				return this.nudgeRate(1);
			case 'resetSpeed':
				this.setRate(1);
				return this.say('Normal speed');
			case 'jump':
				this.panel = 'jump';
				return this.onjump();
			case 'repeat':
				return this.cycleRepeat();
			case 'loopMark':
				return this.markLoop();
			case 'voice1':
			case 'voice2':
			case 'voice3':
			case 'voice4':
				return this.toggleVoice(Number(action.slice(5)));
			case 'solo1':
			case 'solo2':
			case 'solo3':
			case 'solo4':
				return this.soloVoice(Number(action.slice(4)));
			case 'pieces':
				return this.togglePanel('pieces');
			case 'info':
				return this.togglePanel('info');
			case 'effects':
				return this.togglePanel('effects');
			case 'instrument':
				return this.cycleInstrument();
			case 'score':
				return this.set({ score: !this.settings.score });
			case 'spectro':
				return this.set({ spectro: !this.settings.spectro });
			case 'help':
				return this.togglePanel('help');
			case 'fullscreen':
				return this.onfullscreen();
			case 'escape':
				this.closePanel();
		}
	}

	/** The bar number the playhead is in, for labels. */
	barNow(): number | null {
		const p = this.engine.piece;
		return p ? (barAt(p, this.engine.clock.now())?.n ?? null) : null;
	}

	/** The sampler of the instrument being heard, once it has been switched on (for the browser check). */
	get sampler(): Sampler | null {
		return this.#samplers[this.instrument] ?? null;
	}

	/** The next instrument: recording, piano, harpsichord, organ, and round again. */
	cycleInstrument(): void {
		const now = this.instrumentLoading ?? this.instrument;
		const k = INSTRUMENTS.findIndex((i) => i.id === now);
		void this.setInstrument(INSTRUMENTS[(k + 1) % INSTRUMENTS.length].id);
	}

	/** Move the sampled instruments earlier (+) or later (-) against the recording, in milliseconds. */
	/** Make the sampled instruments darker (negative) or brighter, by dB at the top. */
	nudgeTone(db: number): void {
		const v = Math.min(
			TONE_LIMIT_DB,
			Math.max(-TONE_LIMIT_DB, Math.round(this.settings.instrumentTone + db))
		);
		this.set({ instrumentTone: v });
		this.say(
			v === 0 ? 'Tone: as made' : `Tone: ${v > 0 ? 'brighter' : 'darker'} by ${Math.abs(v)} dB`
		);
	}

	nudgeOffset(ms: number): void {
		const v = Math.min(
			OFFSET_LIMIT_MS,
			Math.max(-OFFSET_LIMIT_MS, Math.round(this.settings.instrumentOffset + ms))
		);
		this.set({ instrumentOffset: v });
		this.say(
			v === 0
				? 'Instrument timing: as measured'
				: `Instrument timing: ${v > 0 ? '+' : '\u2212'}${Math.abs(v)} ms`
		);
	}

	/** The organ's registration score. Without it (the file missing) the organ plays its main voice, the full rank, throughout. */
	async #loadRegistration(): Promise<void> {
		try {
			const { loadRegistration } = await import('../sampler/registration.js');
			this.#registration = await loadRegistration();
		} catch {
			this.#registration = { version: 1, pieces: {} };
		}
	}

	#stopSamplers(except?: Instrument): void {
		for (const [id, sampler] of Object.entries(this.#samplers)) if (id !== except) sampler.stop();
	}

	/**
	 * Switch what is heard. The first time an instrument is chosen its samples are fetched and decoded (2 to 5 MB; nothing of
	 * it is loaded before), and the instrument that was sounding goes on until the new one is ready. If the load fails the
	 * listener is told and what was sounding goes on.
	 */
	async setInstrument(id: Instrument): Promise<void> {
		const token = ++this.#instrumentToken;
		const graph = this.engine.graph;
		if (id === 'recording') {
			this.#stopSamplers();
			graph?.setRecordingAudible(true);
			this.instrument = 'recording';
			this.instrumentLoading = null;
			this.say('The recording');
			return;
		}
		if (id === this.instrument && this.#samplers[id]) {
			this.instrumentLoading = null;
			return;
		}
		const label = instrumentLabel(id);
		if (!graph?.context || !graph.connected) {
			this.instrumentLoading = null;
			this.say(
				`The ${label.toLowerCase()} needs Web Audio, which this browser does not have: the recording plays`
			);
			return;
		}
		this.instrumentLoading = id;
		this.instrumentProgress = this.#banks[id] ? 1 : 0;
		try {
			const [bankModule, { Sampler }] = await Promise.all([
				import('../sampler/bank.js'),
				import('../sampler/sampler.js')
			]);
			let bank = this.#banks[id];
			if (!bank) {
				try {
					const spec = await bankModule.fetchSpec(id);
					bank = await bankModule.loadBank(graph.context, {
						spec,
						onProgress: (done, total) => {
							if (token === this.#instrumentToken) this.instrumentProgress = done / total;
						},
						cancelled: () => token !== this.#instrumentToken
					});
				} catch (e) {
					if (e instanceof bankModule.LoadCancelled) return; // the listener chose something else meanwhile
					throw e;
				}
				this.#banks[id] = bank;
			}
			if (token !== this.#instrumentToken) return;
			let sampler = this.#samplers[id];
			if (!sampler) {
				const engine = this.engine;
				sampler = new Sampler(
					{
						ctx: graph.context,
						now: () => engine.clock.now(),
						epoch: () => engine.clock.epoch,
						rate: () => engine.rate,
						playing: () => engine.status === 'playing',
						hidden: () => typeof document !== 'undefined' && document.hidden,
						offset: () => this.settings.instrumentOffset / 1000,
						tone: () => this.settings.instrumentTone,
						registration: (w) =>
							this.#registration
								? rankLookup(this.#registration, this.#windowPiece.get(w) ?? '')
								: undefined,
						windows: (from, to) =>
							this.manifest.pieces
								.filter((p) => p.audio_end + 1 > from && p.audio_start - 1 < to)
								.map((p) => {
									const w = engine.window(p.id);
									if (w) this.#windowPiece.set(w, p.id);
									return w;
								})
								.filter((w): w is NonNullable<typeof w> => w !== null)
					},
					bank
				);
				graph.connectInput(sampler.output);
				this.#samplers[id] = sampler;
			}
			if (bank.registration === 'terraced' && !this.#registration) await this.#loadRegistration();
			if (token !== this.#instrumentToken) return;
			this.#stopSamplers(id);
			graph.setRecordingAudible(false);
			sampler.start();
			this.instrument = id;
			this.instrumentLoading = null;
			this.say(`${label}: the notes of the piece, in the recording\u2019s time`);
		} catch (e) {
			if (token !== this.#instrumentToken) return;
			this.instrumentLoading = null;
			const now = instrumentLabel(this.instrument).toLowerCase();
			this.say(
				`The ${label.toLowerCase()} could not be loaded (${e instanceof Error ? e.message : e}): the ${now} ${this.instrument === 'recording' ? 'plays' : 'goes on'}`
			);
		}
	}

	/** The stage's frame rate over its last half second, for the phone's ambient budget (T7.5.2). */
	observeFrames(fps: number, dt: number): void {
		this.#budget.observe(fps, dt, this.engine.status === 'playing');
		if (this.#budget.allowed !== this.ambientOk) this.ambientOk = this.#budget.allowed;
	}

	dispose(): void {
		this.#unwatch();
		this.#instrumentToken++;
		for (const sampler of Object.values(this.#samplers)) sampler.dispose();
		this.engine.graph?.setRecordingAudible(true);
		if (this.#timer) clearInterval(this.#timer);
		if (this.#toastTimer) clearTimeout(this.#toastTimer);
		this.#timer = this.#toastTimer = null;
	}
}
