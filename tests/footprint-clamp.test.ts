import { describe, expect, test } from 'bun:test';
import { MALL_FOOTPRINT } from '#/data/layout';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { CITY_BOUNDS, CITY_GROUND_Y, outsideMallFootprint } from '#/scene/city/cityPlan';
import { half } from '#/util/math';
import { read } from './helpers/source-scan.ts';
import { nr, world } from './helpers/world.ts';

/**
 * The clamp that keeps a body inside the mall, and the exemption that lets it out.
 *
 * `resolveCircle` ends by clamping x and z into the mall footprint unless the caller says the
 * body is outdoors, and that flag is derived from the body's feet height alone. So the clamp
 * is a teleport waiting for a caller with a stale height: dismounting out in the city while
 * the feet are still at the height of the ride throws you tens of metres into the building.
 * That is what #9 and #11 were, twice.
 *
 * Being pushed out of a tower is not that, so the clamp is isolated instead of guessed at:
 * every column is resolved twice, once with the exemption its own ground gives and once with
 * the exemption forced on. Where those two answers differ, the footprint clamp moved the body,
 * and nothing else did.
 */

/**
 * A metre, where the other sweeps in this suite step half. The clamp is not a property of a
 * spot but of two rectangles, the mall footprint and the trench that is exempt from it, and
 * both are metres across in every direction, so there is no sub-metre island for a coarser
 * lattice to miss. The control below keeps that honest by requiring the sweep to have reached
 * ground the exemption does not cover; a finer step over the whole city costs four times as
 * much and finds the same two rectangles.
 */
const GRID = 1;

const halfWidth = half(MALL_FOOTPRINT.width);
const halfDepth = half(MALL_FOOTPRINT.depth);

type Yank = { x: number; z: number; ground: number; distance: number; to: string };

function clampedOutdoors(): { yanks: Yank[]; sampled: number; lowestGround: number } {
	const yanks: Yank[] = [];
	let sampled = 0;
	let lowestGround = Number.POSITIVE_INFINITY;
	for (let x = CITY_BOUNDS.minX; x <= CITY_BOUNDS.maxX; x += GRID) {
		for (let z = CITY_BOUNDS.minZ; z <= CITY_BOUNDS.maxZ; z += GRID) {
			if (Math.abs(x) <= halfWidth && Math.abs(z) <= halfDepth) continue;
			const ground = world.groundHeightAt(x, z, CITY_GROUND_Y, WALK_STEP);
			sampled++;
			lowestGround = Math.min(lowestGround, ground);
			const y = ground + 1;
			const asRead = world.resolveCircle(x, z, y, PLAYER_RADIUS, 3, true, false, outsideMallFootprint(ground));
			const exempt = world.resolveCircle(x, z, y, PLAYER_RADIUS, 3, true, false, true);
			const distance = Math.hypot(asRead.x - exempt.x, asRead.z - exempt.z);
			if (distance <= 1e-6) continue;
			yanks.push({ x, z, ground, distance, to: `(${nr(asRead.x)}, ${nr(asRead.z)})` });
		}
	}
	return { yanks, sampled, lowestGround };
}

const SWEEP = clampedOutdoors();

describe('a body outdoors stays outdoors', () => {
	test('the sweep covers the city', () => {
		expect(SWEEP.sampled, 'no outdoor column sampled at all').toBeGreaterThan(1000);
	});

	test('the sweep reaches ground the exemption does not cover', () => {
		// Without such a column the comparison above can only ever agree, and the test passes
		// by never touching the clamp.
		expect(
			outsideMallFootprint(SWEEP.lowestGround),
			`the lowest outdoor ground is ${nr(SWEEP.lowestGround)}, which the exemption already covers`,
		).toBeFalse();
	});

	test('the footprint clamp never moves a body standing outdoors', () => {
		const worst = SWEEP.yanks.toSorted((a, b) => b.distance - a.distance)[0];
		const message = worst
			? `${SWEEP.yanks.length} outdoor columns are clamped, worst ${nr(worst.distance)} m from (${nr(worst.x)}, ${nr(worst.z)}) with ground ${nr(worst.ground)} to ${worst.to}`
			: '';
		expect(SWEEP.yanks, message).toBeEmpty();
	});
});

/**
 * The clamp logs itself when it moves a body more than two metres. That instrumentation was
 * added to diagnose #11 and says in its own comment that it goes once the diagnosis is done.
 */
test('the dismount instrumentation is gone once its bug is', async () => {
	const source = await read('src/physics/Collision.ts');
	expect(source.includes('INSTRUMENTATIE'), 'the #11 diagnosis warning still ships in resolveCircle').toBeFalse();
});
