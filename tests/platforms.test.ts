import { describe, expect, test } from 'bun:test';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * Stand on a platform deck and that deck is the floor, with nothing pushing you off it.
 *
 * A platform is a low deck whose top face you walk on, so the two questions a body asks
 * there are what it stands on and whether it may stand there. Both are asked over the
 * whole deck: a platform that only answers in the middle is one you slide off the edge of.
 */

/** Sweep spacing over a deck; a body is 0.64 m across, so nothing body-sized hides between samples. */
const STEP = 0.25;
/** Start just inside the edge: exactly on the boundary the deck itself is ambiguous. */
const INSET = 0.05;

type Sweep = { wrongFloor: { x: number; z: number; ground: number }[]; pushedOff: { x: number; z: number }[] };

function sweep(index: number): Sweep {
	const platform = world.platforms[index];
	if (!platform) throw new Error(`no platform ${index}`);
	const wrongFloor: { x: number; z: number; ground: number }[] = [];
	const pushedOff: { x: number; z: number }[] = [];
	for (let x = platform.minX + INSET; x <= platform.maxX; x += STEP) {
		for (let z = platform.minZ + INSET; z <= platform.maxZ; z += STEP) {
			if (!world.platformCovers(platform, x, z)) continue;
			const ground = world.groundHeightAt(x, z, platform.y, WALK_STEP);
			if (Math.abs(ground - platform.y) > EPS) {
				wrongFloor.push({ x, z, ground });
				continue;
			}
			const solved = world.resolveCircle(x, z, platform.y, PLAYER_RADIUS, 3, true, false);
			if (Math.hypot(solved.x - x, solved.z - z) > EPS) pushedOff.push({ x, z });
		}
	}
	return { wrongFloor, pushedOff };
}

describe.each(world.platforms.map((platform, index) => [platform.label, index] as const))('platform %s', (label, index) => {
	const platform = world.platforms[index];
	const result = sweep(index);

	test('is the floor everywhere it covers', () => {
		const first = result.wrongFloor[0];
		const message = first
			? `at (${nr(first.x)}, ${nr(first.z)}) the floor is ${nr(first.ground)} instead of the deck ${nr(platform?.y ?? 0)}`
			: '';
		expect(result.wrongFloor, message).toBeEmpty();
	});

	test('lets a body stand anywhere on it', () => {
		const first = result.pushedOff[0];
		const message = first ? `at (${nr(first.x)}, ${nr(first.z)}) ${label} pushes you off your own deck` : '';
		expect(result.pushedOff, message).toBeEmpty();
	});
});
