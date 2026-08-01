import * as THREE from 'three';
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
 */
export function labelCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(w * SUPERSAMPLE);
	canvas.height = Math.ceil(h * SUPERSAMPLE);
	const ctx = ctx2d(canvas);
	ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
	return { canvas, ctx };
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

export type FitOptions = {
	/** Font stack and weight, without the size. */
	font?: string;
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
	const font = opts.font ?? '700 system-ui, sans-serif';
	const maxLines = opts.maxLines ?? 2;
	const lineHeight = opts.lineHeight ?? 1.15;
	const minSize = opts.minSize ?? 8;

	const words = text.split(/\s+/).filter(Boolean);
	let size = opts.size ?? box.h;

	let lines: string[] = [];
	while (size >= minSize) {
		ctx.font = `${size}px ${font}`;
		lines = wrap(ctx, words, box.w, maxLines);
		const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
		if (widest <= box.w && lines.length * size * lineHeight <= box.h) break;
		size -= 1;
	}

	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const step = size * lineHeight;
	const top = box.y + box.h / 2 - ((lines.length - 1) * step) / 2;
	lines.forEach((line, i) => {
		ctx.fillText(line, box.x + box.w / 2, top + i * step);
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
