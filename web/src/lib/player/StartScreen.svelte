<script lang="ts">
	/**
	 * The welcome (T7.1.1): the title of the work for a moment, then it fades away and the music begins by itself, about two
	 * seconds after the page opens. There is no button. A link to a bar (`/?p=viii&bar=25`) skips the screen and plays at once.
	 *
	 * The browser decides whether a page may make sound without having been touched. Where it may (a returning visitor in
	 * Chrome or Edge), the music begins when the screen fades. Where it may not (Firefox, Safari, a first visit), the player
	 * appears paused and says so, and the first click, tap or key starts the music (`Player.svelte` listens for it). A click or
	 * a key during the welcome starts the music at once. The note about moving light stays, and the calm mode that used to be
	 * a button is a switch in the effects menu (E).
	 */
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { Player } from './player.svelte.js';
	import WelcomeCard from './WelcomeCard.svelte';

	interface Props {
		player: Player;
		/** the page was opened on a bar: no welcome, play at once */
		linked: boolean;
	}
	let { player, linked }: Props = $props();

	/**
	 * The music is asked to start this long after browsing began (the title has been on the screen since the first paint, so a
	 * slow load shortens the welcome rather than lengthening the wait), but the welcome shows for at least MIN_MS once the page is
	 * ready, so that it is not a flash.
	 */
	const TARGET_MS = 1600;
	const MIN_MS = 500;
	const FADE_MS = 450;
	const SHOW_MS = Math.max(
		MIN_MS,
		TARGET_MS - (typeof performance === 'undefined' ? 0 : performance.now())
	);

	const failed = $derived(player.transport.status === 'error');

	onMount(() => {
		void player.welcome(SHOW_MS, linked);
	});
</script>

{#if !player.begun && !linked}
	<div
		class="start"
		role="status"
		aria-label="The Art of Fugue, by Johann Sebastian Bach. Starting."
		out:fade={{ duration: FADE_MS }}
		data-testid="welcome"
	>
		<div class="card">
			<WelcomeCard />
			<div class="rule" style:--show="{SHOW_MS}ms" aria-hidden="true"></div>

			{#if failed}
				<p class="error" role="alert">
					{player.transport.error ?? 'The audio could not be loaded.'}
				</p>
				<button type="button" onclick={() => player.engine.reload()}>Try again</button>
			{/if}

			<p class="warning">
				<strong>Moving light.</strong> The picture glows and pulses with the music. A calm mode (no camera
				movement, glow or background picture) is in the effects menu.
			</p>
			<p class="links">
				<a href={resolve('/credits')}>Credits</a>
				<span aria-hidden="true"> · </span>
				<span>Press <kbd>?</kbd> for the keys</span>
			</p>
		</div>
	</div>
{/if}

<style>
	.start {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: grid;
		place-items: center;
		padding: 20px;
		/* the brown of a bound volume, darker at the edges */
		background: radial-gradient(ellipse at 50% 42%, rgb(78 46 24 / 0.94), rgb(30 15 7 / 0.98));
		backdrop-filter: blur(3px);
		color: var(--fg, #e8e8ee);
		text-align: center;
		overflow: auto;
	}
	.card {
		max-width: 560px;
		animation: rise 0.7s ease-out both;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	/* a hairline of gold that fills while the music is being waited for */
	.rule {
		height: 1px;
		margin: 0 auto 8px;
		max-width: 260px;
		background: linear-gradient(90deg, transparent, #e9c862, transparent);
		transform-origin: left center;
		animation: fill var(--show, 1.3s) linear both;
	}
	@keyframes fill {
		from {
			transform: scaleX(0);
		}
	}
	button {
		height: 40px;
		padding: 0 24px;
		border: 0;
		border-radius: 20px;
		background: #e8e8ee;
		color: #05060a;
		font:
			600 15px system-ui,
			sans-serif;
		cursor: pointer;
	}
	.warning {
		margin: 22px auto 8px;
		max-width: 480px;
		font:
			13px/1.5 system-ui,
			sans-serif;
		color: #cdb98f;
	}
	.error {
		color: #ff9d8a;
		margin: 14px 0;
	}
	.links {
		margin: 6px 0 0;
		font:
			13px system-ui,
			sans-serif;
		color: #cdb98f;
	}
	a {
		color: inherit;
	}
	a:focus-visible,
	button:focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: 3px;
	}
	kbd {
		padding: 0 6px;
		border: 1px solid rgb(255 255 255 / 0.3);
		border-radius: 4px;
		font:
			12px ui-monospace,
			monospace;
	}
	@media (prefers-reduced-motion: reduce) {
		.card,
		.rule {
			animation: none;
		}
	}
</style>
