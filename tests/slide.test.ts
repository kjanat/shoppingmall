import { describe, expect, test } from 'bun:test';
import { levelAt, levelBand, levelY } from '#/data/levels';
import { poolFloorY } from '#/data/pool';
import { geometryBounds } from '#/data/spatial';
import { ROOF_SLIDE_ENTITY, SLIDE_LADDER_CLIMB, SLIDE_LADDER_X, SLIDE_PLATFORM_TOP_Y, SLIDE_TOWER_SPEC } from '#/data/world';
import { deckAt, zoneAt } from '#/data/zones';
import { inPool, POOL_WATER_Y } from '#/scene/RoofIsland';
import { midpoint } from '#/util/math';
import { EPS, nr } from './helpers/world.ts';

/**
 * The slide is a ride and not scenery.
 *
 * The tube used to be geometry with no meaning: you fell straight through it onto the deck
 * and only a loose camera trick put you in the water. Every section carries you now, through
 * a conveyor emitter of its own, and the mouth sits on the platform the ladder comes out on.
 */

const ROOF = levelY('roof');
const FRAME = 1 / 60;
/** How far over the surface the ride may still let go of you. */
const RELEASE_MARGIN = 0.5;

const { Vector3 } = await import('three');
const { SlideRide } = await import('#/scene/SlideRide');
const ride = new SlideRide();

const SURFACES = ROOF_SLIDE_ENTITY.volumes.filter(
	(volume) => volume.tags.includes('travel-surface') && volume.geometry.kind === 'ramp',
);
const FLOWS = ROOF_SLIDE_ENTITY.emitters.filter((emitter) => emitter.channel === 'conveyor');

describe('every section of the tube carries you', () => {
	test('the tube still has travel surfaces', () => {
		expect(SURFACES, 'the slide has no travel surface left: the tube is scenery again').not.toBeEmpty();
	});

	test('there is one flow per section', () => {
		expect(
			FLOWS.length,
			`${SURFACES.length} tube sections against ${FLOWS.length} flows: not every section takes you along`,
		).toBe(SURFACES.length);
	});

	test('the flows have unique ids', () => {
		expect(new Set(FLOWS.map((flow) => flow.id)).size, 'duplicate ids make one flow hide another in diagnostics').toBe(
			FLOWS.length,
		);
	});

	test('the flows cover every travel surface exactly once', () => {
		expect(
			FLOWS.map((flow) => flow.sourceVolumeId).toSorted(),
			'a duplicated source leaves another tube section without flow',
		).toEqual(SURFACES.map((surface) => surface.id).toSorted());
	});

	test.each(FLOWS.map((flow, index) => [flow.id, index] as const))('%s', (_id, index) => {
		const flow = FLOWS[index];
		if (!flow) return;
		const surface = SURFACES.find((volume) => volume.id === flow.sourceVolumeId);
		expect(surface, `it flows over volume '${flow.sourceVolumeId}', which is not a tube travel surface`).toBeDefined();
		expect(flow.field.kind, 'it is not a surface flow, so it carries nothing along the tube').toBe('surface');
		if (flow.field.kind !== 'surface' || !surface || surface.geometry.kind !== 'ramp') return;
		const speed = Math.hypot(flow.field.vector.x, flow.field.vector.y, flow.field.vector.z);
		expect(speed, `it carries at ${nr(speed)} m/s while the tube declares ${nr(SLIDE_TOWER_SPEC.tube.speed)} m/s`).toBeCloseTo(
			SLIDE_TOWER_SPEC.tube.speed,
			9,
		);
		const dx = surface.geometry.end.x - surface.geometry.start.x;
		const dy = surface.geometry.end.y - surface.geometry.start.y;
		const dz = surface.geometry.end.z - surface.geometry.start.z;
		const run = Math.hypot(dx, dy, dz);
		expect(flow.field.vector.x / speed, 'the flow points across or backwards along its tube section').toBeCloseTo(dx / run, 9);
		expect(flow.field.vector.y / speed, 'the flow points across or backwards along its tube section').toBeCloseTo(dy / run, 9);
		expect(flow.field.vector.z / speed, 'the flow points across or backwards along its tube section').toBeCloseTo(dz / run, 9);
	});
});

describe('boarding', () => {
	const entry = ROOF_SLIDE_ENTITY.volumes.find((volume) => volume.tags.includes('slide-entry'));

	test('the slide has a boarding point', () => {
		expect(entry, 'the slide has no entry volume').toBeDefined();
	});

	test('standing in the mouth on the platform takes you along', () => {
		if (!entry) return;
		const mouth = geometryBounds(entry.geometry);
		expect(
			ride.accepts(midpoint(mouth.minX, mouth.maxX), SLIDE_PLATFORM_TOP_Y, midpoint(mouth.minZ, mouth.maxZ)),
			'standing in the mouth of the tube you are not picked up',
		).toBeTrue();
	});

	test('standing at the top of the ladder does not', () => {
		expect(
			ride.accepts(SLIDE_LADDER_X, SLIDE_PLATFORM_TOP_Y, SLIDE_LADDER_CLIMB.zTop),
			'at the top of the ladder you are already in the mouth: you slide away before reaching the platform',
		).toBeFalse();
	});
});

/** The ride itself, in player frames, from the mouth to wherever it lets go. */
const RIDE = ((): { climbedAt: number | null; travelled: number; frames: number; end: { x: number; y: number; z: number } } => {
	const point = new Vector3();
	let travelled = 0;
	let frames = 0;
	let climbedAt: number | null = null;
	const limit = Math.ceil(ride.length / (ride.speed * FRAME)) + 2;
	while (travelled < ride.length && frames < limit) {
		travelled += ride.speed * FRAME;
		frames++;
		ride.pointAt(travelled, point);
		if (point.y > SLIDE_PLATFORM_TOP_Y + EPS && climbedAt === null) climbedAt = travelled;
	}
	ride.pointAt(ride.length, point);
	return { climbedAt, travelled, frames, end: { x: point.x, y: point.y, z: point.z } };
})();

describe('the ride', () => {
	test('never climbs back over the platform it starts on', () => {
		expect(RIDE.climbedAt, `the ride climbs above the platform ${nr(RIDE.climbedAt ?? 0)} m in`).toBeNull();
	});

	test('reaches the end of its own length', () => {
		expect(
			RIDE.travelled,
			`it stalls after ${RIDE.frames} frames at ${nr(RIDE.travelled)} of ${nr(ride.length)} m`,
		).toBeGreaterThanOrEqual(ride.length);
	});

	test('lets go inside the waterline', () => {
		expect(
			inPool(RIDE.end.x, RIDE.end.z),
			`it lets go at (${nr(RIDE.end.x)}, ${nr(RIDE.end.z)}), outside the waterline`,
		).toBeTrue();
	});

	test('lets go near the surface', () => {
		expect(RIDE.end.y, `it lets go at ${nr(RIDE.end.y)}, well over the surface at ${nr(POOL_WATER_Y)}`).toBeLessThanOrEqual(
			POOL_WATER_Y + RELEASE_MARGIN,
		);
	});

	test('lets go over water with a bottom under it', () => {
		expect(
			poolFloorY(RIDE.end.x, RIDE.end.z),
			'where the ride ends the pool has no bottom: you land on the tiles',
		).not.toBeNull();
	});
});

/**
 * Land in the deep end and you are swimming on the roof, even with your feet under the roof
 * band. The bottom lies below `levelBand('roof').minY`, so `levelAt` read V1 there and the
 * zone cull drew the interior underneath: you looked straight through the building. The whole
 * column of the basin has to count as roof, from the bottom up to the deck.
 */
describe('the deep end still belongs to the roof', () => {
	const bottom = poolFloorY(RIDE.end.x, RIDE.end.z);
	const threshold = levelBand('roof').minY;
	// A crouching swimmer's camera sits the lowest; standing he is above the threshold anyway
	// and would prove nothing.
	const crouchedEye = midpoint(bottom ?? 0, threshold);

	test('the bottom lies under the roof band, or this proves nothing', () => {
		expect(levelAt(bottom ?? 0), `the bottom at ${nr(bottom ?? 0)} is already inside the roof band`).not.toBe('roof');
	});

	test('the HUD reads the roof on the bottom', () => {
		expect(deckAt(RIDE.end.x, bottom ?? 0, RIDE.end.z), 'the HUD names another deck on the pool bottom').toBe('roof');
	});

	test('the crouched eye height used here is under the roof band', () => {
		expect(crouchedEye, 'the crouched-eye sample sits above the threshold and does not prove the leak').toBeLessThan(threshold);
	});

	test('a crouching swimmer is in the roof zone', () => {
		expect(zoneAt(RIDE.end.x, crouchedEye, RIDE.end.z), 'a crouching swimmer reads another zone: see-through limbo').toBe('roof');
	});

	test('the basin does not reach down into the storey below it', () => {
		const underneath = levelY('v1') + 2;
		expect(zoneAt(RIDE.end.x, underneath, RIDE.end.z), 'the basin claims the deck under it').toBe('mall-v1');
	});
});

test('the roof deck is where the platform stands', () => {
	expect(SLIDE_PLATFORM_TOP_Y, 'the slide platform no longer stands over the roof').toBeGreaterThan(ROOF);
});
