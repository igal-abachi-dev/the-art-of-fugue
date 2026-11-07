// `pnpm data`: rebuild everything shipped from data/raw/ (score data, alignment, audio copies, docs).
// Extra arguments are passed on: pnpm data -- --encode --force-audio --no-qa
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const py = join(
	root,
	'tools',
	'.venv',
	process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);
const r = spawnSync(py, ['-m', 'artfugue.build_all', ...process.argv.slice(2)], {
	cwd: join(root, 'tools'),
	stdio: 'inherit'
});
process.exit(r.status ?? 1);
