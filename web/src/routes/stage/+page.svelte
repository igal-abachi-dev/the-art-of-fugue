<script lang="ts">
	/**
	 * Stage page (E4): the Three.js visuals driven by the real playback engine. A stand-in for the main page
	 * (E7), kept for developing scenes. `?hud` shows the performance HUD, `?q=0..5` pins the quality level,
	 * `?scene=auto` lets the scene director pick the scene of each piece (E5), `?scene=void|lanes|ember` fixes one, `?spectro` shows the recording's spectrogram with the notes on it, `?ambient=0` and `?bloom=0` turn the MilkDrop layer and the loudness bloom off (E6), `?reduced` acts as the system's reduced-motion setting (no camera motion, no ambient layer), `?score` shows the score overlay (`&notation=pdf` for the PDF's own engraving instead of Verovio's, the default), `?codec=opus|aac` forces a source.
	 */
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { findPiece, pieceSlug, playOrder } from '#lib/playback/links.js';
	import { openSession, type Session } from '#lib/playback/session.js';
	import Notation from '#lib/notation/Notation.svelte';
	import Spectrogram from '#lib/spectro/Spectrogram.svelte';
	import { SCENES } from '#lib/visual/presets.js';
	import type { AmbientLayer } from '#lib/ambient/ambient.js';
	import Stage from '#lib/visual/Stage.svelte';
	import type { Stage as StageObject } from '#lib/visual/stage.js';

	let audioEl: HTMLAudioElement;
	let session = $state<Session | null>(null);
	let failure = $state<string | null>(null);
	let sceneName = $state('void');
	let pieceSel = $state('');
	let barSel = $state('');
	let hud = $state(false);
	let score = $state(false);
	let spectro = $state(false);
	let notationBase = $state('/data/notation-verovio/');
	let level = $state<number | undefined>(undefined);
	let stageObj: StageObject | null = null;
	let ambientObj: AmbientLayer | null = null;
	let ambientOn = $state(true);
	let bloomOn = $state(true);
	let reduced = $state<boolean | undefined>(undefined);

	const fmt = (s: number) => {
		const m = Math.floor(s / 60);
		return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
	};

	onMount(() => {
		const q = new URLSearchParams(location.search);
		hud = q.has('hud');
		score = q.has('score');
		spectro = q.has('spectro');
		ambientOn = q.get('ambient') !== '0';
		bloomOn = q.get('bloom') !== '0';
		if (q.has('reduced')) reduced = q.get('reduced') !== '0';
		if (q.get('notation') === 'pdf') notationBase = '/data/notation/';
		const lv = q.get('q');
		if (lv !== null && /^\d$/.test(lv)) level = Number(lv);
		const sc = q.get('scene');
		if (sc && (sc === 'auto' || sc in SCENES)) sceneName = sc;
		let disposed = false;
		let s: Session | null = null;
		openSession(audioEl)
			.then((opened) => {
				if (disposed) return opened.dispose();
				s = opened;
				session = opened;
			})
			.catch((e) => (failure = e instanceof Error ? e.message : String(e)));
		(window as unknown as { __stagePage: unknown }).__stagePage = {
			get session() {
				return s;
			},
			get stage() {
				return stageObj;
			},
			get ambient() {
				return ambientObj;
			},
			setScene: (n: string) => (sceneName = n)
		};
		return () => {
			disposed = true;
			s?.dispose();
			session = null;
		};
	});

	function goPiece() {
		if (!session) return;
		const piece = findPiece(session.manifest, pieceSel);
		if (!piece) return;
		const bar = barSel.trim() === '' ? undefined : Number(barSel);
		failure = session.engine.seekPlace({ piece, bar })
			? null
			: `no bar ${barSel} in ${piece.title}`;
	}
</script>

<svelte:head><title>Stage</title></svelte:head>

<audio bind:this={audioEl} preload="metadata"></audio>

<main>
	{#if session}
		<div class="canvas">
			{#key `${sceneName === 'auto'}${ambientOn}${bloomOn}${reduced}`}
				<Stage
					engine={session.engine}
					scene={SCENES[sceneName] ?? SCENES.void}
					auto={sceneName === 'auto'}
					{hud}
					{level}
					ambient={ambientOn}
					bloom={bloomOn}
					reducedMotion={reduced}
					onstage={(s) => (stageObj = s)}
					onambient={(a) => (ambientObj = a)}
				/>
			{/key}
		</div>
		{#if spectro}
			<div class="spectro"><Spectrogram engine={session.engine} /></div>
		{/if}
		{#if score}
			<div class="score"><Notation engine={session.engine} base={notationBase} /></div>
		{/if}
		{@const tr = session.transport}
		<nav>
			{#if tr.status === 'ready' || tr.status === 'loading' || tr.status === 'idle'}
				<button id="start" onclick={() => tr.engine.start()}>Start</button>
			{:else}
				<button id="toggle" onclick={() => tr.engine.toggle()}
					>{tr.isPlaying ? 'Pause' : 'Play'}</button
				>
			{/if}
			<button onclick={() => tr.engine.step(-1)} aria-label="previous piece">⏮</button>
			<button onclick={() => tr.engine.step(1)} aria-label="next piece">⏭</button>
			<button onclick={() => tr.engine.seekBy(-10)}>−10 s</button>
			<button onclick={() => tr.engine.seekBy(10)}>+10 s</button>
			<input
				id="seek"
				type="range"
				min="0"
				max={tr.duration}
				step="0.1"
				value={tr.position}
				oninput={(e) => tr.engine.seek(Number(e.currentTarget.value))}
			/>
			<span class="time">{fmt(tr.position)} / {fmt(tr.duration)}</span>
			<select id="piece" bind:value={pieceSel}>
				<option value="">piece…</option>
				{#each playOrder(session.manifest) as p (p.id)}
					<option value={pieceSlug(p)}>{p.title}</option>
				{/each}
			</select>
			<input id="bar" placeholder="bar" size="3" bind:value={barSel} />
			<button id="go" onclick={goPiece}>Go</button>
			<select id="scene" bind:value={sceneName}>
				{#each ['auto', ...Object.keys(SCENES)] as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
			<span class="state">{tr.pieceId ?? '—'} · bar {tr.bar ?? '—'} · {tr.status}</span>
			<label><input id="ambient" type="checkbox" bind:checked={ambientOn} /> ambient</label>
			<label><input id="bloom" type="checkbox" bind:checked={bloomOn} /> bloom</label>
			<label><input id="score" type="checkbox" bind:checked={score} /> score</label>
			<label><input id="spectro" type="checkbox" bind:checked={spectro} /> spectrogram</label>
			<a id="to-bench" href={resolve('/bench')}>bench</a>
		</nav>
	{:else if failure}
		<p class="err">{failure}</p>
	{:else}
		<p>loading…</p>
	{/if}
	{#if failure && session}<p class="err floating">{failure}</p>{/if}
</main>

<style>
	:global(html, body) {
		margin: 0;
		background: var(--bg, #05060a);
		color: var(--fg, #e8e8ee);
		overflow: hidden;
	}
	main {
		position: fixed;
		inset: 0;
		font:
			13px/1.4 system-ui,
			sans-serif;
	}
	.canvas {
		position: absolute;
		inset: 0;
	}
	.spectro {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 46vh;
		opacity: 0.95;
		pointer-events: none;
	}
	.score {
		position: absolute;
		left: 50%;
		bottom: 3.2rem;
		width: min(94vw, 1100px);
		opacity: 0.94;
		transform: translateX(-50%);
		pointer-events: none;
	}
	nav {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: linear-gradient(transparent, #000c);
	}
	nav input[type='range'] {
		flex: 1;
		min-width: 8rem;
	}
	.time,
	.state {
		color: var(--fg-dim, #9aa0ad);
		font-variant-numeric: tabular-nums;
	}
	.err {
		color: #f88;
		padding: 1rem;
	}
	.floating {
		position: absolute;
		top: 0;
		right: 0;
		margin: 0;
	}
</style>
