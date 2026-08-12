import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import { poolFloorY } from '#/data/pool';
import { geometryBounds } from '#/data/spatial';
import { TIKI_BAR_SPEC, WORLD_ENTITIES } from '#/data/world';
import { WALK_STEP } from '#/physics/Collision';
import { inPool, POOL_CENTER, POOL_FLOOR_Y, POOL_WATER_Y, rimDistance } from '#/scene/RoofIsland';
import { half } from '#/util/math';
import { read } from './helpers/source-scan.ts';
import { stubDocument } from './helpers/stub-dom.ts';
import { nr, world } from './helpers/world.ts';

/**
 * The roof pool and the people in it.
 *
 * The cast is measured where it ends up rather than where it is authored. `waterSeat` pulls
 * every bather towards `POOL_CENTER` until it is far enough inside the waterline, so reading
 * the authored coordinates says nothing about where anyone lands; building the group with the
 * canvas stub costs a few milliseconds and answers the question directly.
 */

const ROOF = levelY('roof');

stubDocument();
const { PoolPeople, PARASOL_CANOPY_RADIUS, PARASOL_POSITION, RIM_CLEAR, CREW_CLEAR } = await import('#/scene/PoolPeople');
const CAST = new PoolPeople().group.children;

describe('the basin', () => {
	test('POOL_CENTER lies in the water', () => {
		expect(inPool(POOL_CENTER.x, POOL_CENTER.z), 'waterSeat pulls the bathers onto the tiles').toBeTrue();
	});

	test('POOL_CENTER has room for the widest bather', () => {
		// waterSeat's target has to satisfy the largest clearance any seat asks for, or the
		// helper has no valid point left to pull towards.
		expect(rimDistance(POOL_CENTER.x, POOL_CENTER.z), 'the middle of the pool is tighter than a swimmer needs').toBeGreaterThan(
			RIM_CLEAR,
		);
	});

	test('the bottom sits under the waterline', () => {
		expect(POOL_FLOOR_Y, `the bottom (${nr(POOL_FLOOR_Y)}) is not below the surface (${nr(POOL_WATER_Y)})`).toBeLessThan(
			POOL_WATER_Y,
		);
	});

	test('the bottom is the floor inside the basin', () => {
		const bottom = poolFloorY(POOL_CENTER.x, POOL_CENTER.z);
		expect(bottom, 'poolFloorY gives no bottom in the middle of the pool').not.toBeNull();
		expect(world.groundHeightAt(POOL_CENTER.x, POOL_CENTER.z, ROOF, WALK_STEP)).toBeCloseTo(bottom ?? 0, 3);
	});

	test('there is water on the bottom and none above the roof', () => {
		expect(world.waterDepthAt(POOL_CENTER.x, POOL_CENTER.z, POOL_FLOOR_Y), 'no water on the bottom of the pool').toBeGreaterThan(
			0,
		);
		expect(world.waterDepthAt(POOL_CENTER.x, POOL_CENTER.z, ROOF + 5), 'water reported well above the pool').toBe(0);
	});
});

/**
 * PoolPeople and RoofIsland each held their own surface height once, thirty centimetres
 * apart, and the swimmers waded through the deck. The waterline has one owner.
 */
test('PoolPeople derives the waterline instead of holding its own', async () => {
	const source = await read('src/scene/PoolPeople.ts');
	expect(/const WATER_Y = -?[\d.]+;/.test(source), 'PoolPeople has its own WATER_Y again').toBeFalse();
});

/**
 * Anything hanging this far under the surface is in the water rather than in a lounger: the
 * sunbathers sit below deck height too, so deck height cannot tell them apart.
 */
const BATHERS = CAST.filter((member) => member.position.y < POOL_WATER_Y - 0.75);

describe('the bathers', () => {
	test('the cast still has its four swimmers and two rim sitters', () => {
		expect(BATHERS.length, 'fewer bathers found than the cast has; are they in a subgroup now?').toBeGreaterThanOrEqual(6);
	});

	test.each(BATHERS.map((_, index) => index))('bather %s lies inside the waterline', (index) => {
		const bather = BATHERS[index];
		if (!bather) return;
		const { x, z } = bather.position;
		expect(inPool(x, z), `the bather at (${nr(x)}, ${nr(z)}) lies outside the waterline, on the tiles`).toBeTrue();
		expect(
			rimDistance(x, z),
			`the bather at (${nr(x)}, ${nr(z)}) hangs half over the tiles with ${nr(rimDistance(x, z))} m to the rim`,
		).toBeGreaterThanOrEqual(RIM_CLEAR);
	});
});

/**
 * The AL ZUT crewman stood waist-deep in the counter on a hand-typed -12.9, and the parasol
 * had done the same to the sign before him. Measuring the whole cast against the counter
 * makes it not matter where the next arrival comes from.
 */
describe('nobody stands in the tiki bar', () => {
	const counterVolume = WORLD_ENTITIES.find((entity) => entity.id === 'tiki-bar')?.volumes.find(
		(volume) => volume.id === 'counter',
	);

	test('the counter is still there to measure against', () => {
		expect(counterVolume, 'tiki-bar has no counter volume any more').toBeDefined();
	});

	test('no member of the cast stands in or against it', () => {
		if (!counterVolume) return;
		const counter = geometryBounds(counterVolume.geometry);
		const inside = CAST.filter(
			(member) =>
				member.position.x > counter.minX - CREW_CLEAR &&
				member.position.x < counter.maxX + CREW_CLEAR &&
				member.position.z > counter.minZ - CREW_CLEAR &&
				member.position.z < counter.maxZ + CREW_CLEAR,
		).map((member) => `a cast member at (${nr(member.position.x)}, ${nr(member.position.z)})`);
		expect(inside, inside.join('\n')).toBeEmpty();
	});
});

/**
 * The sign is read from the pool side. The canopy hung between the pool and the sign at the
 * same height and covered its right half, leaving "TIKI BA" and reed. It stands west of the
 * sign, so looking from the pool clears it only past the sign's own edge.
 */
test('the parasol canopy does not cover the tiki bar sign', () => {
	const signZ = TIKI_BAR_SPEC.center.z;
	const signEdge = half(TIKI_BAR_SPEC.sign.width);
	const signX = TIKI_BAR_SPEC.center.x + TIKI_BAR_SPEC.sign.offsetX;
	const covered = signEdge + PARASOL_CANOPY_RADIUS - Math.abs(PARASOL_POSITION.z - signZ);
	if (PARASOL_POSITION.x >= signX) return;
	expect(
		covered,
		`the canopy at z ${nr(PARASOL_POSITION.z)} stands in front of the sign (z ${nr(signZ - signEdge)}..${nr(signZ + signEdge)}) and hides ${nr(covered)} m of it`,
	).toBeLessThanOrEqual(0);
});
