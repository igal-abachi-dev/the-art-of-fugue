/**
 * Scene configuration (T4.1.2): everything that makes one scene look different from another, as plain data.
 *
 * A config names a palette, a layout mode, a camera and effect intensities. `parseScene` validates untrusted
 * data (the per-piece `scenes.json` of E5) against the default, reporting the path of every problem.
 * `SceneState` is the same information in the form the renderer wants (numbers in preallocated arrays).
 * `SceneManager` fades from one state to the next: a crossfade is one multiply per value per frame, and no
 * shader, buffer or object is created or rebuilt, so it cannot drop a frame by itself.
 */

import { hexToRgb } from './colour.js';
import { BACKGROUND, NO_THEME_COLOUR, THEME_COLOURS, VOICE_COLOURS } from './palette.js';

export type LayoutMode = 'keyboard' | 'lanes';

export interface SceneConfig {
	id: string;
	/** hex colours; `voices` has five entries (voice 1 to 4, then an extra part) */
	/** `themes`: six colours (themes S1 to S6) followed by the colour of notes that belong to no theme */
	palette: { background: string; voices: string[]; themes: string[] };
	layout: LayoutMode;
	camera: {
		/** vertical field of view in degrees */
		fov: number;
		/** radians the camera leans back from looking straight at the keyboard plane */
		tilt: number;
		/** world y the camera looks at */
		targetY: number;
	};
	/** world units per second the notes travel */
	speed: number;
	/** seconds of future shown and seconds of past kept */
	ahead: number;
	behind: number;
	/**
	 * effect intensities, 0 (off) to 1 (full); `true`/`false` are accepted when parsing. `bloom` scales the loudness-driven
	 * bloom (T6.2.1), `drift` the slow camera drift and `shake` the shake on loud passages (T6.2.2); `road` the lane lines, bar
	 * lines and lit lanes under the notes and `steer` how far the view follows the music sideways (T6.4.1, T6.4.2).
	 */
	effects: {
		glow: number;
		particles: number;
		trails: number;
		bloom: number;
		drift: number;
		shake: number;
		road: number;
		steer: number;
	};
	/**
	 * The MilkDrop layer behind the notes (E6): the id of a preset from `ambient.json` (null = none) and how strongly it
	 * shows, 0 to 1. A change of preset blends over the scene's own fade.
	 */
	ambient: { preset: string | null; opacity: number };
	/**
	 * What the scene reacts to in the annotations, 0 (off) to 1 (full): `highlight` subject entries (and mark inverted ones),
	 * `ribbons` instead of blocks (thick for augmentation, thin for diminution), `themeColour` (colour by theme, not by
	 * voice), `ghost` (the mirror counterpart), `shockwaves` at clashes and crossings, `bach` (the motif lights up white),
	 * `links` (canon leader to follower lines).
	 */
	features: {
		highlight: number;
		ribbons: number;
		themeColour: number;
		ghost: number;
		shockwaves: number;
		bach: number;
		links: number;
	};
	/** play the closing sequence (freeze, shatter, fade to black) after the piece's last note */
	ending: boolean;
}

export const DEFAULT_SCENE: SceneConfig = {
	id: 'default',
	palette: {
		background: BACKGROUND,
		voices: [...VOICE_COLOURS],
		themes: [...THEME_COLOURS, NO_THEME_COLOUR]
	},
	layout: 'keyboard',
	camera: { fov: 32, tilt: 0.32, targetY: 4.2 },
	speed: 2.6,
	ahead: 6.5,
	behind: 1.2,
	effects: {
		glow: 1,
		particles: 1,
		trails: 0.7,
		bloom: 0.5,
		drift: 1,
		shake: 0.6,
		road: 0.6,
		steer: 0.5
	},
	ambient: { preset: null, opacity: 0 },
	features: {
		highlight: 0,
		ribbons: 0,
		themeColour: 0,
		ghost: 0,
		shockwaves: 0,
		bach: 1,
		links: 0
	},
	ending: false
};

export class SceneError extends Error {
	readonly problems: string[];
	constructor(problems: string[]) {
		super(`invalid scene: ${problems.join('; ')}`);
		this.problems = problems;
	}
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate `raw` and fill what it leaves out from `base`. Throws `SceneError` listing every problem; unknown
 * keys are errors too, so a typo in a scene file does not silently do nothing.
 */
export function parseScene(raw: unknown, base: SceneConfig = DEFAULT_SCENE): SceneConfig {
	const problems: string[] = [];
	if (!isObj(raw)) throw new SceneError(['scene must be an object']);

	const known = new Set([
		'id',
		'palette',
		'layout',
		'camera',
		'speed',
		'ahead',
		'behind',
		'effects',
		'ambient',
		'features',
		'ending'
	]);
	for (const k of Object.keys(raw)) if (!known.has(k)) problems.push(`${k}: unknown key`);

	const num = (path: string, v: unknown, fallback: number, lo: number, hi: number): number => {
		if (v === undefined) return fallback;
		if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
			problems.push(`${path}: expected a number from ${lo} to ${hi}`);
			return fallback;
		}
		return v;
	};
	const colour = (path: string, v: unknown, fallback: string): string => {
		if (v === undefined) return fallback;
		if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) {
			problems.push(`${path}: expected #rrggbb`);
			return fallback;
		}
		return v;
	};
	const sub = (path: string, v: unknown, keys: string[]): Record<string, unknown> => {
		if (v === undefined) return {};
		if (!isObj(v)) {
			problems.push(`${path}: expected an object`);
			return {};
		}
		for (const k of Object.keys(v))
			if (!keys.includes(k)) problems.push(`${path}.${k}: unknown key`);
		return v;
	};

	let id = base.id;
	if (raw.id !== undefined) {
		if (typeof raw.id === 'string' && raw.id.length > 0) id = raw.id;
		else problems.push('id: expected a non-empty string');
	}

	let layout = base.layout;
	if (raw.layout !== undefined) {
		if (raw.layout === 'keyboard' || raw.layout === 'lanes') layout = raw.layout;
		else problems.push("layout: expected 'keyboard' or 'lanes'");
	}

	const pal = sub('palette', raw.palette, ['background', 'voices', 'themes']);
	const background = colour('palette.background', pal.background, base.palette.background);
	let voices = base.palette.voices;
	if (pal.voices !== undefined) {
		if (Array.isArray(pal.voices) && pal.voices.length === 5) {
			voices = pal.voices.map((c, i) => colour(`palette.voices[${i}]`, c, base.palette.voices[i]));
		} else problems.push('palette.voices: expected five #rrggbb colours');
	}

	let themes = base.palette.themes;
	if (pal.themes !== undefined) {
		if (Array.isArray(pal.themes) && pal.themes.length === 7) {
			themes = pal.themes.map((c, i) => colour(`palette.themes[${i}]`, c, base.palette.themes[i]));
		} else
			problems.push('palette.themes: expected seven #rrggbb colours (six themes and the neutral)');
	}

	const cam = sub('camera', raw.camera, ['fov', 'tilt', 'targetY']);
	const camera = {
		fov: num('camera.fov', cam.fov, base.camera.fov, 10, 90),
		tilt: num('camera.tilt', cam.tilt, base.camera.tilt, -0.2, 1.2),
		targetY: num('camera.targetY', cam.targetY, base.camera.targetY, -10, 40)
	};

	const fx = sub('effects', raw.effects, [
		'glow',
		'particles',
		'trails',
		'bloom',
		'drift',
		'shake',
		'road',
		'steer'
	]);
	const level = (path: string, v: unknown, fallback: number) =>
		v === true ? 1 : v === false ? 0 : num(path, v, fallback, 0, 1);
	const effects = {
		glow: level('effects.glow', fx.glow, base.effects.glow),
		particles: level('effects.particles', fx.particles, base.effects.particles),
		trails: level('effects.trails', fx.trails, base.effects.trails),
		bloom: level('effects.bloom', fx.bloom, base.effects.bloom),
		drift: level('effects.drift', fx.drift, base.effects.drift),
		shake: level('effects.shake', fx.shake, base.effects.shake),
		road: level('effects.road', fx.road, base.effects.road),
		steer: level('effects.steer', fx.steer, base.effects.steer)
	};

	const am = sub('ambient', raw.ambient, ['preset', 'opacity']);
	let preset = base.ambient.preset;
	if (am.preset !== undefined) {
		if (am.preset === null) preset = null;
		else if (typeof am.preset === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(am.preset))
			preset = am.preset;
		else
			problems.push(
				'ambient.preset: expected null or a preset id (lower case letters, digits, hyphens)'
			);
	}
	const ambient = {
		preset,
		opacity: num('ambient.opacity', am.opacity, base.ambient.opacity, 0, 1)
	};

	const ft = sub('features', raw.features, Object.keys(base.features));
	const features = { ...base.features };
	for (const k of Object.keys(base.features) as (keyof typeof features)[])
		features[k] = level(`features.${k}`, ft[k], base.features[k]);
	let ending = base.ending;
	if (raw.ending !== undefined) {
		if (typeof raw.ending === 'boolean') ending = raw.ending;
		else problems.push('ending: expected true or false');
	}

	const speed = num('speed', raw.speed, base.speed, 0.5, 12);
	const ahead = num('ahead', raw.ahead, base.ahead, 1, 20);
	const behind = num('behind', raw.behind, base.behind, 0, 10);

	if (problems.length) throw new SceneError(problems);
	return {
		id,
		palette: { background, voices, themes },
		layout,
		camera,
		speed,
		ahead,
		behind,
		effects,
		ambient,
		features,
		ending
	};
}

/** Renderer-side form of a scene: numbers only. */
export interface SceneState {
	background: [number, number, number];
	/** 5 × rgb, 0..1 */
	voices: Float32Array;
	/** 0 = keyboard layout, 1 = lanes layout, in between while morphing */
	layoutMix: number;
	fov: number;
	tilt: number;
	targetY: number;
	speed: number;
	ahead: number;
	behind: number;
	glow: number;
	particles: number;
	trails: number;
	bloom: number;
	drift: number;
	shake: number;
	road: number;
	steer: number;
	/** how strongly the ambient layer shows (its preset is `SceneManager.current.ambient.preset`) */
	ambient: number;
	/** 7 x rgb: themes S1 to S6, then the neutral colour of notes that belong to none */
	themes: Float32Array;
	highlight: number;
	ribbons: number;
	themeColour: number;
	ghost: number;
	shockwaves: number;
	bach: number;
	links: number;
}

export function createSceneState(): SceneState {
	return {
		background: [0, 0, 0],
		voices: new Float32Array(15),
		layoutMix: 0,
		fov: 32,
		tilt: 0.3,
		targetY: 4,
		speed: 2.6,
		ahead: 6.5,
		behind: 1.2,
		glow: 1,
		particles: 1,
		trails: 1,
		bloom: 0.5,
		drift: 1,
		shake: 0.6,
		road: 0.6,
		steer: 0.5,
		ambient: 0,
		themes: new Float32Array(21),
		highlight: 0,
		ribbons: 0,
		themeColour: 0,
		ghost: 0,
		shockwaves: 0,
		bach: 1,
		links: 0
	};
}

export function copySceneState(from: SceneState, to: SceneState): SceneState {
	to.background[0] = from.background[0];
	to.background[1] = from.background[1];
	to.background[2] = from.background[2];
	to.voices.set(from.voices);
	to.layoutMix = from.layoutMix;
	to.fov = from.fov;
	to.tilt = from.tilt;
	to.targetY = from.targetY;
	to.speed = from.speed;
	to.ahead = from.ahead;
	to.behind = from.behind;
	to.glow = from.glow;
	to.particles = from.particles;
	to.trails = from.trails;
	to.bloom = from.bloom;
	to.drift = from.drift;
	to.shake = from.shake;
	to.road = from.road;
	to.steer = from.steer;
	to.ambient = from.ambient;
	to.themes.set(from.themes);
	to.highlight = from.highlight;
	to.ribbons = from.ribbons;
	to.themeColour = from.themeColour;
	to.ghost = from.ghost;
	to.shockwaves = from.shockwaves;
	to.bach = from.bach;
	to.links = from.links;
	return to;
}

/** Parse a config's colours once and turn it into a state. */
export function compileScene(
	config: SceneConfig,
	out: SceneState = createSceneState()
): SceneState {
	const bg = hexToRgb(config.palette.background);
	out.background[0] = bg[0];
	out.background[1] = bg[1];
	out.background[2] = bg[2];
	config.palette.voices.forEach((c, i) => out.voices.set(hexToRgb(c), i * 3));
	out.layoutMix = config.layout === 'lanes' ? 1 : 0;
	out.fov = config.camera.fov;
	out.tilt = config.camera.tilt;
	out.targetY = config.camera.targetY;
	out.speed = config.speed;
	out.ahead = config.ahead;
	out.behind = config.behind;
	out.glow = config.effects.glow;
	out.particles = config.effects.particles;
	out.trails = config.effects.trails;
	out.bloom = config.effects.bloom;
	out.drift = config.effects.drift;
	out.shake = config.effects.shake;
	out.road = config.effects.road;
	out.steer = config.effects.steer;
	out.ambient = config.ambient.opacity;
	config.palette.themes.forEach((c, i) => out.themes.set(hexToRgb(c), i * 3));
	out.highlight = config.features.highlight;
	out.ribbons = config.features.ribbons;
	out.themeColour = config.features.themeColour;
	out.ghost = config.features.ghost;
	out.shockwaves = config.features.shockwaves;
	out.bach = config.features.bach;
	out.links = config.features.links;
	return out;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** ease in and out so a crossfade has no visible start or end */
export const smooth = (k: number) => {
	const c = Math.min(1, Math.max(0, k));
	return c * c * (3 - 2 * c);
};

/** Write the blend of `a` (k = 0) and `b` (k = 1) into `out`. No allocation. */
export function blendScenes(a: SceneState, b: SceneState, k: number, out: SceneState): SceneState {
	for (let i = 0; i < 3; i++) out.background[i] = lerp(a.background[i], b.background[i], k);
	for (let i = 0; i < 15; i++) out.voices[i] = lerp(a.voices[i], b.voices[i], k);
	out.layoutMix = lerp(a.layoutMix, b.layoutMix, k);
	out.fov = lerp(a.fov, b.fov, k);
	out.tilt = lerp(a.tilt, b.tilt, k);
	out.targetY = lerp(a.targetY, b.targetY, k);
	out.speed = lerp(a.speed, b.speed, k);
	out.ahead = lerp(a.ahead, b.ahead, k);
	out.behind = lerp(a.behind, b.behind, k);
	out.glow = lerp(a.glow, b.glow, k);
	out.particles = lerp(a.particles, b.particles, k);
	out.trails = lerp(a.trails, b.trails, k);
	out.bloom = lerp(a.bloom, b.bloom, k);
	out.drift = lerp(a.drift, b.drift, k);
	out.shake = lerp(a.shake, b.shake, k);
	out.road = lerp(a.road, b.road, k);
	out.steer = lerp(a.steer, b.steer, k);
	out.ambient = lerp(a.ambient, b.ambient, k);
	for (let i = 0; i < 21; i++) out.themes[i] = lerp(a.themes[i], b.themes[i], k);
	out.highlight = lerp(a.highlight, b.highlight, k);
	out.ribbons = lerp(a.ribbons, b.ribbons, k);
	out.themeColour = lerp(a.themeColour, b.themeColour, k);
	out.ghost = lerp(a.ghost, b.ghost, k);
	out.shockwaves = lerp(a.shockwaves, b.shockwaves, k);
	out.bach = lerp(a.bach, b.bach, k);
	out.links = lerp(a.links, b.links, k);
	return out;
}

/**
 * Fades between scenes. `set(next, seconds)` starts a fade from whatever is on screen now (also if a fade is
 * already running, so interrupting one does not jump); `update(dt, out)` advances and writes the current state
 * and returns true while a fade is running. Everything is preallocated.
 */
export class SceneManager {
	#config: SceneConfig;
	readonly #from = createSceneState();
	readonly #to = createSceneState();
	readonly #now = createSceneState();
	#elapsed = 0;
	#duration = 0;

	constructor(initial: SceneConfig = DEFAULT_SCENE) {
		this.#config = initial;
		compileScene(initial, this.#to);
		copySceneState(this.#to, this.#from);
		copySceneState(this.#to, this.#now);
	}

	/** the scene being shown, or being faded to */
	get current(): SceneConfig {
		return this.#config;
	}

	get fading(): boolean {
		return this.#elapsed < this.#duration;
	}

	set(next: SceneConfig, seconds = 0): void {
		copySceneState(this.#now, this.#from); // what is on screen now
		compileScene(next, this.#to);
		this.#config = next;
		this.#elapsed = 0;
		this.#duration = Math.max(0, seconds);
		if (this.#duration === 0) copySceneState(this.#to, this.#now);
	}

	update(dt: number, out: SceneState): boolean {
		if (this.#elapsed < this.#duration) {
			this.#elapsed = Math.min(this.#duration, this.#elapsed + Math.max(0, dt));
			blendScenes(this.#from, this.#to, smooth(this.#elapsed / this.#duration), this.#now);
		}
		copySceneState(this.#now, out);
		return this.#elapsed < this.#duration;
	}
}
