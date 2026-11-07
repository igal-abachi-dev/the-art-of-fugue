// End-to-end smoke test (T9.2.2): what a listener does first, through the real interface, in real browsers.
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm smoke-check [--url http://localhost:4173] [--engines msedge,firefox] [--seconds 4]
//
// Start (the welcome: no button, a touch starts it at once), play for a few seconds and see the clock and the time display move, seek by clicking the seek
// bar, switch piece with Next and Previous, pause and play with Space, open the credits and the stage page. It FAILS on any
// console error, uncaught exception, failed request or HTTP status of 400 or more on the way (a range request cancelled by
// the browser itself is not a failure). It is deliberately short and uses only what a person can see and press; the
// controls are examined one by one in `pnpm player-check`.
// Needs the audio (web/static/audio): it is generated, not committed, so this is a local check and not part of CI.

import { chromium, firefox, webkit } from 'playwright';
import { begin } from './begin.mjs';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engines ?? 'msedge,firefox').split(',');
const PLAY_S = Number(args.seconds ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	firefox: () =>
		firefox.launch({
			firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
		}),
	webkit: () => webkit.launch()
};

async function waitFor(page, fn, arg, timeout = 15000) {
	const t0 = Date.now();
	for (;;) {
		const v = await page.evaluate(fn, arg).catch(() => null);
		if (v) return v;
		if (Date.now() - t0 > timeout) return null;
		await sleep(100);
	}
}

async function run(name) {
	const fails = [];
	const rows = [];
	const problems = []; // console errors, exceptions, failed requests
	const check = (what, ok, detail = '') => {
		rows.push({ what, ok: !!ok, detail });
		if (!ok) fails.push(what);
	};
	let browser;
	try {
		browser = await launchers[name]();
	} catch (e) {
		return { name, skipped: String(e.message).split('\n')[0], rows, fails: [] };
	}
	try {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const page = await ctx.newPage();
		page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
		page.on('console', (m) => {
			if (m.type() === 'error') problems.push(`console: ${m.text()}`);
		});
		page.on('response', (r) => {
			if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
		});
		page.on('requestfailed', (r) => {
			const why = r.failure()?.errorText ?? '';
			// the browser's own business with a media element: it drops a range request it no longer needs, and Firefox reports
			// a request answered from its parsed-data cache as a failure
			if (/ABORTED|cancel|PARSED_DATA_CACHED/i.test(why) && /\/audio\//.test(r.url())) return;
			problems.push(`request failed (${why}): ${r.url()}`);
		});
		const state = () =>
			page.evaluate(() => {
				const e = window.__player.player.engine;
				return {
					t: e.clock.now(),
					status: e.status,
					piece: e.piece?.id ?? null,
					order: e.piece?.order ?? null,
					duration: e.manifest.duration,
					time: document.querySelector('[data-testid=time]')?.textContent?.trim() ?? ''
				};
			});

		// ---- start
		await page.goto(`${URL_BASE}/`, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__player?.player, null, { timeout: 30000 });
		check('the welcome screen is shown', await page.getByTestId('welcome').isVisible());
		check(
			'and it has no button to press',
			(await page
				.locator('[data-testid=welcome] button, [data-testid=welcome] [role=button]')
				.count()) === 0
		);
		await begin(page); // a touch starts it at once; left alone it begins by itself
		const started = await waitFor(page, () => window.__player.player.engine.status === 'playing');
		check('the music starts', !!started);

		// a positive control for the error watch: `--inject-error` makes the page misbehave and the run must then FAIL
		if (args['inject-error'])
			await page.evaluate(() => {
				console.error('injected error');
				void fetch('/data/does-not-exist.bin');
			});

		// ---- play for a few seconds
		const a = await state();
		await sleep(PLAY_S * 1000);
		const b = await state();
		check(
			`the clock moves in real time (${PLAY_S} s)`,
			Math.abs(b.t - a.t - PLAY_S) < 0.6,
			`${(b.t - a.t).toFixed(2)} s`
		);
		check(
			'the time display moves with it',
			a.time !== '' && b.time !== a.time,
			`${a.time} -> ${b.time}`
		);

		// ---- seek by clicking the seek bar
		const bar = await page.getByTestId('seek').boundingBox();
		await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
		await sleep(1200);
		const c = await state();
		check(
			'a click in the middle of the seek bar seeks there and plays on',
			Math.abs(c.t - c.duration * 0.5) < c.duration * 0.02 && c.status === 'playing',
			`t ${c.t.toFixed(0)} of ${c.duration.toFixed(0)} s, ${c.status}`
		);
		await sleep(1000);
		const c2 = await state();
		check('and it keeps moving after the seek', c2.t - c.t > 0.7, `${(c2.t - c.t).toFixed(2)} s`);

		// ---- switch piece
		await page.getByRole('button', { name: 'Next piece' }).click();
		await sleep(1200);
		const d = await state();
		check(
			'Next piece goes to the next piece and plays',
			d.order === c.order + 1 && d.status === 'playing',
			`${c.piece} -> ${d.piece}`
		);
		await page.getByRole('button', { name: 'Previous piece' }).click();
		await sleep(1200);
		const e = await state();
		check(
			'Previous piece goes back',
			e.order === d.order - 1 && e.status === 'playing',
			`${d.piece} -> ${e.piece}`
		);

		// ---- pause and play from the keyboard (Space on a focused button presses that button, so let go of it first)
		await page.evaluate(() => document.activeElement?.blur());
		await page.keyboard.press('Space');
		await sleep(500);
		const f = await state();
		await sleep(700);
		const g = await state();
		check('Space pauses: the clock stands still', f.status !== 'playing' && g.t === f.t, f.status);
		await page.keyboard.press('Space');
		await sleep(1200);
		const h = await state();
		check('Space plays again', h.status === 'playing' && h.t > g.t + 0.5);

		// ---- the other pages
		for (const path of ['credits', 'stage']) {
			const p2 = await ctx.newPage();
			p2.on('pageerror', (er) => problems.push(`exception on /${path}: ${er.message}`));
			p2.on('console', (m) => {
				if (m.type() === 'error') problems.push(`console on /${path}: ${m.text()}`);
			});
			const res = await p2.goto(`${URL_BASE}/${path}`, { waitUntil: 'load' });
			await sleep(path === 'stage' ? 2500 : 500);
			check(
				`/${path} loads`,
				res?.status() === 200 && (await p2.title()) !== '',
				String(res?.status())
			);
			await p2.close();
		}
		check(
			'no console errors, exceptions or failed requests on the way',
			problems.length === 0,
			problems.slice(0, 4).join(' | ')
		);
	} catch (err) {
		check('the run completes', false, String(err.message).split('\n')[0]);
	} finally {
		await Promise.race([browser.close(), sleep(3000)]);
	}
	return { name, rows, fails };
}

let failed = 0;
for (const name of ENGINES) {
	const r = await run(name);
	console.log(`\n== ${name}`);
	if (r.skipped) console.log(`   skipped: ${r.skipped}`);
	for (const row of r.rows)
		console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.what}${row.detail ? ` (${row.detail})` : ''}`);
	failed += r.fails.length;
}
console.log(failed ? `\n${failed} FAILED` : '\nsmoke test passed');
process.exit(failed ? 1 : 0);
