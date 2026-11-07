import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../data/manifest.js';
import { PlaybackEngine } from './engine.js';
import { FakeMedia, VirtualTime } from './fakes.js';
import { bindMediaSession, type SessionLike } from './mediasession.js';
import { POSITION_MS, SPINNER_DELAY_MS, Transport } from './transport.svelte.js';

const piece = (id: string, start: number, end: number) => ({
	id,
	title: `Piece ${id}`,
	audio_start: start,
	audio_end: end,
	bars: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, t: start + i * ((end - start) / 10) })),
	notes: `pieces/${id}.bin`,
	events: `pieces/${id}.events.json`
});
const manifest = {
	version: 1,
	duration: 4832.498,
	audio: [
		{ type: 'audio/webm; codecs=opus', src: '/a.webm', bytes: 1, duration: 4832.498, offset_s: 0 }
	],
	notes_format: [],
	flags: [],
	pieces: [piece('c01', 100, 200), piece('c02', 220, 400)]
} as unknown as Manifest;

function setup() {
	const time = new VirtualTime();
	const media = new FakeMedia(time, 0);
	const engine = new PlaybackEngine(media as unknown as HTMLMediaElement, manifest, {
		canPlay: () => 'probably',
		perfNow: time.now,
		pageOrigin: 'https://x.example',
		fetchFn: () => Promise.reject(new Error('no data in this test'))
	});
	return { time, media, engine };
}

describe('Transport', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('mirrors engine state: play/pause, piece, bar, duration', async () => {
		const { media, engine } = setup();
		const tr = new Transport(engine);
		expect(tr.duration).toBeCloseTo(4832.498, 3);
		media.readyState = 4;
		engine.seek(150);
		media.finishSeek();
		expect(tr.pieceId).toBe('c01');
		expect(tr.bar).toBe(6);
		await engine.start();
		expect(tr.status).toBe('playing');
		expect(tr.isPlaying).toBe(true);
		engine.pause();
		expect(tr.status).toBe('paused');
		expect(tr.isPlaying).toBe(false);
		tr.dispose();
	});

	it('updates the coarse position on a timer, not per call of the clock', () => {
		const { time, media, engine } = setup();
		const tr = new Transport(engine);
		media.currentTime = 10;
		media.finishSeek();
		media.play();
		const before = tr.position;
		// 5 reads of the clock between two timer ticks do not touch the reactive position
		for (let i = 0; i < 5; i++) {
			media.run(10);
			engine.clock.now();
		}
		expect(tr.position).toBe(before);
		media.run(POSITION_MS);
		vi.advanceTimersByTime(POSITION_MS);
		expect(tr.position).toBeGreaterThan(before);
		expect(time.ms).toBeGreaterThan(0);
		tr.dispose();
	});

	it('follows the bar and the piece through uninterrupted playback (no media events fire)', () => {
		const { media, engine } = setup();
		const tr = new Transport(engine);
		media.currentTime = 105;
		media.finishSeek();
		media.play();
		expect(tr.pieceId).toBe('c01');
		expect(tr.bar).toBe(1);
		// a buffered local file fires no events while it plays: only time passes
		media.run(25_000);
		vi.advanceTimersByTime(POSITION_MS);
		expect(engine.piece?.id).toBe('c01');
		expect(engine.bar?.n).toBeGreaterThan(1);
		expect(tr.bar).toBe(engine.bar?.n);
		media.run(120_000);
		vi.advanceTimersByTime(POSITION_MS);
		expect(engine.piece?.id).toBe('c02');
		expect(tr.pieceId).toBe('c02');
		tr.dispose();
	});

	it('shows the spinner only after buffering has lasted longer than the delay', () => {
		const { media, engine } = setup();
		const tr = new Transport(engine);
		media.play();
		media.stall();
		expect(tr.status).toBe('buffering');
		expect(tr.spinner).toBe(false);
		vi.advanceTimersByTime(SPINNER_DELAY_MS + 1);
		expect(tr.spinner).toBe(true);
		media.recover();
		expect(tr.spinner).toBe(false);
		// a stall that ends within the delay never shows it
		media.stall();
		vi.advanceTimersByTime(SPINNER_DELAY_MS / 2);
		media.recover();
		vi.advanceTimersByTime(SPINNER_DELAY_MS * 2);
		expect(tr.spinner).toBe(false);
		tr.dispose();
	});

	it('stops its timer on dispose', () => {
		const { engine } = setup();
		const tr = new Transport(engine);
		tr.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});

class FakeSession implements SessionLike {
	metadata: unknown = null;
	playbackState: 'none' | 'paused' | 'playing' = 'none';
	handlers = new Map<string, ((d: { seekTime?: number; seekOffset?: number }) => void) | null>();
	position: { duration: number; playbackRate: number; position: number } | null = null;
	setActionHandler(a: string, h: ((d: { seekTime?: number; seekOffset?: number }) => void) | null) {
		this.handlers.set(a, h);
	}
	setPositionState(s?: { duration: number; playbackRate: number; position: number }) {
		this.position = s ?? null;
	}
}

class FakeMetadata {
	constructor(public init: { title: string; artist: string; album: string }) {}
}

describe('Media Session (T3.2.4)', () => {
	it('publishes the piece title and answers play, pause, seek and track buttons', async () => {
		const { media, engine } = setup();
		const s = new FakeSession();
		const unbind = bindMediaSession(engine, s, FakeMetadata);
		engine.seek(120);
		expect((s.metadata as FakeMetadata).init.title).toBe('Piece c01');
		expect((s.metadata as FakeMetadata).init.album).toMatch(/Art of Fugue/);
		await engine.start();
		expect(s.playbackState).toBe('playing');
		s.handlers.get('pause')!({});
		expect(media.paused).toBe(true);
		expect(s.playbackState).toBe('paused');
		s.handlers.get('seekto')!({ seekTime: 300 });
		expect(engine.clock.now()).toBeCloseTo(300, 0);
		s.handlers.get('seekforward')!({});
		expect(engine.clock.now()).toBeCloseTo(310, 0);
		s.handlers.get('previoustrack')!({});
		expect(engine.clock.now()).toBeLessThan(221);
		expect(s.position?.duration).toBeCloseTo(4832.498, 3);
		unbind();
		expect(s.handlers.get('pause')).toBeNull();
	});

	it('does nothing where the API is missing', () => {
		const { engine } = setup();
		const unbind = bindMediaSession(engine, undefined, undefined);
		expect(unbind()).toBeUndefined();
	});
});
