<script lang="ts">
	/**
	 * Bach's seal, in gold: the crown over the interlaced monogram of his initials. The drawing is the public-domain vector "Bachsiegel.svg"
	 * of Wikimedia Commons (Bach's own seal of the 1700s, as the Bach-Archiv Leipzig shows it; vector by the Commons user Lumu), kept as it is in
	 * `seal-paths.svg` and filled with gold here. Decorative: the words that go with it carry the meaning.
	 */
	import paths from './seal-paths.svg?raw';

	interface Props {
		/** the width in pixels; the height follows the drawing (594.65 by 793.43) */
		size?: number;
	}
	let { size = 104 }: Props = $props();
</script>

<svg
	width={size}
	height={(size * 793.43) / 594.65}
	viewBox="-0.77 -327.08 594.65 793.43"
	aria-hidden="true"
	focusable="false"
	class="seal"
>
	<defs>
		<linearGradient
			id="seal-gold"
			gradientUnits="userSpaceOnUse"
			x1="60"
			y1="-327"
			x2="540"
			y2="466"
		>
			<stop offset="0" stop-color="#fff1ae" />
			<stop offset="0.3" stop-color="#e8c25a" />
			<stop offset="0.62" stop-color="#b9861f" />
			<stop offset="1" stop-color="#efca58" />
		</linearGradient>
	</defs>
	<g fill="url(#seal-gold)" stroke="#4a2a0e" stroke-width="1.2" stroke-linejoin="round">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own static drawing -->
		{@html paths}
	</g>
</svg>

<style>
	.seal {
		display: block;
		margin: 0 auto 10px;
		filter: drop-shadow(0 2px 10px rgb(0 0 0 / 0.55));
	}
</style>
