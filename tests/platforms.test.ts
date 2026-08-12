import { describe, expect, test } from 'bun:test';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { EPS, nr, world } from './helpers/world.ts';

/** Half a body across, so nothing body-sized fits between two samples. */
const STEP = 0.25;
/** On the boundary itself a deck neither covers nor does not cover; start inside it. */
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
