import type { AudioSource } from '../data/manifest.js';

export type CanPlay = (type: string) => CanPlayTypeResult;

/**
 * Playable sources in order of preference: those the browser rates "probably" first, then "maybe", each
 * group in manifest order (Opus, then AAC-LC). `canPlayType` returns '', 'maybe' or 'probably'; '' means no.
 * More than one is returned because `canPlayType` can be wrong (an engine that claims WebM/Opus and then
 * never loads it), and the player falls back to the next one.
 */
export function rankAudioSources(sources: AudioSource[], canPlay: CanPlay): AudioSource[] {
	const probably: AudioSource[] = [];
	const maybe: AudioSource[] = [];
	for (const s of sources) {
		const r = canPlay(s.type);
		if (r === 'probably') probably.push(s);
		else if (r === 'maybe') maybe.push(s);
	}
	return [...probably, ...maybe];
}

/** The preferred playable source, or null if the browser can play none. */
export function pickAudioSource(sources: AudioSource[], canPlay: CanPlay): AudioSource | null {
	return rankAudioSources(sources, canPlay)[0] ?? null;
}

export function browserCanPlay(): CanPlay {
	const el = document.createElement('audio');
	return (t) => el.canPlayType(t);
}
