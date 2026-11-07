/**
 * Bloom (T6.2.1): the stage drawn into a half-float target, a glow added from its bright parts, and the result copied to
 * the canvas as it is.
 *
 * Three's `EffectComposer` and `UnrealBloomPass` do the work; two details are ours:
 *
 * - The canvas may be transparent (the ambient layer shows through it), and glows are drawn as colour with alpha 0 (see
 *   `shaders.ts`). The bloom pass would add its own alpha along with its colour and turn the whole canvas opaque, so its
 *   blend is changed to add colour only and leave alpha as the scene drew it: the bloom is another additive glow.
 * - The shaders write their colours to the framebuffer as they are (no sRGB conversion), so the last pass is a plain
 *   copy, not three's `OutputPass`, which would convert.
 *
 * `bloomStrength` says how strong the bloom is for a scene and a loudness: a low floor so that the notes always glow a
 * little, rising with the (smoothed) loudness. Below `MIN_STRENGTH` the stage skips the whole post chain and draws
 * straight to the canvas, so a quiet scene or a slow machine pays nothing.
 */

import type * as THREE_NS from 'three';

type Three = typeof THREE_NS;

export const MIN_STRENGTH = 0.02;
/** above the resting keys (about 0.9 at their brightest) so that only lit notes and pressed keys glow */
const THRESHOLD = 0.93;
const RADIUS = 0.55;
const FLOOR = 0.2;
const MAX = 1.0;

/** Bloom strength for the scene's `bloom` setting (0..1) and the sound's smoothed energy (0..1). */
export function bloomStrength(scene: number, energy: number): number {
	const s = Math.min(1, Math.max(0, scene));
	const e = Math.min(1, Math.max(0, energy));
	return s * (FLOOR + (MAX - FLOOR) * e * e);
}

export async function loadPost() {
	const [composer, render, bloom, shaderPass, copy] = await Promise.all([
		import('three/examples/jsm/postprocessing/EffectComposer.js'),
		import('three/examples/jsm/postprocessing/RenderPass.js'),
		import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
		import('three/examples/jsm/postprocessing/ShaderPass.js'),
		import('three/examples/jsm/shaders/CopyShader.js')
	]);
	return {
		EffectComposer: composer.EffectComposer,
		RenderPass: render.RenderPass,
		UnrealBloomPass: bloom.UnrealBloomPass,
		ShaderPass: shaderPass.ShaderPass,
		CopyShader: copy.CopyShader
	};
}

export type PostModules = Awaited<ReturnType<typeof loadPost>>;

export class Bloom {
	readonly #composer: InstanceType<PostModules['EffectComposer']>;
	readonly #pass: InstanceType<PostModules['UnrealBloomPass']>;
	readonly #target: THREE_NS.WebGLRenderTarget;
	#disposed = false;

	constructor(
		T: Three,
		post: PostModules,
		renderer: THREE_NS.WebGLRenderer,
		scene: THREE_NS.Scene,
		camera: THREE_NS.Camera,
		width: number,
		height: number,
		dpr: number
	) {
		this.#target = new T.WebGLRenderTarget(Math.max(1, width * dpr), Math.max(1, height * dpr), {
			type: T.HalfFloatType,
			samples: 4
		});
		this.#composer = new post.EffectComposer(renderer, this.#target);
		this.#composer.setPixelRatio(dpr);
		this.#composer.setSize(width, height);
		this.#composer.addPass(new post.RenderPass(scene, camera));
		this.#pass = new post.UnrealBloomPass(
			new T.Vector2(Math.max(1, width * dpr), Math.max(1, height * dpr)),
			0,
			RADIUS,
			THRESHOLD
		);
		const blend = this.#pass.blendMaterial;
		blend.blending = T.CustomBlending;
		blend.blendEquation = T.AddEquation;
		blend.blendSrc = T.OneFactor;
		blend.blendDst = T.OneFactor;
		blend.blendEquationAlpha = T.AddEquation;
		blend.blendSrcAlpha = T.ZeroFactor;
		blend.blendDstAlpha = T.OneFactor;
		this.#composer.addPass(this.#pass);
		this.#composer.addPass(new post.ShaderPass(post.CopyShader));
	}

	setSize(width: number, height: number, dpr: number): void {
		if (this.#disposed) return;
		this.#composer.setPixelRatio(dpr);
		this.#composer.setSize(width, height);
	}

	/** Draw the scene with the given bloom strength to the canvas. */
	render(strength: number, dt: number): void {
		if (this.#disposed) return;
		this.#pass.strength = strength;
		this.#composer.render(dt);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#composer.dispose();
		this.#target.dispose();
	}
}
