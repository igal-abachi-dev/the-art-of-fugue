// The deployment settings against the real build (T9.1.1, T9.1.2).
//
//   pnpm build && pnpm deploy-check
//
// Static part (no browser):
//   - vercel.json builds to `build`, and every header rule matches files that exist;
//   - every file of the build is either cached for good (/_app/immutable, /audio, /data/{pieces,spectro,notation,...}, /samples)
//     or revalidated (the manifest, the pages, robots, favicon): nothing that can change under its URL is immutable;
//   - the manifest has a `build` id and every audio `src` a hash of its file, so the URLs the app asks for change with the files;
//   - no file reaches Vercel's 100 MB (Hobby) per static file.
// Live part: the build served by the emulator of vercel.json (scripts/vercel-emulator.mjs): headers per URL as the
// app asks for them, 206 with Content-Range for the audio, 416 beyond the end, the pages by their clean URL.
// It is an emulation of the documented behaviour; only a deploy shows what the edge does.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { headersFor, sourceToRegExp, startEmulator } from './vercel-emulator.mjs';

const BUILD = resolve('build');
const cfg = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8'));
let bad = 0;
const ok = (c, m, detail = '') => {
	if (!c) bad++;
	console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${detail ? ` (${detail})` : ''}`);
};

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
const urlOf = (f) => '/' + relative(BUILD, f).split('\\').join('/');
const immutable = (path) => /immutable/.test(headersFor(cfg, path)['Cache-Control'] ?? '');

ok(
	cfg.outputDirectory === 'build' && cfg.buildCommand === 'pnpm build',
	'vercel.json: build command and output directory'
);
for (const rule of cfg.headers) {
	const re = sourceToRegExp(rule.source);
	ok(
		rule.source === '/(.*)' || files.some((f) => re.test(urlOf(f))),
		`rule ${rule.source} matches a file of the build`
	);
}

const REVALIDATED =
	/^\/(data\/manifest\.json|_app\/version\.json|[^/]+\.html|robots\.txt|favicon\.svg)$/;
const wrong = [];
let nImmutable = 0;
for (const f of files) {
	const url = urlOf(f);
	const should = !REVALIDATED.test(url);
	if (immutable(url)) nImmutable++;
	if (immutable(url) !== should) wrong.push(url);
}
ok(
	wrong.length === 0,
	`every file is cached for good or revalidated as it should be (${files.length} files, ${nImmutable} immutable)`,
	wrong.slice(0, 4).join(', ')
);

const manifest = JSON.parse(readFileSync(join(BUILD, 'data/manifest.json'), 'utf8'));
ok(/^[0-9a-f]{10}$/.test(manifest.build ?? ''), 'the manifest carries a build id', manifest.build);
// The audio is generated and not committed, so a build without it (CI) skips what concerns it; `--require-audio` (the
// release) does not.
const REQUIRE_AUDIO = process.argv.includes('--require-audio');
const haveAudio = manifest.audio.every((a) => existsSync(join(BUILD, a.src.split('?')[0])));
if (!haveAudio && !REQUIRE_AUDIO)
	console.log('skip the audio files are not in this build (add --require-audio to insist)');
for (const a of haveAudio || REQUIRE_AUDIO ? manifest.audio : []) {
	const [path, q] = a.src.split('?v=');
	const file = join(BUILD, path);
	if (!existsSync(file)) {
		ok(false, `audio ${path} is in the build`);
		continue;
	}
	const h = createHash('sha1');
	h.update(readFileSync(file));
	ok(h.digest('hex').slice(0, 10) === q, `audio src carries the hash of its file: ${a.src}`);
	ok(
		statSync(file).size < 100 * 1024 * 1024,
		`${path} is under Vercel's 100 MB per static file`,
		`${(statSync(file).size / 1e6).toFixed(1)} MB`
	);
}
ok(
	files.every((f) => statSync(f).size < 100 * 1024 * 1024),
	'no file of the build reaches 100 MB'
);

// ---- live
const server = await startEmulator({ port: 0 });
const get = (path, headers = {}) => fetch(server.url + path, { headers });
const sample = manifest.audio[0];
const checks = [
	['/data/manifest.json', /must-revalidate/, 'the manifest is revalidated'],
	['/credits', /./, 'the credits page by its clean URL'],
	[
		`/data/${manifest.pieces[0].notes}?v=${manifest.build}`,
		/immutable/,
		'a note chunk is immutable'
	],
	[sample.src, /immutable/, 'the audio is immutable']
];
for (const [path, re, what] of checks) {
	const r = await get(path);
	ok(
		r.status === 200 && re.test(r.headers.get('cache-control') ?? ''),
		what,
		`${r.status} ${r.headers.get('cache-control')}`
	);
	await r.body?.cancel();
}
for (const [path, key, what] of [
	['/', 'x-robots-tag', 'noindex on every page'],
	['/', 'x-content-type-options', 'nosniff']
]) {
	const r = await get(path);
	ok(!!r.headers.get(key), what, r.headers.get(key));
	await r.body?.cancel();
}
if (haveAudio) {
	const size = statSync(join(BUILD, sample.src.split('?')[0])).size;
	const r = await get(sample.src, { Range: 'bytes=1000-1999' });
	const got = (await r.arrayBuffer()).byteLength;
	ok(
		r.status === 206 &&
			r.headers.get('content-range') === `bytes 1000-1999/${size}` &&
			got === 1000,
		'range request: 206 with Content-Range and exactly the bytes asked',
		r.headers.get('content-range')
	);
	const tail = await get(sample.src, { Range: `bytes=${size - 500}-` });
	ok(
		tail.status === 206 && (await tail.arrayBuffer()).byteLength === 500,
		'range request to the end of the file'
	);
	const beyond = await get(sample.src, { Range: `bytes=${size + 10}-` });
	ok(beyond.status === 416, 'range beyond the end: 416');
	await beyond.body?.cancel();
}
await server.close();
console.log(bad ? `\n${bad} FAILED` : '\nall deployment checks passed');
process.exitCode = bad ? 1 : 0;
