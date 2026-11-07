/**
 * Keyboard shortcuts (T7.2.3): one table that both binds the keys and builds the help overlay, so the two cannot drift
 * apart. Keys are ignored while a text field has focus and when Ctrl, Alt or Meta is held (the browser's own shortcuts
 * keep working).
 */

export type Action =
	| 'toggle'
	| 'back5'
	| 'forward5'
	| 'back30'
	| 'forward30'
	| 'prevPiece'
	| 'nextPiece'
	| 'prevBar'
	| 'nextBar'
	| 'restartPiece'
	| 'volumeUp'
	| 'volumeDown'
	| 'mute'
	| 'slower'
	| 'faster'
	| 'resetSpeed'
	| 'jump'
	| 'repeat'
	| 'loopMark'
	| 'voice1'
	| 'voice2'
	| 'voice3'
	| 'voice4'
	| 'solo1'
	| 'solo2'
	| 'solo3'
	| 'solo4'
	| 'pieces'
	| 'info'
	| 'effects'
	| 'score'
	| 'spectro'
	| 'instrument'
	| 'fullscreen'
	| 'help'
	| 'escape';

export interface Shortcut {
	/** `KeyboardEvent.key` values (lower case for letters) that trigger it, with Shift as written */
	keys: string[];
	action: Action;
	/** what the help overlay says */
	label: string;
	/** how the keys are written in the help overlay */
	show: string;
	group: 'Playback' | 'Navigate' | 'Sound' | 'View';
}

export const SHORTCUTS: readonly Shortcut[] = [
	{
		keys: [' ', 'k'],
		action: 'toggle',
		label: 'Play / pause',
		show: 'Space  K',
		group: 'Playback'
	},
	{ keys: ['ArrowLeft'], action: 'back5', label: 'Back 5 s', show: '←', group: 'Playback' },
	{ keys: ['ArrowRight'], action: 'forward5', label: 'Forward 5 s', show: '→', group: 'Playback' },
	{
		keys: ['ArrowLeft+Shift'],
		action: 'back30',
		label: 'Back 30 s',
		show: 'Shift ←',
		group: 'Playback'
	},
	{
		keys: ['ArrowRight+Shift'],
		action: 'forward30',
		label: 'Forward 30 s',
		show: 'Shift →',
		group: 'Playback'
	},
	{ keys: ['['], action: 'prevPiece', label: 'Previous piece', show: '[', group: 'Navigate' },
	{ keys: [']'], action: 'nextPiece', label: 'Next piece', show: ']', group: 'Navigate' },
	{ keys: [','], action: 'prevBar', label: 'Previous bar', show: ',', group: 'Navigate' },
	{ keys: ['.'], action: 'nextBar', label: 'Next bar', show: '.', group: 'Navigate' },
	{
		keys: ['Home'],
		action: 'restartPiece',
		label: 'Start of the piece',
		show: 'Home',
		group: 'Navigate'
	},
	{
		keys: ['j', 'g'],
		action: 'jump',
		label: 'Go to piece and bar',
		show: 'J  G',
		group: 'Navigate'
	},
	{ keys: ['r'], action: 'repeat', label: 'Repeat: off, piece, all', show: 'R', group: 'Playback' },
	{
		keys: ['a'],
		action: 'loopMark',
		label: 'Loop: set start, set end, clear',
		show: 'A',
		group: 'Playback'
	},
	{ keys: ['ArrowUp'], action: 'volumeUp', label: 'Volume up', show: '↑', group: 'Sound' },
	{ keys: ['ArrowDown'], action: 'volumeDown', label: 'Volume down', show: '↓', group: 'Sound' },
	{ keys: ['m'], action: 'mute', label: 'Mute', show: 'M', group: 'Sound' },
	{
		keys: ['s'],
		action: 'instrument',
		label: 'Next sound: recording, piano, harpsichord, organ',
		show: 'S',
		group: 'Sound'
	},
	{ keys: ['<'], action: 'slower', label: 'Slower', show: 'Shift ,', group: 'Sound' },
	{ keys: ['>'], action: 'faster', label: 'Faster', show: 'Shift .', group: 'Sound' },
	{
		keys: ['Backspace'],
		action: 'resetSpeed',
		label: 'Normal speed',
		show: 'Backspace',
		group: 'Sound'
	},
	{ keys: ['1'], action: 'voice1', label: 'Show / hide voice 1', show: '1 – 4', group: 'View' },
	{ keys: ['2'], action: 'voice2', label: 'Show / hide voice 2', show: '', group: 'View' },
	{ keys: ['3'], action: 'voice3', label: 'Show / hide voice 3', show: '', group: 'View' },
	{ keys: ['4'], action: 'voice4', label: 'Show / hide voice 4', show: '', group: 'View' },
	{ keys: ['!'], action: 'solo1', label: 'Solo voice 1', show: 'Shift 1 – 4', group: 'View' },
	{ keys: ['@'], action: 'solo2', label: 'Solo voice 2', show: '', group: 'View' },
	{ keys: ['#'], action: 'solo3', label: 'Solo voice 3', show: '', group: 'View' },
	{ keys: ['$'], action: 'solo4', label: 'Solo voice 4', show: '', group: 'View' },
	{ keys: ['p'], action: 'pieces', label: 'Pieces', show: 'P', group: 'View' },
	{ keys: ['i'], action: 'info', label: 'What am I hearing', show: 'I', group: 'View' },
	{ keys: ['e'], action: 'effects', label: 'Effects', show: 'E', group: 'View' },
	{ keys: ['n'], action: 'score', label: 'Score of the piece', show: 'N', group: 'View' },
	{ keys: ['v'], action: 'spectro', label: 'Spectrogram', show: 'V', group: 'View' },
	{ keys: ['f'], action: 'fullscreen', label: 'Fullscreen', show: 'F', group: 'View' },
	{ keys: ['?'], action: 'help', label: 'This help', show: '?', group: 'View' },
	{
		keys: ['Escape'],
		action: 'escape',
		label: 'Close a panel, leave fullscreen',
		show: 'Esc',
		group: 'View'
	}
];

/** the part of a `KeyboardEvent` that is read, so tests can pass plain objects */
export interface KeyLike {
	key: string;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	/** the tag name of the element that has focus, if any */
	target?: {
		tagName?: string;
		isContentEditable?: boolean;
		type?: string;
		/** `data-own-keys` marks a scrolling region that has the keys of scrolling (arrows, Page Up and Down, Home, End, Space) */
		dataset?: Record<string, string | undefined>;
	} | null;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether the focused element takes typed characters (a number box, a search field), so shortcuts must stay out. */
export function isTyping(target: KeyLike['target']): boolean {
	if (!target) return false;
	const tag = (target.tagName ?? '').toUpperCase();
	// a range, checkbox or button input takes no typed characters
	if (tag === 'INPUT' && ['range', 'checkbox', 'radio', 'button'].includes(target.type ?? ''))
		return false;
	return TYPING.has(tag) || target.isContentEditable === true;
}

/** what Shift makes of a key on a US keyboard, for the shortcuts that are bound to the symbol */
const SHIFTED: Record<string, string> = {
	',': '<',
	'.': '>',
	'/': '?',
	'1': '!',
	'2': '@',
	'3': '#',
	'4': '$'
};

const TABLE = (() => {
	const m = new Map<string, Action>();
	for (const s of SHORTCUTS) for (const k of s.keys) m.set(k, s.action);
	return m;
})();

/** The action for a key press, or null if it is not ours. */
export function actionFor(e: KeyLike): Action | null {
	if (e.ctrlKey || e.altKey || e.metaKey) return null;
	if (isTyping(e.target) && e.key !== 'Escape') return null;
	// arrows and Space on a slider or button belong to that control, which handles them itself
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	const tag = (e.target?.tagName ?? '').toUpperCase();
	// Space and Enter on a button press that button; the arrows on a slider move that slider
	if ((key === ' ' || key === 'Enter') && (tag === 'BUTTON' || tag === 'A')) return null;
	if (key.startsWith('Arrow') && tag === 'INPUT' && e.target?.type === 'range') return null;
	// a scrolling region that has the focus (so that a keyboard can scroll it) keeps the keys that scroll
	if (
		e.target?.dataset?.ownKeys !== undefined &&
		(key.startsWith('Arrow') || ['PageUp', 'PageDown', 'Home', 'End', ' '].includes(key))
	)
		return null;
	if (key.startsWith('Arrow') && e.shiftKey) return TABLE.get(`${key}+Shift`) ?? null;
	// a shifted symbol arrives as the symbol itself ('<', '?', '!'); some keyboards and test drivers report the key
	// and the Shift separately, so a shifted ',' '.' '1'-'4' '/' is read as the symbol it makes
	if (e.shiftKey && SHIFTED[e.key]) return TABLE.get(SHIFTED[e.key]) ?? null;
	return TABLE.get(e.key) ?? TABLE.get(key) ?? null;
}
