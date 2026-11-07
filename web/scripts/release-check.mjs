// The public release checklist, as far as a script can tick it (T9.4.1).
//
//   pnpm build && pnpm release-check [--public] [--require-audio]
//
// TECHNICAL items (always checked, the script fails if one is not met):
//   build        what is in `build/`: no raw WAV or other lossless audio, no PDF, no file named after the raw sources, audio only as
//                the two encodes the manifest lists, the sampled instruments as the files their lists name, nothing over Vercel's 100 MB
//   sync         the sync acceptance (`python -m artfugue.syncref`): median <= 30 ms, 95th percentile <= 80 ms, from
//                data/sync-reference.json against the note chunks that ship; docs/sync-report.md is regenerated and must say PASS
//   safety       the photosensitivity warning is in the start screen of the built app, and the less-motion start is offered
//   credits      the credits page names every source the app uses, with its licence
//   noindex      the deployment keeps the site out of search (robots.txt, the header in vercel.json)
// HUMAN items (docs/release.md): rights for the recording and for the score data. They are read from data/release.json, where the
// owner records a decision with its evidence. By default they are REPORTED as open; with `--public` an open one fails the check.
// The default run is therefore the check of a private preview, `--public` the check of a public release.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const PUBLIC = process.argv.includes('--public');
const REQUIRE_AUDIO = process.argv.includes('--require-audio');
const BUILD = resolve('build');
const ROOT = resolve('..');
let bad = 0;
let open = 0;
const ok = (c, m, detail = '') => {
	if (!c) bad++;
	console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${detail ? ` (${detail})` : ''}`);
};
const section = (t) => console.log(`\n-- ${t}`);

if (!existsSync(BUILD)) {
	console.error('no build/: run pnpm build first');
	process.exit(2);
}
const files = [];
(function walk(d) {
	for (const n of readdirSync(d)) {
		const p = join(d, n);
		if (statSync(p).isDirectory()) walk(p);
		else files.push(p);
	}
})(BUILD);
const rel = (f) => relative(BUILD, f).split('\\').join('/');
const text = (f) => readFileSync(f, 'utf8');
const manifest = JSON.parse(text(join(BUILD, 'data/manifest.json')));

// ---------------------------------------------------------------- build
section('the build contains nothing it should not');
const LOSSLESS = new Set([
	'.wav',
	'.flac',
	'.aiff',
	'.aif',
	'.alac',
	'.pdf',
	'.mxl',
	'.zip',
	'.7z'
]);
// the one lossless audio that ships: the organ's samples, FLAC because a loop has to be exact to the sample in every browser
const lossless = files.filter(
	(f) => LOSSLESS.has(extname(f).toLowerCase()) && !rel(f).startsWith('samples/organ/')
);
ok(
	lossless.length === 0,
	'no WAV, FLAC, PDF, MXL or archive in the build (but the organ\'s FLAC samples)',
	lossless.map(rel).join(', ')
);
const sources = existsSync(join(ROOT, 'data/raw')) ? readdirSync(join(ROOT, 'data/raw')) : [];
const named = files.filter((f) =>
	sources.some((s) => rel(f).includes(s) || s.includes(rel(f).split('/').pop()))
);
ok(
	named.length === 0,
	'no file is a raw source (data/raw) or named after one',
	named.map(rel).join(', ')
);
const audioFiles = files.filter((f) => rel(f).startsWith('audio/')).map(rel);
const wanted = manifest.audio.map((a) => a.src.split('?')[0].replace(/^\//, ''));
const extra = audioFiles.filter((f) => !wanted.includes(f));
ok(extra.length === 0, 'the only audio under audio/ is what the manifest lists', extra.join(', '));
const missing = wanted.filter((w) => !audioFiles.includes(w));
if (missing.length && !REQUIRE_AUDIO)
	console.log(
		`skip the audio is not in this build: ${missing.join(', ')} (--require-audio insists)`
	);
else ok(missing.length === 0, 'both encodes (Opus and AAC) are in the build', missing.join(', '));
for (const f of audioFiles.filter((x) => wanted.includes(x))) {
	const head = readFileSync(join(BUILD, f)).subarray(0, 12);
	const isRiff = head.subarray(0, 4).toString('latin1') === 'RIFF';
	ok(!isRiff, `${f} is a compressed encode, not a WAV`);
}
// the sampled instruments: every file of an instrument's list is there, and nothing else is in its folder
for (const id of ['piano', 'harpsichord', 'organ']) {
	const dir = join(BUILD, 'samples', id);
	const doc = existsSync(join(dir, 'index.json')) ? JSON.parse(text(join(dir, 'index.json'))) : null;
	const listed = doc ? doc.layers.flatMap((l) => l.samples.map((s) => s.file)).sort() : [];
	const there = existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f !== 'index.json')
				.sort()
		: [];
	ok(
		!!doc && listed.length > 20 && JSON.stringify(listed) === JSON.stringify(there),
		`the ${id}'s samples are the ${listed.length} files its list names, and only those`,
		`${there.length} files`
	);
	ok(
		!!doc && /CC0/.test(doc.license) && /Versilian/.test(doc.credit),
		`the ${id} is credited (Versilian Community Sample Library) and licensed CC0`
	);
}
const mp3 = files.filter((f) => extname(f) === '.mp3').map(rel);
ok(
	mp3.every((f) => /^samples\/(piano|harpsichord)\//.test(f)),
	'the only MP3s are the piano\'s and the harpsichord\'s samples',
	String(mp3.length)
);
ok(
	files.every((f) => statSync(f).size < 100 * 1024 * 1024),
	'no file reaches 100 MB'
);

// ---------------------------------------------------------------- sync
section('sync acceptance (T9.2.3)');
const py = join(
	ROOT,
	'tools',
	'.venv',
	process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);
try {
	const out = execFileSync(existsSync(py) ? py : 'python', ['-m', 'artfugue.syncref'], {
		cwd: join(ROOT, 'tools'),
		env: { ...process.env, PYTHONPATH: '.' },
		encoding: 'utf8'
	});
	ok(true, 'the shipped timings meet the sync tolerance', out.trim().split('\n').pop());
} catch (e) {
	ok(
		false,
		'the shipped timings meet the sync tolerance',
		String(e.stdout ?? e.message)
			.trim()
			.split('\n')
			.slice(-3)
			.join(' | ')
	);
}
const report = existsSync(join(ROOT, 'docs/sync-report.md'))
	? text(join(ROOT, 'docs/sync-report.md'))
	: '';
ok(/\*\*Result: PASS\.\*\*/.test(report), 'docs/sync-report.md is attached and says PASS');

// ---------------------------------------------------------------- safety
section('photosensitivity and motion');
const bundle = files
	.filter((f) => rel(f).startsWith('_app/immutable/') && f.endsWith('.js'))
	.map(text)
	.join('\n');
ok(/Moving light/.test(bundle), 'the start screen carries the warning about moving light');
ok(
	/flash/i.test(bundle) && /(photosensitiv|seizure|flicker|pulses)/i.test(bundle),
	'and says what it is about'
);
ok(
	/Calm: no camera movement/i.test(bundle) && /calm mode/i.test(bundle),
	'the calm mode (reduced motion, no ambient, no bloom) is a switch in the effects menu, and the welcome says where'
);
const a11y = existsSync(join(ROOT, 'docs/accessibility.md'))
	? text(join(ROOT, 'docs/accessibility.md'))
	: '';
ok(
	/WCAG 2\.3\.1/.test(a11y),
	'docs/accessibility.md documents the flash measurement (pnpm flash-check)'
);

// ---------------------------------------------------------------- credits
section('attributions');
const credits = text(join(BUILD, 'credits.html')) + '\n' + bundle;
const MUST = [
	['Marta Czech', 'the performer'],
	['Contrapunctus Press', 'the reference score'],
	['CC BY-NC-SA 4.0', 'its licence'],
	['OpenScore', 'the MusicXML'],
	['CC0', 'its licence'],
	['Versilian', 'the instruments of the sampler mode'],
	['Steinway', 'the piano samples'],
	['Verovio', 'the engraving'],
	['three', 'the 3D library'],
	['butterchurn', 'the MilkDrop layer']
];
for (const [needle, what] of MUST)
	ok(new RegExp(needle, 'i').test(credits), `credited: ${what} (${needle})`);

// ---------------------------------------------------------------- noindex
section('privacy of the deployment');
const vercel = JSON.parse(text(resolve('vercel.json')));
ok(
	vercel.headers.some((h) =>
		h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value))
	),
	'vercel.json sends X-Robots-Tag: noindex'
);
ok(/Disallow:\s*\//.test(text(join(BUILD, 'robots.txt'))), 'robots.txt disallows everything');

// ---------------------------------------------------------------- human items
section(
	`rights (a person decides; ${PUBLIC ? 'a public release needs them cleared' : 'reported only, this is the private-preview check'})`
);
const cfgPath = join(ROOT, 'data/release.json');
const cfg = existsSync(cfgPath) ? JSON.parse(text(cfgPath)) : { items: [] };
for (const item of cfg.items) {
	const cleared = item.status === 'cleared';
	if (!cleared) open++;
	if (PUBLIC) ok(cleared, `${item.what}: ${item.status}`, item.evidence);
	else console.log(`${cleared ? 'ok  ' : 'OPEN'} ${item.what}: ${item.status} (${item.evidence})`);
}

console.log(
	bad
		? `\n${bad} FAILED`
		: `\nthe technical items are met${open ? `; ${open} rights item${open > 1 ? 's' : ''} still open` : ''}${PUBLIC && !open ? ': ready for a public release' : ''}`
);
process.exitCode = bad ? 1 : 0;
