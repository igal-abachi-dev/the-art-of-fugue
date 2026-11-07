<script lang="ts">
	/**
	 * Playback bench (E3): a plain page to exercise the engine in a real browser. Start, play/pause, seek by
	 * piece and bar, speed, volume, and a 2D piano roll driven by the master clock and the note-window
	 * query. It is the stand-in for the real stage (E4) and interface (E7) and is not linked from anywhere.
	 */
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import type { Manifest } from '#lib/data/manifest.js';
	import type { PlaybackEngine } from '#lib/playback/engine.js';
	import { FrameLoop } from '#lib/playback/frameloop.js';
	import { findPiece, pieceSlug, playOrder } from '#lib/playback/links.js';
	import { openSession, type Session } from '#lib/playback/session.js';
	import type { Transport } from '#lib/playback/transport.svelte.js';

	let audioEl: HTMLAudioElement;
	let canvas = $state<HTMLCanvasElement>();
	let manifest: Manifest | null = $state(null);
	let transport: Transport | null = $state(null);
	let failure = $state<string | null>(null);
	let pieceSel = $state('');
	let barSel = $state('');
	let hud = $state({ t: 0, raw: 0, fps: 0, active: 0, maxStep: 0, maxDev: 0, snaps: 0 });

	const fmt = (s: number) => {
		const m = Math.floor(s / 60);
		return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
	};

	const COLORS = ['#f2c14e', '#78c0e0', '#e86a92', '#9ad17a', '#c49bf0'];

	onMount(() => {
		let loop: FrameLoop | null = null;
		let eng: PlaybackEngine | null = null;
		let session: Session | null = null;
		let disposed = false;

		(async () => {
			try {
				// ?codec=opus or ?codec=aac forces one source, to test both files in one browser
				const opened = await openSession(audioEl);
				if (disposed) return opened.dispose();
				session = opened;
				manifest = opened.manifest;
				eng = opened.engine;
				const tr = opened.transport;
				transport = tr;

				loop = new FrameLoop(eng.clock);
				await tick(); // the canvas is rendered once the transport exists
				const ctx = canvas!.getContext('2d')!;
				let prevT = NaN;
				let frames = 0;
				let fpsStart = performance.now();
				let hudAt = 0;
				const stats = { maxStep: 0, maxDev: 0 };
				loop.subscribe((f) => {
					const e = eng!;
					// clock quality in this browser: biggest step beyond real time, biggest distance from the element
					if (!Number.isNaN(prevT) && e.status === 'playing' && !f.discontinuity && f.dt > 0) {
						stats.maxStep = Math.max(stats.maxStep, Math.abs(f.t - prevT - f.dt * e.rate));
						stats.maxDev = Math.max(stats.maxDev, Math.abs(f.t - e.clock.rawNow()));
					}
					prevT = f.t;
					frames++;
					if (f.wall - fpsStart >= 1000) {
						hud.fps = Math.round((frames * 1000) / (f.wall - fpsStart));
						frames = 0;
						fpsStart = f.wall;
					}
					draw(ctx, e, f.t);
					if (f.wall - hudAt > 100) {
						hudAt = f.wall;
						hud.t = f.t;
						hud.raw = e.clock.rawNow();
						hud.maxStep = stats.maxStep;
						hud.maxDev = stats.maxDev;
						hud.snaps = e.clock.snaps;
					}
				});
				loop.start();
				(window as unknown as { __bench: unknown }).__bench = {
					engine: eng,
					transport: tr,
					stats,
					hud
				};
			} catch (e) {
				failure = e instanceof Error ? e.message : String(e);
			}
		})();

		return () => {
			disposed = true;
			loop?.stop();
			session?.dispose();
		};
	});

	function draw(ctx: CanvasRenderingContext2D, e: PlaybackEngine, t: number) {
		const cv = canvas!;
		const w = (cv.width = cv.clientWidth);
		const h = (cv.height = cv.clientHeight);
		ctx.fillStyle = '#05060a';
		ctx.fillRect(0, 0, w, h);
		const AHEAD = 4;
		const BEHIND = 1.5;
		const x = (s: number) => ((s - (t - BEHIND)) / (AHEAD + BEHIND)) * w;
		ctx.fillStyle = '#ffffff22';
		ctx.fillRect(x(t), 0, 1, h);
		const p = e.piece;
		const win = p ? e.window(p.id) : null;
		hud.active = 0;
		if (!win) return;
		win.query(t, AHEAD, BEHIND);
		const n = win.notes;
		const y = (pitch: number) => h - ((pitch - 24) / (96 - 24)) * h;
		const rect = (i: number, alpha: string) => {
			ctx.fillStyle = (COLORS[n.voice[i] - 1] ?? '#ccc') + alpha;
			ctx.fillRect(x(n.t_on[i]), y(n.pitch[i]) - 3, Math.max(2, x(n.t_off[i]) - x(n.t_on[i])), 6);
		};
		for (let k = 0; k < win.endedCount; k++) rect(win.ended[k], '66');
		for (let k = 0; k < win.activeCount; k++) rect(win.active[k], 'ff');
		for (let i = win.upcomingStart; i < win.upcomingEnd; i++) rect(i, 'aa');
		hud.active = win.activeCount;
	}

	function goPiece() {
		if (!manifest || !transport) return;
		const piece = findPiece(manifest, pieceSel);
		if (!piece) return;
		const bar = barSel.trim() === '' ? undefined : Number(barSel);
		if (!transport.engine.seekPlace({ piece, bar })) failure = `no bar ${barSel} in ${piece.title}`;
		else failure = null;
	}
</script>

<svelte:head><title>Playback bench</title></svelte:head>

<main>
	<audio bind:this={audioEl} preload="metadata"></audio>
	<h1>
		Playback bench <a id="to-stage" href={resolve('/stage')} style="font-size:0.5em">stage</a>
	</h1>
	{#if failure}<p class="err">{failure}</p>{/if}
	{#if transport && manifest}
		{@const tr = transport}
		<div class="row">
			{#if tr.status === 'ready' || tr.status === 'loading' || tr.status === 'idle'}
				<button id="start" onclick={() => tr.engine.start()}>Start</button>
			{:else}
				<button id="toggle" onclick={() => tr.engine.toggle()}
					>{tr.isPlaying ? 'Pause' : 'Play'}</button
				>
			{/if}
			<button onclick={() => tr.engine.step(-1)}>⏮</button>
			<button onclick={() => tr.engine.step(1)}>⏭</button>
			<button onclick={() => tr.engine.seekBy(-10)}>−10 s</button>
			<button onclick={() => tr.engine.seekBy(10)}>+10 s</button>
			<label
				>speed
				<input
					type="range"
					min="0.5"
					max="1.5"
					step="0.05"
					value={tr.rate}
					oninput={(e) => tr.engine.setRate(Number(e.currentTarget.value))}
				/>
				{tr.rate.toFixed(2)}×
			</label>
			<label
				>volume
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value="1"
					oninput={(e) => tr.engine.setVolume(Number(e.currentTarget.value))}
				/>
			</label>
		</div>
		<div class="row">
			<input
				id="seek"
				type="range"
				min="0"
				max={tr.duration}
				step="0.1"
				value={tr.position}
				oninput={(e) => tr.engine.seek(Number(e.currentTarget.value))}
				style="flex:1"
			/>
			<span>{fmt(tr.position)} / {fmt(tr.duration)}</span>
		</div>
		<div class="row">
			<select bind:value={pieceSel}>
				<option value="">piece…</option>
				{#each playOrder(manifest) as p (p.id)}
					<option value={pieceSlug(p)}>{p.title}</option>
				{/each}
			</select>
			<input placeholder="bar" size="4" bind:value={barSel} />
			<button id="go" onclick={goPiece}>Go</button>
		</div>
		<pre id="hud">status {tr.status}{tr.spinner ? ' (spinner)' : ''}  source {tr.engine.source
				?.type}  loaded {(tr.loaded * 100).toFixed(1)} %
piece {tr.pieceId ?? '—'}  bar {tr.bar ?? '—'}{tr.pass > 1
				? ` (pass ${tr.pass})`
				: ''}  active notes {hud.active}  {hud.fps} fps
clock {hud.t.toFixed(3)}  element {hud.raw.toFixed(3)}  max step error {(
				hud.maxStep * 1000
			).toFixed(1)} ms  max distance from element {(hud.maxDev * 1000).toFixed(
				1
			)} ms  snaps {hud.snaps}
{tr.error ?? ''}</pre>
		<canvas bind:this={canvas}></canvas>
	{:else if !failure}
		<p>loading…</p>
	{/if}
</main>

<style>
	main {
		font:
			14px/1.4 system-ui,
			sans-serif;
		background: #0b0c10;
		color: #ddd;
		min-height: 100vh;
		padding: 1rem;
		box-sizing: border-box;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		margin: 0.5rem 0;
	}
	canvas {
		width: 100%;
		height: 320px;
		display: block;
		border: 1px solid #222;
	}
	pre {
		margin: 0.5rem 0;
		color: #9ab;
	}
	.err {
		color: #f77;
	}
</style>
