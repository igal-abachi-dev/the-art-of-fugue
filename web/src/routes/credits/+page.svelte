<script lang="ts">
	/** Credits and attributions (T7.5.3): the performer, the score, the libraries and the MilkDrop presets with their authors. */
	import { resolve } from '$app/paths';
	import curated from '#lib/ambient/curated.json';
	import { presetAuthors, presetCredits } from '#lib/player/credits.js';

	const credits = presetCredits(curated);
	const authors = presetAuthors(credits);
</script>

<svelte:head>
	<title>Credits — The Art of Fugue</title>
</svelte:head>

<main>
	<p><a href={resolve('/')}>← Back to the music</a></p>
	<h1>Credits</h1>

	<h2>The recording</h2>
	<p>
		<em>Die Kunst der Fuge</em>, BWV 1080, played by <strong>Marta Czech</strong>. The recording
		belongs to the performer and the label; this is a private, non-profit preview. Every note shown
		was aligned to this performance.
	</p>

	<h2>The score</h2>
	<ul>
		<li>
			Reference score, edited and engraved by Dr. Dominic Florence, © 2021 Contrapunctus Press
			(IMSLP PMLP5843), licensed under
			<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>. The score on
			the screen and the bar numbers come from this engraving.
		</li>
		<li>
			Note data from the OpenScore transcription (MuseScore), released under
			<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>.
		</li>
	</ul>

	<h2>The sampled instruments</h2>
	<ul>
		<li>
			The piano, the harpsichord and the pipe organ of the sampler mode are played from samples of
			the
			<a href="https://github.com/sgossner/VCSL">Versilian Community Sample Library</a> (Versilian
			Studios LLC), released under
			<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>: a Steinway B grand
			in three dynamic layers, a Flemish harpsichord, and a church organ (Ivy Audio) with its pedal.
		</li>
	</ul>

	<h2>The seal</h2>
	<ul>
		<li>
			The gold seal on the welcome screen and in the icon is Bach's own seal, a crown over the
			interlaced monogram of his initials, as the Bach-Archiv Leipzig shows it: the public-domain
			vector
			<a href="https://commons.wikimedia.org/wiki/File:Bachsiegel.svg">Bachsiegel.svg</a> of Wikimedia
			Commons (vector by the user Lumu), recoloured.
		</li>
	</ul>

	<h2>Software</h2>
	<ul>
		<li><a href="https://threejs.org/">three.js</a> (MIT): the 3D picture.</li>
		<li>
			<a href="https://github.com/jberg/butterchurn">butterchurn</a> and
			<a href="https://github.com/jberg/butterchurn-presets">butterchurn-presets</a> (MIT): the MilkDrop
			renderer and the preset pack.
		</li>
		<li>
			<a href="https://www.verovio.org/">Verovio</a> (LGPL-3.0): engraved the score on the screen from
			the OpenScore data, at build time.
		</li>
		<li><a href="https://svelte.dev/">Svelte</a> and SvelteKit (MIT): the interface.</li>
		<li>
			<a href="https://librosa.org/">librosa</a> and the scientific Python stack: aligning the notes to
			the recording.
		</li>
	</ul>

	<h2>The pictures behind the notes</h2>
	<p>
		The soft moving pictures are MilkDrop presets by {authors.join(', ')}, shared by their authors
		in the butterchurn preset pack.
	</p>
	<ul class="presets">
		{#each credits as c (c.id)}
			<li><strong>{c.title}</strong> by {c.author}</li>
		{/each}
	</ul>
</main>

<style>
	:global(html, body) {
		margin: 0;
		background: var(--bg, #05060a);
		color: var(--fg, #e8e8ee);
	}
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 32px 22px 80px;
		font:
			16px/1.6 system-ui,
			sans-serif;
	}
	h1 {
		font:
			400 40px Georgia,
			'Times New Roman',
			serif;
		margin: 12px 0 8px;
	}
	h2 {
		margin: 30px 0 6px;
		font:
			600 13px system-ui,
			sans-serif;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-dim, #9aa0ad);
	}
	a {
		color: #9fc2ff;
	}
	a:focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: 2px;
	}
	ul {
		padding-left: 1.2em;
	}
	.presets {
		columns: 2;
		font-size: 14px;
	}
	@media (max-width: 560px) {
		.presets {
			columns: 1;
		}
	}
</style>
