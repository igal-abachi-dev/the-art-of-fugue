<script lang="ts">
	/**
	 * The panels (E7): the piece list (the "playlist"), "what am I hearing", the effects menu, the go-to dialog and the
	 * keyboard help. One is open at a time; Esc or a click on its close button shuts it and focus goes back to the button
	 * that opened it. On a narrow screen they are bottom sheets.
	 */
	import { onMount, tick } from 'svelte';
	import type { PieceEvent } from '../data/manifest.js';
	import { VOICE_COLOURS } from '../visual/palette.js';
	import { SCENES } from '../visual/presets.js';
	import { activeSentences, type Described } from './info.js';
	import Icon from './Icon.svelte';
	import { SHORTCUTS } from './keys.js';
	import type { Player } from './player.svelte.js';
	import { formatTime } from './seekmath.js';

	interface Props {
		player: Player;
	}
	let { player }: Props = $props();

	const tr = $derived(player.transport);
	const s = $derived(player.settings);
	const ordered = $derived(
		[...player.manifest.pieces].sort((a, b) => a.audio_start - b.audio_start)
	);
	const piece = $derived(player.manifest.pieces.find((p) => p.id === tr.pieceId) ?? null);

	// ---- piece list: the current piece is kept in view, the list works as a listbox
	let listEl = $state<HTMLUListElement>();
	let focusIdx = $state(0);
	$effect(() => {
		if (player.panel !== 'pieces') return;
		focusIdx = Math.max(
			0,
			ordered.findIndex((p) => p.id === tr.pieceId)
		);
		void tick().then(() => {
			listEl
				?.querySelector<HTMLElement>('[aria-selected="true"]')
				?.scrollIntoView({ block: 'center' });
			listEl?.focus();
		});
	});
	function listKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') focusIdx = Math.min(ordered.length - 1, focusIdx + 1);
		else if (e.key === 'ArrowUp') focusIdx = Math.max(0, focusIdx - 1);
		else if (e.key === 'Home') focusIdx = 0;
		else if (e.key === 'End') focusIdx = ordered.length - 1;
		else if (e.key === 'Enter') return go(focusIdx);
		else return;
		e.preventDefault();
		e.stopPropagation();
		void tick().then(() =>
			listEl
				?.querySelector<HTMLElement>(`[data-i="${focusIdx}"]`)
				?.scrollIntoView({ block: 'nearest' })
		);
	}
	function go(i: number) {
		const p = ordered[i];
		if (p) player.engine.seekPlace({ piece: p });
	}
	const kindName = (k: string) => k.replace(/-/g, ' ');

	// ---- info: the annotations of the piece that are happening now
	let events = $state<{ id: string; list: PieceEvent[] } | null>(null);
	$effect(() => {
		const id = tr.pieceId;
		if (player.panel !== 'info' || !id) return;
		if (events?.id === id) return;
		let live = true;
		void player.engine.events(id).then(
			(list) => live && (events = { id, list }),
			() => live && (events = { id, list: [] })
		);
		return () => (live = false);
	});
	const sentences = $derived.by((): Described[] =>
		piece && events?.id === piece.id ? activeSentences(events.list, piece, tr.position) : []
	);

	// ---- go to a piece and bar
	let jumpPiece = $state('');
	let jumpBar = $state('');
	let jumpError = $state<string | null>(null);
	let jumpInput = $state<HTMLInputElement>();
	$effect(() => {
		player.onjump = () => {
			jumpPiece = player.engine.piece?.id ?? '';
			jumpBar = '';
			jumpError = null;
			void tick().then(() => jumpInput?.focus());
		};
	});
	function submitJump(e: SubmitEvent) {
		e.preventDefault();
		jumpError = player.jump(jumpPiece, jumpBar);
		if (!jumpError) player.panel = null;
	}

	const sceneNames = Object.keys(SCENES);
	let root = $state<HTMLElement>();
	onMount(() => {
		// a click outside the panel and its buttons closes it
		const outside = (e: PointerEvent) => {
			if (!player.panel || !root) return;
			const t = e.target as Element | null;
			if (root.contains(t) || t?.closest('[role="toolbar"]')) return;
			player.panel = null;
		};
		window.addEventListener('pointerdown', outside);
		return () => window.removeEventListener('pointerdown', outside);
	});
	const groups = ['Playback', 'Navigate', 'Sound', 'View'] as const;
</script>

{#if player.panel}
	<section
		class="panel"
		class:wide={player.panel === 'help'}
		bind:this={root}
		aria-label={{
			pieces: 'Pieces',
			info: 'What am I hearing',
			effects: 'Effects',
			help: 'Keyboard shortcuts',
			jump: 'Go to a piece and bar'
		}[player.panel]}
		data-panel={player.panel}
	>
		<header>
			<h2>
				{{
					pieces: 'Pieces',
					info: 'What am I hearing',
					effects: 'Effects',
					help: 'Keyboard shortcuts',
					jump: 'Go to'
				}[player.panel]}
			</h2>
			<button type="button" onclick={() => (player.panel = null)} aria-label="Close">
				<Icon name="close" size={18} />
			</button>
		</header>

		{#if player.panel === 'pieces'}
			<div class="cols" aria-hidden="true">
				<span>#</span><span>Piece</span><span>Voices</span><span>Bars</span><span>Time</span>
			</div>
			<ul
				class="list"
				role="listbox"
				tabindex="0"
				aria-label="Pieces in the order of the recording"
				aria-activedescendant={`piece-${ordered[focusIdx]?.id}`}
				bind:this={listEl}
				onkeydown={listKey}
			>
				{#each ordered as p, i (p.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li
						id={`piece-${p.id}`}
						role="option"
						data-i={i}
						aria-selected={p.id === tr.pieceId}
						class:current={p.id === tr.pieceId}
						class:focus={i === focusIdx}
						onclick={() => {
							focusIdx = i;
							go(i);
						}}
					>
						<span class="n">{i + 1}</span>
						<span class="t">{p.title}<small>{kindName(p.kind)}</small></span>
						<span class="v" aria-hidden="true"
							>{#each p.voices as v (v.voice)}<i style="background:{VOICE_COLOURS[v.voice - 1]}"
								></i>{/each}</span
						>
						<span class="b">{p.bars.length}</span>
						<span class="d">{formatTime(p.audio_end - p.audio_start)}</span>
					</li>
				{/each}
			</ul>
		{:else if player.panel === 'info'}
			<!-- a region that scrolls can be reached and scrolled from the keyboard -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="body"
				tabindex="0"
				role="region"
				aria-label="What is happening in this piece"
				data-own-keys
			>
				{#if piece}
					<p class="lead">
						<strong>{piece.title}</strong>
						<span class="dim"> · {kindName(piece.kind)}{tr.bar ? ` · bar ${tr.bar}` : ''}</span>
					</p>
					<p class="dim small">
						{piece.voices.length} voices. The voice buttons show or hide them in the picture; the sound
						is the recording and cannot be separated.
					</p>
					{#if sentences.length}
						<ul class="sentences" aria-live="polite">
							{#each sentences as t (t.id)}
								<li class={t.type}>{t.text}</li>
							{/each}
						</ul>
					{:else}
						<p class="dim">Nothing special is happening in this bar.</p>
					{/if}
				{:else}
					<p class="dim">Between pieces: the recording is quiet here.</p>
				{/if}
			</div>
		{:else if player.panel === 'effects'}
			<div class="form">
				<label>
					<span>Scene</span>
					<select
						value={s.scene}
						onchange={(e) => player.set({ scene: e.currentTarget.value })}
						data-testid="scene"
					>
						<option value="auto">Auto (each piece its own)</option>
						{#each sceneNames as n (n)}<option value={n}>{n}</option>{/each}
					</select>
				</label>
				<label>
					<span>Score engraving</span>
					<select
						value={s.notation}
						onchange={(e) =>
							player.set({ notation: e.currentTarget.value === 'pdf' ? 'pdf' : 'verovio' })}
						data-testid="fx-notation"
					>
						<option value="verovio">Verovio's engraving</option>
						<option value="pdf">The printed score (the PDF)</option>
					</select>
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={s.ambient}
						onchange={(e) => player.set({ ambient: e.currentTarget.checked })}
						data-testid="fx-ambient"
					/>
					<span>Ambient picture behind the notes</span>
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={s.bloom}
						onchange={(e) => player.set({ bloom: e.currentTarget.checked })}
						data-testid="fx-bloom"
					/>
					<span>Glow that follows the sound</span>
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={player.calm}
						disabled={player.systemReduced}
						onchange={(e) => player.set({ reducedMotion: e.currentTarget.checked })}
						data-testid="fx-reduced"
					/>
					<span
						>Calm: no camera movement, no ambient picture{player.systemReduced
							? ' (your system asks for this)'
							: ''}</span
					>
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={s.highlight}
						onchange={(e) => player.set({ highlight: e.currentTarget.checked })}
					/>
					<span>Mark the subject in every scene</span>
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={s.autoHide}
						onchange={(e) => player.set({ autoHide: e.currentTarget.checked })}
					/>
					<span>Hide the controls while playing</span>
				</label>
				<button type="button" class="plain" onclick={() => player.resetSettings()}>
					Reset all settings
				</button>
			</div>
		{:else if player.panel === 'jump'}
			<form class="form" onsubmit={submitJump}>
				<label>
					<span>Piece</span>
					<input
						bind:this={jumpInput}
						bind:value={jumpPiece}
						list="piece-names"
						placeholder="viii, canon-2, c14"
						autocomplete="off"
						data-testid="jump-piece"
					/>
				</label>
				<datalist id="piece-names">
					{#each ordered as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
				</datalist>
				<label>
					<span>Bar (optional)</span>
					<input
						bind:value={jumpBar}
						inputmode="numeric"
						autocomplete="off"
						placeholder="24"
						data-testid="jump-bar"
					/>
				</label>
				{#if jumpError}<p class="error" role="alert">{jumpError}</p>{/if}
				<button type="submit" class="plain" data-testid="jump-go">Go</button>
			</form>
		{:else if player.panel === 'help'}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="help"
				tabindex="0"
				role="region"
				aria-label="The keyboard shortcuts"
				data-own-keys
			>
				{#each groups as g (g)}
					<h3>{g}</h3>
					<dl>
						{#each SHORTCUTS.filter((x) => x.group === g && x.show) as x (x.action)}
							<dt><kbd>{x.show}</kbd></dt>
							<dd>{x.label}</dd>
						{/each}
					</dl>
				{/each}
				<p class="dim small">
					Press <kbd>Alt</kbd> and drag on the seek bar to mark a loop. A seek is not gapless: a loop
					has a short pause at its end.
				</p>
			</div>
		{/if}
	</section>
{/if}

<style>
	.panel {
		position: absolute;
		right: 14px;
		bottom: calc(var(--bar-h, 150px) + 10px);
		width: min(380px, calc(100vw - 28px));
		max-height: min(82vh, 820px, calc(100dvh - var(--bar-h, 150px) - 24px));
		display: flex;
		flex-direction: column;
		border-radius: 10px;
		border: 1px solid #000;
		background:
			linear-gradient(#a3162a, #6b0d18) top / 100% 2px no-repeat,
			linear-gradient(#22252b, #14161a 120px);
		color: var(--fg, #e8e8ee);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.1),
			0 10px 40px #000c;
		font:
			14px/1.45 system-ui,
			sans-serif;
		overflow: hidden;
	}
	.panel.wide {
		width: min(560px, calc(100vw - 28px));
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 6px 16px;
	}
	h2 {
		margin: 0;
		font:
			600 13px system-ui,
			sans-serif;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #ff6a58;
		text-shadow: 0 0 7px rgb(255 74 58 / 0.4);
	}
	header button {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	header button:hover {
		background: rgb(255 255 255 / 0.12);
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	.list:focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: 1px;
	}
	/* scrollbars in the colours of the panel: black track, a wine-red thumb */
	.list,
	.body,
	.form,
	.panel {
		scrollbar-width: thin;
		scrollbar-color: #8c1424 #0a0b0e;
	}
	.list::-webkit-scrollbar,
	.body::-webkit-scrollbar,
	.form::-webkit-scrollbar,
	.panel::-webkit-scrollbar {
		width: 10px;
	}
	.list::-webkit-scrollbar-track,
	.body::-webkit-scrollbar-track,
	.form::-webkit-scrollbar-track,
	.panel::-webkit-scrollbar-track {
		background: #0a0b0e;
		border-radius: 5px;
		box-shadow: inset 0 0 3px #000;
	}
	.list::-webkit-scrollbar-thumb,
	.body::-webkit-scrollbar-thumb,
	.form::-webkit-scrollbar-thumb,
	.panel::-webkit-scrollbar-thumb {
		border: 1px solid #1a0508;
		border-radius: 5px;
		background: linear-gradient(90deg, #6d0c17, #b3182c 50%, #6d0c17);
	}
	.list::-webkit-scrollbar-thumb:hover,
	.body::-webkit-scrollbar-thumb:hover,
	.form::-webkit-scrollbar-thumb:hover {
		background: linear-gradient(90deg, #8c1020, #d71f38 50%, #8c1020);
	}
	.list {
		margin: 0;
		padding: 0 6px 8px;
		list-style: none;
		overflow: auto;
	}
	/* the piece list is a library table, as in a DJ program: column heads, zebra rows, the loaded track marked */
	.cols,
	.list li {
		display: grid;
		grid-template-columns: 26px 1fr 54px 34px 48px;
		gap: 8px;
		align-items: center;
	}
	.cols {
		margin: 0 6px;
		padding: 4px 10px;
		border-bottom: 1px solid #000;
		box-shadow: 0 1px 0 rgb(255 255 255 / 0.07);
		font:
			600 10px/1 system-ui,
			sans-serif;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #a3abbb;
	}
	.cols span:nth-child(n + 3) {
		text-align: right;
	}
	.list li {
		position: relative;
		padding: 6px 10px;
		border-radius: 3px;
		cursor: pointer;
	}
	.list li:nth-child(odd) {
		background: rgb(255 255 255 / 0.03);
	}
	.list li:hover {
		background: rgb(255 255 255 / 0.09);
	}
	.list li.focus {
		box-shadow: inset 0 0 0 1px rgb(138 180 255 / 0.6);
	}
	.list li.current {
		background: linear-gradient(90deg, rgb(255 74 58 / 0.22), rgb(255 74 58 / 0.06));
	}
	.list li.current::before {
		content: '';
		position: absolute;
		left: 0;
		top: 2px;
		bottom: 2px;
		width: 3px;
		border-radius: 2px;
		background: #ff4a3a;
		box-shadow: 0 0 8px #ff4a3a;
	}
	.v {
		display: flex;
		justify-content: flex-end;
		gap: 3px;
	}
	.v i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		box-shadow: 0 0 4px currentColor;
	}
	.b {
		text-align: right;
		color: #9aa0ad;
		font:
			12px ui-monospace,
			Consolas,
			monospace;
	}
	.n,
	.d {
		color: var(--fg-dim, #9aa0ad);
		font:
			12px ui-monospace,
			Consolas,
			monospace;
		font-variant-numeric: tabular-nums;
	}
	.d {
		text-align: right;
		color: #ff6a58;
	}
	.t {
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 15px;
	}
	.t small {
		display: block;
		font:
			11px system-ui,
			sans-serif;
		color: var(--fg-dim, #9aa0ad);
		text-transform: capitalize;
	}
	/* the text of a panel scrolls inside it instead of being cut off at the bottom */
	.body {
		min-height: 0;
		overflow: auto;
		padding-bottom: 12px;
	}
	header {
		flex: none;
	}
	.lead,
	.small,
	.dim {
		margin: 0;
		padding: 2px 16px;
	}
	.small {
		font-size: 12px;
	}
	.dim {
		color: var(--fg-dim, #9aa0ad);
	}
	.lead .dim {
		padding: 0;
	}
	.sentences {
		margin: 6px 0 12px;
		padding: 0 16px;
		list-style: none;
		display: grid;
		gap: 8px;
	}
	.sentences li {
		padding: 8px 10px;
		border-left: 3px solid #8ab4ff;
		background: rgb(255 255 255 / 0.05);
		border-radius: 0 8px 8px 0;
	}
	.sentences li.bach {
		border-color: #fff;
	}
	.sentences li.clash,
	.sentences li.crossing {
		border-color: #d55e00;
	}
	.form {
		display: grid;
		gap: 10px;
		padding: 6px 16px 16px;
		overflow: auto;
	}
	label {
		display: grid;
		gap: 4px;
	}
	label.check {
		grid-template-columns: 20px 1fr;
		align-items: center;
	}
	input:not([type]),
	select {
		height: 34px;
		border-radius: 8px;
		border: 1px solid rgb(255 255 255 / 0.2);
		background: rgb(255 255 255 / 0.06);
		color: inherit;
		padding: 0 10px;
		font: inherit;
	}
	select option {
		background: #12141a;
	}
	.plain {
		height: 36px;
		border: 1px solid rgb(255 255 255 / 0.25);
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.plain:hover {
		background: rgb(255 255 255 / 0.1);
	}
	.error {
		margin: 0;
		color: #ff9d8a;
	}
	.help {
		padding: 0 16px 14px;
		overflow: auto;
	}
	.help h3 {
		margin: 10px 0 4px;
		font:
			600 11px system-ui,
			sans-serif;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg-dim, #9aa0ad);
	}
	dl {
		display: grid;
		grid-template-columns: 150px 1fr;
		gap: 4px 10px;
		margin: 0;
	}
	dt,
	dd {
		margin: 0;
	}
	kbd {
		display: inline-block;
		padding: 1px 7px;
		border-radius: 5px;
		border: 1px solid rgb(255 255 255 / 0.25);
		background: rgb(255 255 255 / 0.08);
		font:
			12px ui-monospace,
			monospace;
	}
	@media (max-width: 760px) {
		.panel {
			left: 8px;
			right: 8px;
			width: auto;
			bottom: calc(var(--bar-h, 150px) + 8px);
			max-height: min(55vh, calc(100dvh - var(--bar-h, 150px) - 16px));
		}
		.panel.wide {
			width: auto;
		}
		dl {
			grid-template-columns: 110px 1fr;
		}
	}
</style>
