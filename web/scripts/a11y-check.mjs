// Accessibility check of the interface (T7.5.4): an automated axe-core run over every state, and the contrast of the text that
// sits straight on the picture.
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   node scripts/a11y-check.mjs [--engine msedge|firefox|both] [--url http://localhost:4173]
//
// 1. axe-core (WCAG 2.0/2.1/2.2 A and AA and best practice) on: the start screen, the player with the piece list open
//    (as Begin leaves it), with each panel open, with every panel closed, the credits page, and a phone-sized window.
//    Any violation of impact serious or critical fails; the others are listed. Text on the canvas cannot be judged by axe
//    (it reports it as "incomplete"), which is why 2. exists.
// 2. For every piece's scene: the title card (the only text over the picture) is placed on the composite of what the page
//    draws under it (the scene's background, the MilkDrop layer and the notes), and the contrast of each line of text is
//    measured against the lightest 2 % of the pixels behind it: at least 4.5:1, or 3:1 for large text (24 px, or 19 px
//    bold), the WCAG AA limits.
// The text-shadow of the title card is not counted (it only helps).

import { createRequire } from 'node:module';
import { chromium, firefox } from 'playwright';
import { begin } from './begin.mjs';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engine ?? 'both') === 'both' ? ['msedge', 'firefox'] : [args.engine];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(name) {
	return name === 'firefox'
		? firefox.launch({
				firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
			})
		: chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
}

let failures = 0;
const fail = (what, detail = '') => {
	failures++;
	console.log(`  FAIL ${what} ${detail}`);
};

/** the contrast of the interface's own text and icons, measured on a screenshot taken with all of them hidden */
async function uiContrast(page, label) {
	const items = await page.evaluate(COLLECT);
	const style = await page.addStyleTag({
		content:
			'*,*::before,*::after{color:transparent !important;text-shadow:none !important;caret-color:transparent !important} svg{stroke:transparent !important;fill:none !important}'
	});
	await sleep(150);
	const shot = (await page.screenshot({ animations: 'disabled' })).toString('base64');
	await style.evaluate((n) => n.remove());
	const res = await page.evaluate(MEASURE, [items, shot]);
	const checked = res.filter((r) => !r.disabled);
	const bad = checked.filter((r) => r.ratio < r.need);
	const worst = checked.reduce((m, r) => (!m || r.ratio / r.need < m.ratio / m.need ? r : m), null);
	console.log(
		`  ${bad.length ? 'FAIL' : 'ok  '} contrast ${label}: ${checked.length} texts and icons, tightest ${worst ? `${worst.who} ${worst.text ?? ''} ${worst.ratio.toFixed(2)}:${worst.need}` : '-'}`
	);
	const seen = new Set();
	for (const r of bad) {
		const key = r.who + r.text;
		if (seen.has(key)) continue;
		seen.add(key);
		fail(`${label}: ${r.kind} ${r.who} "${r.text ?? ''}"`, `${r.ratio.toFixed(2)} < ${r.need}`);
	}
}

async function axe(page, label) {
	await page.addScriptTag({ path: AXE }).catch(() => {});
	const res = await page.evaluate(() =>
		window.axe.run(document, {
			runOnly: {
				type: 'tag',
				values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
			}
		})
	);
	const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	const minor = res.violations.filter((v) => !(v.impact === 'serious' || v.impact === 'critical'));
	await uiContrast(page, label);
	console.log(
		`  ${bad.length ? 'FAIL' : 'ok  '} axe ${label}: ${res.passes.length} rules pass, ${bad.length} serious or critical, ${minor.length} lesser, ${res.incomplete.length} for a person to judge`
	);
	for (const v of bad)
		fail(
			`${label}: ${v.id} (${v.impact}) ${v.help}`,
			v.nodes
				.slice(0, 3)
				.map((n) => n.target.join(' '))
				.join(' | ')
		);
	for (const v of minor)
		console.log(
			`       note: ${v.id} (${v.impact}) ${v.help}: ${v.nodes
				.slice(0, 2)
				.map((n) => n.target.join(' '))
				.join(' | ')}`
		);
	for (const v of res.incomplete)
		console.log(`       to judge: ${v.id} on ${v.nodes.length} node(s)`);
}

/** page-side: every piece of text and every icon that is on show, with its colour, size and where it is */
const COLLECT = () => {
	const out = [];
	const parse = (c) => (c.match(/[0-9.]+/g) ?? [0, 0, 0, 1]).map(Number);
	const opacityOf = (el) => {
		let o = 1;
		for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
		return o;
	};
	// only what is on top at its own place counts (the start screen covers the bar, a list is cut off by its panel)
	const onTop = (el, [x, y, w, h]) => {
		const t = document.elementFromPoint(x + w / 2, y + h / 2);
		return !!t && (el.contains(t) || t.contains(el));
	};
	const label = (el) =>
		el.tagName.toLowerCase() +
		(el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '') +
		(el.className && typeof el.className === 'string'
			? '.' +
				el.className
					.split(' ')
					.filter((c) => !c.startsWith('svelte-'))
					.join('.')
			: '');
	for (const el of document.body.querySelectorAll('*')) {
		if (el.closest('.sr, .card[data-piece], script, style, canvas')) continue;
		const cs = getComputedStyle(el);
		if (cs.visibility === 'hidden' || cs.display === 'none') continue;
		const disabled = !!el.closest('[disabled], [aria-disabled=true]');
		const c = parse(cs.color);
		const alpha = (c[3] ?? 1) * opacityOf(el);
		if (el instanceof SVGElement && el.tagName.toLowerCase() === 'svg') {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && alpha > 0 && onTop(el, [r.left, r.top, r.width, r.height]))
				out.push({
					kind: 'icon',
					who: label(el.closest('button, a, [role]') ?? el),
					color: c,
					alpha,
					size: 24,
					bold: false,
					need: 3,
					disabled,
					rects: [[r.left, r.top, r.width, r.height]]
				});
			continue;
		}
		const rects = [];
		let text = '';
		for (const n of el.childNodes) {
			if (n.nodeType !== 3 || !n.textContent.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(n);
			for (const r of range.getClientRects())
				if (r.width > 0 && r.height > 0) rects.push([r.left, r.top, r.width, r.height]);
			text += n.textContent.trim() + ' ';
		}
		if (!rects.length || alpha <= 0 || !onTop(el, rects[0])) continue;
		const px = parseFloat(cs.fontSize);
		const bold = Number(cs.fontWeight) >= 700;
		const large = px >= 24 || (px >= 18.66 && bold);
		out.push({
			kind: 'text',
			who: label(el),
			text: text.trim().slice(0, 28),
			color: c,
			alpha,
			size: px,
			bold,
			need: large ? 3 : 4.5,
			disabled,
			rects
		});
	}
	return out.filter((i) =>
		i.rects.every(([x, y, w, h]) => x + w > 0 && y + h > 0 && x < innerWidth && y < innerHeight)
	);
};

/** page-side: the contrast of each collected item against the pixels of a screenshot taken with every colour hidden */
const MEASURE = async ([items, b64]) => {
	const lum = (r, g, b) => {
		const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	};
	const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
	const c = document.createElement('canvas');
	c.width = bmp.width;
	c.height = bmp.height;
	const g = c.getContext('2d', { willReadFrequently: true });
	g.drawImage(bmp, 0, 0);
	const k = bmp.width / innerWidth;
	return items.map((it) => {
		const ratios = [];
		for (const [x, y, w, h] of it.rects) {
			// the pixels inside the box of the text: a border or an edge just outside it is not what the text is read against
			const x0 = Math.max(0, Math.ceil(x * k));
			const y0 = Math.max(0, Math.ceil(y * k));
			const w1 = Math.max(1, Math.min(c.width - x0, Math.floor(w * k) - 1));
			const h1 = Math.max(1, Math.min(c.height - y0, Math.floor(h * k) - 1));
			const d = g.getImageData(x0, y0, w1, h1).data;
			const step = Math.max(4, Math.floor(d.length / 4 / 300) * 4);
			for (let i = 0; i < d.length; i += step) {
				const bg = [d[i], d[i + 1], d[i + 2]];
				const fg = [0, 1, 2].map((q) => it.alpha * it.color[q] + (1 - it.alpha) * bg[q]);
				const a = lum(fg[0], fg[1], fg[2]) + 0.05;
				const b = lum(bg[0], bg[1], bg[2]) + 0.05;
				ratios.push(Math.max(a, b) / Math.min(a, b));
			}
		}
		ratios.sort((p, q) => p - q);
		return { ...it, ratio: ratios[Math.floor(ratios.length * 0.02)] ?? 99 };
	});
};

/** page-side: the contrast of the title card's lines against the composite of the picture under them */
const CONTRAST = () => {
	const lum = (r, g, b) => {
		const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	};
	const ambient = document.querySelector('canvas.ambient');
	const notes = document.querySelector('canvas.notes');
	const box = notes.parentElement;
	const W = Math.round(box.clientWidth);
	const H = Math.round(box.clientHeight);
	const c = document.createElement('canvas');
	c.width = W;
	c.height = H;
	const g = c.getContext('2d', { willReadFrequently: true });
	g.fillStyle = getComputedStyle(box).backgroundColor || '#000';
	g.fillRect(0, 0, W, H);
	const op = Number(getComputedStyle(ambient).opacity);
	if (op > 0.004) {
		g.globalAlpha = op;
		g.drawImage(ambient, 0, 0, W, H);
	}
	g.globalAlpha = 1;
	g.drawImage(notes, 0, 0, W, H);
	const origin = box.getBoundingClientRect();
	const card = document.querySelector('.card[data-piece]');
	if (!card) return null;
	const out = [];
	for (const el of card.querySelectorAll('.kind, .name, .sub')) {
		const cs = getComputedStyle(el);
		const m = cs.color.match(/[\d.]+/g).map(Number);
		const alpha = Number(cs.opacity) * Number(getComputedStyle(card).opacity) * (m[3] ?? 1);
		const range = document.createRange();
		range.selectNodeContents(el);
		const r = range.getBoundingClientRect();
		const x0 = Math.max(0, Math.floor(r.left - origin.left));
		const y0 = Math.max(0, Math.floor(r.top - origin.top));
		const w = Math.max(1, Math.min(W - x0, Math.ceil(r.width)));
		const h = Math.max(1, Math.min(H - y0, Math.ceil(r.height)));
		const d = g.getImageData(x0, y0, w, h).data;
		const ratios = [];
		for (let i = 0; i < d.length; i += 8) {
			const bg = [d[i], d[i + 1], d[i + 2]];
			const fg = [0, 1, 2].map((k) => alpha * m[k] + (1 - alpha) * bg[k]);
			const a = lum(fg[0], fg[1], fg[2]) + 0.05;
			const b = lum(bg[0], bg[1], bg[2]) + 0.05;
			ratios.push(Math.max(a, b) / Math.min(a, b));
		}
		ratios.sort((p, q) => p - q);
		const px = parseFloat(cs.fontSize);
		const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
		out.push({
			line: el.className,
			text: el.textContent.trim().slice(0, 30),
			size: px,
			large,
			need: large ? 3 : 4.5,
			ratio: ratios[Math.floor(ratios.length * 0.02)] ?? 0
		});
	}
	return out;
};

for (const name of ENGINES) {
	console.log(`\n== ${name}`);
	const browser = await launch(name);
	const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	const page = await desktop.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e.message)));
	await page.goto(`${BASE}/?x=1`, { waitUntil: 'load' });
	await page.waitForFunction(() => window.__player?.player, null, { timeout: 30000 });
	// hold the welcome on the screen for the audit: it would fade after 1.3 s and begin by itself
	await page.evaluate(() => {
		window.__player.player.engine.autostart = () => new Promise(() => {});
	});
	await sleep(300);
	await axe(page, 'start screen');
	await begin(page);
	await sleep(2500);
	await axe(page, 'player, piece list open');
	for (const [key, label] of [
		['i', 'what am I hearing'],
		['e', 'effects'],
		['j', 'go to'],
		['?', 'help']
	]) {
		await page.keyboard.press('Escape');
		await sleep(200);
		await page.keyboard.press(key === '?' ? 'Shift+/' : key);
		await sleep(700);
		await axe(page, label);
	}
	await page.keyboard.press('Escape');
	await sleep(300);
	await axe(page, 'player, panels closed');
	await page.goto(`${BASE}/credits`, { waitUntil: 'load' });
	await sleep(500);
	await axe(page, 'credits page');
	const phone = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: name !== 'firefox'
	});
	const ph = await phone.newPage();
	await ph.goto(`${BASE}/?x=1`, { waitUntil: 'load' });
	await ph.waitForFunction(() => window.__player?.player, null, { timeout: 30000 });
	await begin(ph, { touch: true });
	await sleep(2500);
	await axe(ph, 'phone, piece list open');
	await ph.close();

	// ---- the title card over every scene
	console.log("  title card contrast over each piece's scene:");
	const p2 = await desktop.newPage();
	p2.on('pageerror', (e) => errors.push(String(e.message)));
	await p2.goto(`${BASE}/?x=1`, { waitUntil: 'load' });
	await p2.waitForFunction(() => window.__player?.player, null, { timeout: 30000 });
	await begin(p2);
	await sleep(1500);
	await p2.keyboard.press('Escape');
	// hold the card at its peak (it fades in and out over six seconds)
	await p2.addStyleTag({ content: '.card{animation:none !important;opacity:.92 !important}' });
	const pieces = await p2.evaluate(() =>
		[...window.__player.player.manifest.pieces]
			.sort((a, b) => a.audio_start - b.audio_start)
			.map((p) => p.id)
	);
	let worst = null;
	for (const id of pieces) {
		await p2.evaluate((id) => {
			const e = window.__player.player.engine;
			const p = e.manifest.pieces.find((x) => x.id === id);
			e.seekPlace({ piece: p, bar: 4 });
		}, id);
		await sleep(2600);
		const lines = await p2.evaluate(CONTRAST);
		if (!lines) {
			fail(`no title card for ${id}`);
			continue;
		}
		const bad = lines.filter((l) => l.ratio < l.need);
		const min = Math.min(...lines.map((l) => l.ratio / l.need));
		if (!worst || min < worst.min) worst = { id, min, lines };
		console.log(
			`  ${bad.length ? 'FAIL' : 'ok  '} ${id.padEnd(5)} ${lines.map((l) => `${l.line} ${l.ratio.toFixed(1)}:${l.need}`).join('  ')}`
		);
		if (bad.length)
			fail(
				`${id}: title card contrast`,
				bad.map((l) => `${l.line} ${l.ratio.toFixed(2)} < ${l.need}`).join(', ')
			);
	}
	if (worst)
		console.log(
			`  tightest: ${worst.id} at ${(worst.min * 100).toFixed(0)} % of the limit (${worst.lines.map((l) => `${l.line} ${l.ratio.toFixed(2)}`).join(', ')})`
		);
	if (errors.length) console.log('  page errors:', [...new Set(errors)].slice(0, 4));
	await Promise.race([browser.close(), sleep(3000)]);
}
console.log(`\n${failures ? failures + ' failure(s)' : 'all ok'}`);
process.exit(failures ? 1 : 0);
