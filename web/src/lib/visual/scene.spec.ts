import { describe, expect, it } from 'vitest';
import {
	blendScenes,
	compileScene,
	createSceneState,
	DEFAULT_SCENE,
	parseScene,
	SceneError,
	SceneManager,
	smooth,
	type SceneConfig
} from './scene.js';

const lanes: SceneConfig = {
	...DEFAULT_SCENE,
	id: 'lanes',
	layout: 'lanes',
	palette: {
		...DEFAULT_SCENE.palette,
		background: '#102030',
		voices: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff']
	},
	effects: { glow: 0, particles: 0, trails: 0, bloom: 0, drift: 0, shake: 0, road: 0, steer: 0 },
	features: {
		highlight: 1,
		ribbons: 1,
		themeColour: 1,
		ghost: 1,
		shockwaves: 1,
		bach: 0,
		links: 1
	}
};

describe('parseScene', () => {
	it('accepts a partial scene and fills the rest from the default', () => {
		const s = parseScene({ id: 'x', layout: 'lanes', effects: { particles: false, glow: 0.5 } });
		expect(s.layout).toBe('lanes');
		expect(s.effects).toEqual({
			...DEFAULT_SCENE.effects,
			glow: 0.5,
			particles: 0
		});
		expect(s.camera).toEqual(DEFAULT_SCENE.camera);
		expect(s.palette.voices).toHaveLength(5);
	});

	it('accepts true for an effect at full strength', () => {
		expect(parseScene({ effects: { trails: true } }).effects.trails).toBe(1);
	});

	it('reports every problem with its path, and rejects unknown keys', () => {
		let err: SceneError | null = null;
		try {
			parseScene({
				layout: 'circle',
				speed: -1,
				camera: { fov: 'wide', fogg: 1 },
				palette: { background: 'black', voices: ['#fff'] },
				bogus: true
			});
		} catch (e) {
			err = e as SceneError;
		}
		expect(err).toBeInstanceOf(SceneError);
		const text = err!.problems.join('\n');
		for (const p of [
			'layout',
			'speed',
			'camera.fov',
			'camera.fogg',
			'palette.background',
			'palette.voices',
			'bogus'
		]) {
			expect(text).toContain(p);
		}
	});

	it('rejects a non-object', () => {
		expect(() => parseScene(null)).toThrow(SceneError);
		expect(() => parseScene([])).toThrow(SceneError);
	});

	it('returns the default unchanged for an empty object', () => {
		expect(parseScene({})).toEqual(DEFAULT_SCENE);
	});
});

describe('E5 features', () => {
	it('parses feature strengths, accepts true and false, and rejects unknown ones', () => {
		const s = parseScene({
			features: { highlight: true, ribbons: 0.4, bach: false },
			ending: true
		});
		expect(s.features.highlight).toBe(1);
		expect(s.features.ribbons).toBe(0.4);
		expect(s.features.bach).toBe(0);
		expect(s.features.ghost).toBe(DEFAULT_SCENE.features.ghost);
		expect(s.ending).toBe(true);
		expect(() => parseScene({ features: { sparkle: 1 } })).toThrow(/features.sparkle: unknown key/);
		expect(() => parseScene({ features: { ghost: 3 } })).toThrow(/features.ghost/);
		expect(() => parseScene({ ending: 'yes' })).toThrow(/ending/);
	});

	it('takes seven theme colours', () => {
		const t = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];
		expect(parseScene({ palette: { themes: t } }).palette.themes).toEqual(t);
		expect(() => parseScene({ palette: { themes: ['#111111'] } })).toThrow(/palette.themes/);
	});

	it('compiles and blends the features and the theme colours', () => {
		const a = compileScene(DEFAULT_SCENE);
		const b = compileScene(lanes);
		const out = createSceneState();
		blendScenes(a, b, 0.5, out);
		expect(out.ribbons).toBeCloseTo(0.5, 6);
		expect(out.bach).toBeCloseTo(0.5, 6);
		expect(out.themes.length).toBe(21);
		blendScenes(a, b, 1, out);
		expect(out.links).toBe(1);
		expect(out.bach).toBe(0);
	});
});

describe('blending and crossfade', () => {
	it('blends colours, layout, camera and effects linearly', () => {
		const a = compileScene(DEFAULT_SCENE);
		const b = compileScene(lanes);
		const out = createSceneState();
		blendScenes(a, b, 0, out);
		expect(out.layoutMix).toBe(0);
		blendScenes(a, b, 1, out);
		expect(out.layoutMix).toBe(1);
		expect(out.glow).toBe(0);
		blendScenes(a, b, 0.5, out);
		expect(out.layoutMix).toBeCloseTo(0.5, 6);
		expect(out.glow).toBeCloseTo(0.5, 6);
		expect(out.voices[0]).toBeCloseTo((a.voices[0] + 1) / 2, 6);
	});

	it('smoothstep eases both ends', () => {
		expect(smooth(0)).toBe(0);
		expect(smooth(1)).toBe(1);
		expect(smooth(0.5)).toBe(0.5);
		expect(smooth(0.05)).toBeLessThan(0.05);
		expect(smooth(2)).toBe(1);
	});

	it('fades over the given time, monotonically, and ends exactly on the target', () => {
		const m = new SceneManager(DEFAULT_SCENE);
		const out = createSceneState();
		m.set(lanes, 1);
		expect(m.fading).toBe(true);
		let prev = -1;
		let steps = 0;
		while (m.update(1 / 60, out)) {
			expect(out.layoutMix).toBeGreaterThanOrEqual(prev);
			// no frame moves the layout by more than a small step: no pop
			if (prev >= 0) expect(out.layoutMix - prev).toBeLessThan(0.06);
			prev = out.layoutMix;
			steps++;
			expect(steps).toBeLessThan(200);
		}
		expect(steps).toBeGreaterThan(55);
		expect(out.layoutMix).toBe(1);
		expect(m.current.id).toBe('lanes');
		expect(m.fading).toBe(false);
	});

	it('changes at once with a zero duration', () => {
		const m = new SceneManager(DEFAULT_SCENE);
		const out = createSceneState();
		m.set(lanes, 0);
		m.update(0, out);
		expect(out.layoutMix).toBe(1);
	});

	it('starts an interrupting fade from the picture on screen, with no jump', () => {
		const m = new SceneManager(DEFAULT_SCENE);
		const out = createSceneState();
		m.set(lanes, 1);
		for (let i = 0; i < 30; i++) m.update(1 / 60, out);
		const mid = out.layoutMix;
		expect(mid).toBeGreaterThan(0.05);
		expect(mid).toBeLessThan(0.95);
		m.set(DEFAULT_SCENE, 1);
		m.update(0, out);
		expect(out.layoutMix).toBeCloseTo(mid, 6);
		m.update(1 / 60, out);
		expect(Math.abs(out.layoutMix - mid)).toBeLessThan(0.02);
	});

	it('allocates nothing per update (same arrays are reused)', () => {
		const m = new SceneManager(DEFAULT_SCENE);
		const out = createSceneState();
		const voices = out.voices;
		const bg = out.background;
		m.set(lanes, 0.5);
		for (let i = 0; i < 40; i++) m.update(1 / 60, out);
		expect(out.voices).toBe(voices);
		expect(out.background).toBe(bg);
	});
});

describe('E6 ambient layer and camera effects', () => {
	it('defaults to no ambient layer, a half-strength bloom and gentle camera motion', () => {
		expect(DEFAULT_SCENE.ambient).toEqual({ preset: null, opacity: 0 });
		const st = compileScene(DEFAULT_SCENE);
		expect(st.ambient).toBe(0);
		expect([st.bloom, st.drift, st.shake]).toEqual([0.5, 1, 0.6]);
	});

	it('parses a preset id and an opacity, and keeps the rest of the default', () => {
		const s = parseScene({ ambient: { preset: 'calm-1', opacity: 0.4 }, effects: { bloom: 0 } });
		expect(s.ambient).toEqual({ preset: 'calm-1', opacity: 0.4 });
		expect(s.effects.bloom).toBe(0);
		expect(s.effects.drift).toBe(DEFAULT_SCENE.effects.drift);
		expect(parseScene({ ambient: { preset: null } }, s).ambient.preset).toBeNull();
		expect(parseScene({ ambient: { opacity: 0.2 } }, s).ambient.preset).toBe('calm-1');
	});

	it('reports a bad preset id, opacity and unknown ambient key with their paths', () => {
		let err: SceneError | null = null;
		try {
			parseScene({
				ambient: { preset: 'Not An Id', opacity: 2, mood: 'sad' },
				effects: { shake: 3 }
			});
		} catch (e) {
			err = e as SceneError;
		}
		const text = err!.problems.join('; ');
		expect(text).toContain('ambient.preset');
		expect(text).toContain('ambient.opacity');
		expect(text).toContain('ambient.mood: unknown key');
		expect(text).toContain('effects.shake');
	});

	it('crossfades the opacity and the camera effects like every other strength', () => {
		const a = compileScene(
			parseScene({ ambient: { preset: 'x', opacity: 0 }, effects: { shake: 0 } })
		);
		const b = compileScene(
			parseScene({ ambient: { preset: 'y', opacity: 0.8 }, effects: { shake: 1 } })
		);
		const mid = blendScenes(a, b, 0.5, createSceneState());
		expect(mid.ambient).toBeCloseTo(0.4, 9);
		expect(mid.shake).toBeCloseTo(0.5, 9);
	});

	it('names the preset of the scene being shown, which the ambient layer follows', () => {
		const m = new SceneManager(parseScene({ ambient: { preset: 'x', opacity: 0.5 } }));
		expect(m.current.ambient.preset).toBe('x');
		m.set(parseScene({ ambient: { preset: 'y', opacity: 0.3 } }), 1);
		expect(m.current.ambient.preset).toBe('y');
	});
});
