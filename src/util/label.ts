import * as THREE from 'three';
import { half } from '#/util/math';
import { ctx2d } from './dom';

/**
 * Canvas text that stays sharp and stays inside its box.
 *
 * Two problems this solves. Label canvases were authored at the size they look
 * on screen from a few metres away, so walking up to one stretched every texel
 * and the text went to mush. And every one of them drew with a fixed font size
 * and no measuring, so a long line ran straight off both edges.
 */

/** Canvas pixels per design pixel. Draw code keeps using design units. */
const SUPERSAMPLE = 3;

/**
 * Set once from App with renderer.capabilities.getMaxAnisotropy(). Sprites are
 * read at a slant all the time, and that is what keeps them legible.
 */
let maxAnisotropy = 1;

export function setLabelAnisotropy(n: number): void {
	maxAnisotropy = Math.max(1, n);
}

/**
 * A canvas of `w` by `h` design units, backed by SUPERSAMPLE times as many
 * pixels, with the context already scaled. Everything you draw keeps using
 * `w` and `h`, so existing draw code does not change.
 *
 * `w` and `h` come back with it because `canvas.width` is now device pixels:
 * a paint routine that reads the size off the canvas would draw at triple
 * scale into a third of the box.
 */
export function labelCanvas(
	w: number,
	h: number,
): {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	w: number;
	h: number;
} {
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(w * SUPERSAMPLE);
	canvas.height = Math.ceil(h * SUPERSAMPLE);
	const ctx = ctx2d(canvas);
	ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
	return { canvas, ctx, w, h };
}

/** Clear a labelCanvas back to transparent, in design units. */
export function clearLabel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
	ctx.clearRect(0, 0, w, h);
}

export function labelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = maxAnisotropy;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = true;
	return tex;
}

/**
 * Twee vlakken rug aan rug, elk met zijn eigen voorkant naar buiten.
 *
 * `side: THREE.DoubleSide` op een tekstvlak toont de achterkant van diezelfde
 * textuur, en die staat gespiegeld: het taxidak las IXAT zodra je aan de andere kant
 * ging staan. Twee enkelzijdige vlakken delen hier één geometrie en één materiaal, en
 * de achterste staat een halve slag om, dus beide kanten lezen van links naar rechts.
 */
export function backToBackLabel(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Group {
	const group = new THREE.Group();
	const front = new THREE.Mesh(geometry, material);
	const back = new THREE.Mesh(geometry, material);
	back.rotation.y = Math.PI;
	group.add(front, back);
	return group;
}

// ── speech bubble: the tail hanging off the bottom edge, sideways as fractions of the canvas width ──
const TAIL_LEFT = 0.45;
const TAIL_TIP = 0.5;
const TAIL_RIGHT = 0.55;
/** Design pixels up from the bottom edge: where the tail leaves the bubble, and where its point sits. */
const TAIL_BASE_UP = 14;
const TAIL_TIP_UP = 2;

/**
 * Trace the tail of a speech bubble of `w` by `h` design units, closed and ready
 * to fill and stroke. The caller sets its own colours, so the tail matches the
 * bubble it hangs from.
 */
export function speechTail(ctx: CanvasRenderingContext2D, w: number, h: number): void {
	ctx.beginPath();
	ctx.moveTo(w * TAIL_LEFT, h - TAIL_BASE_UP);
	ctx.lineTo(w * TAIL_TIP, h - TAIL_TIP_UP);
	ctx.lineTo(w * TAIL_RIGHT, h - TAIL_BASE_UP);
	ctx.closePath();
}

/**
 * Trace a rounded rectangle, closed and ready to fill and stroke, like
 * speechTail above: the caller keeps its own colours.
 *
 * Traced with arcTo, and it opens its own path, so a caller that wants this
 * shape alongside another subpath has to draw them in separate passes. The
 * sites that call the native `ctx.roundRect` behind a feature test add a
 * subpath instead, and are a different helper's job.
 */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

export type FitOptions = {
	/** Family stack only. The weight is separate: CSS wants it before the size. */
	font?: string;
	weight?: string;
	/** Starting size in design pixels; shrinks from here. */
	size?: number;
	/** Never go below this, clip instead. */
	minSize?: number;
	/** Wrap across at most this many lines. */
	maxLines?: number;
	/** Line spacing as a multiple of the font size. */
	lineHeight?: number;
};

/**
 * Draw `text` centred in the box, wrapped and shrunk until it fits.
 *
 * Tries the largest size that works: wrap at word boundaries into at most
 * `maxLines`, and if the widest line still overflows or the block is too tall,
 * step the size down and try again. Returns the size it settled on so callers
 * can line other things up with it.
 */
export function fitText(
	ctx: CanvasRenderingContext2D,
	text: string,
	box: { x: number; y: number; w: number; h: number },
	opts: FitOptions = {},
): number {
	// Order matters: `58px 700 system-ui` is invalid and canvas silently falls
	// back to 10px sans-serif, which is how every label ended up microscopic.
	const family = opts.font ?? 'system-ui, sans-serif';
	const weight = opts.weight ?? '700';
	const maxLines = opts.maxLines ?? 2;
	const lineHeight = opts.lineHeight ?? 1.15;
	const minSize = opts.minSize ?? 8;

	const words = text.split(/\s+/).filter(Boolean);
	let size = opts.size ?? box.h;

	let lines: string[] = [];
	while (size >= minSize) {
		ctx.font = `${weight} ${size}px ${family}`;
		lines = wrap(ctx, words, box.w, maxLines);
		const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
		if (widest <= box.w && lines.length * size * lineHeight <= box.h) break;
		size -= 1;
	}

	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const step = size * lineHeight;
	const top = box.y + half(box.h) - half((lines.length - 1) * step);
	lines.forEach((line, i) => {
		ctx.fillText(line, box.x + half(box.w), top + i * step);
	});
	return size;
}

/**
 * Greedy word wrap, capped at `maxLines`. Anything past the cap is appended to
 * the last line: fitText shrinks until it fits, and a word longer than the box
 * on its own is better clipped than dropped.
 */
function wrap(ctx: CanvasRenderingContext2D, words: string[], maxW: number, maxLines: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (line && ctx.measureText(next).width > maxW && lines.length < maxLines - 1) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}
