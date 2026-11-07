<script lang="ts">
	/**
	 * The control bar (E7): the seek bar over a row of the controls a desktop player has, grouped as transport, time and
	 * place, then sound and repeat, then voices and panels. Every button has an accessible name, a tooltip that names its
	 * key, a visible focus ring and a touch target of at least 44 px on touch screens.
	 */
	import { VOICE_COLOURS } from '../visual/palette.js';
	import { clockText } from './seekmath.js';
	import Icon from './Icon.svelte';
	import type { Player } from './player.svelte.js';
	import SeekBar from './SeekBar.svelte';
	import { INSTRUMENTS, OFFSET_LIMIT_MS, SPEEDS } from './player.svelte.js';
	import { TONE_LIMIT_DB } from './settings.js';

	interface Props {
		player: Player;
		fullscreen: boolean;
	}
	let { player, fullscreen }: Props = $props();

	const tr = $derived(player.transport);
	const s = $derived(player.settings);
	const playing = $derived(tr.isPlaying);
	const piece = $derived(player.manifest.pieces.find((p) => p.id === tr.pieceId) ?? null);
	const clock = $derived(clockText(player.manifest, tr.position, s.remaining, tr.duration));
	const ordered = $derived(
		[...player.manifest.pieces].sort((a, b) => a.audio_start - b.audio_start)
	);
	const atFirst = $derived(tr.position < (ordered[0]?.audio_start ?? 0) + 0.5);
	const atLast = $derived(
		!!ordered.length && tr.position >= (ordered.at(-1)?.audio_start ?? Infinity)
	);
	const volumeIcon = $derived(
		s.muted || s.volume === 0 ? 'muted' : s.volume < 0.4 ? 'volume-low' : 'volume'
	);
	let speedOpen = $state(false);
	let instrumentOpen = $state(false);
	let sourceGroup = $state<HTMLElement>();
	const heard = $derived(INSTRUMENTS.find((i) => i.id === player.instrument)?.label ?? '');
	const toneText = $derived(
		s.instrumentTone === 0
			? 'as made'
			: `${s.instrumentTone > 0 ? 'brighter' : 'darker'} ${Math.abs(s.instrumentTone)} dB`
	);
	const offsetText = $derived(
		s.instrumentOffset === 0
			? '0 ms'
			: `${s.instrumentOffset > 0 ? '+' : '−'}${Math.abs(s.instrumentOffset)} ms`
	);

	/** a click anywhere else closes the sound menu */
	function outside(e: Event) {
		if (instrumentOpen && sourceGroup && !sourceGroup.contains(e.target as Node))
			instrumentOpen = false;
	}

	function wheel(e: WheelEvent) {
		e.preventDefault();
		player.nudgeVolume(e.deltaY < 0 ? 1 : -1);
	}
</script>

<svelte:window onclick={outside} />

<div class="bar deck" role="toolbar" aria-label="Player controls">
	<SeekBar {player} />

	<div class="row">
		<div class="group views" role="group" aria-label="Show on the stage">
			<button
				type="button"
				class:on={s.score}
				aria-pressed={s.score}
				onclick={() => player.set({ score: !s.score })}
				aria-label="Score"
				title="Show the score of the piece ( N )"
				data-testid="score"
			>
				<Icon name="score" />
			</button>
			<button
				type="button"
				class:on={s.spectro}
				aria-pressed={s.spectro}
				onclick={() => player.set({ spectro: !s.spectro })}
				aria-label="Spectrogram"
				title="Show the spectrogram of the recording ( V )"
				data-testid="spectro"
			>
				<Icon name="spectrogram" />
			</button>
		</div>
		<div class="mid">
			<div class="group">
				<button
					type="button"
					class:on={s.repeat !== 'off'}
					onclick={() => player.cycleRepeat()}
					aria-label={`Repeat: ${s.repeat}. Change`}
					title="Repeat: off, piece, all ( R )"
					data-testid="repeat"
				>
					<Icon name={s.repeat === 'piece' ? 'repeat-one' : 'repeat'} />
				</button>
				<button
					type="button"
					class:on={!!player.region || player.pendingA !== null}
					onclick={() => player.markLoop()}
					aria-label={player.region
						? 'Loop on. Clear the loop'
						: player.pendingA !== null
							? 'Set the end of the loop'
							: 'Set the start of a loop'}
					title="A–B loop: start, end, clear ( A ). Alt-drag on the bar"
					data-testid="loop"
				>
					<Icon name="loop" />
				</button>
			</div>
			<div class="group transport">
				<button
					type="button"
					onclick={() => player.stepPiece(-1)}
					disabled={atFirst && !tr.pieceId}
					aria-label="Previous piece"
					title="Previous piece ( [ )"
				>
					<Icon name="prev" />
				</button>
				<button
					type="button"
					onclick={() => player.seekBy(-10)}
					aria-label="Back 10 seconds"
					title="Back 10 s ( ← is 5 s )"
				>
					<Icon name="back" />
				</button>
				<button
					type="button"
					class="play"
					class:playing
					onclick={() => player.toggle()}
					aria-label={playing ? 'Pause' : 'Play'}
					title={playing ? 'Pause ( Space )' : 'Play ( Space )'}
					data-testid="toggle"
				>
					<Icon name={playing ? 'pause' : 'play'} size={26} />
				</button>
				<button
					type="button"
					onclick={() => player.stop()}
					aria-label="Stop (back to the start of the piece)"
					title="Stop"
				>
					<Icon name="stop" size={20} />
				</button>
				<button
					type="button"
					onclick={() => player.seekBy(10)}
					aria-label="Forward 10 seconds"
					title="Forward 10 s ( → is 5 s )"
				>
					<Icon name="forward" />
				</button>
				<button
					type="button"
					onclick={() => player.stepPiece(1)}
					disabled={atLast}
					aria-label="Next piece"
					title="Next piece ( ] )"
				>
					<Icon name="next" />
				</button>
			</div>
			<div class="lcd">
				<div class="place" aria-hidden="true">
					{#if piece}
						<span class="title">{piece.title}</span>
						{#if tr.bar}<span class="dim"> · bar {tr.bar}</span>{/if}
					{:else}
						<span class="dim">between pieces</span>
					{/if}
				</div>
				<button
					type="button"
					class="time"
					onclick={() => player.set({ remaining: !s.remaining })}
					title={`${clock.whole}. Click to show ${s.remaining ? 'elapsed' : 'remaining'} time`}
					aria-label={`Time ${clock.left} / ${clock.right}. Switch between elapsed and remaining`}
					data-testid="time"
				>
					<span>{clock.left}</span><span class="dim">&nbsp;/&nbsp;{clock.right}</span>
				</button>
			</div>
		</div>

		<div class="rightbank">
			<div class="group voices" role="group" aria-label="Voices shown (the sound is not affected)">
				{#each [1, 2, 3, 4].slice(0, player.voiceCount) as v (v)}
					{@const shown = player.mask[v - 1] === 1}
					<button
						type="button"
						class="voice"
						class:off={!shown}
						style="--c:{VOICE_COLOURS[v - 1]}"
						aria-pressed={shown}
						aria-label={`Voice ${v}${s.solo === v ? ', alone' : ''}`}
						title={`Show or hide voice ${v} ( ${v} ). Shift-click: alone. The sound is not affected`}
						onclick={(e) => (e.shiftKey ? player.soloVoice(v) : player.toggleVoice(v))}
						data-testid={`voice-${v}`}
					>
						<span class="dot"></span>
					</button>
				{/each}
			</div>

			<div class="group source" bind:this={sourceGroup}>
				<button
					type="button"
					class="instr"
					class:on={player.instrument !== 'recording'}
					class:busy={player.instrumentLoading !== null}
					style:--p="{Math.round(player.instrumentProgress * 100)}%"
					aria-haspopup="true"
					aria-expanded={instrumentOpen}
					aria-busy={player.instrumentLoading !== null}
					onclick={() => (instrumentOpen = !instrumentOpen)}
					aria-label={player.instrumentLoading
						? `Sound: loading ${Math.round(player.instrumentProgress * 100)} percent. Change`
						: `Sound: ${heard}. Change`}
					title="What plays: the recording, a piano, a harpsichord or a pipe organ ( S: next )"
					data-testid="instrument"
				>
					<Icon name="piano" />
				</button>
				{#if instrumentOpen}
					<div class="menu imenu" role="menu" aria-label="What plays">
						{#each INSTRUMENTS as it (it.id)}
							{@const loading = player.instrumentLoading === it.id}
							<button
								type="button"
								role="menuitemradio"
								aria-checked={player.instrument === it.id}
								class:on={player.instrument === it.id}
								class:loading
								style:--p="{Math.round(player.instrumentProgress * 100)}%"
								onclick={() => void player.setInstrument(it.id)}
								data-testid={`instrument-${it.id}`}
							>
								<span class="name">{it.label}{loading ? ' …' : ''}</span>
								<span class="hint">{it.hint}</span>
							</button>
						{/each}
						<div class="timing" role="group" aria-label="Tone of the sampled sounds">
							<span class="hint">Tone of the sampled sounds</span>
							<span class="nudge">
								<button
									type="button"
									onclick={() => player.nudgeTone(-1)}
									disabled={s.instrumentTone <= -TONE_LIMIT_DB}
									aria-label="Darker by 1 decibel"
									title="Darker">&minus;</button
								>
								<output aria-live="polite" data-testid="instrument-tone">{toneText}</output>
								<button
									type="button"
									onclick={() => player.nudgeTone(1)}
									disabled={s.instrumentTone >= TONE_LIMIT_DB}
									aria-label="Brighter by 1 decibel"
									title="Brighter">+</button
								>
								<button
									type="button"
									onclick={() => player.set({ instrumentTone: 0 })}
									disabled={s.instrumentTone === 0}
									aria-label="Tone as made"
									title="Back to the tone as made">0</button
								>
							</span>
						</div>
						<div class="timing" role="group" aria-label="Timing of the sampled sounds">
							<span class="hint">Timing of the sampled sounds</span>
							<span class="nudge">
								<button
									type="button"
									onclick={() => player.nudgeOffset(-5)}
									disabled={s.instrumentOffset <= -OFFSET_LIMIT_MS}
									aria-label="Later by 5 milliseconds"
									title="Later by 5 ms">&minus;</button
								>
								<output aria-live="polite" data-testid="instrument-offset">{offsetText}</output>
								<button
									type="button"
									onclick={() => player.nudgeOffset(5)}
									disabled={s.instrumentOffset >= OFFSET_LIMIT_MS}
									aria-label="Earlier by 5 milliseconds"
									title="Earlier by 5 ms">+</button
								>
								<button
									type="button"
									onclick={() => player.set({ instrumentOffset: 0 })}
									disabled={s.instrumentOffset === 0}
									aria-label="Timing as measured"
									title="Back to the measured timing">0</button
								>
							</span>
						</div>
					</div>
				{/if}
			</div>

			<div class="group volume" onwheel={wheel} role="group" aria-label="Volume">
				<button
					type="button"
					onclick={() => player.toggleMute()}
					aria-label={s.muted ? 'Unmute' : 'Mute'}
					aria-pressed={s.muted}
					title="Mute ( M )"
					data-testid="mute"
				>
					<Icon name={volumeIcon} />
				</button>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={s.muted ? 0 : s.volume}
					oninput={(e) => player.setVolume(Number(e.currentTarget.value))}
					aria-label="Volume"
					data-testid="volume"
				/>
			</div>
			<div class="group speedgroup">
				<button
					type="button"
					class="speed"
					class:on={s.rate !== 1}
					onclick={() => (speedOpen = !speedOpen)}
					aria-haspopup="true"
					aria-expanded={speedOpen}
					aria-label={`Speed ${s.rate.toFixed(2)} times. Change`}
					title="Speed, pitch kept ( Shift+, and Shift+. )"
					data-testid="speed"
				>
					{s.rate === 1 ? '1×' : `${s.rate.toFixed(2).replace(/0$/, '')}×`}
				</button>
				{#if speedOpen}
					<div class="menu" role="menu" aria-label="Speed">
						{#each SPEEDS as r (r)}
							<button
								type="button"
								role="menuitemradio"
								aria-checked={s.rate === r}
								class:on={s.rate === r}
								onclick={() => {
									player.setRate(r);
									speedOpen = false;
								}}>{r}×</button
							>
						{/each}
						<span class="note">The pitch stays</span>
					</div>
				{/if}
			</div>
			<div class="group tools">
				<button
					type="button"
					class:on={player.panel === 'pieces'}
					onclick={() => player.togglePanel('pieces')}
					aria-label="Pieces"
					aria-expanded={player.panel === 'pieces'}
					title="Pieces ( P )"
					data-testid="pieces"
				>
					<Icon name="list" />
				</button>
				<button
					type="button"
					class:on={player.panel === 'info'}
					onclick={() => player.togglePanel('info')}
					aria-label="What am I hearing"
					aria-expanded={player.panel === 'info'}
					title="What am I hearing ( I )"
					data-testid="info"
				>
					<Icon name="info" />
				</button>
				<button
					type="button"
					class:on={player.panel === 'effects'}
					onclick={() => player.togglePanel('effects')}
					aria-label="Effects"
					aria-expanded={player.panel === 'effects'}
					title="Effects ( E )"
					data-testid="effects"
				>
					<Icon name="effects" />
				</button>
				<button
					type="button"
					class:on={player.panel === 'jump'}
					onclick={() => player.togglePanel('jump')}
					aria-label="Go to a piece and bar"
					aria-expanded={player.panel === 'jump'}
					title="Go to a piece and bar ( J )"
					data-testid="goto"
				>
					<Icon name="goto" />
				</button>
				<button
					type="button"
					onclick={() => player.copyLink()}
					aria-label="Copy a link to this bar"
					title="Copy a link to this bar"
				>
					<Icon name="link" />
				</button>
				<button
					type="button"
					class:on={player.panel === 'help'}
					onclick={() => player.togglePanel('help')}
					aria-label="Keyboard shortcuts"
					aria-expanded={player.panel === 'help'}
					title="Keyboard shortcuts ( ? )"
				>
					<Icon name="help" />
				</button>
				<button
					type="button"
					onclick={() => player.onfullscreen()}
					aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'}
					title="Fullscreen ( F )"
					data-testid="fullscreen"
				>
					<Icon name={fullscreen ? 'exit-fullscreen' : 'fullscreen'} />
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/*
	 * The skin. The panel is a piece of hardware: brushed graphite with a red felt pinstripe along its top edge (the red
	 * of the keys' felt), walnut cheeks at its ends as on a Moog, banks of buttons sunk into the face with a red LED over
	 * the ones that are on (Nord, Virus), a display in amber (Clavinova, a mixer's), and a fader for the volume. The
	 * seek strip above it is the track overview of a DJ program (SeekBar.svelte).
	 */
	.bar {
		--led: #ff4a3a;
		--lcd: #ff6a58;
		position: relative;
		padding: 0 22px 10px;
		color: var(--fg, #e8e8ee);
		font:
			13px/1.3 system-ui,
			sans-serif;
		background:
			linear-gradient(#a3162a, #6b0d18) top / 100% 2px no-repeat,
			repeating-linear-gradient(90deg, rgb(255 255 255 / 0.02) 0 1px, transparent 1px 3px),
			linear-gradient(#2b2e35, #1b1d22 55%, #121418);
		border-top: 1px solid rgb(255 255 255 / 0.16);
		box-shadow: 0 -10px 34px rgb(0 0 0 / 0.65);
		padding-top: 2px;
		padding-bottom: max(10px, env(safe-area-inset-bottom));
		padding-left: max(22px, env(safe-area-inset-left));
		padding-right: max(22px, env(safe-area-inset-right));
	}
	.bar::before,
	.bar::after {
		content: '';
		position: absolute;
		top: 2px;
		bottom: 0;
		width: 12px;
		background:
			repeating-linear-gradient(178deg, rgb(255 255 255 / 0.04) 0 2px, rgb(0 0 0 / 0.06) 2px 5px),
			linear-gradient(90deg, #3d2517, #5d3b24 45%, #2e1b10);
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12);
	}
	.bar::before {
		left: 0;
		border-right: 1px solid #0b0705;
	}
	.bar::after {
		right: 0;
		border-left: 1px solid #0b0705;
	}
	/* one toolbar: the views at the left; in the middle repeat and loop, the transport and the display; at the right the voices,
	   the volume, the speed and the panel buttons. On a narrow screen the transport comes first and the rest wraps below it. */
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px 10px;
	}
	.mid,
	.rightbank {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px 10px;
	}
	.transport {
		order: -1;
	}
	@media (min-width: 1280px) {
		.row {
			flex-wrap: nowrap;
		}
		/* the views stay at the left edge, the repeat buttons, the transport and the display are centred in the space between
		   them and the right-hand bank (voices, volume, speed, panels), which stays at the right edge */
		.mid {
			flex-wrap: nowrap;
			margin-inline: auto;
		}
		.rightbank {
			flex-wrap: nowrap;
		}
		.transport {
			order: 0;
		}
	}

	/* a bank of buttons sunk into the face */
	.group {
		display: flex;
		align-items: center;
		gap: 3px;
		position: relative;
		padding: 3px;
		border-radius: 9px;
		background: #0c0d10;
		box-shadow:
			inset 0 1px 3px #000,
			0 1px 0 rgb(255 255 255 / 0.08);
	}
	.group > button {
		position: relative;
		display: inline-grid;
		place-items: center;
		min-width: 34px;
		height: 34px;
		padding: 0 5px;
		border: 1px solid #060709;
		border-radius: 6px;
		background: linear-gradient(#444851, #2a2d34 55%, #23262c);
		color: #dde1e8;
		font: inherit;
		cursor: pointer;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.17),
			0 1px 2px rgb(0 0 0 / 0.7);
	}
	.group > button:hover:not(:disabled) {
		background: linear-gradient(#4e535d, #30343b 55%, #282b32);
	}
	.group > button:active:not(:disabled) {
		transform: translateY(1px);
		background: linear-gradient(#202328, #2b2e35);
		box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.8);
	}
	.group > button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.group > button:focus-visible,
	input:focus-visible,
	.lcd .time:focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: 1px;
	}
	/* a lit button has a red LED over it */
	.group > button.on {
		color: #fff;
	}
	.group > button.on::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 50%;
		width: 14px;
		height: 2px;
		margin-left: -7px;
		border-radius: 1px;
		background: var(--led);
		box-shadow: 0 0 6px var(--led);
	}
	.group > button[aria-pressed='true']:not(.voice)::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 50%;
		width: 14px;
		height: 2px;
		margin-left: -7px;
		border-radius: 1px;
		background: var(--led);
		box-shadow: 0 0 6px var(--led);
	}

	/* the big round button: a ring of light while it plays */
	/* an instrument loads from files a person has asked for: a thin bar fills under the icon */
	.group > .instr.busy::before {
		content: '';
		position: absolute;
		left: 6px;
		bottom: 4px;
		height: 2px;
		width: calc((100% - 12px) * var(--p, 0%) / 100%);
		background: var(--lcd);
		box-shadow: 0 0 5px var(--lcd);
	}
	.group > .play {
		min-width: 52px;
		height: 52px;
		border-radius: 50%;
		background: radial-gradient(circle at 50% 28%, #727885, #393d46 58%, #23262c);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.28),
			0 2px 4px rgb(0 0 0 / 0.8);
	}
	.group > .play.playing {
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.28),
			0 0 0 2px #0c0d10,
			0 0 0 3px rgb(255 74 58 / 0.95),
			0 0 14px rgb(255 74 58 / 0.55);
	}

	/* the display */
	.lcd {
		display: grid;
		gap: 2px;
		min-width: 140px;
		max-width: 220px;
		padding: 5px 12px 6px;
		border-radius: 6px;
		background: linear-gradient(#06090b, #0d1215);
		box-shadow:
			inset 0 1px 5px #000,
			inset 0 0 0 1px #000,
			0 1px 0 rgb(255 255 255 / 0.12);
		color: var(--lcd);
		font:
			600 12px/1.2 ui-monospace,
			'Cascadia Mono',
			Consolas,
			monospace;
		text-shadow: 0 0 7px rgb(255 74 58 / 0.45);
	}
	.place {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 11px;
	}
	.title {
		font: inherit;
	}
	.dim {
		color: rgb(255 106 88 / 0.94); /* 0.85 left the bar number at 4.48:4.5 in Firefox */
	}
	.lcd .time {
		justify-self: start;
		display: inline-flex;
		min-width: 0;
		height: auto;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: none;
		color: var(--lcd);
		font:
			600 21px/1.1 ui-monospace,
			'Cascadia Mono',
			Consolas,
			monospace;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		text-shadow: 0 0 9px rgb(255 74 58 / 0.6);
		cursor: pointer;
	}
	.lcd .time .dim {
		font-size: 15px;
	}

	/* the volume is a fader */
	.volume input {
		-webkit-appearance: none;
		appearance: none;
		width: 84px;
		height: 30px;
		margin: 0 4px;
		background: transparent;
		cursor: pointer;
	}
	.volume input::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(#000, #16181c);
		box-shadow: 0 1px 0 rgb(255 255 255 / 0.12);
	}
	.volume input::-moz-range-track {
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(#000, #16181c);
		box-shadow: 0 1px 0 rgb(255 255 255 / 0.12);
	}
	.volume input::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 24px;
		margin-top: -9px;
		border: 1px solid #000;
		border-radius: 3px;
		background:
			linear-gradient(90deg, transparent 5px, #ff4a3a 5px 7px, transparent 7px),
			linear-gradient(#6a707c, #353941 50%, #2b2e35);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.3),
			0 2px 3px rgb(0 0 0 / 0.8);
	}
	.volume input::-moz-range-thumb {
		width: 12px;
		height: 22px;
		border: 1px solid #000;
		border-radius: 3px;
		background:
			linear-gradient(90deg, transparent 5px, #ff4a3a 5px 7px, transparent 7px),
			linear-gradient(#6a707c, #353941 50%, #2b2e35);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.3),
			0 2px 3px rgb(0 0 0 / 0.8);
	}
	.group > .speed {
		min-width: 50px;
		font:
			600 13px/1 ui-monospace,
			Consolas,
			monospace;
		font-variant-numeric: tabular-nums;
		color: #ff8c7c;
		text-shadow: 0 0 6px rgb(255 74 58 / 0.4);
	}
	.menu {
		position: absolute;
		bottom: 52px;
		right: 0;
		z-index: 2;
		display: grid;
		gap: 2px;
		min-width: 96px;
		padding: 6px;
		border: 1px solid #000;
		border-radius: 8px;
		background: linear-gradient(#25282e, #15171b);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.12),
			0 8px 26px rgb(0 0 0 / 0.8);
	}
	.menu button {
		display: flex;
		justify-content: start;
		height: 34px;
		padding: 0 12px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font:
			600 13px/1 ui-monospace,
			Consolas,
			monospace;
		cursor: pointer;
		align-items: center;
	}
	.menu button:hover {
		background: rgb(255 255 255 / 0.1);
	}
	.menu button.on {
		color: var(--lcd);
		background: rgb(255 86 69 / 0.1);
	}
	.menu button:focus-visible {
		outline: 2px solid #8ab4ff;
	}
	/* the sound menu: a name over a line of what it is, and a bar that fills while it loads */
	.imenu {
		min-width: 270px;
	}
	.imenu > button {
		position: relative;
		display: grid;
		gap: 2px;
		height: auto;
		padding: 7px 12px;
		text-align: left;
	}
	.imenu .name {
		font:
			600 13px/1.2 system-ui,
			sans-serif;
	}
	.imenu .hint {
		font:
			11px/1.2 system-ui,
			sans-serif;
		color: #9aa0ad;
	}
	.imenu > button.loading::after {
		content: '';
		position: absolute;
		left: 12px;
		bottom: 3px;
		height: 2px;
		width: calc((100% - 24px) * var(--p, 0%) / 100%);
		background: var(--lcd);
		box-shadow: 0 0 5px var(--lcd);
	}
	.timing {
		display: grid;
		gap: 4px;
		margin-top: 4px;
		padding: 8px 12px 4px;
		border-top: 1px solid rgb(255 255 255 / 0.12);
	}
	.nudge {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.nudge output {
		min-width: 64px;
		text-align: center;
		font:
			600 13px ui-monospace,
			Consolas,
			monospace;
		font-variant-numeric: tabular-nums;
		color: var(--lcd);
	}
	.nudge button {
		min-width: 32px;
		height: 28px;
		padding: 0 8px;
		border: 1px solid #060709;
		border-radius: 5px;
		background: linear-gradient(#444851, #2a2d34);
		color: #dde1e8;
		font:
			600 14px system-ui,
			sans-serif;
		cursor: pointer;
		justify-content: center;
	}
	.nudge button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.note {
		padding: 4px 10px 2px;
		font-size: 11px;
		color: #9aa0ad;
	}

	/* a voice: a lens of its own colour, dark glass when hidden */
	.voice {
		min-width: 32px !important;
	}
	.dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #fff9, var(--c) 45%);
		box-shadow:
			0 0 0 2px #060709,
			0 0 9px var(--c);
		transition:
			opacity 0.15s,
			box-shadow 0.15s;
	}
	.voice.off .dot {
		background: #15171b;
		box-shadow:
			0 0 0 2px #060709,
			inset 0 0 0 2px color-mix(in srgb, var(--c) 45%, transparent);
		opacity: 0.8;
	}
	@media (min-width: 1400px) {
		.volume input {
			width: 104px;
		}
	}
	@media (min-width: 1500px) {
		.volume input {
			width: 160px;
		}
	}
	@media (max-width: 760px) {
		.place {
			display: none;
		}
		.lcd {
			min-width: 0;
			padding: 4px 10px;
		}
		.volume input {
			width: 64px;
		}
	}
	@media (pointer: coarse) {
		.group > button {
			min-width: 44px;
			height: 44px;
		}
		.group > .play {
			min-width: 56px;
			height: 56px;
		}
		.voice {
			min-width: 44px !important;
		}
		.lcd {
			padding-block: 0;
		}
		.lcd .time {
			min-height: 44px;
			align-items: center;
		}
		.volume input {
			display: none; /* the device's own volume keys do this on a phone */
		}
	}
</style>
