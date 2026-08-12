import { describe, expect, test } from 'bun:test';
import { PARKING_EXIT_RAIL_OUTER, PARKING_EXIT_RAMP, PARKING_EXIT_TRENCH, parkingExitRampY } from '#/data/world';
import { TRAFFIC_FLEET, TRAFFIC_PROFILES } from '#/scene/city/CityTraffic';
import {
	EXIT_APRON,
	EXIT_APRON_TOP_Y,
	EXIT_BOOM,
	EXIT_BOOM_TIP_Z,
	EXIT_BRANCH_ROUTE,
	EXIT_LANE_OFFSET,
	LANE_OFFSET,
	LANE_X,
	LANE_Z,
	PLAZA_OUTER,
	RING_INNER_WEST_X,
	ROAD_CROSSINGS,
	ROAD_PLAN,
	ROAD_RINGS,
	roadPaintPatches,
	TRAFFIC_CAR,
	zebraBounds,
} from '#/scene/city/cityPlan';
import { half, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';
import { read } from './helpers/source-scan.ts';
import { EPS, nr } from './helpers/world.ts';

/**
 * The ring road: two lanes against each other, both keeping right, each with its own corner
 * tile. Keeping right is one sum here — the centre of a lane lies to the right of its own
 * direction, measured from the centreline of the roadway. Flip a sign and half the city drives
 * against the traffic, and from above you cannot see it.
 */

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Edges that only touch do not count as crossing. */
function overlaps(a: Rect, b: Rect): boolean {
	return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}

describe('the roadway', () => {
	test('has two lanes', () => {
		expect(ROAD_RINGS.length, 'there is no oncoming direction').toBe(2);
	});

	test('runs them in opposite directions', () => {
		expect(
			new Set(ROAD_RINGS.map((lane) => lane.turn)).size,
			'both lanes turn the same way, so it is one-way over two lanes',
		).toBe(ROAD_RINGS.length);
	});

	test('fits its lane offset four times across', () => {
		expect(LANE_OFFSET * 4, `the offset is ${nr(LANE_OFFSET)} m and the roadway ${nr(ROAD_PLAN.width)} m`).toBeCloseTo(
			ROAD_PLAN.width,
			6,
		);
	});
});

describe.each(ROAD_RINGS.map((lane) => lane.turn))('lane %s', (turn) => {
	const lane = ROAD_RINGS.find((candidate) => candidate.turn === turn);
	if (!lane) throw new Error(`no lane ${turn}`);

	test('is a closed ring of four edges', () => {
		expect(lane.edges.length, `it has ${lane.edges.length} edges`).toBe(4);
	});

	test.each(lane.edges.map((_edge, index) => index))('edge %s keeps right of the centreline', (index) => {
		const edge = at(lane.edges, index);
		const alongX = edge.dz === 0;
		const centre = alongX ? edge.oz : edge.ox;
		const centreline = Math.sign(centre) * (alongX ? LANE_Z : LANE_X);
		const sideways = centre - centreline;
		// Right of the direction of travel is (−dz, dx).
		const right = alongX ? sideways * edge.dx : sideways * -edge.dz;
		expect(
			right,
			`it drives (${nr(edge.dx)}, ${nr(edge.dz)}) and lies ${nr(Math.abs(sideways))} m to the left of the centreline`,
		).toBeGreaterThan(0);
		expect(Math.abs(sideways), 'it lies at the wrong distance from the centreline').toBeCloseTo(LANE_OFFSET, 9);
	});

	test.each(lane.edges.map((_edge, index) => index))('edge %s points its nose along its own direction', (index) => {
		const edge = at(lane.edges, index);
		expect(Math.cos(edge.rotY), 'the nose does not face the direction of travel').toBeCloseTo(edge.dx, 9);
		expect(Math.sin(edge.rotY), 'the nose does not face the direction of travel').toBeCloseTo(-edge.dz, 9);
	});

	test.each(lane.edges.map((_edge, index) => index))('edge %s listens to the phase of its own axis', (index) => {
		const edge = at(lane.edges, index);
		const alongX = edge.dz === 0;
		expect(edge.phase, `it runs along ${alongX ? 'x' : 'z'}`).toBe(alongX ? 'ns' : 'ew');
	});
});

/** The corners are a tile of their own because the centre line turns a quarter with them. */
describe('the asphalt is drawn from the plan', () => {
	test.each([
		'this.makeCornerTexture()',
		'const EW_LEN = 2 * ROAD_INNER_X',
		'const NS_LEN = 2 * ROAD_INNER_Z',
		'roadPaintPatches()',
	])('CityRoads still reads %s', async (fragment) => {
		const source = await read('src/scene/city/CityRoads.ts');
		expect(source.includes(fragment), `${fragment} is gone from the road builder`).toBeTrue();
	});
});

/**
 * All road markings are loose rectangles with the crossings cut out of them, like the garage
 * striping around the column feet. A stripe crossing a zebra draws a continuous line over it:
 * the centre line a plus through the middle, the edge line a bar across the ends.
 */
test('no road marking runs through a crossing', () => {
	const zebras = ROAD_CROSSINGS.map(zebraBounds);
	const through = roadPaintPatches().flatMap(({ kind, rect }) =>
		zebras
			.filter((zebra) => overlaps(rect, zebra))
			.map(
				() =>
					`a ${kind === 'dash' ? 'centre' : 'edge'} stripe at (${nr(midpoint(rect.minX, rect.maxX))}, ${nr(midpoint(rect.minZ, rect.maxZ))}) runs through a crossing`,
			),
	);
	expect(through, through.join('\n')).toBeEmpty();
});

/**
 * The following distances and the hit radius of the city traffic were three loose numbers with
 * the length of a car baked in, so a narrower vehicle could only join by copying them, and a
 * copy that does not move along is exactly how a motorcycle ends up on the ring with the
 * following distance of a car.
 */
describe.each(Object.keys(TRAFFIC_PROFILES))('a %s on the ring', (kind) => {
	const profile = TRAFFIC_PROFILES[kind as keyof typeof TRAFFIC_PROFILES];

	test('fits inside its own lane', () => {
		expect(half(profile.width), `it is ${nr(profile.width)} m wide and hangs over the centre line`).toBeLessThanOrEqual(
			LANE_OFFSET + EPS,
		);
	});

	test('does not stand inside the one in front of it', () => {
		expect(
			profile.holdGap,
			`it holds ${nr(profile.holdGap)} m centre to centre while being ${nr(profile.length)} m long`,
		).toBeGreaterThan(profile.length);
	});

	test('lifts off before it has to stop', () => {
		expect(
			profile.brakeGap,
			`it lifts off at ${nr(profile.brakeGap)} m and stops at ${nr(profile.holdGap)} m: it collides`,
		).toBeGreaterThan(profile.holdGap);
	});

	test('has a hit radius inside its own nose', () => {
		expect(profile.hit, 'its hit radius is not positive').toBeGreaterThan(0);
		expect(profile.hit, `${nr(profile.hit)} m does not fit inside its nose (${nr(half(profile.length))} m)`).toBeLessThanOrEqual(
			half(profile.length),
		);
	});
});

describe('the motorcycle against the car', () => {
	const car = TRAFFIC_PROFILES.car;
	const rider = TRAFFIC_PROFILES.rider;

	test('is the smaller body', () => {
		expect(rider.length, `it measures ${nr(rider.length)} m against the car's ${nr(car.length)} m`).toBeLessThan(car.length);
		expect(rider.width, `it measures ${nr(rider.width)} m against the car's ${nr(car.width)} m`).toBeLessThan(car.width);
	});

	test('keeps the tighter distances', () => {
		expect(rider.holdGap, 'it follows no closer than the car').toBeLessThan(car.holdGap);
		expect(rider.brakeGap, 'it brakes no later than the car').toBeLessThan(car.brakeGap);
	});
});

describe.each(ROAD_RINGS.map((_lane, index) => index))('direction %s of the ring', (ring) => {
	test('carries at least one motorcycle', () => {
		const riders = TRAFFIC_FLEET.filter((kind, slot) => kind === 'rider' && slot % ROAD_RINGS.length === ring).length;
		expect(riders, 'no motorcycle drives this way, so it is sheet metal only').toBeGreaterThan(0);
	});
});

/** Which lane a point sits exactly on the centre of, and which way that lane runs there. */
function onLane(x: number, z: number): { ring: number; dx: number; dz: number } | null {
	for (const [index, lane] of ROAD_RINGS.entries()) {
		for (const edge of lane.edges) {
			const along = (x - edge.ox) * edge.dx + (z - edge.oz) * edge.dz;
			if (along < -EPS || along > edge.len + EPS) continue;
			if (Math.abs((x - edge.ox) * -edge.dz + (z - edge.oz) * edge.dx) > EPS) continue;
			return { ring: index, dx: edge.dx, dz: edge.dz };
		}
	}
	return null;
}

/**
 * The branch off the ring down to P1. The trench used to lie loose from the road: the asphalt
 * stopped at the kerb, the ramp began two metres further on and paving lay in between, so a car
 * could drive down but not over anything it fitted on.
 */
describe('the branch to the garage', () => {
	const mouth = PARKING_EXIT_TRENCH.minX;
	const halfCar = half(TRAFFIC_CAR.width);

	test('the apron reaches the roadway', () => {
		expect(EXIT_APRON.minX, `the apron starts at x ${nr(EXIT_APRON.minX)} and does not touch the roadway`).toBeLessThanOrEqual(
			PLAZA_OUTER.minX + EPS,
		);
	});

	test('the apron reaches the mouth of the trench', () => {
		expect(
			EXIT_APRON.maxX,
			`the apron stops at x ${nr(EXIT_APRON.maxX)} and the mouth begins at x ${nr(mouth)}`,
		).toBeGreaterThanOrEqual(mouth - EPS);
	});

	test('the apron meets the ramp at the same height', () => {
		expect(EXIT_APRON_TOP_Y).toBeCloseTo(parkingExitRampY(mouth), 6);
	});

	test('the apron carries both lanes', () => {
		expect(EXIT_APRON.maxZ, `the apron is ${nr(span(EXIT_APRON.minZ, EXIT_APRON.maxZ))} m wide`).toBeGreaterThanOrEqual(
			EXIT_LANE_OFFSET + halfCar,
		);
		expect(EXIT_APRON.minZ).toBeLessThanOrEqual(-(EXIT_LANE_OFFSET + halfCar));
	});

	const steepest =
		span(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) / span(PARKING_EXIT_RAMP.end.x, PARKING_EXIT_RAMP.start.x);

	test.each(EXIT_BRANCH_ROUTE.slice(0, -1).map((_point, index) => index))('leg %s of the route', (index) => {
		const from = at(EXIT_BRANCH_ROUTE, index);
		const to = at(EXIT_BRANCH_ROUTE, index + 1);
		const dx = to.x - from.x;
		const dz = to.z - from.z;
		const run = Math.hypot(dx, dz);
		expect(run, 'the leg has no length').toBeGreaterThan(EPS);
		expect(
			Math.abs(dx) > EPS && Math.abs(dz) > EPS,
			`it runs diagonally (${nr(dx)}, ${nr(dz)}) instead of along one axis`,
		).toBeFalse();
		expect(
			Math.abs(to.y - from.y) / run,
			`it climbs steeper than the exit ramp itself (${nr(steepest)} per metre)`,
		).toBeLessThanOrEqual(steepest + EPS);
		// Keeping right: right of a direction (dx, dz) is (−dz, dx), so a leg along x belongs on
		// the side of the axis its own direction points to.
		if (Math.abs(dx) > EPS) {
			expect(Math.sign(from.z), `it drives x ${nr(Math.sign(dx))} on z ${nr(from.z)} and so keeps left`).toBe(Math.sign(dx));
		}
	});

	test.each(EXIT_BRANCH_ROUTE.filter((point) => point.x >= mouth - EPS).map((_point, index) => index))(
		'point %s inside the trench lies on the ramp and between its walls',
		(index) => {
			const point = at(
				EXIT_BRANCH_ROUTE.filter((candidate) => candidate.x >= mouth - EPS),
				index,
			);
			expect(point.y, `the branch sits at ${nr(point.y)} while the ramp lies at ${nr(parkingExitRampY(point.x))}`).toBeCloseTo(
				parkingExitRampY(point.x),
				6,
			);
			if (point.x > PARKING_EXIT_RAMP.start.x) return;
			expect(Math.abs(point.z) + halfCar, `at x ${nr(point.x)} it runs into the retaining wall`).toBeLessThanOrEqual(
				PARKING_EXIT_RAIL_OUTER + EPS,
			);
		},
	);

	describe('leaves and rejoins the same lane', () => {
		const first = EXIT_BRANCH_ROUTE[0];
		const last = EXIT_BRANCH_ROUTE[EXIT_BRANCH_ROUTE.length - 1];
		const out = first ? onLane(first.x, first.z) : null;
		const back = last ? onLane(last.x, last.z) : null;

		test('both ends sit on the centre of a lane', () => {
			expect(out, 'the branch does not start on the centre of a lane').not.toBeNull();
			expect(back, 'the branch does not end on the centre of a lane').not.toBeNull();
		});

		test('it rejoins the lane it left', () => {
			expect(back?.ring, `it leaves lane ${out?.ring} and rejoins lane ${back?.ring}`).toBe(out?.ring);
		});

		test('it rejoins downstream', () => {
			if (!first || !last || !out) return;
			expect(
				(last.x - first.x) * out.dx + (last.z - first.z) * out.dz,
				'it rejoins upstream, against its own lane',
			).toBeGreaterThan(0);
		});

		test('it starts on the inner lane', () => {
			expect(first?.x, `it starts at x ${nr(first?.x ?? 0)}`).toBeCloseTo(RING_INNER_WEST_X, 6);
		});
	});

	describe('the boom on the apron', () => {
		test('stands on the apron', () => {
			expect(EXIT_BOOM.post.x, `it stands at x ${nr(EXIT_BOOM.post.x)}`).toBeGreaterThanOrEqual(EXIT_APRON.minX);
			expect(EXIT_BOOM.post.x).toBeLessThanOrEqual(EXIT_APRON.maxX);
		});

		test('keeps its post out of the inbound lane', () => {
			expect(EXIT_BOOM.post.z, `the post stands at z ${nr(EXIT_BOOM.post.z)}, inside the inbound lane`).toBeGreaterThanOrEqual(
				EXIT_LANE_OFFSET + halfCar,
			);
		});

		test('stands at the height of the apron it is on', () => {
			expect(EXIT_BOOM.post.y).toBeCloseTo(EXIT_APRON_TOP_Y, 6);
		});

		test('closes the inbound lane and no more', () => {
			expect(EXIT_BOOM_TIP_Z, `the arm reaches to z ${nr(EXIT_BOOM_TIP_Z)} and leaves the inbound lane open`).toBeLessThanOrEqual(
				EXIT_LANE_OFFSET,
			);
			expect(EXIT_BOOM_TIP_Z, `the arm reaches to z ${nr(EXIT_BOOM_TIP_Z)}, into the outbound lane`).toBeGreaterThanOrEqual(
				-EXIT_LANE_OFFSET + halfCar,
			);
		});
	});
});
