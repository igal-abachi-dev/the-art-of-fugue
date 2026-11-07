// Real-browser check of the spectrogram view (`/stage?spectro`).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm spectro-check [--url http://localhost:4173] [--engines msedge,firefox] [--shots ../docs/img]
//
// For several places in several pieces it checks that the spectrogram file loads and is drawn (a good part of the canvas is
// lit, not the empty background), that the notes are drawn on it in their voice colours and that the notes sounding now are
// underlined (full-strength voice-colour pixels). It writes a screenshot per engine. It cannot judge whether the notes sit on
// the ridges of the picture by eye: that is what the view is for.

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
mkdirSync(SHOTS, { recursive: true });
const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	firefox: () => firefox.launch(),
	webkit: () => webkit.launch()
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLACES = [
	['c01', 10],
	['c05', 40],
	['c11', 83],
	['c12i', 20],
	['c14', 100],
	['k1', 20],
	['k4', 60]
];
const VOICES = [
	[240, 228, 66],
	[0, 158, 115],
	[213, 94, 0],
	[183, 156, 255]
];

async function run(name) {
	const out = { engine: name, ok: false, notes: [], places: [] };
	let browser;
	try {
		browser = await launchers[name]();
	} catch (e) {
		out.notes.push(`could not launch: ${String(e.message).split('\n')[0]}`);
		return out;
	}
	try {
		const page = await (
			await browser.newContext({ viewport: { width: 1280, height: 720 } })
		).newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e.message)));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`);
		});
		await page.goto(`${URL_BASE}/stage?spectro`, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__stagePage?.session, null, { timeout: 30000 });
		for (const [id, bar] of PLACES) {
			await page.evaluate(
				([id, bar]) => {
					const e = window.__stagePage.session.engine;
					const piece = e.manifest.pieces.find((p) => p.id === id);
					const b = piece.bars.find((x) => x.n === bar);
					e.seek(Math.max(b.t, piece.audio_start) + 0.3);
				},
				[id, bar]
			);
			let stats = null;
			for (let k = 0; k < 80; k++) {
				await sleep(100);
				stats = await page.evaluate((voices) => {
					const c = document.querySelector('.spectro canvas');
					if (!c || c.width < 10) return null;
					const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
					let lit = 0;
					let voice = 0;
					for (let i = 0; i < px.length; i += 4) {
						const r = px[i];
						const g = px[i + 1];
						const b = px[i + 2];
						if (r + g + b > 150) lit++;
						for (const v of voices)
							if (Math.abs(r - v[0]) + Math.abs(g - v[1]) + Math.abs(b - v[2]) < 30) {
								voice++;
								break;
							}
					}
					return {
						lit: lit / (px.length / 4),
						voice,
						status: document.querySelector('.spectro p')?.textContent ?? ''
					};
				}, VOICES);
				if (stats && !stats.status && stats.lit > 0.02) break;
			}
			const row = { id, bar, ...stats };
			row.ok = !!stats && !stats.status && stats.lit > 0.03 && stats.voice > 40;
			out.places.push(row);
		}
		await page.screenshot({
			path: resolve(SHOTS, `spectro-${name}.png`),
			clip: { x: 0, y: 0, width: 1280, height: 340 }
		});
		out.errors = errors.slice(0, 4);
		out.ok = out.places.every((p) => p.ok) && errors.length === 0;
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
process.exit(results.every((r) => r.ok) ? 0 : 1);
