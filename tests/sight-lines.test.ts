import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import { LINE_OF_SIGHT, PROJECTILE_PATH, SIGHT_BLOCKING_TAG } from '#/data/spatial';
import { ENTRANCE_PORTAL } from '#/data/world';
import { stubDocument } from './helpers/stub-dom.ts';
import { nr, world } from './helpers/world.ts';

/**
 * What a guard sees and where his bullet stops.
 *
 * Distance alone made a window of every facade. The first three cases are what went wrong and
 * what may not go wrong: not through the closed west facade, through the doorway in that same
 * facade yes, and across the atrium yes — because the barrier there is a box for walking bodies
 * and not a wall.
 *
 * All three run from an open point to an open point, and that is exactly where the bullet bug
 * sat: that step ended inside the masonry and so saw no box at all. The fourth and the fifth
 * therefore do not run along the wall but inside it, and the sixth falls through a deck.
 */

const V1 = levelY('v1');
const EYE = 1.6;
/** A slow frame: the longest step a bullet covers in one go, and so the hardest. */
const SLOWEST_FRAME = 30;
/** Enough starting positions to hit every phase of that step against the wall. */
const BULLET_SAMPLES = 400;
/** At chest height along the west facade, where the guards really do spray. */
const BULLET_HEIGHT = 1.35;

stubDocument();
const { BULLET_RADIUS, BULLET_SPEED } = await import('#/scene/SecurityGuards');

describe('what an eye can see', () => {
	test('not through the closed west facade', () => {
		const inside = { x: -30, y: EYE, z: 12 };
		const outside = { x: -45, y: EYE, z: 12 };
		expect(
			world.hasLineOfSight(inside, outside, LINE_OF_SIGHT),
			`from (${nr(inside.x)}, ${nr(inside.z)}) to (${nr(outside.x)}, ${nr(outside.z)}) you look straight through the facade`,
		).toBeFalse();
	});

	test('through the doorway in that same facade', () => {
		const inside = { x: -30, y: EYE, z: ENTRANCE_PORTAL.centerZ };
		const pavement = { x: -45, y: EYE, z: ENTRANCE_PORTAL.centerZ };
		expect(
			world.hasLineOfSight(inside, pavement, LINE_OF_SIGHT),
			`the entrance at z ${nr(ENTRANCE_PORTAL.centerZ)} lets no sight through while there is a doorway`,
		).toBeTrue();
	});

	/**
	 * The atrium barrier runs from 4.5 to 12 m and exists for walking bodies. If it stopped
	 * sight as well there would be a wall through the middle of the building.
	 */
	test('across the atrium at balcony height', () => {
		expect(
			world.hasLineOfSight({ x: -12, y: V1 + EYE, z: 0 }, { x: 12, y: V1 + EYE, z: 0 }, LINE_OF_SIGHT),
			'a collision box is read as a wall across the atrium',
		).toBeTrue();
	});

	/** Otherwise a guard pushed against a wall never sees anything again. */
	test('out of the wall a body is standing in', () => {
		expect(
			world.hasLineOfSight({ x: -36.3, y: EYE, z: 12 }, { x: -34, y: EYE, z: 12 }, LINE_OF_SIGHT),
			'standing with your back in the west facade you see nothing at all',
		).toBeTrue();
	});
});

/**
 * A bullet covers half a metre per frame and the west facade is one metre thick, so its step
 * ends inside the stone. For a look that is an exemption; for a bullet it is a hit. Without that
 * distinction the box was exempt on that frame, exempt on the next — the segment now started
 * inside it — and the bullet came out the far side.
 */
test('no bullet crosses the west facade', () => {
	const step = (BULLET_SPEED.min + BULLET_SPEED.spread) / SLOWEST_FRAME;
	let through = 0;
	for (let sample = 0; sample < BULLET_SAMPLES; sample++) {
		let x = -30 - (sample / BULLET_SAMPLES) * step;
		let alive = true;
		for (let frame = 0; frame < 200 && x > -50; frame++) {
			const from = { x, y: BULLET_HEIGHT, z: 12 };
			x -= step;
			if (world.hasLineOfSight(from, { x, y: BULLET_HEIGHT, z: 12 }, PROJECTILE_PATH)) continue;
			alive = false;
			break;
		}
		if (alive) through++;
	}
	expect(through, `${through} of ${BULLET_SAMPLES} bullets pass through in steps of ${nr(step)} m`).toBe(0);
});

/**
 * There is no collision box under a deck, so a bullet from the V1 balustrade fell straight
 * through the ground floor. Outside the atrium hole it belongs on the slab; inside it, it
 * belongs through.
 */
describe('a bullet dropped through the V1 deck', () => {
	test('stops on the concrete', () => {
		expect(
			world.crossesSlab({ x: 10, y: V1 + 1, z: 3 }, { x: 10, y: V1 - 1, z: 3 }, BULLET_RADIUS),
			'it falls straight through the V1 slab',
		).toBeTrue();
	});

	test('falls through the atrium hole', () => {
		expect(
			world.crossesSlab({ x: 0, y: V1 + 1, z: 0 }, { x: 0, y: V1 - 1, z: 0 }, BULLET_RADIUS),
			'it hits the atrium hole, where there is no slab',
		).toBeFalse();
	});
});

/** An invisible sight wall is exactly the bug the rule above rules out. */
test('nothing that stops sight is something you climb', () => {
	const wrong = world.boxes
		.filter((box) => box.tags?.includes(SIGHT_BLOCKING_TAG) && box.climbable)
		.map((box) => `${box.label ?? 'an unnamed box'} is climbable and stops sight anyway`);
	expect(wrong, wrong.join('\n')).toBeEmpty();
});
