// Real-browser check of the ambient / MilkDrop layer and the reactive effects (E6).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm ambient-check [--url http://localhost:4173] [--engines msedge,firefox] [--shots ../docs/img] [--bench]
//
// It checks, on /stage?scene=auto:
//   lazy loading       the first page load has no butterchurn and no preset; presets are fetched one by one as scenes ask
//   ambient layer      draws under the notes, follows the scene's preset at each piece change, holds still when paused,
//                      shows through (the page is brighter than without it) and stays restrained (dim on its own)
//   bloom              follows the loudness; off with ?bloom=0 and from governor level 2
//   camera             drift moves slowly with the playhead; shake only on loud passages; neither with ?reduced
//   voice energy       rises for the voice that plays and for it only; signals (energy, onsets) follow the sound and relax when paused
//   governor           level 4 turns the ambient layer off; the ending fades it out with everything else
// `--bench` adds frame rates for the four compositing combinations and the cost of the other way of compositing
// (copying butterchurn's canvas into a texture), for docs/ambient.md.  Whether it looks good is for the eye: the
// screenshots in docs/img/ambient-*.png are the evidence.

import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--'))
			acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engines ?? 'msedge,firefox').split(',');
const SHOTS = resolve(args.shots ?? '../docs/img');
const BENCH = args.bench === 'true';
const BENCH_UNCAPPED = BENCH && args.uncapped === 'true';
mkdirSync(SHOTS, { recursive: true });
const launchers = {
	msedge: () =>
		chromium.launch({
			channel: 'msedge',
			args: [
				'--autoplay-policy=no-user-gesture-required',
				// for --bench: no vsync, so the frame rate shows how much work a frame is
				...(BENCH_UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])
			]
		}),
	firefox: () =>
		firefox.launch({
			firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
		}),
	webkit: () => webkit.launch()
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// what scenes.json says, so the check follows the file and not a copy of it
const BOOK = JSON.parse(readFileSync(resolve('src/lib/scenes/scenes.json'), 'utf8'));
const sceneOf = (id) => {
	const v = BOOK.pieces[id];
	return typeof v === 'string' ? BOOK.scenes[v] : (v ?? BOOK.default);
};
const ambientOf = (id) => ({
	preset: null,
	opacity: 0,
	...(BOOK.default.ambient ?? {}),
	...(sceneOf(id)?.ambient ?? {})
});
const CURATED = JSON.parse(readFileSync(resolve('src/lib/ambient/curated.json'), 'utf8')).presets;

const HELPERS = () => {
	const eng = () => window.__stagePage.session.engine;
	const stage = () => window.__stagePage.stage;
	const piece = (id) => eng().manifest.pieces.find((p) => p.id === id);
	window.__s = {
		eng,
		stage,
		piece,
		seek: (t) => {
			eng().element.pause?.();
			eng().seek(t);
		},
		play: () => eng().element.play?.(),
		pause: () => eng().element.pause?.(),
		layer: () => window.__stagePage.ambient,
		info: () => {
			const s = stage();
			const a = window.__stagePage.ambient;
			return {
				t: eng().clock.now(),
				piece: eng().piece?.id ?? null,
				e6: s.e6Info(),
				stats: s.stats(),
				scenePreset: s.ambientPreset,
				layer: a ? a.info() : null,
				canvasDisplay: a ? a.canvas.style.display : null,
				canvasOpacity: a ? Number(a.canvas.style.opacity) : null
			};
		},
		/** render now and measure the stage canvas (the drawing buffer is not kept): mean 0..255 and the share above 200 */
		measure: (energy) => {
			const st = stage();
			const e = eng();
			e.update(); // the piece follows the clock only when asked
			if (energy !== undefined) st.signals.energy = energy;
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
			let sum = 0;
			let a = 0;
			let alpha = 0;
			for (let i = 0; i < px.length; i += 4) {
				const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
				sum += l;
				if (l > 200) a++;
				alpha += px[i + 3];
			}
			const n = px.length / 4;
			return { mean: sum / n, bright: a / n, alpha: alpha / n };
		},
		/** mean luminance of the top quarter of a PNG (base64), where no notes or keys are */
		topMean: async (b64) => {
			const img = new Image();
			img.src = `data:image/png;base64,${b64}`;
			await img.decode();
			const c = document.createElement('canvas');
			c.width = img.width;
			c.height = Math.floor(img.height * 0.25);
			const ctx = c.getContext('2d');
			ctx.drawImage(img, 0, 0);
			const px = ctx.getImageData(0, 0, c.width, c.height).data;
			let sum = 0;
			let mx = 0;
			for (let i = 0; i < px.length; i += 4) {
				const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
				sum += l;
				if (l > mx) mx = l;
			}
			return { mean: sum / (px.length / 4), max: mx };
		}
	};
};

async function waitFor(page, fn, arg, timeout = 8000) {
	const t0 = Date.now();
	for (;;) {
		const v = await page.evaluate(fn, arg).catch(() => null);
		if (v) return v;
		if (Date.now() - t0 > timeout) return null;
		await sleep(100);
	}
}

/** sizes of the built chunks that contain a marker string, for the bundle numbers */
function chunkSizes() {
	const dir = resolve('build/_app/immutable');
	const out = {};
	const walk = (d) => {
		for (const f of readdirSync(d)) {
			const p = join(d, f);
			if (statSync(p).isDirectory()) walk(p);
			else if (f.endsWith('.js')) {
				const text = readFileSync(p, 'utf8');
				for (const [name, marker] of [
					['butterchurn', 'createVisualizer'],
					['bloom (post-processing)', 'UnrealBloomPass'],
					['three', 'WebGLRenderer']
				])
					if (text.includes(marker))
						(out[name] ??= []).push({ file: f, kib: +(statSync(p).size / 1024).toFixed(1) });
			}
		}
	};
	try {
		walk(dir);
	} catch {
		/* no build */
	}
	return out;
}

async function run(name) {
	const out = { engine: name, ok: false, checks: [], notes: [], numbers: {} };
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
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const errors = [];
		const watch = (page) => {
			page.on('pageerror', (e) => errors.push(String(e.message)));
			page.on('console', (m) => {
				if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`);
			});
		};
		/** open /stage with a query and wait for the stage; returns the page */
		async function open(query) {
			const page = await ctx.newPage();
			watch(page);
			const requests = [];
			page.on('request', (r) => requests.push(r.url()));
			page.requests = requests;
			await page.goto(`${URL_BASE}/stage?${query}`, { waitUntil: 'load' });
			await page.waitForFunction(
				() => window.__stagePage?.session && window.__stagePage?.stage,
				null,
				{ timeout: 30000 }
			);
			await page.evaluate(HELPERS);
			return page;
		}
		async function at(page, id, t, { settle = 1500, layer = false } = {}) {
			await page.evaluate(([t]) => window.__s.seek(t), [t]);
			const ok = await waitFor(
				page,
				([id]) => (window.__s.info().piece === id ? 1 : 0),
				[id],
				12000
			);
			await sleep(settle);
			if (layer)
				await waitFor(page, () => (window.__s.layer()?.status === 'ready' ? 1 : 0), null, 20000);
			return ok ? page.evaluate(() => window.__s.info()) : null;
		}
		const shotOf = (page, n) =>
			page.locator('.stage').screenshot({ path: resolve(SHOTS, `ambient-${n}-${name}.png`) });
		const pieceAt = async (page, id, off) =>
			(await page.evaluate((id) => window.__s.piece(id).audio_start, id)) + off;

		// ---- lazy loading: a page with the layer off never fetches butterchurn or a preset
		let page = await open('scene=auto&ambient=0');
		await at(page, 'c05', await pieceAt(page, 'c05', 20), { settle: 800 });
		const offJs = page.requests.filter((u) => u.endsWith('.js'));
		const offHas = [];
		for (const u of offJs) {
			const text = await page.evaluate((u) => fetch(u).then((r) => r.text()), u);
			if (text.includes('createVisualizer')) offHas.push(u);
		}
		check(
			'lazy: no butterchurn in a page that never shows the layer',
			offHas.length === 0,
			offHas.join(' ')
		);
		check(
			'lazy: no preset fetched without the layer',
			!page.requests.some((u) => u.includes('/data/ambient/'))
		);
		check(
			'lazy: the layer object does not exist',
			(await page.evaluate(() => window.__s.layer())) === null
		);
		await page.close();

		// ---- the layer on c05 (counter fugue), against the same moment without it
		const c05 = ambientOf('c05');
		check(
			'scenes.json gives c05 an ambient preset',
			!!c05.preset && c05.opacity > 0,
			JSON.stringify(c05)
		);
		page = await open('scene=auto');
		const t05 = await pieceAt(page, 'c05', 30);
		let i = await at(page, 'c05', t05, { layer: true });
		check(
			'layer: ready with the scene’s preset',
			i?.layer?.status === 'ready' && i.layer.preset === c05.preset,
			JSON.stringify(i?.layer)
		);
		check(
			'layer: only presets that scenes asked for were fetched',
			page.requests
				.filter((u) => u.includes('/data/ambient/') && !u.split('?')[0].endsWith('index.json'))
				.every((u) => Object.keys(CURATED).some((id) => u.split('?')[0].endsWith(`/${id}.json`)))
		);
		const asked = page.requests.filter((u) => u.includes('/data/ambient/')).length;
		check(
			'lazy: far fewer presets fetched than curated',
			asked <= Math.max(3, Object.keys(CURATED).length - 1),
			`${asked} of ${Object.keys(CURATED).length}`
		);
		await page.evaluate(() => window.__s.play());
		await sleep(2200);
		const playing = await page.evaluate(() => window.__s.info());
		check(
			'layer: draws while playing',
			playing.layer.framesDrawn > 10,
			`${playing.layer.framesDrawn} frames, ${playing.layer.lastMs.toFixed(1)} ms last`
		);
		check(
			'layer: canvas shows at the scene’s opacity',
			Math.abs(playing.canvasOpacity - c05.opacity) < 0.03 && playing.canvasDisplay === 'block',
			`${playing.canvasOpacity} vs ${c05.opacity}`
		);
		check(
			'layer: the stage canvas is transparent over it',
			(await page.evaluate(() => window.__s.measure())).alpha < 250
		);
		await page.evaluate(() => window.__s.pause());
		await sleep(400);
		const f0 = (await page.evaluate(() => window.__s.info())).layer.framesDrawn;
		await sleep(1200);
		const f1 = (await page.evaluate(() => window.__s.info())).layer.framesDrawn;
		check('layer: holds still when paused', f1 === f0, `${f0} -> ${f1}`);
		await at(page, 'c05', t05, { settle: 1200 }); // the same moment as the picture without the layer
		const withShot = await page.locator('.stage').screenshot();
		await shotOf(page, 'c05');
		const withTop = await page.evaluate((b) => window.__s.topMean(b), withShot.toString('base64'));
		// the layer alone: hide the notes' canvas
		await page.evaluate(() => (document.querySelector('canvas.notes').style.visibility = 'hidden'));
		const aloneShot = await page.locator('.stage').screenshot();
		await shotOf(page, 'c05-layer-alone');
		await page.evaluate(() => (document.querySelector('canvas.notes').style.visibility = ''));
		const alone = await page.evaluate((b) => window.__s.topMean(b), aloneShot.toString('base64'));
		const page2 = await open('scene=auto&ambient=0');
		await at(page2, 'c05', t05, { settle: 1500 });
		const withoutShot = await page2.locator('.stage').screenshot();
		await shotOf(page2, 'c05-without');
		const without = await page2.evaluate(
			(b) => window.__s.topMean(b),
			withoutShot.toString('base64')
		);
		await page2.close();
		out.numbers.topMean = {
			without: without.mean,
			with: withTop.mean,
			layerAlone: alone.mean,
			layerAloneMax: alone.max
		};
		check(
			'layer: it shows through (the page is lighter than without it)',
			withTop.mean > without.mean + 0.2,
			JSON.stringify(out.numbers.topMean)
		);
		check(
			'layer: restrained (dim on its own, nowhere near white)',
			alone.mean < 70 && alone.max < 220,
			JSON.stringify(out.numbers.topMean)
		);

		// ---- a preset per piece and a blend at the changes
		const seen = [];
		for (const id of ['c01', 'c06', 'c08', 'c12r', 'c14', 'k1']) {
			const want = ambientOf(id);
			await at(page, id, await pieceAt(page, id, 25), { settle: 700 });
			let got = null;
			if (want.preset)
				got = await waitFor(
					page,
					([p]) => (window.__s.layer()?.info().preset === p ? 1 : 0),
					[want.preset],
					15000
				);
			const l = await page.evaluate(() => window.__s.info());
			seen.push([id, l.layer?.preset ?? null]);
			check(
				`${id}: the layer follows the scene (${want.preset ?? 'none'}, opacity ${want.opacity})`,
				(want.preset ? !!got : true) &&
					!l.layer?.failure &&
					Math.abs(l.e6.ambientOpacity - want.opacity) < 0.03 + 0.001,
				JSON.stringify([l.layer?.preset, l.layer?.failure, l.e6.ambientOpacity])
			);
		}
		out.numbers.presetsByPiece = seen;
		const gapAfter = await page.evaluate(() => {
			const a = window.__s.piece('c04');
			const b = window.__s.piece('c05');
			return a.audio_end + 1.5 < b.audio_start ? a.audio_end + 1.5 : null;
		});
		if (gapAfter) {
			const idle = BOOK.idle?.ambient ?? null ?? ambientOf('__none');
			const g = await at(page, null, gapAfter, { settle: 1500 });
			check(
				'idle gap: the idle scene’s layer shows',
				g && g.piece === null && g.e6.ambientOpacity >= (BOOK.idle?.ambient?.opacity ?? 0) - 0.03,
				JSON.stringify([g?.piece, g?.e6.ambientOpacity, idle])
			);
			await shotOf(page, 'idle-gap');
		}

		// ---- the same moment of c14 for several pictures: bloom
		const t14 = await pieceAt(page, 'c14', 120);
		await at(page, 'c14', t14, { settle: 1500 });
		await shotOf(page, 'c14');
		const quiet = await page.evaluate(() => window.__s.measure(0));
		const e6quiet = await page.evaluate(() => window.__s.info().e6);
		const loud = await page.evaluate(() => window.__s.measure(0.95));
		const e6loud = await page.evaluate(() => window.__s.info().e6);
		out.numbers.bloom = {
			quietMean: quiet.mean,
			loudMean: loud.mean,
			quietStrength: e6quiet.bloomStrength,
			loudStrength: e6loud.bloomStrength
		};
		check(
			'bloom: stronger when the sound is louder',
			e6loud.bloomStrength > e6quiet.bloomStrength + 0.05 && e6loud.bloomActive,
			JSON.stringify(out.numbers.bloom)
		);
		check(
			'bloom: the picture is brighter with it',
			loud.mean > quiet.mean + 0.02,
			JSON.stringify(out.numbers.bloom)
		);
		// one NaN pixel in the half-float bloom target is spread over the whole frame by the blur: every frame must keep its picture
		const sweep = [];
		for (const e of [0, 0.2, 0.5, 0.8, 1, 0.3, 0.9, 0.1])
			sweep.push((await page.evaluate((e) => window.__s.measure(e), e)).mean);
		check(
			'bloom: no frame goes black (NaN guard of the shaders)',
			Math.min(...sweep) > Math.max(2, quiet.mean * 0.5),
			JSON.stringify(sweep.map((v) => +v.toFixed(1)))
		);
		await page.evaluate(() => window.__s.measure(0.95));
		await shotOf(page, 'c14-bloom');

		// ---- voice energy, signals and camera
		const first = await page.evaluate(async (id) => {
			const n = await window.__s.eng().notes(id);
			const v = 3;
			for (let k = 0; k < n.n; k++)
				if (n.voice[k] === v && n.t_on[k] > 40) return { t: n.t_on[k], v };
			return null;
		}, 'c14');
		if (first) {
			await at(page, 'c14', first.t + 0.05, { settle: 700 });
			await page.evaluate(() => window.__s.measure());
			const e = (await page.evaluate(() => window.__s.info())).e6.voiceEnergy;
			check('voice energy: the voice that began is up', e[first.v - 1] > 0.15, JSON.stringify(e));
		}
		const before = await at(page, 'c14', (await pieceAt(page, 'c14', 0)) - 0.4, {
			settle: 500,
			layer: false
		});
		await page.evaluate(() => window.__s.measure());
		const eIdle = (await page.evaluate(() => window.__s.info())).e6.voiceEnergy;
		check(
			'voice energy: zero before the piece',
			eIdle.every((v) => v === 0),
			JSON.stringify(eIdle)
		);
		void before;

		// signals follow the sound while playing and relax when paused
		await at(page, 'c05', await pieceAt(page, 'c05', 60), { settle: 600 });
		await page.evaluate(() => window.__s.eng().start());
		await sleep(3200);
		const sig = (await page.evaluate(() => window.__s.info())).e6.signals;
		check(
			'signals: energy and onsets follow the sound',
			sig.energy > 0.05 && sig.onsets >= 1,
			JSON.stringify(sig)
		);
		await page.evaluate(() => window.__s.pause());
		await sleep(3000);
		const sig2 = (await page.evaluate(() => window.__s.info())).e6.signals;
		check(
			'signals: relax to zero when paused',
			sig2.energy < 0.05 && sig2.pulse < 0.05,
			JSON.stringify(sig2)
		);

		// camera: drift differs with the playhead; shake only when loud
		await at(page, 'c05', await pieceAt(page, 'c05', 10), { settle: 400 });
		await page.evaluate(() => window.__s.measure());
		const d1 = (await page.evaluate(() => window.__s.info())).e6.drift;
		await at(page, 'c05', await pieceAt(page, 'c05', 70), { settle: 400 });
		await page.evaluate(() => window.__s.measure());
		const d2 = (await page.evaluate(() => window.__s.info())).e6.drift;
		check(
			'camera: drift moves with the playhead and stays small',
			Math.hypot(d1.x - d2.x, d1.y - d2.y) > 0.01 && Math.abs(d1.x) < 0.6 && Math.abs(d2.y) < 0.35,
			JSON.stringify([d1, d2])
		);
		const loudAt = await page.evaluate(
			async (start) => {
				for (let k = 0; k < 140; k++) {
					const t = start + k * 2.5;
					window.__s.seek(t);
					window.__s.measure();
					const e = window.__s.info().e6;
					if (e.loudness > 0.86) return { t, loudness: e.loudness, shake: e.shake };
				}
				return null;
			},
			await pieceAt(page, 'c05', 5)
		);
		check(
			'camera: shake on a loud passage',
			loudAt && Math.hypot(loudAt.shake.x, loudAt.shake.y) > 0.001,
			JSON.stringify(loudAt)
		);
		const quietAt = await page.evaluate(() => {
			window.__s.seek(window.__s.piece('c05').audio_start - 3);
			window.__s.measure();
			return window.__s.info().e6;
		});
		check(
			'camera: no shake when quiet',
			Math.hypot(quietAt.shake.x, quietAt.shake.y) === 0,
			JSON.stringify(quietAt.shake)
		);
		const again = await page.evaluate((t) => {
			window.__s.seek(t);
			window.__s.measure();
			const a = window.__s.info().e6.shake;
			window.__s.seek(t + 40);
			window.__s.measure();
			window.__s.seek(t);
			window.__s.measure();
			return [a, window.__s.info().e6.shake];
		}, loudAt?.t ?? 0);
		check(
			'camera: the shake is the same on seeking back to the same time',
			again[0].x === again[1].x && again[0].y === again[1].y,
			JSON.stringify(again)
		);

		// the ending fades the layer with everything else
		const plan = (await page.evaluate(() => window.__s.stage().fxInfo())).ending;
		await at(page, 'c14', (await pieceAt(page, 'c14', 0)) + 200, { settle: 300 });
		const plan14 = (await page.evaluate(() => window.__s.stage().fxInfo())).ending;
		if (plan14 && ambientOf('c14').opacity > 0) {
			await at(page, 'c14', plan14.blackAt + 0.4, { settle: 500 });
			const e = (await page.evaluate(() => window.__s.info())).e6;
			check(
				'ending: the layer is gone at the black',
				e.ambientOpacity === 0,
				JSON.stringify(e.ambientOpacity)
			);
		}
		void plan;
		await page.close();

		// ---- leaving and coming back: the layer's own GL context is released with the stage
		{
			const warnings = [];
			const lp = await open('scene=auto&p=v');
			lp.on('console', (m) => {
				if (m.type() === 'warning') warnings.push(m.text());
			});
			const ready = () =>
				waitFor(lp, () => (window.__s.layer()?.status === 'ready' ? 1 : 0), null, 20000);
			check('cycles: the layer comes up on the first visit', await ready());
			for (let k = 0; k < 8; k++) {
				await lp.click('#to-bench');
				await lp.waitForFunction(
					() => location.pathname.startsWith('/bench') && !!window.__bench?.engine,
					null,
					{
						timeout: 30000
					}
				);
				await lp.goBack(); // the link goes to a plain /stage; back keeps ?scene=auto
				await lp.waitForFunction(
					() => window.__stagePage?.stage && location.pathname.startsWith('/stage'),
					null,
					{
						timeout: 30000
					}
				);
				await lp.evaluate(HELPERS);
				await ready();
			}
			const live = await lp.evaluate(() => globalThis.__stageCounts);
			check('cycles: one stage alive after 8 round trips', live?.live === 1, JSON.stringify(live));
			check('cycles: the layer is back each time', !!(await ready()));
			check(
				'cycles: no "too many WebGL contexts" warning',
				!warnings.some((w) => /too many active webgl/i.test(w)),
				warnings.slice(0, 2).join(' | ')
			);
			await lp.close();
		}

		// ---- governor levels and reduced motion
		page = await open('scene=auto&q=2');
		i = await at(page, 'c05', t05, { settle: 1200, layer: true });
		await page.evaluate(() => window.__s.measure(0.95));
		let e6 = (await page.evaluate(() => window.__s.info())).e6;
		check(
			'governor level 2: no bloom, the layer still shows',
			e6.bloomStrength === 0 && e6.ambientOpacity > 0,
			JSON.stringify([e6.bloomStrength, e6.ambientOpacity])
		);
		await page.close();
		page = await open('scene=auto&q=4');
		await at(page, 'c05', t05, { settle: 1200 });
		e6 = (await page.evaluate(() => window.__s.info())).e6;
		check(
			'governor level 4: the layer is off',
			e6.ambientOpacity === 0,
			JSON.stringify(e6.ambientOpacity)
		);
		await page.close();
		page = await open('scene=auto&bloom=0');
		await at(page, 'c05', t05, { settle: 1000 });
		await page.evaluate(() => window.__s.measure(0.95));
		e6 = (await page.evaluate(() => window.__s.info())).e6;
		check(
			'?bloom=0: no bloom',
			e6.bloomStrength === 0 && !e6.bloomActive,
			JSON.stringify(e6.bloomStrength)
		);
		await page.close();
		page = await open('scene=auto&reduced');
		await at(page, 'c05', await pieceAt(page, 'c05', 70), { settle: 1000 });
		await page.evaluate(() => window.__s.measure(0.9));
		e6 = (await page.evaluate(() => window.__s.info())).e6;
		const l = await page.evaluate(() => window.__s.layer());
		check(
			'?reduced: no drift, no shake, no ambient layer',
			e6.reducedMotion &&
				e6.drift.x === 0 &&
				e6.shake.x === 0 &&
				e6.ambientOpacity === 0 &&
				l === null,
			JSON.stringify([e6.reducedMotion, e6.drift, e6.ambientOpacity])
		);
		await shotOf(page, 'reduced');
		await page.close();

		// ---- numbers for docs/ambient.md
		out.numbers.bundles = chunkSizes();
		if (BENCH) {
			const fps = async (query, seconds = 6) => {
				const p = await open(query);
				const t = await pieceAt(p, 'c05', 40);
				await p.evaluate(([t]) => (window.__s.seek(t), window.__s.play()), [t]);
				await sleep(2500);
				const r = await p.evaluate(
					(secs) =>
						new Promise((resolve) => {
							let n = 0;
							const t0 = performance.now();
							const tick = () => {
								n++;
								if (performance.now() - t0 >= secs * 1000)
									resolve({
										fps: n / ((performance.now() - t0) / 1000),
										frameMs: window.__s.stage().stats().cpuMsMean,
										ambientMs: window.__s.layer()?.info().lastMs ?? 0
									});
								else requestAnimationFrame(tick);
							};
							requestAnimationFrame(tick);
						}),
					seconds
				);
				await p.close();
				return r;
			};
			out.numbers.fps = {
				plain: await fps('scene=auto&ambient=0&bloom=0'),
				bloom: await fps('scene=auto&ambient=0'),
				ambient: await fps('scene=auto&bloom=0'),
				both: await fps('scene=auto')
			};
			// the other way to composite: copy butterchurn's canvas into a texture of the Three.js context every frame
			page = await open('scene=auto&bloom=0');
			await at(page, 'c05', t05, { settle: 800, layer: true });
			await page.evaluate(() => window.__s.play());
			await sleep(1000);
			out.numbers.textureCopy = await page.evaluate(() => {
				const src = window.__s.layer().canvas;
				const cv = document.createElement('canvas');
				cv.width = 1280;
				cv.height = 720;
				const gl = cv.getContext('webgl2');
				const tex = gl.createTexture();
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				const px = new Uint8Array(4);
				const times = [];
				for (let k = 0; k < 60; k++) {
					const t0 = performance.now();
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
					gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // force the copy to finish
					times.push(performance.now() - t0);
				}
				times.sort((a, b) => a - b);
				return { size: [src.width, src.height], medianMs: times[30], p95Ms: times[57] };
			});
			await page.close();
		}

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
const bad = results.filter((r) => !r.ok && !r.notes.some((n) => n.startsWith('could not launch')));
const launched = results.filter((r) => !r.notes.some((n) => n.startsWith('could not launch')));
process.exit(bad.length || launched.length === 0 ? 1 : 0);
