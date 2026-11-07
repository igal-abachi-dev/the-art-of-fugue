// Flash measurement of the combined frame (T7.5.1): WCAG 2.3.1 "Three Flashes or Below Threshold" on what the listener sees.
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   node scripts/flash-check.mjs [--engine msedge|firefox] [--seconds 15] [--pieces c01,c05] [--reduced] [--url http://localhost:4173]
//
// For every piece it plays the loudest `--seconds` of it (found from `overview.bin`, the recording's own loudness) in real
// time on `/stage?scene=auto` (ambient layer and bloom on, as a listener has them), and in every animation frame composes
// what the page shows (the scene's background, the MilkDrop canvas at its opacity and the notes canvas over it) into a
// 128 x 72 picture. `src/lib/a11y/flash.ts` (the same module the unit tests check) follows every pixel: the general flashes
// (changes of relative luminance of 0.1 or more) and the red flashes, counted over any one second. It also plays the end of
// the last fugue (the freeze, the shatter and the black), a piece boundary, and the idle scene. The area that flashes more
// than three times a second must stay under 2.5 % of the frame. The interface's own elements (bar, panels, the title card)
// are not in the picture: they do not flash. Exit code 1 if any window fails.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const BASE = args.url ?? 'http://localhost:4173';
const SECONDS = Number(args.seconds ?? 15);
const ONLY = args.pieces ? args.pieces.split(',') : null;
const REDUCED = args.reduced === 'true';
const ENGINE = args.engine ?? 'msedge';
const W = 128;
const H = 72;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the analyser, compiled from the TypeScript the unit tests check
const flashJs = ts.transpileModule(
	readFileSync(resolve(here, '../src/lib/a11y/flash.ts'), 'utf8'),
	{
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
	}
).outputText;

// loudness per half second, from the file the seek bar draws
function loadOverview() {
	const buf = readFileSync(resolve(here, '../static/data/overview.bin'));
	const columns = buf.readUInt32LE(4);
	const step = buf.readFloatLE(8);
	return { step, level: buf.subarray(16, 16 + columns) };
}
const overview = loadOverview();
function loudestStart(p) {
	const n = Math.round(SECONDS / overview.step);
	const a = Math.floor(p.audio_start / overview.step);
	const b = Math.floor(p.audio_end / overview.step) - n;
	let best = a;
	let bestSum = -1;
	let sum = 0;
	for (let i = a; i < a + n; i++) sum += overview.level[i] ?? 0;
	for (let i = a; i <= b; i++) {
		if (i > a) sum += (overview.level[i + n - 1] ?? 0) - (overview.level[i - 1] ?? 0);
		if (sum > bestSum) {
			bestSum = sum;
			best = i;
		}
	}
	return best * overview.step;
}

const browser =
	ENGINE === 'firefox'
		? await firefox.launch({
				firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
			})
		: await chromium.launch({
				channel: 'msedge',
				args: ['--autoplay-policy=no-user-gesture-required']
			});
const ctx = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	reducedMotion: REDUCED ? 'reduce' : 'no-preference'
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(`${BASE}/stage?scene=auto${REDUCED ? '&reduced' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stagePage?.session && window.__stagePage?.stage, null, {
	timeout: 30000
});
await page.evaluate(
	async ([code]) => {
		const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
		window.__flash = await import(url);
	},
	[flashJs]
);
const manifest = await page.evaluate(() => window.__stagePage.session.engine.manifest);
const pieces = [...manifest.pieces].sort((a, b) => a.audio_start - b.audio_start);

/** play from `from` for `seconds` and measure every frame after a 2.5 s settle */
async function measure(from, seconds, strobe = false) {
	await page.evaluate((t) => {
		const e = window.__stagePage.session.engine;
		e.element.pause?.();
		e.seek(t);
	}, from);
	await sleep(1200);
	return page.evaluate(
		([seconds, W, H, strobe]) =>
			new Promise((done) => {
				const e = window.__stagePage.session.engine;
				const ambient = document.querySelector('canvas.ambient');
				const notes = document.querySelector('canvas.notes');
				const box = notes.parentElement;
				const probe = document.createElement('canvas');
				probe.width = W;
				probe.height = H;
				const g = probe.getContext('2d', { willReadFrequently: true });
				g.imageSmoothingEnabled = true;
				g.imageSmoothingQuality = 'high';
				const analyser = new window.__flash.FlashAnalyser(W * H);
				const SETTLE_MS = 2500;
				// the positive control: the page's background flips between black and white five times a second, under the layers
				let flip = null;
				if (strobe) {
					let on = false;
					box.style.setProperty('background', '#000', 'important');
					flip = setInterval(() => {
						on = !on;
						box.style.setProperty('background', on ? '#fff' : '#000', 'important');
					}, 100);
				}
				let t0 = null;
				let last = 0;
				let worstGap = 0;
				let frames = 0;
				e.element.play?.();
				const frame = (now) => {
					if (t0 === null) t0 = now;
					const elapsed = now - t0;
					if (elapsed >= SETTLE_MS) {
						g.globalAlpha = 1;
						g.fillStyle = getComputedStyle(box).backgroundColor || '#000';
						g.fillRect(0, 0, W, H);
						const op = Number(getComputedStyle(ambient).opacity);
						if (op > 0.004) {
							g.globalAlpha = op;
							g.drawImage(ambient, 0, 0, W, H);
						}
						g.globalAlpha = 1;
						g.drawImage(notes, 0, 0, W, H);
						analyser.pushRgba(now, g.getImageData(0, 0, W, H).data);
						frames++;
						if (last) worstGap = Math.max(worstGap, now - last);
						last = now;
					}
					if (elapsed < SETTLE_MS + seconds * 1000) requestAnimationFrame(frame);
					else {
						e.element.pause?.();
						if (flip) {
							clearInterval(flip);
							box.style.removeProperty('background');
						}
						done({ ...analyser.result, frames, worstGapMs: worstGap });
					}
				};
				requestAnimationFrame(frame);
			}),
		[seconds, W, H, strobe]
	);
}

const rows = [];
async function row(name, from, seconds, strobe = false) {
	const r = await measure(from, seconds, strobe);
	// the control is expected to be caught: a measurement that cannot fail proves nothing
	if (strobe) r.ok = !r.ok;
	const fps = r.frames / seconds;
	rows.push({ name, ...r, fps });
	console.log(
		`${r.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} general ${(r.general * 100).toFixed(2)} %  red ${(r.red * 100).toFixed(2)} %  ` +
			`changes/s ${r.maxChanges}  ${fps.toFixed(0)} fps  worst gap ${r.worstGapMs.toFixed(0)} ms`
	);
}

console.log(
	`flash check (${ENGINE}${REDUCED ? ', reduced motion' : ''}): ${SECONDS} s of the loudest part of every piece; limit ${(0.025 * 100).toFixed(1)} % of the frame flashing over 3 times a second`
);
for (const p of pieces) {
	if (ONLY && !ONLY.includes(p.id)) continue;
	await row(`${p.id} loudest ${SECONDS} s`, loudestStart(p), SECONDS);
}
if (!ONLY || ONLY.includes('c14')) {
	const last = pieces.at(-1);
	await row('ending of the last fugue', last.audio_end - 12, 12 + (last.tail_s ?? 4));
}
if (!ONLY || args.control) {
	if (!ONLY) {
		const c = pieces[1];
		await row('boundary: end of II into III', c.audio_end - 6, 12);
		await row('idle scene (before the first piece)', 0, 8);
	}
	await row('control: a 5 Hz strobe is caught', loudestStart(pieces[4]), 6, true);
}
if (errors.length) console.error('page errors:', [...new Set(errors)].slice(0, 5));
const failed = rows.filter((r) => !r.ok);
const control = rows.find((r) => r.name.startsWith('control'));
const worst = rows
	.filter((r) => !r.name.startsWith('control'))
	.reduce((m, r) => Math.max(m, r.general, r.red), 0);
if (control)
	console.log(
		`
the positive control (the background flipped between black and white at 5 Hz) measured ${(control.general * 100).toFixed(1)} % of the frame as flashing: ${control.ok ? 'caught, as it must be' : 'NOT CAUGHT'}`
	);
console.log(
	`\n${rows.length} windows, ${failed.length} over the limit; worst area flashing too often: ${(worst * 100).toFixed(2)} % of the frame`
);
await Promise.race([browser.close(), sleep(3000)]);
process.exit(failed.length ? 1 : 0);
