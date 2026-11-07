/**
 * The sampler (T8.1.2): the notes of the piece, played by an instrument's samples (piano, harpsichord, organ) instead of the
 * recording.
 *
 * The recording keeps playing, silenced on its own gain node (`AudioGraph.setRecordingAudible`): it is the master clock,
 * so the picture, the bars, the score and the loop do not know that anything changed. The sampler reads that clock every
 * 40 ms and, for every note that starts in the next 0.3 s of the piece, starts a sample on the audio context at the
 * moment the recording would have played it. The notes and their times are the aligned timings of the recording, so
 * the piano keeps the performer's phrasing (the rights consequence is in docs/sampler.md).
 *
 * What it does with the clock:
 * - while the recording plays the notes of the next `LOOKAHEAD_S` are scheduled once each (`#scheduledTo` is the end of
 *   what has been handed to the context);
 * - a pause, a seek, a stall or a change of speed throws away what was scheduled (the voices are damped in 30 ms) and starts
 *   again from the playhead; notes already sounding at that moment are not restarted (a piano note is a strike, not a tone);
 * - the speed (0.5 to 1.5) moves the notes in time but not the samples: pitch stays;
 * - in a hidden tab the timer runs about once a second, so it schedules 1.6 s ahead there.
 *
 * Where a note lands (the timing):
 * - The aligned onset of a note lies a median 26 ms *after* the instant the recording's level rises fastest (`docs/sync-report.md`),
 *   so the sampler lines up the instant each sample's level rises fastest (`Sample.rise`) with the aligned onset less
 *   `ATTACK_LEAD_S`, which puts the strike where the recording's strike is, not where the data's mark is. A sample that speaks
 *   slowly (a pipe) and one that is struck (a harpsichord) are then placed by the same rule.
 * - `ctx.currentTime` moves in steps of one output buffer (about 10 ms), so reading it afresh at every tick would move every
 *   group of notes by up to a buffer, one way or the other. The relation between the clock and the context's time is held
 *   (`#anchor`): its upper quartile over the last second, as a reading can only be late, never early.
 * - Each instrument has a `delay`, measured: the strike of a sample as the output shows it is not exactly where `Sample.rise`
 *   puts it (a soft attack, a different transform), so `pnpm sampler-check` reads both the recording's and the instrument's
 *   strike in the same run, the same way, over the reference points of the sync check, and the difference is built in.
 * - The listener can move the whole instrument earlier or later (`SamplerHost.offset`), for a device whose output delays the
 *   two paths differently.
 */

import type { NoteWindow } from '../playback/window.js';
import { DEFAULT_LEAD_S, type Bank, type Sample } from './bank.js';
import type { RankOf } from './registration.js';
import { impulseResponse } from './reverb.js';
import { playTimes } from './times.js';

export const LOOKAHEAD_S = 0.3;
export const LOOKAHEAD_HIDDEN_S = 1.6;
export const TICK_MS = 40;
/** the damper: time constant of a released note, seconds */
export const RELEASE_TAU = 0.07;
/** a voice that is dropped for another (a seek, too many at once) is damped faster */
export const DAMP_TAU = 0.03;
/** at most this many sources sound at once: a note of two layers is two */
export const MAX_VOICES = 96;
/** where the tone control's shelf begins, Hz */
export const TONE_HZ = 2500;
/** The strike of the recording comes this long before the aligned onset of its note (see `DEFAULT_LEAD_S`). */
export const ATTACK_LEAD_S = DEFAULT_LEAD_S;
/** how many ticks (40 ms each) of the clock-to-context relation are kept */
const ANCHOR_TICKS = 25;
/** a reading that differs from the held relation by more than this is a discontinuity (the context was suspended), seconds */
const ANCHOR_BREAK_S = 0.05;

/** what the sampler needs from the audio context */
export interface SamplerContext {
	readonly currentTime: number;
	createGain(): GainNode;
	createBufferSource(): AudioBufferSourceNode;
	/** present in a browser: needed for the room of an instrument that has one */
	readonly sampleRate?: number;
	createBuffer?(channels: number, length: number, sampleRate: number): AudioBuffer;
	createConvolver?(): ConvolverNode;
	createBiquadFilter?(): BiquadFilterNode;
}

export interface SamplerHost {
	ctx: SamplerContext;
	/** the clock, in seconds on the recording's timeline */
	now(): number;
	/** changes whenever the clock jumps (a seek, a snap) */
	epoch(): number;
	/** playback speed */
	rate(): number;
	/** the recording is playing (not paused, buffering or ended) */
	playing(): boolean;
	/** the note windows of the pieces that have notes between two times */
	windows(from: number, to: number): NoteWindow[];
	/** a hidden tab runs its timers slowly */
	hidden?(): boolean;
	/** the organ's registration score for the piece a window belongs to: which rank each voice plays when (`registration.ts`) */
	registration?(win: NoteWindow): RankOf | undefined;
	/** the listener's tone setting for the sampled instruments, dB at the top (negative: darker); default 0 */
	tone?(): number;
	/** seconds the notes are moved earlier (negative: later), the listener's own correction of the timing; default 0 */
	offset?(): number;
}

interface Playing {
	source: AudioBufferSourceNode;
	gain: GainNode;
	/** context time at which it started */
	at: number;
}

/** The gain of a swell (`Bank.sustain`) at `t` seconds into a note: straight lines in amplitude between its points, held after. */
export function sustainGain(points: readonly [number, number][], t: number): number {
	const amp = (db: number) => 10 ** (db / 20);
	if (!points.length || t <= points[0][0]) return points.length ? amp(points[0][1]) : 1;
	for (let k = 1; k < points.length; k++) {
		if (t <= points[k][0]) {
			const [t0, d0] = points[k - 1];
			const [t1, d1] = points[k];
			return amp(d0) + ((amp(d1) - amp(d0)) * (t - t0)) / (t1 - t0);
		}
	}
	return amp(points[points.length - 1][1]);
}

/** How loud a note is, 0..1, from its velocity byte: the recording's own dynamics, from a third to the full strike. */
export function noteLevel(vel: number): number {
	return 0.3 + 0.7 * (Math.max(0, Math.min(255, vel)) / 255);
}

export class Sampler {
	/** connect this to the graph: it is the sum of all voices */
	readonly output: GainNode;
	/** counts for the HUD and the browser check */
	readonly stats = { scheduled: 0, voices: 0, resets: 0, missing: 0 };
	/** the last note handed to the context: when in the piece and when on the context's clock */
	last: { tOn: number; when: number; pitch: number } | null = null;

	readonly #host: SamplerHost;
	readonly #bank: Bank;
	#voices: Playing[] = [];
	#timer: ReturnType<typeof setInterval> | null = null;
	#scheduledTo: number | null = null;
	#epoch = -1;
	#rate = 1;
	/** recent readings of (context time - clock time / speed): constant while the recording plays on at one speed */
	#readings: number[] = [];
	/** where the voices connect: the output, or a bus that is also sent through a room */
	#bus: GainNode;
	/** the tone control's filter, if the sampler has one */
	#tone: BiquadFilterNode | null = null;

	constructor(host: SamplerHost, bank: Bank, level = bank.level ?? 0.5) {
		this.#host = host;
		this.#bank = bank;
		this.output = host.ctx.createGain();
		this.output.gain.value = level;
		this.#bus = this.output;
		const room = bank.reverb;
		const ctx = host.ctx;
		let tail: AudioNode | null = null; // the end of the tone correction, if there is one
		if ((bank.eq?.length || host.tone) && ctx.createBiquadFilter) {
			// the voices go to a bus, through the instrument's tone correction and the listener's tone control, and on to the
			// output (and the room)
			this.#bus = ctx.createGain();
			tail = this.#bus;
			for (const band of bank.eq ?? []) {
				const f = ctx.createBiquadFilter();
				f.type = band.type;
				f.frequency.value = band.freq;
				f.gain.value = band.gain;
				if (band.q !== undefined) f.Q.value = band.q;
				tail.connect(f);
				tail = f;
			}
			if (host.tone) {
				// the tone control: a shelf at the top of the sound, in dB, moved by the listener
				const f = ctx.createBiquadFilter();
				f.type = 'highshelf';
				f.frequency.value = TONE_HZ;
				f.gain.value = host.tone();
				tail.connect(f);
				tail = f;
				this.#tone = f;
			}
		}
		if (room && ctx.createConvolver && ctx.createBuffer && ctx.sampleRate) {
			// the voices go to a bus; it goes to the output as it is and, a little of it, through the room
			if (!tail) {
				this.#bus = ctx.createGain();
				tail = this.#bus;
			}
			const [l, r] = impulseResponse(ctx.sampleRate, room.rt60);
			const buffer = ctx.createBuffer(2, l.length, ctx.sampleRate);
			buffer.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
			buffer.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
			const convolver = ctx.createConvolver();
			convolver.buffer = buffer;
			const wet = ctx.createGain();
			wet.gain.value = room.mix;
			tail.connect(this.output);
			tail.connect(convolver);
			convolver.connect(wet);
			wet.connect(this.output);
		} else if (tail) {
			tail.connect(this.output);
		}
	}

	/** Set the tone control (dB at the top, negative darker). */
	setTone(db: number): void {
		if (!this.#tone) return;
		const t = this.#host.ctx.currentTime;
		this.#tone.gain.setTargetAtTime(db, t, 0.03);
	}

	start(): void {
		if (this.#timer !== null) return;
		this.#timer = setInterval(() => this.tick(), TICK_MS);
	}

	/** Stop scheduling and damp what sounds. */
	stop(): void {
		if (this.#timer !== null) clearInterval(this.#timer);
		this.#timer = null;
		this.#reset();
	}

	dispose(): void {
		this.stop();
		try {
			this.output.disconnect();
		} catch {
			/* not connected */
		}
	}

	/** One look at the clock: schedule what is due. Called by the timer; public for tests. */
	tick(): void {
		const h = this.#host;
		if (!h.playing()) {
			if (this.#scheduledTo !== null) this.#reset();
			return;
		}
		const t = h.now();
		const rate = h.rate();
		const epoch = h.epoch();
		if (this.#scheduledTo === null || epoch !== this.#epoch || rate !== this.#rate) {
			this.#reset();
			this.#epoch = epoch;
			this.#rate = rate;
			// the note that begins right at the playhead belongs to the new start
			this.#scheduledTo = t - 0.02;
		}
		const horizon = t + (h.hidden?.() ? LOOKAHEAD_HIDDEN_S : LOOKAHEAD_S) * rate;
		const from = this.#scheduledTo;
		if (horizon <= from) return;
		const ctxNow = h.ctx.currentTime;
		const anchor = this.#anchor(ctxNow - t / rate);
		// the recording's lead is in its own time (twice as long at half speed); the instrument's own delay is in the sample's
		const lead = ATTACK_LEAD_S / rate - (this.#bank.delay ?? 0) + (h.offset?.() ?? 0);
		for (const win of h.windows(from, horizon)) {
			win.startedBetween(from, horizon);
			for (let i = win.startedStart; i < win.startedEnd; i++)
				this.#play(win, i, rate, ctxNow, anchor, lead);
		}
		this.#scheduledTo = horizon;
	}

	/** Take a reading of (context time - clock time / speed) and return the relation to schedule by. */
	#anchor(reading: number): number {
		const r = this.#readings;
		if (r.length && Math.abs(reading - this.#held(r)) > ANCHOR_BREAK_S) r.length = 0;
		r.push(reading);
		if (r.length > ANCHOR_TICKS) r.shift();
		return this.#held(r);
	}

	/** The upper quartile of the readings: a reading is late by the steps of the output buffer, never early. */
	#held(r: number[]): number {
		const sorted = [...r].sort((a, b) => a - b);
		// with only a few readings the latest-reading one (the largest) is the best there is
		return sorted[sorted.length < 4 ? sorted.length - 1 : Math.floor((sorted.length - 1) * 0.75)];
	}

	#play(
		win: NoteWindow,
		i: number,
		rate: number,
		ctxNow: number,
		anchor: number,
		lead: number
	): void {
		const n = win.notes;
		const bank = this.#bank;
		// a terraced instrument (the organ) plays by its registration score, a rank for each voice and passage; the others take the
		// note's own loudness. Without a score the organ's main voice, the full rank, plays.
		const voices =
			bank.registration === 'terraced' && bank.voicesIn
				? bank.voicesIn(n.pitch[i], this.#host.registration?.(win)?.(n.voice[i], n.t_on[i]) ?? 1)
				: bank.voices
					? bank.voices(n.pitch[i], Math.min(255, n.vel[i] * (bank.velScale ?? 1)))
					: [bank.voice(n.pitch[i])].filter((v): v is NonNullable<typeof v> => v !== null);
		if (!voices.length) {
			this.stats.missing++;
			return;
		}
		// the onset as the sampler plays it: the notes that the score begins together pulled together (`times.ts`)
		const tOn = playTimes(n)[i];
		const tau = bank.releaseTau ?? RELEASE_TAU;
		const ctx = this.#host.ctx;
		for (const voice of voices) {
			const sample: Sample = voice.sample;
			// the strike lands `lead` before the aligned onset. It lies `strike` into the buffer (read when the file was made); the
			// sample plays from its first sound, or from the strike if that is earlier, and begins early or late by what is between
			const strike = sample.rise ?? sample.attack;
			const from = Math.max(0, Math.min(sample.attack, strike));
			const rise = (strike - from) / voice.rate;
			const own = lead - (voice.delay ?? 0); // this layer's own delay, measured, on top of the instrument's
			const when = Math.max(ctxNow, anchor + tOn / rate - own - rise);
			const off = Math.max(when + 0.05, anchor + (n.t_off[i] + tOn - n.t_on[i]) / rate - own);
			const source = ctx.createBufferSource();
			const gain = ctx.createGain();
			source.buffer = sample.buffer;
			source.playbackRate.value = voice.rate;
			if (sample.loop) {
				source.loop = true;
				source.loopStart = sample.loop[0];
				source.loopEnd = sample.loop[1];
			}
			const level = (bank.dynamics === true ? noteLevel(n.vel[i]) : 1) * (voice.gain ?? 1);
			const swell = bank.sustain;
			gain.gain.setValueAtTime(level * (swell ? sustainGain(swell, 0) : 1), when);
			if (swell) {
				// the note is held up as it dies away, until it ends
				for (const [dt] of swell)
					if (dt > 0 && when + dt < off)
						gain.gain.linearRampToValueAtTime(level * sustainGain(swell, dt), when + dt);
			}
			// the damper comes down when the note ends
			gain.gain.setValueAtTime(level * (swell ? sustainGain(swell, off - when) : 1), off);
			gain.gain.setTargetAtTime(0, off, tau);
			source.connect(gain);
			gain.connect(this.#bus);
			const v: Playing = { source, gain, at: when };
			source.onended = () => this.#drop(v);
			source.start(when, from);
			source.stop(off + tau * 8);
			this.#voices.push(v);
			if (this.#voices.length > MAX_VOICES) this.#damp(this.#voices[0], ctxNow, DAMP_TAU);
			this.last = { tOn: n.t_on[i], when, pitch: n.pitch[i] };
		}
		this.stats.scheduled++;
		this.stats.voices = this.#voices.length;
	}

	#drop(v: Playing): void {
		const k = this.#voices.indexOf(v);
		if (k >= 0) this.#voices.splice(k, 1);
		this.stats.voices = this.#voices.length;
		try {
			v.source.disconnect();
			v.gain.disconnect();
		} catch {
			/* already gone */
		}
	}

	#damp(v: Playing, now: number, tau: number): void {
		try {
			v.gain.gain.cancelScheduledValues(now);
			v.gain.gain.setTargetAtTime(0, now, tau);
			v.source.stop(now + tau * 8);
		} catch {
			/* already stopped */
		}
	}

	/** Forget what was scheduled and damp every voice (a pause, a seek, a change of speed). */
	#reset(): void {
		this.#readings.length = 0;
		const now = this.#host.ctx.currentTime;
		for (const v of this.#voices) this.#damp(v, now, DAMP_TAU);
		if (this.#voices.length) this.stats.resets++;
		this.#scheduledTo = null;
	}
}

/** The piano's sampler under its old name. */
export { Sampler as PianoSampler };
