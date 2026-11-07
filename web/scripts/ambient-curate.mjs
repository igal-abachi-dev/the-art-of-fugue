// Curation tool for the ambient MilkDrop layer (T6.1.2): renders butterchurn presets with the real recording's audio and
// measures how loud they look, so the restrained ones can be picked by evidence and then by eye.
//
//   node scripts/ambient-curate.mjs stats  [--out stats.jsonl] [--offset 0] [--limit 100] [--names a.json,b.json] [--piece c08 --at 60]
//   node scripts/ambient-curate.mjs stills --names "<file>,<file>" [--out sheet.png] [--piece c08 --at 60]
//
// `stats`  one line of JSON per preset: mean luminance, share of bright pixels, edge energy (busyness) and the flash rate
//          (frames per second whose mean luminance jumps by more than FLASH_STEP), over 4 s of audio. It appends to `--out`
//          and skips presets already in it, so a long run can be stopped and resumed.
// `stills` renders each named preset for 3 s and writes a contact sheet (PNG) with the names under the pictures.
//
// The presets come from node_modules/butterchurn-presets/presets/converted (1754 JSON files). The audio is read straight
// from the WAV in ../data/raw: the same 1024 time-domain bytes per frame that the stage's analyser would give.

import { readFileSync, readdirSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const mode = argv[0];
const args = Object.fromEntries(
	argv.slice(1).reduce((acc, a, i, all) => {
		if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
		return acc;
	}, [])
);
const PRESETS = resolve('node_modules/butterchurn-presets/presets/converted');
const BUTTERCHURN = resolve('node_modules/butterchurn/lib/butterchurn.min.js');
const RAW = resolve('../data/raw');
const MANIFEST = JSON.parse(readFileSync(resolve('static/data/manifest.json'), 'utf8'));
const W = 320;
const H = 180;
const FPS = 30;
const FLASH_STEP = 0.1;

/** the mono samples of the recording from `start` for `seconds` (plus 1024 samples of lead), as floats -1..1 */
function excerpt(start, seconds) {
	const file = readdirSync(RAW).find((f) => f.endsWith('.wav'));
	const buf = readFileSync(join(RAW, file));
	let p = 12;
	let data = -1;
	let fmt = null;
	while (p < buf.length - 8) {
		const id = buf.toString('ascii', p, p + 4);
		const size = buf.readUInt32LE(p + 4);
		if (id === 'fmt ')
			fmt = {
				ch: buf.readUInt16LE(p + 10),
				rate: buf.readUInt32LE(p + 12),
				bits: buf.readUInt16LE(p + 22)
			};
		if (id === 'data') {
			data = p + 8;
			break;
		}
		p += 8 + size + (size & 1);
	}
	if (data < 0 || !fmt || fmt.bits !== 16) throw new Error('expected a 16-bit PCM WAV');
	const from = Math.floor(start * fmt.rate) - 1024;
	const n = Math.floor(seconds * fmt.rate) + 1024;
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let s = 0;
		for (let c = 0; c < fmt.ch; c++)
			s += buf.readInt16LE(data + ((from + i) * fmt.ch + c) * 2) / 32768;
		out[i] = s / fmt.ch;
	}
	return { samples: out, rate: fmt.rate };
}

/** `frames` x 1024 bytes as getByteTimeDomainData would give, one frame per 1/FPS second */
function frames(start, seconds) {
	const { samples, rate } = excerpt(start, seconds);
	const count = Math.floor(seconds * FPS);
	const out = [];
	for (let f = 0; f < count; f++) {
		const end = 1024 + Math.floor((f / FPS) * rate);
		const fr = new Array(1024);
		for (let i = 0; i < 1024; i++) {
			const x = samples[end - 1024 + i];
			fr[i] = Math.max(0, Math.min(255, Math.round(128 * (1 + x))));
		}
		out.push(fr);
	}
	return out;
}

const piece = MANIFEST.pieces.find((p) => p.id === (args.piece ?? 'c08'));
const START = piece.audio_start + Number(args.at ?? 60);

// ---- page side
const PAGE = {
	/** render `frames` with the preset and return the statistics */
	async stats(preset, fr) {
		const viz = window.__viz;
		viz.loadPreset(preset, 0);
		const gl = window.__canvas.getContext('webgl2');
		const buf = new Uint8Array(W * H * 4);
		const lum = [];
		let bright = 0;
		let edge = 0;
		let counted = 0;
		for (let f = 0; f < fr.length; f++) {
			const bytes = Uint8Array.from(fr[f]);
			viz.render({
				audioLevels: { timeByteArray: bytes, timeByteArrayL: bytes, timeByteArrayR: bytes },
				elapsedTime: 1 / FPS
			});
			gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
			let sum = 0;
			let br = 0;
			let ed = 0;
			let prev = 0;
			for (let i = 0; i < W * H; i++) {
				const l = (0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]) / 255;
				sum += l;
				if (l > 0.6) br++;
				if (i % W) ed += Math.abs(l - prev);
				prev = l;
			}
			lum.push(sum / (W * H));
			if (f >= FPS) {
				// the first second is the preset settling
				bright += br / (W * H);
				edge += ed / (W * H);
				counted++;
			}
		}
		let flashes = 0;
		for (let f = FPS + 1; f < lum.length; f++)
			if (Math.abs(lum[f] - lum[f - 1]) > FLASH_STEP) flashes++;
		const settled = lum.slice(FPS);
		return {
			meanLum: settled.reduce((a, b) => a + b, 0) / settled.length,
			maxLum: Math.max(...settled),
			brightFrac: bright / counted,
			edge: edge / counted,
			flashesPerSec: flashes / ((lum.length - FPS) / FPS)
		};
	},
	/** render and return a still of the last frame as a PNG data URL */
	async still(preset, fr) {
		const viz = window.__viz;
		viz.loadPreset(preset, 0);
		for (let f = 0; f < fr.length; f++) {
			const bytes = Uint8Array.from(fr[f]);
			viz.render({
				audioLevels: { timeByteArray: bytes, timeByteArrayL: bytes, timeByteArrayR: bytes },
				elapsedTime: 1 / FPS
			});
			if (f === fr.length - 1) return window.__canvas.toDataURL('image/png');
		}
		return null;
	}
};

async function open() {
	const browser = await chromium.launch({
		channel: 'msedge',
		args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader']
	});
	const page = await browser.newPage({ viewport: { width: W, height: H } });
	page.on('pageerror', (e) => console.error('PAGEERR', e.message));
	await page.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`);
	await page.addScriptTag({ path: BUTTERCHURN });
	await page.evaluate(
		({ W, H, FPS, FLASH_STEP, src }) => {
			window.FPS = FPS;
			window.FLASH_STEP = FLASH_STEP;
			window.W = W;
			window.H = H;
			const bc = window.butterchurn.default ?? window.butterchurn;
			const canvas = document.getElementById('c');
			window.__canvas = canvas;
			window.__viz = bc.createVisualizer(new AudioContext(), canvas, {
				width: W,
				height: H,
				pixelRatio: 1,
				textureRatio: 1
			});
			window.__viz.setRendererSize(W, H);
			// the page-side helpers, rebuilt from their source text
			for (const [name, code] of Object.entries(src))
				window[`__${name}`] = new Function(`return (${code})`)();
		},
		{
			W,
			H,
			FPS,
			FLASH_STEP,
			src: Object.fromEntries(
				Object.entries(PAGE).map(([k, v]) => [
					`run_${k}`,
					v
						.toString()
						.replace(/^async\s+/, 'async function ')
						.replace(/^(\w+)\(/, 'function $1(')
				])
			)
		}
	);
	return { browser, page };
}

const names = args.names
	? args.names.split(',').map((n) => (n.endsWith('.json') ? n : `${n}.json`))
	: readdirSync(PRESETS)
			.filter((f) => f.endsWith('.json'))
			.sort();

if (mode === 'stats') {
	const out = resolve(args.out ?? 'ambient-stats.jsonl');
	const done = new Set(
		existsSync(out)
			? readFileSync(out, 'utf8')
					.split('\n')
					.filter(Boolean)
					.map((l) => JSON.parse(l).file)
			: []
	);
	const todo = names
		.slice(Number(args.offset ?? 0), Number(args.offset ?? 0) + Number(args.limit ?? 1e9))
		.filter((n) => !done.has(n));
	const fr = frames(START, Number(args.seconds ?? 4));
	const { browser, page } = await open();
	let k = 0;
	for (const file of todo) {
		const preset = JSON.parse(readFileSync(join(PRESETS, file), 'utf8'));
		const t0 = Date.now();
		let rec;
		try {
			const s = await page.evaluate(([p, f]) => window.__run_stats(p, f), [preset, fr]);
			rec = { file, ...s, ms: Date.now() - t0 };
		} catch (e) {
			rec = { file, error: String(e.message).split('\n')[0], ms: Date.now() - t0 };
		}
		appendFileSync(out, JSON.stringify(rec) + '\n');
		if (++k % 10 === 0) console.log(`${k}/${todo.length}  last ${file}  ${rec.ms} ms`);
	}
	await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
	process.exit(0);
} else if (mode === 'stills') {
	const fr = frames(START, 3);
	const { browser, page } = await open();
	const shots = [];
	for (const file of names) {
		const preset = JSON.parse(readFileSync(join(PRESETS, file), 'utf8'));
		try {
			shots.push({
				file,
				url: await page.evaluate(([p, f]) => window.__run_still(p, f), [preset, fr])
			});
		} catch (e) {
			shots.push({ file, url: null, error: String(e.message).split('\n')[0] });
		}
	}
	// a contact sheet: a grid of the stills, names underneath
	const cols = Number(args.cols ?? 4);
	const sheet = await browser.newPage({ viewport: { width: cols * (W + 12) + 12, height: 800 } });
	const html = `<body style="margin:0;background:#222;color:#ddd;font:11px sans-serif"><div style="display:grid;grid-template-columns:repeat(${cols},${W}px);gap:12px;padding:12px">${shots
		.map(
			(s) =>
				`<figure style="margin:0"><img src="${s.url ?? ''}" width="${W}" height="${H}" style="display:block;background:#000"><figcaption>${s.file
					.replace(/\.json$/, '')
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')}${s.error ? ' — ' + s.error : ''}</figcaption></figure>`
		)
		.join('')}</div></body>`;
	await sheet.setContent(html);
	await sheet.waitForTimeout(500);
	const out = resolve(args.out ?? 'ambient-sheet.png');
	await sheet.screenshot({ path: out, fullPage: true });
	writeFileSync(
		out.replace(/\.png$/, '.txt'),
		shots.map((s, i) => `${i + 1}\t${s.file}`).join('\n')
	);
	console.log('wrote', out);
	await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
	process.exit(0);
} else {
	console.error('usage: ambient-curate.mjs stats|stills ...');
	process.exit(2);
}
