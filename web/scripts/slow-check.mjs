// What the performance governor does on a machine that cannot keep 60 fps (T4.1.3, T4.2.2).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm slow-check [--url http://localhost:4173] [--seconds 90] [--shots ../docs/img]
//
// There is no weak machine here, so this makes one: Chromium with the GPU turned off (WebGL on SwiftShader, a
// software renderer, far slower than any real GPU for this scene) and, in a second run, the CPU throttled to a
// quarter speed on top. Both play the densest stretch of Contrapunctus XI at 1280x720 with the governor free
// to adapt, and every second the page reports its frame rate, the quality level and the pixel ratio.
// It reports whether the governor settles (stops changing the level), at which level, and the frame rate it
// ends with. This is a stress test of the mechanism, not a measurement of any real phone or laptop.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const SECONDS = Number(args.seconds ?? 90);
const SHOTS = resolve(args.shots ?? '../docs/img');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RUNS = [
	{ name: 'software GL', throttle: 1 },
	{ name: 'software GL + CPU 4x slower', throttle: 4 },
	{ name: 'software GL + CPU 8x slower', throttle: 8 }
];

async function run({ name, throttle }) {
	const out = { name, throttle, ok: false };
	const browser = await chromium.launch({
		channel: 'msedge',
		args: [
			'--disable-gpu',
			'--use-gl=angle',
			'--use-angle=swiftshader',
			'--enable-unsafe-swiftshader',
			'--autoplay-policy=no-user-gesture-required'
		]
	});
	try {
		const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e.message)));
		const cdp = await context.newCDPSession(page);
		await page.goto(`${URL_BASE}/stage?hud&p=xi&bar=60`, { waitUntil: 'load' });
		await page.waitForSelector('#start', { timeout: 60000 });
		await page.waitForFunction(() => window.__stagePage?.stage, null, { timeout: 60000 });
		out.renderer = await page.evaluate(() => {
			const gl = document.createElement('canvas').getContext('webgl2');
			const ext = gl?.getExtension('WEBGL_debug_renderer_info');
			return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
		});
		if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
		await page.click('#start');
		const trace = [];
		await page.evaluate(() => {
			window.__frames = 0;
			const tick = () => {
				window.__frames++;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		let lastFrames = 0;
		const t0 = Date.now();
		while (Date.now() - t0 < SECONDS * 1000) {
			await sleep(1000);
			const s = await page.evaluate(() => {
				const st = window.__stagePage.stage.stats();
				return {
					frames: window.__frames,
					level: st.level,
					dpr: st.dpr,
					cpu: st.cpuMsMean
				};
			});
			trace.push({
				s: trace.length + 1,
				fps: s.frames - lastFrames,
				level: s.level,
				dpr: +s.dpr.toFixed(2),
				cpuMs: +s.cpu.toFixed(1)
			});
			lastFrames = s.frames;
		}
		await page.screenshot({ path: `${SHOTS}/slow-${throttle}x.png` });
		const levels = trace.map((t) => t.level);
		const changes = levels.filter((l, i) => i > 0 && l !== levels[i - 1]).length;
		const lastChange = levels.reduce((a, l, i) => (i > 0 && l !== levels[i - 1] ? i : a), 0);
		const tail = trace.slice(-15);
		out.summary = {
			startLevel: levels[0],
			finalLevel: levels[levels.length - 1],
			levelChanges: changes,
			lastChangeAtSecond: lastChange + 1,
			fpsFirst10: +(trace.slice(0, 10).reduce((a, t) => a + t.fps, 0) / 10).toFixed(1),
			fpsLast15: +(tail.reduce((a, t) => a + t.fps, 0) / tail.length).toFixed(1),
			dprFinal: trace[trace.length - 1].dpr
		};
		out.trace = trace.map((t) => `${t.s}s ${t.fps}fps L${t.level}`).join(' | ');
		out.errors = errors.slice(0, 3);
		// After the first 15 s (time to adapt) the picture should stay near 60 fps. The governor tries one level
		// up now and then, which costs a couple of seconds a little below 60: allow 10 % of the time under 50 fps.
		const settled = trace.slice(15);
		out.summary.secondsBelow50After15s = settled.filter((t) => t.fps < 50).length;
		out.summary.secondsOfAfter15s = settled.length;
		out.summary.levelsVisited = [...new Set(levels)].sort();
		out.ok =
			settled.filter((t) => t.fps < 50).length <= settled.length * 0.1 &&
			out.summary.fpsLast15 >= 45 &&
			errors.length === 0;
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
for (const r of RUNS) {
	console.error(`\n=== ${r.name}`);
	results.push(await run(r));
}
console.log(JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
