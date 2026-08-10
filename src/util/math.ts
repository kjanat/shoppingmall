/** Converts a full dimension into the half-extent used by centered geometry. */
export function half(value: number): number {
	return value / 2;
}

export function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(half(sorted.length))] ?? 0;
}

export function midpoint(a: number, b: number): number {
	return (a + b) / 2;
}

export function span(min: number, max: number): number {
	return max - min;
}

/** The weighted form THREE.MathUtils.lerp itself uses, so the calls the rekenhulpen check moved here return the same bits. */
export function lerp(start: number, end: number, t: number): number {
	return (1 - t) * start + t * end;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
	return clamp(value, 0, 1);
}

export function inverseLerpClamped(start: number, end: number, value: number): number {
	if (start === end) return 0;
	return clamp01((value - start) / (end - start));
}

/**
 * The blend factor of a frame-rate independent ease: how far toward its target a
 * value travels in `dt` at `rate` per second, clamped so a long frame stops at
 * the target instead of shooting past it.
 *
 * It carries the clamp so `Math.min(1, …)` stops meaning two things. That
 * expression is an ease factor at 38 sites and a plain clamp01 at 14 others, and
 * nothing in the text told them apart.
 *
 * IEEE 754 multiplication commutes exactly, so the sites that wrote `dt * rate`
 * get the same bits back as the ones that wrote `rate * dt`.
 */
export function easeFactor(rate: number, dt: number): number {
	return Math.min(1, rate * dt);
}

/**
 * One frame of easing `current` toward `target` at `rate` per second.
 *
 * Built on lerp, so every site spelled `lerp(v, target, Math.min(1, rate * dt))`
 * returns exactly the doubles it returned before.
 *
 * The additive spelling `v += (target - v) * Math.min(1, rate * dt)` is a
 * different calculation and must not be routed through here: with rate 2.5 and
 * dt 0.02, easing 0.35 toward 0.9 gives 0.37749999999999995 weighted and 0.3775
 * additive. Those sites keep their own expression and take only the factor from
 * easeFactor.
 */
export function ease(current: number, target: number, rate: number, dt: number): number {
	return lerp(current, target, easeFactor(rate, dt));
}

/**
 * The turn from `from` to `to` folded into (-π, π], so a heading that crosses
 * the seam turns the short way round instead of unwinding a whole circle.
 */
export function shortestAngle(from: number, to: number): number {
	let delta = to - from;
	while (delta > Math.PI) delta -= Math.PI * 2;
	while (delta < -Math.PI) delta += Math.PI * 2;
	return delta;
}
