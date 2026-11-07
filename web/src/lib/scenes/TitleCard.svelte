<script lang="ts">
	/**
	 * The title card (T5.8.1): the name of the piece fades in at its start, stays a few seconds and fades out. It sits in
	 * the top-left corner, small, where the falling notes are faintest, so it never covers them. Nothing is shown in the
	 * silent gaps between pieces (the idle scene is calm on its own).
	 */
	import { onMount } from 'svelte';
	import type { PlaybackEngine } from '../playback/engine.js';

	interface Props {
		engine: PlaybackEngine;
	}
	let { engine }: Props = $props();

	let card = $state<{ id: string; name: string; sub: string; kind: string } | null>(null);

	onMount(() => {
		let last: string | null | undefined;
		const apply = (e: PlaybackEngine) => {
			const p = e.piece;
			const id = p?.id ?? null;
			if (id === last) return;
			last = id;
			if (!p) {
				card = null;
				return;
			}
			// "Contrapunctus XII - Inversus" is a name and a qualifier
			const [name, ...rest] = p.title.split(' - ');
			card = { id: p.id, name, sub: rest.join(' - '), kind: p.kind.replace(/-/g, ' ') };
		};
		apply(engine);
		return engine.subscribe(apply);
	});
</script>

{#if card}
	{#key card.id}
		<div class="card" aria-hidden="true" data-piece={card.id}>
			<div class="kind">{card.kind}</div>
			<div class="name">{card.name}</div>
			{#if card.sub}<div class="sub">{card.sub}</div>{/if}
		</div>
	{/key}
{/if}

<style>
	.card {
		position: absolute;
		top: 18px;
		left: 22px;
		max-width: 28%;
		pointer-events: none;
		color: #e8ebf3;
		text-shadow: 0 1px 12px #000;
		font-family: Georgia, 'Times New Roman', serif;
		animation: card 6s ease-in-out both;
	}
	.kind {
		font:
			600 10px/1.2 system-ui,
			sans-serif;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.name {
		font-size: clamp(16px, 2.2vw, 28px);
		line-height: 1.15;
		margin-top: 2px;
	}
	.sub {
		font-size: clamp(12px, 1.4vw, 17px);
		font-style: italic;
		opacity: 0.75;
		margin-top: 2px;
	}
	@keyframes card {
		0% {
			opacity: 0;
			transform: translateY(-4px);
		}
		14% {
			opacity: 0.92;
			transform: none;
		}
		72% {
			opacity: 0.92;
		}
		100% {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card {
			animation-name: card-still;
		}
		@keyframes card-still {
			0%,
			100% {
				opacity: 0;
			}
			14%,
			72% {
				opacity: 0.92;
			}
		}
	}
</style>
