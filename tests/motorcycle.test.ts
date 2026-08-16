import { describe, expect, test } from 'bun:test';
import { SEATED_EYE_ABOVE_SEAT } from '#/data/character';
import { levelAt } from '#/data/levels';
import type { DriveableHandling } from '#/data/world';
import {
	DRIVEABLE_HANDLING,
	ENTRANCE_PORTAL,
	ENTRANCE_RIDEABLE_MOTORCYCLES,
	MOTORCYCLE_SPEC,
	RIDEABLE_MOTORCYCLE_SPOTS,
} from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { GRAVITY } from '#/player/constants';
import { clamp, half } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';
import { EPS, nr } from './helpers/world.ts';

/**
 * The motorcycle the player rides away.
 *
 * The direction of travel is camera-forward, `−(sin, cos)`, and the body sits half a turn on
 * it: with `+(sin, cos)` the rental car drove backwards while you looked out of the rear
 * window, and the camera turning along hid it. A second kind on the same machinery is exactly
 * where such a flipped sign creeps back in, so the test ride drives it.
 */

const FRAME = 1 / 60;
/** How long the test ride lasts, in seconds. */
const RIDE_SECONDS = 1;
/** How much of the distance its own acceleration promises it has to cover. */
const EFFICIENCY = 0.9;
/** Slack on the course: further off its own forward axis than this and it is not going forward. */
const COURSE_SLACK = 1e-3;
/** How far the seat may sit from the machine after a rebuild: the saddle sits behind the heart. */
const SADDLE_SLACK = 1;
/** Part throttle for the balance test: enough speed for a real corner, lean well under the clamp. */
const LEAN_THROTTLE = 0.1;
/** Crawling throttle: almost no lateral acceleration, so almost no lean. */
const CRAWL_THROTTLE = 0.03;
/** Frames each lean test drives until speed, course and lean settle. */
const LEAN_FRAMES = 90;
/** Frames into the corner at full speed, short enough that the scrubbing corner has not killed the speed. */
const FULL_LEAN_FRAMES = 4;
const LEAN_SLACK = 0.02;
/** Under this angle the motorcycle counts as good as upright when steering at walking pace. */
const CRAWL_LEAN = 0.06;

stubDocument();
const { Vector3 } = await import('three');
const [{ Barriers }, { DriveableCars }] = await Promise.all([import('#/scene/city/Barriers'), import('#/scene/DriveableCars')]);

const SPOT = RIDEABLE_MOTORCYCLE_SPOTS[0];

/**
 * Where the motorcycle should beat the rental car, every figure on its own line. Two lines with
 * three conditions in them always printed the same pair of numbers: a `boostSpeed` that fell
 * back reported itself with a sentence about `accel`.
 */
const SHARPER_THAN_THE_CAR: readonly { what: string; unit: string; read: (handling: DriveableHandling) => number }[] = [
	{ what: 'accelerates at', unit: 'm/s²', read: (handling) => handling.accel },
	{ what: 'runs', unit: 'm/s', read: (handling) => handling.maxSpeed },
	{ what: 'sprints to', unit: 'm/s', read: (handling) => handling.boostSpeed },
	{ what: 'hangs into a corner to', unit: 'rad', read: (handling) => handling.maxLean },
];

describe.each(SHARPER_THAN_THE_CAR.map((property) => property.what))('the motorcycle %s', (what) => {
	const property = SHARPER_THAN_THE_CAR.find((candidate) => candidate.what === what);
	if (!property) throw new Error(`no property ${what}`);
	const onBike = property.read(DRIVEABLE_HANDLING.motorcycle);
	const onCar = property.read(DRIVEABLE_HANDLING.car);

	test('more than the rental car does', () => {
		expect(onBike, `${nr(onBike)} ${property.unit} against the car's ${nr(onCar)} ${property.unit}`).toBeGreaterThan(onCar);
	});
});

test('there is a motorcycle the player rides away', () => {
	expect(SPOT, 'no rideable motorcycle in the world').toBeDefined();
});

test('the rider looks out over the bars, not from the saddle', () => {
	const saddleTop = MOTORCYCLE_SPEC.seat.centerY + half(MOTORCYCLE_SPEC.seat.height);
	const eye = saddleTop + SEATED_EYE_ABOVE_SEAT;
	expect(
		DRIVEABLE_HANDLING.motorcycle.seatHeight,
		`the camera sits at ${nr(DRIVEABLE_HANDLING.motorcycle.seatHeight)} m while a seated rider's eye is at ${nr(eye)} m`,
	).toBeCloseTo(eye, 9);
});

/** One ride from the same spot, so each measurement starts on an untouched world. */
function ride(): {
	cars: InstanceType<typeof DriveableCars>;
	slot: ReturnType<InstanceType<typeof DriveableCars>['nearestCar']>;
} {
	const city = new CollisionWorld();
	const cars = new DriveableCars(city, new Barriers(city));
	const slot = SPOT ? cars.nearestCar(new Vector3(SPOT.x, SPOT.y + 1, SPOT.z), 1) : null;
	if (slot) cars.board(slot);
	return { cars, slot };
}

describe('boarding it', () => {
	const { cars, slot } = ride();

	test('finds the motorcycle standing there', () => {
		expect(slot?.name, `at (${nr(SPOT?.x ?? 0)}, ${nr(SPOT?.z ?? 0)}) stands ${slot ? slot.name : 'nothing'}`).toBe(SPOT?.name);
	});

	test('puts you on a motorcycle', () => {
		expect(cars.activeKind, `boarding gives ${cars.activeKind ?? 'nothing'}`).toBe('motorcycle');
	});

	test('leaves the body half a turn off the course', () => {
		if (!slot) return;
		const turn = Math.atan2(Math.sin(slot.mesh.rotation.y - cars.heading), Math.cos(slot.mesh.rotation.y - cars.heading));
		expect(Math.abs(turn), `the body sits ${nr(turn)} rad off the driving course`).toBeCloseTo(Math.PI, 9);
	});
});

describe('riding it forward', () => {
	const { cars } = ride();
	const heading = cars.heading;
	const from = cars.ride;
	for (let step = 0; step < Math.round(RIDE_SECONDS / FRAME); step++) {
		cars.update(FRAME, { throttle: 1, steer: 0, boost: false });
	}
	const to = cars.ride;
	const forwardX = -Math.sin(heading);
	const forwardZ = -Math.cos(heading);
	const along = from && to ? (to.x - from.x) * forwardX + (to.z - from.z) * forwardZ : 0;
	const sideways = from && to ? Math.abs((to.x - from.x) * -forwardZ + (to.z - from.z) * forwardX) : 0;

	test('the ride survives the test', () => {
		expect(from, 'the motorcycle reports no ride while somebody is on it').toBeDefined();
		expect(to, 'the ride stopped existing halfway through').toBeDefined();
	});

	test('W drives it forward', () => {
		expect(along, `with W it goes ${nr(-along)} m backwards; the direction of travel is reversed`).toBeGreaterThan(0);
	});

	test('without steering it holds its course', () => {
		expect(sideways, `it drifts ${nr(sideways)} m sideways off its own course`).toBeLessThanOrEqual(COURSE_SLACK);
	});

	test('it covers what its own acceleration promises', () => {
		const promised = half(DRIVEABLE_HANDLING.motorcycle.accel * RIDE_SECONDS * RIDE_SECONDS);
		expect(along, `it covers ${nr(along)} m in ${nr(RIDE_SECONDS)} s while promising ${nr(promised)} m`).toBeGreaterThanOrEqual(
			promised * EFFICIENCY,
		);
	});
});

/**
 * Leaning comes from lateral acceleration and not from the steering input. A steer-times-speed
 * model reached 0.06 rad here where the balance angle asked 0.32.
 *
 * `steer: 1` is a LEFT corner (A raises yaw, forward is −(sin, cos)), and the mesh's local +x is
 * the rider's left flank, so leaning INTO that corner is a negative roll: the left flank dips.
 * The first version asserted the mesh sign without asking which way it tips a rider, and the
 * machine hung outward like a speedboat.
 */
function corner(throttle: number): { speed: number; omega: number; lean: number } {
	const { cars, slot } = ride();
	if (!slot) return { speed: 0, omega: 0, lean: 0 };
	let previousHeading = cars.heading;
	for (let step = 0; step < LEAN_FRAMES; step++) {
		previousHeading = cars.heading;
		cars.update(FRAME, { throttle, steer: 1, boost: false });
	}
	return { speed: cars.speedKmh / 3.6, omega: (cars.heading - previousHeading) / FRAME, lean: slot.mesh.rotation.z };
}

describe('leaning into a steady corner', () => {
	const turn = corner(LEAN_THROTTLE);
	const balance = clamp(
		Math.atan2(turn.speed * turn.omega, GRAVITY),
		-DRIVEABLE_HANDLING.motorcycle.maxLean,
		DRIVEABLE_HANDLING.motorcycle.maxLean,
	);

	test('it hangs into the corner, left flank down in a left corner', () => {
		expect(turn.lean, `steering left it rolls ${nr(turn.lean)} rad, so outward or not at all`).toBeLessThan(0);
	});

	test('the test stays clear of the clamp, so it measures the formula', () => {
		expect(
			balance,
			`at ${nr(turn.speed)} m/s the balance angle is already ${nr(balance)} rad against the clamp ${nr(DRIVEABLE_HANDLING.motorcycle.maxLean)} rad`,
		).toBeLessThan(DRIVEABLE_HANDLING.motorcycle.maxLean);
	});

	test('it hangs at the balance angle atan(v·ω/g)', () => {
		expect(
			turn.lean,
			`it hangs ${nr(turn.lean)} rad where the balance angle asks ${nr(-balance)} rad at ${nr(turn.speed)} m/s and ${nr(turn.omega)} rad/s`,
		).toBeCloseTo(-balance, Math.round(-Math.log10(LEAN_SLACK)));
	});
});

test('at walking pace with full steering it stands nearly upright', () => {
	const crawl = corner(CRAWL_THROTTLE);
	expect(Math.abs(crawl.lean), `at ${nr(crawl.speed)} m/s it hangs ${nr(crawl.lean)} rad`).toBeLessThanOrEqual(CRAWL_LEAN);
});

describe('at full speed with full steering', () => {
	const { cars, slot } = ride();
	for (let step = 0; step < Math.round(RIDE_SECONDS / FRAME); step++) {
		cars.update(FRAME, { throttle: 1, steer: 0, boost: false });
	}
	for (let step = 0; step < FULL_LEAN_FRAMES; step++) cars.update(FRAME, { throttle: 1, steer: 1, boost: false });
	const lean = slot?.mesh.rotation.z ?? 0;

	test('it leans into the corner, left flank down', () => {
		expect(lean, `steering left it rolls ${nr(lean)} rad, so outward or not at all`).toBeLessThan(0);
	});

	test('it never passes its own maximum lean', () => {
		expect(
			Math.abs(lean),
			`it hangs ${nr(lean)} rad, past the ${nr(DRIVEABLE_HANDLING.motorcycle.maxLean)} rad written on it`,
		).toBeLessThanOrEqual(DRIVEABLE_HANDLING.motorcycle.maxLean + EPS);
	});
});

/**
 * An edit while riding rebuilds the world and every vehicle in it, and the ride has to survive
 * that. If it does not come back you stand on foot inside the motorcycle you were sitting on.
 */
describe('after a rebuild', () => {
	const { cars } = ride();
	for (let step = 0; step < Math.round(RIDE_SECONDS / FRAME); step++) {
		cars.update(FRAME, { throttle: 1, steer: 0, boost: false });
	}
	const underway = cars.ride;
	const rebuilt = new CollisionWorld();
	const again = new DriveableCars(rebuilt, new Barriers(rebuilt));
	const resumed = underway ? again.resume(underway) : false;

	test('the ride is found again', () => {
		expect(underway, 'the ride stopped existing before the rebuild test').toBeDefined();
		expect(resumed, `${underway?.id} cannot be found again to get back on`).toBeTrue();
	});

	test('you get back on a motorcycle', () => {
		expect(again.activeKind, `you get onto ${again.activeKind ?? 'nothing'}`).toBe('motorcycle');
	});

	test('the saddle is where the machine is', () => {
		if (!underway) return;
		const saddle = again.getSeatPosition();
		expect(
			Math.hypot(saddle.x - underway.x, saddle.z - underway.z),
			`you sit at (${nr(saddle.x)}, ${nr(saddle.z)}) while the machine stands at (${nr(underway.x)}, ${nr(underway.z)})`,
		).toBeLessThanOrEqual(SADDLE_SLACK);
	});

	/**
	 * Once you are off, `ride` is empty, so the active-ride route cannot restore the parked
	 * machine. The separate parked state has to put the same slot back in the same place and
	 * leave the player on foot, after which E finds it there again.
	 */
	describe('and after getting off first', () => {
		const parkedWorld = new CollisionWorld();
		const afterRefresh = new DriveableCars(parkedWorld, new Barriers(parkedWorld));
		const restored = underway ? afterRefresh.restoreParked(underway) : false;

		test('the parked machine is put back', () => {
			expect(restored, `${underway?.id} cannot be put back after getting off and refreshing`).toBeTrue();
		});

		test('it does not put the player back in the saddle by itself', () => {
			expect(afterRefresh.activeKind, 'the parked motorcycle puts the player back into riding after a refresh').toBeNull();
		});

		test('it stands on its parking spot again', () => {
			if (!underway) return;
			const found = afterRefresh.nearestCar(new Vector3(underway.x, underway.y + 1, underway.z), 1);
			expect(found?.name, `${underway.id} is no longer on its parking spot`).toBe(underway.id);
		});
	});
});

/**
 * The motorcycles at the main entrance were scenery from `Motorcycles`, with no slot attached,
 * so `nearestCar` found nothing there and E did nothing. There are two, because the report was
 * plural and one rideable next to one dead machine produces the same confusion again.
 */
describe('the motorcycles on the red carpet', () => {
	test('there are two of them', () => {
		expect(
			ENTRANCE_RIDEABLE_MOTORCYCLES.length,
			'the entrance carries the wrong number of rideable motorcycles',
		).toBeGreaterThanOrEqual(2);
	});

	test('their names are unique restoration ids', () => {
		expect(
			new Set(ENTRANCE_RIDEABLE_MOTORCYCLES.map((bike) => bike.name)).size,
			'duplicate names restore the first motorcycle in the list',
		).toBe(ENTRANCE_RIDEABLE_MOTORCYCLES.length);
	});

	describe.each(ENTRANCE_RIDEABLE_MOTORCYCLES.map((bike, index) => [bike.name, index] as const))('%s', (name, index) => {
		const bike = ENTRANCE_RIDEABLE_MOTORCYCLES[index];
		if (!bike) throw new Error(`no motorcycle ${name}`);
		const city = new CollisionWorld();
		const cars = new DriveableCars(city, new Barriers(city));
		const slot = cars.nearestCar(new Vector3(bike.x, bike.y + 1, bike.z), 1);
		const boarded = slot ? cars.board(slot) : false;

		test('stands on the ground floor', () => {
			expect(levelAt(bike.y), `it stands on ${levelAt(bike.y)}`).toBe('v0');
		});

		test('is the machine standing on the carpet', () => {
			expect(slot?.name, `on the red carpet stands ${slot ? slot.name : 'nothing'}`).toBe(name);
		});

		test('can be boarded with E', () => {
			expect(boarded && cars.activeKind === 'motorcycle', `E gives ${cars.activeKind ?? 'nothing'}`).toBeTrue();
		});

		test('faces the doors', () => {
			expect(-Math.sin(cars.heading), 'with W it drives into the atrium instead of out of the doors').toBeLessThan(0);
		});

		test('W drives it through the doors onto the street', () => {
			for (let frame = 0; frame < 5 / FRAME; frame++) cars.update(FRAME, { throttle: 1, steer: 0, boost: false });
			const end = cars.ride;
			expect(end, 'the motorcycle vanishes before reaching the street').toBeDefined();
			expect(
				end?.x ?? Number.POSITIVE_INFINITY,
				`it stops at x ${nr(end?.x ?? 0)} inside the facade; the street begins past x ${nr(ENTRANCE_PORTAL.outerX)}`,
			).toBeLessThan(ENTRANCE_PORTAL.outerX);
		});
	});
});
