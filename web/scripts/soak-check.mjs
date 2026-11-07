// The soak test (T9.3.2): the whole recording played from start to end in one page, and what grew or drifted.
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm soak-check [--url http://localhost:4173] [--engine msedge|firefox] [--from 0] [--minutes 0] [--rate 1]
//                   [--every 30] [--out ../data/work/soak.ndjson] [--shots ../docs/img]
//
// It opens the player (`/`) at 1280x720 with every default on (the ambient layer, bloom, particles, the scenes), presses Begin
// and lets it play at normal speed to the end of the recording (80 minutes 32 s), or `--minutes` of it. Every `--every` seconds
// (default 30) it records one line of NDJSON:
//   time          wall seconds, the element's time, the clock's time, the audio context's time
//   drift         how far the element is from where real time says it should be (a stall or dropped audio shows here), how far the clock
//                 is from the element, and how far the audio context's clock has run from the element's (they are two clocks)
//   events        `waiting`, `stalled`, `error`, `seeking` counts since the start (a dropout is a `waiting`)
//   memory        the JavaScript heap after a forced collection, the DOM nodes, listeners, the stage's GPU objects (geometries, textures,
//                 programs), and the working set of the browser's whole process tree (so GPU-process and decoder memory count)
//   frames        median/99th-percentile frame gap and the share over 25 ms in the interval, the governor's level
// and at the end prints the verdict: heap and process growth (a straight line fitted to the second half, in MB an hour),
// the worst drift, the events, the pieces visited, the errors.
// The criteria are stated in docs/performance.md. The audio is real: this needs web/static/audio, and a quiet machine (other
// browsers running at the same time disturb the frame numbers).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { begin } from './begin.mjs';
import { verdictOf } from './soak-verdict.mjs';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINE = args.engine ?? 'msedge';
const FROM = Number(args.from ?? 0);
const MINUTES = Number(args.minutes ?? 0); // 0 = to the end
const RATE = Number(args.rate ?? 1);
const EVERY = Number(args.every ?? 30);
const OUT = resolve(args.out ?? '../data/work/soak.ndjson');
const SHOTS = resolve(args.shots ?? '../docs/img');
mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(SHOTS, { recursive: true });
if (!args.analyze) writeFileSync(OUT, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the working set (MB) of the given processes (the browser's own, its GPU, renderer and utility processes), Windows only */
function workingSetMb(pids) {
	if (process.platform !== 'win32' || !pids?.length) return null;
	try {
		const raw = execFileSync(
			'powershell',
			[
				'-NoProfile',
				'-Command',
				`(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`
			],
			{ encoding: 'utf8' }
		);
		const v = Number(raw.trim());
		return Number.isFinite(v) ? v / 1048576 : null;
	} catch {
		return null;
	}
}

const launch =
	ENGINE === 'firefox'
		? () =>
				firefox.launch({
					firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
				})
		: () =>
				chromium.launch({
					channel: 'msedge',
					args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info']
				});

if (args.analyze) {
	const rowsIn = readFileSync(resolve(args.analyze), 'utf8')
		.split(String.fromCharCode(10))
		.filter(Boolean)
		.map((l) => JSON.parse(l));
	const lastRow = rowsIn.at(-1);
	const done = rowsIn.length > 0 && (lastRow.status === 'ended' || lastRow.element_s >= 4831);
	const sm = verdictOf(rowsIn, { engine: ENGINE, ended: done });
	console.log(JSON.stringify(sm, null, 2));
	process.exit(Object.values(sm.checks).every(Boolean) ? 0 : 1);
}
const browser = await launch();
const errors = [];
const rows = [];
let verdict = null;
try {
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	const page = await context.newPage();
	page.on('pageerror', (e) => errors.push(`exception: ${e.message}`));
	page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
	const cdp = ENGINE === 'firefox' ? null : await context.newCDPSession(page);
	await cdp?.send('Performance.enable');
	const browserCdp = ENGINE === 'firefox' ? null : await browser.newBrowserCDPSession();
	await page.goto(`${URL_BASE}/`, { waitUntil: 'load' });
	await page.waitForFunction(() => window.__player?.player, null, { timeout: 60000 });
	await page.evaluate(
		({ RATE }) => {
			const e = window.__player.player.engine;
			window.__soak = {
				waiting: 0,
				stalled: 0,
				error: 0,
				seeking: 0,
				pieces: [],
				gaps: [],
				frames: 0
			};
			for (const k of ['waiting', 'stalled', 'error', 'seeking'])
				e.element.addEventListener(k, () => window.__soak[k]++);
			let last = 0;
			const tick = (t) => {
				if (last) window.__soak.gaps.push(t - last);
				last = t;
				window.__soak.frames++;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
			if (RATE !== 1) window.__player.player.setRate(RATE);
		},
		{ RATE }
	);
	await begin(page);
	await page.waitForFunction(() => window.__player.player.engine.status === 'playing', null, {
		timeout: 30000
	});
	if (FROM > 0) {
		await page.evaluate((t) => window.__player.player.engine.seek(t), FROM);
		await sleep(1500);
	}
	const total = await page.evaluate(() => window.__player.player.engine.manifest.duration);
	const stopAt = MINUTES > 0 ? FROM + MINUTES * 60 * RATE : total - 0.5;
	const start = await page.evaluate(() => ({
		wall: performance.now() / 1000,
		el: window.__player.player.engine.element.currentTime,
		ctx: window.__player.player.engine.graph.context.currentTime
	}));
	console.error(`playing from ${start.el.toFixed(1)} s to ${stopAt.toFixed(1)} s at ${RATE}x`);
	for (let n = 1; ; n++) {
		await sleep(EVERY * 1000);
		if (cdp) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
		const m = cdp ? await cdp.send('Performance.getMetrics').catch(() => null) : null;
		const metric = (name) => m?.metrics?.find((x) => x.name === name)?.value ?? null;
		const s = await page.evaluate(() => {
			const p = window.__player.player;
			const e = p.engine;
			const st = window.__player.stage?.stats?.() ?? null;
			const gaps = window.__soak.gaps.splice(0).sort((a, b) => a - b);
			const at = (q) =>
				gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] : null;
			if (e.piece && window.__soak.pieces.at(-1) !== e.piece.id)
				window.__soak.pieces.push(e.piece.id);
			return {
				wall: performance.now() / 1000,
				el: e.element.currentTime,
				clock: e.clock.now(),
				ctx: e.graph.context.currentTime,
				status: e.status,
				piece: e.piece?.id ?? null,
				ended: e.element.ended,
				ev: { ...window.__soak, pieces: undefined, gaps: undefined, frames: undefined },
				pieces: window.__soak.pieces.slice(),
				stage: st && {
					level: st.level,
					geometries: st.geometries,
					textures: st.textures,
					programs: st.programs,
					lost: st.lost
				},
				frames: {
					n: gaps.length,
					median: at(0.5),
					p99: at(0.99),
					over25: gaps.filter((g) => g > 25).length
				},
				jsHeapMb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null
			};
		});
		const row = {
			n,
			wall_s: +(s.wall - start.wall).toFixed(1),
			element_s: +s.el.toFixed(3),
			clock_s: +s.clock.toFixed(3),
			status: s.status,
			piece: s.piece,
			// where real time says the element should be, and how far it is from there (negative = lost time)
			elementDriftMs: +((s.el - start.el - (s.wall - start.wall) * RATE) * 1000).toFixed(0),
			clockMinusElementMs: +((s.clock - s.el) * 1000).toFixed(0),
			ctxMinusElementMs: +(((s.ctx - start.ctx) * RATE - (s.el - start.el)) * 1000).toFixed(0),
			events: s.ev,
			heapMb:
				metric('JSHeapUsedSize') != null
					? +(metric('JSHeapUsedSize') / 1048576).toFixed(1)
					: s.jsHeapMb,
			nodes: metric('Nodes'),
			listeners: metric('JSEventListeners'),
			documents: metric('Documents'),
			gpuObjects: s.stage,
			processMb: await (async () => {
				const info = await browserCdp?.send('SystemInfo.getProcessInfo').catch(() => null);
				const v = workingSetMb(info?.processInfo?.map((p) => p.id));
				return v == null ? null : +v.toFixed(0);
			})(),
			frames: s.frames
		};
		rows.push(row);
		appendFileSync(OUT, JSON.stringify(row) + '\n');
		if (n % 10 === 0)
			console.error(
				`${(row.wall_s / 60).toFixed(0)} min  at ${row.element_s.toFixed(0)} s  ${row.piece}  drift ${row.elementDriftMs} ms  heap ${row.heapMb} MB  process ${row.processMb} MB  waiting ${row.events.waiting}`
			);
		if (s.el >= stopAt || s.ended || s.status === 'ended') {
			verdict = { reachedS: s.el, ended: s.ended || s.status === 'ended', pieces: s.pieces };
			break;
		}
	}
	await page.screenshot({ path: resolve(SHOTS, 'soak-end.png') });
} catch (e) {
	errors.push(
		`run: ${String(e.stack ?? e)
			.split('\n')
			.slice(0, 3)
			.join(' | ')}`
	);
} finally {
	await Promise.race([browser.close(), sleep(5000)]);
}

// ---- the verdict
const summary = verdictOf(rows, {
	engine: ENGINE,
	errors,
	ended: verdict?.ended,
	reachedS: verdict?.reachedS
});
console.log(JSON.stringify(summary, null, 2));
const code = Object.values(summary.checks).every(Boolean) ? 0 : 1;
setTimeout(() => process.exit(code), 300); // the CDP sessions keep the process alive
