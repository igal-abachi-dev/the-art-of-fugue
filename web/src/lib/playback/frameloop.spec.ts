import { describe, expect, it } from 'vitest';
import { MasterClock } from './clock.js';
import { FakeMedia, VirtualTime } from './fakes.js';
import { FrameLoop, type Frame, type Scheduler } from './frameloop.js';

function manualScheduler() {
	let next = 1;
	const queue = new Map<number, (ms: number) => void>();
	const sched: Scheduler = {
		request(cb) {
			const id = next++;
			queue.set(id, cb);
			return id;
		},
		cancel(id) {
			queue.delete(id);
		}
	};
	return {
		sched,
		pending: () => queue.size,
		step(ms: number) {
			const cbs = [...queue.values()];
			queue.clear();
			for (const cb of cbs) cb(ms);
		}
	};
}

function setup() {
	const time = new VirtualTime();
	const media = new FakeMedia(time, 0);
	const clock = new MasterClock(media, { perfNow: time.now });
	const m = manualScheduler();
	const loop = new FrameLoop(clock, m.sched);
	return { time, media, clock, loop, m };
}

describe('FrameLoop', () => {
	it('keeps ticking while paused and shows the new frame after a paused seek', () => {
		const { media, loop, m } = setup();
		const seen: Frame[] = [];
		loop.subscribe((f) => seen.push({ ...f }));
		loop.start();
		media.currentTime = 100;
		media.finishSeek();
		m.step(16);
		media.run(500);
		m.step(32);
		expect(seen.length).toBe(2);
		expect(seen[1].t).toBeCloseTo(100, 6);
		expect(seen[1].moved).toBe(false);
		// a paused seek: the very next frame carries the new time and a discontinuity
		media.currentTime = 2500;
		media.finishSeek();
		m.step(48);
		expect(seen[2].t).toBeCloseTo(2500, 6);
		expect(seen[2].moved).toBe(true);
		expect(seen[2].discontinuity).toBe(true);
		m.step(64);
		expect(seen[3].discontinuity).toBe(false);
		expect(seen[3].moved).toBe(false);
	});

	it('reports dt from the frame timestamps and advances while playing', () => {
		const { media, loop, m } = setup();
		const seen: Frame[] = [];
		loop.subscribe((f) => seen.push({ ...f }));
		loop.start();
		media.play();
		m.step(1000);
		media.run(16);
		m.step(1016);
		media.run(17);
		m.step(1033);
		expect(seen[0].dt).toBe(0);
		expect(seen[1].dt).toBeCloseTo(0.016, 6);
		expect(seen[2].dt).toBeCloseTo(0.017, 6);
		expect(seen[2].t).toBeGreaterThan(seen[1].t);
		expect(seen[2].moved).toBe(true);
	});

	it('stops cleanly: no pending frame, no more callbacks, and it can restart', () => {
		const { loop, m } = setup();
		let n = 0;
		const off = loop.subscribe(() => n++);
		loop.start();
		loop.start(); // second start is a no-op
		expect(m.pending()).toBe(1);
		m.step(1);
		loop.stop();
		expect(m.pending()).toBe(0);
		m.step(2);
		expect(n).toBe(1);
		loop.start();
		m.step(3);
		expect(n).toBe(2);
		off();
		m.step(4);
		expect(n).toBe(2);
	});
});
