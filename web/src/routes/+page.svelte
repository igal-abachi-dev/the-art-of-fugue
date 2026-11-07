<script lang="ts">
	/**
	 * The Art of Fugue (E7): the recording, its notes falling onto a keyboard, and the controls of a music player.
	 * `/?p=viii&bar=25` opens at a bar (paused: nothing plays until "Begin").
	 */
	import { onMount } from 'svelte';
	import Player from '#lib/player/Player.svelte';
	import WelcomeCard from '#lib/player/WelcomeCard.svelte';
	import { openSession, type Session } from '#lib/playback/session.js';

	let audioEl: HTMLAudioElement;
	let session = $state<Session | null>(null);
	let failure = $state<string | null>(null);

	onMount(() => {
		let disposed = false;
		let opened: Session | null = null;
		openSession(audioEl)
			.then((s) => {
				if (disposed) return s.dispose();
				opened = s;
				session = s;
			})
			.catch((e) => (failure = e instanceof Error ? e.message : String(e)));
		(window as unknown as { __app: unknown }).__app = {
			get session() {
				return opened;
			}
		};
		return () => {
			disposed = true;
			opened?.dispose();
			session = null;
		};
	});
</script>

<svelte:head>
	<title>The Art of Fugue</title>
	<meta
		name="description"
		content="Bach's Art of Fugue, played by Marta Czech, with every note shown as it sounds."
	/>
</svelte:head>

<audio bind:this={audioEl} preload="metadata"></audio>

{#if session}
	<Player {session} />
{:else}
	<main class="boot">
		<!-- the welcome from the first paint (the same words as the welcome screen that follows), so that it is on the screen
		     while the page loads and the two seconds are counted from the start of browsing, not from the end of the loading -->
		<WelcomeCard />
		{#if failure}
			<p role="alert">It could not start: {failure}</p>
			<button type="button" onclick={() => location.reload()}>Try again</button>
		{:else}
			<p role="status" class="sr">Loading</p>
		{/if}
	</main>
{/if}

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
		background: var(--bg, #05060a);
		color: var(--fg, #e8e8ee);
	}
	.boot {
		position: fixed;
		inset: 0;
		/* the brown of a bound volume, as the welcome screen that follows it */
		background: radial-gradient(ellipse at 50% 42%, #4e2e18, #1e0f07);
		display: grid;
		place-content: center;
		gap: 12px;
		text-align: center;
		font:
			16px system-ui,
			sans-serif;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	button {
		justify-self: center;
		height: 40px;
		padding: 0 22px;
		border-radius: 20px;
		border: 1px solid rgb(255 255 255 / 0.4);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
</style>
