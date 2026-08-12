import { describe, expect, test } from 'bun:test';
import { CROUCHING_PEDESTRIAN, postureHeadroom, STANDING_PEDESTRIAN } from '#/data/character';
import { ATRIUM_VOID } from '#/data/layout';
import { levelY } from '#/data/levels';
import { SIGHT_BLOCKING_TAG } from '#/data/spatial';
import {
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
	PARKING_EXIT_RAMP,
	parkingExitRampY,
	SLAB_SPEC_BY_LEVEL,
	VERTICAL_CONNECTORS,
} from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { half, lerp, span } from '#/util/math';
import { STREET_X, WALK_PROBE_STEP, walkAlongAxis } from './helpers/walk.ts';
import { nr, world } from './helpers/world.ts';

/**
 * Crouching, walked the way the player walks it, and then read the other way round.
 *
 * The test beam hangs at exactly the headroom the crouching posture asks for, and that number
 * comes from `CROUCHING_PEDESTRIAN`. Make that profile equal to the standing one and the
 * crouching pedestrian meets his own beam: this is where the difference between the two
 * profiles does something you can walk off. The beam stands in a collision world of its own,
 * because it does not belong in the building.
 *
 * The second half asks the reverse. Headroom is a condition for being allowed to walk
 * somewhere at all now, so every flight that was already there has to pass under it standing,
 * or the player goes down on his knees on an escalator.
 */

const V0 = levelY('v0');
/** Thick enough along x that the probe cannot tunnel through it in one step. */
const BEAM_DEPTH = 1;
/** More than a body to either side along z, so there is no walking around it. */
const BEAM_WIDTH = PLAYER_RADIUS * 8;
const BEAM_HEIGHT = 0.4;
/** How far short of the beam an upright pedestrian may stop: one step, and no earlier. */
const STOP_MARGIN = WALK_PROBE_STEP * 2;
const FLIGHT_SAMPLES = 40;

describe('the two pedestrian profiles differ in the way the world assumes', () => {
	test('crouching is shorter than standing', () => {
		expect(CROUCHING_PEDESTRIAN.bodyHeight, 'crouching gains you nothing').toBeLessThan(STANDING_PEDESTRIAN.bodyHeight);
		expect(CROUCHING_PEDESTRIAN.eyeHeight, 'the crouched eye sits no lower').toBeLessThan(STANDING_PEDESTRIAN.eyeHeight);
	});

	test('the crouched eye sits under the crown', () => {
		expect(CROUCHING_PEDESTRIAN.eyeHeight).toBeLessThan(CROUCHING_PEDESTRIAN.bodyHeight);
	});

	test('crouching asks for more headroom than the body is tall', () => {
		expect(CROUCHING_PEDESTRIAN.requiredHeadroom, 'the body would scrape whatever it passes under').toBeGreaterThan(
			CROUCHING_PEDESTRIAN.bodyHeight,
		);
	});

	test('crouching asks for less headroom than standing', () => {
		expect(CROUCHING_PEDESTRIAN.requiredHeadroom, 'no passage is crouch-only, so crouching opens nothing').toBeLessThan(
			STANDING_PEDESTRIAN.requiredHeadroom,
		);
	});

	test('shoulders do not get narrower', () => {
		expect(CROUCHING_PEDESTRIAN.radius).toBe(STANDING_PEDESTRIAN.radius);
	});
});

describe('a beam at crouching height', () => {
	const z = ENTRANCE_PORTAL.centerZ;
	const beamX = ENTRANCE_PORTAL.innerX + half(ENTRANCE_SPEC.hall.depth);
	const front = beamX - half(BEAM_DEPTH);
	const underside = V0 + postureHeadroom('crouching');
	const beamWorld = new CollisionWorld();
	beamWorld.addBox(front, beamX + half(BEAM_DEPTH), z - half(BEAM_WIDTH), z + half(BEAM_WIDTH), {
		minY: underside,
		maxY: underside + BEAM_HEIGHT,
		label: 'test beam',
		tags: [SIGHT_BLOCKING_TAG],
	});

	test('measures as the crouching headroom underneath', () => {
		expect(beamWorld.headroomAt(beamX, z, V0)).toBeCloseTo(postureHeadroom('crouching'), 6);
	});

	test('stops an upright pedestrian, and stops him at the beam', () => {
		const upright = walkAlongAxis(z, STREET_X, half(ATRIUM_VOID.width), { world: beamWorld, posture: 'standing' });
		expect(upright.complaint ?? '').toBe('');
		expect(upright.x, `upright the pedestrian walks to x ${nr(upright.x)}, under the beam at x ${nr(front)}`).toBeLessThan(front);
		expect(
			span(upright.x, front),
			`upright the pedestrian strands at x ${nr(upright.x)}, well before the beam at x ${nr(front)}`,
		).toBeLessThanOrEqual(STOP_MARGIN);
	});

	test('lets a crouching pedestrian through to the atrium', () => {
		const crouched = walkAlongAxis(z, STREET_X, half(ATRIUM_VOID.width), { world: beamWorld, posture: 'crouching' });
		expect(crouched.complaint ?? '').toBe('');
		expect(crouched.x, `crouched the walk strands at x ${nr(crouched.x)}`).toBeGreaterThanOrEqual(half(ATRIUM_VOID.width));
	});

	/** A `headroomAt` that answers infinity everywhere empties every demand above. */
	test('without a beam the hall answers with the slab over it', () => {
		const undersideV1 = SLAB_SPEC_BY_LEVEL.v1.topY - SLAB_SPEC_BY_LEVEL.v1.thickness;
		expect(world.headroomAt(beamX, z, V0)).toBeCloseTo(span(V0, undersideV1), 6);
	});
});

describe.each(VERTICAL_CONNECTORS.map((connector) => connector.id))('%s offers standing headroom', (id) => {
	const connector = VERTICAL_CONNECTORS.find((candidate) => candidate.id === id);

	test('over its whole run', () => {
		if (!connector) return;
		const tight: string[] = [];
		for (let i = 0; i <= FLIGHT_SAMPLES; i++) {
			const t = i / FLIGHT_SAMPLES;
			const treadZ = lerp(connector.zBottom, connector.zTop, t);
			const treadY = lerp(levelY(connector.from), levelY(connector.to), t);
			const free = world.headroomAt(connector.x, treadZ, treadY);
			if (free >= postureHeadroom('standing')) continue;
			tight.push(
				`at (z ${nr(treadZ)}, y ${nr(treadY)}) there is ${nr(free)} m of headroom and standing asks ${nr(postureHeadroom('standing'))} m`,
			);
			break;
		}
		expect(tight, tight.join('\n')).toBeEmpty();
	});
});

test('the parking exit ramp offers standing headroom over its whole run', () => {
	let lowest = Number.POSITIVE_INFINITY;
	let lowestX: number = PARKING_EXIT_RAMP.start.x;
	for (let i = 0; i <= FLIGHT_SAMPLES; i++) {
		const x = lerp(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x, i / FLIGHT_SAMPLES);
		const free = world.headroomAt(x, PARKING_EXIT_RAMP.start.z, parkingExitRampY(x));
		if (free >= lowest) continue;
		lowest = free;
		lowestX = x;
	}
	expect(lowest, `at x ${nr(lowestX)} there is ${nr(lowest)} m of headroom on the exit ramp`).toBeGreaterThanOrEqual(
		postureHeadroom('standing'),
	);
});
