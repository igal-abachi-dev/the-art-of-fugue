<script lang="ts">
	/** One set of line icons for the whole interface (24 px grid, drawn with the current colour). */
	export type IconName =
		| 'play'
		| 'pause'
		| 'stop'
		| 'prev'
		| 'next'
		| 'back'
		| 'forward'
		| 'volume'
		| 'volume-low'
		| 'muted'
		| 'repeat'
		| 'repeat-one'
		| 'loop'
		| 'list'
		| 'info'
		| 'effects'
		| 'help'
		| 'fullscreen'
		| 'exit-fullscreen'
		| 'close'
		| 'link'
		| 'speed'
		| 'score'
		| 'spectrogram'
		| 'goto'
		| 'piano';

	interface Props {
		name: IconName;
		size?: number;
	}
	let { name, size = 22 }: Props = $props();

	const PATHS: Record<IconName, string> = {
		play: 'M7 4.5v15l12-7.5z',
		pause: 'M6.5 4.5h3.8v15H6.5zM13.7 4.5h3.8v15h-3.8z',
		stop: 'M6 6h12v12H6z',
		prev: 'M6 5v14M19 5.5v13L9 12z',
		next: 'M18 5v14M5 5.5v13L15 12z',
		back: 'M12 5a7 7 0 1 1-6.6 4.7M12 2l-3.5 3L12 8M8.6 12.4h1.1v4.4M13 12.4h2.1v4.4H13z',
		forward: 'M12 5a7 7 0 1 0 6.6 4.7M12 2l3.5 3L12 8M8.6 12.4h1.1v4.4M13 12.4h2.1v4.4H13z',
		volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12',
		'volume-low': 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6',
		muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9.5l5 5M20.5 9.5l-5 5',
		repeat: 'M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3',
		'repeat-one':
			'M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3M11.2 10.5l1.4-.9v5.2',
		loop: 'M3 12h3M18 12h3M6 8v8M18 8v8M6 12h12',
		list: 'M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01',
		info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01',
		effects: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 4.5v5M7 14.5v5',
		help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.4-1 .9-1 1.6M12 16.8v.01',
		fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
		'exit-fullscreen': 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
		close: 'M6 6l12 12M18 6L6 18',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
		speed: 'M4 17a8 8 0 1 1 16 0M12 17l4-5',
		score: 'M3 8h18M3 12h18M3 16h18M9.5 16.6a2 1.5 0 1 0 .01 0M11.5 15.6V6l3.6 1.6',
		spectrogram: 'M4 20v-6M8 20V9M12 20v-8M16 20V5M20 20v-7',
		goto: 'M4 5v14M8 12h11M15 7l5 5-5 5',
		piano:
			'M3 6h18v12H3zM7.5 12.5V18M12 12.5V18M16.5 12.5V18M6.2 6h2.6v6.5H6.2zM10.7 6h2.6v6.5h-2.6zM15.2 6h2.6v6.5h-2.6z'
	};
	const FILLED = new Set<IconName>(['play', 'pause', 'stop']);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={FILLED.has(name) ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d={PATHS[name]} />
</svg>
