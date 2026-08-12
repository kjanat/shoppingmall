import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import { THEATRE_PLAN } from '#/data/world';
import { midpoint } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * Getting out of the helicopter leaves it where you got out.
 *
 * Fly it off the pad, set it down at the theatre, step out, and it should be standing at the
 * theatre: parked, like any vehicle you abandon in a city. Leave it on its own pad and the
 * automatic cycle it flies for the scenery is the right thing to resume.
 *
 * `release` currently sends it to `approach` whatever the situation, and `approach` glides
 * back to the pad from wherever it is, so a machine set down anywhere else lifts off by
 * itself and flies home across the city the moment you close the door.
 */

const ROOF = levelY('roof');
const FRAME = 1 / 60;
/** Longer than a lap plus an approach, so an unattended machine has time to fly home. */
const A_WHILE = 60;

stubDocument();
const THREE = await import('three');
const { Helipad } = await import('#/scene/Helipad');
const { LightPool } = await import('#/render/LightPool');
const { Helicopter } = await import('#/scene/Helicopter');
const { CollisionWorld } = await import('#/physics/Collision');

function padCenter(): InstanceType<typeof THREE.Vector3> {
	const helipad = new Helipad(new LightPool(new THREE.Scene()), new CollisionWorld());
	return helipad.padCenter;
}

/** Where the machine's hull sits; the seat is a fixed lift above it. */
function bodyPosition(heli: InstanceType<typeof Helicopter>): InstanceType<typeof THREE.Vector3> {
	return heli.getSeatPosition().sub(new THREE.Vector3(0, 0.9, 0));
}

function flyTo(heli: InstanceType<typeof Helicopter>, x: number, y: number, z: number): void {
	const cam = new THREE.PerspectiveCamera();
	heli.board();
	// A handful of frames at the destination: `followCamera` puts the hull under the camera,
	// and the extra frames settle the attitude the way a real approach would.
	for (let frame = 0; frame < 30; frame++) {
		cam.position.set(x, y + 0.85, z);
		heli.followCamera(cam, FRAME);
	}
}

describe('the helicopter', () => {
	describe('set down away from the pad and left there', () => {
		const pad = padCenter();
		const heli = new Helicopter(pad);
		const landing = {
			x: midpoint(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX),
			y: THEATRE_PLAN.podiumY,
			z: midpoint(THEATRE_PLAN.podium.minZ, THEATRE_PLAN.podium.maxZ),
		};

		flyTo(heli, landing.x, landing.y, landing.z);
		heli.release();
		for (let frame = 0; frame < A_WHILE / FRAME; frame++) heli.update(FRAME);
		const resting = bodyPosition(heli);

		test('it is still standing where it was left', () => {
			expect(
				Math.hypot(resting.x - landing.x, resting.z - landing.z),
				`it wandered off to (${nr(resting.x)}, ${nr(resting.z)}) instead of staying at (${nr(landing.x)}, ${nr(landing.z)})`,
			).toBeLessThanOrEqual(1);
		});

		test('it is standing on the ground it was left on', () => {
			expect(resting.y, `it settled at ${nr(resting.y)} instead of on the ${nr(landing.y)} it was put down on`).toBeCloseTo(
				landing.y,
				1,
			);
		});

		test('it reports itself as parked', () => {
			expect(heli.state, `it says it is in state '${heli.state}', so it is still flying somewhere`).toBe('parked');
		});
	});

	describe('left while still airborne away from the pad', () => {
		const pad = padCenter();
		const heli = new Helicopter(pad);

		flyTo(heli, 72, 12, -41);
		const released = heli.release();
		for (let frame = 0; frame < A_WHILE / FRAME && heli.state !== 'parked'; frame++) heli.update(FRAME);
		const resting = bodyPosition(heli);

		test('returns to the pad instead of parking in the sky', () => {
			expect(released).toBe('returning-to-pad');
			expect(Math.hypot(resting.x - pad.x, resting.z - pad.z)).toBeLessThanOrEqual(1);
			expect(resting.y).toBeCloseTo(pad.y, 1);
			let flew = false;
			for (let frame = 0; frame < (A_WHILE * 2) / FRAME && !flew; frame++) {
				heli.update(FRAME);
				if (heli.state === 'cruise' || heli.state === 'takeoff') flew = true;
			}
			expect(flew, 'after returning to its pad it never resumes the scenery cycle').toBeTrue();
		});
	});

	/**
	 * The other half of the same rule: left on its own pad, the machine belongs to the scenery
	 * again and flies its rounds over the mall.
	 */
	describe('left on its own pad', () => {
		const pad = padCenter();
		const heli = new Helicopter(pad);

		flyTo(heli, pad.x, pad.y, pad.z);
		heli.release();
		// Up to the moment it settles, and not a fixed stretch: parked it waits eighteen seconds
		// and then takes off again, so a fixed window measures it back in the air.
		for (let frame = 0; frame < A_WHILE / FRAME && heli.state !== 'parked'; frame++) heli.update(FRAME);
		const resting = bodyPosition(heli);

		test('it comes to rest on the pad', () => {
			expect(
				Math.hypot(resting.x - pad.x, resting.z - pad.z),
				`it came to rest at (${nr(resting.x)}, ${nr(resting.z)}) and the pad is at (${nr(pad.x)}, ${nr(pad.z)})`,
			).toBeLessThanOrEqual(1);
		});

		test('the pad it lands on is the roof', () => {
			expect(pad.y, 'the helipad is not at roof height').toBeGreaterThanOrEqual(ROOF);
		});

		test('it takes up its rounds again', () => {
			let flew = false;
			for (let frame = 0; frame < (A_WHILE * 2) / FRAME && !flew; frame++) {
				heli.update(FRAME);
				if (heli.state === 'cruise' || heli.state === 'takeoff') flew = true;
			}
			expect(flew, 'left on its own pad it never flies again, so the roof loses its helicopter').toBeTrue();
		});
	});
});
