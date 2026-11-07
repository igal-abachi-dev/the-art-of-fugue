import { describe, expect, it } from 'vitest';
import type { NoteColumns } from '../data/notes.js';
import { NoteWindow } from '../playback/window.js';
import type { Bank } from './bank.js';
import {
	ATTACK_LEAD_S,
	DAMP_TAU,
	LOOKAHEAD_HIDDEN_S,
	LOOKAHEAD_S,
	MAX_VOICES,
	noteLevel,
	sustainGain,
	Sampler,
	type SamplerHost
} from './sampler.js';

class FakeParam {
	value = 0;
	calls: unknown[][] = [];
	setValueAtTime(v: number, t: number) {
		this.calls.push(['set', v, t]);
	}
	linearRampToValueAtTime(v: number, t: number) {
		this.calls.push(['ramp', v, t]);
	}
	setTargetAtTime(v: number, t: number, tau: number) {
		this.calls.push(['target', v, t, tau]);
	}
	cancelScheduledValues(t: number) {
		this.calls.push(['cancel', t]);
	}
}
class FakeNode {
	gain = new FakeParam();
	playbackRate = new FakeParam();
	buffer: unknown = null;
	started: { when: number; offset: number } | null = null;
	stopped: number | null = null;
	onended: (() => void) | null = null;
	connect() {}
	disconnect() {}
	start(when: number, offset: number) {
		this.started = { when, offset };
	}
	stop(t: number) {
		this.stopped = t;
	}
}
class FakeCtx {
	currentTime = 10;
	sources: FakeNode[] = [];
	gains: FakeNode[] = [];
	createGain() {
		const n = new FakeNode();
		this.gains.push(n);
		return n as unknown as GainNode;
	}
	createBufferSource() {
		const n = new FakeNode();
		this.sources.push(n);
		return n as unknown as AudioBufferSourceNode;
	}
}

type Row = [t_on: number, t_off: number, pitch: number, vel: number];

function window(rows: Row[]): NoteWindow {
	const n = rows.length;
	const cols = {
		n,
		t_on: Float32Array.from(rows.map((r) => r[0])),
		t_off: Float32Array.from(rows.map((r) => r[1])),
		pitch: Uint8Array.from(rows.map((r) => r[2])),
		vel: Uint8Array.from(rows.map((r) => r[3])),
		tick: new Uint32Array(n),
		voice: new Uint8Array(n),
		conf: new Uint8Array(n),
		bar: new Uint16Array(n),
		flags: new Uint16Array(n),
		pass: new Uint8Array(n)
	} as NoteColumns;
	return new NoteWindow(cols, 16);
}

const bank: Bank = {
	voice: (pitch) =>
		pitch === 0
			? null
			: ({
					sample: { buffer: { duration: 8 }, attack: 0.012, name: 'x', midi: 60 },
					rate: 2 ** ((pitch - 60) / 12)
				} as unknown as ReturnType<Bank['voice']>)
};

function setup(rows: Row[], useBank: Bank = bank, offset = 0) {
	const ctx = new FakeCtx();
	const state = { t: 100, epoch: 0, rate: 1, playing: true, hidden: false };
	const win = window(rows);
	const host: SamplerHost = {
		ctx: ctx as unknown as SamplerHost['ctx'],
		now: () => state.t,
		epoch: () => state.epoch,
		rate: () => state.rate,
		playing: () => state.playing,
		windows: () => [win],
		hidden: () => state.hidden,
		offset: () => offset
	};
	return { ctx, state, sampler: new Sampler(host, useBank) };
}

describe('noteLevel', () => {
	it('runs from a third to the full strike', () => {
		expect(noteLevel(0)).toBeCloseTo(0.3);
		expect(noteLevel(255)).toBeCloseTo(1);
		expect(noteLevel(999)).toBeCloseTo(1);
	});
});

describe('Sampler', () => {
	it('starts each note once, when the recording would play it, at its pitch and from its attack', () => {
		const { ctx, state, sampler } = setup([
			[100.1, 100.6, 60, 200],
			[100.2, 100.5, 64, 100]
		]);
		sampler.tick();
		expect(ctx.sources).toHaveLength(2);
		const [a, b] = ctx.sources;
		// 0.1 s ahead on the clock is 0.1 s ahead on the context, less the lead of the recording's strike over the aligned onset
		expect(a.started?.when).toBeCloseTo(10.1 - ATTACK_LEAD_S, 4);
		expect(a.started?.offset).toBe(0.012);
		expect(a.playbackRate.value).toBe(1);
		expect(b.started?.when).toBeCloseTo(10.2 - ATTACK_LEAD_S, 4);
		expect(b.playbackRate.value).toBeCloseTo(2 ** (4 / 12), 10);
		sampler.tick(); // the same instant: nothing is scheduled twice
		expect(ctx.sources).toHaveLength(2);
		state.t = 100.05;
		ctx.currentTime = 10.05;
		sampler.tick();
		expect(ctx.sources).toHaveLength(2);
		expect(sampler.stats.scheduled).toBe(2);
		expect(sampler.last?.pitch).toBe(64);
	});

	it('looks ahead only by its window, and takes the notes beyond it later', () => {
		const { ctx, state, sampler } = setup([
			[100.1, 100.4, 60, 150],
			[100.5, 100.9, 62, 150]
		]);
		sampler.tick();
		expect(ctx.sources).toHaveLength(1); // 100.5 is beyond t + 0.3
		expect(LOOKAHEAD_S).toBeCloseTo(0.3);
		state.t = 100.25;
		ctx.currentTime = 10.25;
		sampler.tick();
		expect(ctx.sources).toHaveLength(2);
		expect(ctx.sources[1].started?.when).toBeCloseTo(10.5 - ATTACK_LEAD_S, 4);
	});

	it('gives each note a damper that comes down when it ends, and stops the source after it', () => {
		const { ctx, sampler } = setup([[100.1, 100.6, 60, 255]]);
		sampler.tick();
		const gain = ctx.gains[1]; // the first gain is the output of the sampler
		const kinds = gain.gain.calls.map((c) => c[0]);
		expect(kinds).toEqual(['set', 'set', 'target']);
		expect(gain.gain.calls[2][2]).toBeCloseTo(10.6 - ATTACK_LEAD_S, 4); // at the end of the note, moved as the start is
		expect(ctx.sources[0].stopped).toBeGreaterThan(10.6 - ATTACK_LEAD_S);
	});

	it('moves notes in time with the speed but not their pitch', () => {
		const { ctx, state, sampler } = setup([[100.4, 100.8, 60, 150]]);
		state.rate = 0.5;
		sampler.tick(); // the horizon is 100 + 0.3 * 0.5 = 100.15: not yet
		expect(ctx.sources).toHaveLength(0);
		state.t = 100.3;
		ctx.currentTime = 10.6;
		sampler.tick();
		expect(ctx.sources).toHaveLength(1);
		// 0.1 s of the piece takes 0.2 s, and the lead of the strike is in the recording's time: twice as long at half speed
		expect(ctx.sources[0].started?.when).toBeCloseTo(10.6 + 0.1 / 0.5 - ATTACK_LEAD_S / 0.5, 4);
		expect(ctx.sources[0].playbackRate.value).toBe(1);
	});

	it('throws away what was scheduled at a seek, damps the voices, and starts again from the playhead', () => {
		const { ctx, state, sampler } = setup([
			[100.1, 100.6, 60, 150],
			[200.05, 200.3, 62, 150]
		]);
		sampler.tick();
		expect(ctx.sources).toHaveLength(1);
		state.t = 200;
		state.epoch++;
		ctx.currentTime = 11;
		sampler.tick();
		expect(sampler.stats.resets).toBe(1);
		expect(ctx.sources).toHaveLength(2);
		expect(ctx.sources[0].stopped).toBeCloseTo(11 + DAMP_TAU * 8, 6);
		expect(ctx.sources[1].started?.when).toBeCloseTo(11.05 - ATTACK_LEAD_S, 4);
	});

	it('is silent and forgets everything while paused, and goes on from where the clock is', () => {
		const { ctx, state, sampler } = setup([
			[100.1, 100.6, 60, 150],
			[100.4, 100.7, 62, 150]
		]);
		sampler.tick(); // the first note only (the second is beyond the window)
		expect(ctx.sources).toHaveLength(1);
		state.playing = false;
		sampler.tick();
		expect(ctx.sources[0].stopped).toBeCloseTo(10 + DAMP_TAU * 8, 6);
		state.playing = true;
		state.t = 100.2; // resumed later: the first note began before and is not struck again
		ctx.currentTime = 10.2;
		sampler.tick();
		expect(ctx.sources).toHaveLength(2); // the second, 0.2 s ahead, is in the window now
		expect(ctx.sources[1].started?.when).toBeCloseTo(10.4 - ATTACK_LEAD_S, 4);
	});

	it('does not strike the same note twice when the speed changes', () => {
		const { ctx, state, sampler } = setup([[100.5, 101, 60, 150]]);
		sampler.tick();
		state.rate = 1.5;
		state.t = 100.4;
		ctx.currentTime = 10.4;
		sampler.tick();
		expect(ctx.sources).toHaveLength(1);
	});

	it('looks further ahead in a hidden tab', () => {
		const { ctx, state, sampler } = setup([[101, 101.5, 60, 150]]);
		sampler.tick();
		expect(ctx.sources).toHaveLength(0);
		state.hidden = true;
		sampler.tick();
		expect(LOOKAHEAD_HIDDEN_S).toBeGreaterThan(1);
		expect(ctx.sources).toHaveLength(1);
	});

	it('skips a pitch that has no sample and counts it', () => {
		const { ctx, sampler } = setup([[100.1, 100.4, 0, 150]]);
		sampler.tick();
		expect(ctx.sources).toHaveLength(0);
		expect(sampler.stats.missing).toBe(1);
	});

	it('damps the oldest voice when too many sound at once', () => {
		const rows: Row[] = [];
		for (let i = 0; i < MAX_VOICES + 5; i++) rows.push([100.1 + i * 0.001, 108, 60, 150]);
		const { ctx, state, sampler } = setup(rows);
		state.hidden = true;
		sampler.tick();
		expect(ctx.sources).toHaveLength(MAX_VOICES + 5);
		expect(ctx.sources[0].stopped).toBeLessThan(11); // damped at once
		expect(ctx.sources.at(-1)?.stopped).toBeGreaterThan(18); // the notes last 8 s
	});

	it('stop() damps everything and the timer can be started again', () => {
		const { ctx, sampler } = setup([[100.1, 100.6, 60, 150]]);
		sampler.start();
		sampler.start(); // twice is harmless
		sampler.tick();
		sampler.stop();
		expect(ctx.sources[0].stopped).toBeLessThan(11);
		sampler.dispose();
	});
	it('lines the strike of the sample up, not its first sound: a slower sample starts earlier by its rise', () => {
		const slow: Bank = {
			voice: () =>
				({
					sample: {
						buffer: { duration: 3 },
						attack: 0.01,
						rise: 0.05,
						name: 'x',
						midi: 60,
						cents: 0
					},
					rate: 1
				}) as unknown as ReturnType<Bank['voice']>
		};
		const { ctx, sampler } = setup([[100.1, 100.6, 60, 200]], slow);
		sampler.tick();
		// the strike is 0.04 s into the sample from its first sound: the sample must begin 0.04 s ahead of the strike
		expect(ctx.sources[0].started?.when).toBeCloseTo(10.1 - ATTACK_LEAD_S - 0.04, 4);
	});

	it('starts a sample at its strike, not its first sound, when the strike is read earlier, and later when it is before the buffer', () => {
		const early: Bank = {
			voice: () =>
				({
					sample: {
						buffer: { duration: 3 },
						attack: 0.03,
						rise: 0.01,
						name: 'x',
						midi: 60,
						cents: 0
					},
					rate: 1
				}) as unknown as ReturnType<Bank['voice']>
		};
		const a = setup([[100.1, 100.6, 60, 200]], early);
		a.sampler.tick();
		expect(a.ctx.sources[0].started?.offset).toBeCloseTo(0.01, 6); // from the strike, which is before the first sound
		expect(a.ctx.sources[0].started?.when).toBeCloseTo(10.1 - ATTACK_LEAD_S, 4);
		const before: Bank = {
			voice: () =>
				({
					sample: {
						buffer: { duration: 3 },
						attack: 0.03,
						rise: -0.02,
						name: 'x',
						midi: 60,
						cents: 0
					},
					rate: 1
				}) as unknown as ReturnType<Bank['voice']>
		};
		const b = setup([[100.1, 100.6, 60, 200]], before);
		b.sampler.tick();
		expect(b.ctx.sources[0].started?.offset).toBe(0); // from the start of the buffer
		expect(b.ctx.sources[0].started?.when).toBeCloseTo(10.1 - ATTACK_LEAD_S + 0.02, 4); // the strike is 20 ms before it: begin 20 ms late
	});

	it('shifts the strike by the rise at the speed the sample is re-pitched to', () => {
		const high: Bank = {
			voice: () =>
				({
					sample: { buffer: { duration: 3 }, attack: 0, rise: 0.04, name: 'x', midi: 60, cents: 0 },
					rate: 2
				}) as unknown as ReturnType<Bank['voice']>
		};
		const { ctx, sampler } = setup([[100.1, 100.6, 72, 200]], high);
		sampler.tick();
		expect(ctx.sources[0].started?.when).toBeCloseTo(10.1 - ATTACK_LEAD_S - 0.02, 4);
	});

	it("moves every note by the listener's own timing correction", () => {
		const base = setup([[100.1, 100.6, 60, 200]]);
		base.sampler.tick();
		const moved = setup([[100.1, 100.6, 60, 200]], bank, 0.03); // 30 ms earlier
		moved.sampler.tick();
		const later = setup([[100.1, 100.6, 60, 200]], bank, -0.02); // 20 ms later
		later.sampler.tick();
		const t = (x: { ctx: FakeCtx }) => x.ctx.sources[0].started!.when;
		expect(t(base) - t(moved)).toBeCloseTo(0.03, 6);
		expect(t(later) - t(base)).toBeCloseTo(0.02, 6);
	});

	it('does not let the steps of the context clock move groups of notes: it holds the relation between the clocks', () => {
		const rows: Row[] = [];
		for (let i = 0; i < 40; i++) rows.push([100.2 + i * 0.1, 100.25 + i * 0.1, 60, 200]);
		const { ctx, state, sampler } = setup(rows);
		// the context's clock moves in steps of 10 ms and is read up to 10 ms late: the readings jitter, the truth does not
		const whens: number[] = [];
		for (let k = 0; k < 40; k++) {
			state.t = 100 + k * 0.04;
			const truth = 10 + k * 0.04;
			ctx.currentTime = truth - ((k * 7) % 10) / 1000; // late by 0 to 9 ms
			sampler.tick();
		}
		for (const s of ctx.sources) whens.push(s.started!.when);
		// every note was scheduled by the held relation, so it sits on the true grid: its time less the lead is a multiple of 0.1
		const spread = Math.max(...whens.map((w, i) => Math.abs(w + ATTACK_LEAD_S - (10.2 + i * 0.1))));
		expect(whens.length).toBeGreaterThan(10);
		// a fresh reading each tick would be off by up to 9 ms; the held one by less than 4 ms
		expect(spread).toBeLessThan(0.004);
	});

	it("puts the instrument's measured delay in the strike, in real time, whatever the speed", () => {
		const late = { ...bank, delay: 0.02 } as Bank;
		const base = setup([[100.1, 100.6, 60, 200]]);
		base.sampler.tick();
		const delayed = setup([[100.1, 100.6, 60, 200]], late);
		delayed.sampler.tick();
		expect(delayed.ctx.sources[0].started!.when - base.ctx.sources[0].started!.when).toBeCloseTo(
			0.02,
			6
		);
		// at half speed the recording's lead is twice as long, the instrument's delay is the same
		const half = setup([[100.4, 100.8, 60, 150]], late);
		half.state.rate = 0.5;
		half.state.t = 100.3;
		half.ctx.currentTime = 10.6;
		half.sampler.tick();
		expect(half.ctx.sources[0].started?.when).toBeCloseTo(
			10.6 + 0.1 / 0.5 - ATTACK_LEAD_S / 0.5 + 0.02,
			4
		);
	});

	it('holds a note up with its swell, to the level it has when the damper comes down', () => {
		const swell: Bank = {
			...bank,
			sustain: [
				[0, 0],
				[0.5, 6],
				[1, 12]
			]
		} as Bank;
		const { ctx, sampler } = setup([[100.1, 100.9, 60, 255]], swell);
		sampler.tick();
		const calls = ctx.gains[1].gain.calls;
		expect(calls.map((c) => c[0])).toEqual(['set', 'ramp', 'set', 'target']);
		expect(calls[1][1]).toBeCloseTo(10 ** (6 / 20), 6); // +6 dB half a second in
		expect(calls[2][1]).toBeCloseTo(sustainGain(swell.sustain!, 0.8), 2); // where the swell is when the note ends
	});

	it('is a gain of 1 without a swell', () => {
		expect(sustainGain([], 3)).toBe(1);
		expect(
			sustainGain(
				[
					[0, 0],
					[1, 6]
				],
				0.5
			)
		).toBeCloseTo((1 + 10 ** (6 / 20)) / 2, 6);
		expect(
			sustainGain(
				[
					[0, 0],
					[1, 6]
				],
				5
			)
		).toBeCloseTo(10 ** (6 / 20), 6);
	});

	it('plays a pipe in a loop for as long as the key is held, all as loud, and releases at its own speed', () => {
		const pipe = {
			voice: () =>
				({
					sample: {
						buffer: { duration: 2 },
						attack: 0,
						rise: 0,
						name: 'x',
						midi: 60,
						cents: 0,
						loop: [1, 2]
					},
					rate: 1
				}) as unknown as ReturnType<Bank['voice']>,
			dynamics: false,
			releaseTau: 0.09,
			level: 0.4
		} as Bank;
		const { ctx, sampler } = setup([[100.1, 100.6, 60, 20]], pipe);
		sampler.tick();
		const src = ctx.sources[0] as unknown as { loop: boolean; loopStart: number; loopEnd: number };
		expect([src.loop, src.loopStart, src.loopEnd]).toEqual([true, 1, 2]);
		const g = ctx.gains[1].gain.calls;
		expect(g[0][1]).toBe(1); // the strike's strength does not change a pipe's loudness
		expect(g[2][3]).toBeCloseTo(0.09, 6);
		expect(sampler.output.gain.value).toBeCloseTo(0.4, 6);
	});
});
