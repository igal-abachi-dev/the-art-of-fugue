import { describe, expect, it } from 'vitest';
import type { AudioSource } from '../data/manifest.js';
import { pickAudioSource, rankAudioSources } from './source.js';

const opus = { type: 'audio/webm; codecs=opus', src: '/audio/fugue.webm' } as AudioSource;
const aac = { type: 'audio/mp4; codecs="mp4a.40.2"', src: '/audio/fugue.m4a' } as AudioSource;

describe('pickAudioSource', () => {
	it('takes Opus where it is playable (Chrome, Firefox)', () => {
		const can = (t: string) => (t.includes('opus') ? 'probably' : 'maybe');
		expect(pickAudioSource([opus, aac], can)?.src).toBe('/audio/fugue.webm');
	});

	it('falls back to AAC-LC where Opus is not supported (older Safari)', () => {
		const can = (t: string) => (t.includes('opus') ? '' : 'probably');
		expect(pickAudioSource([opus, aac], can)?.src).toBe('/audio/fugue.m4a');
	});

	it('prefers a "probably" over an earlier "maybe"', () => {
		const can = (t: string) => (t.includes('opus') ? 'maybe' : 'probably');
		expect(pickAudioSource([opus, aac], can)?.src).toBe('/audio/fugue.m4a');
	});

	it('returns null when nothing can be played', () => {
		expect(pickAudioSource([opus, aac], () => '')).toBeNull();
	});
});

describe('rankAudioSources', () => {
	it('lists every playable source, "probably" before "maybe", so a wrong claim can fall back', () => {
		const can = (t: string) => (t.includes('opus') ? 'maybe' : 'probably');
		expect(rankAudioSources([opus, aac], can).map((s) => s.src)).toEqual([
			'/audio/fugue.m4a',
			'/audio/fugue.webm'
		]);
		expect(rankAudioSources([opus, aac], () => '')).toEqual([]);
	});
});
