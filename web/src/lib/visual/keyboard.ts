/**
 * Keyboard geometry (T4.2.1): an 88-key piano, A0 (MIDI 21) to C8 (MIDI 108), in world units where one white
 * key is 1 unit wide. The same table places the drawn keys and the falling notes, so a note always lands on
 * its key.
 *
 * x = 0 is the middle of the keyboard; the white keys run from -26 to +26.
 */

export const KEY_FIRST = 21;
export const KEY_LAST = 108;
export const KEY_COUNT = KEY_LAST - KEY_FIRST + 1; // 88
export const WHITE_COUNT = 52;
/** half the width of the keyboard in world units */
export const HALF_WIDTH = WHITE_COUNT / 2;

export const WHITE_WIDTH = 1;
export const BLACK_WIDTH = 0.62;

/** pitch classes of the black keys */
const BLACK_PC = new Set([1, 3, 6, 8, 10]);
/** Black keys sit slightly off the boundary between their two white neighbours, as on a real piano (in white-key widths). */
const BLACK_SHIFT: Record<number, number> = { 1: -0.12, 3: 0.12, 6: -0.14, 8: 0, 10: 0.14 };

export function isBlack(midi: number): boolean {
	return BLACK_PC.has(((midi % 12) + 12) % 12);
}

export interface KeyTable {
	/** centre x of each key, index = midi - KEY_FIRST */
	x: Float32Array;
	/** 1 for a black key */
	black: Uint8Array;
	/** drawn width of each key */
	width: Float32Array;
}

function build(): KeyTable {
	const x = new Float32Array(KEY_COUNT);
	const black = new Uint8Array(KEY_COUNT);
	const width = new Float32Array(KEY_COUNT);
	let whites = 0;
	for (let i = 0; i < KEY_COUNT; i++) {
		const midi = KEY_FIRST + i;
		if (isBlack(midi)) {
			black[i] = 1;
			width[i] = BLACK_WIDTH;
			// the boundary between the white key just played (index whites-1) and the next
			x[i] = whites - HALF_WIDTH + BLACK_SHIFT[midi % 12];
		} else {
			width[i] = WHITE_WIDTH;
			x[i] = whites + 0.5 - HALF_WIDTH;
			whites++;
		}
	}
	return { x, black, width };
}

export const KEYS: KeyTable = build();

/** Index into the key tables for a MIDI pitch, clamped to the keyboard. */
export function keyIndex(midi: number): number {
	return Math.min(KEY_COUNT - 1, Math.max(0, Math.round(midi) - KEY_FIRST));
}

/** x position (world units, centre of the key) of a MIDI pitch: the one mapping shared by keys and notes. */
export function pitchToX(midi: number): number {
	return KEYS.x[keyIndex(midi)];
}

/** Drawn width of the key of a MIDI pitch. */
export function pitchWidth(midi: number): number {
	return KEYS.width[keyIndex(midi)];
}
