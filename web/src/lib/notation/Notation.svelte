<script lang="ts">
	/**
	 * Score overlay (T4.4.1): the engraved system that is playing, as vector graphics, with the sounding noteheads
	 * lit in their voice colour and a cursor that follows the recording. It reads the master clock through its own
	 * frame loop and touches the DOM only when something changes (a system, a lit notehead, the cursor position).
	 * The credit of the engraving that is shown (Verovio's from the OpenScore MXL, or the Contrapunctus Press PDF's, CC BY-NC-SA 4.0) is shown under the score.
	 */
	import { onMount } from 'svelte';
	import type { PlaybackEngine } from '../playback/engine.js';
	import { FrameLoop } from '../playback/frameloop.js';
	import { voiceColour } from '../visual/palette.js';
	import {
		CursorTrack,
		PDF_UNIT,
		loadNotation,
		markSounding,
		NotationIndex,
		type NotationDoc
	} from './notation.js';

	interface Props {
		engine: PlaybackEngine;
		/** where the notation files are served from */
		base?: string;
	}
	let { engine, base = '/data/notation/' }: Props = $props();

	const cache: Record<string, Promise<NotationDoc> | undefined> = {};
	let doc = $state<NotationDoc | null>(null);
	let system = $state(-1);
	let missing = $state<string | null>(null);
	let headsG = $state<SVGGElement>();
	let cursorEl = $state<SVGLineElement>();

	const unit = $derived(doc?.unit ?? PDF_UNIT);
	const sys = $derived(doc && system >= 0 ? doc.systems[system] : null);

	let headEls: SVGElement[] = [];
	/** the system whose markup is in the DOM now (the state flips first, the markup follows on the next tick) */
	let renderedSystem = -1;
	let marks = new Uint8Array(0);
	let prev = new Uint8Array(0);
	let repaint: (() => void) | null = null;

	$effect(() => {
		// the heads of a new system were rendered: remember their elements and start with none lit
		void sys;
		renderedSystem = system;
		headEls = headsG ? (Array.from(headsG.children) as SVGElement[]) : [];
		// the elements are reused from one system to the next: nothing may stay lit
		for (const el of headEls) el.classList.remove('on');
		marks = new Uint8Array(headEls.length);
		prev = new Uint8Array(headEls.length);
		// paint the new system's cursor and lit heads now, before the browser draws it: otherwise its first frame
		// shows the previous system's cursor position
		repaint?.();
	});

	onMount(() => {
		let loopPiece: string | null = null;
		let index: NotationIndex | null = null;
		let track: CursorTrack | null = null;
		let wanted: string | null = null;

		let lastT = 0;
		/** cursor and lit noteheads for time t on the system that is in the DOM */
		const paint = (t: number) => {
			const piece = engine.piece;
			const win = piece ? engine.window(piece.id) : null;
			if (!win || !index || !track || !doc || system < 0 || renderedSystem !== system) return;
			const x = track.x(t);
			if (cursorEl && !Number.isNaN(x)) {
				cursorEl.setAttribute('x1', x.toFixed(1));
				cursorEl.setAttribute('x2', x.toFixed(1));
			}
			marks.fill(0);
			markSounding(index, win, win.notes, t, system, marks);
			for (let h = 0; h < marks.length; h++) {
				if (marks[h] === prev[h]) continue;
				const el = headEls[h];
				if (marks[h]) {
					el.style.fill = voiceColour(marks[h]);
					el.classList.add('on');
				} else el.classList.remove('on');
				prev[h] = marks[h];
			}
		};
		repaint = () => paint(lastT);

		const loop = new FrameLoop(engine.clock);
		loop.subscribe((f) => {
			engine.update();
			lastT = f.t;
			const piece = engine.piece;
			const win = piece ? engine.window(piece.id) : null;
			if (!piece || !win) {
				if (system !== -1) system = -1;
				return;
			}
			if (piece.id !== loopPiece && piece.id !== wanted) {
				wanted = piece.id;
				missing = null;
				let p = cache[piece.id];
				if (!p) {
					p = loadNotation(piece.id, undefined, base);
					cache[piece.id] = p;
				}
				p.then((d) => {
					if (wanted !== piece.id) return;
					index = new NotationIndex(d, win.notes.n);
					track = new CursorTrack(index, win, piece.bars, piece.audio_end);
					loopPiece = piece.id;
					doc = d;
				}).catch((e) => {
					delete cache[piece.id];
					if (wanted === piece.id) {
						loopPiece = null;
						doc = null;
						track = null;
						missing = e instanceof Error ? e.message : String(e);
					}
				});
			}
			if (piece.id !== loopPiece || !index || !track || !doc) {
				if (system !== -1) system = -1;
				return;
			}
			const s = track.systemAt(f.t);
			if (s !== system) system = s;
			if (s < 0) return;
			// the markup of a new system appears on the next tick: until then the old one is still on screen
			if (renderedSystem !== s) return;

			paint(f.t);
		});
		loop.start();
		return () => {
			repaint = null;
			loop.stop();
		};
	});
</script>

<div class="notation" class:empty={!sys}>
	{#if sys && doc}
		<svg
			class="paper"
			viewBox="{sys.crop[0]} {sys.crop[1]} {sys.crop[2]} {sys.crop[3]}"
			role="img"
			aria-label="Score of the bars now playing"
			data-bars="{sys.bars[0].n}-{sys.bars[sys.bars.length - 1].n}"
			data-piece={doc.piece}
		>
			<image href="{base}{sys.svg}" x="0" y="0" width={sys.size[0]} height={sys.size[1]} />
			<g bind:this={headsG} class="heads">
				{#each sys.heads as h, i (i)}
					<ellipse cx={h[0]} cy={h[1]} rx={0.98 * unit} ry={0.78 * unit} />
				{/each}
			</g>
			<line
				bind:this={cursorEl}
				class="cursor"
				stroke-width={0.22 * unit}
				x1={sys.crop[0]}
				x2={sys.crop[0]}
				y1={sys.crop[1] + 1.6 * unit}
				y2={sys.crop[1] + sys.crop[3] - 1.6 * unit}
			/>
		</svg>
		<p class="credit">{doc.credit}</p>
	{:else if missing}
		<p class="credit">No score for this piece ({missing}).</p>
	{/if}
</div>

<style>
	.notation {
		width: 100%;
		pointer-events: none;
	}
	.empty {
		visibility: hidden;
	}
	.paper {
		display: block;
		width: 100%;
		height: auto;
		/* the pale cream of an Urtext edition (Henle), a little see-through: the stage shows faintly behind it, the ink stays dark */
		background: rgb(255 251 231 / 0.93);
		border-radius: 6px;
		box-shadow: 0 6px 30px #000a;
	}
	.heads ellipse {
		fill: transparent;
		opacity: 0;
		transition: opacity 0.14s ease-out;
		mix-blend-mode: multiply;
	}
	.heads ellipse:global(.on) {
		opacity: 0.8;
		transition-duration: 0.03s;
	}
	.cursor {
		stroke: #c0392b;
		stroke-linecap: round;
		opacity: 0.75;
	}
	.credit {
		margin: 4px 2px 0;
		font:
			10px/1.3 system-ui,
			sans-serif;
		color: var(--fg-dim, #9aa0ad);
		text-align: center;
	}
	@media (prefers-reduced-motion: reduce) {
		.heads ellipse {
			transition: none;
		}
	}
</style>
