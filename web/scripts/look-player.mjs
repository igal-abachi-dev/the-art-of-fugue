// Screenshots of the player interface (the controls and a panel) while a piece plays, for looking at (not a check).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   node scripts/look-player.mjs [--size 1920x1080] [--at "?p=v&bar=20"] [--panels pieces,effects] [--tag name] [--out D:/tmp/looks]
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
const BASE = args.url ?? 'http://localhost:4173';
const OUT = resolve(args.out ?? '../docs/img');
const [W, H] = (args.size ?? '1920x1080').split('x').map(Number);
const PANELS = (args.panels ?? '').split(',').filter(Boolean);
const TAG = args.tag ?? 'x';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
	channel: 'msedge',
	args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await (
	await browser.newContext({
		viewport: { width: W, height: H },
		hasTouch: args.touch === 'true',
		isMobile: args.touch === 'true'
	})
).newPage();
await page.goto(`${BASE}/${args.at ?? '?p=v&bar=20'}`, { waitUntil: 'load' });
await begin(page, { touch: args.touch === 'true' });
await sleep(3500);
await page.mouse.move(W / 2, H - 40);
await sleep(400);
const file = (n) => resolve(OUT, `player-${TAG}-${n}.png`);
await page.screenshot({ path: file('controls') });
console.log(file('controls'));
for (const p of PANELS) {
	await page.getByTestId(p).click();
	await sleep(500);
	await page.screenshot({ path: file(p) });
	console.log(file(p));
	await page.getByTestId(p).click();
}
await browser.close();
process.exit(0);
