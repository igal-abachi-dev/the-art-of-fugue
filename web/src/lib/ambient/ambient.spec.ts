import { describe, expect, it } from 'vitest';
import {
	AmbientLayer,
	BLEND_S,
	type AmbientDeps,
	type AmbientFrame,
	type Visualizer
} from './ambient.js';

function fakeCanvas(): HTMLCanvasElement {
	return {
		width: 0,
		height: 0,
		style: { display: '', opacity: '' },
		getContext: () => null
	} as unknown as HTMLCanvasElement;
}

class FakeViz implements Visualizer {
	loads: { preset: unknown; blend: number }[] = [];
	renders: { levels: Uint8Array; elapsed: number }[] = [];
	sizes: [number, number][] = [];
	loadPreset(preset: unknown, blend: number) {
		this.loads.push({ preset, blend });
	}
	render(o: Parameters<Visualizer['render']>[0]) {
		this.renders.push({ levels: o.audioLevels.timeByteArray.slice(), elapsed: o.elapsedTime });
	}
	setRendererSize(w: number, h: number) {
		this.sizes.push([w, h]);
	}
}

function setup(opts: { failViz?: boolean; failPreset?: string } = {}) {
	const viz = new FakeViz();
	let created = 0;
	const fetched: string[] = [];
	const deps: AmbientDeps = {
		async createVisualizer() {
			created++;
			if (opts.failViz) throw new Error('no WebGL2');
			return viz;
		},
		async fetchPreset(id) {
			fetched.push(id);
			if (id === opts.failPreset) throw new Error(`preset ${id}: HTTP 404`);
			return { id };
		}
	};
	const canvas = fakeCanvas();
	const layer = new AmbientLayer(canvas, null, deps);
	return { layer, canvas, viz, fetched, created: () => created };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const frame = (over: Partial<AmbientFrame> = {}): AmbientFrame => ({
	analyser: null,
	playing: true,
	dt: 1 / 60,
	opacity: 0.5,
	width: 1280,
	height: 720,
	scale: 0.5,
	...over
});

describe('AmbientLayer', () => {
	it('does nothing, and loads nothing, until a preset is asked for', async () => {
		const { layer, canvas, fetched, created } = setup();
		layer.frame(frame());
		await flush();
		expect(created()).toBe(0);
		expect(fetched).toEqual([]);
		expect(canvas.style.display).toBe('none');
		expect(layer.status).toBe('idle');
	});

	it('loads the visualizer and the preset once, then draws at the requested size and opacity', async () => {
		const { layer, canvas, viz, fetched, created } = setup();
		layer.setPreset('calm');
		layer.setPreset('calm'); // asking again changes nothing
		await flush();
		expect(layer.status).toBe('ready');
		expect(created()).toBe(1);
		expect(fetched).toEqual(['calm']);
		expect(viz.loads).toEqual([{ preset: { id: 'calm' }, blend: 0 }]);
		layer.frame(frame());
		expect(canvas.style.display).toBe('block');
		expect(canvas.style.opacity).toBe('0.500');
		expect([layer.width, layer.height]).toEqual([640, 360]);
		expect(viz.sizes.at(-1)).toEqual([640, 360]);
		expect(viz.renders.length).toBe(1);
	});

	it('blends to the next preset over BLEND_S, and fetches each preset once', async () => {
		const { layer, viz, fetched } = setup();
		layer.setPreset('a');
		await flush();
		layer.setPreset('b');
		await flush();
		layer.setPreset('a'); // back again: from the cache
		await flush();
		expect(viz.loads.map((l) => l.blend)).toEqual([0, BLEND_S, BLEND_S]);
		expect(fetched).toEqual(['a', 'b']);
		expect(layer.preset).toBe('a');
	});

	it('takes only the newest preset when several are asked for before any has loaded', async () => {
		const { layer, viz, created } = setup();
		layer.setPreset('a');
		layer.setPreset('b');
		layer.setPreset('c');
		await flush();
		expect(created()).toBe(1);
		expect(layer.preset).toBe('c');
		expect(viz.loads.map((l) => (l.preset as { id: string }).id)).toEqual(['c']);
	});

	it('hides the canvas and draws nothing at opacity 0, and shows it again at once', async () => {
		const { layer, canvas, viz } = setup();
		layer.setPreset('a');
		await flush();
		layer.frame(frame());
		const drawn = viz.renders.length;
		layer.frame(frame({ opacity: 0 }));
		layer.frame(frame({ opacity: 0.002 }));
		expect(canvas.style.display).toBe('none');
		expect(viz.renders.length).toBe(drawn);
		layer.frame(frame({ opacity: 0.3 }));
		expect(canvas.style.display).toBe('block');
	});

	it('holds the picture while paused (after a few settling frames), and feeds silence', async () => {
		const { layer, viz } = setup();
		layer.setPreset('a');
		await flush();
		for (let i = 0; i < 10; i++) layer.frame(frame({ playing: false }));
		const settled = viz.renders.length;
		expect(settled).toBeGreaterThan(0);
		expect(settled).toBeLessThan(10);
		expect(new Set(viz.renders[0].levels)).toEqual(new Set([128]));
		for (let i = 0; i < 10; i++) layer.frame(frame({ playing: false }));
		expect(viz.renders.length).toBe(settled);
		layer.frame(frame({ playing: true }));
		expect(viz.renders.length).toBe(settled + 1);
	});

	it('hands butterchurn the newest 1024 samples of the analyser', async () => {
		const { layer, viz } = setup();
		layer.setPreset('a');
		await flush();
		const analyser = {
			fftSize: 2048,
			getByteTimeDomainData(a: Uint8Array) {
				for (let i = 0; i < a.length; i++) a[i] = i < 1024 ? 10 : 200; // old half, then new half
			}
		};
		layer.frame(frame({ analyser }));
		const got = viz.renders.at(-1)!.levels;
		expect(got.length).toBe(1024);
		expect(new Set(got)).toEqual(new Set([200]));
	});

	it('keeps frame times within butterchurn’s useful range', async () => {
		const { layer, viz } = setup();
		layer.setPreset('a');
		await flush();
		layer.frame(frame({ dt: 0 }));
		layer.frame(frame({ dt: 5 }));
		expect(viz.renders.map((r) => r.elapsed)).toEqual([1 / 120, 1 / 20]);
	});

	it('resizes with the stage and the quality scale, with a floor', async () => {
		const { layer, viz } = setup();
		layer.setPreset('a');
		await flush();
		layer.frame(frame({ width: 1920, height: 1080, scale: 0.3 }));
		expect([layer.width, layer.height]).toEqual([576, 324]);
		layer.frame(frame({ width: 200, height: 100, scale: 0.3 }));
		expect([layer.width, layer.height]).toEqual([160, 90]);
		expect(viz.sizes.at(-1)).toEqual([160, 90]);
	});

	it('fails soft: no visualizer leaves the layer off; a bad preset leaves the one before', async () => {
		const bad = setup({ failViz: true });
		bad.layer.setPreset('a');
		await flush();
		expect(bad.layer.status).toBe('failed');
		bad.layer.frame(frame());
		expect(bad.canvas.style.display).toBe('none');
		bad.layer.setPreset('b'); // no further attempts
		await flush();
		expect(bad.created()).toBe(1);

		const part = setup({ failPreset: 'broken' });
		part.layer.setPreset('good');
		await flush();
		part.layer.setPreset('broken');
		await flush();
		expect(part.layer.status).toBe('ready');
		expect(part.layer.preset).toBe('good');
		expect(part.layer.failure).toContain('404');
		part.layer.frame(frame());
		expect(part.viz.renders.length).toBe(1);
	});

	it('draws nothing after dispose, and a preset that arrives late is ignored', async () => {
		const { layer, viz } = setup();
		layer.setPreset('a');
		layer.dispose();
		await flush();
		layer.frame(frame());
		layer.dispose();
		expect(viz.loads).toEqual([]);
		expect(viz.renders).toEqual([]);
	});
});
