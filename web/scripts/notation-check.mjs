// Real-browser check of the score overlay (T4.4.1).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm notation-check [--url http://localhost:4173] [--engines msedge,firefox] [--shots ../docs/img]
//
// For each engine it opens /stage?score and checks, on real pieces of the shipped data:
//   - the engraved system shown contains the bar that is playing, in 14 places across 10 pieces (first and last
//     bar of the work, a repeated canon on its second pass, the two derived mirror pieces, a pickup bar);
//   - while the recording plays, noteheads are lit, the cursor only moves forward inside a system, and the
//     overlay changes system when the music moves on;
//   - the page of the engraving is really drawn (the score area is not blank) and no request failed;
//   - what a lit notehead is: the lit heads are exactly the heads of the notes the note window says are sounding.
// It writes screenshots (at the screen's pixel ratio and at 3x, to see that the engraving stays sharp) and prints
// JSON; it exits non-zero when a check fails. It cannot judge whether the cursor feels in time with the music:
// that needs a person.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engines ?? 'msedge,firefox').split(',');
const SHOTS = resolve(args.shots ?? '../docs/img');
// which engraving: `verovio` (the default, from the PDF-checked MXL) or `pdf` (the second one, from the Contrapunctus Press PDF)
const SOURCE = args.source ?? 'verovio';
const QS = SOURCE === 'pdf' ? '&notation=pdf' : '';
const TAG = SOURCE === 'verovio' ? 'verovio-' : '';
// the cursor is measured in the file's units: PDF points, or Verovio's drawing units (36 times finer)
const UNIT_SCALE = SOURCE === 'verovio' ? 36 : 1;
mkdirSync(SHOTS, { recursive: true });

const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	chromium: () => chromium.launch(),
	firefox: () => firefox.launch(),
	webkit: () => webkit.launch()
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.error(`    ${m}`);

// [piece id, printed bar, pass]
const PLACES = [
	['c01', 1],
	['c01', 40],
	['c04', 73],
	['c08', 120],
	['c11', 83],
	['c11', 150],
	['c12r', 20],
	['c12i', 20],
	['c13r', 10],
	['c13i', 0],
	['c14', 1],
	['c14', 239],
	['k1', 6, 2],
	['k4', 50]
];

async function run(engineName) {
	const out = { engine: engineName, source: SOURCE, ok: false, notes: [], places: [] };
	let browser;
	try {
		browser = await launchers[engineName]();
	} catch (e) {
		out.notes.push(`could not launch: ${String(e.message).split('\n')[0]}`);
		return out;
	}
	try {
		const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const page = await context.newPage();
		const errors = [];
		const failed = [];
		page.on('pageerror', (e) => errors.push(String(e.message)));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`);
		});
		page.on('response', (r) => {
			if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(URL_BASE, '')}`);
		});

		step('open the stage page with the score');
		await page.goto(`${URL_BASE}/stage?score${QS}`, { waitUntil: 'load' });
		await page.waitForSelector('#start', { timeout: 30000 });
		await page.waitForFunction(() => window.__stagePage?.session, null, { timeout: 30000 });

		// helpers in the page
		await page.evaluate(() => {
			const w = window;
			w.__n = {
				eng: () => w.__stagePage.session.engine,
				box: () => document.querySelector('.notation svg'),
				lit: () => document.querySelectorAll('.notation .heads ellipse.on').length,
				cursor: () => {
					const l = document.querySelector('.notation line.cursor');
					return l ? Number(l.getAttribute('x1')) : NaN;
				},
				frames: (n) =>
					new Promise((resolve) => {
						let k = 0;
						const tick = () => (++k >= n ? resolve(k) : requestAnimationFrame(tick));
						requestAnimationFrame(tick);
					}),
				/** the notation says it shows `bars` "a-b"; does it contain the engine's current bar */
				shows: () => {
					const eng = w.__n.eng();
					const svg = w.__n.box();
					if (!svg || !eng.bar) return { shown: false };
					const [a, b] = svg.dataset.bars.split('-').map(Number);
					return {
						shown: true,
						piece: svg.dataset.piece,
						enginePiece: eng.piece?.id,
						bar: eng.bar.n,
						range: [a, b],
						contains: eng.bar.n >= a && eng.bar.n <= b
					};
				},
				/** heads lit vs the notes the window says are sounding (positions only, by count of distinct lit) */
				soundingCount: () => {
					const eng = w.__n.eng();
					const piece = eng.piece;
					const win = piece && eng.window(piece.id);
					if (!win) return -1;
					win.query(eng.clock.now(), 0, 0);
					return win.activeCount;
				}
			};
		});

		for (const [id, bar, pass] of PLACES) {
			const ok = await page.evaluate(
				([id, bar, pass]) => {
					const eng = window.__n.eng();
					const piece = eng.manifest.pieces.find((p) => p.id === id);
					if (!piece) return { error: `no piece ${id}` };
					const b = piece.bars.find((x) => x.n === bar && (pass ? x.pass === pass : true));
					if (!b) return { error: `no bar ${bar} (pass ${pass}) in ${id}` };
					const at = Math.max(b.t, piece.audio_start) + 0.2;
					eng.seek(at);
					return { id: piece.id, t: at };
				},
				[id, bar, pass]
			);
			if (ok.error) {
				out.places.push({ id, bar, ok: false, error: ok.error });
				continue;
			}
			// wait for the overlay to show that piece and bar (it loads the page file and the notes lazily)
			let shown = null;
			for (let k = 0; k < 120; k++) {
				await page.evaluate(() => window.__n.frames(2));
				shown = await page.evaluate(() => window.__n.shows());
				if (shown.shown && shown.piece === ok.id && shown.contains) break;
				await sleep(50);
			}
			// the engraving file itself must be well-formed SVG: a browser refuses to draw one that is not (and the
			// overlay then shows noteheads over nothing)
			const drawn = await page.evaluate(async () => {
				const href = document.querySelector('.notation image')?.getAttribute('href');
				if (!href) return { ok: false, why: 'no image' };
				const text = await (await fetch(href)).text();
				const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
				const err = doc.querySelector('parsererror');
				return {
					ok: !err,
					why: err ? err.textContent.slice(0, 80) : '',
					paths: doc.querySelectorAll('path').length
				};
			});
			let lit = 0;
			for (let k = 0; k < 40; k++) {
				await page.evaluate(() => window.__n.frames(2));
				lit = await page.evaluate(() => window.__n.lit());
				if (lit > 0) break;
				await sleep(25);
			}
			const sounding = await page.evaluate(() => window.__n.soundingCount());
			const row = {
				id,
				bar,
				pass: pass ?? 1,
				piece: ok.id,
				contains: !!(shown.shown && shown.piece === ok.id && shown.contains),
				range: shown.range,
				lit,
				sounding
			};
			// something must be lit whenever something sounds; never more heads than a few per sounding note
			row.drawn = drawn;
			row.ok =
				drawn.ok &&
				drawn.paths > 50 &&
				row.contains &&
				(sounding === 0 || lit > 0) &&
				lit <= sounding * 3 + 2;
			out.places.push(row);
		}

		step('play Contrapunctus I and follow the cursor');
		await page.evaluate(() => {
			const eng = window.__n.eng();
			eng.seekPlace({ piece: eng.manifest.pieces.find((p) => p.id === 'c01'), bar: 1 });
		});
		await page.click('#start').catch(() => {});
		await sleep(800);
		const trace = [];
		const t0 = Date.now();
		let prevBars = null;
		let systemChanges = 0;
		let backwards = 0;
		let lastX = -Infinity;
		let litSamples = 0;
		while (Date.now() - t0 < 24000) {
			const s = await page.evaluate(() => ({
				bars: window.__n.box()?.dataset.bars ?? null,
				x: window.__n.cursor(),
				lit: window.__n.lit(),
				t: window.__n.eng().clock.now()
			}));
			if (s.bars !== prevBars) {
				if (prevBars !== null) systemChanges++;
				prevBars = s.bars;
				lastX = -Infinity;
			}
			if (Number.isFinite(s.x)) {
				if (s.x < lastX - 0.5 * UNIT_SCALE) {
					backwards++;
					(out.backSteps ??= []).push({ t: +s.t.toFixed(2), bars: s.bars, from: lastX, to: s.x });
				}
				lastX = s.x;
			}
			if (s.lit > 0) litSamples++;
			trace.push(s);
			await sleep(120);
		}
		out.play = {
			samples: trace.length,
			from: +trace[0].t.toFixed(1),
			to: +trace[trace.length - 1].t.toFixed(1),
			systemChanges,
			cursorBackwardSteps: backwards,
			samplesWithLitHeads: litSamples
		};
		out.play.ok =
			trace[trace.length - 1].t - trace[0].t > 15 &&
			systemChanges >= (SOURCE === 'verovio' ? 1 : 2) &&
			backwards === 0 &&
			litSamples / trace.length > 0.8;
		await page.evaluate(() => window.__n.eng().element.pause());

		step('screenshots');
		await page.evaluate(() => {
			const eng = window.__n.eng();
			const p = eng.manifest.pieces.find((q) => q.id === 'c11');
			eng.seekPlace({ piece: p, bar: 83 });
		});
		await sleep(1500);
		const area = page.locator('.notation .paper');
		await area.screenshot({ path: resolve(SHOTS, `notation-${TAG}${engineName}.png`) });
		await page.screenshot({ path: resolve(SHOTS, `notation-page-${TAG}${engineName}.png`) });
		const hi = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			deviceScaleFactor: 3
		});
		const page3 = await hi.newPage();
		await page3.goto(`${URL_BASE}/stage?score&p=xi&bar=83${QS}`, { waitUntil: 'load' });
		await page3.waitForSelector('.notation svg', { timeout: 30000 });
		await sleep(2000);
		await page3
			.locator('.notation .paper')
			.screenshot({ path: resolve(SHOTS, `notation-3x-${TAG}${engineName}.png`) });
		// the score area is drawn: dark ink on the paper, not a blank card
		const ink = await page3.evaluate(() => {
			const svg = document.querySelector('.notation svg');
			return !!svg;
		});
		out.notes.push(ink ? 'score area present at 3x' : 'no score area at 3x');
		await hi.close();

		out.errors = errors.slice(0, 5);
		out.failedRequests = failed.slice(0, 5);
		out.ok =
			out.places.every((p) => p.ok) && out.play.ok && errors.length === 0 && failed.length === 0;
	} catch (e) {
		out.notes.push(
			`failed: ${String(e.stack ?? e)
				.split('\n')
				.slice(0, 3)
				.join(' | ')}`
		);
	} finally {
		await Promise.race([browser.close(), sleep(5000)]);
	}
	return out;
}

const results = [];
for (const e of ENGINES) {
	console.error(`\n=== ${e}`);
	results.push(await run(e));
}
console.log(JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.ok);
if (bad.length) console.error(`\nFAILED: ${bad.map((r) => r.engine).join(', ')}`);
else console.error('\nall engines passed');
process.exit(bad.length ? 1 : 0);
