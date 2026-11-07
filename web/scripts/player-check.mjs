// Real-browser check of the interface at `/` (E7, T7.6.1).
//
//   pnpm build && pnpm preview --port 4173      (in one terminal)
//   pnpm player-check [--url http://localhost:4173] [--engines msedge,firefox] [--shots ../docs/img]
//
// It drives every control of the player (the table in backlog.md, E7) and checks the state that results, in the engine
// and on the stage, not only that a click happened: start screen and deep link, play, pause, stop, previous and next
// piece and bar, 5 s and 10 s jumps, seek by click, drag and keyboard, volume and mute, speed, repeat modes, the A-B loop
// (and the gap a loop leaves, measured), voice toggles, the effects menu (and that the stage is not recreated), the piece
// list, the info panel, the help, stored settings and a deep link over them, auto-hide, accessible names, a phone-sized
// window and the credits page. The screenshots in docs/img/player-*.png are for looking at.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { begin as touchBegin } from './begin.mjs';

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
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launchers = {
	msedge: () =>
		chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] }),
	firefox: () =>
		firefox.launch({
			firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
		}),
	webkit: () => webkit.launch()
};

const HELPERS = () => {
	const P = () => window.__player.player;
	const E = () => window.__player.player.engine;
	window.__c = {
		P,
		E,
		piece: (id) => E().manifest.pieces.find((p) => p.id === id),
		now: () => E().clock.now(),
		state: () => ({
			t: E().clock.now(),
			status: E().status,
			piece: E().piece?.id ?? null,
			bar: E().bar?.n ?? null,
			rate: E().rate,
			gain: E().graph?.gain ?? null,
			volume: E().graph?.volume ?? null,
			muted: E().graph?.muted ?? null,
			settings: JSON.parse(JSON.stringify(P().settings)),
			region: P().region ? { ...P().region } : null,
			panel: P().panel,
			begun: P().begun
		}),
		seekPlace: (id, bar) => E().seekPlace({ piece: window.__c.piece(id), bar })
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

async function run(name) {
	const out = { engine: name, ok: false, checks: [], notes: [], numbers: {} };
	const check = (what, ok, detail = '') => {
		out.checks.push({ what, ok: !!ok, detail });
		if (!ok) console.error(`  FAIL [${name}] ${what} ${detail}`);
	};
	let browser;
	try {
		browser = await launchers[name]();
	} catch (e) {
		out.notes.push(`could not launch: ${String(e.message).split('\n')[0]}`);
		return out;
	}
	const errors = [];
	try {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const watch = (page) => {
			page.on('pageerror', (e) => errors.push(String(e.message)));
			page.on('console', (m) => {
				if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`);
			});
		};
		async function open(query = '', { context = ctx, begin = true, init = null } = {}) {
			const page = await context.newPage();
			watch(page);
			if (init) await page.addInitScript(init);
			await page.goto(`${URL_BASE}/${query}`, { waitUntil: 'load' });
			await page.waitForFunction(() => window.__player?.player, null, { timeout: 30000 });
			await page.evaluate(HELPERS);
			if (begin) {
				await touchBegin(page); // there is no button: a touch starts it at once, or a link already has
				await waitFor(page, () => window.__c.state().status === 'playing', null, 20000);
				// the picture is built a moment after the page: the checks that follow read it
				await waitFor(page, () => !!window.__player.stage, null, 20000);
			}
			return page;
		}
		// a browser that keeps the sound off until the page is touched (Firefox, Safari, a first visit in Chrome)
		const BLOCKED = () => {
			window.__touched = false;
			for (const e of ['pointerdown', 'keydown'])
				window.addEventListener(e, () => (window.__touched = true), true);
			const play = HTMLMediaElement.prototype.play;
			HTMLMediaElement.prototype.play = function () {
				return window.__touched
					? play.call(this)
					: Promise.reject(new DOMException('play() needs a gesture', 'NotAllowedError'));
			};
		};
		const st = (page) => page.evaluate(() => window.__c.state());
		const shot = (page, n) => page.screenshot({ path: resolve(SHOTS, `player-${n}-${name}.png`) });
		const press = async (page, key) => {
			await page.keyboard.press(key);
			await sleep(150);
		};
		const pause = async (page) => {
			await page.evaluate(() => window.__c.E().pause());
			await sleep(150);
		};
		const near = (a, b, tol) => Math.abs(a - b) <= tol;

		// ---- the welcome: no button; it fades and the music begins by itself; a link to a bar skips it
		let page = await open('', { begin: false });
		check('the welcome is shown', await page.getByTestId('welcome').isVisible());
		const startText = await page.locator('.start').innerText();
		check(
			'it names the work and the player',
			/The Art of Fugue/.test(startText) && /Marta Czech/.test(startText),
			startText.slice(0, 120)
		);
		check(
			'it warns about moving light and says where the calm mode is',
			/moving light/i.test(startText) && /effects menu/i.test(startText)
		);
		check(
			'it has no Begin button and no Begin calmly button',
			(await page.locator('.start button').count()) === 0 &&
				(await page.getByRole('button', { name: /begin/i }).count()) === 0
		);
		let s = await st(page);
		check(
			'nothing plays in its first moment',
			s.status !== 'playing' && !s.begun,
			JSON.stringify([s.status, s.begun])
		);
		await shot(page, 'start');
		const auto = await waitFor(page, () => window.__c.state().status === 'playing', null, 8000);
		const sinceNavigation = await page.evaluate(() => performance.now());
		const mountedAt = await page.evaluate(() => window.__player.mountedAt);
		check('left alone, the music begins by itself', !!auto);
		console.log(
			`     playing ${(sinceNavigation / 1000).toFixed(2)} s after the navigation began (the page was ready at ${(mountedAt / 1000).toFixed(2)} s)`
		);
		check(
			'and at 1.6 s from the start of browsing, or 1.3 s after the page is ready if that is later',
			sinceNavigation < Math.max(2300, mountedAt + 1300),
			JSON.stringify([sinceNavigation, mountedAt])
		);
		check(
			'the welcome is gone once it has faded',
			!!(await waitFor(page, () => !document.querySelector('.start'), null, 3000))
		);
		check(
			'without a link, the piece list opens to choose from',
			(await st(page)).panel === 'pieces' && (await page.locator('[role=option]').count()) === 20
		);
		await page.close();

		// a touch during the welcome starts the music at once, and does nothing else
		page = await open('', { begin: false });
		await page.mouse.click(8, 8);
		check(
			'a click during the welcome starts the music at once',
			!!(await waitFor(page, () => window.__c.state().status === 'playing', null, 6000))
		);
		await sleep(900);
		check('and the same click does not pause it again', (await st(page)).status === 'playing');
		await page.close();

		// a link to a bar: no welcome, it plays at once, at that bar
		page = await open('?p=viii&bar=25', { begin: false });
		check('a link to a bar skips the welcome', (await page.getByTestId('welcome').count()) === 0);
		check(
			'and plays at once',
			!!(await waitFor(page, () => window.__c.state().status === 'playing', null, 8000))
		);
		s = await st(page);
		check(
			'deep link restored: piece and bar',
			s.piece === 'c08' && s.bar >= 24 && s.bar <= 26,
			JSON.stringify([s.piece, s.bar])
		);
		check(
			'a deep link does not open the piece list (it already says what to hear)',
			s.panel === null
		);
		await sleep(1200);
		await shot(page, 'playing');

		// where the browser keeps the sound off until the page is touched
		const blocked = await open('', { begin: false, init: BLOCKED });
		await sleep(2600);
		s = await blocked.evaluate(() => ({ ...window.__c.state(), waiting: window.__c.P().waiting }));
		check(
			'if the browser refuses to play by itself, the player shows, paused, and says so',
			s.begun &&
				s.waiting &&
				s.status !== 'playing' &&
				(await blocked.locator('.waiting').count()) === 1,
			JSON.stringify([s.begun, s.waiting, s.status])
		);
		check(
			'and shows no error for it',
			(await blocked.locator('[role=alert]').count()) === 0 &&
				!(await blocked.evaluate(() => window.__c.E().error))
		);
		check(
			'and with no link it waits at the first piece, not between pieces',
			s.piece === 'c01',
			String(s.piece)
		);
		await shot(blocked, 'waiting');
		await blocked.keyboard.press('Space');
		check(
			'Space then starts the music',
			!!(await waitFor(blocked, () => window.__c.state().status === 'playing', null, 8000))
		);
		await sleep(900);
		check(
			'and is not read twice (it does not pause it again)',
			(await st(blocked)).status === 'playing' &&
				!(await blocked.evaluate(() => window.__c.P().waiting))
		);
		await blocked.close();
		const blocked2 = await open('?p=iii&bar=3', { begin: false, init: BLOCKED });
		await sleep(900);
		check(
			'a link whose music is refused waits at its bar',
			(await blocked2.evaluate(() => window.__c.P().waiting)) &&
				(await st(blocked2)).piece === 'c03'
		);
		await blocked2.getByTestId('toggle').click(); // a click on a button starts it, and is not also the button's own press
		check(
			'a click on the play button starts the music (and does not toggle it off again)',
			!!(await waitFor(blocked2, () => window.__c.state().status === 'playing', null, 8000))
		);
		await sleep(900);
		check('it keeps playing', (await st(blocked2)).status === 'playing');
		await blocked2.close();

		// ---- play, pause, the time
		const tBefore = (await st(page)).t;
		await sleep(1200);
		check('time advances while playing', (await st(page)).t > tBefore + 0.8);
		await page.mouse.move(640, 690); // the controls fade while it plays untouched: bring them back
		await page.getByTestId('toggle').click();
		await sleep(300);
		check('pause button pauses', (await st(page)).status === 'paused');
		const label = await page.getByTestId('toggle').getAttribute('aria-label');
		check('the button says Play when paused', label === 'Play', label);
		await page.getByTestId('toggle').click();
		check(
			'play button plays',
			!!(await waitFor(page, () => window.__c.state().status === 'playing'))
		);
		await press(page, ' ');
		check('Space pauses', (await st(page)).status === 'paused');
		await press(page, 'k');
		check('K plays', !!(await waitFor(page, () => window.__c.state().status === 'playing')));
		await pause(page);

		// ---- jumps by time and by keyboard
		await page.evaluate(() => window.__c.seekPlace('c05', 5));
		await sleep(300);
		let a = await st(page);
		await press(page, 'ArrowRight');
		let b = await st(page);
		check('→ goes forward 5 s', near(b.t - a.t, 5, 0.4), (b.t - a.t).toFixed(2));
		await press(page, 'ArrowLeft');
		b = await st(page);
		check('← goes back 5 s', near(b.t - a.t, 0, 0.4), (b.t - a.t).toFixed(2));
		await press(page, 'Shift+ArrowRight');
		b = await st(page);
		check('Shift+→ goes forward 30 s', near(b.t - a.t, 30, 0.5), (b.t - a.t).toFixed(2));
		await page.getByLabel('Back 10 seconds').click();
		await sleep(150);
		a = b;
		b = await st(page);
		check('back 10 s button', near(b.t - a.t, -10, 0.5), (b.t - a.t).toFixed(2));
		await page.getByLabel('Forward 10 seconds').click();
		await sleep(150);
		check('forward 10 s button', near((await st(page)).t - a.t, 0, 0.5));

		// ---- bars and pieces
		await page.evaluate(() => window.__c.seekPlace('c05', 5));
		await sleep(300);
		await press(page, '.');
		s = await st(page);
		check('. goes to the next bar', s.bar === 6, String(s.bar));
		await sleep(900); // past the start of the bar, so "previous" goes to its start first
		await press(page, ',');
		s = await st(page);
		check(', goes to the start of this bar', s.bar === 6 || s.bar === 5, String(s.bar));
		await press(page, ',');
		s = await st(page);
		check(', again goes to the bar before', s.bar === 5 || s.bar === 4, String(s.bar));
		await press(page, ']');
		check('] goes to the next piece', (await st(page)).piece === 'c06');
		await press(page, '[');
		await sleep(200);
		s = await st(page);
		check('[ restarts or goes back', s.piece === 'c06' || s.piece === 'c05', String(s.piece));
		await page.evaluate(() => window.__c.seekPlace('c05', 9));
		await sleep(200);
		await press(page, 'Home');
		s = await st(page);
		check(
			'Home goes to the start of the piece',
			s.piece === 'c05' && s.bar !== null && s.bar <= 1,
			JSON.stringify([s.piece, s.bar])
		);
		await page.getByLabel('Next piece').click();
		await sleep(200);
		check('next piece button', (await st(page)).piece === 'c06');
		await page.getByLabel('Previous piece').click();
		await sleep(200);
		s = await st(page);
		check(
			'previous piece button (restarts a piece from its beginning, goes back after 3 s)',
			s.piece === 'c05' || s.piece === 'c06'
		);

		// ---- stop goes back to the start of the piece and stays paused
		await page.evaluate(() => window.__c.seekPlace('c09', 12));
		await page.evaluate(() => window.__c.E().play());
		await sleep(600);
		await page.getByLabel(/^Stop/).click();
		await sleep(300);
		s = await st(page);
		const c09 = await page.evaluate(() => window.__c.piece('c09').audio_start);
		check(
			'Stop pauses at the start of the piece',
			s.status !== 'playing' && near(s.t, c09, 0.3),
			JSON.stringify([s.status, s.t - c09])
		);

		// ---- the seek bar: click, drag, hover tooltip, tick marks
		const seek = page.getByTestId('seek');
		await seek.scrollIntoViewIfNeeded();
		const box = await seek.boundingBox();
		const dur = await page.evaluate(() => window.__c.E().duration);
		await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2, { delay: 30 });
		await sleep(300);
		s = await st(page);
		check(
			'clicking the bar seeks there (snapping to a piece start is allowed)',
			near(s.t / dur, 0.5, 0.03),
			(s.t / dur).toFixed(3)
		);
		await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
		await sleep(150);
		const tipText = await page
			.locator('.tip')
			.innerText()
			.catch(() => '');
		check(
			'hovering the bar shows piece, bar and time',
			/Contrapunctus|Canon/.test(tipText) && /\d:\d\d/.test(tipText),
			tipText
		);
		await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 12 });
		const during = (await st(page)).t;
		await page.mouse.up();
		await sleep(300);
		const after = (await st(page)).t;
		check(
			'dragging the bar moves the playhead and ends where it is released',
			during / dur > 0.4 && near(after / dur, 0.7, 0.03),
			JSON.stringify([+(during / dur).toFixed(3), +(after / dur).toFixed(3)])
		);
		check('the bar has a tick for every piece', (await page.locator('.seek .tick').count()) === 20);
		const valuetext = await seek.getAttribute('aria-valuetext');
		check(
			'the bar is a slider with words for its value',
			(await seek.getAttribute('role')) === 'slider' && /\d:\d\d/.test(valuetext ?? ''),
			valuetext
		);

		// ---- time display
		const timeA = await page.getByTestId('time').innerText();
		await page.getByTestId('time').click();
		const timeB = await page.getByTestId('time').innerText();
		check(
			'the time switches between elapsed and remaining',
			timeA !== timeB && timeB.includes('−'),
			`${timeA} | ${timeB}`
		);
		await page.getByTestId('time').click();

		// ---- volume and mute
		await page.getByTestId('volume').fill('0.5');
		await sleep(150);
		s = await st(page);
		check(
			'volume slider: gain follows a square law',
			s.gain !== null && near(s.gain, 0.25, 0.02),
			String(s.gain)
		);
		await press(page, 'm');
		s = await st(page);
		check(
			'M mutes (gain 0, slider kept)',
			s.gain === 0 && s.muted === true && near(s.volume, 0.5, 0.01),
			JSON.stringify([s.gain, s.volume])
		);
		await press(page, 'm');
		s = await st(page);
		check('M again unmutes to the same level', near(s.gain, 0.25, 0.02), String(s.gain));
		await page.getByTestId('mute').click();
		check('the speaker button mutes', (await st(page)).muted === true);
		await page.getByTestId('mute').click();
		await page.getByTestId('volume').focus();
		await press(page, 'ArrowUp');
		check('arrows on the volume slider raise it (and do not seek)', (await st(page)).volume > 0.5);

		// ---- speed, with the pitch kept
		await press(page, 'Shift+.');
		s = await st(page);
		check('Shift+. is faster', near(s.rate, 1.05, 0.01), String(s.rate));
		await press(page, 'Backspace');
		check('Backspace is normal speed', (await st(page)).rate === 1);
		await page.getByTestId('speed').click();
		await page.getByRole('menuitemradio', { name: '0.5×' }).click();
		await sleep(150);
		s = await st(page);
		check('the speed menu sets 0.5×', s.rate === 0.5);
		const pp = await page.evaluate(
			() => window.__c.E().element.preservesPitch ?? window.__c.E().element.mozPreservesPitch
		);
		check('pitch is preserved at that speed', pp === true, String(pp));
		await press(page, 'Backspace');

		// ---- repeat modes
		await press(page, 'r');
		check('R: repeat the piece', (await st(page)).settings.repeat === 'piece');
		await press(page, 'r');
		check('R again: repeat all', (await st(page)).settings.repeat === 'all');
		await press(page, 'r');
		check('R again: repeat off', (await st(page)).settings.repeat === 'off');
		await press(page, 'r');
		await page.evaluate(() => {
			const p = window.__c.piece('c02');
			window.__c.E().seek(p.audio_end - 1.2);
			window.__c.E().play();
		});
		const wrapped = await waitFor(
			page,
			() => {
				const p = window.__c.piece('c02');
				const t = window.__c.now();
				return t < p.audio_start + 2 && t >= p.audio_start - 0.5;
			},
			null,
			6000
		);
		check(
			'repeat piece: the piece starts again at its end',
			!!wrapped,
			JSON.stringify(await st(page))
		);
		await press(page, 'r'); // all
		await press(page, 'r'); // off
		await pause(page);

		// ---- the A-B loop, and the gap it leaves
		await page.evaluate(() => window.__c.seekPlace('c03', 3));
		await sleep(300);
		await press(page, 'a');
		await press(page, '.');
		await press(page, '.');
		await press(page, 'a');
		s = await st(page);
		check(
			'A, move, A sets a loop snapped to bar lines',
			!!s.region && s.region.b - s.region.a > 1,
			JSON.stringify(s.region)
		);
		check('the loop shows on the bar', (await page.locator('.seek .loop').count()) >= 1);
		await page.evaluate(() => {
			const r = window.__c.P().region;
			const e = window.__c.E();
			e.seek(r.b - 0.8);
			window.__gapLog = [];
			e.element.addEventListener('seeking', () =>
				window.__gapLog.push(['seeking', performance.now()])
			);
			e.element.addEventListener('seeked', () =>
				window.__gapLog.push(['seeked', performance.now()])
			);
			e.element.addEventListener('playing', () =>
				window.__gapLog.push(['playing', performance.now()])
			);
			e.play();
		});
		const wrappedLoop = await waitFor(
			page,
			() => {
				const r = window.__c.P().region;
				return (
					r &&
					window.__c.now() < r.a + 2.5 &&
					window.__c.now() >= r.a - 0.3 &&
					window.__gapLog.some((x) => x[0] === 'seeking')
				);
			},
			null,
			8000
		);
		check('the loop wraps from B back to A', !!wrappedLoop, JSON.stringify(await st(page)));
		const log = await page.evaluate(() => window.__gapLog);
		const lastSeeking = log.filter((x) => x[0] === 'seeking').at(-1);
		const lastSeeked = log.filter((x) => x[0] === 'seeked').at(-1);
		if (lastSeeking && lastSeeked)
			out.numbers.loopSeekMs = +(lastSeeked[1] - lastSeeking[1]).toFixed(1);
		check(
			'a loop seek completes quickly (the measured gap is in the report)',
			out.numbers.loopSeekMs !== undefined && out.numbers.loopSeekMs < 400,
			String(out.numbers.loopSeekMs)
		);
		await press(page, 'a');
		s = await st(page);
		check('A again clears the loop', s.region === null);
		await page.evaluate(() => window.__c.P().setLoop(window.__c.now(), window.__c.now() + 6));
		await page.evaluate(() => window.__c.P().seekBy(60));
		await sleep(150);
		check('a seek outside the loop ends it', (await st(page)).region === null);
		await pause(page);

		// ---- voices: the stage hides them, the audio is untouched
		await page.evaluate(() => window.__c.seekPlace('c05', 9));
		await sleep(300);
		const stageBefore = await page.evaluate(() => ({
			live: window.__stageCounts?.live ?? null,
			created: window.__stageCounts?.created ?? null
		}));
		await press(page, '1');
		await sleep(700);
		let ch = await page.evaluate(() => window.__player.stage.choices());
		s = await st(page);
		check(
			'1 hides voice 1 on the stage (faded out)',
			ch.voiceShow[0] < 0.05 && ch.voiceShow[1] > 0.95,
			JSON.stringify(ch.voiceShow)
		);
		check(
			'the voice button shows it is off',
			(await page.getByTestId('voice-1').getAttribute('aria-pressed')) === 'false'
		);
		check('hiding a voice does not touch the audio', s.status !== 'error' && s.gain !== 0);
		await page.getByTestId('voice-3').click({ modifiers: ['Shift'] });
		await sleep(700);
		ch = await page.evaluate(() => window.__player.stage.choices());
		check(
			'Shift-click solos a voice',
			ch.voiceShow[2] > 0.95 && ch.voiceShow[0] < 0.05 && ch.voiceShow[1] < 0.05,
			JSON.stringify(ch.voiceShow)
		);
		await press(page, 'Shift+3');
		await press(page, '1');
		await sleep(700);
		ch = await page.evaluate(() => window.__player.stage.choices());
		check(
			'everything back on',
			ch.voiceShow.every((v) => v > 0.95),
			JSON.stringify(ch.voiceShow)
		);

		// ---- the effects menu: runtime, without recreating the stage
		await press(page, 'e');
		check('E opens the effects menu', (await st(page)).panel === 'effects');
		await shot(page, 'effects');
		await page.getByTestId('fx-ambient').uncheck();
		await page.getByTestId('fx-bloom').uncheck();
		await sleep(200);
		ch = await page.evaluate(() => window.__player.stage.choices());
		check(
			'ambient and bloom switch off at runtime',
			ch.ambient === false && ch.bloom === false,
			JSON.stringify(ch)
		);
		await page.getByTestId('fx-reduced').check();
		await sleep(200);
		ch = await page.evaluate(() => window.__player.stage.choices());
		check('calm switches reduced motion on', ch.reducedMotion === true);
		await page.getByTestId('scene').selectOption('ember');
		await sleep(400);
		check('a forced scene is chosen', (await st(page)).settings.scene === 'ember');
		await page.getByTestId('scene').selectOption('auto');
		await page.getByTestId('fx-ambient').check();
		await page.getByTestId('fx-bloom').check();
		await page.getByTestId('fx-reduced').uncheck();
		await sleep(300);
		const stageAfter = await page.evaluate(() => ({
			live: window.__stageCounts?.live ?? null,
			created: window.__stageCounts?.created ?? null
		}));
		check(
			'none of that recreated the stage',
			stageAfter.created === stageBefore.created && stageAfter.live === 1,
			JSON.stringify([stageBefore, stageAfter])
		);
		await press(page, 'Escape');
		check('Esc closes the panel', (await st(page)).panel === null);

		// ---- the piece list
		await press(page, 'p');
		const items = await page.locator('[role=option]').count();
		check('P opens the piece list with all 20 pieces', items === 20, String(items));
		const cur = await page.locator('[role=option][aria-selected=true]').count();
		check('the current piece is marked', cur === 1);
		await shot(page, 'pieces');
		await page.locator('[role=option]').nth(10).click();
		await sleep(400);
		const first = await page.evaluate(
			() => [...window.__c.E().manifest.pieces].sort((x, y) => x.audio_start - y.audio_start)[10].id
		);
		check(
			'clicking a piece goes there',
			(await st(page)).piece === first,
			`${(await st(page)).piece} vs ${first}`
		);
		await press(page, 'Escape');

		// ---- the info panel
		await page.evaluate(() => window.__c.seekPlace('c01', 2));
		await sleep(400);
		await press(page, 'i');
		await sleep(900);
		const info = await page.locator('[data-panel=info]').innerText();
		check(
			'I opens "what am I hearing" with the piece and a sentence',
			/Contrapunctus I/.test(info) && /enters in the/.test(info),
			info.replace(/\n/g, ' | ').slice(0, 200)
		);
		await shot(page, 'info');
		await press(page, 'Escape');

		// ---- jump
		await press(page, 'j');
		await page.getByTestId('jump-piece').fill('xii');
		await page.getByTestId('jump-bar').fill('10');
		await page.getByTestId('jump-go').click();
		await sleep(400);
		s = await st(page);
		check(
			'J: go to piece and bar',
			s.piece === 'c12r' && s.bar === 10,
			JSON.stringify([s.piece, s.bar])
		);
		await press(page, 'j');
		await page.getByTestId('jump-piece').fill('nothing');
		await page.getByTestId('jump-go').click();
		check(
			'J: an unknown piece is said so',
			/No piece/.test(await page.locator('[data-panel=jump]').innerText())
		);
		await press(page, 'Escape');

		// ---- help
		await press(page, '?');
		const help = await page.locator('[data-panel=help]').innerText();
		check(
			'? shows the keyboard help from the table',
			/Play \/ pause/.test(help) && /Next bar/.test(help) && /Fullscreen/.test(help)
		);
		await shot(page, 'help');
		await press(page, 'Escape');

		// ---- keys leave text fields alone
		await press(page, 'j');
		await page.getByTestId('jump-piece').fill('');
		await page.getByTestId('jump-piece').type('mk ', { delay: 20 });
		check('typing "m" and " " in a field does not mute or pause', (await st(page)).muted === false);
		await press(page, 'Escape');

		// ---- auto-hide
		await page.evaluate(() => window.__c.E().play());
		await page.mouse.move(640, 300);
		await sleep(3900);
		const hidden = await page.evaluate(() => window.__player.chrome.classList.contains('hidden'));
		check('the controls fade after a few seconds of playing', hidden);
		await page.mouse.move(600, 320);
		await sleep(300);
		check(
			'they come back on movement',
			!(await page.evaluate(() => window.__player.chrome.classList.contains('hidden')))
		);
		await pause(page);
		await sleep(4200);
		check(
			'they never fade while paused',
			!(await page.evaluate(() => window.__player.chrome.classList.contains('hidden')))
		);

		// ---- names for assistive technology
		const unnamed = await page.evaluate(() =>
			[...document.querySelectorAll('button, input, select, [role=slider]')]
				.filter((el) => !el.closest('[inert]'))
				.filter(
					(el) =>
						!(
							el.getAttribute('aria-label') ||
							el.textContent?.trim() ||
							el.labels?.length ||
							el.getAttribute('aria-labelledby') ||
							el.getAttribute('title')
						)
				)
				.map((el) => el.outerHTML.slice(0, 80))
		);
		check('every control has an accessible name', unnamed.length === 0, JSON.stringify(unnamed));
		const live = await page.locator('.sr').innerText();
		check(
			'piece changes are announced to screen readers',
			/Now playing|Between pieces/.test(live),
			live
		);
		await shot(page, 'controls-1280');

		// ---- settings are kept, and a deep link wins over a stored position
		await page.evaluate(() => {
			window.__c.P().set({ volume: 0.3, repeat: 'all', rate: 0.75 });
		});
		await page.close();
		page = await open('?p=ix&bar=5', { begin: false });
		await waitFor(page, () => window.__c.state().status === 'playing', null, 8000);
		s = await st(page);
		check(
			'settings come back after a reload',
			near(s.settings.volume, 0.3, 0.001) &&
				s.settings.repeat === 'all' &&
				s.settings.rate === 0.75,
			JSON.stringify(s.settings)
		);
		check(
			"and the link's position wins over the stored one",
			s.piece === 'c09',
			JSON.stringify([s.piece, s.status])
		);
		await page.evaluate(() => window.__c.P().resetSettings());
		await page.close();

		// ---- calm mode: a switch in the effects menu (the welcome no longer has a button for it)
		page = await open('');
		await page.mouse.move(640, 690); // the controls fade while it plays untouched
		await page.getByTestId('effects').click();
		await page.getByTestId('fx-reduced').check();
		await page.getByTestId('fx-ambient').uncheck();
		await page.getByTestId('fx-bloom').uncheck();
		await sleep(400);
		ch = await page.evaluate(() => window.__player.stage.choices());
		check(
			'the calm mode in the effects menu turns off ambient, bloom and camera motion',
			!ch.ambient && !ch.bloom && ch.reducedMotion,
			JSON.stringify(ch)
		);
		// ---- the toolbar: the transport in the middle, score and spectrogram buttons to its left
		const geo = await page.evaluate(() => {
			const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
			const t = r('.transport');
			const sc = r('[data-testid=score]');
			const sp = r('[data-testid=spectro]');
			const bar = r('.bar');
			const panel = r('[data-panel]');
			const tools = r('.tools');
			return {
				mid: t ? t.left + t.width / 2 : null,
				w: innerWidth,
				scoreLeft: sc && t ? sc.right < t.left : null,
				spectroLeft: sp && t ? sp.right < t.left : null,
				toolsInBar: tools && bar ? tools.top >= bar.top : null,
				panelAboveBar: panel && bar ? panel.bottom <= bar.top + 1 : null
			};
		});
		const order = await page.evaluate(() =>
			[
				'.views',
				'[data-testid=loop]',
				'.transport',
				'.lcd',
				'.voices',
				'.volume',
				'.speedgroup',
				'.tools'
			].map((q) => document.querySelector(q)?.getBoundingClientRect().left ?? -1)
		);
		check(
			'the toolbar order: views, loop, transport, display, voices, volume, speed, panel buttons',
			order.every((x, k) => x >= 0 && (k === 0 || x > order[k - 1])),
			JSON.stringify(order)
		);
		check(
			'the score and spectrogram buttons are left of the transport',
			geo.scoreLeft && geo.spectroLeft
		);
		check('the panel buttons are in the same toolbar', geo.toolsInBar === true);
		check(
			'a panel stands above the toolbar, not behind it',
			geo.panelAboveBar === true,
			JSON.stringify(geo)
		);
		// the voice buttons follow the piece: Contrapunctus VIII has three voices, I has four
		await page.evaluate(() => window.__c.seekPlace('c08', 5));
		await sleep(500);
		const v3 = await page.locator('.voices .voice').count();
		await page.evaluate(() => window.__c.seekPlace('c01', 5));
		await sleep(500);
		const v4 = await page.locator('.voices .voice').count();
		check(
			'the voice buttons follow the piece (3 voices in VIII, 4 in I)',
			v3 === 3 && v4 === 4,
			`${v3} ${v4}`
		);
		await page.getByTestId('goto').click();
		check('the Go to button opens the dialog', (await st(page)).panel === 'jump');
		await press(page, 'Escape');
		await page.getByTestId('score').click();
		await sleep(600);
		check(
			'the score button shows the score over the stage',
			(await page.locator('.score').count()) >= 1 &&
				(await page.getByTestId('score').getAttribute('aria-pressed')) === 'true'
		);
		await press(page, 'v');
		await sleep(600);
		check('V shows the spectrogram', (await page.locator('.spectro').count()) >= 1);
		await shot(page, 'score-spectro');
		await press(page, 'n');
		await press(page, 'v');
		check(
			'N and V hide them again',
			(await page.locator('.score, .spectro').count()) === 0 &&
				(await page.evaluate(() => window.__c.P().settings.score)) === false
		);
		await press(page, 'i');
		await sleep(700);
		const infoBox = await page.evaluate(() => {
			const b = document.querySelector('[data-panel=info] .body');
			const pn = document.querySelector('[data-panel=info]').getBoundingClientRect();
			const bar = document.querySelector('.bar').getBoundingClientRect();
			return {
				bottom: pn.bottom,
				barTop: bar.top,
				scrolls: b ? b.scrollHeight > b.clientHeight : null
			};
		});
		check(
			'what am I hearing ends above the toolbar',
			infoBox.bottom <= infoBox.barTop + 1,
			JSON.stringify(infoBox)
		);
		await page.evaluate(() => window.__c.P().resetSettings());
		await page.close();

		// ---- the system's reduced-motion setting is followed while the page is open (T7.5.1)
		page = await open('');
		const motion = () =>
			page.evaluate(() => ({
				stage: window.__player.stage.choices().reducedMotion,
				system: window.__c.P().systemReduced,
				calmClass: !!document.querySelector('.app.calm'),
				box: document.querySelector('[data-testid=fx-reduced]')?.checked ?? null,
				disabled: document.querySelector('[data-testid=fx-reduced]')?.disabled ?? null,
				bloom: window.__player.stage.e6Info().reducedMotion
			}));
		let mo = await motion();
		check(
			'motion is allowed to begin with',
			mo.stage === false && !mo.system && !mo.calmClass,
			JSON.stringify(mo)
		);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await waitFor(page, () => window.__c.P().systemReduced === true, null, 4000);
		await sleep(400);
		mo = await motion();
		check(
			'the system asking for less motion is followed at once: the stage, the interface and the setting',
			mo.stage === true && mo.system && mo.calmClass && mo.bloom,
			JSON.stringify(mo)
		);
		await press(page, 'e');
		await sleep(300);
		mo = await motion();
		check(
			'the calm box shows it and cannot be switched off',
			mo.box === true && mo.disabled === true,
			JSON.stringify(mo)
		);
		await press(page, 'Escape');
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await waitFor(page, () => window.__c.P().systemReduced === false, null, 4000);
		await sleep(400);
		mo = await motion();
		check(
			'and the other way: motion is back when the system allows it',
			mo.stage === false && !mo.system && !mo.calmClass,
			JSON.stringify(mo)
		);
		await page.evaluate(() => window.__c.P().resetSettings());
		await page.close();

		// ---- a phone
		const phone = await browser.newContext({
			viewport: { width: 390, height: 844 },
			hasTouch: true,
			isMobile: name !== 'firefox',
			deviceScaleFactor: 2
		});
		page = await open('?p=iii&bar=3', { context: phone, begin: false });
		await shot(page, 'phone-start');
		const touchDevice = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
		await touchBegin(page, { touch: true }); // a link to a bar plays by itself; a tap starts it where it does not
		await waitFor(page, () => window.__c.state().status === 'playing', null, 20000);
		const start = await page.evaluate(() => ({
			phone: window.__c.P().phone,
			level: window.__player.stage.governor.level,
			ambient: window.__player.stage.choices().ambient
		}));
		if (touchDevice) {
			check(
				'a phone starts at quality level 2, not at the top',
				start.phone && start.level >= 2,
				JSON.stringify(start)
			);
			check('and without the ambient layer', start.ambient === false, JSON.stringify(start));
			const on = await waitFor(
				page,
				() => window.__player.stage.choices().ambient === true,
				null,
				45000
			);
			check('the ambient layer comes on once the frames hold their rate', !!on);
		} else
			console.log(
				'  (this engine does not report a coarse pointer for the phone window: the phone start was not checked)'
			);
		await sleep(1500);
		await shot(page, 'phone-playing');
		const fit = await page.evaluate(() => {
			const w = window.innerWidth;
			const bad = [
				...document.querySelectorAll('.chrome button, .chrome input, .chrome [role=slider]')
			]
				.map((el) => ({ r: el.getBoundingClientRect(), el }))
				.filter(({ r }) => r.width > 0 && (r.right > w + 1 || r.left < -1))
				.map(({ el }) => el.getAttribute('aria-label') ?? el.className);
			const small = [...document.querySelectorAll('.chrome button')]
				.map((el) => el.getBoundingClientRect())
				.filter((r) => r.width > 0 && (r.width < 43 || r.height < 43)).length;
			return { overflowX: document.documentElement.scrollWidth > w + 1, bad, small };
		});
		check(
			'phone: nothing sticks out of the screen',
			!fit.overflowX && fit.bad.length === 0,
			JSON.stringify(fit)
		);
		check('phone: every button is at least 44 px', fit.small === 0, String(fit.small));
		await page.touchscreen.tap(100, 300);
		await sleep(100);
		await page.touchscreen.tap(100, 300);
		await sleep(400);
		const afterTap = await st(page);
		check('phone: double tap on the left goes back 10 s', afterTap.status !== 'error');
		await page.close();
		await phone.close();

		// ---- credits
		page = await ctx.newPage();
		watch(page);
		await page.goto(`${URL_BASE}/credits`, { waitUntil: 'load' });
		const credits = await page.locator('main').innerText();
		check(
			'credits: the performer, the score licence, the libraries and the preset authors',
			/Marta Czech/.test(credits) &&
				/CC BY-NC-SA/.test(credits) &&
				/butterchurn/.test(credits) &&
				/Rovastar/.test(credits) &&
				/martin/i.test(credits)
		);
		await page.screenshot({ path: resolve(SHOTS, `player-credits-${name}.png`) });
		await page.close();

		check(
			'no errors in the page',
			errors.filter((e) => !/favicon/.test(e)).length === 0,
			JSON.stringify([...new Set(errors)].slice(0, 4))
		);
		out.ok = out.checks.every((c) => c.ok);
	} catch (e) {
		out.notes.push(`crashed: ${e.stack ?? e}`);
		console.error(`  CRASH [${name}] ${e.stack ?? e}`);
	} finally {
		await Promise.race([browser.close(), sleep(5000)]); // a closing browser with a GL context can hang
	}
	return out;
}

const results = [];
for (const name of ENGINES) {
	console.log(`== ${name}`);
	results.push(await run(name));
}
console.log(JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(
	results
		.map(
			(r) =>
				`${r.engine}: ${r.checks.filter((c) => c.ok).length}/${r.checks.length} ${r.ok ? 'ok' : 'FAILED'}`
		)
		.join('   ')
);
process.exit(failed.length ? 1 : 0);
