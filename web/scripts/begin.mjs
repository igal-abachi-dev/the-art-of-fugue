// What the browser checks do where they used to press the "Begin" button.
//
// The welcome has no button now: the title shows for about 1.3 s, then the music begins by itself (where the browser lets a page
// play without being touched: these checks launch with the autoplay switches on). A click, a tap or a key anywhere starts it at
// once, which is the shortest way to the same place, so `begin()` waits for the player and touches it, unless it has begun
// already (a link to a bar skips the welcome and plays at once).
//
//   import { begin } from './begin.mjs';
//   await begin(page);                      // a mouse click
//   await begin(page, { touch: true });     // a tap

/** Wait for the player to exist and start the music with a touch unless it has begun and is playing. */
export async function begin(page, { touch = false, timeout = 30000 } = {}) {
	await page.waitForFunction(() => window.__player?.player, null, { timeout });
	const needed = await page.evaluate(() => {
		const p = window.__player.player;
		return !p.begun || p.waiting;
	});
	if (!needed) return false;
	// the corner of the page: not a link, not a control
	if (touch) await page.touchscreen.tap(8, 8);
	else await page.mouse.click(8, 8);
	return true;
}
