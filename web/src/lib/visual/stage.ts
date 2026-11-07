/**
 * The Three.js stage (T4.1.1 to T4.3.2): keyboard, falling notes, trails and particles on one canvas.
 *
 * `Stage.create` loads Three.js with a dynamic import, so it is not part of the first page load. Everything
 * that has to be cleaned up is owned here and released in `dispose()`: the resize observer, the context-loss
 * listeners, every geometry, material and the renderer (with its GL context). The caller owns the frame
 * loop: it calls `render(frame, notes)` once per animation frame and cancels its own loop on teardown.
 *
 * E6 adds, on the same canvas: a loudness-driven bloom (`post.ts`, skipped when quiet or when the governor says so), the
 * energy of each voice from the notes (a shader uniform for glow), a slow camera drift and a small shake on loud passages
 * (`motion.ts`), and the numbers the ambient MilkDrop layer under the canvas needs (`ambientOpacity`, the preset, its
 * size). The canvas is transparent while that layer shows; the scene's background colour is then given to the page as
 * `backgroundCss`, which looks exactly the same as drawing it.
 *
 * Per frame the CPU does: one clock-to-uniform copy, a handful of binary searches, a write of the notes that
 * entered the window (usually none), the 88 key states, and the particle bursts of the notes that began since
 * the last frame. Positions of notes and particles are computed in the vertex shaders.
 */

import type * as THREE_NS from 'three';
import type { Frame } from '../playback/frameloop.js';
import type { NoteWindow } from '../playback/window.js';
import { TAG_BACH, TAG_INVERTED, TAG_SUBJECT, type NoteTags } from '../scenes/tags.js';
import { hexToRgb } from './colour.js';
import {
	createEndingState,
	endingState,
	FlipAnim,
	gatherLinks,
	IdleDrift,
	LINK_CAP,
	LINK_STRIDE,
	mirrorAxis,
	shatter,
	SHATTER_LIFE_S,
	type EndingPlan
} from './effects.js';
import { Governor, type Quality } from './governor.js';
import { HALF_WIDTH, KEYS, KEY_COUNT, pitchToX } from './keyboard.js';
import { SHOCK_CAP, SHOCK_STRIDE, ShockPool } from './shock.js';
import { computeKeyStates, createKeyStates, KEY_STATE_STRIDE } from './keystate.js';
import { NOTE_STRIDE, NoteBuffer } from './notebuffer.js';
import { KEY_BLACK, KEY_WHITE } from './palette.js';
import { Emitter, ParticlePool } from './particles.js';
import {
	createSceneState,
	DEFAULT_SCENE,
	SceneManager,
	type SceneConfig,
	type SceneState
} from './scene.js';
import * as GLSL from './shaders.js';
import { Bloom, bloomStrength, loadPost, MIN_STRENGTH, type PostModules } from './post.js';
import {
	cameraDrift,
	cameraShake,
	cameraSteer,
	prefersReducedMotion,
	type Offset,
	type Steer
} from './motion.js';
import { AudioSignals } from './signals.js';
import { totalEnergy, voiceEnergy } from './voiceenergy.js';

type Three = typeof THREE_NS;

export const KEY_LENGTH = 5;
const NOTE_CAPACITY = 1024;
const PARTICLE_CAPACITY = 4096;
const LANE_H = 4.6;
/** the road shows this many bar lines at most */
const ROAD_BARS = 16;
/** the window query that feeds the key states looks this far back (longer than any flare) */
const KEY_LOOKBEHIND = 1.0;

/** What the director learns about a piece from its annotations, for the stage to draw. */
export interface PieceFx {
	tags: NoteTags | null;
	/** the closing sequence, for a piece whose scene asks for one */
	ending: EndingPlan | null;
	/** pitch sum of the mirror axis for a mirror piece */
	axisSum: number | null;
	/** start time of each bar (playhead seconds, ascending), for the lines across the road */
	bars?: number[];
}

export interface StageOptions {
	/** stop the ambient layer from ever showing (`?ambient=0`) */
	ambient?: boolean;
	/** no bloom (`?bloom=0`) */
	bloom?: boolean;
	/** no camera drift or shake and no ambient layer; defaults to the system's `prefers-reduced-motion` */
	reducedMotion?: boolean;
	scene?: SceneConfig;
	/** start at this quality level and do not adapt (`?q=3`); omit to adapt */
	level?: number;
	/** start at this level and adapt from there (a phone starts at 2, T7.5.2); ignored when `level` pins one */
	startLevel?: number;
}

/** the loudness bloom of a listener who asked for less motion is a fraction of its strength: it flickers less */
export const REDUCED_BLOOM = 0.4;

export interface StageStats {
	fps: number;
	level: number;
	dpr: number;
	/** milliseconds of JavaScript per `render` call: mean and 95th percentile of the last 120 frames */
	cpuMsMean: number;
	cpuMsP95: number;
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
	programs: number;
	notesWritten: number;
	particlesEmitted: number;
	/** bloom strength and ambient opacity now */
	bloom: number;
	ambient: number;
	lost: boolean;
}

export class Stage {
	/** stages created and not yet disposed, for leak checks */
	static live = 0;
	static created = 0;

	/** counts on `globalThis.__stageCounts`, where the browser check reads them */
	static #publishCounts(): void {
		(globalThis as { __stageCounts?: unknown }).__stageCounts = {
			live: Stage.live,
			created: Stage.created
		};
	}

	static async create(canvas: HTMLCanvasElement, opts: StageOptions = {}): Promise<Stage> {
		const [THREE, post] = await Promise.all([import('three'), loadPost()]);
		return new Stage(THREE, canvas, opts, post);
	}

	readonly canvas: HTMLCanvasElement;
	readonly governor: Governor;
	readonly scenes: SceneManager;
	readonly noteBuffer = new NoteBuffer(NOTE_CAPACITY);
	readonly pool = new ParticlePool(PARTICLE_CAPACITY);
	/** clash and crossing rings (T5.4.2); the director starts them */
	readonly shocks = new ShockPool();
	/** smoothed energy, bands and onset pulse of the sound (T6.3.1); `listen` feeds it */
	readonly signals = new AudioSignals();
	/** energy of voices 1 to 5 from the notes at the playhead (T6.3.2), 0..1 each */
	readonly voiceEnergy = new Float32Array(5);
	/** how much the ambient layer shows now (0 = not at all): scene, ending and quality combined */
	ambientOpacity = 0;
	/** the colour the scene's background really is on screen, for the page behind a transparent canvas */
	backgroundCss = 'rgb(0, 0, 0)';
	/** scene values currently on screen */
	readonly state: SceneState = createSceneState();
	lost = false;
	disposed = false;

	readonly #T: Three;
	readonly #post: PostModules | null;
	#reduced: boolean;
	#allowAmbient: boolean;
	#allowBloom: boolean;
	/** what the voice toggles ask for, 0..1 per voice, and what is drawn now (it fades) */
	readonly #voiceWant = [1, 1, 1, 1, 1];
	readonly #voiceShow = new Float32Array([1, 1, 1, 1, 1]);
	#highlightOn = false;
	#bloom: Bloom | null = null;
	#bloomStrength = 0;
	readonly #drift: Offset = { x: 0, y: 0 };
	readonly #shake: Offset = { x: 0, y: 0 };
	readonly #steer: Steer = { x: 0, y: 0, roll: 0 };
	#bars: number[] | null = null;
	readonly #barY = new Float32Array(ROAD_BARS).fill(-1e4);
	#road!: THREE_NS.Mesh;
	readonly #wood: THREE_NS.Mesh[] = [];
	#lanes!: THREE_NS.InstancedMesh;
	#loudness = 0;
	#spectrum: Float32Array<ArrayBuffer> | null = null;
	readonly #voiceE = [0, 0, 0, 0, 0];
	readonly #renderer: THREE_NS.WebGLRenderer;
	readonly #scene: THREE_NS.Scene;
	readonly #camera: THREE_NS.PerspectiveCamera;
	readonly #emitter = new Emitter();
	readonly #idle = new IdleDrift();
	readonly #flip = new FlipAnim();
	readonly #ending = createEndingState();
	#endingPlan: EndingPlan | null = null;
	#shattered = false;
	#hasGhost = false;
	#lastT = Number.NaN;
	readonly #fx = new WeakMap<NoteWindow, PieceFx>();
	#tags: NoteTags | null = null;
	#shockVersion = -1;
	#linkFrom = new Float32Array(LINK_CAP * LINK_STRIDE);
	#linkTo = new Float32Array(LINK_CAP * LINK_STRIDE);
	#linkA!: THREE_NS.InstancedBufferAttribute;
	#linkB!: THREE_NS.InstancedBufferAttribute;
	#shockA!: THREE_NS.InstancedBufferAttribute;
	#shockB!: THREE_NS.InstancedBufferAttribute;
	#ghost!: THREE_NS.InstancedMesh;
	#shockMesh!: THREE_NS.InstancedMesh;
	#linkMesh!: THREE_NS.InstancedMesh;
	#themeVec!: THREE_NS.Vector3[];
	readonly #keyStates = createKeyStates();
	readonly #disposables: { dispose(): void }[] = [];
	readonly #uniforms: Record<string, THREE_NS.IUniform>;
	readonly #voiceVec: THREE_NS.Vector3[];
	readonly #median: number[] = [60, 60, 60, 60, 60];
	readonly #bg: THREE_NS.Color;

	readonly #noteBuf: THREE_NS.InstancedInterleavedBuffer;
	readonly #keyState: THREE_NS.InstancedBufferAttribute;
	readonly #particleBuf: { a: THREE_NS.BufferAttribute; b: THREE_NS.BufferAttribute };
	readonly #particles: THREE_NS.Points;
	readonly #trails: THREE_NS.InstancedMesh;
	readonly #keys: THREE_NS.InstancedMesh;
	readonly #hitH: THREE_NS.Mesh;
	readonly #hitV: THREE_NS.Mesh;

	#win: NoteWindow | null = null;
	#noteVersion = -1;
	#particleVersion = -1;
	#observer: ResizeObserver | null = null;
	#quality: Quality;
	#dpr = 1;
	#width = 0;
	#height = 0;
	#cpu = new Float32Array(120);
	#cpuN = 0;
	#cpuMean = 0;
	#cpuP95 = 0;
	#statsAt = 0;
	readonly #sorted = new Float32Array(120);

	constructor(
		three: Three,
		canvas: HTMLCanvasElement,
		opts: StageOptions = {},
		post: PostModules | null = null
	) {
		this.#T = three;
		this.#post = post;
		this.#reduced = opts.reducedMotion ?? prefersReducedMotion();
		this.#allowAmbient = opts.ambient !== false;
		this.#allowBloom = opts.bloom !== false;
		this.canvas = canvas;
		Stage.live++;
		Stage.created++;
		Stage.#publishCounts();
		const T = three;

		this.governor = new Governor(opts.level ?? opts.startLevel ?? 0);
		if (opts.level !== undefined) this.governor.force(opts.level);
		this.#quality = this.governor.quality;
		this.scenes = new SceneManager(opts.scene ?? DEFAULT_SCENE);
		this.scenes.update(0, this.state);

		const renderer = new T.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true, // transparent while the ambient layer shows through; drawn opaque otherwise
			powerPreference: 'high-performance'
		});
		this.#renderer = renderer;
		renderer.autoClear = true;
		this.#bg = new T.Color();
		this.#scene = new T.Scene();
		this.#camera = new T.PerspectiveCamera(32, 16 / 9, 1, 500);
		canvas.addEventListener('webglcontextlost', this.#onLost);
		canvas.addEventListener('webglcontextrestored', this.#onRestored);

		// ---- shared uniforms
		this.#voiceVec = Array.from({ length: 5 }, () => new T.Vector3());
		this.#themeVec = Array.from({ length: 7 }, () => new T.Vector3());
		this.#uniforms = {
			uTime: { value: 0 },
			uSpeed: { value: 2.6 },
			uMix: { value: 0 },
			uVoices: { value: 4 },
			uVoice: { value: this.#voiceVec },
			uMedian: { value: this.#median },
			uAhead: { value: 6.5 },
			uBehind: { value: 1.2 },
			uGlow: { value: 1 },
			uTrail: { value: 1 },
			uParticles: { value: 1 },
			uPointScale: { value: 500 },
			uKeyH: { value: KEY_LENGTH },
			uKeyAlpha: { value: 1 },
			uWhite: { value: new T.Vector3(...hexToRgb(KEY_WHITE)) },
			uBlack: { value: new T.Vector3(...hexToRgb(KEY_BLACK)) },
			uHold: { value: 1e9 },
			uDim: { value: 1 },
			uNoteFade: { value: 1 },
			uTheme: { value: this.#themeVec },
			uThemeMix: { value: 0 },
			uHighlight: { value: 0 },
			uRibbons: { value: 0 },
			uBach: { value: 1 },
			uGhost: { value: 0 },
			uShocks: { value: 0 },
			uLinks: { value: 0 },
			uFlip: { value: 1 },
			uFlipX: { value: 0 },
			uFlipP: { value: 0 },
			uVoiceE: { value: this.#voiceE },
			uVoiceShow: { value: this.#voiceShow },
			uRoad: { value: 0 },
			uRoadLen: { value: 17 },
			uBars: { value: this.#barY }
		};
		// DoubleSide: the lanes layout swaps the along/across axes, which mirrors every quad
		const premultiplied = {
			side: T.DoubleSide,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: T.CustomBlending,
			blendEquation: T.AddEquation,
			blendSrc: T.OneFactor,
			blendDst: T.OneMinusSrcAlphaFactor
		} as const;
		const own = <D extends { dispose(): void }>(d: D): D => {
			this.#disposables.push(d);
			return d;
		};

		// ---- falling notes: one InstancedMesh; instance data is an interleaved buffer shared with the trails
		this.#noteBuf = new T.InstancedInterleavedBuffer(this.noteBuffer.data, NOTE_STRIDE);
		this.#noteBuf.setUsage(T.DynamicDrawUsage);
		const aNote = new T.InterleavedBufferAttribute(this.#noteBuf, 4, 0);
		const aMeta = new T.InterleavedBufferAttribute(this.#noteBuf, 4, 4);
		const aGhost = new T.InterleavedBufferAttribute(this.#noteBuf, 4, 8);
		const aTag = new T.InterleavedBufferAttribute(this.#noteBuf, 4, 12);

		const noteGeo = own(new T.PlaneGeometry(1, 1));
		noteGeo.setAttribute('aNote', aNote);
		noteGeo.setAttribute('aMeta', aMeta);
		noteGeo.setAttribute('aGhost', aGhost);
		noteGeo.setAttribute('aTag', aTag);
		const noteMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.NOTE_VERT,
				fragmentShader: GLSL.NOTE_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		const notes = new T.InstancedMesh(noteGeo, noteMat, NOTE_CAPACITY);
		notes.frustumCulled = false;
		notes.renderOrder = 2;
		this.#scene.add(notes);

		const trailGeo = own(new T.PlaneGeometry(1, 1, 1, 10));
		trailGeo.setAttribute('aNote', aNote);
		trailGeo.setAttribute('aMeta', aMeta);
		trailGeo.setAttribute('aTag', aTag);
		const trailMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.TRAIL_VERT,
				fragmentShader: GLSL.TRAIL_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		this.#trails = new T.InstancedMesh(trailGeo, trailMat, NOTE_CAPACITY);
		this.#trails.frustumCulled = false;
		this.#trails.renderOrder = 1;
		this.#scene.add(this.#trails);
		own(notes);
		own(this.#trails);

		// ---- the mirror ghost: the same instances drawn again at the pitch of their counterpart in the paired piece
		const ghostMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.NOTE_VERT,
				fragmentShader: GLSL.NOTE_FRAG,
				uniforms: this.#uniforms,
				defines: { GHOST: '' },
				...premultiplied
			})
		);
		this.#ghost = new T.InstancedMesh(noteGeo, ghostMat, NOTE_CAPACITY);
		this.#ghost.frustumCulled = false;
		this.#ghost.renderOrder = 1;
		this.#ghost.visible = false;
		this.#scene.add(this.#ghost);
		own(this.#ghost);

		// ---- shockwave rings
		const shockGeo = own(new T.PlaneGeometry(1, 1));
		this.#shockA = new T.InstancedBufferAttribute(this.shocks.a, SHOCK_STRIDE);
		this.#shockB = new T.InstancedBufferAttribute(this.shocks.b, SHOCK_STRIDE);
		this.#shockA.setUsage(T.DynamicDrawUsage);
		this.#shockB.setUsage(T.DynamicDrawUsage);
		shockGeo.setAttribute('aS', this.#shockA);
		shockGeo.setAttribute('aS2', this.#shockB);
		const shockMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.SHOCK_VERT,
				fragmentShader: GLSL.SHOCK_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		this.#shockMesh = new T.InstancedMesh(shockGeo, shockMat, SHOCK_CAP);
		this.#shockMesh.frustumCulled = false;
		this.#shockMesh.renderOrder = 5;
		this.#shockMesh.visible = false;
		this.#scene.add(this.#shockMesh);
		own(this.#shockMesh);

		// ---- canon links: threads between a leader note and the echo that follows it
		const linkGeo = own(new T.PlaneGeometry(1, 1));
		this.#linkA = new T.InstancedBufferAttribute(this.#linkFrom, LINK_STRIDE);
		this.#linkB = new T.InstancedBufferAttribute(this.#linkTo, LINK_STRIDE);
		this.#linkA.setUsage(T.DynamicDrawUsage);
		this.#linkB.setUsage(T.DynamicDrawUsage);
		linkGeo.setAttribute('aL0', this.#linkA);
		linkGeo.setAttribute('aL1', this.#linkB);
		const linkMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.LINK_VERT,
				fragmentShader: GLSL.LINK_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		this.#linkMesh = new T.InstancedMesh(linkGeo, linkMat, LINK_CAP);
		this.#linkMesh.frustumCulled = false;
		this.#linkMesh.renderOrder = 1;
		this.#linkMesh.visible = false;
		this.#scene.add(this.#linkMesh);
		own(this.#linkMesh);

		// ---- keys: 88 instanced boxes
		const keyGeo = own(new T.BoxGeometry(1, 1, 1));
		const keyInfo = new Float32Array(KEY_COUNT * 4);
		for (let i = 0; i < KEY_COUNT; i++) {
			keyInfo[i * 4] = KEYS.x[i];
			keyInfo[i * 4 + 1] = KEYS.black[i];
			keyInfo[i * 4 + 2] = KEYS.width[i];
		}
		keyGeo.setAttribute('aKey', new T.InstancedBufferAttribute(keyInfo, 4));
		this.#keyState = new T.InstancedBufferAttribute(this.#keyStates, KEY_STATE_STRIDE);
		this.#keyState.setUsage(T.DynamicDrawUsage);
		keyGeo.setAttribute('aState', this.#keyState);
		const keyMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.KEY_VERT,
				fragmentShader: GLSL.KEY_FRAG,
				uniforms: this.#uniforms,
				transparent: true,
				depthTest: true,
				depthWrite: true,
				blending: T.CustomBlending,
				blendEquation: T.AddEquation,
				blendSrc: T.OneFactor,
				blendDst: T.OneMinusSrcAlphaFactor
			})
		);
		this.#keys = new T.InstancedMesh(keyGeo, keyMat, KEY_COUNT);
		this.#keys.frustumCulled = false;
		this.#keys.renderOrder = 0;
		this.#scene.add(this.#keys);
		own(this.#keys);

		// ---- the woodwork of a concert grand in black lacquer: the key slip along the front, a block at either end of the
		// keys and the bed under them (their tops sit just above, level with and below the keys' tops)
		const boxGeo = own(new T.BoxGeometry(1, 1, 1));
		const lacquer = (gold: number) =>
			own(
				new T.ShaderMaterial({
					vertexShader: GLSL.LACQUER_VERT,
					fragmentShader: GLSL.LACQUER_FRAG,
					uniforms: { uKeyAlpha: this.#uniforms.uKeyAlpha, uGold: { value: gold } },
					transparent: true,
					depthTest: true,
					depthWrite: true,
					blending: T.CustomBlending,
					blendEquation: T.AddEquation,
					blendSrc: T.OneFactor,
					blendDst: T.OneMinusSrcAlphaFactor
				})
			);
		const goldMat = lacquer(1);
		const plainMat = lacquer(0);
		const block = (
			mat: THREE_NS.Material,
			x: number,
			y: number,
			z: number,
			sx: number,
			sy: number,
			sz: number
		) => {
			const m = new T.Mesh(boxGeo, mat);
			m.position.set(x, y, z);
			m.scale.set(sx, sy, sz);
			m.frustumCulled = false;
			m.renderOrder = 0;
			this.#scene.add(m);
			this.#wood.push(m);
		};
		const whole = 2 * HALF_WIDTH;
		block(goldMat, 0, -KEY_LENGTH - 0.45, -0.3, whole + 2.4, 0.9, 0.7); // key slip
		block(plainMat, -(HALF_WIDTH + 0.6), -(KEY_LENGTH + 0.9) / 2, -0.1, 1.2, KEY_LENGTH + 0.9, 1.1); // key blocks
		block(plainMat, HALF_WIDTH + 0.6, -(KEY_LENGTH + 0.9) / 2, -0.1, 1.2, KEY_LENGTH + 0.9, 1.1);
		block(plainMat, 0, -KEY_LENGTH / 2, -0.78, whole + 0.2, KEY_LENGTH, 0.4); // key bed
		// the red felt: a strip along the back of the keys (where they go under the fallboard, a little below the key
		// tops so the notes still land on the keys) and one down the inside of each key block, as on a Yamaha or a Steinway
		const feltMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.LACQUER_VERT,
				fragmentShader: GLSL.FELT_FRAG,
				uniforms: { uKeyAlpha: this.#uniforms.uKeyAlpha },
				transparent: true,
				depthTest: true,
				depthWrite: true,
				blending: T.CustomBlending,
				blendEquation: T.AddEquation,
				blendSrc: T.OneFactor,
				blendDst: T.OneMinusSrcAlphaFactor
			})
		);
		block(feltMat, 0, 0.14, -0.02, whole + 0.2, 0.28, 0.3); // behind the keys, under the fallboard
		block(feltMat, -(HALF_WIDTH + 0.04), -KEY_LENGTH / 2, 0.0, 0.08, KEY_LENGTH, 0.34);
		block(feltMat, HALF_WIDTH + 0.04, -KEY_LENGTH / 2, 0.0, 0.08, KEY_LENGTH, 0.34);

		// ---- the road: lane lines and bar lines on the floor under the notes, and lanes of light above the pressed keys
		const roadGeo = own(new T.PlaneGeometry(1, 1));
		const roadMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.ROAD_VERT,
				fragmentShader: GLSL.ROAD_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		this.#road = new T.Mesh(roadGeo, roadMat);
		this.#road.frustumCulled = false;
		this.#road.renderOrder = 0;
		this.#scene.add(this.#road);
		own(this.#road);
		const laneGeo = own(new T.PlaneGeometry(1, 1));
		laneGeo.setAttribute('aKey', keyGeo.getAttribute('aKey'));
		laneGeo.setAttribute('aState', this.#keyState);
		const laneMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.LANE_VERT,
				fragmentShader: GLSL.LANE_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		this.#lanes = new T.InstancedMesh(laneGeo, laneMat, KEY_COUNT);
		this.#lanes.frustumCulled = false;
		this.#lanes.renderOrder = 0;
		this.#scene.add(this.#lanes);
		own(this.#lanes);

		// ---- hit line, one per layout
		const lineGeo = own(new T.PlaneGeometry(1, 1));
		const mkLine = () =>
			new T.Mesh(
				lineGeo,
				own(
					new T.MeshBasicMaterial({
						color: 0xffffff,
						transparent: true,
						opacity: 0,
						blending: T.AdditiveBlending,
						depthTest: false,
						depthWrite: false
					})
				)
			);
		this.#hitH = mkLine();
		this.#hitH.scale.set(2 * HALF_WIDTH, 0.05, 1);
		this.#hitH.position.set(0, 0.02, 0.01);
		this.#hitV = mkLine();
		this.#hitV.scale.set(0.05, 2.2 * LANE_H * 2.2, 1);
		this.#hitV.position.set(-17, 0, 0.01);
		this.#hitH.renderOrder = this.#hitV.renderOrder = 3;
		this.#scene.add(this.#hitH, this.#hitV);

		// ---- particles: a ring of points whose positions the vertex shader derives from their age
		const pGeo = own(new T.BufferGeometry());
		const a = new T.BufferAttribute(this.pool.a, 4);
		const b = new T.BufferAttribute(this.pool.b, 4);
		a.setUsage(T.DynamicDrawUsage);
		b.setUsage(T.DynamicDrawUsage);
		pGeo.setAttribute('aA', a);
		pGeo.setAttribute('aB', b);
		pGeo.setAttribute(
			'position',
			new T.BufferAttribute(new Float32Array(PARTICLE_CAPACITY * 3), 3)
		);
		this.#particleBuf = { a, b };
		const pMat = own(
			new T.ShaderMaterial({
				vertexShader: GLSL.PARTICLE_VERT,
				fragmentShader: GLSL.PARTICLE_FRAG,
				uniforms: this.#uniforms,
				...premultiplied
			})
		);
		this.#particles = new T.Points(pGeo, pMat);
		this.#particles.frustumCulled = false;
		this.#particles.renderOrder = 4;
		this.#scene.add(this.#particles);

		this.applyQuality(this.#quality);
		this.resize();
		if (typeof ResizeObserver !== 'undefined') {
			this.#observer = new ResizeObserver(() => this.resize());
			this.#observer.observe(canvas);
		}
	}

	/**
	 * Change the effects while running (T7.3.2): the MilkDrop layer, the bloom and reduced motion. Nothing is recreated;
	 * the next frame draws the new choice and the governor's own limits still apply.
	 */
	setEffects(e: { ambient?: boolean; bloom?: boolean; reducedMotion?: boolean }): void {
		if (e.ambient !== undefined) this.#allowAmbient = e.ambient;
		if (e.bloom !== undefined) this.#allowBloom = e.bloom;
		if (e.reducedMotion !== undefined) this.#reduced = e.reducedMotion;
	}

	/** Which voices are drawn (T7.3.1): 0 or 1 for voices 1 to 5. The change fades; the audio is not affected. */
	setVoiceMask(mask: readonly number[]): void {
		for (let i = 0; i < 5; i++) this.#voiceWant[i] = mask[i] ? 1 : 0;
	}

	/** Mark the subject entries in every scene, not only in the ones that ask for it. */
	setHighlight(on: boolean): void {
		this.#highlightOn = on;
	}

	/** What the listener's choices are now, for the browser check. */
	choices(): { ambient: boolean; bloom: boolean; reducedMotion: boolean; voiceShow: number[] } {
		return {
			ambient: this.#allowAmbient,
			bloom: this.#allowBloom,
			reducedMotion: this.#reduced,
			voiceShow: [...this.#voiceShow]
		};
	}

	/** The notes of the piece being played (or none). Resets what depends on the piece. */
	setNotes(win: NoteWindow | null): void {
		this.#win = win;
		this.noteBuffer.setWindow(win);
		this.#emitter.reset();
		this.#idle.reset();
		this.pool.clear();
		this.shocks.clear();
		this.#shattered = false;
		this.#lastT = Number.NaN;
		const voices = win ? this.#measureVoices(win) : 4;
		this.#uniforms.uVoices.value = voices;
		this.#applyFx(win ? this.#fx.get(win) : undefined);
	}

	/**
	 * What the annotations say about a piece, for the scene effects: per-note tags, the ending, the mirror axis. It can
	 * arrive after the piece's notes (it is fetched separately); it is kept with the window and applied when that window
	 * is the one on stage.
	 */
	setPieceFx(win: NoteWindow, fx: PieceFx): void {
		this.#fx.set(win, fx);
		if (win === this.#win) this.#applyFx(fx);
	}

	#applyFx(fx: PieceFx | undefined): void {
		this.#tags = fx?.tags ?? null;
		this.noteBuffer.setTags(this.#tags);
		this.#endingPlan = fx?.ending ?? null;
		this.#bars = fx?.bars ?? null;
		this.#shattered = false;
		const axis = fx?.axisSum != null ? mirrorAxis(fx.axisSum) : null;
		this.#uniforms.uFlipX.value = axis?.x ?? 0;
		this.#uniforms.uFlipP.value = axis?.pitch ?? 0;
		this.#hasGhost = !!this.#tags && this.#tags.ghost.some((g) => g > 0);
	}

	/** What the scene effects are doing now, for the browser check and the HUD. */
	fxInfo(): {
		tagged: boolean;
		subjectNotes: number;
		invertedNotes: number;
		bachNotes: number;
		ghostNotes: number;
		ghostVisible: boolean;
		linksDrawn: number;
		shocksAlive: number;
		shocksEmitted: number;
		shocksRefused: number;
		shattered: boolean;
		ending: EndingPlan | null;
		hold: number;
		noteFade: number;
		dim: number;
		flip: number;
	} {
		const tags = this.#tags;
		let subject = 0;
		let inverted = 0;
		let bach = 0;
		let ghost = 0;
		if (tags)
			for (let i = 0; i < tags.n; i++) {
				if (tags.bits[i] & TAG_SUBJECT) subject++;
				if (tags.bits[i] & TAG_INVERTED) inverted++;
				if (tags.bits[i] & TAG_BACH) bach++;
				if (tags.ghost[i]) ghost++;
			}
		const u = this.#uniforms;
		return {
			tagged: tags !== null,
			subjectNotes: subject,
			invertedNotes: inverted,
			bachNotes: bach,
			ghostNotes: ghost,
			ghostVisible: this.#ghost.visible,
			linksDrawn: this.#linkMesh.visible ? this.#linkMesh.count : 0,
			shocksAlive: this.shocks.alive(this.#lastT),
			shocksEmitted: this.shocks.emitted,
			shocksRefused: this.shocks.refused,
			shattered: this.#shattered,
			ending: this.#endingPlan,
			hold: u.uHold.value as number,
			noteFade: u.uNoteFade.value as number,
			dim: u.uDim.value as number,
			flip: u.uFlip.value as number
		};
	}

	/** Turn the picture over (the rectus to inversus cue). */
	flip(): void {
		this.#flip.start();
	}

	/** Start a clash or crossing ring at the pitch of an event, at playhead time `t`. False if the rate cap refused it. */
	shock(t: number, pitch: number, voice: number, strength: number, kind: number): boolean {
		if (this.state.shockwaves <= 0.01) return false;
		return this.shocks.emit(
			t,
			pitchToX(pitch),
			pitch,
			voice,
			strength * this.state.shockwaves,
			kind
		);
	}

	/** Median pitch per voice (to centre the lanes) and the number of voices. */
	#measureVoices(win: NoteWindow): number {
		const n = win.notes;
		const hist = new Uint16Array(5 * 128);
		const count = new Uint32Array(5);
		let voices = 1;
		for (let i = 0; i < n.n; i++) {
			const v = Math.min(5, Math.max(1, n.voice[i])) - 1;
			hist[v * 128 + (n.pitch[i] & 127)]++;
			count[v]++;
			if (v + 1 > voices) voices = v + 1;
		}
		for (let v = 0; v < 5; v++) {
			let acc = 0;
			let med = 60;
			for (let p = 0; p < 128; p++) {
				acc += hist[v * 128 + p];
				if (acc * 2 >= count[v] && count[v] > 0) {
					med = p;
					break;
				}
			}
			this.#median[v] = med;
		}
		return voices;
	}

	/** Fade to another scene over `seconds` (0 = at once). */
	setScene(config: SceneConfig, seconds = 0.9): void {
		this.scenes.set(config, seconds);
	}

	applyQuality(q: Quality): void {
		this.#quality = q;
		this.pool.setCap(q.particleCap);
		const dpr = Math.min(globalThis.devicePixelRatio || 1, q.dprCap);
		if (dpr !== this.#dpr) {
			this.#dpr = dpr;
			this.#renderer.setPixelRatio(dpr);
			this.#width = 0; // force the size to be applied again
			this.resize();
		}
	}

	resize(): void {
		if (this.disposed) return;
		const w = Math.max(1, Math.floor(this.canvas.clientWidth));
		const h = Math.max(1, Math.floor(this.canvas.clientHeight));
		if (w === this.#width && h === this.#height) return;
		this.#width = w;
		this.#height = h;
		this.#renderer.setSize(w, h, false);
		this.#bloom?.setSize(w, h, this.#dpr);
		this.#camera.aspect = w / h;
		this.#camera.updateProjectionMatrix();
	}

	/**
	 * Read the sound for this frame (T6.3.1): the analyser's spectrum while playing, nothing (the signals relax to 0) while
	 * paused or when there is no analyser. Call once per frame before `render`.
	 */
	listen(analyser: AnalyserNode | null, sampleRate: number, playing: boolean, dt: number): void {
		if (!analyser || !playing) {
			this.signals.idle(dt);
			return;
		}
		if (!this.#spectrum || this.#spectrum.length !== analyser.frequencyBinCount)
			this.#spectrum = new Float32Array(analyser.frequencyBinCount);
		analyser.getFloatFrequencyData(this.#spectrum);
		this.signals.update(this.#spectrum, sampleRate, dt);
	}

	/** The preset of the scene being shown, for the ambient layer (null = none). */
	get ambientPreset(): string | null {
		return this.scenes.current.ambient.preset;
	}

	/** Size of the ambient layer as a fraction of the stage, from the quality level (0 = layer off). */
	get ambientScale(): number {
		return this.#quality.ambientScale;
	}

	/** What the E6 effects are doing now, for the browser check and the HUD. */
	e6Info(): {
		bloomStrength: number;
		bloomActive: boolean;
		loudness: number;
		voiceEnergy: number[];
		shake: Offset;
		drift: Offset;
		ambientOpacity: number;
		reducedMotion: boolean;
		signals: {
			energy: number;
			low: number;
			mid: number;
			high: number;
			pulse: number;
			onsets: number;
		};
	} {
		const g = this.signals;
		return {
			bloomStrength: this.#bloomStrength,
			bloomActive: this.#bloom !== null && this.#bloomStrength >= MIN_STRENGTH,
			loudness: this.#loudness,
			voiceEnergy: [...this.voiceEnergy],
			shake: { ...this.#shake },
			drift: { ...this.#drift },
			ambientOpacity: this.ambientOpacity,
			reducedMotion: this.#reduced,
			signals: {
				energy: g.energy,
				low: g.low,
				mid: g.mid,
				high: g.high,
				pulse: g.pulse,
				onsets: g.onsets
			}
		};
	}

	/** Draw one frame for the playhead at `frame.t`. `win` is the current piece's notes, or null (silence/loading). */
	render(frame: Pick<Frame, 't' | 'dt' | 'discontinuity'>, win: NoteWindow | null): void {
		if (this.disposed || this.lost) return;
		const t0 = performance.now();
		if (win !== this.#win) this.setNotes(win);

		const st = this.state;
		this.scenes.update(frame.dt, st);
		if (this.governor.frame(frame.dt)) this.applyQuality(this.governor.quality);
		const q = this.#quality;

		const behind = Math.max(st.behind, KEY_LOOKBEHIND + 0.1);
		const u = this.#uniforms;
		u.uTime.value = frame.t;
		u.uSpeed.value = st.speed;
		u.uMix.value = st.layoutMix;
		u.uAhead.value = st.ahead;
		u.uBehind.value = behind;
		u.uGlow.value = q.glow ? st.glow : 0;
		u.uTrail.value = q.trails ? st.trails : 0;
		u.uParticles.value = q.particleCap > 0 ? st.particles : 0;
		for (let i = 0; i < 5; i++)
			this.#voiceVec[i].set(st.voices[i * 3], st.voices[i * 3 + 1], st.voices[i * 3 + 2]);
		for (let i = 0; i < 7; i++)
			this.#themeVec[i].set(st.themes[i * 3], st.themes[i * 3 + 1], st.themes[i * 3 + 2]);
		u.uThemeMix.value = st.themeColour;
		u.uHighlight.value = Math.max(st.highlight, this.#highlightOn ? 1 : 0);
		for (let i = 0; i < 5; i++) {
			// the toggles fade over about a quarter of a second
			const d = this.#voiceWant[i] - this.#voiceShow[i];
			this.#voiceShow[i] += Math.abs(d) < 0.01 ? d : d * Math.min(1, frame.dt * 14);
		}
		u.uRibbons.value = st.ribbons;
		u.uBach.value = st.bach;
		u.uGhost.value = this.#hasGhost ? st.ghost : 0;
		u.uShocks.value = st.shockwaves;
		u.uLinks.value = st.links;
		u.uFlip.value = this.#flip.update(frame.dt);

		// the ending is a function of the playhead alone: freeze, shatter, black
		const end = endingState(this.#endingPlan, frame.t, this.#ending);
		u.uHold.value = end.hold;
		u.uNoteFade.value = end.notes;
		u.uDim.value = end.dim;
		const tn = Math.min(frame.t, end.hold); // the playhead as the notes see it
		const plan = this.#endingPlan;
		if (plan && win) {
			if (frame.t < plan.shatterAt) this.#shattered = false;
			else if (!this.#shattered) {
				this.#shattered = true; // once per approach, and not at all for a seek that lands after the burst's life
				// no burst of particles for a listener who asked for less motion: the picture just goes dark
				if (frame.t < plan.shatterAt + SHATTER_LIFE_S && !this.#reduced)
					shatter(win, plan, this.pool, Math.min(1, q.particleCap / 2048));
			}
		}
		u.uKeyAlpha.value = (1 - Math.min(1, Math.abs(st.layoutMix) * 2)) * end.dim; // gone by the middle of the morph

		// the loudness of the notes drives the shake; the camera is a function of the playhead alone
		this.#loudness = win ? totalEnergy(this.voiceEnergy) : 0;
		if (this.#reduced) {
			this.#drift.x = this.#drift.y = this.#shake.x = this.#shake.y = 0;
		} else {
			cameraDrift(frame.t, st.drift, this.#drift);
			cameraShake(tn, this.#loudness, st.shake * end.dim, this.#shake);
		}
		for (let v = 0; v < 5; v++) this.#voiceE[v] = this.voiceEnergy[v];

		// the ambient layer shows through a transparent canvas; the scene's background colour is then the page's
		const wantAmbient =
			this.#allowAmbient && !this.#reduced && q.ambientScale > 0 && !!st.ambient && !this.lost;
		this.ambientOpacity = wantAmbient ? st.ambient * end.dim : 0;
		const bg = st.background;
		this.#bg.setRGB(bg[0] * end.dim, bg[1] * end.dim, bg[2] * end.dim, this.#T.SRGBColorSpace);
		// three turns a clear colour into the canvas's colour space when it is set (the canvas is the current target then),
		// and the bloom pass clears its target with those numbers as they are: one colour does for both paths
		const clearAlpha = this.ambientOpacity > 0.004 ? 0 : 1;
		this.backgroundCss = `rgb(${Math.round(bg[0] * end.dim * 255)}, ${Math.round(bg[1] * end.dim * 255)}, ${Math.round(bg[2] * end.dim * 255)})`;

		const mix = st.layoutMix;
		(this.#hitH.material as THREE_NS.MeshBasicMaterial).opacity = 0.35 * (1 - mix) * end.dim;
		(this.#hitV.material as THREE_NS.MeshBasicMaterial).opacity = 0.35 * mix * end.dim;
		this.#hitH.visible = mix < 0.99;
		this.#hitV.visible = mix > 0.01;

		let links = 0;
		if (win) {
			if (
				this.noteBuffer.update(tn, st.ahead, behind) ||
				this.noteBuffer.version !== this.#noteVersion
			) {
				this.#noteBuf.needsUpdate = true;
				this.#noteVersion = this.noteBuffer.version;
			}
			// the keys stand frozen with the notes, then let go when the picture shatters
			const kt = plan && frame.t < plan.shatterAt ? tn : frame.t;
			win.query(kt, 0, KEY_LOOKBEHIND);
			computeKeyStates(win, kt, this.#keyStates);
			voiceEnergy(win, kt, this.voiceEnergy);
			this.#emitter.step(
				win,
				frame.t,
				frame.discontinuity,
				this.pool,
				q.particleCap > 0 ? st.particles : 0
			);
			if (st.links > 0.01 && this.#tags) {
				links = gatherLinks(win, this.#tags, tn, st.ahead, this.#linkFrom, this.#linkTo);
				this.#linkA.needsUpdate = this.#linkB.needsUpdate = true;
			}
		} else {
			this.#keyStates.fill(0);
			this.voiceEnergy.fill(0);
			// between pieces: a few embers drift up from the keys
			const dtClock = frame.t - this.#lastT;
			if (!frame.discontinuity && dtClock > 0 && q.particleCap > 0)
				this.#idle.step(frame.t, dtClock, this.pool, st.particles);
		}
		this.#lastT = frame.t;
		// the view leans toward the notes that sound around now (read from the resident notes, so after they were updated)
		if (this.#reduced || !win || st.steer <= 0.001) {
			this.#steer.x = this.#steer.y = this.#steer.roll = 0;
		} else {
			cameraSteer(
				this.noteBuffer.data,
				NOTE_STRIDE,
				HALF_WIDTH,
				tn,
				st.steer * end.dim * (1 - mix),
				this.#steer
			);
		}
		this.#updateCamera(st);
		this.#updateRoad(st, tn, end.dim);
		this.#linkMesh.count = links;
		this.#linkMesh.visible = links > 0;
		this.#ghost.visible = u.uGhost.value > 0.01 && !!win;
		this.#shockMesh.visible = st.shockwaves > 0.01;
		if (this.shocks.version !== this.#shockVersion) {
			this.#shockA.needsUpdate = this.#shockB.needsUpdate = true;
			this.#shockVersion = this.shocks.version;
		}
		this.#keyState.needsUpdate = true;
		if (this.pool.version !== this.#particleVersion) {
			this.#particleBuf.a.needsUpdate = true;
			this.#particleBuf.b.needsUpdate = true;
			this.#particleVersion = this.pool.version;
		}
		this.#particles.geometry.setDrawRange(0, this.pool.cap);
		this.#particles.visible = this.pool.cap > 0;
		this.#trails.visible = u.uTrail.value > 0.001;

		// bloom follows the loudness of the sound, and is skipped (no extra passes at all) when it would not show
		const strength =
			this.#allowBloom && q.bloom && this.#post
				? bloomStrength(st.bloom, this.signals.energy) *
					end.dim *
					(this.#reduced ? REDUCED_BLOOM : 1)
				: 0;
		this.#bloomStrength = strength;
		const viaBloom = strength >= MIN_STRENGTH && !!this.#post;
		this.#renderer.setClearColor(this.#bg, clearAlpha);
		if (viaBloom) {
			this.#bloom ??= new Bloom(
				this.#T,
				this.#post,
				this.#renderer,
				this.#scene,
				this.#camera,
				this.#width,
				this.#height,
				this.#dpr
			);
			this.#bloom.render(strength, frame.dt);
		} else {
			if (this.#bloom && (!q.bloom || strength < MIN_STRENGTH * 0.5)) {
				// leave the targets in place across a quiet moment, free them when the governor turned bloom off
				if (!q.bloom) {
					this.#bloom.dispose();
					this.#bloom = null;
				}
			}
			this.#renderer.render(this.#scene, this.#camera);
		}
		this.#recordCpu(performance.now() - t0);
	}

	/** The road's strength, length and bar lines for the playhead; it belongs to the keyboard layout. */
	#updateRoad(st: SceneState, tn: number, dim: number): void {
		const u = this.#uniforms;
		const length = st.ahead * st.speed;
		const strength = this.#quality.glow
			? st.road * dim * (1 - Math.min(1, st.layoutMix * 2)) * (this.#win ? 1 : 0.5)
			: 0;
		u.uRoad.value = strength;
		u.uRoadLen.value = length;
		this.#road.visible = this.#lanes.visible = strength > 0.002;
		const y = this.#barY;
		y.fill(-1e4);
		const bars = this.#bars;
		if (!bars || strength <= 0.002) return;
		// first bar line at or after just behind the hit line, by binary search
		let lo = 0;
		let hi = bars.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (bars[mid] < tn - 0.05) lo = mid + 1;
			else hi = mid;
		}
		for (let i = 0; i < ROAD_BARS && lo + i < bars.length; i++) {
			const d = bars[lo + i] - tn;
			if (d > st.ahead) break;
			y[i] = d * st.speed;
		}
	}

	#updateCamera(st: SceneState): void {
		const cam = this.#camera;
		if (cam.fov !== st.fov) {
			cam.fov = st.fov;
			cam.updateProjectionMatrix();
		}
		const aspect = this.#width / this.#height || 16 / 9;
		const tanH = Math.tan((st.fov * Math.PI) / 360);
		// distance so the whole keyboard width fits, and also the whole height of what is drawn
		const wide = (HALF_WIDTH + 4.4) / (tanH * aspect);
		const keyboardH = KEY_LENGTH + st.ahead * st.speed + 2;
		const lanesH = 4 * LANE_H + 3;
		const needH = keyboardH + (lanesH - keyboardH) * st.layoutMix;
		const tall = needH / (2 * tanH);
		const dist = Math.max(wide, tall);
		const ox = this.#drift.x + this.#shake.x + this.#steer.x;
		const oy = this.#drift.y + this.#shake.y;
		cam.position.set(ox, st.targetY - dist * Math.sin(st.tilt) + oy, dist * Math.cos(st.tilt));
		cam.lookAt(ox, st.targetY + oy, 0); // the view slides; it does not turn (but for the small bank of the steering)
		if (this.#steer.roll !== 0) cam.rotateZ(this.#steer.roll);
		cam.updateMatrixWorld();
		// point sprites: pixels per world unit at distance 1
		this.#uniforms.uPointScale.value = (this.#height * this.#dpr) / (2 * tanH);
	}

	#recordCpu(ms: number): void {
		this.#cpu[this.#cpuN % 120] = ms;
		this.#cpuN++;
	}

	/** Snapshot for a HUD or a test. Cheap enough to call a few times a second. */
	stats(): StageStats {
		const n = Math.min(120, this.#cpuN);
		if (n > 0 && performance.now() - this.#statsAt > 200) {
			this.#statsAt = performance.now();
			let sum = 0;
			for (let i = 0; i < n; i++) {
				this.#sorted[i] = this.#cpu[i];
				sum += this.#cpu[i];
			}
			this.#sorted.subarray(0, n).sort();
			this.#cpuMean = sum / n;
			this.#cpuP95 = this.#sorted[Math.min(n - 1, Math.floor(n * 0.95))];
		}
		const info = this.#renderer.info;
		return {
			fps: this.governor.fps,
			level: this.governor.level,
			dpr: this.#dpr,
			cpuMsMean: this.#cpuMean,
			cpuMsP95: this.#cpuP95,
			drawCalls: info.render.calls,
			triangles: info.render.triangles,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			programs: info.programs?.length ?? 0,
			notesWritten: this.noteBuffer.totalWritten,
			particlesEmitted: this.pool.emitted,
			bloom: this.#bloomStrength,
			ambient: this.ambientOpacity,
			lost: this.lost
		};
	}

	/** For tests: lose and restore the GL context through the standard extension. */
	loseContext(): { restore: () => void } | null {
		const ext = this.#renderer.getContext().getExtension('WEBGL_lose_context');
		if (!ext) return null;
		ext.loseContext();
		return { restore: () => ext.restoreContext() };
	}

	readonly #onLost = (e: Event): void => {
		e.preventDefault(); // allow the context to be restored
		this.lost = true;
	};

	readonly #onRestored = (): void => {
		// Three.js re-creates its GL state itself; our job is to upload everything again
		this.noteBuffer.invalidate();
		this.#noteVersion = -1;
		this.pool.clear();
		this.#particleVersion = -1;
		this.#emitter.reset();
		this.#shockVersion = -1;
		this.#noteBuf.needsUpdate = true;
		this.#keyState.needsUpdate = true;
		this.#width = 0;
		this.resize();
		this.lost = false;
	};

	/** Release everything. Safe to call twice. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		Stage.live--;
		Stage.#publishCounts();
		this.#observer?.disconnect();
		this.#observer = null;
		this.canvas.removeEventListener('webglcontextlost', this.#onLost);
		this.canvas.removeEventListener('webglcontextrestored', this.#onRestored);
		this.#bloom?.dispose();
		this.#bloom = null;
		for (const d of this.#disposables) d.dispose();
		this.#disposables.length = 0;
		this.#scene.clear();
		this.#renderer.dispose();
		this.#renderer.forceContextLoss();
		this.#win = null;
	}
}
