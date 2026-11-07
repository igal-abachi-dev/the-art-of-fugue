import { describe, expect, it } from 'vitest';
import { AudioGraph, needsCors, setMediaSource } from './graph.js';

class FakeNode {
	connected: unknown[] = [];
	disconnects = 0;
	disconnect() {
		this.disconnects++;
	}
	gain = { value: 1 };
	fftSize = 0;
	smoothingTimeConstant = 0;
	connect(n: unknown) {
		this.connected.push(n);
		return n;
	}
}

class FakeContext {
	state: 'suspended' | 'running' | 'interrupted' | 'closed' = 'suspended';
	destination = new FakeNode();
	resumes = 0;
	sources = 0;
	outputLatency = 0.02;
	baseLatency = 0.01;
	createMediaElementSource() {
		this.sources++;
		return new FakeNode();
	}
	createAnalyser() {
		return new FakeNode();
	}
	createGain() {
		return new FakeNode();
	}
	resume() {
		this.resumes++;
		this.state = 'running';
		return Promise.resolve();
	}
	closes = 0;
	close() {
		this.closes++;
		this.state = 'closed';
		return Promise.resolve();
	}
}

function el() {
	return {
		volume: 0.4,
		crossOrigin: null as string | null,
		src: '',
		removeAttribute() {}
	} as unknown as HTMLMediaElement;
}

describe('AudioGraph', () => {
	it('creates nothing until unlock() is called (no AudioContext at load)', () => {
		let made = 0;
		const g = new AudioGraph(el(), {
			createContext: () => {
				made++;
				return new FakeContext() as unknown as AudioContext;
			}
		});
		expect(made).toBe(0);
		expect(g.connected).toBe(false);
		expect(g.context).toBeNull();
		expect(g.analyser).toBeNull();
	});

	it('unlock() builds element -> analyser -> gain -> destination once and resumes the context', async () => {
		const ctx = new FakeContext();
		const g = new AudioGraph(el(), { createContext: () => ctx as unknown as AudioContext });
		await g.unlock();
		await g.unlock();
		expect(ctx.sources).toBe(1);
		expect(g.connected).toBe(true);
		expect(g.analyser).not.toBeNull();
		expect(ctx.state).toBe('running');
		expect(ctx.resumes).toBe(1);
		expect(g.outputLatency).toBeCloseTo(0.03, 6);
	});

	it('does the connection synchronously so audio.play() can follow in the same gesture', () => {
		const ctx = new FakeContext();
		const g = new AudioGraph(el(), { createContext: () => ctx as unknown as AudioContext });
		void g.unlock(); // not awaited
		expect(g.connected).toBe(true);
		expect(ctx.resumes).toBe(1);
	});

	it('survives a missing Web Audio API: the element still plays, analysis is just absent', async () => {
		const g = new AudioGraph(el(), {
			createContext: () => {
				throw new Error('no AudioContext');
			}
		});
		await g.unlock();
		await g.unlock();
		expect(g.connected).toBe(false);
		expect(g.failure).toBe('no AudioContext');
	});

	it('ensureRunning() resumes after an iOS-style interruption', async () => {
		const ctx = new FakeContext();
		const g = new AudioGraph(el(), { createContext: () => ctx as unknown as AudioContext });
		await g.unlock();
		ctx.state = 'interrupted';
		await g.ensureRunning();
		expect(ctx.state).toBe('running');
		expect(ctx.resumes).toBe(2);
	});

	it('volume goes to the gain node once connected and to the element before that', async () => {
		const element = el();
		const ctx = new FakeContext();
		const g = new AudioGraph(element, { createContext: () => ctx as unknown as AudioContext });
		g.setVolume(0.3);
		expect(element.volume).toBeCloseTo(0.09, 9); // square law
		await g.unlock();
		expect(element.volume).toBe(1);
		g.setVolume(0.5);
		expect(g.volume).toBe(0.5);
		expect(g.gain).toBeCloseTo(0.25, 9);
		g.setVolume(7);
		expect(g.volume).toBe(1);
	});

	it('mutes on the gain node and gives the slider position back on unmute', async () => {
		const element = el();
		const g = new AudioGraph(element, {
			createContext: () => new FakeContext() as unknown as AudioContext
		});
		g.setVolume(0.6);
		g.setMuted(true);
		expect(element.volume).toBe(0);
		await g.unlock();
		expect(g.gain).toBe(0);
		expect(g.volume).toBe(0.6);
		g.setMuted(false);
		expect(g.gain).toBeCloseTo(0.36, 9);
		expect(g.muted).toBe(false);
	});
});

describe('AudioGraph: the recording and another source', () => {
	it('turns the recording down and up on its own gain, and lets another source join at the analyser', async () => {
		const ctx = new FakeContext();
		const g = new AudioGraph(el(), { createContext: () => ctx as unknown as AudioContext });
		expect(g.setRecordingAudible(false)).toBe(false); // nothing to turn before unlock
		await g.unlock();
		expect(g.recordingAudible).toBe(true);
		expect(g.setRecordingAudible(false)).toBe(true);
		expect(g.recordingAudible).toBe(false);
		const other = new FakeNode();
		expect(g.connectInput(other as unknown as AudioNode)).toBe(true);
		expect(other.connected).toContain(g.analyser);
		expect(g.setRecordingAudible(true)).toBe(true);
		expect(g.recordingAudible).toBe(true);
	});
});

describe('AudioGraph.dispose', () => {
	it('disconnects the nodes and closes the context (no context left behind)', async () => {
		const ctx = new FakeContext();
		const g = new AudioGraph(el(), { createContext: () => ctx as unknown as AudioContext });
		await g.unlock();
		const analyser = g.analyser as unknown as FakeNode;
		g.dispose();
		expect(ctx.closes).toBe(1);
		expect(analyser.disconnects).toBe(1);
		expect(g.analyser).toBeNull();
		expect(g.context).toBeNull();
		expect(g.connected).toBe(false);
	});

	it('is harmless before unlock and when called twice, and unlock after it creates nothing', async () => {
		let made = 0;
		const g = new AudioGraph(el(), {
			createContext: () => {
				made++;
				return new FakeContext() as unknown as AudioContext;
			}
		});
		g.dispose();
		g.dispose();
		await g.unlock();
		expect(made).toBe(0);
	});
});

describe('same-origin / CORS guard', () => {
	it('needs CORS only for another origin', () => {
		expect(needsCors('/audio/fugue.webm', 'https://fugue.example')).toBe(false);
		expect(needsCors('https://fugue.example/audio/a.webm', 'https://fugue.example')).toBe(false);
		expect(needsCors('https://cdn.example/a.webm', 'https://fugue.example')).toBe(true);
	});

	it('sets crossOrigin before src for a remote file and clears it for a local one', () => {
		const order: string[] = [];
		const e = {
			set crossOrigin(v: string | null) {
				order.push(`crossOrigin=${v}`);
			},
			set src(v: string) {
				order.push(`src=${v}`);
			},
			removeAttribute(n: string) {
				order.push(`remove ${n}`);
			}
		} as unknown as HTMLMediaElement;
		setMediaSource(e, 'https://cdn.example/a.webm', 'https://fugue.example');
		setMediaSource(e, '/audio/a.webm', 'https://fugue.example');
		expect(order).toEqual([
			'crossOrigin=anonymous',
			'src=https://cdn.example/a.webm',
			'remove crossorigin',
			'src=/audio/a.webm'
		]);
	});
});
