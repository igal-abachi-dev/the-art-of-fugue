import { describe, expect, it } from 'vitest';
import { SHORTCUTS, actionFor, isTyping } from './keys.js';

describe('actionFor', () => {
	it('maps the keys of the table', () => {
		expect(actionFor({ key: ' ' })).toBe('toggle');
		expect(actionFor({ key: 'k' })).toBe('toggle');
		expect(actionFor({ key: 'K', shiftKey: true })).toBe('toggle'); // caps lock or a stray shift
		expect(actionFor({ key: 'ArrowLeft' })).toBe('back5');
		expect(actionFor({ key: 'ArrowRight', shiftKey: true })).toBe('forward30');
		expect(actionFor({ key: '[' })).toBe('prevPiece');
		expect(actionFor({ key: ']' })).toBe('nextPiece');
		expect(actionFor({ key: ',' })).toBe('prevBar');
		expect(actionFor({ key: '.' })).toBe('nextBar');
		expect(actionFor({ key: '<', shiftKey: true })).toBe('slower');
		expect(actionFor({ key: '>', shiftKey: true })).toBe('faster');
		expect(actionFor({ key: '3' })).toBe('voice3');
		expect(actionFor({ key: '#', shiftKey: true })).toBe('solo3');
		expect(actionFor({ key: '?', shiftKey: true })).toBe('help');
		// a driver that reports the key and the Shift apart
		expect(actionFor({ key: '.', shiftKey: true })).toBe('faster');
		expect(actionFor({ key: ',', shiftKey: true })).toBe('slower');
		expect(actionFor({ key: '2', shiftKey: true })).toBe('solo2');
		expect(actionFor({ key: 'F' })).toBe('fullscreen');
		expect(actionFor({ key: 'x' })).toBeNull();
	});

	it('leaves the browser its shortcuts, and text fields their keys', () => {
		expect(actionFor({ key: 'f', ctrlKey: true })).toBeNull();
		expect(actionFor({ key: 'r', metaKey: true })).toBeNull();
		expect(actionFor({ key: 'm', altKey: true })).toBeNull();
		expect(actionFor({ key: 'm', target: { tagName: 'INPUT' } })).toBeNull();
		expect(actionFor({ key: ' ', target: { tagName: 'textarea' } })).toBeNull();
		expect(actionFor({ key: 'm', target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
		expect(actionFor({ key: 'Escape', target: { tagName: 'INPUT' } })).toBe('escape');
		expect(actionFor({ key: 'm', target: { tagName: 'BUTTON' } })).toBe('mute');
		expect(isTyping(null)).toBe(false);
		// a button keeps Space and Enter, a range input keeps the arrows but not the letters
		expect(actionFor({ key: ' ', target: { tagName: 'BUTTON' } })).toBeNull();
		expect(actionFor({ key: 'ArrowUp', target: { tagName: 'INPUT', type: 'range' } })).toBeNull();
		expect(actionFor({ key: 'm', target: { tagName: 'INPUT', type: 'range' } })).toBe('mute');
		expect(actionFor({ key: 'm', target: { tagName: 'INPUT', type: 'text' } })).toBeNull();
	});

	it('has no key bound twice, and every action in the table can be reached', () => {
		const seen = new Map<string, string>();
		for (const s of SHORTCUTS)
			for (const k of s.keys) {
				expect(seen.has(k), `${k} is bound twice`).toBe(false);
				seen.set(k, s.action);
			}
		expect(new Set(SHORTCUTS.map((s) => s.action)).size).toBe(SHORTCUTS.length);
	});
});

describe('a scrolling region that has the focus', () => {
	it('keeps the keys that scroll, and gives the others to the player', () => {
		const region = { tagName: 'DIV', dataset: { ownKeys: '' } };
		expect(actionFor({ key: 'ArrowDown', target: region })).toBeNull();
		expect(actionFor({ key: 'PageDown', target: region })).toBeNull();
		expect(actionFor({ key: 'Home', target: region })).toBeNull();
		expect(actionFor({ key: ' ', target: region })).toBeNull();
		expect(actionFor({ key: 'p', target: region })).toBe('pieces');
		expect(actionFor({ key: 'ArrowDown', target: { tagName: 'DIV', dataset: {} } })).toBe(
			'volumeDown'
		);
		expect(actionFor({ key: 'ArrowRight', target: { tagName: 'DIV' } })).toBe('forward5');
	});
});
