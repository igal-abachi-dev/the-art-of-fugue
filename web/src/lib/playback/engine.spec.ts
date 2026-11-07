import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../data/manifest.js';
import { PlaybackEngine } from './engine.js';
import { FakeMedia, VirtualTime } from './fakes.js';
import { AudioGraph } from './graph.js';

const FIXTURES = resolve(import.meta.dirname, '../data/fixtures');
const format = [
	{ name: 't_on', type: 'f4' },
	{ name: 't_off', type: 'f4' },
	{ name: 'tick', type: 'u4' },
	{ name: 'pitch', type: 'u1' },
	{ name: 'voice', type: 'u1' },
	{ name: 'vel', type: 'u1' },
	{ name: 'conf', type: 'u1' },
	{ name: 'bar', type: 'u2' },
	{ name: 'flags', type: 'u2' },
	{ name: 'pass', type: 'u1' }
];

const piece = (id: string, start: number, end: number) => ({
	id,
	order: 0,
	title: `Piece ${id}`,
	short: id,
	kind: 'x',
	status: 'ok',
	audio_start: start,
	audio_end: end,
	repeats_taken: null,
	variant: 'written',
	voices: [],
	bars: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, t: start + i * ((end - start) / 10) })),
	n_notes: 40,
	notes: `pieces/${id}.bin`,
	events: `pieces/${id}.events.json`,
	pdf_pages: []
});

const manifest = {
	version: 1,
	ppq: 24,
	duration: 4832.498,
	audio: [
		{
			type: 'audio/webm; codecs=opus',
			src: '/audio/fugue.webm',
			bytes: 1,
			duration: 4832.498,
			offset_s: 0
		},
		{
			type: 'audio/mp4; codecs="mp4a.40.2"',
			src: '/audio/fugue.m4a',
			bytes: 1,
			duration: 4832.49,
			offset_s: 0.0107
		}
	],
	notes_format: format,
	flags: [],
	pieces: [piece('c01', 100, 200), piece('c02', 220, 400), piece('c03', 410, 500)]
} as unknown as Manifest;

function chunkFetch(log: string[] = []) {
	const bin = readFileSync(resolve(FIXTURES, 'c01-head.bin'));
	return (url: string) => {
		log.push(url);
		const body = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
		return Promise.resolve(new Response(body, { status: 200 }));
	};
}

function setup(canPlay: (t: string) => CanPlayTypeResult = () => 'probably', graph?: AudioGraph) {
	const time = new VirtualTime();
	const media = new FakeMedia(time, 0.01);
	const log: string[] = [];
	const engine = new PlaybackEngine(media as unknown as HTMLMediaElement, manifest, {
		canPlay,
		perfNow: time.now,
		pageOrigin: 'https://fugue.example',
		fetchFn: chunkFetch(log),
		dataBase: '/data/',
		graph
	});
	return { time, media, engine, log };
}

describe('PlaybackEngine', () => {
	it("picks Opus where it is playable and AAC otherwise, and applies that source's offset", () => {
		const a = setup();
		expect(a.engine.source?.src).toBe('/audio/fugue.webm');
		expect(a.media.src).toBe('/audio/fugue.webm');
		const b = setup((t) => (t.includes('opus') ? '' : 'maybe'));
		expect(b.engine.source?.src).toBe('/audio/fugue.m4a');
		b.media.currentTime = 150;
		b.media.finishSeek();
		expect(b.engine.clock.now()).toBeCloseTo(150.0107, 6);
	});

	it('does not fetch the audio until Start: preload is metadata, then auto', async () => {
		const { media, engine } = setup();
		expect(media.preload).toBe('metadata');
		await engine.start();
		expect(media.preload).toBe('auto');
	});

	it('prefetch() asks the browser to load the start of the audio, once it is known that the music will be asked for', () => {
		const { media, engine } = setup();
		expect(media.preload).toBe('metadata');
		engine.prefetch();
		expect(media.preload).toBe('auto');
	});

	it('reports an error when nothing is playable', () => {
		const { engine } = setup(() => '');
		expect(engine.status).toBe('error');
		expect(engine.error).toMatch(/cannot play/);
	});

	it('walks loading -> ready -> playing -> paused -> ended as the element does', async () => {
		const { media, engine } = setup();
		media.readyState = 0;
		media.emit('loadstart');
		expect(engine.status).toBe('loading');
		media.readyState = 4;
		media.emit('canplay');
		expect(engine.status).toBe('ready');
		await engine.start();
		expect(engine.status).toBe('playing');
		engine.pause();
		expect(engine.status).toBe('paused');
		await engine.play();
		expect(engine.status).toBe('playing');
		media.ended = true;
		media.emit('ended');
		expect(engine.status).toBe('ended');
	});

	it('shows buffering when a seek lands outside the buffered range, and recovers', async () => {
		const { media, engine } = setup();
		await engine.start();
		media.ranges = [[0, 300]];
		engine.seek(3000);
		media.readyState = 1; // nothing there yet
		media.emit('waiting');
		expect(engine.status).toBe('buffering');
		expect(engine.bufferedAhead).toBe(0);
		media.ranges = [
			[0, 300],
			[2990, 3040]
		];
		media.readyState = 4;
		media.finishSeek();
		media.emit('canplay');
		expect(engine.status).toBe('playing');
		expect(engine.bufferedAhead).toBeGreaterThan(30);
	});

	it('reports how much of the file is fetched', () => {
		const { media, engine } = setup();
		media.ranges = [[0, 1208.1245]];
		expect(engine.loadedFraction).toBeCloseTo(0.25, 3);
		media.ranges = [];
		expect(engine.loadedFraction).toBe(0);
	});

	it('a blocked play() is not fatal: it stays paused and says why', async () => {
		const { media, engine } = setup();
		media.playRejects = 'NotAllowedError';
		await engine.start();
		expect(engine.status).not.toBe('playing');
		expect(engine.error).toMatch(/blocked/);
	});

	it('an interrupted play() (AbortError) is not reported as an error', async () => {
		const { media, engine } = setup();
		media.playRejects = 'AbortError';
		await engine.start();
		expect(engine.error).toBeNull();
	});

	it('seeks to a piece and to a bar, on the WAV timeline, and updates piece and bar at once', () => {
		const { engine } = setup();
		let changes = 0;
		engine.subscribe(() => changes++);
		expect(engine.seekPlace({ piece: manifest.pieces[1], bar: 4 })).toBe(true);
		// bar 4 of c02 starts at 220 + 3 * 18 = 274 (a little before it, for the attack)
		expect(engine.clock.now()).toBeGreaterThan(273.8);
		expect(engine.clock.now()).toBeLessThan(274.1);
		expect(engine.piece?.id).toBe('c02');
		expect(engine.bar?.n).toBe(4); // the pre-roll counts as bar 4 (SEEK_SLACK): a seek to a bar reads as that bar
		expect(changes).toBeGreaterThan(0);
		expect(engine.seekPlace({ piece: manifest.pieces[1], bar: 99 })).toBe(false);
	});

	it('seek clamps to the recording and subtracts the codec offset when addressing the element', () => {
		const { media, engine } = setup((t) => (t.includes('opus') ? '' : 'probably'));
		engine.seek(-5);
		expect(media.currentTime).toBe(0);
		engine.seek(250);
		expect(media.truth).toBeCloseTo(250 - 0.0107, 6);
		engine.seek(99999);
		expect(media.truth).toBeLessThan(media.duration);
	});

	it('steps between pieces in recording order; "previous" first restarts the piece', () => {
		const { engine } = setup();
		engine.seek(150);
		expect(engine.step(1)).toBe(true);
		expect(engine.clock.now()).toBeGreaterThan(219.5);
		expect(engine.clock.now()).toBeLessThan(220.1);
		engine.seek(300);
		expect(engine.step(-1)).toBe(true);
		expect(engine.clock.now()).toBeLessThan(220.1); // restarted c02
		engine.seek(221);
		expect(engine.step(-1)).toBe(true);
		expect(engine.clock.now()).toBeLessThan(200); // went back to c01
		engine.seek(450);
		expect(engine.step(1)).toBe(false); // last piece
	});

	it('sets playback rate within 0.5-1.5 with pitch preserved', () => {
		const { media, engine } = setup();
		engine.setRate(3);
		expect(media.playbackRate).toBe(1.5);
		expect(media.preservesPitch).toBe(true);
		engine.setRate(0.1);
		expect(media.playbackRate).toBe(0.5);
		expect(engine.rate).toBe(0.5);
	});

	it('loads the data of the piece being played and prefetches the next one, once each', async () => {
		const { engine, log } = setup();
		engine.seek(120);
		await engine.notes('c01');
		expect(log).toEqual(['/data/pieces/c01.bin', '/data/pieces/c02.bin']);
		expect(engine.window('c01')).not.toBeNull();
		engine.seek(130);
		engine.seek(140);
		expect(log.length).toBe(2);
	});

	it('connects the audio graph only on start()', async () => {
		let made = 0;
		const graph = new AudioGraph({ volume: 1 } as unknown as HTMLMediaElement, {
			createContext: () => {
				made++;
				return {
					state: 'running',
					destination: {},
					createMediaElementSource: () => ({ connect() {} }),
					createAnalyser: () => ({ connect() {} }),
					createGain: () => ({ connect() {}, gain: { value: 1 } })
				} as unknown as AudioContext;
			}
		});
		const { engine } = setup(() => 'probably', graph);
		expect(made).toBe(0);
		await engine.start();
		expect(made).toBe(1);
		expect(graph.connected).toBe(true);
	});

	describe('autostart (the welcome plays by itself where the browser lets it)', () => {
		const graphWith = (state: 'running' | 'suspended') => {
			let resumes = 0;
			const graph = new AudioGraph({ volume: 1 } as unknown as HTMLMediaElement, {
				createContext: () =>
					({
						state,
						destination: {},
						// a suspended context never resumes until the page is touched: the promise stays pending
						resume: () => {
							resumes++;
							return new Promise<void>(() => {});
						},
						createMediaElementSource: () => ({ connect() {} }),
						createAnalyser: () => ({ connect() {} }),
						createGain: () => ({ connect() {}, gain: { value: 1 } })
					}) as unknown as AudioContext
			});
			return { graph, resumes: () => resumes };
		};

		it('plays when the context may run, and says so', async () => {
			const { graph } = graphWith('running');
			const { engine, media } = setup(() => 'probably', graph);
			await expect(engine.autostart(20)).resolves.toBe(true);
			expect(media.paused).toBe(false);
			expect(engine.status).toBe('playing');
		});

		it('does nothing, without an error, where the browser keeps the context suspended', async () => {
			const { graph } = graphWith('suspended');
			const { engine, media } = setup(() => 'probably', graph);
			await expect(engine.autostart(20)).resolves.toBe(false);
			expect(media.paused).toBe(true);
			expect(engine.error).toBeNull();
			expect(engine.status).not.toBe('error');
			expect(media.preload).toBe('metadata'); // the 90 MB are still not fetched
		});

		it('plays when the browser refuses the element (NotAllowedError), and a click can still start it', async () => {
			const { engine, media } = setup();
			const play = media.play.bind(media);
			let refuse = true;
			media.play = () =>
				refuse ? Promise.reject(new DOMException('no gesture', 'NotAllowedError')) : play();
			await expect(engine.autostart(20)).resolves.toBe(false);
			expect(engine.error).toBeNull();
			refuse = false;
			await engine.start(); // the click
			expect(engine.status).toBe('playing');
		});

		it('is a no-op once playing', async () => {
			const { engine } = setup();
			await engine.start();
			await expect(engine.autostart(20)).resolves.toBe(true);
		});
	});

	it('reload() restores the position after a network error', () => {
		const { media, engine } = setup();
		engine.seek(321);
		media.error = { code: 2 };
		media.emit('error');
		expect(engine.status).toBe('error');
		media.error = null;
		engine.reload();
		expect(media.loads).toBe(1);
		expect(media.truth).toBeCloseTo(321, 1);
	});

	describe('falling back to the next source', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('switches to AAC when the Opus file never produces data, and resumes from the same place', async () => {
			const { media, engine } = setup(); // both claim "probably"
			media.readyState = 0; // a WebM/Opus claim the engine cannot honour: no data, no error
			engine.seek(321);
			await engine.start();
			expect(engine.source?.src).toBe('/audio/fugue.webm');
			vi.advanceTimersByTime(9_999);
			expect(engine.source?.src).toBe('/audio/fugue.webm');
			vi.advanceTimersByTime(2);
			expect(engine.source?.src).toBe('/audio/fugue.m4a');
			expect(media.src).toBe('/audio/fugue.m4a');
			expect(engine.fallbacks).toHaveLength(1);
			expect(engine.fallbacks[0]).toMatch(/opus.*no data/);
			// the new file loads: position restored on the WAV timeline (AAC offset applied)
			media.readyState = 4;
			media.emit('loadedmetadata');
			expect(media.truth).toBeCloseTo(321 - 0.0107, 4);
			expect(engine.clock.now()).toBeCloseTo(321, 1);
		});

		it('switches at once on an undecodable-file error, and not on a network error', () => {
			const a = setup();
			a.media.error = { code: 4 };
			a.media.emit('error');
			expect(a.engine.source?.src).toBe('/audio/fugue.m4a');
			const b = setup();
			b.media.error = { code: 2 };
			b.media.emit('error');
			expect(b.engine.source?.src).toBe('/audio/fugue.webm');
			expect(b.engine.status).toBe('error');
		});

		it('does not switch while data flows, and reports an error when no source is left', async () => {
			const { engine } = setup();
			await engine.start(); // readyState 4: data is flowing
			vi.advanceTimersByTime(60_000);
			expect(engine.source?.src).toBe('/audio/fugue.webm');
			const only = setup((t) => (t.includes('opus') ? 'probably' : ''));
			only.media.error = { code: 4 };
			only.media.emit('error');
			expect(only.engine.source?.src).toBe('/audio/fugue.webm');
			expect(only.engine.status).toBe('error');
		});
	});

	it('stops the audio, drops the file and closes the audio context on dispose', async () => {
		const ctx = {
			state: 'running',
			destination: { connect() {} },
			closes: 0,
			createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
			createAnalyser: () => ({ connect() {}, disconnect() {} }),
			createGain: () => ({ connect() {}, disconnect() {}, gain: { value: 1 } }),
			resume: () => Promise.resolve(),
			close() {
				this.closes++;
				this.state = 'closed';
				return Promise.resolve();
			}
		};
		const graph = new AudioGraph(new FakeMedia(new VirtualTime()) as unknown as HTMLMediaElement, {
			createContext: () => ctx as unknown as AudioContext
		});
		const { media, engine } = setup(() => 'probably', graph);
		await engine.start();
		expect(media.paused).toBe(false);
		const loads = media.loads;
		engine.dispose();
		expect(media.paused).toBe(true);
		expect(media.src).toBe('');
		expect(media.loads).toBe(loads + 1); // load() with no source aborts any download in flight
		expect(ctx.closes).toBe(1);
		engine.dispose(); // twice is fine
	});
});
