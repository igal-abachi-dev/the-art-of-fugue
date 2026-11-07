/**
 * Design tokens for colour (T4.2.3). This is the one place the voice colours are defined: the stage reads
 * `VOICE_COLOURS`, and the interface gets the same values as CSS custom properties from `applyTokens()`
 * (`--voice-1` … `--voice-5`, `--bg`, …), called once from the root layout.
 *
 * The four voice colours come from the Okabe-Ito colour-blind-safe set plus a lavender, chosen by a search over
 * candidates: the smallest CIE76 difference between any two of them is 31 for normal vision and for simulated
 * protanopia, deuteranopia and tritanopia (palette.spec.ts repeats the check). Each also has a contrast ratio
 * above 4.5 against the background. Voice 1 is the highest part.
 */

export const BACKGROUND = '#05060a';

/** Voices 1 to 4 (upper to lower), then a fifth for a part beyond four (none of the shipped pieces has one). */
export const VOICE_COLOURS = ['#F0E442', '#009E73', '#D55E00', '#B79CFF', '#4FE3D1'] as const;

/**
 * Colours for the themes of the double and triple fugues (S1 to S6), used where colour follows the theme and not the
 * voice (T5.4.1). Okabe-Ito colours that are not the four voice colours, in the order the themes appear.
 */
export const THEME_COLOURS = [
	'#56B4E9',
	'#E69F00',
	'#CC79A7',
	'#009E73',
	'#D55E00',
	'#F0E442'
] as const;

/** Notes that belong to no theme, in a scene that colours by theme: a quiet neutral. */
export const NO_THEME_COLOUR = '#8d93a3';

export const VOICE_NAMES = ['yellow', 'green', 'vermillion', 'lavender', 'cyan'] as const;

export const KEY_WHITE = '#e9e6dc';
export const KEY_BLACK = '#101216';

export const TOKENS = {
	'--bg': BACKGROUND,
	'--fg': '#e8e8ee',
	'--fg-dim': '#9aa0ad',
	'--key-white': KEY_WHITE,
	'--key-black': KEY_BLACK,
	...Object.fromEntries(VOICE_COLOURS.map((c, i) => [`--voice-${i + 1}`, c]))
} as const;

/** Set every token as a CSS custom property on `el` (the root layout passes `document.documentElement`). */
export function applyTokens(el: {
	style: { setProperty(name: string, value: string): void };
}): void {
	for (const [name, value] of Object.entries(TOKENS)) el.style.setProperty(name, value);
}

/** Colour of a 1-based voice number; anything out of range gets the fifth. */
export function voiceColour(voice: number): string {
	return VOICE_COLOURS[Math.min(VOICE_COLOURS.length, Math.max(1, voice)) - 1];
}
