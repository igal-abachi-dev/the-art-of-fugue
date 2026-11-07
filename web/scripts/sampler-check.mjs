// The sampler mode in a real browser (E8): the recording, a piano, a harpsichord and a pipe organ.
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   node scripts/sampler-check.mjs [--engines msedge,firefox] [--url http://localhost:4173] [--seconds 30]
//
// What it checks:
//   * nothing of any instrument is fetched until it is asked for; then exactly its files (piano 30, harpsichord 28 and its list,
//     organ 27 and its list), once each, and a second time from the cache;
//   * the recording goes silent and stays the clock; each instrument sounds; the previous one is silent after a switch;
//   * the menu: four choices, the one in use checked, the `S` key cycling through them, a file that cannot be fetched leaving what
//     was sounding, a switch away while one loads cancelling it, the timing nudge kept in the settings;
//   * the TIMING. The recording is tapped where it leaves the element (before the gain that silences it) and the instrument where
//     everything joins (the analyser), both by an AudioWorklet that saves the raw samples with the context's own time stamp, in the
//     same run on the same time axis. The page plays through reference points of the sync check (`data/sync-reference.json`: notes
//     whose attack stands alone in the recording, evenly spread over it; `--points`, default 22): it seeks to 1.3 s before each and
//     plays through it. `tools/artfugue/sampler_timing.py` then reads the instant the level at the note's pitch rises fastest in each
//     tap (the way the alignment of the recording is judged, `syncref.py`); the difference is how much later (+) or earlier (-) the
//     instrument strikes than the recording. Needs the Python environment of `tools/` (without it the timing checks are skipped).
//     The runs are saved in data/work/sampler-timing/ and can be read again with `python -m artfugue.sampler_timing <file>`.

import { resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { begin } from './begin.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engines ?? 'msedge,firefox').split(',');
const POINTS = Number(args.points ?? 22);
const LIMIT_MS = Number(args.limit ?? 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
void resolve;

const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	firefox: () =>
		firefox.launch({
			firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
		})
};

async function waitFor(page, fn, arg, timeout = 8000) {
	const t0 = Date.now();
	for (;;) {
		const v = await page.evaluate(fn, arg).catch(() => null);
		if (v) return v;
		if (Date.now() - t0 > timeout) return null;
		await sleep(100);
	}
}

// ---- in the page: tap the recording and the instrument, as raw samples with the context's time stamp

const TAPS = async ({ refs }) => {
	const P = window.__player.player;
	const e = P.engine;
	const g = e.graph;
	const ctx = g.context;
	const code = `class Tap extends AudioWorkletProcessor {
		constructor() { super(); this.b = new Float32Array(128 * 32); this.k = 0; this.t0 = 0; }
		process(inputs) {
			if (this.k === 0) this.t0 = currentFrame / sampleRate;
			const ch = inputs[0] && inputs[0][0];
			if (ch) this.b.set(ch, this.k * 128);
			else this.b.fill(0, this.k * 128, this.k * 128 + 128);
			if (++this.k === 32) { this.port.postMessage({ t0: this.t0, data: this.b.slice() }); this.k = 0; }
			return true;
		}
	}
	registerProcessor('tap', Tap);`;
	const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
	if (!window.__tapLoaded) {
		await ctx.audioWorklet.addModule(url);
		window.__tapLoaded = true;
	}
	const make = (from) => {
		const node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1 });
		const chunks = [];
		node.port.onmessage = (m) => chunks.push(m.data);
		const sink = ctx.createGain();
		sink.gain.value = 0;
		from.connect(node);
		node.connect(sink);
		sink.connect(ctx.destination);
		return { chunks, node, sink, from };
	};
	const r = make(g.recordingSource);
	const i = make(g.analyser);
	const pairs = [];
	const timer = setInterval(() => pairs.push([ctx.currentTime, e.clock.now()]), 20);
	const nap = (ms) => new Promise((x) => setTimeout(x, ms));
	if (e.element.paused) await e.element.play();
	// each reference point of the recording (a note whose attack stands alone): seek to 1.3 s before it, play through it
	for (const ref of refs) {
		const from = ref.t_ref - 1.3;
		e.seek(from);
		const t0 = performance.now();
		while (performance.now() - t0 < 8000) {
			await nap(20);
			if (e.status === 'playing' && e.clock.now() > from + 0.05) break;
		}
		while (e.clock.now() < ref.t_ref + 0.55 && performance.now() - t0 < 12000) await nap(20);
	}
	clearInterval(timer);
	for (const t of [r, i]) {
		try {
			t.from.disconnect(t.node);
			t.node.disconnect();
			t.sink.disconnect();
		} catch {
			/* gone */
		}
	}
	await new Promise((x) => setTimeout(x, 150));
	const pack = (t) => {
		// the chunks follow each other without a gap: one run of samples from the first stamp
		const n = t.chunks.reduce((a, c) => a + c.data.length, 0);
		const all = new Float32Array(n);
		let at = 0;
		for (const c of t.chunks) {
			all.set(c.data, at);
			at += c.data.length;
		}
		const bytes = new Uint8Array(all.buffer);
		let bin = '';
		for (let k = 0; k < bytes.length; k += 0x8000)
			bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
		return { t0: t.chunks[0]?.t0 ?? 0, b64: btoa(bin) };
	};
	return { sr: ctx.sampleRate, rec: pack(r), ins: pack(i), pairs, refs };
};

/** the reference points of the sync check (notes whose attack stands alone in the recording), evenly spread over the recording */
function referencePoints(n) {
	const all = JSON.parse(readFileSync(resolve('../data/sync-reference.json'), 'utf8')).points.sort(
		(a, b) => a.t_ref - b.t_ref
	);
	if (all.length <= n) return all;
	return Array.from({ length: n }, (_, k) => all[Math.round((k * (all.length - 1)) / (n - 1))]);
}

const PYTHON = resolve('../tools/.venv/Scripts/python.exe');
const PYTHON_UNIX = resolve('../tools/.venv/bin/python');
const python = existsSync(PYTHON) ? PYTHON : existsSync(PYTHON_UNIX) ? PYTHON_UNIX : null;
/** the strike of an instrument against the recording's, by tools/artfugue/sampler_timing.py; null where there is no Python */
function timing(file) {
	if (!python) return null;
	const out = execFileSync(python, ['-m', 'artfugue.sampler_timing', file], {
		cwd: resolve('../tools'),
		env: { ...process.env, PYTHONPATH: '.', PYTHONIOENCODING: 'utf8' },
		maxBuffer: 1 << 28
	});
	return JSON.parse(out.toString('utf8'));
}

const ALL_INSTRUMENTS = [
	{ id: 'piano', files: 117, list: true, minLevel: 0.003 },
	{ id: 'harpsichord', files: 28, list: true, minLevel: 0.003 },
	// the organ's attack is slow and soft in the quiet rank: its strike is read to about +-40 ms, not +-8
	{ id: 'organ', files: 48, list: true, minLevel: 0.003, spread: 90 }
];
const INSTRUMENTS = ALL_INSTRUMENTS.filter(
	(i) => !args.only || args.only.split(',').includes(i.id)
);

let failed = 0;
const results = [];
for (const name of ENGINES) {
	const browser = await launchers[name]();
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	const checks = [];
	const check = (what, ok, detail = '') => {
		checks.push({ engine: name, what, ok: !!ok, detail });
		console.log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${what}${ok || !detail ? '' : '  ' + detail}`);
		if (!ok) failed++;
	};
	const errors = [];

	const open = async (route) => {
		const page = await ctx.newPage();
		page.on('pageerror', (e) => errors.push(String(e.message)));
		const requests = [];
		page.on('request', (r) => r.url().includes('/samples/') && requests.push(r.url()));
		if (route) await route(page);
		await page.goto(`${URL_BASE}/?x=1`, { waitUntil: 'load' });
		await begin(page);
		await waitFor(page, () => window.__player.player.engine.status === 'playing', null, 20000);
		await sleep(1200);
		await page.keyboard.press('Escape');
		return { page, requests };
	};
	const P = (page, f, a) => page.evaluate(f, a);
	const bring = (page) => page.mouse.move(640, 690); // the controls fade while it plays: bring them back
	const choose = async (page, id) => {
		await bring(page);
		if ((await page.getByTestId(`instrument-${id}`).count()) === 0)
			await page.getByTestId('instrument').click();
		await page.getByTestId(`instrument-${id}`).click();
	};
	const ofSamples = (requests, id) => requests.filter((u) => u.includes(`/samples/${id}/`));
	const level = (page, seconds = 0.6) =>
		P(
			page,
			async (seconds) => {
				const an = window.__player.player.engine.graph.analyser;
				const buf = new Float32Array(an.fftSize);
				let peak = 0;
				const t0 = performance.now();
				while (performance.now() - t0 < seconds * 1000) {
					an.getFloatTimeDomainData(buf);
					for (const v of buf) peak = Math.max(peak, Math.abs(v));
					await new Promise((r) => setTimeout(r, 10));
				}
				return peak;
			},
			seconds
		);
	const toBar12 = async (page) => {
		await P(page, () => {
			const e = window.__player.player.engine;
			e.element.pause();
			e.seekPlace({ piece: e.manifest.pieces.find((p) => p.id === 'c01'), bar: 12 });
		});
		await waitFor(page, () => window.__player.player.engine.window('c01') !== null, null, 10000);
		await sleep(900);
		await P(page, () => window.__player.player.engine.element.play());
		await sleep(900);
	};

	// ---- nothing is fetched before an instrument is asked for; the menu
	let { page, requests } = await open();
	check(
		'before any instrument is asked for, no sample is fetched',
		requests.length === 0,
		String(requests.length)
	);
	await bring(page);
	check(
		'the sound button is there and named',
		/sound/i.test((await page.getByTestId('instrument').getAttribute('aria-label')) ?? '') &&
			(await page.getByTestId('piano').count()) === 0
	);
	check(
		'the recording is heard',
		(await P(page, () => window.__player.player.engine.graph.recordingAudible)) === true
	);
	await page.getByTestId('instrument').click();
	const items = await page
		.locator('[role=menuitemradio][data-testid^=instrument-]')
		.allInnerTexts();
	check(
		'the menu offers the recording, the piano, the harpsichord and the pipe organ',
		items.length === 4 &&
			/recording/i.test(items[0]) &&
			/piano/i.test(items[1]) &&
			/harpsichord/i.test(items[2]) &&
			/organ/i.test(items[3]),
		JSON.stringify(items)
	);
	check(
		'the recording is the one in use',
		(await page.getByTestId('instrument-recording').getAttribute('aria-checked')) === 'true'
	);

	// ---- each instrument: its files, the silence of the recording, the sound
	await toBar12(page);
	const runs = {};
	for (const ins of INSTRUMENTS) {
		await choose(page, ins.id);
		const loading = await P(page, () => window.__player.player.instrumentLoading);
		check(
			`${ins.id}: the button says that it is loading`,
			loading === ins.id || (await P(page, () => window.__player.player.instrument)) === ins.id,
			String(loading)
		);
		const on = await waitFor(page, (id) => window.__player.player.instrument === id, ins.id, 60000);
		check(
			`${ins.id}: it loads and turns on`,
			!!on,
			await P(page, () => window.__player.player.instrument)
		);
		const mine = ofSamples(requests, ins.id);
		const files = mine.filter((u) => !u.includes('index.json'));
		check(
			`${ins.id}: exactly its ${ins.files} files were fetched, once each${ins.list ? ', and its list' : ''}`,
			files.length === ins.files &&
				new Set(files).size === ins.files &&
				mine.filter((u) => u.includes('index.json')).length === (ins.list ? 1 : 0),
			`${files.length} files, ${mine.length - files.length} lists`
		);
		const bytes = await P(
			page,
			(id) =>
				performance
					.getEntriesByType('resource')
					.filter((r) => r.name.includes(`/samples/${id}/`))
					.reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0),
			ins.id
		);
		console.log(`     ${ins.id}: ${(bytes / 1e6).toFixed(2)} MB of samples`);
		check(
			`${ins.id}: the recording is silent and still the clock`,
			(await P(page, () => window.__player.player.engine.graph.recordingAudible)) === false &&
				(await P(page, () => window.__player.player.engine.status)) === 'playing'
		);
		check(
			`${ins.id}: the menu shows it`,
			(await page.getByTestId(`instrument-${ins.id}`).getAttribute('aria-checked')) === 'true' &&
				(await page.getByTestId('instrument-recording').getAttribute('aria-checked')) === 'false'
		);
		await toBar12(page);
		const peak = await level(page);
		check(`${ins.id}: it sounds`, peak > ins.minLevel, String(peak));
		check(
			`${ins.id}: the sampler that is sounding is its own`,
			(await P(page, () => window.__player.player.sampler?.stats.scheduled ?? 0)) > 0
		);

		// the timing
		await toBar12(page);
		const raw = await P(page, TAPS, { refs: referencePoints(POINTS) });
		raw.instrument = ins.id;
		mkdirSync(resolve('../data/work/sampler-timing'), { recursive: true });
		const file = resolve(`../data/work/sampler-timing/${name}-${ins.id}.json`);
		writeFileSync(file, JSON.stringify(raw));
		const sum = timing(file);
		if (!sum) {
			console.log('     (no Python environment in ../tools/.venv: the timing is not read)');
			continue;
		}
		runs[ins.id] = sum;
		console.log(
			`     ${ins.id} strikes ${sum.median_ms >= 0 ? 'later' : 'earlier'} than the recording by ${Math.abs(sum.median_ms).toFixed(1)} ms ` +
				`(median of ${sum.read} of ${sum.points} reference points; mean ${sum.mean_ms >= 0 ? '+' : ''}${sum.mean_ms}, spread ${sum.sd_ms} ms, 10 to 90 %: ${sum.p10_ms} to ${sum.p90_ms} ms; ` +
				`the recording is heard ${sum.recording_late_median_ms} ms (spread ${sum.recording_late_sd_ms}) after the clock)`
		);
		if (sum.by_rank && Object.keys(sum.by_rank).length)
			console.log(
				`     ${ins.id} by rank: ` +
					Object.entries(sum.by_rank)
						.map(([k, v]) => `${k} ${v.median_ms >= 0 ? '+' : ''}${v.median_ms} ms (${v.n} notes)`)
						.join(', ')
			);
		check(
			`${ins.id}: enough reference points to read (at least 8)`,
			sum.enough,
			`${sum.read} of ${sum.points}`
		);
		check(
			`${ins.id}: it strikes with the recording (the median within ${LIMIT_MS} ms)`,
			Math.abs(sum.median_ms) <= LIMIT_MS,
			`${sum.median_ms} ms`
		);
		check(
			`${ins.id}: and each note keeps to it (the middle 80 % within ${ins.spread ?? 20} ms of each other)`,
			sum.p90_ms - sum.p10_ms <= (ins.spread ?? 20),
			`${sum.p10_ms} to ${sum.p90_ms} ms`
		);
	}

	// ---- a switch leaves the previous instrument silent; the same one again needs no download
	const before = requests.length;
	await choose(page, 'recording');
	await sleep(500);
	check(
		'the recording again: heard, and the organ silent after it',
		(await P(page, () => window.__player.player.engine.graph.recordingAudible)) === true &&
			(await P(page, () => window.__player.player.instrument)) === 'recording'
	);
	await choose(page, 'harpsichord');
	check(
		'the harpsichord again at once, with no second download',
		!!(await waitFor(
			page,
			() => window.__player.player.instrument === 'harpsichord',
			null,
			10000
		)) && requests.length === before,
		String(requests.length - before)
	);
	await choose(page, 'organ');
	await waitFor(page, () => window.__player.player.instrument === 'organ', null, 10000);
	await sleep(500);
	const harpVoices = await P(page, () => window.__player.player.sampler.stats.voices);
	check('and the organ is the one with voices', harpVoices >= 0);

	// ---- the S key cycles: organ -> recording -> piano -> harpsichord -> organ
	await page.keyboard.press('s');
	await sleep(400);
	check(
		'S: the organ gives way to the recording',
		(await P(page, () => window.__player.player.instrument)) === 'recording'
	);
	const seq = [];
	for (let k = 0; k < 3; k++) {
		await page.keyboard.press('s');
		await waitFor(
			page,
			(n) => window.__player.player.instrument !== n,
			seq.at(-1) ?? 'recording',
			10000
		);
		seq.push(await P(page, () => window.__player.player.instrument));
	}
	check(
		'S: then the piano, the harpsichord and the organ',
		seq.join() === 'piano,harpsichord,organ',
		seq.join()
	);
	check(
		'and none of that fetched anything again',
		requests.length === before,
		String(requests.length - before)
	);

	// ---- the timing nudge
	await bring(page);
	await page
		.getByTestId('instrument')
		.click()
		.catch(() => {});
	if ((await page.getByTestId('instrument-offset').count()) === 0)
		await page.getByTestId('instrument').click();
	check(
		'the timing reads 0 ms as measured',
		/^0 ms$/.test((await page.getByTestId('instrument-offset').innerText()).trim())
	);
	await page.getByRole('button', { name: 'Earlier by 5 milliseconds' }).click();
	await page.getByRole('button', { name: 'Earlier by 5 milliseconds' }).click();
	check(
		'two presses of + move the instruments 10 ms earlier, and the setting keeps it',
		(await P(page, () => window.__player.player.settings.instrumentOffset)) === 10 &&
			/10 ms/.test(await page.getByTestId('instrument-offset').innerText()) &&
			/instrumentOffset":10/.test(
				await P(page, () => localStorage.getItem('art-of-fugue.settings.v1'))
			)
	);
	check(
		'the tone reads as it was made',
		/as made/.test(await page.getByTestId('instrument-tone').innerText())
	);
	await page.getByRole('button', { name: 'Darker by 1 decibel' }).click();
	await page.getByRole('button', { name: 'Darker by 1 decibel' }).click();
	check(
		'two presses of the tone control make the instruments 2 dB darker, and the setting keeps it',
		(await P(page, () => window.__player.player.settings.instrumentTone)) === -2 &&
			/darker 2 dB/.test(await page.getByTestId('instrument-tone').innerText()) &&
			/instrumentTone":-2/.test(
				await P(page, () => localStorage.getItem('art-of-fugue.settings.v1'))
			)
	);
	await page.getByRole('button', { name: 'Tone as made' }).click();
	check(
		'and 0 puts the tone back',
		(await P(page, () => window.__player.player.settings.instrumentTone)) === 0
	);
	await page.getByRole('button', { name: 'Timing as measured' }).click();
	check(
		'and 0 puts it back',
		(await P(page, () => window.__player.player.settings.instrumentOffset)) === 0
	);
	await page.close();

	// ---- a file that cannot be fetched: what was sounding goes on
	({ page } = await open((p) => p.route('**/samples/organ/full-60.flac*', (r) => r.abort())));
	await choose(page, 'organ');
	const errTxt = await waitFor(
		page,
		() => window.__player.player.instrumentLoading === null,
		null,
		30000
	);
	check('an organ file that cannot be fetched ends the loading', !!errTxt);
	check(
		'and the recording is still heard, the menu says so',
		(await P(page, () => window.__player.player.engine.graph.recordingAudible)) === true &&
			(await P(page, () => window.__player.player.instrument)) === 'recording' &&
			(await page.getByTestId('instrument-recording').getAttribute('aria-checked')) === 'true'
	);
	await page.close();

	// ---- one that cannot be fetched while another sounds: the other goes on
	({ page } = await open((p) => p.route('**/samples/organ/full-60.flac*', (r) => r.abort())));
	await choose(page, 'piano');
	await waitFor(page, () => window.__player.player.instrument === 'piano', null, 30000);
	await choose(page, 'organ');
	await waitFor(page, () => window.__player.player.instrumentLoading === null, null, 30000);
	check(
		'the organ failing leaves the piano sounding',
		(await P(page, () => window.__player.player.instrument)) === 'piano' &&
			(await P(page, () => window.__player.player.engine.graph.recordingAudible)) === false
	);
	await page.close();

	// ---- switched away while one loads
	({ page } = await open((p) =>
		p.route('**/samples/harpsichord/**', async (r) => {
			await new Promise((x) => setTimeout(x, 150));
			await r.continue();
		})
	));
	await choose(page, 'harpsichord');
	await sleep(400);
	await choose(page, 'recording');
	await sleep(3500);
	check(
		'choosing the recording while one loads cancels it and leaves the recording',
		(await P(page, () => window.__player.player.instrument)) === 'recording' &&
			(await P(page, () => window.__player.player.instrumentLoading)) === null &&
			(await P(page, () => window.__player.player.engine.graph.recordingAudible)) === true
	);
	await page.close();

	check('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
	console.log(
		`\n     [${name}] strike against the recording (ms, + is later): ` +
			Object.entries(runs)
				.map(([k, v]) => `${k} ${v.median_ms >= 0 ? '+' : ''}${v.median_ms} (spread ${v.sd_ms})`)
				.join('   ')
	);
	results.push(...checks);
	await Promise.race([browser.close(), sleep(3000)]);
}
console.log(
	`\n${ENGINES.map((e) => `${e}: ${results.filter((r) => r.engine === e && r.ok).length}/${results.filter((r) => r.engine === e).length}`).join('   ')}`
);
process.exit(failed ? 1 : 0);
