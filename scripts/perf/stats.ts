import { half } from '#/util/math';

export function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(half(sorted.length))] ?? 0;
}
