<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { applyTokens } from '#lib/visual/palette.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// design tokens (voice colours etc.): one source in lib/visual/palette.ts
	onMount(() => applyTokens(document.documentElement));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
