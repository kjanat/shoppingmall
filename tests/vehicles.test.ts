import { describe, expect, test } from 'bun:test';
import { STANDING_PEDESTRIAN } from '#/data/character';
import { levelY } from '#/data/levels';
import {
	connectorClimbModes,
	DRIVEABLE_HANDLING,
	ELEVATOR_CLIMB_MODES,
	ELEVATOR_SPEC,
	PARKING_EXIT_RAMP,
	parkingExitRampY,
	RIDEABLE_MOTORCYCLE_SPOTS,
} from '#/data/world';
import { zoneAt, zoneOfLevel } from '#/data/zones';
import { CollisionWorld } from '#/physics/Collision';
import type { VehicleGroundState } from '#/physics/VehicleGround';
import { stepVehicleGround } from '#/physics/VehicleGround';
import { GRAVITY } from '#/player/constants';
import { CITY_GROUND_Y, GARAGE_RAMP_LANDINGS, PLAZA_OUTER } from '#/scene/city/cityPlan';
import { midpoint, span } from '#/util/math';
import { at } from '#/util/rand';
import { profilePoint } from '$/scripts/perf/routes.ts';
import { stubDocument } from './helpers/stub-dom.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * What a vehicle notices of the road surface, where it puts you down when you get out, and
 * what it is allowed to climb.
 */

const FRAME = 1 / 60;
/** No vehicle belongs above this surface; the test drives no roofs. */
const CEILING = 10;
/** How far above its starting deck a blocked vehicle may not come. */
const CLIMB_SLACK = 0.35;
/** Progress from the reported pose proving the high stair is not a side wall. */
const UNDERNEATH = 0.5;

stubDocument();
const { Scene } = await import('three');
const [{ LightPool }, { Barriers }, { DriveableCars }, { ScrubberBuggy }, { GlassElevator }, { CleaningCart }] =
	await Promise.all([
		import('#/render/LightPool'),
		import('#/scene/city/Barriers'),
		import('#/scene/DriveableCars'),
		import('#/scene/ScrubberBuggy'),
		import('#/scene/GlassElevator'),
		import('#/scene/CleaningCart'),
	]);

/**
 * Nothing tilted on the garage ramp: every vehicle asked only for the height under its own
 * heart, and one height is no slope, so you floated up flat with the deck visibly slanting
 * underneath you. Each kind the player drives has its own wheelbase — the car measures over
 * 2.5 m and the motorcycle over one and a half — and a slope that depends on the ruler is no
 * slope.
 */
describe.each(Object.keys(DRIVEABLE_HANDLING))('a %s on the exit ramp', (kind) => {
	const handling = DRIVEABLE_HANDLING[kind as keyof typeof DRIVEABLE_HANDLING];
	const slope =
		span(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) / span(PARKING_EXIT_RAMP.end.x, PARKING_EXIT_RAMP.start.x);
	const x = midpoint(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x);
	const z = PARKING_EXIT_RAMP.start.z;
	const y = parkingExitRampY(x);

	test('measures its pitch over a wheelbase with length', () => {
		expect(handling.wheelbase, 'there is nothing to measure a slope over').toBeGreaterThan(0);
	});

	test('tilts by the slope of the ramp', () => {
		const uphill = world.surfacePitchAt(x, z, y, -1, 0, handling.wheelbase);
		expect(uphill, `the ramp climbs ${nr(Math.atan(slope))} rad and it tilts ${nr(uphill)} rad`).toBeCloseTo(Math.atan(slope), 3);
	});

	test('tilts the same amount the other way down', () => {
		const uphill = world.surfacePitchAt(x, z, y, -1, 0, handling.wheelbase);
		const downhill = world.surfacePitchAt(x, z, y, 1, 0, handling.wheelbase);
		expect(downhill, `the same slope gives ${nr(uphill)} rad up and ${nr(downhill)} rad down`).toBeCloseTo(-uphill, 3);
	});

	test('stands level on the flat parking floor', () => {
		expect(world.surfacePitchAt(0, 0, levelY('p1'), 1, 0, handling.wheelbase)).toBeCloseTo(0, 6);
	});
});

/**
 * Off the edge of the top landing of the garage spiral: an arc with the same gravity as the
 * player, not one frame in which the height jumps to the ground below.
 */
describe('driving off the top landing', () => {
	const landing = at(GARAGE_RAMP_LANDINGS, GARAGE_RAMP_LANDINGS.length - 1);
	const x = landing.maxX + 1;
	const z = midpoint(landing.minZ, landing.maxZ);
	const state: VehicleGroundState = { y: landing.y, vy: 0, grounded: true };
	const heights: number[] = [landing.y];
	let frames = 0;
	while (frames < Math.ceil(10 / FRAME)) {
		stepVehicleGround(world, state, x, z, FRAME, { floorOverride: null, ceiling: CEILING });
		heights.push(state.y);
		frames++;
		if (state.grounded && frames > 1) break;
	}

	test('the vehicle actually leaves the edge', () => {
		expect(state.grounded && frames <= 1, `from the edge at y ${nr(landing.y)} it just stands there`).toBeFalse();
	});

	test('it lands on the ground below', () => {
		expect(state.grounded, `after ${nr(frames * FRAME)} s it is still falling`).toBeTrue();
		expect(state.y, `it lands at y ${nr(state.y)}`).toBeCloseTo(CITY_GROUND_Y, 3);
	});

	test('the fall accelerates instead of jumping in one frame', () => {
		const slowing: string[] = [];
		let previous = 0;
		for (let i = 2; i < heights.length - 1; i++) {
			const drop = span(at(heights, i), at(heights, i - 1));
			if (drop <= previous) {
				slowing.push(`at frame ${i} it drops ${nr(drop)} m after ${nr(previous)} m, so it is not accelerating`);
				break;
			}
			previous = drop;
		}
		expect(slowing, slowing.join('\n')).toBeEmpty();
	});

	test('it takes as long as a free fall over the same height', () => {
		const free = Math.sqrt((2 * span(CITY_GROUND_Y, landing.y)) / GRAVITY);
		expect(
			Math.abs(frames * FRAME - free),
			`the fall takes ${nr(frames * FRAME)} s where free fall over ${nr(span(CITY_GROUND_Y, landing.y))} m takes ${nr(free)} s`,
		).toBeLessThanOrEqual(FRAME * 2);
	});
});

/**
 * `board` puts the world in 'city' so a car may drive out, and `release` put it back to 'mall'
 * and then pulled the exit point through that same footprint clamp. Getting off the motorcycle
 * outside put you eleven metres away against the south edge of the footprint, inside the
 * building.
 */
describe('getting out where you got out', () => {
	const bike = RIDEABLE_MOTORCYCLE_SPOTS[0];
	const outside = { x: midpoint(PLAZA_OUTER.minX, PLAZA_OUTER.maxX), y: CITY_GROUND_Y, z: PLAZA_OUTER.maxZ - 2 };

	test('there is a motorcycle the player rides away', () => {
		expect(bike, 'no rideable motorcycle in the world').toBeDefined();
	});

	if (!bike) return;

	const places = [
		{ where: 'on the pavement', zone: 'stad', ride: { ...outside, yaw: 0 } },
		{ where: 'in the garage', zone: zoneOfLevel('p1'), ride: { x: bike.x, y: bike.y, z: bike.z, yaw: bike.yaw } },
	] as const;

	const results = places.map((place) => {
		const city = new CollisionWorld();
		const vehicles = new DriveableCars(city, new Barriers(city));
		const resumed = vehicles.resume({ id: bike.name, ...place.ride, speed: 0 });
		const exit = resumed ? vehicles.release() : null;
		return { place, resumed, exit, boundsMode: city.boundsMode };
	});

	test.each(results.map((result) => result.place.where))('%s the ride can be put back', (where) => {
		const result = results.find((candidate) => candidate.place.where === where);
		expect(result?.resumed, `${bike.name} cannot be put back ${where} to get out of`).toBeTrue();
	});

	test.each(results.map((result) => result.place.where))('%s you end up in the zone you got out in', (where) => {
		const result = results.find((candidate) => candidate.place.where === where);
		if (!result?.exit) return;
		expect(
			zoneAt(result.exit.x, result.exit.y, result.exit.z),
			`getting out at (${nr(result.place.ride.x)}, ${nr(result.place.ride.z)}) puts you at (${nr(result.exit.x)}, ${nr(result.exit.z)})`,
		).toBe(result.place.zone);
	});

	test.each(results.map((result) => result.place.where))('%s the shared world is left on the mall clamp', (where) => {
		const result = results.find((candidate) => candidate.place.where === where);
		expect(result?.boundsMode, 'after getting out every sim may walk out of the mall').toBe('mall');
	});

	test('the step aside is the same wherever you get out', () => {
		const steps = results.map((result) =>
			result.exit ? Math.hypot(result.exit.x - result.place.ride.x, result.exit.z - result.place.ride.z) : Number.NaN,
		);
		const [out, inside] = steps;
		expect(out ?? Number.NaN, `outside it steps ${nr(out ?? 0)} m aside and in the garage ${nr(inside ?? 0)} m`).toBeCloseTo(
			inside ?? Number.NaN,
			6,
		);
	});

	/**
	 * The floor you step out onto is the floor the vehicle stands on. The buggy drives into the
	 * lift, so that floor is the cabin floor; taking it from a fixed search height always finds
	 * the ground floor and drops you off V1.
	 */
	test('out of the lift cabin you step onto the cabin floor', () => {
		const deck = new CollisionWorld();
		const buggy = new ScrubberBuggy(deck, new LightPool(new Scene()), new Barriers(deck));
		const cabin = levelY('v1');
		buggy.board();
		buggy.setFloorOverride(cabin);
		buggy.update(FRAME, { throttle: 0, steer: 0, boost: false });
		expect(buggy.release().y, `you step out at ${nr(buggy.release().y)} instead of on the cabin floor`).toBeCloseTo(cabin, 6);
	});
});

/**
 * A restored session puts you back on a point from the previous world, and a ride that does not
 * come back with it leaves you on foot inside the vehicle you were sitting on. You do not walk
 * out of that: every step is pushed back to where you were already stuck.
 */
describe('unsticking a body', () => {
	const radius = STANDING_PEDESTRIAN.radius;
	// Only boxes a body really fits inside; in a thin plate the rim is already outside it and
	// the test measures nothing.
	const roomy = world.boxes.filter(
		(box) =>
			!(box.disabled || box.climbable || box.outdoor) &&
			span(box.minX, box.maxX) >= radius * 2 &&
			span(box.minZ, box.maxZ) >= radius * 2,
	);

	test('there is a solid box a body fits inside', () => {
		expect(roomy, 'no solid box a body fits inside, so this measures nothing').not.toBeEmpty();
	});

	test('the middle of every such box lets you out', () => {
		const stuck = roomy
			.map((box) => {
				const x = midpoint(box.minX, box.maxX);
				const z = midpoint(box.minZ, box.maxZ);
				const free = world.unstickBody(x, z, box.minY ?? CITY_GROUND_Y, false, radius);
				const inside =
					free.x > box.minX - radius + EPS &&
					free.x < box.maxX + radius - EPS &&
					free.z > box.minZ - radius + EPS &&
					free.z < box.maxZ + radius - EPS;
				return inside
					? `in the middle of ${box.label ?? 'an unnamed box'} at (${nr(x)}, ${nr(z)}) you stay stuck at (${nr(free.x)}, ${nr(free.z)})`
					: null;
			})
			.filter((complaint) => complaint !== null);
		expect(stuck, stuck.join('\n')).toBeEmpty();
	});

	test('a body standing free is not moved', () => {
		// An unsticking step that moves everybody is a teleport and not a rescue.
		const free = profilePoint('v0-entrance-street').pose;
		const still = world.unstickBody(free.x, free.z, CITY_GROUND_Y, true, radius);
		expect(Math.hypot(still.x - free.x, still.z - free.z), `you are moved to (${nr(still.x)}, ${nr(still.z)})`).toBeLessThan(
			1e-9,
		);
	});
});

/**
 * The cleaning cart drove up the secret stairs like a pedestrian and the vertical solver parked
 * it halfway up in the air. A vehicle is not a pedestrian: the stairs and the escalator admit
 * `walking` only, the lift and the exit ramp also `wheeled`. That difference is written on the
 * gates of each passage.
 */
function driveCart(
	deck: CollisionWorld,
	start: { x: number; y: number; z: number; yaw: number },
	frames: number,
	throttle = 1,
): { maxY: number; end: { x: number; y: number; z: number } } {
	const cart = new ScrubberBuggy(deck, new LightPool(new Scene()), new Barriers(deck));
	cart.resume({ id: '', x: start.x, y: start.y, z: start.z, yaw: start.yaw, speed: 0 });
	let maxY = start.y;
	for (let frame = 0; frame < frames; frame++) {
		cart.update(FRAME, { throttle, steer: 0, boost: false });
		if (cart.pos.y > maxY) maxY = cart.pos.y;
	}
	return { maxY, end: { x: cart.pos.x, y: cart.pos.y, z: cart.pos.z } };
}

describe('what the cart may climb', () => {
	test('the secret stairs admit no wheels', () => {
		const modes = connectorClimbModes('secret-stairs');
		expect(modes.includes('wheeled'), `they admit ${modes.join(', ')}; a pedestrian stair should not`).toBeFalse();
	});

	test('the lift admits wheels', () => {
		expect(
			ELEVATOR_CLIMB_MODES.includes('wheeled'),
			`the lift admits ${ELEVATOR_CLIMB_MODES.join(', ')}; the cleaning cart belongs inside it`,
		).toBeTrue();
	});

	test('it stays on the floor at the secret stairs', () => {
		const footY = levelY('v1');
		const climb = driveCart(new CollisionWorld(), { x: 26, y: footY, z: 12.5, yaw: Math.PI }, 180);
		expect(climb.maxY, `it climbs to y ${nr(climb.maxY)} while the foot lies at ${nr(footY)}`).toBeLessThanOrEqual(
			footY + CLIMB_SLACK,
		);
	});

	/**
	 * The reported pose under the west stairs: at z −11 the flight hangs nearly five metres over
	 * V0. The connector box used to make that clearance an infinitely high wall and struck every
	 * eastward component out of the movement.
	 */
	test('it drives underneath the high west stairs', () => {
		const start = { x: -24.4, y: levelY('v0'), z: -11, yaw: (-119 * Math.PI) / 180 };
		const under = driveCart(new CollisionWorld(), start, 30);
		expect(under.end.x, `from (${nr(start.x)}, ${nr(start.z)}) it only reaches x ${nr(under.end.x)}`).toBeGreaterThanOrEqual(
			start.x + UNDERNEATH,
		);
	});

	/**
	 * A cart left hanging halfway up the stairs by an old save has to sink back to the floor
	 * rather than hold the last accepted height, which is what left it standing at ~7.99 m.
	 */
	test('a cart hanging over the stairs sinks back to the floor', () => {
		const footY = levelY('v1');
		const hovering = driveCart(new CollisionWorld(), { x: 25.91, y: footY + 1.55, z: 15, yaw: Math.PI }, 180, 0);
		expect(
			Math.abs(hovering.end.y - footY),
			`it stays at y ${nr(hovering.end.y)} instead of sinking to ${nr(footY)}`,
		).toBeLessThanOrEqual(CLIMB_SLACK);
	});

	test('it does climb the exit ramp, which admits wheels', () => {
		const bottom = midpoint(PARKING_EXIT_RAMP.start.y, parkingExitRampY(-30.5));
		const climb = driveCart(new CollisionWorld(), { x: -30.5, y: bottom, z: PARKING_EXIT_RAMP.start.z, yaw: Math.PI / 2 }, 260);
		expect(climb.maxY, `it sticks at y ${nr(climb.maxY)} and the top lies at ${nr(levelY('v0'))}`).toBeGreaterThanOrEqual(
			levelY('v0') - CLIMB_SLACK,
		);
	});

	test('it drives through the assembled lift entrance', () => {
		const liftDeck = new CollisionWorld();
		const lift = new GlassElevator(new LightPool(new Scene()));
		for (const collider of lift.getColliders()) {
			liftDeck.addBox(collider.minX, collider.maxX, collider.minZ, collider.maxZ, {
				minY: collider.minY ?? -7.5,
				maxY: collider.maxY ?? 16.5,
				label: collider.label,
				climbable: collider.climbable,
			});
		}
		const mouthZ = ELEVATOR_SPEC.center.z + midpoint(0, ELEVATOR_SPEC.cabin.depth);
		const entered = driveCart(liftDeck, { x: ELEVATOR_SPEC.center.x, y: levelY('v0'), z: mouthZ + 2, yaw: 0 }, 120);
		expect(entered.end.z, `it stops at z ${nr(entered.end.z)} while the lift mouth is at ${nr(mouthZ)}`).toBeLessThanOrEqual(
			mouthZ,
		);
	});
});

/**
 * Wei's NPC cart collides with everything climbable: a route waypoint lies inside the east
 * escalator and its path crosses the lift shaft, and with climbing on it drove straight through.
 * It never uses the lift, so unlike the player's cart the glass shaft holds it too.
 */
describe('climbable geometry against each kind of body', () => {
	const deck = new CollisionWorld();
	const lift = new GlassElevator(new LightPool(new Scene()));
	for (const collider of lift.getColliders()) {
		deck.addBox(collider.minX, collider.maxX, collider.minZ, collider.maxZ, {
			minY: collider.minY ?? -7.5,
			maxY: collider.maxY ?? 16.5,
			label: collider.label,
			climbable: collider.climbable,
		});
	}
	const radius = new CleaningCart(deck).radius;
	const climbable = deck.boxes.filter((box) => box.climbable);

	function inside(box: { minX: number; maxX: number; minZ: number; maxZ: number }, point: { x: number; z: number }): boolean {
		return point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ;
	}

	test('the lift shaft still hands out climbable boxes', () => {
		expect(climbable, 'no climbable box at all, so this measures nothing').not.toBeEmpty();
	});

	test.each(climbable.map((box) => box.label ?? 'an unnamed climbable box'))('%s', (label) => {
		const box = climbable.find((candidate) => (candidate.label ?? 'an unnamed climbable box') === label);
		if (!box?.climbable) return;
		const x = midpoint(box.minX, box.maxX);
		const z = midpoint(box.minZ, box.maxZ);

		expect(inside(box, deck.resolveCircle(x, z, 0.5, radius, 4, false)), "it does not stop Wei's NPC cart").toBeFalse();

		const player = deck.resolveCircle(x, z, 0.5, radius, 4, false, false, false, true);
		expect(
			inside(box, player),
			box.climbable.includes('wheeled')
				? 'it admits wheels but pushes the player cart out'
				: 'it is pedestrian-only but lets the player cart stand inside it',
		).toBe(box.climbable.includes('wheeled'));

		expect(
			inside(box, deck.resolveCircle(x, z, 0.5, radius, 4, true)),
			'it pushes a pedestrian out of what he walks through',
		).toBeTrue();
	});
});
