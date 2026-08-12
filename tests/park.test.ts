import { describe, expect, test } from 'bun:test';
import { MALL_WALL_ENVELOPE } from '#/data/world';
import { zoneAt } from '#/data/zones';
import { WALK_STEP } from '#/physics/Collision';
import { PARK_LAWN } from '#/scene/city/CityPark';
import { CITY_GROUND_Y, CITY_KAVELS } from '#/scene/city/cityPlan';
import { span } from '#/util/math';
import { profilePoint } from '$/scripts/perf/routes.ts';
import { trafficConflicts } from './helpers/viewpoints.ts';
import { nr, world } from './helpers/world.ts';

/**
 * The pair of measuring viewpoints in the city park.
 *
 * They exist to read the zone cull from outside, and that only works if both really stand
 * outside, both stand in the same spot, and the second really has the building behind it. Each
 * of those three is a number in a pose and none of the three can be read off the coordinates:
 * the plot the park sits on runs to between the two lanes, so aiming at the plot puts you on
 * the roadway.
 */

const TOWARDS = 'park-buiten-mall';
const AWAY = 'park-buiten-weg';

describe('the lawn', () => {
	test('stays inside the plot that carries the park', () => {
		// It used to sit here as four loose numbers beside that plot, same centre line and a
		// rectangle eight metres smaller, with nothing comparing the two.
		expect(PARK_LAWN.minX, 'the grass runs west of the park plot').toBeGreaterThanOrEqual(CITY_KAVELS.park.minX);
		expect(PARK_LAWN.maxX, 'the grass runs east of the park plot').toBeLessThanOrEqual(CITY_KAVELS.park.maxX);
		expect(PARK_LAWN.minZ, 'the grass runs north of the park plot').toBeGreaterThanOrEqual(CITY_KAVELS.park.minZ);
		expect(PARK_LAWN.maxZ, 'the grass runs south of the park plot').toBeLessThanOrEqual(CITY_KAVELS.park.maxZ);
	});

	test('is not eaten entirely by its own verge', () => {
		expect(span(PARK_LAWN.minX, PARK_LAWN.maxX), 'a park without grass').toBeGreaterThan(0);
		expect(span(PARK_LAWN.minZ, PARK_LAWN.maxZ), 'a park without grass').toBeGreaterThan(0);
	});
});

const TOWARDS_POSE = profilePoint(TOWARDS).pose;
const AWAY_POSE = profilePoint(AWAY).pose;

test('both viewpoints stand in the same spot', () => {
	expect(
		[AWAY_POSE.x, AWAY_POSE.y, AWAY_POSE.z],
		`${TOWARDS} stands at (${nr(TOWARDS_POSE.x)}, ${nr(TOWARDS_POSE.z)}) and ${AWAY} at (${nr(AWAY_POSE.x)}, ${nr(AWAY_POSE.z)}); then they measure two viewpoints instead of two directions`,
	).toEqual([TOWARDS_POSE.x, TOWARDS_POSE.y, TOWARDS_POSE.z]);
});

describe.each([TOWARDS, AWAY])('%s', (name) => {
	const { pose } = profilePoint(name);

	test('stands on the park plot', () => {
		expect(
			pose.x >= CITY_KAVELS.park.minX &&
				pose.x <= CITY_KAVELS.park.maxX &&
				pose.z >= CITY_KAVELS.park.minZ &&
				pose.z <= CITY_KAVELS.park.maxZ,
			`it stands at (${nr(pose.x)}, ${nr(pose.z)}), off the park plot`,
		).toBeTrue();
	});

	test('stands clear of the traffic', () => {
		const conflicts = trafficConflicts(name, pose.x, pose.z);
		expect(conflicts, conflicts.join('\n')).toBeEmpty();
	});

	test('stands at street level', () => {
		expect(world.groundHeightAt(pose.x, pose.z, CITY_GROUND_Y, WALK_STEP), 'it does not stand on the street').toBeCloseTo(
			CITY_GROUND_Y,
			6,
		);
	});

	test('stands outside the building', () => {
		expect(zoneAt(pose.x, pose.y, pose.z), 'it measures no viewpoint outside the building').toBe('stad');
	});
});

/**
 * The four corners of the facade outline, each in front of or behind the viewing direction.
 * All four in front is "the mall in view", all four behind is "the mall at your back"; per
 * corner and not per centre point, because a building of 73 by 48 metres is still thirty
 * degrees wide at ninety metres.
 */
const CORNERS = [
	[MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.minZ],
	[MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.maxZ],
	[MALL_WALL_ENVELOPE.maxX, MALL_WALL_ENVELOPE.minZ],
	[MALL_WALL_ENVELOPE.maxX, MALL_WALL_ENVELOPE.maxZ],
] as const;

describe.each([
	[TOWARDS, true],
	[AWAY, false],
] as const)('%s has the mall', (name, inView) => {
	const { pose } = profilePoint(name);
	const lookX = span(pose.x, pose.lookX);
	const lookZ = span(pose.z, pose.lookZ);

	test.each(CORNERS.map((_corner, index) => index))(`corner %d ${inView ? 'in view' : 'at its back'}`, (index) => {
		const corner = CORNERS[index];
		if (!corner) return;
		const ahead = lookX * span(pose.x, corner[0]) + lookZ * span(pose.z, corner[1]) > 0;
		expect(ahead, `facade corner (${nr(corner[0])}, ${nr(corner[1])}) sits ${ahead ? 'in front of' : 'behind'} it`).toBe(inView);
	});
});
