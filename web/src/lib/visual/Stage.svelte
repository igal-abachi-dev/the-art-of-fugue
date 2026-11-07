<script lang="ts">
	/**
	 * The stage as a component (T4.1.1): owns one canvas, one Three.js `Stage` and one frame loop, and releases
	 * all of them when it is destroyed. Three.js is imported only here, after mount, so it stays out of the
	 * first page load. `engine` supplies the clock and the notes; `scene` can be changed at any time and is
	 * crossfaded.
	 */
	import { onMount } from 'svelte';
	import type { AmbientLayer } from '../ambient/ambient.js';
	import type { PlaybackEngine } from '../playback/engine.js';
	import { FrameLoop } from '../playback/frameloop.js';
	import { Director } from '../scenes/director.js';
	import TitleCard from '../scenes/TitleCard.svelte';
	import { prefersReducedMotion } from './motion.js';
	import { DEFAULT_SCENE, type SceneConfig } from './scene.js';
	import type { Stage, StageStats } from './stage.js';

	interface Props {
		engine: PlaybackEngine;
		scene?: SceneConfig;
		/**
		 * Let the scene director choose the scene of each piece (`scenes.json`), run the annotation effects and show the
		 * title cards. `scene` is then only the picture before the first piece is known.
		 */
		auto?: boolean;
		/** seconds a scene change takes */
		fade?: number;
		/** pin the quality level (0 best) and do not adapt */
		level?: number;
		/** start at this level and adapt from there (phones start lower) */
		startLevel?: number;
		/** show the performance HUD */
		hud?: boolean;
		/** the MilkDrop layer behind the notes (E6); false never shows it */
		ambient?: boolean;
		/** the loudness bloom; false never draws it */
		bloom?: boolean;
		/** no camera motion and no ambient layer; omit to follow the system's reduced-motion setting */
		reducedMotion?: boolean;
		/** the voices drawn, 0 or 1 for voices 1 to 5 (T7.3.1); omit for all */
		voiceMask?: readonly number[];
		/** mark the subject entries in every scene */
		highlight?: boolean;
		onstage?: (stage: Stage | null) => void;
		/** the ambient layer once it exists (for checks) */
		onambient?: (layer: AmbientLayer | null) => void;
	}

	let {
		engine,
		scene = DEFAULT_SCENE,
		auto = false,
		fade = 0.9,
		level,
		startLevel,
		hud = false,
		ambient = true,
		bloom = true,
		reducedMotion,
		voiceMask,
		highlight = false,
		onstage,
		onambient
	}: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let ambientCanvas = $state<HTMLCanvasElement>();
	let box = $state<HTMLDivElement>();
	let stage: Stage | null = null;
	/** the listener's runtime choices go to the stage; set once it exists */
	let applyChoices: () => void = () => {};
	let syncDirector: () => void = () => {};
	let stats = $state<StageStats | null>(null);
	let failure = $state<string | null>(null);

	onMount(() => {
		let disposed = false;
		let loop: FrameLoop | null = null;
		let timer: ReturnType<typeof setInterval> | undefined;
		let director: Director | null = null;
		let layer: AmbientLayer | null = null;
		let layerAsked = false;
		let lastBg = '';

		(async () => {
			try {
				const { Stage } = await import('./stage.js');
				if (disposed || !canvas) return;
				const s = await Stage.create(canvas, {
					scene,
					level,
					startLevel,
					ambient,
					bloom,
					reducedMotion
				});
				if (disposed) {
					s.dispose();
					return;
				}
				stage = s;
				onstage?.(s);
				syncDirector = () => {
					// "auto" lets each piece pick its scene; turning it off keeps the scene that is chosen
					if (auto && !director) director = new Director(engine, s);
					else if (!auto && director) {
						director.dispose();
						director = null;
						s.setScene(scene, fade);
					}
				};
				applyChoices = () => {
					s.setEffects({ ambient, bloom, reducedMotion: reducedMotion ?? prefersReducedMotion() });
					s.setVoiceMask(voiceMask ?? [1, 1, 1, 1, 1]);
					s.setHighlight(highlight);
				};
				syncDirector();
				applyChoices();
				loop = new FrameLoop(engine.clock);
				loop.subscribe((f) => {
					engine.update(); // piece and bar follow the clock (media events alone do not keep them current)
					director?.step(f);
					const piece = engine.piece;
					const graph = engine.graph;
					const playing = engine.status === 'playing';
					s.listen(graph?.analyser ?? null, graph?.context?.sampleRate ?? 48000, playing, f.dt);
					s.render(f, piece ? engine.window(piece.id) : null);

					// the MilkDrop layer: made the first time a scene shows one, then fed every frame
					if (!layerAsked && s.ambientPreset && s.ambientOpacity > 0.004 && ambientCanvas) {
						layerAsked = true;
						import('../ambient/ambient.js')
							.then(({ AmbientLayer }) => {
								if (disposed || !ambientCanvas) return;
								layer = AmbientLayer.real(ambientCanvas, graph?.context ?? null);
								onambient?.(layer);
							})
							.catch(() => {
								/* no layer: the notes still play */
							});
					}
					if (layer) {
						layer.setContext(graph?.context ?? null);
						layer.setPreset(s.ambientPreset);
						layer.frame({
							analyser: graph?.analyser ?? null,
							playing,
							dt: f.dt,
							opacity: s.ambientOpacity,
							width: canvas?.clientWidth ?? 0,
							height: canvas?.clientHeight ?? 0,
							scale: s.ambientScale
						});
					}
					// a transparent canvas shows the page: give it the scene's background colour
					if (box && s.backgroundCss !== lastBg) {
						lastBg = s.backgroundCss;
						box.style.background = lastBg;
					}
				});
				loop.start();
				if (hud) timer = setInterval(() => (stats = s.stats()), 250);
			} catch (e) {
				failure = e instanceof Error ? e.message : String(e);
			}
		})();

		return () => {
			disposed = true;
			if (timer) clearInterval(timer);
			loop?.stop(); // cancelAnimationFrame
			director?.dispose();
			layer?.dispose();
			onambient?.(null);
			stage?.dispose();
			stage = null;
			onstage?.(null);
		};
	});

	// choices made while running (the effects menu, the voice toggles): the stage is not recreated
	$effect(() => {
		void [ambient, bloom, reducedMotion, voiceMask, highlight];
		applyChoices();
	});
	$effect(() => {
		void auto;
		syncDirector();
	});
	$effect(() => {
		const next = scene;
		const seconds = fade;
		if (!auto) stage?.setScene(next, seconds);
	});
</script>

<div class="stage" bind:this={box}>
	<canvas class="ambient" bind:this={ambientCanvas} aria-hidden="true"></canvas>
	<canvas class="notes" bind:this={canvas}></canvas>
	{#if auto}<TitleCard {engine} />{/if}
	{#if failure}<p class="failure">The visuals could not start: {failure}</p>{/if}
	{#if hud && stats}
		<pre class="hud">{stats.fps.toFixed(0)} fps  level {stats.level}  dpr {stats.dpr.toFixed(2)}
cpu {stats.cpuMsMean.toFixed(2)} ms  p95 {stats.cpuMsP95.toFixed(2)} ms
draws {stats.drawCalls}  tris {stats.triangles}
geo {stats.geometries}  tex {stats.textures}  prog {stats.programs}
notes written {stats.notesWritten}  particles {stats.particlesEmitted}
bloom {stats.bloom.toFixed(2)}  ambient {stats.ambient.toFixed(2)}{stats.lost
				? '\nCONTEXT LOST'
				: ''}</pre>
	{/if}
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		background: var(--bg, #05060a);
		/* the canvases' z-index stays inside the stage: the page's controls remain on top */
		isolation: isolate;
	}
	canvas {
		display: block;
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	/* the MilkDrop layer sits under the notes; the notes' canvas is transparent while it shows */
	.ambient {
		z-index: 0;
		pointer-events: none;
	}
	.notes {
		z-index: 1;
	}
	.hud {
		position: absolute;
		top: 8px;
		left: 8px;
		margin: 0;
		padding: 6px 8px;
		font:
			11px/1.35 ui-monospace,
			monospace;
		color: #9fd;
		background: #000a;
		pointer-events: none;
	}
	.failure {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: #f99;
		margin: 0;
	}
</style>
