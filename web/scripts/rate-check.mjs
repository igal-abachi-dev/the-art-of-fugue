// Is the pitch preserved when the playback speed changes? (T3.1.3)
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm rate-check [--url http://localhost:4173] [--engines msedge,firefox]
//
// It plays the opening of Contrapunctus I through the page's own audio graph and reads the analyser:
//   - a pitch-class profile (12 bins, from the energy between 100 Hz and 2 kHz) and the spectral centroid,
//     at 1x, 0.5x and 1.5x. If the pitch is preserved, the profile at 0.5x and 1.5x lines up with the one at 1x
//     (best circular shift 0 semitones) and the centroid does not move by an octave or a fifth.
//   - a control: the same at 1.5x with `preservesPitch` switched off. That must come out about 7 semitones
//     sharp (log2(1.5) * 12 = 7.02). If it did not, this check could not see a pitch shift at all and would say nothing.
// It measures the sound the browser produces, not whether it sounds good. Exits non-zero on a failed check.

import { chromium, firefox, webkit } from 'playwright';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => {
		if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
		return acc;
	}, [])
);
const URL_BASE = args.url ?? 'http://localhost:4173';
const ENGINES = (args.engines ?? 'msedge,firefox').split(',');
const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	firefox: () => firefox.launch(),
	webkit: () => webkit.launch()
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** in the page: listen for `ms` and return {chroma[12], centroid} */
const LISTEN = async (ms) => {
	const an = window.__bench.engine.graph.analyser;
	an.fftSize = 16384;
	an.smoothingTimeConstant = 0;
	const buf = new Float32Array(an.frequencyBinCount);
	const sr = an.context.sampleRate;
	const chroma = new Float64Array(12);
	let num = 0;
	let den = 0;
	const end = performance.now() + ms;
	while (performance.now() < end) {
		an.getFloatFrequencyData(buf);
		for (let k = 1; k < buf.length; k++) {
			const f = (k * sr) / an.fftSize;
			if (f < 100 || f > 4000) continue;
			const p = Math.pow(10, buf[k] / 10);
			if (f <= 2000) {
				const pc = (((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12;
				chroma[pc] += p;
			}
			num += f * p;
			den += p;
		}
		await new Promise((r) => setTimeout(r, 80));
	}
	const tot = chroma.reduce((a, b) => a + b, 0) || 1;
	return { chroma: [...chroma].map((x) => x / tot), centroid: den ? num / den : 0 };
};

const corr = (a, b, shift) => {
	// correlation of a with b rotated by `shift` bins
	const n = a.length;
	const ma = a.reduce((x, y) => x + y, 0) / n;
	const mb = b.reduce((x, y) => x + y, 0) / n;
	let s = 0;
	let sa = 0;
	let sb = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i] - ma;
		const y = b[(i - shift + n * 2) % n] - mb;
		s += x * y;
		sa += x * x;
		sb += y * y;
	}
	return s / Math.sqrt(sa * sb || 1);
};
const bestShift = (ref, x) => {
	let best = 0;
	let bc = -2;
	for (let s = 0; s < 12; s++) {
		const c = corr(ref, x, s);
		if (c > bc) {
			bc = c;
			best = s;
		}
	}
	return {
		shift: best > 6 ? best - 12 : best,
		corr: +bc.toFixed(3),
		corrAtZero: +corr(ref, x, 0).toFixed(3)
	};
};

async function run(name) {
	const out = { engine: name, ok: false, notes: [] };
	let browser;
	try {
		browser = await launchers[name]();
	} catch (e) {
		out.notes.push(`could not launch: ${String(e.message).split('\n')[0]}`);
		return out;
	}
	try {
		const page = await (await browser.newContext()).newPage();
		await page.goto(`${URL_BASE}/bench?p=i&bar=1`, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__bench, null, { timeout: 30000 });
		await page.click('#start');
		await page.waitForFunction(() => window.__bench.engine.status === 'playing', null, {
			timeout: 60000
		});
		const measure = async (rate, preserve = true) => {
			await page.evaluate(
				([r, p]) => {
					const e = window.__bench.engine;
					e.seekPlace({ piece: e.manifest.pieces.find((x) => x.id === 'c01'), bar: 1 });
					e.setRate(r);
					const el = document.querySelector('audio');
					el.preservesPitch = p;
					el.mozPreservesPitch = p;
					el.webkitPreservesPitch = p;
					return e.play();
				},
				[rate, preserve]
			);
			await page.waitForFunction(() => window.__bench.engine.status === 'playing', null, {
				timeout: 30000
			});
			await sleep(1500);
			// the same 8 s of music at every speed, so the profiles compare the same notes
			return page.evaluate(LISTEN, 8000 / rate);
		};
		const base = await measure(1);
		const rows = [];
		for (const rate of [0.5, 1.5]) {
			const m = await measure(rate);
			rows.push({
				rate,
				preserved: true,
				...bestShift(base.chroma, m.chroma),
				centroidRatio: +(m.centroid / base.centroid).toFixed(2)
			});
		}
		const control = await measure(1.5, false);
		const c = {
			rate: 1.5,
			preserved: false,
			...bestShift(base.chroma, control.chroma),
			centroidRatio: +(control.centroid / base.centroid).toFixed(2)
		};
		out.rows = rows;
		out.control = c;
		await page.evaluate(() => window.__bench.engine.element.pause());
		const preservedOk = rows.every(
			(r) => r.shift === 0 && r.corrAtZero > 0.6 && r.centroidRatio > 0.75 && r.centroidRatio < 1.33
		);
		const controlSeesShift =
			Math.abs(c.shift) >= 5 && Math.abs(c.shift) <= 9 && c.centroidRatio > 1.25;
		out.preservedOk = preservedOk;
		out.controlSeesShift = controlSeesShift;
		out.ok = preservedOk && controlSeesShift;
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
