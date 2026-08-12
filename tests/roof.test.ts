import { describe, expect, test } from 'bun:test';
import { ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { planBounds } from '#/data/spatial';
import { ENTRANCE_PORTAL, SLAB_SPEC_BY_LEVEL } from '#/data/world';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { CITY_GROUND_Y } from '#/scene/city/cityPlan';
import { inPool } from '#/scene/RoofIsland';
import { half, midpoint } from '#/util/math';
import { walkAlongAxis } from './helpers/walk.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * The roof: what carries you on it, what does not, and the way back down and inside.
 */

const V1 = levelY('v1');
const ROOF = levelY('roof');
/** One frame of climbing, and one step past the roof edge. */
const STEP = 0.05;
const OFF_THE_EDGE = 1;

/**
 * The ramps file walks the ladder's line; this climbs it the way a body does, where every
 * step starts from the height the last one ended at. It broke once by handing back the roof
 * halfway up, and then you simply stop climbing.
 */
test('the slide ladder carries a climber from the roof onto the platform', () => {
	const ladder = world.ramps.find((ramp) => ramp.label === 'slide_ladder');
	expect(ladder, "no ramp 'slide_ladder' in the collision world").toBeDefined();
	if (!ladder) return;
	const x = midpoint(ladder.minX, ladder.maxX);
	const steps = Math.max(1, Math.ceil(Math.abs(ladder.zTop - ladder.zBottom) / STEP));
	let y = ladder.yBottom;
	const slips: string[] = [];
	for (let i = 0; i <= steps; i++) {
		const z = ladder.zBottom + ((ladder.zTop - ladder.zBottom) * i) / steps;
		const ground = world.groundHeightAt(x, z, y, WALK_STEP);
		if (ground + EPS < y) {
			slips.push(`at z ${nr(z)} the climber drops from ${nr(y)} to ${nr(ground)}`);
			break;
		}
		y = ground;
	}
	expect(slips, slips.join('\n')).toBeEmpty();
	expect(y, 'the climb ends short of the platform').toBeCloseTo(ladder.yTop, 3);
});

/**
 * Over the atrium lies the glass roof and you walk on it. One deck down the same hole is a
 * hole and you are meant to be pushed out of it; the void eject had no upper bound and shoved
 * you off the roof instead.
 */
describe('the glass roof over the atrium', () => {
	const GRID = 0.4;
	const minX = -half(ATRIUM_VOID.width);
	const maxX = half(ATRIUM_VOID.width);
	const minZ = -half(ATRIUM_VOID.depth);
	const maxZ = half(ATRIUM_VOID.depth);
	const noFloor: string[] = [];
	const pushed: string[] = [];
	const stuckOverTheVoid: string[] = [];

	for (let x = minX + 0.05; x <= maxX; x += GRID) {
		for (let z = minZ + 0.05; z <= maxZ; z += GRID) {
			const ground = world.groundHeightAt(x, z, ROOF, WALK_STEP);
			if (Math.abs(ground - ROOF) > EPS) noFloor.push(`(${nr(x)}, ${nr(z)}) answers ${nr(ground)} instead of ${nr(ROOF)}`);
			const onTheRoof = world.resolveCircle(x, z, ROOF, PLAYER_RADIUS, 3, true, false);
			if (Math.hypot(onTheRoof.x - x, onTheRoof.z - z) > EPS) {
				pushed.push(`(${nr(x)}, ${nr(z)}) pushes you to (${nr(onTheRoof.x)}, ${nr(onTheRoof.z)})`);
			}
			const onV1 = world.resolveCircle(x, z, V1, PLAYER_RADIUS, 3, true, false);
			if (onV1.x > minX && onV1.x < maxX && onV1.z > minZ && onV1.z < maxZ) {
				stuckOverTheVoid.push(`(${nr(x)}, ${nr(z)}) leaves you standing over the hole`);
			}
		}
	}

	test('carries you everywhere over the void', () => {
		expect(noFloor, `${noFloor.length} grid points without floor · ${noFloor[0] ?? ''}`).toBeEmpty();
	});

	test('does not push you off itself', () => {
		expect(pushed, `${pushed.length} grid points push you away · ${pushed[0] ?? ''}`).toBeEmpty();
	});

	test('is a hole one deck down', () => {
		expect(
			stuckOverTheVoid,
			`${stuckOverTheVoid.length} grid points on V1 leave you over the void · ${stuckOverTheVoid[0] ?? ''}`,
		).toBeEmpty();
	});
});

/**
 * The walkable cover is the roof slab minus its own holes. Where it stopped short of the
 * facade you stood on bare slab that `groundHeightAt` did not carry, and sank through the
 * roof into the building. The pool falls out of it: there `poolFloorY` gives the bottom.
 */
describe('the roof deck', () => {
	const GRID = 0.5;
	const holes = SLAB_SPEC_BY_LEVEL.roof.holes.map((hole) => planBounds(hole));
	const edgeX = half(MALL_FOOTPRINT.width);
	const edgeZ = half(MALL_FOOTPRINT.depth);
	const solid = (x: number, z: number): boolean =>
		!holes.some((hole) => x > hole.minX && x < hole.maxX && z > hole.minZ && z < hole.maxZ);

	test('carries a walker on every solid point of the slab', () => {
		const sagging: string[] = [];
		for (let x = -edgeX; x <= edgeX && sagging.length === 0; x += GRID) {
			for (let z = -edgeZ; z <= edgeZ; z += GRID) {
				if (!solid(x, z) || inPool(x, z)) continue;
				const ground = world.groundHeightAt(x, z, ROOF, WALK_STEP);
				if (Math.abs(ground - ROOF) <= EPS) continue;
				sagging.push(`at (${nr(x)}, ${nr(z)}) the floor is ${nr(ground)} instead of the roof (${nr(ROOF)})`);
				break;
			}
		}
		expect(sagging, sagging.join('\n')).toBeEmpty();
	});

	test.each([
		[edgeX + GRID, 0],
		[-edgeX - GRID, 0],
		[0, edgeZ + GRID],
		[0, -edgeZ - GRID],
	])('just past the edge at (%d, %d) nothing carries you', (x, z) => {
		expect(
			Math.abs(world.groundHeightAt(x, z, ROOF, WALK_STEP) - ROOF) > EPS,
			'the floor still carries at roof height outside the roof',
		).toBeTrue();
	});

	/**
	 * The reported fall: at the edge the ground pulls you down and the sub-roof wall pushes
	 * you back in, and just below roof height the slab then has to keep carrying you instead
	 * of dropping you to V1. The margin is one body inside the facade, which is exactly where
	 * the wall pushes you, and the height is the dip the fall came out at.
	 */
	test.each([
		[edgeX - (PLAYER_RADIUS + GRID), 6.7],
		[edgeX - (PLAYER_RADIUS + GRID), -12],
		[-edgeX + (PLAYER_RADIUS + GRID), 15],
		[0, edgeZ - (PLAYER_RADIUS + GRID)],
		[0, -edgeZ + (PLAYER_RADIUS + GRID)],
	])('inside the edge at (%d, %d) a dip still lands on the roof', (x, z) => {
		expect(
			world.groundHeightAt(x, z, V1 + 3, WALK_STEP),
			'you sink through the roof into the building instead of staying on it',
		).toBeCloseTo(ROOF, 6);
	});
});

/**
 * Jumping off the roof already worked; what was missing was proof that the loop closes after
 * it. A comment claimed the parking exit was the only way back in, which stopped being true
 * the moment the main entrance existed, and no check walked it.
 */
describe('the loop off the roof and back inside', () => {
	const z = ENTRANCE_PORTAL.centerZ;
	const landingX = ENTRANCE_PORTAL.canopyX - OFF_THE_EDGE;

	test('the western roof edge carries you', () => {
		expect(world.groundHeightAt(-half(MALL_FOOTPRINT.width) + OFF_THE_EDGE, z, ROOF, WALK_STEP)).toBeCloseTo(ROOF, 6);
	});

	test('nothing at roof height pushes you back from over the edge', () => {
		const clamped = world.resolveCircle(landingX, z, ROOF, PLAYER_RADIUS, 3, true, true, true);
		expect(
			Math.hypot(clamped.x - landingX, clamped.z - z),
			'the shell pushes you back onto the roof, so there is no jump',
		).toBeLessThanOrEqual(EPS);
	});

	test('where you land there is street', () => {
		expect(world.groundHeightAt(landingX, z, CITY_GROUND_Y, WALK_STEP), 'the landing spot is not at street level').toBeCloseTo(
			CITY_GROUND_Y,
			6,
		);
	});

	test('from the landing spot you walk back into the atrium', () => {
		const back = walkAlongAxis(z, landingX, half(ATRIUM_VOID.width));
		expect(back.complaint ?? '').toBe('');
		expect(world.insideMallPlan(back.x, z), `the walk strands at x ${nr(back.x)} and does not get back inside`).toBeTrue();
	});
});
