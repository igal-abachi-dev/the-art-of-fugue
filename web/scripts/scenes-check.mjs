// Real-browser check of the per-piece scenes (E5), on `/stage?scene=auto&ambient=0&bloom=0`.
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm scenes-check [--url http://localhost:4173] [--engines msedge,firefox] [--shots ../docs/img]
//
// For one place in each kind of piece it checks that the scene director chose the right scene and that the effect is on
// screen, by the scene values and by pixels:
//   void (I-IV)      highlights on, no particles, subject notes tagged; inverted entries tagged in V
//   ribbons (VI)     ribbon strength 1;  themes (VIII)  theme colours drawn, none in a void piece;  shockwaves counted and rate-capped
//   mirror (XII)     ghost drawn for every note; the flip runs when XII inversus follows XII
//   canon (Canon 1)  lanes layout and link threads;  BACH (XIV)  white pixels at the exact motif and not elsewhere
//   ending (XIV)     hold at the last onset, shatter, black, and the same frames again after seeking back
//   title card       shown at a piece start with the piece's name, absent in a gap;  idle  embers drift in a gap
// It writes a screenshot per place and engine. Whether it looks good is for the eye: the screenshots are the evidence.

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

// the page-side helpers, installed once per page
const HELPERS = () => {
	const eng = () => window.__stagePage.session.engine;
	const stage = () => window.__stagePage.stage;
	const piece = (id) => eng().manifest.pieces.find((p) => p.id === id);
	window.__lv = [];
	let lastLevel = -1;
	setInterval(() => {
		const g = stage().governor;
		if (g.level !== lastLevel) {
			window.__lv.push(
				`${(performance.now() / 1000).toFixed(1)}s L${g.level} (${g.fps.toFixed(0)} fps, ${eng().piece?.id ?? '-'})`
			);
			lastLevel = g.level;
		}
	}, 100);
	window.__s = {
		eng,
		stage,
		piece,
		events: (id) => fetch(`/data/pieces/${id}.events.json`).then((r) => r.json()),
		seek: (t) => {
			eng().element.pause?.();
			eng().seek(t);
		},
		play: () => eng().element.play?.(),
		pause: () => eng().element.pause?.(),
		info: () => {
			const s = stage();
			return {
				t: eng().clock.now(),
				piece: eng().piece?.id ?? null,
				state: {
					ribbons: s.state.ribbons,
					themeColour: s.state.themeColour,
					ghost: s.state.ghost,
					links: s.state.links,
					highlight: s.state.highlight,
					particles: s.state.particles,
					shockwaves: s.state.shockwaves,
					layoutMix: s.state.layoutMix
				},
				fx: s.fxInfo(),
				level: s.governor.level,
				stats: s.stats()
			};
		},
		/** counts pixels of the stage canvas matching a predicate on (r, g, b) */
		pixels: (colours, tol) => {
			// the drawing buffer is not kept: render once and read it back in the same task
			const st = stage();
			const e = eng();
			st.render(
				{ t: e.clock.now(), dt: 0, discontinuity: false },
				e.piece ? e.window(e.piece.id) : null
			);
			const c = st.canvas;
			const probe = document.createElement('canvas');
			probe.width = c.width;
			probe.height = c.height;
			const ctx = probe.getContext('2d');
			ctx.drawImage(c, 0, 0);
			const px = ctx.getImageData(0, 0, probe.width, probe.height).data;
			const out = colours.map(() => 0);
			let white = 0;
			let max = 0;
			let lum = 0;
			for (let i = 0; i < px.length; i += 4) {
				const r = px[i];
				const g = px[i + 1];
				const b = px[i + 2];
				if (i < px.length * 0.58 && r > 250 && g > 250 && b > 250) white++; // above the white keys
				max = Math.max(max, r, g, b);
				lum += r + g + b;
				// the notes are above the keyboard: its red felt edge, blended with ivory, would pass for a theme colour
				if (i >= px.length * 0.58) continue;
				colours.forEach((col, k) => {
					if (Math.abs(r - col[0]) + Math.abs(g - col[1]) + Math.abs(b - col[2]) < tol) out[k]++;
				});
			}
			return { counts: out, white, max, lum: lum / (px.length / 4) / 3 };
		}
	};
};

async function waitFor(page, fn, arg, timeout = 8000) {
	const t0 = Date.now();
	for (;;) {
		const v = await page.evaluate(fn, arg).catch(() => null);
		if (v) return v;
		if (Date.now() - t0 > timeout) return null;
		await sleep(80);
	}
}

const THEMES = [
	[86, 180, 233],
	[230, 159, 0],
	[204, 121, 167],
	[0, 158, 115],
	[213, 94, 0],
	[240, 228, 66]
];

async function run(name) {
	const out = { engine: name, ok: false, checks: [], notes: [] };
	const check = (what, ok, detail = '') => {
		out.checks.push({ what, ok: !!ok, detail });
		if (!ok) console.error(`  FAIL ${what} ${detail}`);
	};
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
		await page.goto(`${URL_BASE}/stage?scene=auto&ambient=0&bloom=0`, { waitUntil: 'load' });
		await page.waitForFunction(
			() => window.__stagePage?.session && window.__stagePage?.stage,
			null,
			{
				timeout: 30000
			}
		);
		await page.evaluate(HELPERS);
		const shot = (n) =>
			page.locator('.stage').screenshot({ path: resolve(SHOTS, `scene-${n}-${name}.png`) });

		/** go to a time in a piece and wait for the scene and the piece's annotations to be on stage */
		async function at(id, t, { needTags = true, settle = 1600 } = {}) {
			await page.evaluate(([t]) => window.__s.seek(t), [t]);
			const ok = await waitFor(
				page,
				([id, needTags]) => {
					const i = window.__s.info();
					return i.piece === id && (!needTags || i.fx.tagged) ? i : null;
				},
				[id, needTags],
				12000
			);
			await sleep(settle); // the scene fade is 0.9 s
			return ok ? page.evaluate(() => window.__s.info()) : null;
		}
		const firstEvent = (id, pred) =>
			page.evaluate(
				async ([id, src]) => {
					const f = new Function('e', `return ${src}`);
					return (await window.__s.events(id)).find((e) => f(e)) ?? null;
				},
				[id, pred]
			);

		// ---- void: I to IV, with an inverted entry in V
		let ev = await firstEvent('c01', "e.type === 'subject-entry'");
		let i = await at('c01', ev.t + 0.4);
		check(
			'c01 void: scene chosen, highlights on',
			i && i.state.highlight > 0.95,
			JSON.stringify(i?.state)
		);
		check('c01 void: no ambient particles', i && i.state.particles < 0.01);
		check('c01 void: subject notes tagged', i && i.fx.subjectNotes > 20, `${i?.fx.subjectNotes}`);
		const emitted0 = i?.stats.particlesEmitted;
		await sleep(800);
		await page.evaluate(() => window.__s.play());
		await sleep(2500);
		i = await page.evaluate(() => window.__s.info());
		check(
			'c01 void: playing makes no particles',
			i.stats.particlesEmitted === emitted0,
			`${emitted0} -> ${i.stats.particlesEmitted}`
		);
		await page.evaluate(() => window.__s.pause());
		await shot('c01-void');

		ev = await firstEvent('c05', "e.type === 'subject-entry' && e.data.inverted === true");
		i = await at('c05', ev.t + 0.3);
		check('c05: inverted entries tagged', i && i.fx.invertedNotes > 0, `${i?.fx.invertedNotes}`);
		await shot('c05-inverted');

		// ---- ribbons
		ev = await firstEvent('c06', "e.type === 'subject-entry' && e.data.ratio === 0.5");
		i = await at('c06', ev.t + 0.5);
		check('c06 ribbons: scene chosen', i && i.state.ribbons > 0.95, JSON.stringify(i?.state));
		await shot('c06-ribbons-diminution');
		ev = await firstEvent('c07', "e.type === 'subject-entry' && e.data.ratio === 2");
		i = await at('c07', ev.t + 0.5);
		await shot('c07-ribbons-augmentation');

		// ---- themes and shockwaves
		await at('c01', 40);
		const voidPx = await page.evaluate(([c]) => window.__s.pixels(c, 60), [THEMES]);
		ev = await firstEvent('c08', "e.type === 'subject-entry' && e.data.theme === 'S2'");
		i = await at('c08', ev.t + 0.4);
		check('c08 themes: scene chosen', i && i.state.themeColour > 0.95, JSON.stringify(i?.state));
		const themePx = await page.evaluate(([c]) => window.__s.pixels(c, 60), [THEMES]);
		check(
			'c08 themes: theme colours on screen (and not in c01)',
			themePx.counts.slice(0, 2).every((n) => n > 40) &&
				Math.max(...voidPx.counts.slice(0, 3)) < themePx.counts[1],
			`c08 ${themePx.counts} c01 ${voidPx.counts} level ${i?.level}`
		);
		await shot('c08-themes');
		ev = await firstEvent('c11', "e.type === 'clash'");
		i = await at('c11', ev.t - 3, { settle: 1200 });
		const shock0 = i.fx.shocksEmitted;
		const tPlay = Date.now();
		await page.evaluate(() => window.__s.play());
		await sleep(9000);
		i = await page.evaluate(() => window.__s.info());
		const secs = (Date.now() - tPlay) / 1000;
		await page.evaluate(() => window.__s.pause());
		check(
			'c11: clashes and crossings ring',
			i.fx.shocksEmitted - shock0 >= 1,
			`${i.fx.shocksEmitted - shock0} in ${secs.toFixed(1)} s`
		);
		check(
			'c11: at most three rings a second',
			(i.fx.shocksEmitted - shock0) / secs <= 3,
			`${((i.fx.shocksEmitted - shock0) / secs).toFixed(2)}/s`
		);
		out.shocks = { rings: i.fx.shocksEmitted - shock0, refused: i.fx.shocksRefused, seconds: secs };

		// ---- mirror
		const m = await page.evaluate(() => window.__s.piece('c12r'));
		i = await at('c12r', m.audio_start + 40);
		check(
			'c12r mirror: scene chosen, ghost drawn',
			i && i.state.ghost > 0.95 && i.fx.ghostVisible,
			JSON.stringify(i?.fx)
		);
		check(
			'c12r mirror: every note has a counterpart',
			i && i.fx.ghostNotes === m.n_notes,
			`${i?.fx.ghostNotes} of ${m.n_notes}`
		);
		await shot('c12r-mirror');
		// rectus into inversus: the flip
		await at('c12r', m.audio_end - 1.2, { settle: 300 });
		await page.evaluate(() => window.__s.play());
		let minFlip = 1;
		let reached = false;
		for (let k = 0; k < 90; k++) {
			await sleep(100);
			const f = await page.evaluate(() => window.__s.info());
			if (f.piece === 'c12i') reached = true;
			minFlip = Math.min(minFlip, f.fx.flip);
		}
		await page.evaluate(() => window.__s.pause());
		const end = await page.evaluate(() => window.__s.info());
		check('c12r to c12i: the flip runs', reached && minFlip < -0.5, `lowest ${minFlip.toFixed(2)}`);
		check('c12r to c12i: and settles as written', end.fx.flip > 0.999, `${end.fx.flip}`);

		// ---- canon
		i = await at('k1', (await page.evaluate(() => window.__s.piece('k1'))).audio_start + 30);
		check(
			'k1 canon: lanes and links',
			i && i.state.layoutMix > 0.95 && i.state.links > 0.95 && i.fx.linksDrawn > 0,
			JSON.stringify([i?.state.layoutMix, i?.fx.linksDrawn])
		);
		await shot('k1-canon');

		// ---- BACH and the ending
		const bach = await firstEvent('c14', "e.type === 'bach' && e.data.form === 'exact'");
		i = await at('c14', bach.t + 0.05, { settle: 1200 });
		check('c14: BACH notes tagged', i && i.fx.bachNotes >= 4, `${i?.fx.bachNotes}`);
		const wB = await page.evaluate(() => window.__s.pixels([], 0));
		await shot('c14-bach');
		const others = [];
		for (const dt of [20, 41, 77]) {
			await at('c14', bach.t + dt, { settle: 300 });
			others.push((await page.evaluate(() => window.__s.pixels([], 0))).white);
		}
		check(
			'c14: the BACH notes are the whitest thing on screen',
			wB.white > 2 * Math.max(...others) + 20,
			`at BACH ${wB.white}, elsewhere ${others} level ${i?.level}`
		);

		const plan = i.fx.ending;
		check('c14: an ending is planned', !!plan, JSON.stringify(plan));
		if (plan) {
			out.ending = plan;
			const c14 = await page.evaluate(() => window.__s.piece('c14'));
			out.ending.audio_end = c14.audio_end;
			let e = await at('c14', plan.freezeAt + 0.5, { settle: 400 });
			check(
				'c14 ending: notes held at the last onset',
				e.fx.hold === plan.freezeAt && e.fx.noteFade === 1,
				JSON.stringify([e.fx.hold, e.fx.noteFade])
			);
			await shot('c14-ending-frozen');
			e = await at('c14', plan.shatterAt + 0.6, { settle: 400 });
			check(
				'c14 ending: shattered, notes gone',
				e.fx.shattered && e.fx.noteFade < 0.01 && e.fx.dim > 0.95,
				JSON.stringify([e.fx.shattered, e.fx.noteFade, e.fx.dim])
			);
			const sh = await page.evaluate(() => window.__s.pixels([], 0));
			check(
				'c14 ending: particles on screen after the shatter',
				sh.lum > 0.4 || sh.max > 120,
				JSON.stringify(sh)
			);
			await shot('c14-ending-shatter');
			e = await at('c14', plan.shatterAt + 1.8, { settle: 400 });
			await shot('c14-ending-fading');
			e = await at('c14', plan.blackAt + 0.5, { settle: 400 });
			const black = await page.evaluate(() => window.__s.pixels([], 0));
			check(
				'c14 ending: black at the end',
				e.fx.dim === 0 && black.max < 16,
				JSON.stringify([e.fx.dim, black.max])
			);
			e = await at('c14', plan.freezeAt - 6, { settle: 400 });
			check(
				'c14 ending: seeking back restores the picture',
				e.fx.dim === 1 && e.fx.hold === plan.freezeAt && !e.fx.shattered && e.fx.noteFade === 1,
				JSON.stringify(e.fx)
			);
			const back = await page.evaluate(() => window.__s.pixels([], 0));
			check('c14 ending: and it is not black', back.max > 100, JSON.stringify(back));
		}

		// ---- title card and idle
		const c04 = await page.evaluate(() => window.__s.piece('c04'));
		await at('c04', c04.audio_start + 0.4, { settle: 900 });
		const card = await page.evaluate(() => {
			const c = document.querySelector('.card');
			return c
				? {
						text: c.textContent.replace(/\s+/g, ' ').trim(),
						opacity: Number(getComputedStyle(c).opacity),
						piece: c.dataset.piece
					}
				: null;
		});
		check(
			'title card: shown at the piece start with the name',
			card && card.piece === 'c04' && card.text.includes('Contrapunctus IV') && card.opacity > 0.3,
			JSON.stringify(card)
		);
		await shot('title-card');
		const c05 = await page.evaluate(() => window.__s.piece('c05'));
		const gap = c04.audio_end + 1.5;
		check('a silent gap exists after IV', gap < c05.audio_start);
		await at('c04', gap, { needTags: false, settle: 1500 });
		const noCard = await page.evaluate(() => document.querySelector('.card') === null);
		check('title card: none in a gap', noCard);
		i = await page.evaluate(() => window.__s.info());
		check(
			'idle: the idle scene is on in a gap',
			i.piece === null && i.state.particles > 0.3 && i.state.particles < 0.7,
			JSON.stringify([i.piece, i.state.particles])
		);
		const em0 = i.stats.particlesEmitted;
		await page.evaluate(() => window.__s.play());
		await sleep(1800);
		i = await page.evaluate(() => window.__s.info());
		await page.evaluate(() => window.__s.pause());
		check(
			'idle: embers drift up in the gap',
			i.stats.particlesEmitted > em0 || i.piece !== null,
			`${em0} -> ${i.stats.particlesEmitted} level ${i.level}`
		);
		await shot('idle-gap');

		out.levelTrace = await page.evaluate(() => window.__lv);
		out.errors = errors.slice(0, 4);
		check('no errors in the console', errors.length === 0, errors.slice(0, 2).join(' | '));
		out.ok = out.checks.every((c) => c.ok);
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
