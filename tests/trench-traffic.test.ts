import { describe, expect, test } from 'bun:test';
import { PARKING_EXIT_RAMP, parkingExitRampY } from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { EXIT_LANE_OFFSET } from '#/scene/city/cityPlan';
import { stubDocument } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * A car on the branch brakes for the player the way it brakes for the car in front.
 *
 * On the ring it already did; on the ramp down it looked at nothing and drove you off the
 * slope. The same two minutes are driven twice: once with an empty ramp, so a car really goes
 * down the trench, and once with somebody standing on it.
 */

/** Well over the clock between two entries down the trench. */
const SECONDS = 120;
/** Coarser than a frame, because two minutes are simulated with it. */
const STEP = 1 / 30;
/** How long each light phase lasts in the test. */
const PHASE = 10;
/** Where the test pedestrian stands on the ramp. */
const PEDESTRIAN_X = -40;
/** This far past him counts as driven through. */
const MARGIN = 1;

stubDocument();
const [{ Barriers }, { CityTraffic }] = await Promise.all([import('#/scene/city/Barriers'), import('#/scene/city/CityTraffic')]);

/** How deep into the trench the traffic comes, with or without somebody on the ramp. */
function deepestCar(pedestrian: { x: number; y: number; z: number } | null): number {
	const city = new CollisionWorld();
	const booms = new Barriers(city);
	let clock = 0;
	const traffic = new CityTraffic(() => (Math.floor(clock / PHASE) % 2 === 0 ? 'ns' : 'ew'), booms);
	traffic.setObstacleProvider(() => pedestrian);
	let deepest = Number.NEGATIVE_INFINITY;
	for (let step = 0; step < Math.ceil(SECONDS / STEP); step++) {
		clock = step * STEP;
		booms.update(STEP);
		traffic.update(STEP, clock);
		for (const car of traffic.group.children) {
			// Only what has actually descended: above street level it is still on the ring.
			if (car.position.y > -0.5) continue;
			deepest = Math.max(deepest, car.position.x);
		}
	}
	traffic.dispose();
	return deepest;
}

const EMPTY = deepestCar(null);
const OCCUPIED = deepestCar({ x: PEDESTRIAN_X, y: parkingExitRampY(PEDESTRIAN_X), z: EXIT_LANE_OFFSET });

describe('a car on the ramp down to the garage', () => {
	test('drives down it at all with the ramp empty', () => {
		expect(
			EMPTY,
			`in ${nr(SECONDS)} s no car passes x ${nr(PARKING_EXIT_RAMP.start.x)}, so the test proves nothing`,
		).toBeGreaterThanOrEqual(PARKING_EXIT_RAMP.start.x);
	});

	test('stops for somebody standing on it', () => {
		expect(
			OCCUPIED,
			`with somebody on the ramp at x ${nr(PEDESTRIAN_X)} a car drives to x ${nr(OCCUPIED)} and so straight through him`,
		).toBeLessThanOrEqual(PEDESTRIAN_X - MARGIN);
	});
});
