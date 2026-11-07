import { describe, expect, it } from 'vitest';
import { AudioSignals, REFRACTORY_S } from './signals.js';

const SR = 48000;
const BINS = 1024;
const HZ = SR / 2 / BINS;

/** a spectrum with the given level (dB) in each of three bands and `rest` elsewhere */
function spectrum(low: number, mid: number, high: number, rest = -100): Float32Array {
	const s = new Float32Array(BINS).fill(rest);
	for (let i = 0; i < BINS; i++) {
		const f = i * HZ;
		if (f >= 40 && f < 250) s[i] = low;
		else if (f >= 250 && f < 2000) s[i] = mid;
		else if (f >= 2000 && f <= 8000) s[i] = high;
	}
	return s;
}

const DT = 1 / 60;

function run(sig: AudioSignals, s: Float32Array, seconds: number): void {
	for (let t = 0; t < seconds; t += DT) sig.update(s, SR, DT);
}

describe('AudioSignals', () => {
	it('starts at zero and ignores a call without time passing', () => {
		const s = new AudioSignals();
		s.update(spectrum(-40, -40, -40), SR, 0);
		expect([s.energy, s.low, s.mid, s.high, s.pulse]).toEqual([0, 0, 0, 0, 0]);
	});

	it('reads 1 at a band’s own recent peak, whatever the level of the recording', () => {
		for (const level of [-30, -55, -80]) {
			const s = new AudioSignals();
			run(s, spectrum(level, level, level), 2);
			expect(s.low).toBeGreaterThan(0.95);
			expect(s.energy).toBeGreaterThan(0.95);
		}
	});

	it('follows a band independently of the others, and falls back when it gets quieter', () => {
		const s = new AudioSignals();
		run(s, spectrum(-40, -40, -40), 2);
		run(s, spectrum(-40, -40, -85), 2); // the top goes quiet
		expect(s.low).toBeGreaterThan(0.9);
		expect(s.mid).toBeGreaterThan(0.9);
		expect(s.high).toBeLessThan(0.1);
	});

	it('smooths: a step is not followed in one frame, and the release is slower than the attack', () => {
		const s = new AudioSignals();
		run(s, spectrum(-40, -40, -40), 1);
		s.update(spectrum(-100, -100, -100), SR, DT);
		expect(s.energy).toBeGreaterThan(0.8); // one frame later it has hardly moved
		let frames = 0;
		while (s.energy > 0.5 && frames < 600) {
			s.update(spectrum(-100, -100, -100), SR, DT);
			frames++;
		}
		const fall = frames * DT;
		const s2 = new AudioSignals();
		run(s2, spectrum(-100, -100, -100), 1);
		run(s2, spectrum(-40, -40, -40), 0.01);
		frames = 0;
		const rise = (() => {
			while (s2.energy < 0.5 && frames < 600) {
				s2.update(spectrum(-40, -40, -40), SR, DT);
				frames++;
			}
			return frames * DT;
		})();
		expect(fall).toBeGreaterThan(rise);
	});

	it('stays inside 0 and 1 for any input, digital silence included', () => {
		const s = new AudioSignals();
		const inputs = [
			spectrum(-Infinity, -Infinity, -Infinity),
			spectrum(0, 0, 0),
			spectrum(-200, 20, -10)
		];
		for (let i = 0; i < 300; i++) {
			s.update(inputs[i % 3], SR, DT);
			for (const v of [s.energy, s.low, s.mid, s.high, s.flux, s.pulse]) {
				expect(Number.isFinite(v)).toBe(true);
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
	});

	it('pulses once on an onset over a steady sound, then falls away', () => {
		const s = new AudioSignals();
		run(s, spectrum(-50, -50, -60), 2);
		expect(s.onsets).toBe(0);
		expect(s.pulse).toBeLessThan(0.01);
		s.update(spectrum(-30, -30, -40), SR, DT); // a note begins: everything rises 20 dB
		expect(s.onsets).toBe(1);
		expect(s.pulse).toBe(1);
		run(s, spectrum(-30, -30, -40), 1);
		expect(s.onsets).toBe(1); // holding the level is not an onset
		expect(s.pulse).toBeLessThan(0.05);
	});

	it('never pulses twice within the refractory time, so a flickering input stays under 3 per second', () => {
		const s = new AudioSignals();
		run(s, spectrum(-60, -60, -60), 2);
		const loud = spectrum(-30, -30, -30);
		const quiet = spectrum(-60, -60, -60);
		for (let i = 0; i < 6 * 60; i++) s.update(i % 2 ? loud : quiet, SR, DT); // 30 Hz flicker for 6 s
		expect(s.onsets).toBeLessThanOrEqual(Math.ceil(6 / REFRACTORY_S));
		expect(s.onsets / 6).toBeLessThan(6); // at most one per refractory time; see the scenes' own flash limits
	});

	it('relaxes to zero when there is no sound to read', () => {
		const s = new AudioSignals();
		run(s, spectrum(-40, -40, -40), 1);
		for (let i = 0; i < 600; i++) s.idle(DT);
		expect(s.energy).toBeLessThan(0.01);
		expect(s.pulse).toBeLessThan(0.01);
	});

	it('reset forgets the peaks', () => {
		const s = new AudioSignals();
		run(s, spectrum(-20, -20, -20), 1);
		s.reset();
		run(s, spectrum(-70, -70, -70), 1);
		expect(s.energy).toBeGreaterThan(0.95); // measured against the new, quieter peak
	});
});
