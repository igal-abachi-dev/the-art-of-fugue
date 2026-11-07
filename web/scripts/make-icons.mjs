// The icons of the site:  node scripts/make-icons.mjs
//
// It writes, from Bach's seal (src/lib/player/seal-paths.svg: the public-domain vector "Bachsiegel.svg" of Wikimedia Commons, the seal
// Johann Sebastian Bach used, a crown over the interlaced monogram of his initials) and the word BACH:
//
// static/logo.svg                                        the card: gold seal and BACH on brown cloth
// static/favicon.svg                                     the same without the name, the seal larger (the name cannot be read at tab size)
// static/icons/icon-32.png, icon-192.png, icon-512.png   the rounded card on a transparent ground (tabs, the web manifest)
// static/icons/apple-touch-icon.png (180)                full bleed with no rounded corners (iOS rounds them itself)
// static/icons/maskable-512.png                          full bleed with the mark inside the central 80 % (Android masks it)
// static/favicon.ico                                     16, 32 and 48 px in one file, for browsers that ask for /favicon.ico
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const seal = readFileSync(resolve('src/lib/player/seal-paths.svg'), 'utf8');

/** the card; `named` puts BACH under the seal, otherwise the seal is larger */
function card(named) {
	// the seal is 594.65 by 793.43 in its own units, from (-0.77, -327.08)
	const s = named ? 0.4 : 0.52;
	const x = (512 - 594.65 * s) / 2;
	const y = named ? 52 : 50;
	const name = named
		? `<g transform="translate(8 0)" fill="none" stroke="url(#gold)" stroke-width="10" stroke-linejoin="miter">
    <path d="M140 422 V470 M140 422 H162 C186 422 186 444 162 444 H140 M162 444 C190 444 190 470 162 470 H140"/>
    <path d="M200 470 L222 420 L244 470 M208 454 H236"/>
    <path d="M298 428 C270 414 258 434 258 446 C258 462 272 478 298 464"/>
    <path d="M316 422 V470 M356 422 V470 M316 446 H356"/>
  </g>`
		: '';
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <title>The Art of Fugue</title>
  <defs>
    <radialGradient id="cloth" cx="50%" cy="40%" r="80%">
      <stop offset="0" stop-color="#82502d"/>
      <stop offset="0.6" stop-color="#5c3319"/>
      <stop offset="1" stop-color="#2c160a"/>
    </radialGradient>
    <linearGradient id="gold" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#fff1ae"/>
      <stop offset="0.35" stop-color="#e8c25a"/>
      <stop offset="0.65" stop-color="#b9861f"/>
      <stop offset="1" stop-color="#ecc653"/>
    </linearGradient>
    <linearGradient id="sealgold" gradientUnits="userSpaceOnUse" x1="60" y1="-327" x2="540" y2="466">
      <stop offset="0" stop-color="#fff1ae"/>
      <stop offset="0.3" stop-color="#e8c25a"/>
      <stop offset="0.62" stop-color="#b9861f"/>
      <stop offset="1" stop-color="#efca58"/>
    </linearGradient>
    <filter id="weave" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.6 0.9" numOctaves="2" seed="3" result="n"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.22 0" in="n"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="104" fill="url(#cloth)"/>
  <rect width="512" height="512" rx="104" filter="url(#weave)"/>
  <rect x="20" y="20" width="472" height="472" rx="88" fill="none" stroke="url(#gold)" stroke-width="5" opacity="0.9"/>
  <g transform="translate(${x.toFixed(1)} ${y}) scale(${s}) translate(0.77 327.08)" fill="url(#sealgold)" stroke="#4a2a0e" stroke-width="2.2" stroke-linejoin="round">
${seal}</g>
  ${name}
</svg>
`;
}

const logo = card(true);
const small = card(false);
writeFileSync(resolve('static/logo.svg'), logo);
writeFileSync(resolve('static/favicon.svg'), small);

const page = await (await (await chromium.launch({ channel: 'msedge' })).newContext()).newPage();
// the full-bleed variant: the same drawing without the rounded corners of the card
const bleed = (svg) => svg.replaceAll('rx="104"', 'rx="0"');

async function png(markup, size, file, { inset = 0, transparent = true } = {}) {
	const inner = inset ? `<div style="position:absolute;inset:${inset}px">${markup}</div>` : markup;
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0;background:${transparent ? 'transparent' : '#2a140a'}}svg{width:100%;height:100%;display:block}</style>${inner}`
	);
	writeFileSync(resolve(file), await page.screenshot({ omitBackground: transparent }));
}
await png(small, 32, 'static/icons/icon-32.png');
await png(logo, 192, 'static/icons/icon-192.png');
await png(logo, 512, 'static/icons/icon-512.png');
await png(bleed(logo), 180, 'static/icons/apple-touch-icon.png', { transparent: false });
await png(bleed(logo), 512, 'static/icons/maskable-512.png', { transparent: false, inset: 51 });

// the .ico: PNG images in an ICO container (16, 32, 48)
const sizes = [16, 32, 48];
const images = [];
for (const s of sizes) {
	await page.setViewportSize({ width: s, height: s });
	await page.setContent(
		`<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>${small}`
	);
	images.push(await page.screenshot({ omitBackground: true }));
}
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
	const e = 6 + 16 * i;
	head[e] = s;
	head[e + 1] = s;
	head.writeUInt16LE(1, e + 4);
	head.writeUInt16LE(32, e + 6);
	head.writeUInt32LE(images[i].length, e + 8);
	head.writeUInt32LE(offset, e + 12);
	offset += images[i].length;
});
writeFileSync(resolve('static/favicon.ico'), Buffer.concat([head, ...images]));
await page.context().browser().close();
console.log('icons written');
