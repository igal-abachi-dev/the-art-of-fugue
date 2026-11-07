/**
 * The ambient MilkDrop layer (E6): butterchurn drawing on a canvas *under* the Three.js canvas.
 *
 * Why a second canvas (T6.1.1): butterchurn owns a WebGL2 context of its own, so there are two contexts however it is
 * composited. Stacking the canvases and letting the browser composite them costs nothing on our side; drawing butterchurn
 * into a texture of the Three.js scene would add a copy between contexts every frame. `docs/ambient.md` has the numbers.
 *
 * The layer shares the audio graph: it asks the graph's own `AnalyserNode` for the time-domain samples and hands them to
 * butterchurn as `audioLevels` (butterchurn would otherwise tap the graph with analysers of its own). The context is the
 * graph's `AudioContext`. While the music is paused the layer stops drawing and the picture holds still.
 *
 * Presets are not bundled: `curated.json` lists the ones the scenes use, each a small JSON file under `/data/ambient/`,
 * fetched when a scene first asks for it. butterchurn itself is a dynamic import, so none of this is in the first page load.
 * Everything is lazy, and any failure (no WebGL2, a preset that does not compile) leaves the layer off and the rest working.
 */

import { versioned } from '../data/version.js';

/** the part of a butterchurn visualizer the layer uses */
export interface Visualizer {
	loadPreset(preset: unknown, blendSeconds: number): void;
	render(opts: {
		audioLevels: {
			timeByteArray: Uint8Array;
			timeByteArrayL: Uint8Array;
			timeByteArrayR: Uint8Array;
		};
		elapsedTime: number;
	}): void;
	setRendererSize(width: number, height: number): void;
}

/** what the layer needs from outside, replaceable in tests */
export interface AmbientDeps {
	createVisualizer(
		canvas: HTMLCanvasElement,
		context: AudioContext | null,
		w: number,
		h: number
	): Promise<Visualizer>;
	fetchPreset(id: string): Promise<unknown>;
}

export type AmbientStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface AmbientFrame {
	/** the graph's analyser, or null (no Web Audio) */
	analyser: Pick<AnalyserNode, 'getByteTimeDomainData' | 'fftSize'> | null;
	playing: boolean;
	dt: number;
	/** 0..1; at 0 the layer draws nothing and hides its canvas */
	opacity: number;
	/** the size of the area the canvas covers, in CSS pixels */
	width: number;
	height: number;
	/** the canvas is this fraction of that size (the picture is a soft background and is scaled up by the browser) */
	scale: number;
}

/** seconds a change of preset blends over (butterchurn's own cross-blend) */
export const BLEND_S = 2.5;
const MIN_W = 160;
const MIN_H = 90;
/** frames drawn after a change while paused, so that the new picture appears */
const SETTLE_FRAMES = 3;
const SAMPLES = 1024;

export class AmbientLayer {
	readonly canvas: HTMLCanvasElement;
	status: AmbientStatus = 'idle';
	failure: string | null = null;
	/** the preset on screen (or being blended to), and the one asked for last */
	preset: string | null = null;
	wanted: string | null = null;
	framesDrawn = 0;
	/** milliseconds the last `render` call took */
	lastMs = 0;
	width = 0;
	height = 0;
	opacity = 0;

	readonly #deps: AmbientDeps;
	readonly #cache = new Map<string, Promise<unknown>>();
	#viz: Visualizer | null = null;
	#vizPromise: Promise<Visualizer> | null = null;
	#token = 0;
	#settle = 0;
	#disposed = false;
	readonly #bytes = new Uint8Array(2048);
	readonly #a = new Uint8Array(SAMPLES);
	readonly #b = new Uint8Array(SAMPLES);
	readonly #c = new Uint8Array(SAMPLES);
	#context: AudioContext | null;

	constructor(canvas: HTMLCanvasElement, context: AudioContext | null, deps: AmbientDeps) {
		this.canvas = canvas;
		this.#context = context;
		this.#deps = deps;
		canvas.style.display = 'none';
		canvas.style.opacity = '0';
	}

	/** The layer with the real butterchurn and the presets served under `base` (default `/data/ambient/`). */
	static real(canvas: HTMLCanvasElement, context: AudioContext | null, base = '/data/ambient/') {
		return new AmbientLayer(canvas, context, {
			async createVisualizer(cv, ctx, w, h) {
				const mod = (await import('butterchurn/lib/butterchurn.min.js')) as unknown as {
					default?: unknown;
				};
				const root = (mod.default ?? mod) as { createVisualizer?: unknown; default?: unknown };
				const bc = (typeof root.createVisualizer === 'function' ? root : root.default) as {
					createVisualizer(c: AudioContext | null, cv: HTMLCanvasElement, o: object): Visualizer;
				};
				const viz = bc.createVisualizer(ctx, cv, {
					width: w,
					height: h,
					pixelRatio: 1,
					textureRatio: 1
				});
				return viz;
			},
			async fetchPreset(id) {
				const r = await fetch(versioned(`${base}${id}.json`));
				if (!r.ok) throw new Error(`preset ${id}: HTTP ${r.status}`);
				return r.json();
			}
		});
	}

	/** Use the audio context of the graph once it exists (it is made in the Start click). */
	setContext(context: AudioContext | null): void {
		this.#context ??= context;
	}

	/**
	 * Ask for a preset (null = none). The first call starts loading butterchurn; a later one blends to the new preset over
	 * `BLEND_S`. Asking for the one that is already shown does nothing.
	 */
	setPreset(id: string | null): void {
		if (this.#disposed || this.status === 'failed') return;
		this.wanted = id;
		if (id === null || id === this.preset) return;
		void this.#start(id);
	}

	async #start(id: string): Promise<void> {
		const token = ++this.#token;
		if (!this.#viz) this.status = 'loading';
		try {
			const [preset, viz] = await Promise.all([this.#load(id), this.#ensureViz()]);
			if (this.#disposed || token !== this.#token) return; // a newer request has taken over
			viz.loadPreset(preset, this.preset === null ? 0 : BLEND_S);
			this.preset = id;
			this.status = 'ready';
			this.#settle = SETTLE_FRAMES;
		} catch (e) {
			this.failure = e instanceof Error ? e.message : String(e);
			// a preset that will not load costs only that preset; a visualizer that will not start costs the layer
			if (!this.#viz) this.status = 'failed';
			else this.#cache.delete(id);
		}
	}

	/** the one visualizer, created once however many presets are asked for meanwhile */
	#ensureViz(): Promise<Visualizer> {
		this.#vizPromise ??= (async () => {
			const w = Math.max(MIN_W, this.width || MIN_W);
			const h = Math.max(MIN_H, this.height || MIN_H);
			this.canvas.width = w;
			this.canvas.height = h;
			const viz = await this.#deps.createVisualizer(this.canvas, this.#context, w, h);
			viz.setRendererSize(w, h);
			this.width = w;
			this.height = h;
			if (!this.#disposed) this.#viz = viz;
			return viz;
		})();
		return this.#vizPromise;
	}

	#load(id: string): Promise<unknown> {
		let p = this.#cache.get(id);
		if (!p) {
			p = this.#deps.fetchPreset(id);
			this.#cache.set(id, p);
			p.catch(() => this.#cache.delete(id));
		}
		return p;
	}

	/** Call once per animation frame. Draws when there is something to show and the music is moving. */
	frame(f: AmbientFrame): void {
		if (this.#disposed) return;
		const op = this.status === 'failed' || !this.#viz ? 0 : Math.min(1, Math.max(0, f.opacity));
		this.opacity = op;
		const style = this.canvas.style;
		const visible = op > 0.004;
		if (!visible) {
			if (style.display !== 'none') style.display = 'none';
			return;
		}
		if (style.display === 'none') style.display = 'block';
		const o = op.toFixed(3);
		if (style.opacity !== o) style.opacity = o;

		const w = Math.max(MIN_W, Math.round(f.width * f.scale));
		const h = Math.max(MIN_H, Math.round(f.height * f.scale));
		if (w !== this.width || h !== this.height) this.#resize(w, h);

		if (!f.playing && this.#settle <= 0) return;
		if (this.#settle > 0) this.#settle--;
		this.#sample(f.analyser, f.playing);
		const t0 = performance.now();
		try {
			this.#viz!.render({
				audioLevels: { timeByteArray: this.#a, timeByteArrayL: this.#b, timeByteArrayR: this.#c },
				elapsedTime: Math.min(1 / 20, Math.max(1 / 120, f.dt))
			});
		} catch (e) {
			this.failure = e instanceof Error ? e.message : String(e);
			this.status = 'failed';
			return;
		}
		this.lastMs = performance.now() - t0;
		this.framesDrawn++;
	}

	#resize(w: number, h: number): void {
		this.width = w;
		this.height = h;
		if (!this.#viz) return;
		this.canvas.width = w;
		this.canvas.height = h;
		this.#viz.setRendererSize(w, h);
		this.#settle = Math.max(this.#settle, SETTLE_FRAMES);
	}

	/** the newest 1024 time-domain samples (128 = silence) into the three arrays butterchurn wants */
	#sample(analyser: AmbientFrame['analyser'], playing: boolean): void {
		if (!analyser || !playing) {
			this.#a.fill(128);
		} else {
			const n = Math.min(this.#bytes.length, analyser.fftSize);
			analyser.getByteTimeDomainData(this.#bytes.subarray(0, n) as Uint8Array<ArrayBuffer>);
			if (n >= SAMPLES) this.#a.set(this.#bytes.subarray(n - SAMPLES, n));
			else {
				this.#a.fill(128);
				this.#a.set(this.#bytes.subarray(0, n), SAMPLES - n);
			}
		}
		this.#b.set(this.#a);
		this.#c.set(this.#a);
	}

	info(): {
		status: AmbientStatus;
		preset: string | null;
		wanted: string | null;
		framesDrawn: number;
		lastMs: number;
		width: number;
		height: number;
		opacity: number;
		failure: string | null;
	} {
		return {
			status: this.status,
			preset: this.preset,
			wanted: this.wanted,
			framesDrawn: this.framesDrawn,
			lastMs: this.lastMs,
			width: this.width,
			height: this.height,
			opacity: this.opacity,
			failure: this.failure
		};
	}

	/** Release the GL context and forget everything. Safe to call twice. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#token++;
		this.#viz = null;
		this.#cache.clear();
		try {
			const gl = this.canvas.getContext('webgl2');
			gl?.getExtension('WEBGL_lose_context')?.loseContext();
		} catch {
			/* no context to lose */
		}
		this.canvas.style.display = 'none';
	}
}
