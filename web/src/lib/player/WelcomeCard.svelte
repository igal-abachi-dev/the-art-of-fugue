<script lang="ts">
	/**
	 * The words and the mark of the welcome, in gold on the brown of a bound volume: the seal, BACH, the title, the player. One component
	 * for the boot screen (the first paint, before the page has loaded) and for the welcome screen that follows it, so that the two are
	 * the same picture and nothing jumps.
	 */
	import Seal from './Seal.svelte';
</script>

<div class="welcome">
	<Seal size={104} />
	<p class="bach">BACH</p>
	<p class="eyebrow">
		<span class="rule"></span>Johann Sebastian · BWV 1080<span class="rule"></span>
	</p>
	<h1>The Art of Fugue</h1>
	<p class="by">Played by Marta Czech. Every note on the screen is the note you hear.</p>
</div>

<style>
	.welcome {
		text-align: center;
	}
	.bach {
		margin: 0 0 4px;
		font:
			600 clamp(26px, 5vw, 38px) / 1 Georgia,
			'Times New Roman',
			serif;
		letter-spacing: 0.42em;
		text-indent: 0.42em;
		color: #e9c862;
		text-shadow:
			0 1px 0 #4a2a0e,
			0 0 18px rgb(233 200 98 / 0.28);
	}
	.eyebrow {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin: 0 0 14px;
		font:
			600 11px system-ui,
			sans-serif;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #d9c48d;
	}
	.rule {
		display: inline-block;
		width: 38px;
		height: 1px;
		background: linear-gradient(90deg, transparent, #c9a24a);
	}
	.rule:last-child {
		transform: scaleX(-1);
	}
	h1 {
		margin: 0 0 10px;
		font:
			400 clamp(34px, 7vw, 58px) / 1.1 Georgia,
			'Times New Roman',
			serif;
		color: #f0d27a;
		letter-spacing: 0.02em;
		text-shadow:
			0 1px 0 #4a2a0e,
			0 2px 22px rgb(0 0 0 / 0.5);
	}
	.by {
		margin: 0 0 22px;
		font:
			italic 16px/1.5 Georgia,
			'Times New Roman',
			serif;
		color: #d7c08a;
	}
</style>
