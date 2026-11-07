// Screenshots of the stage while a piece plays, for looking at (not a check).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   node scripts/look.mjs --pieces c01,c05,c14 [--at 30] [--play 2500] [--query "road=0"] [--tag name] [--out ../docs/img]
//                         [--engine msedge|firefox] [--url http://localhost:4173] [--size 1280x720]
//
// For each piece: open /stage?scene=auto&<query>, seek `--at` seconds into the piece, play for `--play` ms and save the
// stage as <out>/look-<tag>-<piece>.png. `--at` may be a list (30,90) for several shots of each piece.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox } from 'playwright';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const BASE = args.url ?? 'http://localhost:4173';
const OUT = resolve(args.out ?? '../docs/img');
const PIECES = (args.pieces ?? 'c01').split(',');
const ATS = String(args.at ?? 30)
	.split(',')
	.map(Number);
const PLAY = Number(args.play ?? 2500);
const QUERY = args.query ?? '';
const TAG = args.tag ?? 'x';
const [W, H] = (args.size ?? '1280x720').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser =
	(args.engine ?? 'msedge') === 'firefox'
		? await firefox.launch({
				firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
			})
		: await chromium.launch({
				channel: 'msedge',
				args: ['--autoplay-policy=no-user-gesture-required']
			});
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${BASE}/stage?scene=auto${QUERY ? `&${QUERY}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stagePage?.session && window.__stagePage?.stage, null, {
	timeout: 30000
});
for (const id of PIECES) {
	for (const at of ATS) {
		const start = await page.evaluate(
			(id) =>
				window.__stagePage.session.engine.manifest.pieces.find((p) => p.id === id)?.audio_start,
			id
		);
		if (start == null) {
			console.error(`no piece ${id}`);
			continue;
		}
		await page.evaluate((t) => {
			const e = window.__stagePage.session.engine;
			e.element.pause?.();
			e.seek(t);
		}, start + at);
		await sleep(900);
		await page.evaluate(() => window.__stagePage.session.engine.element.play?.());
		await sleep(PLAY);
		const file = resolve(OUT, `look-${TAG}-${id}${ATS.length > 1 ? `-${at}` : ''}.png`);
		await page.locator('.stage').screenshot({ path: file });
		console.log(file);
	}
}
if (errors.length) console.error('page errors:', [...new Set(errors)].slice(0, 5));
await browser.close();
