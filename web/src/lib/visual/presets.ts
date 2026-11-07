import { DEFAULT_SCENE, parseScene, type SceneConfig } from './scene.js';

/** Scenes used by the stage page and the browser check; E5 adds one per piece in `scenes.json`. */
export const SCENES: Record<string, SceneConfig> = {
	void: DEFAULT_SCENE,
	lanes: parseScene({
		id: 'lanes',
		layout: 'lanes',
		camera: { fov: 32, tilt: 0.05, targetY: 0 },
		ahead: 7.5,
		speed: 2.3,
		effects: { glow: 1, particles: 0.8, trails: 0.6 }
	}),
	/** no ambient effects: the bare piano roll, used to compare frames exactly */
	plain: parseScene({ id: 'plain', effects: { glow: 0, particles: 0, trails: 0 } }),
	ember: parseScene({
		id: 'ember',
		palette: {
			background: '#0b0504',
			voices: ['#ffd27a', '#ff8a3d', '#ff4d4d', '#c77dff', '#7ae7c7']
		},
		speed: 3.1,
		effects: { glow: 1, particles: 1, trails: 1 }
	})
};
