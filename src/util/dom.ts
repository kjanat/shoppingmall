/**
 * DOM helpers for the sim. Both exist for the same reason as `pick` in
 * `rand.ts`: the browser types are honest about returning null, the mall
 * never is, and that gap was closed with an assertion at ~140 call sites.
 */

/** Element for a selector that must match, with a name in the error when it doesn't. */
export function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
	const el = root.querySelector<T>(sel);
	if (!el) throw new Error(`no element matches ${sel}`);
	return el;
}

/**
 * The 2D context of a canvas, for the label and sign textures. `getContext`
 * only refuses when the canvas already handed one out of another kind, which
 * the freshly created ones here never have.
 */
export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas has no 2d context');
	return ctx;
}

/**
 * Whether a key event landed in something the player is typing into, so the
 * global shortcuts can stand down and let the character through.
 *
 * `instanceof` rather than reading `tagName` off the event target: the target is
 * an EventTarget, the two copies of this both reached past that with a type
 * assertion, and this narrows it for real. Only an HTMLElement can be an input,
 * a textarea or contenteditable, so nothing that used to match stops matching.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
