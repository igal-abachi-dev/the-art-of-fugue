// A small static server that does what Vercel does with web/vercel.json (T9.1.1, T9.1.2): serves `build/`, applies the
// header rules, cleanUrls (/credits -> credits.html) and byte ranges (206, Content-Range, Accept-Ranges). It is an
// EMULATION, written from Vercel's documented behaviour: it shows that the rules in vercel.json match the files and that the
// app works with those headers, not what Vercel's edge does (that needs a deploy).
//
//   node scripts/vercel-emulator.mjs [--port 4180] [--dir build]       (a server for the browser checks)
// and importable: `startEmulator({ port, dir })` -> { url, close }, `headersFor(config, path)`.

import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain; charset=utf-8',
	'.bin': 'application/octet-stream',
	'.mp3': 'audio/mpeg',
	'.webm': 'audio/webm',
	'.m4a': 'audio/mp4',
	'.wasm': 'application/wasm',
	'.png': 'image/png'
};

/** `/a/(.*)` style sources of vercel.json as a RegExp (the only forms used there: literal paths and `(.*)`). */
export function sourceToRegExp(source) {
	const esc = (t) => t.replace(/[.+?^${}|[\]\\]/g, '\\$&');
	return new RegExp('^' + source.split('(.*)').map(esc).join('.*') + '$');
}

/** The headers vercel.json sets for a URL path; later rules win over earlier ones for the same key. */
export function headersFor(config, path) {
	const out = {};
	for (const rule of config.headers ?? []) {
		if (!sourceToRegExp(rule.source).test(path)) continue;
		for (const h of rule.headers) out[h.key] = h.value;
	}
	return out;
}

export function startEmulator({ port = 4180, dir = 'build', config = 'vercel.json' } = {}) {
	const root = resolve(dir);
	const cfg = JSON.parse(readFileSync(resolve(config), 'utf8'));
	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		const path = decodeURIComponent(url.pathname);
		let file = normalize(join(root, path));
		if (!file.startsWith(root + sep) && file !== root) {
			res.writeHead(403).end();
			return;
		}
		if (cfg.cleanUrls && !extname(path) && path !== '/') {
			if (existsSync(file + '.html')) file += '.html';
		}
		if (path.endsWith('/') || (existsSync(file) && statSync(file).isDirectory()))
			file = join(file, 'index.html');
		if (!existsSync(file) || !statSync(file).isFile()) {
			res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
			return;
		}
		const size = statSync(file).size;
		const headers = {
			'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
			'Accept-Ranges': 'bytes',
			'Cache-Control': 'public, max-age=0, must-revalidate', // Vercel's default for static files
			...headersFor(cfg, path)
		};
		const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
		let start = 0;
		let end = size - 1;
		let status = 200;
		if (m && (m[1] || m[2])) {
			if (m[1]) {
				start = Number(m[1]);
				if (m[2]) end = Math.min(Number(m[2]), size - 1);
			} else {
				start = Math.max(0, size - Number(m[2]));
			}
			if (start >= size) {
				res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
				return;
			}
			status = 206;
			headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
		}
		headers['Content-Length'] = end - start + 1;
		res.writeHead(status, headers);
		if (req.method === 'HEAD') return void res.end();
		createReadStream(file, { start, end }).pipe(res);
	});
	return new Promise((ok) =>
		server.listen(port, '127.0.0.1', () =>
			ok({
				url: `http://127.0.0.1:${server.address().port}`,
				close: () => new Promise((r) => server.close(r))
			})
		)
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const a = process.argv.slice(2);
	const get = (k, d) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : d);
	const s = await startEmulator({ port: Number(get('port', 4180)), dir: get('dir', 'build') });
	console.log(`serving build/ with vercel.json at ${s.url}`);
}
