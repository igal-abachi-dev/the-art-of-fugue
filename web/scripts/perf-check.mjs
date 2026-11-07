// The frame-rate budget and the low-power fallback (T9.3.1, T9.3.3).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm perf-check [--url http://localhost:4173] [--seconds 40] [--only budget|lowpower] [--shots ../docs/img]
//
// Budget (T9.3.1): Edge on this machine's own GPU (the reference machine, see docs/visual.md), the densest stretch of Contrapunctus XI
// (87 notes starting inside 6.5 s), every effect on:
//   1  the stage at 1920x1080, quality level 0 pinned (the best the stage can do)
//   2  the same at 1920x1080 CSS pixels on a 2x display (3840x2160 physical pixels)
//   3  the player as a listener gets it: 1920x1080, score and spectrogram both on, the governor free
// For each: the gaps between animation frames (median, 95th, 99th percentile, worst; share over 20 ms), the JavaScript time per frame
// and the draw calls.  The budget is 60 fps (pinned runs must also stay at level 0), and "60 fps" is the display's refresh: the check measures that too (an idle page's frame gap in the same
// browser, `baselineGapMs`) and holds the stage to it: a median within 10 % of the idle page's and at most 1 % of the frames
// over 1.5 times it.
//
// Low power (T9.3.3): a weak machine is made with the GPU off (WebGL on a software renderer) and the CPU throttled, the governor free:
//   4  a phone: 844x390 at 3x, touch, CPU 4x slower, from the Begin click
//   5  a very weak machine: 1280x720, CPU 8x slower
// The page is sampled every second: frames, quality level, whether bloom, the ambient (butterchurn) layer and the particles are
// on, and whether the notes are still being drawn. The check wants, once settled (the last 15 s): bloom off, at least 50 fps (run 4) or
// 30 fps (run 5, a machine 8 times slower than this one, already at the bare piano roll, where there is nothing left to lower; it measured 39.5, 43.1
// and 46.6 in three runs, so the floor is set well under that), and in run 5 the
// ambient layer and the particles off as well. `--only 5` runs one scenario by its number.
// A real weak GPU or phone is limited by fill rate rather than the CPU: this tests the mechanism, not a device (docs/visual.md).

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { begin } from './begin.mjs';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const SECONDS = Number(args.seconds ?? 40);
const SHOTS = resolve(args.shots ?? '../docs/img');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SOFTWARE_GL = [
	'--disable-gpu',
	'--use-gl=angle',
	'--use-angle=swiftshader',
	'--enable-unsafe-swiftshader'
];
const BASE = ['--autoplay-policy=no-user-gesture-required'];

const BUDGET = [
	{
		name: '1  stage 1920x1080, level 0 pinned',
		viewport: { width: 1920, height: 1080 },
		dsf: 1,
		url: '/stage?hud&scene=auto&p=xi&bar=60&q=0',
		start: '#start',
		pinned: true
	},
	{
		name: '2  stage 1920x1080 CSS px on a 2x display (3840x2160), level 0 pinned',
		viewport: { width: 1920, height: 1080 },
		dsf: 2,
		url: '/stage?hud&scene=auto&p=xi&bar=60&q=0',
		start: '#start',
		pinned: true
	},
	{
		name: '3  the player 1920x1080, score and spectrogram on, governor free',
		viewport: { width: 1920, height: 1080 },
		dsf: 1,
		url: '/?p=xi&bar=60',
		start: null,
		overlays: true
	}
];

const LOWPOWER = [
	{
		name: '4  a phone: 844x390 at 3x, touch, software GL, CPU 4x slower',
		viewport: { width: 844, height: 390 },
		dsf: 3,
		mobile: true,
		throttle: 4,
		seconds: 60,
		url: '/?p=xi&bar=60',
		start: null,
		expect: { bloomOff: true, minFps: 50 }
	},
	{
		name: '5  a very weak machine: 1280x720, software GL, CPU 8x slower',
		viewport: { width: 1280, height: 720 },
		dsf: 1,
		throttle: 8,
		seconds: 80,
		url: '/?p=xi&bar=60',
		start: null,
		expect: { bloomOff: true, ambientOff: true, particlesOff: true, minFps: 30 }
	}
];

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];

async function run(sc, kind) {
	const out = { name: sc.name, ok: false };
	const browser = await chromium.launch({
		channel: 'msedge',
		args: kind === 'lowpower' ? [...BASE, ...SOFTWARE_GL] : BASE
	});
	try {
		const context = await browser.newContext({
			viewport: sc.viewport,
			deviceScaleFactor: sc.dsf,
			isMobile: !!sc.mobile,
			hasTouch: !!sc.mobile
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e.message)));
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
		await page.goto(`${URL_BASE}${sc.url}`, { waitUntil: 'load' });
		if (sc.start) await page.waitForSelector(sc.start, { timeout: 60000 });
		await page.waitForFunction(() => window.__stagePage?.stage || window.__player?.stage, null, {
			timeout: 60000
		});
		out.renderer = await page.evaluate(() => {
			const gl = document.createElement('canvas').getContext('webgl2');
			const ext = gl?.getExtension('WEBGL_debug_renderer_info');
			return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
		});
		if (kind === 'budget') {
			// the display's own frame gap, from an idle page in the same browser
			const idle = await context.newPage();
			await idle.goto('about:blank');
			const g = await idle.evaluate(
				() =>
					new Promise((done) => {
						const gaps = [];
						let last = 0;
						const tick = (t) => {
							if (last) gaps.push(t - last);
							last = t;
							if (gaps.length < 180) requestAnimationFrame(tick);
							else done(gaps);
						};
						requestAnimationFrame(tick);
					})
			);
			await idle.close();
			out.baselineGapMs = +g.sort((a, b) => a - b)[g.length >> 1].toFixed(2);
			await page.bringToFront();
		}
		const cdp = await context.newCDPSession(page);
		if (sc.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.throttle });
		// the player has no button to press: a link to a bar plays at once; a touch starts it where it has not begun
		if (sc.start) await page.click(sc.start);
		else await begin(page, { touch: !!sc.mobile });
		if (sc.overlays)
			await page.evaluate(() => window.__player.player.set({ score: true, spectro: true }));
		const stage = () => `(window.__stagePage?.stage ?? window.__player.stage)`;
		await page.evaluate(() => {
			window.__gaps = [];
			window.__frames = 0;
			let last = 0;
			const tick = (t) => {
				if (last) window.__gaps.push(t - last);
				last = t;
				window.__frames++;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const read = () =>
			page.evaluate(`(() => {
				const st = ${stage()};
				const s = st.stats();
				const q = st.governor.quality;
				return {
					frames: window.__frames,
					level: s.level, dpr: s.dpr, cpu: s.cpuMsMean, cpuP95: s.cpuMsP95, calls: s.drawCalls,
					bloom: q.bloom, ambientScale: q.ambientScale, ambient: s.ambient, particleCap: q.particleCap,
					emitted: s.particlesEmitted, notes: s.notesWritten, lost: s.lost
				};
			})()`);
		const seconds = sc.seconds ?? SECONDS;
		const warm = kind === 'budget' ? 6 : 0; // the budget excludes the first seconds (shader compilation, the first decode)
		const trace = [];
		let last = await read();
		for (let s = 1; s <= seconds + warm; s++) {
			await sleep(1000);
			const now = await read();
			trace.push({ s, fps: now.frames - last.frames, ...now });
			last = now;
			if (s === warm) await page.evaluate(() => (window.__gaps.length = 0));
		}
		const gaps = (await page.evaluate(() => window.__gaps)).slice().sort((a, b) => a - b);
		await page.screenshot({
			path: resolve(SHOTS, `perf-${sc.name.split(' ')[0]}.png`)
		});
		out.trace = trace.map((t) => `${t.s}s ${t.fps}fps L${t.level}`).join(' ');
		const tail = trace.slice(-15);
		out.errors = errors.slice(0, 3);
		if (kind === 'budget') {
			const late = gaps.filter((g) => g > out.baselineGapMs * 1.5).length;
			const over20 = gaps.filter((g) => g > 20).length;
			out.numbers = {
				frames: gaps.length,
				medianGapMs: +pct(gaps, 50).toFixed(2),
				p95GapMs: +pct(gaps, 95).toFixed(2),
				p99GapMs: +pct(gaps, 99).toFixed(2),
				worstGapMs: +gaps[gaps.length - 1].toFixed(1),
				shareOver20ms: +((100 * over20) / gaps.length).toFixed(2),
				shareOver1_5xDisplay: +((100 * late) / gaps.length).toFixed(2),
				baselineGapMs: out.baselineGapMs,
				jsMsMean: +(tail.reduce((a, t) => a + t.cpu, 0) / tail.length).toFixed(2),
				jsMsP95: +Math.max(...tail.map((t) => t.cpuP95)).toFixed(2),
				drawCalls: tail[tail.length - 1].calls,
				levelStart: trace[0].level,
				levelEnd: trace[trace.length - 1].level,
				dprEnd: +trace[trace.length - 1].dpr.toFixed(2)
			};
			out.ok =
				out.numbers.medianGapMs <= out.baselineGapMs * 1.1 &&
				out.numbers.shareOver1_5xDisplay <= 1 &&
				(!sc.pinned || trace.every((t) => t.level === 0)) &&
				errors.length === 0;
		} else {
			const settled = trace.slice(-15);
			const avg = settled.reduce((a, t) => a + t.fps, 0) / settled.length;
			const t = settled[settled.length - 1];
			const drawing = trace[trace.length - 1].notes - trace[trace.length - 16].notes > 50;
			out.numbers = {
				levelAtStart: trace[0].level,
				levelFinal: t.level,
				levelsVisited: [...new Set(trace.map((x) => x.level))].join(','),
				fpsLast15: +avg.toFixed(1),
				belowFifty: settled.filter((x) => x.fps < 50).length,
				bloomOn: t.bloom,
				ambientScale: t.ambientScale,
				ambientOpacity: +t.ambient.toFixed(2),
				particleCap: t.particleCap,
				particlesEmittedLast15s: t.emitted - trace[trace.length - 16].emitted,
				notesStillDrawn: drawing,
				contextLost: t.lost
			};
			const e = sc.expect;
			out.ok =
				avg >= e.minFps &&
				drawing &&
				!t.lost &&
				(!e.bloomOff || !t.bloom) &&
				(!e.ambientOff || t.ambientScale === 0) &&
				(!e.particlesOff || (t.particleCap === 0 && out.numbers.particlesEmittedLast15s === 0)) &&
				errors.length === 0;
		}
	} catch (e) {
		out.error = String(e.stack ?? e)
			.split('\n')
			.slice(0, 3)
			.join(' | ');
	} finally {
		await Promise.race([browser.close(), sleep(5000)]);
	}
	return out;
}

const results = [];
const wanted = (sc) => !/^\d$/.test(args.only ?? '') || sc.name.startsWith(args.only);
if (args.only !== 'lowpower')
	for (const sc of BUDGET.filter(wanted)) {
		console.error(`\n=== ${sc.name}`);
		results.push(await run(sc, 'budget'));
	}
if (args.only !== 'budget')
	for (const sc of LOWPOWER.filter(wanted)) {
		console.error(`\n=== ${sc.name}`);
		results.push(await run(sc, 'lowpower'));
	}
console.log(JSON.stringify(results, null, 2));
for (const r of results) console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
const code = results.every((r) => r.ok) ? 0 : 1;
setTimeout(() => process.exit(code), 300); // the CDP sessions keep the process alive
