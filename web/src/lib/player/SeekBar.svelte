<script lang="ts">
	/**
	 * The seek bar (T7.2.1): the whole recording, a tick at the start of every piece, what is buffered, the loop as a band,
	 * and a tooltip with the piece, the bar and the time under the pointer. While dragging, the stage follows the pointer
	 * (every effect is a function of the playhead) and the audio seeks at most every 100 ms and finally on release; the
	 * playhead snaps to the start of a piece within a few pixels unless Shift is held. It is a slider for assistive
	 * technology; its keys are the global shortcuts (`keys.ts`).
	 */
	import { onMount } from 'svelte';
	import { VOICE_COLOURS } from '../visual/palette.js';
	import { drawOverview, loadOverview, type Overview } from './overview.js';
	import type { Player } from './player.svelte.js';
	import {
		bufferedFractions,
		describeTime,
		pieceTicks,
		snapToPieceStart,
		timeAtPixel
	} from './seekmath.js';

	interface Props {
		player: Player;
	}
	let { player }: Props = $props();

	let track = $state<HTMLDivElement>();
	let hoverX = $state<number | null>(null);
	let dragging = $state(false);
	let dragT = $state(0);
	let lastSeekAt = 0;
	let lastSeekT = -1;
	/** Alt + drag marks a loop instead of seeking: where it started */
	let loopFrom: number | null = $state(null);
	let buffered = $state<[number, number][]>([]);
	/** the overview strip: loudness and the voices' contours (absent if the file is, the bar works without it) */
	let overview = $state<Overview | null>(null);
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let height = $state(0);
	onMount(() => {
		let gone = false;
		void loadOverview().then((o) => {
			if (!gone) overview = o;
		});
		return () => (gone = true);
	});
	// the strip is drawn again only when its size, its data or the voice buttons change (the playhead is a DOM element)
	$effect(() => {
		const c = canvas;
		const o = overview;
		const mask = player.mask;
		const w = width;
		const h = height;
		if (!c || !o || w < 4 || h < 4) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		c.width = Math.round(w * dpr);
		c.height = Math.round(h * dpr);
		const ctx = c.getContext('2d');
		if (!ctx) return;
		drawOverview(ctx, o, c.width, c.height, {
			played: 1,
			voiceColours: VOICE_COLOURS,
			mask,
			wavePlayed: 'rgb(120 150 190 / 0.55)',
			waveToCome: 'rgb(120 150 190 / 0.55)',
			pixelRatio: dpr
		});
	});

	const tr = $derived(player.transport);
	const duration = $derived(tr.duration || player.manifest.duration || 0);
	const shown = $derived(dragging ? dragT : tr.position);
	const ticks = $derived(pieceTicks(player.manifest, duration));
	/** a piece's number is written on its tick only where the next tick leaves room for it */
	const labelled = $derived(
		ticks.map((t, i) => {
			const next = ticks[i + 1]?.f ?? 1;
			return { ...t, show: (next - t.f) * width > t.short.length * 6.4 + 10 };
		})
	);
	const f = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0);

	// the buffered ranges change slowly: read them with the position
	$effect(() => {
		void tr.position;
		buffered = bufferedFractions(player.engine.element.buffered, duration);
	});

	const hoverT = $derived.by(() => {
		if (hoverX === null || !track) return null;
		return timeAtPixel(hoverX, track.clientWidth, duration);
	});
	const tip = $derived(
		hoverT === null ? null : describeTime(player.manifest, dragging ? dragT : hoverT)
	);
	const text = $derived(describeTime(player.manifest, tr.position).text);

	function timeAt(e: PointerEvent): number {
		const r = track!.getBoundingClientRect();
		const t = timeAtPixel(e.clientX - r.left, r.width, duration);
		return e.shiftKey ? t : snapToPieceStart(player.manifest, t, r.width, duration);
	}

	function down(e: PointerEvent) {
		if (e.button !== 0 || !track || !(duration > 0)) return;
		track.setPointerCapture(e.pointerId);
		dragging = true;
		dragT = timeAt(e);
		loopFrom = e.altKey ? dragT : null;
		if (loopFrom === null) scrub(true);
	}
	function move(e: PointerEvent) {
		if (!track) return;
		hoverX = e.clientX - track.getBoundingClientRect().left;
		if (dragging) {
			dragT = timeAt(e);
			if (loopFrom === null) scrub(false);
		}
	}
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragT = timeAt(e);
		dragging = false;
		if (track?.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
		if (loopFrom !== null) {
			if (player.setLoop(loopFrom, dragT)) player.say('Loop set (snapped to bars)');
			else player.say('The loop would be too short');
			loopFrom = null;
		} else {
			player.seekTo(dragT);
			lastSeekT = dragT;
		}
		if (e.pointerType !== 'mouse') hoverX = null;
	}
	/** the audio follows the pointer at most every 100 ms; the stage follows with it */
	function scrub(first: boolean) {
		const now = performance.now();
		if (!first && now - lastSeekAt < 100) return;
		if (dragT === lastSeekT) return;
		lastSeekAt = now;
		lastSeekT = dragT;
		player.seekTo(dragT);
	}
	function leave() {
		if (!dragging) hoverX = null;
	}
</script>

<div
	class="seek"
	role="slider"
	tabindex="0"
	aria-label="Position in the recording"
	aria-orientation="horizontal"
	aria-valuemin={0}
	aria-valuemax={Math.round(duration)}
	aria-valuenow={Math.round(tr.position)}
	aria-valuetext={text}
	data-testid="seek"
	bind:this={track}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onpointerleave={leave}
>
	<canvas class="overview" bind:this={canvas} bind:clientWidth={width} bind:clientHeight={height}
	></canvas>
	<div class="rail">
		{#each buffered as [a, b], i (i)}
			<span class="buffered" style="left:{a * 100}%;width:{(b - a) * 100}%"></span>
		{/each}
		{#if player.region}
			<span
				class="loop"
				style="left:{f(player.region.a) * 100}%;width:{(f(player.region.b) - f(player.region.a)) *
					100}%"
			></span>
		{/if}
		{#if loopFrom !== null && dragging}
			<span
				class="loop"
				style="left:{f(Math.min(loopFrom, dragT)) * 100}%;width:{Math.abs(f(dragT) - f(loopFrom)) *
					100}%"
			></span>
		{/if}
		{#if player.pendingA !== null}
			<span class="mark" style="left:{f(player.pendingA) * 100}%"></span>
		{/if}
		<span class="todo" style="left:{f(shown) * 100}%"></span>
		{#each labelled as t (t.title)}
			<span class="tick" style="left:{t.f * 100}%"
				>{#if t.show}<i>{t.short}</i>{/if}</span
			>
		{/each}
	</div>
	{#if hoverX !== null && !dragging}<span class="cursor" style="left:{hoverX}px"></span>{/if}
	<span class="thumb" class:active={dragging} style="left:{f(shown) * 100}%"></span>
	{#if tip && hoverX !== null}
		<span class="tip" style="left:clamp(90px, {hoverX}px, calc(100% - 90px))">{tip.text}</span>
	{/if}
</div>

<style>
	/* The overview strip, after the track overview of a DJ program: a recessed window with the whole recording in it. */
	.seek {
		position: relative;
		height: 52px;
		margin: 6px 0 8px;
		border-radius: 5px;
		cursor: pointer;
		touch-action: none;
		outline-offset: 2px;
		-webkit-tap-highlight-color: transparent;
		background: linear-gradient(#05060a, #0b0d12);
		box-shadow:
			inset 0 1px 3px #000,
			inset 0 0 0 1px rgb(0 0 0 / 0.9),
			0 1px 0 rgb(255 255 255 / 0.1);
	}
	.overview {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border-radius: 5px;
	}
	.rail {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border-radius: 5px;
		pointer-events: none;
	}
	.rail span {
		position: absolute;
		top: 0;
		height: 100%;
	}
	.buffered {
		top: auto !important;
		bottom: 0;
		height: 3px !important;
		background: rgb(138 180 255 / 0.55);
	}
	/* what is still to come is dimmed, as the unplayed part of a DJ overview is */
	.todo {
		right: 0;
		background: rgb(5 6 10 / 0.5);
	}
	/* a piece starts: a hairline with its number */
	.tick {
		width: 1px;
		background: rgb(255 255 255 / 0.22);
	}
	.tick i {
		position: absolute;
		top: 2px;
		left: 3px;
		padding: 1px 3px;
		border-radius: 2px;
		/* a small dark plate: the numbers are read over a waveform of any colour */
		background: rgb(5 6 10 / 0.8);
		font:
			normal 600 9px/1 system-ui,
			sans-serif;
		letter-spacing: 0.04em;
		color: #e4e8ef;
		white-space: nowrap;
	}
	/* the loop: a band with brackets at both ends */
	.loop {
		background: rgb(255 176 32 / 0.28);
		border-inline: 2px solid #ffb020;
		box-sizing: border-box;
	}
	.mark {
		width: 2px;
		background: #ffb020;
	}
	/* the playhead: a red line with a cap, as on a deck */
	.thumb {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		margin-left: -1px;
		background: #ff4a3a;
		box-shadow: 0 0 6px rgb(255 74 58 / 0.9);
		pointer-events: none;
	}
	.thumb::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -4px;
		border: 5px solid transparent;
		border-top-color: #ff4a3a;
		border-bottom: 0;
	}
	.thumb.active {
		width: 3px;
		margin-left: -1.5px;
	}
	.cursor {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgb(255 255 255 / 0.55);
		pointer-events: none;
	}
	.tip {
		position: absolute;
		bottom: 58px;
		transform: translateX(-50%);
		padding: 3px 8px;
		border-radius: 4px;
		background: #0b0d12;
		border: 1px solid rgb(255 255 255 / 0.16);
		color: #ff6a58;
		font:
			12px/1.4 ui-monospace,
			Consolas,
			monospace;
		white-space: nowrap;
		pointer-events: none;
		font-variant-numeric: tabular-nums;
	}
	@media (pointer: coarse) {
		.seek {
			height: 60px;
		}
	}
</style>
