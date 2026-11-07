/**
 * What the listener chose and wants back next time (T7.1.3): volume, mute, speed, repeat mode, the effects, the voices
 * shown. Stored in `localStorage` under one key; anything missing, of the wrong type or out of range falls back to the
 * default, and a storage that is not there (private mode, blocked) is tolerated. The position is never stored and
 * nothing here starts playback.
 */

/** the tone control runs this far either way, dB */
export const TONE_LIMIT_DB = 9;

export type RepeatMode = 'off' | 'piece' | 'all';

export interface Settings {
	/** 0..1 on the slider (the sound follows a square law, see `volume.ts`) */
	volume: number;
	muted: boolean;
	/** playback speed, pitch kept */
	rate: number;
	repeat: RepeatMode;
	/** 'auto' lets each piece pick its scene; otherwise the id of a scene to keep */
	scene: string;
	ambient: boolean;
	bloom: boolean;
	reducedMotion: boolean;
	/** voices 1..4 shown on the stage */
	voices: [boolean, boolean, boolean, boolean];
	/** voice to show alone (1..4), or 0 */
	solo: number;
	/** the subject entries marked in every scene */
	highlight: boolean;
	/** the controls fade while playing */
	autoHide: boolean;
	/** seconds shown as time remaining instead of elapsed */
	remaining: boolean;
	/** the score of the piece over the stage */
	score: boolean;
	/** the recording's spectrogram over the stage */
	spectro: boolean;
	/** which engraving the score shows: Verovio's (the default) or the one from the printed score (PDF) */
	notation: 'pdf' | 'verovio';
	/** milliseconds the sampled instruments are moved earlier (+) or later (-) against the recording; 0 is as measured */
	instrumentOffset: number;
	/** dB of the sampled instruments' top (a shelf from 2.5 kHz): negative is darker, positive brighter; 0 is as made */
	instrumentTone: number;
}

export const DEFAULTS: Readonly<Settings> = {
	volume: 0.8,
	muted: false,
	rate: 1,
	repeat: 'off',
	scene: 'auto',
	ambient: true,
	bloom: true,
	reducedMotion: false,
	voices: [true, true, true, true],
	solo: 0,
	highlight: true,
	autoHide: true,
	remaining: false,
	score: false,
	spectro: false,
	notation: 'verovio',
	instrumentOffset: 0,
	instrumentTone: 0
};

export const KEY = 'art-of-fugue.settings.v1';

/** the minimum of `Storage` that is used, so tests can pass a plain object */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const num = (v: unknown, lo: number, hi: number, d: number) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Settings from untrusted JSON: every field is checked. */
export function parseSettings(raw: unknown): Settings {
	const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const voices = Array.isArray(o.voices) ? o.voices : [];
	const repeat =
		o.repeat === 'piece' || o.repeat === 'all' || o.repeat === 'off' ? o.repeat : 'off';
	const scene =
		typeof o.scene === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(o.scene) ? o.scene : DEFAULTS.scene;
	const solo = Number.isInteger(o.solo) ? (o.solo as number) : 0;
	return {
		volume: num(o.volume, 0, 1, DEFAULTS.volume),
		muted: bool(o.muted, DEFAULTS.muted),
		rate: num(o.rate, 0.5, 1.5, 1),
		repeat,
		scene,
		ambient: bool(o.ambient, DEFAULTS.ambient),
		bloom: bool(o.bloom, DEFAULTS.bloom),
		reducedMotion: bool(o.reducedMotion, DEFAULTS.reducedMotion),
		voices: [0, 1, 2, 3].map((i) => bool(voices[i], true)) as Settings['voices'],
		solo: solo >= 1 && solo <= 4 ? solo : 0,
		highlight: bool(o.highlight, DEFAULTS.highlight),
		autoHide: bool(o.autoHide, DEFAULTS.autoHide),
		remaining: bool(o.remaining, DEFAULTS.remaining),
		score: bool(o.score, DEFAULTS.score),
		spectro: bool(o.spectro, DEFAULTS.spectro),
		notation: o.notation === 'pdf' ? 'pdf' : 'verovio',
		instrumentOffset: Math.round(num(o.instrumentOffset, -100, 100, 0)),
		instrumentTone: Math.round(num(o.instrumentTone, -TONE_LIMIT_DB, TONE_LIMIT_DB, 0))
	};
}

export function loadSettings(storage: StorageLike | null | undefined): Settings {
	try {
		const text = storage?.getItem(KEY);
		return parseSettings(text ? JSON.parse(text) : null);
	} catch {
		return parseSettings(null);
	}
}

export function saveSettings(storage: StorageLike | null | undefined, s: Settings): boolean {
	try {
		storage?.setItem(KEY, JSON.stringify(s));
		return !!storage;
	} catch {
		return false; // quota, blocked, private mode
	}
}

export function clearSettings(storage: StorageLike | null | undefined): void {
	try {
		storage?.removeItem(KEY);
	} catch {
		/* nothing to clear */
	}
}

/** `localStorage`, or null where touching it throws (some privacy modes). */
export function browserStorage(): StorageLike | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** Which voices the stage shows, as 0/1 per voice 1..5: the voice toggles, or only the soloed voice. */
export function voiceMask(s: Pick<Settings, 'voices' | 'solo'>): number[] {
	const out = [1, 1, 1, 1, 1];
	for (let i = 0; i < 4; i++) out[i] = s.solo ? (s.solo === i + 1 ? 1 : 0) : s.voices[i] ? 1 : 0;
	return out;
}
