import { describe, expect, it } from 'vitest';
import { MasterClock, SNAP_S } from './clock.js';
import { FakeMedia, VirtualTime } from './fakes.js';

const FRAME = 1 / 60;

function setup(quantum = 0.02, offset = 0) {
	const time = new VirtualTime();
	const media = new FakeMedia(time, quantum);
	const clock = new MasterClock(media, { perfNow: time.now, offset });
	return { time, media, clock };
}

describe('MasterClock', () => {
	it('returns the element time exactly while paused and follows a paused seek at once', () => {
		const { media, clock } = setup();
		media.currentTime = 100;
		media.finishSeek();
		expect(clock.now()).toBeCloseTo(100, 6);
		media.run(500);
		expect(clock.now()).toBeCloseTo(100, 6);
		media.currentTime = 250.5;
		// before the seeked event: the new time is already visible
		expect(Math.abs(clock.now() - 250.5)).toBeLessThan(0.02 + 1e-9);
	});

	it('interpolates between coarse updates: strictly increasing, within one quantum of the truth', () => {
		const { media, clock } = setup(0.03);
		media.currentTime = 10;
		media.finishSeek();
		media.play();
		let prev = clock.now();
		let worst = 0;
		let steps = 0;
		media.run(4000, 4, () => {
			const t = clock.now();
			expect(t).toBeGreaterThan(prev);
			prev = t;
			worst = Math.max(worst, Math.abs(t - media.truth));
			steps++;
		});
		expect(steps).toBe(1000);
		// the element itself is up to 30 ms stale; the clock must be at least as good, and smoother
		expect(worst).toBeLessThan(0.03);
	});

	it('is smoother than the raw element time', () => {
		const { media, clock } = setup(0.05);
		media.currentTime = 0;
		media.finishSeek();
		media.play();
		let rawSteps = 0;
		let smoothSteps = 0;
		let prevRaw = media.currentTime;
		let prev = clock.now();
		media.run(2000, 4, () => {
			const r = media.currentTime;
			const t = clock.now();
			if (r !== prevRaw) rawSteps++;
			if (t !== prev) smoothSteps++;
			prevRaw = r;
			prev = t;
		});
		expect(smoothSteps).toBe(500);
		expect(rawSteps).toBeLessThan(50);
	});

	it('jumps to the new position at once on a seek while playing (no glide from the old one)', () => {
		const { media, clock } = setup();
		media.currentTime = 30;
		media.finishSeek();
		media.play();
		media.run(1000, 4, () => clock.now());
		media.currentTime = 2000;
		expect(clock.now()).toBeGreaterThan(1999.9);
		expect(clock.now()).toBeLessThan(2000.1);
		media.finishSeek();
		const after = clock.now();
		expect(after).toBeGreaterThan(1999.9);
		expect(after).toBeLessThan(2000.1);
		media.run(100, 4, () => clock.now());
		expect(Math.abs(clock.now() - media.truth)).toBeLessThan(0.03);
	});

	it('flags a seek as a discontinuity in the very first read, before the element announces it', () => {
		const { media, clock } = setup();
		media.currentTime = 10;
		media.finishSeek();
		media.play();
		media.run(500, 4, () => clock.now());
		let epoch = clock.epoch;
		// playing: the assignment makes `seeking` true at once; the 'seeking' event comes a task later
		const listeners = new Map<string, () => void>();
		const quiet = media as unknown as { emit: (t: string) => void };
		const emit = quiet.emit.bind(media);
		quiet.emit = (t: string) => listeners.set(t, () => emit(t));
		media.currentTime = 2000;
		expect(clock.now()).toBeGreaterThan(1999.9);
		expect(clock.epoch).toBeGreaterThan(epoch);
		epoch = clock.epoch;
		expect(clock.now()).toBeGreaterThan(1999.9);
		expect(clock.epoch).toBe(epoch); // one seek, one discontinuity
		// a paused seek too
		quiet.emit = emit;
		media.finishSeek();
		media.pause();
		clock.now();
		epoch = clock.epoch;
		media.currentTime = 40;
		clock.now();
		expect(clock.epoch).toBeGreaterThan(epoch);
	});

	it('does not call an ordinary pause or small adjustment a discontinuity', () => {
		const { media, clock } = setup(0.04);
		media.currentTime = 10;
		media.finishSeek();
		media.play();
		media.run(2000, 4, () => clock.now());
		const epoch = clock.epoch;
		media.pause();
		media.run(100, 4, () => clock.now());
		expect(clock.epoch).toBe(epoch + 1); // only the 'pause' event itself
	});

	it('freezes during a stall and resumes without a jump', () => {
		const { media, clock } = setup(0.01);
		media.currentTime = 5;
		media.finishSeek();
		media.play();
		media.run(500, 4, () => clock.now());
		media.stall();
		media.run(10, 4);
		const frozen = clock.now();
		media.run(2000, 4, () => expect(Math.abs(clock.now() - frozen)).toBeLessThan(0.02));
		media.recover();
		const resumed = clock.now();
		expect(Math.abs(resumed - frozen)).toBeLessThan(0.02);
		media.run(500, 4, () => clock.now());
		expect(Math.abs(clock.now() - media.truth)).toBeLessThan(0.03);
	});

	it('pause then play re-anchors', () => {
		const { media, clock } = setup(0.01);
		media.currentTime = 1;
		media.finishSeek();
		media.play();
		media.run(300, 4, () => clock.now());
		media.pause();
		const at = clock.now();
		media.run(5000, 4, () => expect(clock.now()).toBe(at));
		media.play();
		media.run(300, 4, () => clock.now());
		expect(clock.now()).toBeGreaterThan(at + 0.25);
	});

	it('does not jump when the playback rate changes', () => {
		const { media, clock } = setup(0.01);
		media.currentTime = 0;
		media.finishSeek();
		media.play();
		media.run(1000, 4, () => clock.now());
		const before = clock.now();
		media.setRate(1.5);
		const right = clock.now();
		expect(Math.abs(right - before)).toBeLessThan(FRAME);
		const t0 = clock.now();
		media.run(2000, 4, () => clock.now());
		const t1 = clock.now();
		// 2 s of real time at 1.5x
		expect(t1 - t0).toBeGreaterThan(2.9);
		expect(t1 - t0).toBeLessThan(3.1);
		expect(Math.abs(t1 - media.truth)).toBeLessThan(0.03);
		media.setRate(0.5);
		const u0 = clock.now();
		media.run(2000, 4, () => clock.now());
		expect(clock.now() - u0).toBeGreaterThan(0.9);
		expect(clock.now() - u0).toBeLessThan(1.1);
	});

	it('corrects drift without any step larger than one frame', () => {
		// the audio hardware runs 0.5 % fast against the clock: 3 s of error in 10 minutes if uncorrected
		const { media, clock } = setup(0.02);
		media.speed = 1.005;
		media.currentTime = 0;
		media.finishSeek();
		media.play();
		let prev = clock.now();
		let maxStep = 0;
		let maxErr = 0;
		media.run(600_000, 8, () => {
			const t = clock.now();
			maxStep = Math.max(maxStep, t - prev - 0.008);
			maxErr = Math.max(maxErr, Math.abs(t - media.truth));
			prev = t;
		});
		expect(maxStep).toBeLessThan(FRAME);
		expect(maxErr).toBeLessThan(0.05);
		expect(clock.snaps).toBe(0);
	});

	it('snaps (and says so) when the element disagrees by more than the threshold', () => {
		const { media, clock } = setup(0.01);
		media.currentTime = 0;
		media.finishSeek();
		media.play();
		media.run(1000, 4, () => clock.now());
		const epoch = clock.epoch;
		// the element lost a second without any event (a buggy decoder, a background-tab throttle)
		media.run(0);
		media.currentTime = media.truth + 1;
		media.finishSeek();
		media.run(50, 4, () => clock.now());
		expect(SNAP_S).toBeLessThan(1);
		expect(clock.epoch).toBeGreaterThan(epoch);
		expect(Math.abs(clock.now() - media.truth)).toBeLessThan(0.03);
	});

	it('adds the source offset (AAC plays about 11 ms early)', () => {
		const { media, clock } = setup(0, 0.0107);
		media.currentTime = 50;
		media.finishSeek();
		expect(clock.now()).toBeCloseTo(50.0107, 6);
		expect(clock.rawNow()).toBeCloseTo(50.0107, 6);
		clock.setOffset(0);
		clock.setLatency(0.05);
		expect(clock.now()).toBeCloseTo(49.95, 6);
	});

	it('stops listening after dispose', () => {
		const { media, clock } = setup();
		const before = clock.epoch;
		clock.dispose();
		media.currentTime = 3;
		expect(clock.epoch).toBe(before);
	});
});
