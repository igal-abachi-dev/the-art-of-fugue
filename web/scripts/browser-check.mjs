// Real-browser check of the playback engine (T2.1.5, T3.1.1, T3.1.2, T3.2.3).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm browser-check [--url http://localhost:4173] [--engines msedge,firefox,webkit] [--codecs opus,aac]
//
// For every engine and codec it opens /bench, presses Start, and measures: which codec the browser takes,
// whether sound reaches the analyser, whether the clock advances in real time, how a seek while playing
// and a seek while paused behave, the playback rate, and whether the server answers range requests.
// The results are printed as JSON and as a Markdown table row per run. These are Playwright's builds of
// the engines (or the installed Edge), not the retail Chrome/Firefox/Safari, and a headless machine has no
// audio hardware: it proves the code path, not what a person hears.

import { chromium, firefox, webkit } from 'playwright';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engines ?? 'msedge,firefox,webkit').split(',');
const CODECS = (args.codecs ?? 'opus,aac').split(',');

const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	chromium: () => chromium.launch(),
	firefox: () => firefox.launch(),
	webkit: () => webkit.launch()
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.error(`    ${m}`);

async function run(engineName, codec) {
	const out = { engine: engineName, codec, ok: false, notes: [] };
	let browser;
	try {
		browser = await launchers[engineName]();
	} catch (e) {
		out.notes.push(`could not launch: ${String(e.message).split('\n')[0]}`);
		return out;
	}
	try {
		const page = await browser.newPage();
		const audioResponses = [];
		page.on('response', (r) => {
			if (r.url().includes('/audio/')) {
				audioResponses.push({
					status: r.status(),
					range: r.headers()['content-range'] ?? null,
					type: r.headers()['content-type'] ?? null,
					accept: r.headers()['accept-ranges'] ?? null
				});
			}
		});
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e.message)));
		// start at bar 5 of Contrapunctus I so there is music right away
		await page.goto(`${URL_BASE}/bench?codec=${codec}&p=i&bar=5`, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__bench, null, { timeout: 15000 });

		out.canPlay = await page.evaluate(() => {
			const a = document.createElement('audio');
			return {
				opus: a.canPlayType('audio/webm; codecs=opus'),
				aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"')
			};
		});
		out.source = await page.evaluate(() => window.__bench.engine.source?.type ?? null);
		if (!out.source) {
			out.notes.push(window_error('no source for this codec'));
			return out;
		}

		await page.click('#start');
		await page.waitForFunction(() => window.__bench.engine.status === 'playing', null, {
			timeout: 30000
		});
		out.startedPlaying = true;

		step('1. real-time');
		// 1. real-time advance and sound in the analyser
		const t0 = await page.evaluate(() => window.__bench.engine.clock.now());
		const w0 = Date.now();
		let peak = null; // null: the browser has no Web Audio, so there is nothing to measure
		for (let i = 0; i < 20; i++) {
			await sleep(250);
			const v = await page.evaluate(() => {
				const an = window.__bench.engine.graph?.analyser;
				if (!an) return -1;
				const d = new Uint8Array(an.fftSize);
				an.getByteTimeDomainData(d);
				let m = 0;
				for (const v of d) m = Math.max(m, Math.abs(v - 128));
				return m;
			});
			if (v >= 0) peak = Math.max(peak ?? 0, v);
		}
		const t1 = await page.evaluate(() => window.__bench.engine.clock.now());
		out.advance = {
			clock_s: +(t1 - t0).toFixed(3),
			wall_s: +((Date.now() - w0) / 1000).toFixed(3)
		};
		out.analyserPeak = peak; // 0..128; null = no Web Audio in this browser
		out.graphConnected = await page.evaluate(() => window.__bench.engine.graph?.connected ?? false);

		step('2. seek while playing');
		// 2. seek while playing into an unbuffered part of the file
		const seekStart = Date.now();
		await page.evaluate(() => window.__bench.engine.seek(3000));
		await page.waitForFunction(
			() =>
				window.__bench.engine.status === 'playing' && window.__bench.engine.clock.now() > 3000.2,
			null,
			{ timeout: 30000 }
		);
		out.seekPlaying = {
			resume_ms: Date.now() - seekStart,
			clock: +(await page.evaluate(() => window.__bench.engine.clock.now())).toFixed(3)
		};

		step('3. seek while paused');
		// 3. seek while paused: the next frame must show the new time, and the loop must keep running
		await page.evaluate(() => window.__bench.engine.pause());
		const frames0 = await page.evaluate(() => window.__bench.hud.fps);
		await page.evaluate(() => window.__bench.engine.seek(1500));
		await sleep(400);
		out.seekPaused = await page.evaluate(() => ({
			clock: window.__bench.engine.clock.now(),
			hud_t: window.__bench.hud.t,
			status: window.__bench.engine.status,
			fps_while_paused: window.__bench.hud.fps
		}));
		void frames0;

		// 3b. the URL follows the position, and the OS media controls got the piece title
		out.urlAfterPausedSeek = await page.evaluate(() => location.search);
		out.mediaSession = await page.evaluate(() =>
			'mediaSession' in navigator
				? {
						title: navigator.mediaSession.metadata?.title ?? null,
						state: navigator.mediaSession.playbackState
					}
				: null
		);
		// 3c. reload with that URL: it must come back at the same place, paused
		const url = page.url();
		await page.goto(url, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__bench, null, { timeout: 15000 });
		await sleep(300);
		out.restoredAfterReload = await page.evaluate(() => ({
			clock: window.__bench.engine.clock.now(),
			piece: window.__bench.engine.piece?.id ?? null,
			status: window.__bench.engine.status
		}));
		await page.click('#start');
		await page.waitForFunction(() => window.__bench.engine.status === 'playing', null, {
			timeout: 30000
		});

		step('4. rate 1.5');
		// 4. rate 1.5 with pitch preserved
		await page.evaluate(() => {
			window.__bench.engine.setRate(1.5);
			return window.__bench.engine.play();
		});
		await page.waitForFunction(() => window.__bench.engine.status === 'playing', null, {
			timeout: 30000
		});
		const r0 = await page.evaluate(() => window.__bench.engine.clock.now());
		const rw0 = Date.now();
		await sleep(3000);
		const r1 = await page.evaluate(() => window.__bench.engine.clock.now());
		out.rate = {
			clock_s: +(r1 - r0).toFixed(3),
			wall_s: +((Date.now() - rw0) / 1000).toFixed(3),
			preservesPitch: await page.evaluate(
				() => document.querySelector('audio').preservesPitch ?? null
			)
		};

		step('5. clock quality');
		// 5. clock quality measured in the page over the whole run
		out.clockStats = await page.evaluate(() => ({
			max_step_error_ms: +(window.__bench.stats.maxStep * 1000).toFixed(2),
			max_distance_from_element_ms: +(window.__bench.stats.maxDev * 1000).toFixed(2),
			snaps: window.__bench.engine.clock.snaps
		}));
		out.finalSource = await page.evaluate(() => window.__bench.engine.source?.type ?? null);
		out.fallbacks = await page.evaluate(() => window.__bench.engine.fallbacks);
		out.audioResponses = summarize(audioResponses);
		out.errors = errors;
		out.ok =
			out.advance.clock_s > 0.9 * out.advance.wall_s &&
			out.advance.clock_s < 1.1 * out.advance.wall_s &&
			out.seekPaused.status === 'paused' &&
			Math.abs(out.seekPaused.clock - 1500) < 0.1 &&
			Math.abs(out.seekPaused.hud_t - 1500) < 0.2 &&
			errors.length === 0;
	} catch (e) {
		out.notes.push(String(e.message).split('\n')[0]);
	} finally {
		// closing can hang while a large range request is still open
		await Promise.race([browser.close(), sleep(5000)]);
	}
	return out;
}

function window_error(m) {
	return m;
}

function summarize(list) {
	const by = {};
	for (const r of list) {
		const k = `${r.status} ${r.type ?? ''}`;
		by[k] = (by[k] ?? 0) + 1;
	}
	return {
		counts: by,
		accept_ranges: list.find((r) => r.accept)?.accept ?? null,
		sample_range: list.find((r) => r.range)?.range ?? null
	};
}

const results = [];
for (const e of ENGINES) {
	for (const c of CODECS) {
		console.error(`--- ${e} / ${c}`);
		const r = await run(e, c);
		results.push(r);
		console.log(JSON.stringify(r, null, 1));
	}
}
console.log(
	'\n| engine | codec asked | source used | canPlay opus / aac | sound in analyser | clock vs wall (s) | seek playing (ms to resume) | paused seek ok | rate 1.5 clock/wall | ok |'
);
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
	console.log(
		`| ${r.engine} | ${r.codec} | ${r.finalSource ?? r.source ?? '-'}${r.fallbacks?.length ? ' (fell back)' : ''} | ${r.canPlay ? `${r.canPlay.opus || '-'} / ${r.canPlay.aac || '-'}` : '-'} | ${r.analyserPeak ?? 'no Web Audio'} | ${r.advance ? `${r.advance.clock_s} / ${r.advance.wall_s}` : '-'} | ${r.seekPlaying?.resume_ms ?? '-'} | ${r.seekPaused ? Math.abs(r.seekPaused.clock - 1500) < 0.1 : '-'} | ${r.rate ? `${r.rate.clock_s} / ${r.rate.wall_s}` : '-'} | ${r.ok ? 'yes' : 'NO ' + (r.notes[0] ?? '')} |`
	);
}
process.exit(0);
