import { describe, expect, it } from 'vitest';
import { MasterClock } from './clock.js';
import { FakeMedia, VirtualTime } from './fakes.js';

/** The edge cases of the master clock (T9.2.1): the ones a listener meets by seeking, stalling, switching tabs and changing speed. */

const Q = 0.02;

function setup(quantum = Q) {
	const time = new VirtualTime();
	const media = new FakeMedia(time, quantum);
	const clock = new MasterClock(media, { perfNow: time.now });
	return { time, media, clock };
}

function playFrom(t: number, quantum = Q) {
	const s = setup(quantum);
	s.media.currentTime = t;
	s.media.finishSeek();
	s.media.play();
	s.media.run(200, 4, () => s.clock.now());
	return s;
}

describe('MasterClock edge cases', () => {
	it('follows a seek made during a stall, and does not jump when the data arrives', () => {
		const { media, clock } = playFrom(100);
		media.stall();
		media.run(300, 4, () => clock.now());
		const epoch = clock.epoch;
		media.currentTime = 2000;
		media.finishSeek();
		expect(Math.abs(clock.now() - 2000)).toBeLessThan(Q + 1e-9);
		expect(clock.epoch).toBeGreaterThan(epoch);
		media.run(500, 4, () => expect(Math.abs(clock.now() - 2000)).toBeLessThan(Q + 1e-9));
		media.recover();
		const first = clock.now();
		expect(Math.abs(first - 2000)).toBeLessThan(Q + 1e-9);
		media.run(1000, 4, () => clock.now());
		expect(Math.abs(clock.now() - media.truth)).toBeLessThan(Q + 1e-9);
	});

	it('a change of speed during a stall changes nothing until the sound runs again', () => {
		const { media, clock } = playFrom(50);
		media.stall();
		media.run(20, 4, () => clock.now());
		const frozen = clock.now();
		media.setRate(0.5);
		media.run(1500, 4, () => expect(clock.now()).toBe(frozen));
		media.recover();
		media.run(2000, 4, () => clock.now());
		// two seconds of real time at half speed
		expect(clock.now() - frozen).toBeGreaterThan(0.9);
		expect(clock.now() - frozen).toBeLessThan(1.1);
	});

	it('a hidden tab that is not asked for the time for seconds is right at the first call after it', () => {
		const { media, clock } = playFrom(300);
		media.run(8000, 250); // no frames: the tab is hidden
		const t = clock.now();
		expect(Math.abs(t - media.truth)).toBeLessThan(Q + 1e-9);
		media.run(2000, 4, () => {
			expect(Math.abs(clock.now() - media.truth)).toBeLessThan(0.03);
		});
	});

	it('many changes of speed in a row neither jump nor lose time', () => {
		const { media, clock } = playFrom(10);
		let prev = clock.now();
		const rates = [1.5, 0.5, 1, 1.25, 0.75, 1.5, 1];
		for (const r of rates) {
			media.setRate(r);
			media.run(700, 4, () => {
				const t = clock.now();
				expect(t).toBeGreaterThanOrEqual(prev);
				expect(t - prev).toBeLessThan(0.03);
				prev = t;
			});
		}
		expect(Math.abs(clock.now() - media.truth)).toBeLessThan(0.03);
	});

	it('seeking again to the same place is a discontinuity every time and lands exactly', () => {
		const { media, clock } = playFrom(120);
		for (let i = 0; i < 3; i++) {
			const e = clock.epoch;
			media.currentTime = 500;
			media.finishSeek();
			expect(clock.epoch).toBeGreaterThan(e);
			expect(Math.abs(clock.now() - 500)).toBeLessThan(Q + 1e-9);
			media.run(100, 4, () => clock.now());
		}
	});

	it('goes back in time on a backward seek while playing and then runs forward again', () => {
		const { media, clock } = playFrom(900);
		const before = clock.now();
		media.currentTime = 40;
		media.finishSeek();
		const after = clock.now();
		expect(before - after).toBeGreaterThan(800);
		let prev = after;
		media.run(1000, 4, () => {
			const t = clock.now();
			expect(t).toBeGreaterThan(prev);
			prev = t;
		});
	});

	it('stops at the end and does not run past it', () => {
		const { media, clock } = playFrom(0);
		media.currentTime = media.duration - 0.5;
		media.finishSeek();
		media.run(400, 4, () => clock.now());
		media.ended = true;
		media.paused = true;
		media.emit('ended');
		const end = clock.now();
		media.run(3000, 4, () => expect(clock.now()).toBe(end));
		expect(end).toBeLessThanOrEqual(media.duration);
	});

	it('shifts everything by the output latency, paused and playing, without a jump of its own', () => {
		const { media, clock } = playFrom(30);
		const a = clock.now();
		clock.setLatency(0.05);
		const b = clock.now();
		expect(a - b).toBeGreaterThan(0.045); // the picture shows what is heard 50 ms from now, not what is leaving the buffer
		expect(a - b).toBeLessThan(0.06);
		media.pause();
		expect(clock.now()).toBeCloseTo(media.currentTime - 0.05, 6);
	});

	it('a source offset and the latency add', () => {
		const time = new VirtualTime();
		const media = new FakeMedia(time, 0);
		const clock = new MasterClock(media, { perfNow: time.now, offset: 0.011, latency: 0.03 });
		media.currentTime = 10;
		media.finishSeek();
		expect(clock.now()).toBeCloseTo(10 + 0.011 - 0.03, 9);
		expect(clock.rawNow()).toBeCloseTo(10 + 0.011 - 0.03, 9);
	});
});
