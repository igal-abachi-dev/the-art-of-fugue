import { describe, expect, it } from 'vitest';
import { contrast, deltaE, hexToRgb, simulate, type Vision } from './colour.js';
import { applyTokens, BACKGROUND, TOKENS, VOICE_COLOURS, voiceColour } from './palette.js';

const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

function minDistance(colours: readonly string[], vision: Vision) {
	let worst = Infinity;
	for (let i = 0; i < colours.length; i++) {
		for (let j = i + 1; j < colours.length; j++) {
			worst = Math.min(
				worst,
				deltaE(simulate(hexToRgb(colours[i]), vision), simulate(hexToRgb(colours[j]), vision))
			);
		}
	}
	return worst;
}

describe('voice palette', () => {
	it('keeps the four voices at least 25 apart (CIE76) for normal vision and three kinds of colour blindness', () => {
		for (const v of VISIONS) {
			expect(minDistance(VOICE_COLOURS.slice(0, 4), v), v).toBeGreaterThanOrEqual(25);
		}
	});

	it('keeps the fifth colour at least 15 from the others in every vision', () => {
		for (const v of VISIONS) {
			expect(minDistance(VOICE_COLOURS, v), v).toBeGreaterThanOrEqual(15);
		}
	});

	it('is readable on the black background (contrast above 4.5)', () => {
		const bg = hexToRgb(BACKGROUND);
		for (const c of VOICE_COLOURS) expect(contrast(hexToRgb(c), bg), c).toBeGreaterThan(4.5);
	});

	it('is the one source of the interface tokens: applied as CSS custom properties', () => {
		const set = new Map<string, string>();
		applyTokens({ style: { setProperty: (k, v) => void set.set(k, v) } });
		VOICE_COLOURS.forEach((c, i) => expect(set.get(`--voice-${i + 1}`)).toBe(c));
		expect(set.get('--bg')).toBe(BACKGROUND);
		expect(set.size).toBe(Object.keys(TOKENS).length);
	});

	it('maps voice numbers to colours and clamps out-of-range numbers', () => {
		expect(voiceColour(1)).toBe(VOICE_COLOURS[0]);
		expect(voiceColour(4)).toBe(VOICE_COLOURS[3]);
		expect(voiceColour(9)).toBe(VOICE_COLOURS[4]);
		expect(voiceColour(0)).toBe(VOICE_COLOURS[0]);
	});
});

describe('colour helpers', () => {
	it('rejects a malformed colour', () => {
		expect(() => hexToRgb('red')).toThrow();
	});
	it('gives black and white the maximum contrast', () => {
		expect(contrast([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 3);
	});
	it('leaves a grey unchanged by colour-blindness simulation', () => {
		const g = simulate([0.5, 0.5, 0.5], 'deuteranopia');
		g.forEach((c) => expect(c).toBeCloseTo(0.5, 1));
	});
});
