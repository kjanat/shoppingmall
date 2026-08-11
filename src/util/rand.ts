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
 * Dezelfde elementen in willekeurige volgorde, als nieuwe lijst.
 *
 * Voor trekken zonder teruglegging: wie telkens opnieuw uniform kiest hoort een
 * handvol clips terugkomen terwijl de rest van de bank stil blijft.
 */
export function shuffled<T>(list: readonly T[], rng: () => number = Math.random): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const gekozen = at(out, j);
		out[j] = at(out, i);
		out[i] = gekozen;
	}
	return out;
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

/**
 * A random offset inside a band `spread` wide, centred on zero: scatter around
 * a position, a rotation or a velocity that already has its value.
 */
export function jitter(spread: number): number {
	return jitterWith(spread, Math.random);
}

/** Same, from a seeded generator — the city has to come back identical. */
export function jitterWith(spread: number, rng: () => number): number {
	return (rng() - 0.5) * spread;
}

/**
 * A random value between -extent and +extent: a coordinate inside bounds, or an
 * audio sample.
 *
 * The two forms are one calculation apart — `plusMinus(e)` and `jitter(2 * e)`
 * agreed on every one of 2 million draws across the spreads this scene uses,
 * because halving and doubling only move the exponent. They stay separate names
 * because the argument means a different thing: a half-width against a width,
 * and the call sites read as one or the other.
 */
export function plusMinus(extent: number): number {
	return plusMinusWith(extent, Math.random);
}

/** Same, from a seeded generator. */
export function plusMinusWith(extent: number, rng: () => number): number {
	return (rng() * 2 - 1) * extent;
}

/**
 * Deterministic RNG (mulberry32). Everything drawn from a seed must land in the
 * same place every reload, or the scene drifts away from the collision boxes
 * that were planned against it.
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
