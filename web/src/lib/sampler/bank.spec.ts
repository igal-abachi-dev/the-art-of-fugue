import { describe, expect, it } from 'vitest';
import {
	fetchSpec,
	findAttack,
	findRise,
	layerWeights,
	loadBank,
	LoadCancelled,
	nearestIndex
} from './bank.js';

describe('findAttack', () => {
	it('finds where the sound begins, a little before it', () => {
		const sr = 1000;
		const d = new Float32Array(1000);
		d[300] = 0.0004; // dither under the floor
		for (let i = 400; i < 1000; i++) d[i] = i === 400 ? 0.05 : 1 / (i - 399);
		expect(findAttack(d, sr)).toBeCloseTo(0.4 - 0.002, 3);
	});

	it('is zero for silence and when the sound starts at once', () => {
		expect(findAttack(new Float32Array(500), 1000)).toBe(0);
		expect(findAttack(new Float32Array(500).fill(0.5), 1000)).toBe(0);
	});
});

describe('findRise', () => {
	// a tone that swells: silence, then a ramp whose steepest part (in dB per ms) is early, then a long steady tone
	const sr = 44100;
	const make = (startS: number, rampS: number) => {
		const d = new Float32Array(sr);
		for (let i = Math.round(startS * sr); i < d.length; i++) {
			const t = i / sr - startS;
			d[i] = Math.min(1, t / rampS) * 0.5 * Math.sin(2 * Math.PI * 220 * (i / sr));
		}
		return d;
	};

	it('is the middle of the steepest rise of the level, not the first grain of sound', () => {
		const d = make(0.1, 0.03);
		d[Math.round(0.02 * sr)] = 1e-4; // dither long before the sound: -80 dB, under the 40 dB window
		const r = findRise(d, sr);
		expect(r).toBeGreaterThan(0.1);
		expect(r).toBeLessThan(0.1 + 0.012);
	});

	it('moves with the sound', () => {
		expect(findRise(make(0.2, 0.03), sr) - findRise(make(0.1, 0.03), sr)).toBeCloseTo(0.1, 2);
	});

	it('is zero for silence', () => {
		expect(findRise(new Float32Array(sr), sr)).toBe(0);
	});
});

describe('nearestIndex', () => {
	it('takes the nearest value, the lower of two that are equally near', () => {
		expect(nearestIndex([36, 38, 40], 39)).toBe(1);
		expect(nearestIndex([36, 38, 40], 100)).toBe(2);
		expect(nearestIndex([36, 38, 40], 0)).toBe(0);
	});
});

describe('layerWeights', () => {
	const vels = [85, 165, 235];

	it('plays the nearest layer alone outside the range of the layers', () => {
		expect(layerWeights(vels, 10)).toEqual([[0, 1]]);
		expect(layerWeights(vels, 255)).toEqual([[2, 1]]);
		expect(layerWeights([128], 3)).toEqual([[0, 1]]);
	});

	it('plays one layer alone when the note is exactly its own loudness, and two crossfaded between', () => {
		expect(layerWeights(vels, 165).map(([i]) => i)).toEqual([1]); // the neighbour's weight is nil
		const mid = layerWeights(vels, 125);
		expect(mid.map(([i]) => i)).toEqual([0, 1]);
		expect(mid[0][1]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(mid[1][1]).toBeCloseTo(Math.SQRT1_2, 6);
	});

	it('keeps the power constant through a crossfade', () => {
		for (let v = 86; v < 235; v += 7) {
			const w = layerWeights(vels, v);
			expect(w.reduce((a, [, g]) => a + g * g, 0)).toBeCloseTo(1, 1);
		}
	});
});

describe('an instrument from its index.json', () => {
	const doc = {
		instrument: 'Pipe organ',
		level: 0.5,
		release_tau: 0.08,
		delay_s: 0.012,
		dynamics: false,
		layers: [
			{
				name: 'full',
				vel: 230,
				samples: [
					{ name: 'a', midi: 36, file: 'full-36.flac', cents: -4 },
					{ name: 'b', midi: 38, file: 'full-38.flac', cents: 0, loop: [1, 2] }
				]
			},
			{
				name: 'soft',
				vel: 60,
				samples: [{ name: 'c', midi: 36, file: 'soft-36.flac', cents: 0 }]
			}
		]
	};
	const answer = (u: string) =>
		Promise.resolve(
			u.includes('index.json') ? Response.json(doc) : new Response(new ArrayBuffer(8))
		);
	const ctx = {
		decodeAudioData: (b: ArrayBuffer) =>
			Promise.resolve({
				sampleRate: 1000,
				getChannelData: () => new Float32Array(b.byteLength).fill(1)
			} as unknown as AudioBuffer)
	};

	it('reads the layers (the softest first), the loops and the settings of the instrument', async () => {
		const spec = await fetchSpec('organ', answer);
		expect(spec.base).toBe('/samples/organ/');
		expect(spec.dynamics).toBe(false);
		expect(spec.releaseTau).toBe(0.08);
		expect(spec.delay).toBe(0.012);
		expect(spec.layers.map((l) => l.name)).toEqual(['soft', 'full']);
		expect(spec.layers[1].samples[1].loop).toEqual([1, 2]);
	});

	it('reads a list of samples without layers as one layer', async () => {
		const spec = await fetchSpec('old', () =>
			Promise.resolve(
				Response.json({ samples: [{ name: 'x', midi: 60, file: 'x.mp3' }], release_tau: 0.05 })
			)
		);
		expect(spec.layers).toHaveLength(1);
		expect(spec.layers[0].samples[0].cents).toBe(0);
		expect(spec.releaseTau).toBe(0.05);
	});

	it('is a failure when the list is missing or empty', async () => {
		await expect(
			fetchSpec('organ', () => Promise.resolve(new Response('', { status: 404 })))
		).rejects.toThrow(/organ/);
		await expect(
			fetchSpec('organ', () => Promise.resolve(Response.json({ layers: [{ samples: [] }] })))
		).rejects.toThrow(/empty/);
	});

	it('loads every file of every layer, reports progress, and corrects each sample for its own tuning', async () => {
		const asked: string[] = [];
		const seen: number[] = [];
		const spec = await fetchSpec('organ', answer);
		const bank = await loadBank(ctx, {
			spec,
			fetchFn: (u) => {
				asked.push(u);
				return answer(u);
			},
			onProgress: (d, total) => seen.push(d / total)
		});
		expect(bank.size).toBe(3);
		expect(asked.filter((u) => !u.includes('index.json'))).toHaveLength(3);
		expect(asked.some((u) => u.includes('/samples/organ/full-38.flac'))).toBe(true);
		expect(seen.at(-1)).toBe(1);
		expect(bank.dynamics).toBe(false);
		expect(bank.delay).toBe(0.012);
		// full-36 is 4 cents flat of equal temperament: playing it at 36 speeds it up by 4 cents
		const full = bank.voices(36, 255);
		expect(full).toHaveLength(1);
		expect(full[0].rate).toBeCloseTo(2 ** (4 / 1200), 8);
		// the nearest sample of a layer, the lower of two equally near
		expect(bank.voices(37, 255)[0].sample.midi).toBe(36);
		expect(bank.voices(39, 255)[0].sample.midi).toBe(38);
		expect(bank.voices(38, 255)[0].sample.loop).toEqual([1, 2]);
	});

	it('plays two layers crossfaded for a note between their loudnesses', async () => {
		const spec = await fetchSpec('organ', answer);
		const bank = await loadBank(ctx, { spec, fetchFn: answer });
		const v = bank.voices(36, 145); // between soft (60) and full (230)
		expect(v).toHaveLength(2);
		expect(v.map((x) => x.sample.name).sort()).toEqual(['a', 'c']);
		expect(v.reduce((a, x) => a + (x.gain ?? 1) ** 2, 0)).toBeCloseTo(1, 6);
		expect(bank.voices(36, 20)).toHaveLength(1);
		expect(bank.voice(36)).not.toBeNull();
	});

	it('fails as a whole if one file is missing', async () => {
		const spec = await fetchSpec('organ', answer);
		await expect(
			loadBank(ctx, {
				spec,
				fetchFn: (u) =>
					u.endsWith('full-38.flac')
						? Promise.resolve(new Response('', { status: 404 }))
						: answer(u)
			})
		).rejects.toThrow(/sample b/);
	});

	it('stops when it is cancelled', async () => {
		const spec = await fetchSpec('organ', answer);
		let n = 0;
		await expect(
			loadBank(ctx, {
				spec,
				fetchFn: () => {
					n++;
					return answer('x.flac');
				},
				cancelled: () => n >= 1,
				parallel: 1
			})
		).rejects.toBeInstanceOf(LoadCancelled);
		expect(n).toBeLessThan(3);
	});
});
