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
