// Publish the curated MilkDrop presets (T6.1.2): copies the presets named in src/lib/ambient/curated.json out of the
// butterchurn-presets package into static/data/ambient/, one small JSON file each, so the page fetches only the ones its
// scenes use (the package itself is 1754 presets and several megabytes and is never bundled).
//
//   pnpm ambient-presets            copy the curated presets and write static/data/ambient/index.json
//
// curated.json:  { "presets": { "<id>": { "source": "<preset file name without .json>", "mood": "...", "why": "..." } } }
// The id is what scenes.json says (`ambient.preset`); the source is the preset's original name, which carries its author
// ("Geiss - ...", "martin - ..."), so the credit stays with the file (see docs/ambient.md and the credits page).

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CURATED = resolve('src/lib/ambient/curated.json');
const SOURCE = resolve('node_modules/butterchurn-presets/presets/converted');
const OUT = resolve('static/data/ambient');

const doc = JSON.parse(readFileSync(CURATED, 'utf8'));
const ids = Object.keys(doc.presets ?? {});
if (!ids.length) {
	console.error('curated.json has no presets');
	process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const index = [];
let problems = 0;
for (const id of ids) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
		console.error(`bad id "${id}" (lower case letters, digits and hyphens)`);
		problems++;
		continue;
	}
	const src = join(SOURCE, `${doc.presets[id].source}.json`);
	let preset;
	try {
		preset = JSON.parse(readFileSync(src, 'utf8'));
	} catch (e) {
		console.error(`${id}: cannot read ${doc.presets[id].source}: ${e.message}`);
		problems++;
		continue;
	}
	const text = JSON.stringify(preset);
	writeFileSync(join(OUT, `${id}.json`), text);
	index.push({ id, name: doc.presets[id].source, bytes: Buffer.byteLength(text) });
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');

const total = readdirSync(OUT)
	.filter((f) => f !== 'index.json')
	.reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`${index.length} presets, ${(total / 1024).toFixed(1)} KiB in static/data/ambient`);
if (problems) process.exit(1);
