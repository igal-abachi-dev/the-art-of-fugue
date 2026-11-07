// Second notation source (T4.4.1): engrave the MXL with Verovio, one SVG per piece, systems cropped out of it.
//
//   python -m artfugue.notation_mxl         (cuts the MXL into data/work/notation/<id>.musicxml, with the PDF corrections)
//   node scripts/notation-verovio.mjs       (this file: Verovio -> data/work/notation/<id>.verovio.json + <id>.svg)
//   python -m artfugue.notation_verovio     (matches the noteheads to the shipped notes -> web/static/data/notation-verovio)
//
// The PDF engraving is the primary source (`python -m artfugue.notation`); this one exists for flexibility: it
// reflows to any width, every notehead is a real element that can be restyled, and it needs no PDF.
// Verovio is LGPL-3.0 and runs here at build time only: nothing of it ships to the browser.
//
// Verovio lays the whole piece out with automatic line breaks on one tall page; each system is a rectangle of it.
// (An earlier version engraved bar ranges one by one with `select()`: that loses the second staff's setup.)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const WORK = resolve('..', 'data', 'work', 'notation');
const OUT = resolve(WORK, 'verovio');
mkdirSync(OUT, { recursive: true });
const PPQ = 24;
const UNIT = 180; // one staff space in Verovio's drawing units at this scale
const PAD_ABOVE = 5 * UNIT; // room for ledger lines, beams and the bar number
const PAD_BELOW = 3.5 * UNIT;

const M = await createVerovioModule();
const tk = new VerovioToolkit(M);
tk.setOptions({
	breaks: 'auto',
	pageWidth: 2400,
	pageHeight: 60000,
	scale: 40,
	adjustPageHeight: true,
	header: 'none',
	footer: 'none',
	pageMarginLeft: 30,
	pageMarginRight: 30,
	pageMarginTop: 40,
	pageMarginBottom: 40,
	xmlIdSeed: 1,
	svgViewBox: true,
	svgFormatRaw: true,
	svgRemoveXlink: true
});

const only = process.argv.slice(2);
const files = readdirSync(WORK)
	.filter((f) => f.endsWith('.musicxml'))
	.filter((f) => only.length === 0 || only.includes(f.replace('.musicxml', '')));
const report = [];
for (const file of files) {
	const id = file.replace('.musicxml', '');
	const xml = readFileSync(resolve(WORK, file), 'utf8');
	const barNumbers = [...xml.matchAll(/<measure number="(\d+)"/g)].map((m) => Number(m[1]));
	tk.loadData(xml);
	if (tk.getPageCount() !== 1) console.error(`${id}: ${tk.getPageCount()} pages (expected 1)`);
	// onset (in ticks) of every note element that starts a sound
	const onset = new Map();
	for (const e of tk.renderToTimemap({ includeRests: false })) {
		for (const nid of e.on ?? []) onset.set(nid, Math.round(e.qstamp * PPQ));
	}
	const svg = tk.renderToSVG(1);
	writeFileSync(resolve(OUT, `${id}.svg`), svg);

	// the drawing lives in an inner coordinate system, inside a margin group
	const vb = svg.match(/class="definition-scale"[^>]*viewBox="0 0 (\d+) (\d+)"/);
	const mg = svg.match(/class="page-margin" transform="translate\((\d+), (\d+)\)"/);
	const [W, H] = [Number(vb[1]), Number(vb[2])];
	const [mx, my] = [Number(mg[1]), Number(mg[2])];

	// one block of markup per system
	const starts = [...svg.matchAll(/<g id="[^"]+" class="system"/g)].map((m) => m.index);
	const systems = [];
	let measureIndex = 0;
	starts.forEach((a, k) => {
		const block = svg.slice(a, k + 1 < starts.length ? starts[k + 1] : svg.length);
		// staff lines: long horizontal strokes (ledger lines are short)
		let ymin = Infinity;
		let ymax = -Infinity;
		for (const m of block.matchAll(/<path d="M(\d+) (\d+) L(\d+) (\d+)"/g)) {
			if (m[2] === m[4] && Number(m[3]) - Number(m[1]) > 500) {
				ymin = Math.min(ymin, Number(m[2]));
				ymax = Math.max(ymax, Number(m[2]));
			}
		}
		// bars: the first staff line of each measure gives its x range
		const bars = [];
		for (const m of block.matchAll(/class="measure">[\s\S]*?<path d="M(\d+) \d+ L(\d+) \d+"/g)) {
			bars.push({ n: barNumbers[measureIndex++], x0: Number(m[1]) + mx, x1: Number(m[2]) + mx });
		}
		const heads = [];
		for (const m of block.matchAll(
			/<g id="([^"]+)" class="note">(?:<g[^>]*class="notehead">)<use[^>]*transform="translate\(([\d.]+), ([\d.]+)\)/g
		)) {
			const midi = tk.getMIDIValuesForElement(m[1]);
			heads.push({
				id: m[1],
				x: Number(m[2]) + mx,
				y: Number(m[3]) + my,
				pitch: midi.pitch,
				on: onset.has(m[1]) ? onset.get(m[1]) : null
			});
		}
		const top = Math.max(0, ymin + my - PAD_ABOVE);
		const bottom = Math.min(H, ymax + my + PAD_BELOW);
		systems.push({ crop: [0, top, W, bottom - top], bars, heads });
	});
	writeFileSync(
		resolve(WORK, `${id}.verovio.json`),
		JSON.stringify({ piece: id, svg: `${id}.svg`, size: [W, H], systems })
	);
	const nh = systems.reduce((s, x) => s + x.heads.length, 0);
	const nb = systems.reduce((s, x) => s + x.bars.length, 0);
	report.push({ id, bars: barNumbers.length, barsFound: nb, systems: systems.length, heads: nh });
	console.error(
		`${id}: ${barNumbers.length} bars (${nb} found), ${systems.length} systems, ${nh} noteheads`
	);
}
console.log(JSON.stringify(report));
