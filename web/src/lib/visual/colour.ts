/** Colour maths for the palette checks (T4.2.3): sRGB hex, CIE Lab distance, and colour-vision-deficiency simulation. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB. */
export const CVD = {
	normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
	protanopia: [
		0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998
	],
	deuteranopia: [
		0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881
	],
	tritanopia: [
		1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039
	]
} as const;

export type Vision = keyof typeof CVD;

export function simulate(rgb: RGB, vision: Vision): RGB {
	const m = CVD[vision];
	const l = rgb.map(toLinear);
	const out = [0, 1, 2].map((i) => m[i * 3] * l[0] + m[i * 3 + 1] * l[1] + m[i * 3 + 2] * l[2]);
	return out.map((v) => toSrgb(Math.min(1, Math.max(0, v)))) as RGB;
}

export function toLab(rgb: RGB): [number, number, number] {
	const [r, g, b] = rgb.map(toLinear);
	// D65
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference; around 2 is just noticeable, above 20 is clearly different. */
export function deltaE(a: RGB, b: RGB): number {
	const p = toLab(a);
	const q = toLab(b);
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** WCAG relative luminance contrast ratio between two colours. */
export function contrast(a: RGB, b: RGB): number {
	const lum = (c: RGB) => {
		const [r, g, bl] = c.map(toLinear);
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
	};
	const la = lum(a);
	const lb = lum(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
