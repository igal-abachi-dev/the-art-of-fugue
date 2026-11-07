/**
 * Media Session API (T3.2.4): lock-screen / OS media controls with the piece title, play, pause, seek
 * and previous/next piece. Feature-detected: browsers without `navigator.mediaSession` do nothing.
 *
 * Position state is reported on the element's timeline of the whole recording (80 minutes), as the OS
 * shows one long track; the piece title changes as the recording moves through the pieces.
 */

import type { PlaybackEngine } from './engine.js';

export interface SessionLike {
	metadata: unknown;
	playbackState: 'none' | 'paused' | 'playing';
	setActionHandler(
		action: string,
		handler: ((d: { seekTime?: number; seekOffset?: number }) => void) | null
	): void;
	setPositionState?(state?: { duration: number; playbackRate: number; position: number }): void;
}

export interface MetadataCtor {
	new (init: { title: string; artist: string; album: string }): unknown;
}

export const ARTIST = 'J. S. Bach';
export const ALBUM = 'The Art of Fugue, BWV 1080';
const SKIP_S = 10;

/** Returns an unbind function. */
export function bindMediaSession(
	engine: PlaybackEngine,
	session: SessionLike | undefined = typeof navigator !== 'undefined'
		? (navigator as unknown as { mediaSession?: SessionLike }).mediaSession
		: undefined,
	Metadata: MetadataCtor | undefined = typeof MediaMetadata !== 'undefined'
		? MediaMetadata
		: undefined
): () => void {
	if (!session) return () => {};
	let lastTitle = '';
	let lastPosition = -Infinity;

	const handlers: Record<string, (d: { seekTime?: number; seekOffset?: number }) => void> = {
		play: () => void engine.play(),
		pause: () => engine.pause(),
		seekto: (d) => {
			if (d.seekTime !== undefined) engine.seek(d.seekTime);
		},
		seekbackward: (d) => engine.seekBy(-(d.seekOffset ?? SKIP_S)),
		seekforward: (d) => engine.seekBy(d.seekOffset ?? SKIP_S),
		previoustrack: () => void engine.step(-1),
		nexttrack: () => void engine.step(1)
	};
	const bound: string[] = [];
	for (const [action, fn] of Object.entries(handlers)) {
		try {
			session.setActionHandler(action, fn);
			bound.push(action);
		} catch {
			// an action this browser does not know
		}
	}

	const sync = () => {
		const title = engine.piece?.title ?? 'The Art of Fugue';
		if (Metadata && title !== lastTitle) {
			lastTitle = title;
			session.metadata = new Metadata({ title, artist: ARTIST, album: ALBUM });
		}
		session.playbackState =
			engine.status === 'playing' || engine.status === 'buffering' ? 'playing' : 'paused';
		const t = Math.max(0, Math.min(engine.duration, engine.clock.rawNow()));
		// the OS extrapolates from the last state, so one report every few seconds is enough
		if (session.setPositionState && Math.abs(t - lastPosition) > 0.5 && engine.duration > 0) {
			lastPosition = t;
			try {
				session.setPositionState({
					duration: engine.duration,
					playbackRate: engine.rate,
					position: t
				});
			} catch {
				// invalid state (e.g. position beyond duration while metadata loads): try again next time
			}
		}
	};
	const off = engine.subscribe(sync);
	sync();

	return () => {
		off();
		for (const a of bound) {
			try {
				session.setActionHandler(a, null);
			} catch {
				// ignore
			}
		}
	};
}
