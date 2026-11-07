// Real-browser check of the Three.js stage (E4: T4.1.1 to T4.3.2).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm visual-check [--url http://localhost:4173] [--engines msedge,firefox] [--shots ../docs/img] [--cycles 20]
//
// For each engine it opens /stage on the densest stretch of Contrapunctus XI and measures:
//   - which GL renderer the browser used (a software renderer makes the frame times meaningless for a GPU);
//   - frame gaps over 8 s of playback, and the JavaScript time per frame (stage.stats());
//   - that every visible note is resident in the instance buffer after 60 random seeks, and that a seek
//     away and back draws the identical picture (no stale or missing notes);
//   - frame gaps while the scene crossfades four times, and that no shader program or geometry is created;
//   - that the governor lowers the quality under slow frames and restores it, and what it changes;
//   - that a lost WebGL context is survived and the picture comes back;
//   - that going from the stage page to another page and back 20 times (client-side) leaves nothing behind:
//     no live stage, no growth in geometries, DOM nodes, listeners or (Chromium) heap.
// It writes screenshots and prints JSON plus a Markdown row. Playwright's builds, not retail browsers; and a
// headless machine shows what the code does, not what a person sees on their own screen.

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
const CYCLES = Number(args.cycles ?? 20);
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

/** installed in the page: the helpers the checks call */
const PAGE_HELPERS = () => {
	const w = window;
	w.__v = {
		eng: () => w.__stagePage.session.engine,
		stage: () => w.__stagePage.stage,
		/** frame gaps (ms) of the page's own rAF over `ms` milliseconds */
		gaps: (ms) =>
			new Promise((resolve) => {
				const out = [];
				let last = performance.now();
				const end = last + ms;
				const tick = (now) => {
					out.push(now - last);
					last = now;
					if (now < end) requestAnimationFrame(tick);
					else resolve(out);
				};
				requestAnimationFrame(tick);
			}),
		summary: (g) => {
			const s = [...g].sort((a, b) => a - b);
			const med = s[Math.floor(s.length / 2)];
			return {
				frames: g.length,
				median: +med.toFixed(2),
				p95: +s[Math.floor(s.length * 0.95)].toFixed(2),
				max: +s[s.length - 1].toFixed(2),
				late: g.filter((x) => x > med * 1.5 + 1).length // frames more than 1.5 intervals long
			};
		},
		/** render once at time t and read the picture back in the same task (the drawing buffer is not kept) */
		snap: (t) => {
			const st = w.__v.stage();
			const eng = w.__v.eng();
			const piece = eng.piece;
			st.render({ t, dt: 0, discontinuity: false }, piece ? eng.window(piece.id) : null);
			const c = st.canvas;
			const tmp = document.createElement('canvas');
			tmp.width = c.width;
			tmp.height = c.height;
			const g = tmp.getContext('2d');
			g.drawImage(c, 0, 0);
			const d = g.getImageData(0, 0, c.width, c.height).data;
			let h = 2166136261;
			let lit = 0;
			for (let i = 0; i < d.length; i += 4) {
				h = Math.imul(h ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 16777619);
				if (d[i] + d[i + 1] + d[i + 2] > 150) lit++;
			}
			// the picture at 160 x 90 (mean of 8 x 8 blocks, as brightness), for comparing two pictures with a tolerance
			const bw = Math.floor(c.width / 8);
			const bh = Math.floor(c.height / 8);
			const small = new Array(bw * bh);
			for (let by = 0; by < bh; by++)
				for (let bx = 0; bx < bw; bx++) {
					let sum = 0;
					for (let y = 0; y < 8; y++)
						for (let x = 0; x < 8; x++) {
							const i = ((by * 8 + y) * c.width + bx * 8 + x) * 4;
							sum += d[i] + d[i + 1] + d[i + 2];
						}
					small[by * bw + bx] = Math.round(sum / 192);
				}
			return { hash: h >>> 0, lit, small };
		}
	};
};

async function run(engineName) {
	const out = { engine: engineName, ok: false, notes: [] };
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
		const warnings = [];
		page.on('pageerror', (e) => errors.push(String(e.message)));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
			if (m.type() === 'warning') warnings.push(m.text());
		});
		page.on('response', (r) => {
			if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(URL_BASE, '')}`);
		});
		const cdp =
			engineName === 'msedge' || engineName === 'chromium'
				? await context.newCDPSession(page)
				: null;

		step('open the stage page');
		await page.goto(`${URL_BASE}/stage?hud&bloom=0&p=xi&bar=60`, { waitUntil: 'load' });
		await page.waitForSelector('#start', { timeout: 30000 });
		await page.evaluate(PAGE_HELPERS);
		await page.waitForFunction(() => window.__stagePage?.stage, null, { timeout: 30000 });

		out.gl = await page.evaluate(() => {
			const gl = document.createElement('canvas').getContext('webgl2');
			if (!gl) return { webgl2: false };
			const ext = gl.getExtension('WEBGL_debug_renderer_info');
			return {
				webgl2: true,
				renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
			};
		});

		await page.click('#start');
		await sleep(1500);

		// ---- the densest stretch of XI: most notes starting inside one 6.5 s window
		const dense = await page.evaluate(async () => {
			const eng = window.__v.eng();
			const piece = eng.manifest.pieces.find((p) => p.id === 'c11');
			const cols = await eng.notes('c11');
			let best = 0;
			let at = piece.audio_start;
			for (let t = piece.audio_start; t < piece.audio_end - 7; t += 0.5) {
				let n = 0;
				for (let i = 0; i < cols.n; i++) if (cols.t_on[i] >= t && cols.t_on[i] < t + 6.5) n++;
				if (n > best) {
					best = n;
					at = t;
				}
			}
			eng.seek(at);
			return { notesInWindow: best, startsAt: +(at - piece.audio_start).toFixed(1) };
		});
		out.dense = dense;
		await sleep(1200);

		step('8 s of playback');
		const steady = await page.evaluate(async () => window.__v.summary(await window.__v.gaps(8000)));
		out.steady = steady;
		out.stats = await page.evaluate(() => window.__v.stage().stats());
		await page.screenshot({ path: `${SHOTS}/stage-dense-${engineName}.png` });

		// ---- crossfades while playing
		step('scene crossfades');
		const before = await page.evaluate(() => {
			const s = window.__v.stage().stats();
			return { geometries: s.geometries, programs: s.programs };
		});
		const fades = [];
		for (const name of ['lanes', 'ember', 'void', 'lanes']) {
			await page.evaluate((n) => window.__stagePage.setScene(n), name);
			const gaps = await page.evaluate(async () => window.__v.summary(await window.__v.gaps(1400)));
			fades.push({ to: name, ...gaps });
			if (name === 'lanes' && !out.shotLanes) {
				await sleep(200);
				await page.screenshot({ path: `${SHOTS}/stage-lanes-${engineName}.png` });
				out.shotLanes = true;
			}
		}
		await page.evaluate(() => window.__stagePage.setScene('ember'));
		await sleep(1500);
		await page.screenshot({ path: `${SHOTS}/stage-ember-${engineName}.png` });
		const after = await page.evaluate(() => {
			const s = window.__v.stage().stats();
			return { geometries: s.geometries, programs: s.programs };
		});
		out.crossfade = {
			runs: fades,
			maxGap: Math.max(...fades.map((f) => f.max)),
			lateFrames: fades.reduce((a, f) => a + f.late, 0),
			steadyLateRatePer1400ms: +((steady.late / 8000) * 1400).toFixed(2),
			programsBefore: before.programs,
			programsAfter: after.programs,
			geometriesBefore: before.geometries,
			geometriesAfter: after.geometries
		};

		// ---- pop detection: while paused, only the scene changes. Read the picture after every render (same task,
		// the drawing buffer is not kept) at 160x90 and look for a frame-to-frame jump out of line with its
		// neighbours. A smooth fade has one bell-shaped series of differences; a pop is a spike in it.
		step('crossfade pop');
		await page.evaluate(() => window.__v.eng().element.pause());
		await sleep(400);
		const pops = [];
		for (const name of ['void', 'lanes', 'ember', 'void', 'plain', 'void']) {
			const r = await page.evaluate(async (to) => {
				const st = window.__v.stage();
				const orig = st.render;
				const tmp = document.createElement('canvas');
				tmp.width = 160;
				tmp.height = 90;
				const g = tmp.getContext('2d', { willReadFrequently: true });
				const frames = [];
				st.render = function (f, w) {
					orig.call(this, f, w);
					g.drawImage(this.canvas, 0, 0, 160, 90);
					frames.push({ px: g.getImageData(0, 0, 160, 90).data.slice(), dt: f.dt });
				};
				window.__stagePage.setScene(to);
				await new Promise((res) => setTimeout(res, 1500));
				st.render = orig;
				const d = [];
				for (let k = 1; k < frames.length; k++) {
					let sum = 0;
					const a = frames[k - 1].px;
					const b = frames[k].px;
					for (let i = 0; i < a.length; i += 4)
						sum +=
							Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
					// per 1/60 s: a late frame (browser pacing) has a bigger step for the same speed of change
					const dt = Math.max(frames[k].dt, 0.004);
					d.push(((sum / (a.length / 4) / 3) * (1 / 60)) / dt);
				}
				return d;
			}, name);
			const peak = Math.max(...r);
			// A spike: one step far above the median of the six steps around it. Steps below 1.0 (of 255) are the 8-bit
			// quantisation of a slow colour change (every background pixel moves one level at once): not looked at.
			let spike = 1;
			for (let k = 3; k < r.length - 3; k++) {
				if (r[k] <= 1) continue;
				const around = [r[k - 3], r[k - 2], r[k - 1], r[k + 1], r[k + 2], r[k + 3]].sort(
					(x, y) => x - y
				);
				const med = (around[2] + around[3]) / 2;
				spike = Math.max(spike, r[k] / Math.max(med, 0.5));
			}
			pops.push({
				to: name,
				frames: r.length + 1,
				peakStep: +peak.toFixed(2),
				spike: +spike.toFixed(2),
				steps: r.map((x) => +x.toFixed(2))
			});
		}
		out.pop = { runs: pops, maxSpike: Math.max(...pops.map((p) => p.spike)) };
		await page.evaluate(() => window.__v.eng().element.play?.());

		// ---- seeks: residency and identical pictures. Plain scene so the picture depends on notes only.
		step('seeks');
		await page.evaluate(() => window.__stagePage.setScene('plain'));
		await sleep(1400);
		await page.evaluate(() => window.__v.eng().pause());
		await sleep(300);
		out.seek = await page.evaluate(async () => {
			const eng = window.__v.eng();
			const st = window.__v.stage();
			const piece = eng.manifest.pieces.find((p) => p.id === 'c11');
			const cols = await eng.notes('c11');
			let rnd = 12345;
			const rand = () => (rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 2 ** 32;
			const { ahead, behind } = st.state;
			const keep = Math.max(behind, 1.1);
			let missing = 0;
			let wrong = 0;
			let checked = 0;
			const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			for (let k = 0; k < 60; k++) {
				const t = piece.audio_start + rand() * (piece.audio_end - piece.audio_start);
				eng.seek(t);
				await wait();
				const now = eng.clock.now();
				window.__v.snap(now);
				const data = st.noteBuffer.data;
				const cap = st.noteBuffer.capacity;
				for (let i = 0; i < cols.n; i++) {
					if (!(cols.t_on[i] <= now + ahead && cols.t_off[i] > now - keep)) continue;
					checked++;
					const o = (i % cap) * 16; // NOTE_STRIDE
					if (data[o + 1] !== cols.t_on[i] || data[o + 2] !== cols.t_off[i]) missing++;
					else if (data[o + 6] !== cols.pitch[i] || data[o + 3] !== cols.voice[i]) wrong++;
				}
			}
			// the same place before and after going elsewhere gives the same picture
			const a = piece.audio_start + 100;
			const b = piece.audio_start + 250;
			eng.seek(a);
			await wait();
			const first = window.__v.snap(eng.clock.now());
			eng.seek(b);
			await wait();
			const other = window.__v.snap(eng.clock.now());
			eng.seek(a);
			await wait();
			const again = window.__v.snap(eng.clock.now());
			return {
				visibleNotesChecked: checked,
				missing,
				wrong,
				// the trails' alpha blending leaves a few pixels at plus or minus 1 to 3 levels apart between two renders of the
				// same frame (a few dozen of 920,000; found with the keyboard rework), so "the same picture" means: no block
				// of 8 x 8 differs by more than 2 levels of 255
				samePictureAfterReturn: first.small.every((v, i) => Math.abs(v - again.small[i]) <= 2),
				differentElsewhere: first.small.some((v, i) => Math.abs(v - other.small[i]) > 8),
				exactHashSame: first.hash === again.hash,
				litFirst: first.lit,
				litOther: other.lit
			};
		});

		// ---- governor wiring: slow frames lower the quality, fast frames restore it
		step('governor');
		out.governor = await page.evaluate(() => {
			const st = window.__v.stage();
			const t = window.__v.eng().clock.now();
			const q0 = st.stats();
			const cap0 = st.pool.cap;
			for (let i = 0; i < 200; i++) st.render({ t, dt: 0.05, discontinuity: false }, null); // 10 s at 20 fps
			const low = st.stats();
			const capLow = st.pool.cap;
			for (let i = 0; i < 4000; i++) st.render({ t, dt: 1 / 60, discontinuity: false }, null); // 66 s at 60 fps
			const back = st.stats();
			return {
				start: { level: q0.level, dpr: q0.dpr, particleCap: cap0 },
				afterSlowFrames: { level: low.level, dpr: low.dpr, particleCap: capLow },
				afterFastFrames: { level: back.level, dpr: back.dpr, particleCap: st.pool.cap }
			};
		});
		await sleep(300);

		// ---- lost context
		step('context loss');
		out.contextLoss = await page.evaluate(async () => {
			const st = window.__v.stage();
			const eng = window.__v.eng();
			eng.seek(eng.manifest.pieces.find((p) => p.id === 'c11').audio_start + 100);
			await new Promise((r) => setTimeout(r, 200));
			const lit0 = window.__v.snap(eng.clock.now()).lit;
			const handle = st.loseContext();
			if (!handle) return { supported: false };
			await new Promise((r) => setTimeout(r, 400));
			const lostFlag = st.lost;
			handle.restore();
			await new Promise((r) => setTimeout(r, 1500));
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const lit1 = window.__v.snap(eng.clock.now()).lit;
			return {
				supported: true,
				flaggedLost: lostFlag,
				recovered: !st.lost,
				litBefore: lit0,
				litAfter: lit1
			};
		});

		// ---- going away and back, client side
		step(`leaving and returning ${CYCLES} times`);
		// Chromium only: a full heap snapshot after garbage collection. Counts of detached DOM nodes and of the
		// objects the app creates per page. (DOM counters and queryObjects also count garbage not yet swept, so
		// they overstate; a snapshot after GC shows what is really still referenced.)
		const heap = async () => {
			if (!cdp) return null;
			for (let i = 0; i < 4; i++) {
				await cdp.send('HeapProfiler.collectGarbage');
				await sleep(120);
			}
			let chunks = [];
			const onChunk = (e) => chunks.push(e.chunk);
			cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
			await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
			cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
			const snap = JSON.parse(chunks.join(''));
			chunks = [];
			const nf = snap.snapshot.meta.node_fields;
			const NF = nf.length;
			const iName = nf.indexOf('name');
			const iSelf = nf.indexOf('self_size');
			const count = {};
			let size = 0;
			let detached = 0;
			const watch = new Set([
				'WebGLRenderer',
				'AudioContext',
				'HTMLAudioElement',
				'HTMLCanvasElement',
				'WebGL2RenderingContext'
			]);
			for (let i = 0; i < snap.nodes.length / NF; i++) {
				size += snap.nodes[i * NF + iSelf];
				const nm = snap.strings[snap.nodes[i * NF + iName]];
				if (nm.startsWith('Detached ')) detached++;
				if (watch.has(nm)) count[nm] = (count[nm] ?? 0) + 1;
			}
			return { heapMB: +(size / 1048576).toFixed(2), detachedDomNodes: detached, objects: count };
		};
		const stageUp = () => window.__stagePage?.stage && location.pathname.startsWith('/stage');
		const benchUp = () =>
			window.__bench?.engine &&
			document.querySelector('#hud') &&
			location.pathname.startsWith('/bench');
		await page.goto(`${URL_BASE}/stage?bloom=0&p=i`, { waitUntil: 'load' });
		await page.waitForFunction(stageUp, null, { timeout: 30000 });
		const cycle = async () => {
			const until = async (fn, what) => {
				try {
					await page.waitForFunction(fn, null, { timeout: 30000 });
				} catch (cause) {
					const state = await page.evaluate(() => ({
						path: location.pathname,
						stagePage: !!window.__stagePage,
						stage: !!window.__stagePage?.stage,
						bench: !!window.__bench?.engine,
						counts: globalThis.__stageCounts,
						failure: document.querySelector('.err, .failure')?.textContent ?? null
					}));
					throw new Error(
						`waiting for ${what}: ${JSON.stringify(state)}; page errors: ${errors.slice(-3).join(' | ')}`,
						{ cause }
					);
				}
			};
			await page.click('#to-bench');
			await until(benchUp, 'the bench page');
			await sleep(150);
			await page.click('#to-stage');
			await until(stageUp, 'the stage page');
			await sleep(150);
		};
		for (let i = 0; i < 2; i++) await cycle(); // warm up
		await sleep(800); // lazily made GPU objects (the bloom's targets) exist before the first reading
		const h0 = await heap();
		const g0 = await page.evaluate(() => {
			const s = window.__stagePage.stage.stats();
			return { geometries: s.geometries, textures: s.textures, programs: s.programs };
		});
		for (let i = 0; i < CYCLES; i++) await cycle();
		const h1 = await heap();
		const counts = await page.evaluate(() => globalThis.__stageCounts ?? null);
		await sleep(800);
		const g1 = await page.evaluate(() => {
			const s = window.__stagePage.stage.stats();
			return { geometries: s.geometries, textures: s.textures, programs: s.programs };
		});
		out.leak = {
			cycles: CYCLES,
			stagesLiveAfter: counts?.live,
			stagesCreatedAfter: counts?.created,
			gpuResourcesBefore: g0,
			gpuResourcesAfter: g1,
			heapBefore: h0,
			heapAfter: h1,
			contextWarnings: warnings.filter((x) => /too many|context/i.test(x)).length
		};

		out.errors = errors;
		out.failedRequests = failed;
		const lowest = out.crossfade.maxGap;
		out.ok =
			errors.filter((e) => !/Failed to load resource/.test(e)).length === 0 &&
			out.seek.missing === 0 &&
			out.seek.wrong === 0 &&
			out.seek.samePictureAfterReturn &&
			out.contextLoss.recovered !== false &&
			out.leak.stagesLiveAfter === 1 &&
			(out.leak.heapAfter === null || out.leak.heapAfter.detachedDomNodes === 0) &&
			JSON.stringify(out.leak.gpuResourcesBefore) === JSON.stringify(out.leak.gpuResourcesAfter) &&
			out.crossfade.programsAfter === out.crossfade.programsBefore &&
			out.pop.maxSpike < 4 &&
			lowest < 100;
	} catch (e) {
		out.notes.push(
			`failed: ${String(e.stack ?? e)
				.split('\n')
				.slice(0, 4)
				.join(' | ')}`
		);
	}
	try {
		await Promise.race([browser.close(), sleep(3000)]);
	} catch {
		/* a hung close is not a result */
	}
	return out;
}

const results = [];
for (const e of ENGINES) {
	console.error(`== ${e}`);
	results.push(await run(e));
}
console.log(JSON.stringify(results, null, 2));

console.log(
	'\n| engine | GL renderer | gap median / p95 / max (ms) | late frames | JS ms/frame mean / p95 | crossfade max gap | pop: worst spike | seek: missing / wrong / same | governor level slow → fast | context loss | leak after N cycles: live stages / detached DOM / GL resources |'
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
	if (!r.steady) {
		console.log(`| ${r.engine} | ${r.notes.join('; ')} |`);
		continue;
	}
	console.log(
		`| ${r.engine} | ${r.gl?.renderer ?? '?'} | ${r.steady.median} / ${r.steady.p95} / ${r.steady.max} | ${r.steady.late} of ${r.steady.frames} | ${r.stats.cpuMsMean.toFixed(2)} / ${r.stats.cpuMsP95.toFixed(2)} | ${r.crossfade.maxGap} | ${r.pop.maxSpike} | ${r.seek.missing} / ${r.seek.wrong} / ${r.seek.samePictureAfterReturn} | ${r.governor.afterSlowFrames.level} → ${r.governor.afterFastFrames.level} | ${r.contextLoss.supported ? (r.contextLoss.recovered ? 'recovered' : 'NOT recovered') : 'no extension'} | ${r.leak.stagesLiveAfter} live / ${r.leak.heapAfter ? r.leak.heapAfter.detachedDomNodes : 'n/a'} / ${JSON.stringify(r.leak.gpuResourcesBefore) === JSON.stringify(r.leak.gpuResourcesAfter) ? 'unchanged' : 'CHANGED'} |`
	);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
