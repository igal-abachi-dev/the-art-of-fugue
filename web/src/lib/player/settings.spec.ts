import { describe, expect, it } from 'vitest';
import {
	DEFAULTS,
	KEY,
	clearSettings,
	loadSettings,
	parseSettings,
	saveSettings,
	voiceMask,
	type StorageLike
} from './settings.js';

function memory(): StorageLike & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k)
	};
}

describe('settings', () => {
	it('starts from the defaults when nothing is stored, or the storage is missing or broken', () => {
		expect(loadSettings(memory())).toEqual(DEFAULTS);
		expect(loadSettings(null)).toEqual(DEFAULTS);
		const broken: StorageLike = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(loadSettings(broken)).toEqual(DEFAULTS);
		expect(saveSettings(broken, DEFAULTS)).toBe(false);
		expect(() => clearSettings(broken)).not.toThrow();
		const bad = memory();
		bad.setItem(KEY, '{not json');
		expect(loadSettings(bad)).toEqual(DEFAULTS);
	});

	it('round-trips what was saved', () => {
		const m = memory();
		const s = {
			...DEFAULTS,
			volume: 0.35,
			muted: true,
			rate: 0.75,
			repeat: 'piece' as const,
			scene: 'ember',
			ambient: false,
			voices: [true, false, true, true] as [boolean, boolean, boolean, boolean],
			solo: 3,
			score: true,
			notation: 'pdf' as const
		};
		expect(saveSettings(m, s)).toBe(true);
		expect(loadSettings(m)).toEqual(s);
		clearSettings(m);
		expect(loadSettings(m)).toEqual(DEFAULTS);
	});

	it('checks every field: out-of-range numbers are clamped, wrong types fall back', () => {
		const s = parseSettings({
			volume: 7,
			rate: 'fast',
			repeat: 'sometimes',
			scene: '../../etc',
			ambient: 'yes',
			voices: [false, 'x'],
			solo: 9,
			bloom: false
		});
		expect(s.volume).toBe(1);
		expect(s.rate).toBe(1);
		expect(s.repeat).toBe('off');
		expect(s.scene).toBe('auto');
		expect(s.ambient).toBe(true);
		expect(s.voices).toEqual([false, true, true, true]);
		expect(s.solo).toBe(0);
		expect(s.bloom).toBe(false);
		expect(parseSettings({ rate: 3 }).rate).toBe(1.5);
		expect(parseSettings({ rate: 0.1 }).rate).toBe(0.5);
		expect(parseSettings('nonsense')).toEqual(DEFAULTS);
	});
});

describe('voiceMask', () => {
	it('shows the voices that are on, or only the soloed one', () => {
		expect(voiceMask({ voices: [true, false, true, true], solo: 0 })).toEqual([1, 0, 1, 1, 1]);
		expect(voiceMask({ voices: [false, false, true, true], solo: 2 })).toEqual([0, 1, 0, 0, 1]);
	});
});
