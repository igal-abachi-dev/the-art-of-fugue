/**
 * One playback session for a page: manifest, audio graph, engine, transport state, Media Session and the
 * deep-link URL that follows the playhead. The bench and the stage page both open one; the real interface
 * (E7) will too.
 *
 * `?codec=opus|aac` forces one source (to test both files in one browser).
 */

import { browserCanPlay } from '../audio/source.js';
import { loadManifest, type Manifest } from '../data/manifest.js';
import { PlaybackEngine } from './engine.js';
import { AudioGraph } from './graph.js';
import { formatDeepLink, parseDeepLink, placeAt } from './links.js';
import { bindMediaSession } from './mediasession.js';
import { Transport } from './transport.svelte.js';

export interface Session {
	manifest: Manifest;
	engine: PlaybackEngine;
	transport: Transport;
	dispose(): void;
}

export async function openSession(audio: HTMLAudioElement): Promise<Session> {
	const manifest = await loadManifest();
	const graph = new AudioGraph(audio);
	const only = new URLSearchParams(location.search).get('codec');
	const real = browserCanPlay();
	const canPlay = (type: string) =>
		only === 'opus' && !type.includes('opus')
			? ''
			: only === 'aac' && !type.includes('mp4a')
				? ''
				: real(type);
	const engine = new PlaybackEngine(audio, manifest, { graph, canPlay });
	const transport = new Transport(engine);
	const unbind = bindMediaSession(engine);

	const link = parseDeepLink(location.search, manifest);
	if (link) engine.seekPlace(link);

	// keep the URL in step: on every pause/seek while paused, and on each piece change
	let lastPieceId = '';
	let lastUrl = '';
	const off = engine.subscribe((e) => {
		const place = placeAt(manifest, e.clock.now());
		const id = place?.piece.id ?? '';
		if (place && (e.status !== 'playing' || id !== lastPieceId)) {
			const search = formatDeepLink(place);
			// keep other query parameters (codec, hud, q) that the page was opened with
			const keep = new URLSearchParams(location.search);
			const next = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
			for (const [k, v] of keep)
				if (!next.has(k) && k !== 'p' && k !== 'bar' && k !== 'pass') next.set(k, v);
			const url = `?${next.toString()}`;
			// the engine emits on every media event; browsers limit history changes (Firefox: about 200 per 10 s)
			if (url !== lastUrl) {
				lastUrl = url;
				// keep the state object that is there: SvelteKit keeps its own history index in it, and without it Back stops working
				history.replaceState(history.state, '', url);
			}
		}
		lastPieceId = id;
	});

	return {
		manifest,
		engine,
		transport,
		dispose() {
			off();
			unbind();
			transport.dispose();
			engine.dispose();
		}
	};
}
