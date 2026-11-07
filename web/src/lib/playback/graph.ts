/**
 * `<audio>` -> MediaElementSource -> Recording gain -> Analyser -> Gain -> destination (T3.1.1). The recording gain is
 * what the sampler mode (E8) turns down: the element keeps playing, as the master clock, but is not heard, and the
 * sampler's own output joins at the analyser (`connectInput`), so the loudness-driven visuals follow what is heard.
 *
 * Rules this module exists to keep:
 *
 * - The `AudioContext` is created and resumed inside a user gesture (`unlock()` is called from the Start
 *   click), never at import or construction time. Browsers keep a context created earlier suspended, and
 *   iOS Safari additionally requires `audio.play()` to be called synchronously in the same gesture, so
 *   `unlock()` does all its synchronous work first and returns the `resume()` promise without awaiting it.
 * - `createMediaElementSource` can be called once per element, and from then on the element's sound goes
 *   *only* through the graph: if the context is suspended the page is silent. `unlock()` is therefore the
 *   only place that makes the connection.
 * - A media element from another origin needs `crossOrigin = 'anonymous'` set *before* `src`, and the
 *   server must send CORS headers. Without both, `createMediaElementSource` outputs silence and the
 *   analyser reads zeros. The audio is same-origin today (T2.1.4); `needsCors` is the guard for the day
 *   it moves to object storage.
 */

export interface GraphOptions {
	/** factory, replaceable in tests */
	createContext?: () => AudioContext;
}

/** `AudioContext`, or the prefixed constructor of Safari before 14.1. Throws if there is neither. */
function defaultContext(): AudioContext {
	const w = globalThis as unknown as {
		AudioContext?: typeof AudioContext;
		webkitAudioContext?: typeof AudioContext;
	};
	const Ctor = w.AudioContext ?? w.webkitAudioContext;
	if (!Ctor) throw new Error('Web Audio is not available in this browser');
	return new Ctor({ latencyHint: 'interactive' });
}

export function needsCors(src: string, pageOrigin: string): boolean {
	try {
		return new URL(src, pageOrigin).origin !== pageOrigin;
	} catch {
		return false;
	}
}

/** Set `crossOrigin` when needed and then `src`, in that order. */
export function setMediaSource(el: HTMLMediaElement, src: string, pageOrigin: string): void {
	if (needsCors(src, pageOrigin)) el.crossOrigin = 'anonymous';
	else el.removeAttribute('crossorigin');
	el.src = src;
}

export class AudioGraph {
	readonly element: HTMLMediaElement;
	#ctx: AudioContext | null = null;
	#source: MediaElementAudioSourceNode | null = null;
	#analyser: AnalyserNode | null = null;
	#gain: GainNode | null = null;
	#recording: GainNode | null = null;
	#recordingAudible = true;
	#volume = 1;
	#muted = false;
	#failed: string | null = null;
	readonly #create: () => AudioContext;

	constructor(element: HTMLMediaElement, opts: GraphOptions = {}) {
		this.element = element;
		this.#create = opts.createContext ?? defaultContext;
	}

	/** True once the graph is connected (the element's sound now goes through the context). */
	get connected(): boolean {
		return this.#source !== null;
	}

	get context(): AudioContext | null {
		return this.#ctx;
	}

	/**
	 * The recording as it leaves the element, before the recording gain that the sampler mode turns down: what a browser check taps
	 * to compare the instruments' strikes with the recording's while the recording is silent. Null before `unlock()`.
	 */
	get recordingSource(): AudioNode | null {
		return this.#source;
	}

	/** Present after `unlock()`; null before it or if the Web Audio API is unavailable. */
	get analyser(): AnalyserNode | null {
		return this.#analyser;
	}

	get failure(): string | null {
		return this.#failed;
	}

	/** Output latency in seconds as reported by the browser (0 where it does not say). */
	get outputLatency(): number {
		const c = this.#ctx;
		if (!c) return 0;
		return (c.outputLatency || 0) + (c.baseLatency || 0);
	}

	/**
	 * Call from a click/keydown handler. Creates the context and connects the graph the first time,
	 * resumes it every time. The returned promise resolves when the context is running; do not await it
	 * before calling `element.play()`.
	 */
	unlock(): Promise<void> {
		if (!this.#ctx && !this.#failed) {
			try {
				this.#build();
			} catch (e) {
				// no Web Audio: the element still plays on its own, only analysis is lost
				this.#failed = e instanceof Error ? e.message : String(e);
				this.#ctx = null;
				this.#source = null;
			}
		}
		const ctx = this.#ctx;
		if (!ctx) return Promise.resolve();
		if (ctx.state === 'running') return Promise.resolve();
		return ctx.resume();
	}

	/** Keep a connected graph running (iOS sets the state to "interrupted" after calls and alarms). */
	ensureRunning(): Promise<void> {
		const ctx = this.#ctx;
		if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve();
		return ctx.resume();
	}

	/**
	 * The volume slider's position, 0..1. The sound follows a square law (slider 0.5 is a quarter of the amplitude, 12 dB
	 * down), which is how loudness is heard: a straight line makes the top of the slider do all the work. Applied on a gain
	 * node so it also works where `element.volume` is read-only (iOS).
	 */
	setVolume(v: number): void {
		this.#volume = Math.max(0, Math.min(1, v));
		this.#apply();
	}

	/**
	 * Whether the recording is heard. Off, the element still plays (it is the clock) and the analyser still sees whatever else
	 * is connected to it. Needs the graph: without Web Audio it returns false and nothing changes.
	 */
	setRecordingAudible(audible: boolean): boolean {
		const g = this.#recording;
		if (!g || !this.#ctx) return false;
		this.#recordingAudible = audible;
		const p = g.gain as AudioParam & { setTargetAtTime?: AudioParam['setTargetAtTime'] };
		if (p.setTargetAtTime) p.setTargetAtTime(audible ? 1 : 0, this.#ctx.currentTime ?? 0, 0.02);
		else p.value = audible ? 1 : 0;
		return true;
	}

	get recordingAudible(): boolean {
		return this.#recordingAudible;
	}

	/** Another sound source (the sampler's output): it joins at the analyser, ahead of the volume and the mute. */
	connectInput(node: AudioNode): boolean {
		if (!this.#analyser) return false;
		node.connect(this.#analyser);
		return true;
	}

	/** Silence without losing the slider's position (unmuting returns to it). */
	setMuted(muted: boolean): void {
		this.#muted = muted;
		this.#apply();
	}

	get volume(): number {
		return this.#volume;
	}

	get muted(): boolean {
		return this.#muted;
	}

	/** The gain the sound has now. */
	get gain(): number {
		return this.#muted ? 0 : this.#volume * this.#volume;
	}

	#apply(): void {
		if (this.#gain) this.#gain.gain.value = this.gain;
		else this.element.volume = this.gain;
	}

	/**
	 * Take the graph down and close the context. A page can only hold a few contexts, and an unclosed one keeps
	 * the audio hardware open. After this the element's sound is no longer routed anywhere; the caller is
	 * discarding the element.
	 */
	dispose(): void {
		const ctx = this.#ctx;
		for (const n of [this.#source, this.#recording, this.#analyser, this.#gain]) {
			try {
				n?.disconnect();
			} catch {
				/* already disconnected */
			}
		}
		this.#source = this.#recording = this.#analyser = this.#gain = null;
		this.#ctx = null;
		this.#failed = 'disposed';
		if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
	}

	#build(): void {
		const ctx = this.#create();
		const source = ctx.createMediaElementSource(this.element);
		const recording = ctx.createGain();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0.8;
		const gain = ctx.createGain();
		gain.gain.value = this.gain;
		source.connect(recording);
		recording.connect(analyser);
		analyser.connect(gain);
		gain.connect(ctx.destination);
		this.element.volume = 1; // level is controlled on the gain node from here on
		this.#ctx = ctx;
		this.#source = source;
		this.#recording = recording;
		this.#analyser = analyser;
		this.#gain = gain;
	}
}
