<script lang="ts">
	/**
	 * The interface (E7): the stage filling the window with the controls over it. It owns the `Player` (state and
	 * actions), the keyboard, the fading of the controls, fullscreen, taps on the stage, the spinner and error banner, and
	 * the start screen. The controls fade after a few seconds of inactivity while playing and come back on any movement,
	 * key or touch; they never fade while paused, while the pointer or the keyboard focus is in them, or while a panel is
	 * open.
	 */
	import { onMount, untrack } from 'svelte';
	import type { Session } from '../playback/session.js';
	import Notation from '../notation/Notation.svelte';
	import Spectrogram from '../spectro/Spectrogram.svelte';
	import Stage from '../visual/Stage.svelte';
	import type { Stage as StageObject } from '../visual/stage.js';
	import { SCENES } from '../visual/presets.js';
	import Controls from './Controls.svelte';
	import { actionFor } from './keys.js';
	import Panels from './Panels.svelte';
	import { PHONE_START_LEVEL } from './device.js';
	import { Player } from './player.svelte.js';
	import StartScreen from './StartScreen.svelte';

	interface Props {
		session: Session;
	}
	let { session }: Props = $props();

	// one session for the page's life: the player is made once from it
	const player = untrack(() => new Player(session));
	const tr = player.transport;
	const s = $derived(player.settings);
	/** the page was opened on a bar: no welcome screen, the music plays at once (where the browser lets it) */
	const linked = player.linked;

	let stageObj: StageObject | null = null;
	let root = $state<HTMLElement>();
	let chrome = $state<HTMLDivElement>();
	/** the height of the control bar: the panels stand on it and the score sits above it */
	let barH = $state(150);
	let lastActive = performance.now();
	let hidden = $state(false);
	let overChrome = false;
	let fullscreen = $state(false);
	let tapTimer: ReturnType<typeof setTimeout> | null = null;
	let lastTap = 0;

	const HIDE_AFTER_MS = 3000;

	function poke() {
		lastActive = performance.now();
		hidden = false;
	}

	/** the key press, or the time of the pointer press, that started the music: the rest of that gesture does nothing else */
	let startedKey: KeyboardEvent | null = null;
	let startedAt = 0;
	let pressPending = 0;
	const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock']);
	const RECENT_MS = 1500;
	const recent = (t: number) => t > 0 && performance.now() - t < RECENT_MS;

	/**
	 * While the welcome shows, or while the browser is keeping the sound off, the first click, tap or key starts the music: the
	 * gesture is what the browser wants, and iOS wants `play()` inside it. That touch does nothing else: not the play button's
	 * own press (which would pause it again), not the Space that is still held down, not the stage's tap.
	 */
	function touch(e: Event) {
		const starting = !player.begun || player.waiting;
		if (e.type === 'pointerdown' && !starting) pressPending = 0; // a new press: nothing of an earlier one is left over
		if (!starting) return;
		if (e instanceof KeyboardEvent) {
			if (MODIFIERS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
			e.preventDefault();
			startedKey = e;
			startedAt = performance.now();
		} else if ((e.target as Element | null)?.closest?.('a')) return;
		else pressPending = performance.now();
		void player.begin();
	}
	function swallowClick(e: Event) {
		if (recent(pressPending)) {
			pressPending = 0;
			e.stopPropagation();
			e.preventDefault();
		}
	}

	function onkey(e: KeyboardEvent) {
		poke();
		if (e === startedKey || (e.repeat && recent(startedAt))) return;
		if (!player.begun) return;
		const a = actionFor({
			key: e.key,
			shiftKey: e.shiftKey,
			ctrlKey: e.ctrlKey,
			altKey: e.altKey,
			metaKey: e.metaKey,
			target: e.target as HTMLInputElement | null
		});
		if (!a) return;
		e.preventDefault();
		player.run(a);
	}

	async function toggleFullscreen() {
		const el = root;
		if (!el) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else if (el.requestFullscreen) await el.requestFullscreen();
			else player.say('Fullscreen is not available in this browser');
		} catch {
			player.say('Fullscreen was refused');
		}
	}
	player.onfullscreen = () => void toggleFullscreen();

	/** the stage under the controls: a click plays or pauses, a double click goes fullscreen; on touch, taps show the
	 * controls and a double tap on either side jumps 10 s */
	function stagePointer(e: PointerEvent) {
		if (e.target !== e.currentTarget || !player.begun || recent(pressPending)) return;
		const now = performance.now();
		const double = now - lastTap < 320;
		lastTap = double ? 0 : now;
		if (tapTimer) clearTimeout(tapTimer);
		tapTimer = null;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width;
		if (e.pointerType === 'mouse') {
			if (double) void toggleFullscreen();
			else tapTimer = setTimeout(() => player.toggle(), 260);
			return;
		}
		if (double) {
			if (x < 0.35) {
				player.seekBy(-10);
				player.say('−10 s');
			} else if (x > 0.65) {
				player.seekBy(10);
				player.say('+10 s');
			} else player.toggle();
			return;
		}
		tapTimer = setTimeout(() => (hidden ? poke() : (hidden = true)), 280);
	}

	onMount(() => {
		// for the browser checks (scripts/player-check.mjs)
		(window as unknown as { __player: unknown }).__player = {
			player,
			mountedAt: performance.now(),
			get stage() {
				return stageObj;
			},
			get chrome() {
				return chrome;
			}
		};
		const timer = setInterval(() => {
			if (stageObj) player.observeFrames(stageObj.governor.fps, 0.4);
			const playing = tr.isPlaying;
			const focused = !!chrome?.querySelector(':focus-visible');
			hidden =
				s.autoHide &&
				player.begun &&
				playing &&
				!player.panel &&
				!overChrome &&
				!focused &&
				performance.now() - lastActive > HIDE_AFTER_MS;
		}, 400);
		const fs = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', fs);
		window.addEventListener('keydown', touch, true);
		window.addEventListener('pointerdown', touch, true);
		window.addEventListener('click', swallowClick, true);
		return () => {
			clearInterval(timer);
			document.removeEventListener('fullscreenchange', fs);
			window.removeEventListener('keydown', touch, true);
			window.removeEventListener('pointerdown', touch, true);
			window.removeEventListener('click', swallowClick, true);
			if (tapTimer) clearTimeout(tapTimer);
			player.dispose();
		};
	});

	// the page title says what is playing
	$effect(() => {
		const p = session.manifest.pieces.find((x) => x.id === tr.pieceId);
		document.title = `${tr.isPlaying ? '▶ ' : ''}${p ? `${p.title} — ` : ''}The Art of Fugue`;
	});
</script>

<svelte:window onkeydown={onkey} onpointermove={poke} onpointerdown={poke} />

<main
	class="app"
	bind:this={root}
	class:nocursor={hidden}
	class:calm={player.calm}
	style:--bar-h="{barH}px"
	style:--shelf="{hidden ? 0 : barH}px"
>
	<div class="stage">
		<Stage
			engine={session.engine}
			scene={SCENES[s.scene] ?? SCENES.void}
			auto={s.scene === 'auto'}
			startLevel={player.phone ? PHONE_START_LEVEL : undefined}
			ambient={s.ambient && player.ambientOk}
			bloom={s.bloom}
			reducedMotion={player.calm}
			voiceMask={player.mask}
			highlight={s.highlight}
			onstage={(st) => (stageObj = st)}
		/>
	</div>
	{#if s.spectro}
		<div class="spectro"><Spectrogram engine={session.engine} /></div>
	{/if}
	{#if s.score}
		<div class="score">
			{#key s.notation}
				<Notation
					engine={session.engine}
					base={s.notation === 'pdf' ? '/data/notation/' : '/data/notation-verovio/'}
				/>
			{/key}
		</div>
	{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="hit" onpointerup={stagePointer}></div>

	{#if tr.spinner}
		<div class="spinner" role="status" aria-label="Loading the audio"><span></span></div>
	{/if}
	{#if tr.error && player.begun}
		<div class="banner" role="alert">
			<span>{tr.error}</span>
			<button type="button" onclick={() => session.engine.reload()}>Try again</button>
		</div>
	{/if}

	<div
		class="chrome"
		role="presentation"
		class:hidden
		bind:this={chrome}
		onpointerenter={() => (overChrome = true)}
		onpointerleave={() => (overChrome = false)}
		inert={hidden || !player.begun ? true : undefined}
	>
		<Panels {player} />
		<div class="barbox" bind:clientHeight={barH}>
			<Controls {player} {fullscreen} />
		</div>
	</div>

	<div class="toast" aria-hidden="true" class:show={!!player.toast}>{player.toast}</div>
	<div class="sr" aria-live="polite" aria-atomic="true">{player.announcement}</div>

	{#if player.waiting}
		<div class="waiting" role="status">Click, tap or press Space to play</div>
	{/if}

	<StartScreen {player} {linked} />
</main>

<style>
	.app {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--bg, #05060a);
		-webkit-user-select: none;
		user-select: none;
	}
	.app.nocursor .hit {
		cursor: none;
	}
	/* the browser keeps the sound off until the page is touched: say so, quietly */
	.waiting {
		position: absolute;
		left: 50%;
		top: 42%;
		z-index: 25;
		transform: translateX(-50%);
		padding: 10px 20px;
		border-radius: 22px;
		background: rgb(5 6 10 / 0.72);
		border: 1px solid rgb(255 255 255 / 0.25);
		color: var(--fg, #e8e8ee);
		font:
			600 15px system-ui,
			sans-serif;
		pointer-events: none;
		animation: breathe 2.4s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.55;
		}
	}
	.stage,
	.hit {
		position: absolute;
		inset: 0;
	}
	/* over the stage, under the clicks; the score rides above the control bar and drops when it fades */
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
		bottom: calc(var(--shelf, 0px) + 10px);
		width: min(94vw, 1100px);
		max-height: calc(100% - var(--shelf, 0px) - 20px);
		opacity: 0.94;
		transform: translateX(-50%);
		pointer-events: none;
		transition: bottom 0.35s;
	}
	.hit {
		z-index: 5;
		touch-action: manipulation;
	}
	.chrome {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		/* above the toast (11): an open menu is not to be written over */
		z-index: 12;
		pointer-events: none;
		transition: opacity 0.35s;
	}
	.chrome > :global(*) {
		pointer-events: auto;
	}
	.chrome.hidden {
		opacity: 0;
		pointer-events: none;
	}
	.chrome.hidden > :global(*) {
		pointer-events: none;
	}
	.spinner {
		position: absolute;
		inset: 0;
		z-index: 8;
		display: grid;
		place-items: center;
		pointer-events: none;
	}
	.spinner span {
		width: 38px;
		height: 38px;
		border: 3px solid rgb(255 255 255 / 0.25);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	/* less motion, by the system's setting or the listener's: nothing in the interface slides or fades; the spinner is
	   all that moves, slowly, because it says that something is loading */
	.app.calm :global(*),
	.app.calm :global(*::before),
	.app.calm :global(*::after) {
		transition: none !important;
		scroll-behavior: auto !important;
	}
	.app.calm .spinner span {
		animation-duration: 3s;
	}
	.banner {
		position: absolute;
		z-index: 12;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 10px 16px;
		border-radius: 10px;
		background: rgb(60 20 14 / 0.95);
		color: #ffd9d0;
		font:
			14px system-ui,
			sans-serif;
	}
	.banner button {
		height: 32px;
		padding: 0 14px;
		border-radius: 8px;
		border: 1px solid rgb(255 255 255 / 0.4);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.toast {
		position: absolute;
		z-index: 11;
		left: 50%;
		bottom: 150px;
		transform: translateX(-50%);
		padding: 6px 14px;
		border-radius: 16px;
		background: rgb(5 6 10 / 0.88);
		color: var(--fg, #e8e8ee);
		font:
			13px system-ui,
			sans-serif;
		opacity: 0;
		transition: opacity 0.2s;
		pointer-events: none;
	}
	.toast.show {
		opacity: 1;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
