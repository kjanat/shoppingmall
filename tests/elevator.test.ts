import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import { ELEVATOR_SHAFT_WALLS, ELEVATOR_SPEC } from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { half } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';
import { EPS } from './helpers/world.ts';

/** The lift hands out its own colliders rather than joining the shared world, so it gets its own. */

stubDocument();
const { Scene } = await import('three');
const [{ GlassElevator }, { LightPool }] = await Promise.all([import('#/scene/GlassElevator'), import('#/render/LightPool')]);

const lift = new GlassElevator(new LightPool(new Scene()));
const shaft = new CollisionWorld();
for (const collider of lift.getColliders()) {
	shaft.addBox(collider.minX, collider.maxX, collider.minZ, collider.maxZ, {
		minY: collider.minY,
		maxY: collider.maxY,
		label: collider.label,
		climbable: collider.climbable,
	});
}

const EYE = levelY('v0') + 1;
/** Just inside the cabin's south face: the side left open for the sims to walk through. */
const DOOR_Z = ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth) - 0.1;

/** `forPlayer` picks which gates apply; a sim passes what the player is held back by. */
function pushedAway(x: number, z: number, forPlayer: boolean): number {
	const solved = shaft.resolveCircle(x, z, EYE, PLAYER_RADIUS, 3, forPlayer);
	return Math.hypot(solved.x - x, solved.z - z);
}

describe('the shaft glass', () => {
	test.each(ELEVATOR_SHAFT_WALLS.map((wall) => wall.id))('%s stops the player', (id) => {
		const wall = ELEVATOR_SHAFT_WALLS.find((candidate) => candidate.id === id);
		if (!wall) throw new Error(`no shaft wall ${id}`);
		expect(pushedAway(wall.center.x, wall.center.z, true), 'the player walks through this glass shaft wall').toBeGreaterThan(EPS);
	});
});

describe('the cabin', () => {
	test('leaves the player standing in the middle', () => {
		expect(
			pushedAway(ELEVATOR_SPEC.center.x, ELEVATOR_SPEC.center.z, true),
			'the sim gate pushes the player out of the middle of the cabin',
		).toBeLessThanOrEqual(EPS);
	});

	test('keeps a sim out through the open south side', () => {
		expect(
			pushedAway(ELEVATOR_SPEC.center.x, DOOR_Z, false),
			'a sim walks into the shaft past the open south side',
		).toBeGreaterThan(EPS);
	});

	test('lets a passenger step out while the doors are open', () => {
		const exitZ = ELEVATOR_SPEC.center.z + ELEVATOR_SPEC.cabin.depth;
		const solved = lift.resolvePassenger(ELEVATOR_SPEC.center.x, exitZ, PLAYER_RADIUS);
		expect(solved.z, 'the open lift door holds a passenger who is stepping out').toBeCloseTo(exitZ, 6);
	});
});

describe('the moving cabin', () => {
	test('can be sent on its way empty', () => {
		lift.update(3);
		expect(lift.isMoving, 'the test could not get the empty lift moving').toBeTrue();
	});

	test('holds the passenger behind glass and doors', () => {
		const solved = lift.resolvePassenger(ELEVATOR_SPEC.center.x + 10, ELEVATOR_SPEC.center.z + 10, PLAYER_RADIUS);
		expect(solved.x, 'the closed moving cabin lets the passenger out sideways').toBeLessThan(
			ELEVATOR_SPEC.center.x + half(ELEVATOR_SPEC.cabin.width),
		);
		expect(solved.z, 'the closed moving cabin lets the passenger out through the doors').toBeLessThan(
			ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth),
		);
	});
});
