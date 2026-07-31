/**
 * Random helpers for the sim. `pick` exists because
 * `list[Math.floor(Math.random() * list.length)]` is `T | undefined` to the
 * compiler on every one of its ~24 call sites — this narrows it once, here,
 * with a real check instead of an assertion at each site.
 */

/** Random element of a non-empty list. */
export function pick<T>(list: readonly T[]): T {
	const value = list[Math.floor(Math.random() * list.length)];
	if (value === undefined) throw new Error('pick() called on an empty list');
	return value;
}

/** Random element, or undefined when the list is empty. */
export function pickOr<T>(list: readonly T[], fallback: T): T {
	return list.length ? pick(list) : fallback;
}

/** Same, but from a seeded generator — sims must look identical every run. */
export function pickWith<T>(list: readonly T[], rng: () => number): T {
	const value = list[Math.floor(rng() * list.length)];
	if (value === undefined) throw new Error('pickWith() called on an empty list');
	return value;
}

/**
 * Element at `i`, wrapped into range — for cycling palettes and outfits.
 * ArrayLike, so typed arrays (Float32Array & co) work too.
 */
export function at<T>(list: ArrayLike<T>, i: number): T {
	const value = list[((i % list.length) + list.length) % list.length];
	if (value === undefined) throw new Error('at() called on an empty list');
	return value;
}
