import { describe, expect, test } from 'bun:test';
import { postureHeadroom } from '#/data/character';
import { MALL_FOOTPRINT } from '#/data/layout';
import { LEVELS, levelY } from '#/data/levels';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { half } from '#/util/math';
import { nr, world } from './helpers/world.ts';

/**
 * Wherever a body may stand, it may stand upright.
 *
 * The crouch tests measure the flights and the parking ramp, because those are the runs a
 * route is planned over. This asks the same of every square metre a body can actually reach:
 * a low soffit over open floor is a spot where the player silently drops to his knees, and
 * nothing else in the build would notice.
 *
 * Standable means two things at once. The deck is the floor there (so the sample is not in a
 * stairwell or over the void), and collision leaves a body where it is put (so the sample is
 * not inside a wall, where the headroom over the masonry says nothing).
 */

const GRID = 0.5;
const NEEDED = postureHeadroom('standing');

test('the grid is finer than the body it is looking for room for', () => {
	// A lattice of step s has a point inside every axis-aligned region of side s or more, and a
	// body cannot stand anywhere narrower than its own width, so this is what makes the sweep
	// exhaustive rather than a spot check.
	expect(GRID, 'a standable spot could fall between two samples').toBeLessThan(2 * PLAYER_RADIUS);
});

interface Tight {
	count: number;
	free: number;
	x: number;
	z: number;
	standable: number;
}

function sweep(deck: number, outdoors: boolean): Tight {
	const halfWidth = half(MALL_FOOTPRINT.width);
	const halfDepth = half(MALL_FOOTPRINT.depth);
	const worst: Tight = { count: 0, free: Number.POSITIVE_INFINITY, x: 0, z: 0, standable: 0 };
	for (let x = -halfWidth; x <= halfWidth; x += GRID) {
		for (let z = -halfDepth; z <= halfDepth; z += GRID) {
			if (Math.abs(world.groundHeightAt(x, z, deck + 0.05, WALK_STEP) - deck) > 1e-6) continue;
			const solved = world.resolveCircle(x, z, deck, PLAYER_RADIUS, 3, true, false, outdoors);
			if (Math.hypot(solved.x - x, solved.z - z) > 1e-4) continue;
			worst.standable++;
			const free = world.headroomAt(x, z, deck);
			if (free >= NEEDED) continue;
			worst.count++;
			if (free < worst.free) {
				worst.free = free;
				worst.x = x;
				worst.z = z;
			}
		}
	}
	return worst;
}

describe.each(LEVELS.map((level) => level.id))('%s', (id) => {
	const deck = levelY(id);
	const tight = sweep(deck, deck >= 0);

	test('has floor a body can stand on at all', () => {
		expect(tight.standable, 'no standable sample on this deck, so the headroom question is never asked').toBeGreaterThan(0);
	});

	test('offers standing headroom everywhere a body can stand', () => {
		expect(
			tight.count,
			`${tight.count} of ${tight.standable} standable points are too low, worst ${nr(tight.free)} m at (${nr(tight.x)}, ${nr(tight.z)}) against the ${nr(NEEDED)} m standing asks`,
		).toBe(0);
	});
});
