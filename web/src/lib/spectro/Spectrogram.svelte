<script lang="ts">
	/**
	 * The recording's spectrogram with the score on top of it (a developer view for judging the alignment by eye,
	 * `/stage?spectro`). Time runs left to right past a fixed playhead and pitch runs upward. Every note of the piece in
	 * view is outlined in its voice colour; the notes sounding now are filled lightly and underlined with a thick line in
	 * the same colour. If the alignment is right, each outline sits on a bright ridge of the picture.
	 *
	 * The data has 86 columns a second and two rows a semitone, so the 10 seconds in view are about 860 columns: the
	 * canvas is as many device pixels wide as the screen (up to 4096, 4K DCI) and the picture is drawn with smooth
	 * interpolation. The picture is a little see-through, so the stage shows faintly behind it.
	 */
	import { onMount } from 'svelte';
	import type { PlaybackEngine } from '../playback/engine.js';
	import { FrameLoop } from '../playback/frameloop.js';
	import { voiceColour } from '../visual/palette.js';
	import {
		buildImage,
		imageSpan,
		loadSpectro,
		rowOf,
		viewAt,
		type Spectro,
		type Tile
	} from './spectro.js';

	interface Props {
		engine: PlaybackEngine;
		/** seconds of music across the width */
		seconds?: number;
		/** where the playhead stands across the width, 0..1 */
		playhead?: number;
		/** where the spectrogram files are served from */
		base?: string;
	}
	let { engine, seconds = 10, playhead = 0.3, base = '/data/spectro/' }: Props = $props();

	/** how opaque the picture is drawn (the panel behind it is see-through too) */
	const PICTURE_ALPHA = 0.8;
	/** the widest canvas: 4K DCI */
	const MAX_WIDTH = 4096;

	let canvas = $state<HTMLCanvasElement>();
	let status = $state('');

	onMount(() => {
		const cache: Record<string, Promise<{ s: Spectro; image: Tile[] }> | undefined> = {};
		let current: { id: string; s: Spectro; image: Tile[] } | null = null;
		let wanted: string | null = null;
		let width = 0;
		let height = 0;

		const resize = () => {
			if (!canvas) return;
			// as sharp as the screen: one canvas pixel per device pixel, up to 4096 across
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			width = Math.min(MAX_WIDTH, Math.max(2, Math.round(canvas.clientWidth * dpr)));
			height = Math.min(MAX_WIDTH, Math.max(2, Math.round(canvas.clientHeight * dpr)));
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
		};
		const ro = new ResizeObserver(resize);
		if (canvas) ro.observe(canvas);
		resize();

		const loop = new FrameLoop(engine.clock);
		loop.subscribe((f) => {
			if (!canvas) return;
			engine.update();
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			const piece = engine.piece;
			const win = piece ? engine.window(piece.id) : null;
			if (piece && piece.id !== wanted) {
				wanted = piece.id;
				status = 'loading';
				let p = cache[piece.id];
				if (!p) {
					p = loadSpectro(piece.id, undefined, base).then((s) => ({ s, image: buildImage(s) }));
					cache[piece.id] = p;
				}
				p.then((v) => {
					if (wanted === piece.id) {
						current = { id: piece.id, ...v };
						status = '';
					}
				}).catch((e) => {
					delete cache[piece.id];
					if (wanted === piece.id) {
						current = null;
						status = e instanceof Error ? e.message : String(e);
					}
				});
			}
			ctx.clearRect(0, 0, width, height); // the panel is a little see-through: the stage shows behind it
			if (!current || !piece || !win || current.id !== piece.id) return;
			const { s, image } = current;
			const t = f.t;
			const v = viewAt(s, t, seconds, playhead);
			const k = width / (v.x1 - v.x0);
			const semis = s.rows / s.perSemitone;
			const rowH = height / semis;

			// the part of the picture that exists, drawn where it belongs; the picture is a quarter row taller than the
			// semitone scale on each side when its rows are quarter tones (see `imageSpan`)
			const span = imageSpan(s);
			const dy = height - span.to * rowH;
			const dh = (span.to - span.from) * rowH;
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.globalAlpha = PICTURE_ALPHA;
			for (const tile of image) {
				const sx0 = Math.max(tile.c0, v.x0);
				const sx1 = Math.min(tile.c1, v.x1);
				if (sx1 <= sx0) continue;
				ctx.drawImage(
					tile.canvas,
					sx0 - tile.c0,
					0,
					sx1 - sx0,
					s.rows,
					(sx0 - v.x0) * k,
					dy,
					(sx1 - sx0) * k,
					dh
				);
			}
			ctx.globalAlpha = 1;

			const px = (time: number) => ((time - (t - seconds * playhead)) / seconds) * width;
			const y = (midi: number) => height - (rowOf(s, midi) + 1) * rowH;
			// lines and type scale with the canvas, so they look the same at 1920 and at 4096 across
			const unit = Math.max(1, height / 540);

			// the notes in view
			win.range(t, seconds * (1 - playhead), seconds * playhead);
			const { t_on, t_off, pitch, voice } = win.notes;
			ctx.lineJoin = 'round';
			for (let i = win.rangeStart; i < win.rangeEnd; i++) {
				const x0 = px(t_on[i]);
				const x1 = px(t_off[i]);
				if (x1 < 0 || x0 > width) continue;
				const yy = y(pitch[i]);
				const live = t_on[i] <= t && t < t_off[i];
				ctx.strokeStyle = voiceColour(voice[i]);
				ctx.globalAlpha = live ? 1 : 0.75;
				ctx.lineWidth = unit;
				ctx.strokeRect(
					x0 + unit / 2,
					yy + unit / 2,
					Math.max(unit, x1 - x0 - unit),
					Math.max(unit, rowH - unit)
				);
				if (live) {
					ctx.globalAlpha = 0.28;
					ctx.fillStyle = voiceColour(voice[i]);
					ctx.fillRect(x0, yy, Math.max(1, x1 - x0), rowH);
					ctx.globalAlpha = 1;
					ctx.lineWidth = Math.max(2, 2 * unit);
					ctx.beginPath();
					ctx.moveTo(x0, yy + rowH + ctx.lineWidth / 2);
					ctx.lineTo(Math.max(x0 + 2, x1), yy + rowH + ctx.lineWidth / 2);
					ctx.stroke();
				}
			}
			ctx.globalAlpha = 1;

			// octave marks (the Cs) and the playhead
			ctx.fillStyle = '#ffffff99';
			ctx.font = `${Math.max(9, Math.round(11 * unit))}px system-ui, sans-serif`;
			for (let m = Math.ceil(s.lowest / 12) * 12; m < s.lowest + semis; m += 12) {
				ctx.fillRect(0, y(m) + rowH, 6 * unit, unit);
				ctx.fillText(`C${m / 12 - 1}`, 9 * unit, y(m) + rowH - unit);
			}
			ctx.fillStyle = '#ffffffcc';
			ctx.fillRect(Math.round(playhead * width), 0, Math.max(1, Math.round(unit)), height);
		});
		loop.start();
		return () => {
			loop.stop();
			ro.disconnect();
		};
	});
</script>

<div class="spectro">
	<canvas bind:this={canvas} aria-label="Spectrogram of the recording with the notes on it"
	></canvas>
	{#if status}<p>{status}</p>{/if}
</div>

<style>
	.spectro {
		position: relative;
		width: 100%;
		height: 100%;
		background: rgba(5, 6, 10, 0.5);
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	p {
		position: absolute;
		top: 6px;
		left: 10px;
		margin: 0;
		font:
			11px/1.3 system-ui,
			sans-serif;
		color: #f88;
	}
</style>
