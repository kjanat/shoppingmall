import { describe, expect, test } from 'bun:test';
import type { TrafficClass } from '#/data/spatial';
import { TRAFFIC_CLASSES, validateSpatialWorld } from '#/data/spatial';
import type { BarrierSpec } from '#/data/world';
import {
	BARRIER_ENTITIES,
	BARRIER_HARDWARE,
	BARRIER_SPECS,
	barrierAdmits,
	barrierApproachBounds,
	barrierGateCollider,
	DRIVEABLE_SPOTS,
} from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { EXIT_BRANCH_ROUTE, ROAD_RINGS, TRAFFIC_CAR } from '#/scene/city/cityPlan';
import { half, lerp, midpoint } from '#/util/math';
import { at } from '#/util/rand';
import { filesIn, read } from './helpers/source-scan.ts';
import { stubDocument } from './helpers/stub-dom.ts';
import { EPS, nr } from './helpers/world.ts';

/**
 * The booms: who gets past is written on the boom and not in the vehicle.
 *
 * They both stopped nothing — you drove a rental car straight through — and one hung on the
 * ring traffic while the other went up and down on a sine. The lowered arm is a collider now
 * and the admission policy of the boom says whether it lifts, so the same stretch is driven
 * once per traffic class and the answer expected is the one written on the boom.
 */

const FRAME = 1 / 60;
/** Walking pace, so the arm has all the time it needs. */
const DRIVE_SPEED = 3;
/** This far past the arm counts as through. */
const THROUGH = 0.2;
/** The height at which a vehicle asks its collision question, over the road surface. */
const HULL_HEIGHT = 0.6;
/** How often a route is sampled when looking for an approach strip. */
const ROUTE_STEP = 0.5;

stubDocument();
const { Barriers } = await import('#/scene/city/Barriers');

/**
 * Every class the source ever announces at a boom. A boom admitting a class nobody offers
 * reads exactly like a boom that works: it stands there, it has policy, and it never opens.
 */
async function announcedClasses(): Promise<Set<TrafficClass>> {
	const announced = new Set<TrafficClass>();
	for (const path of await filesIn('src')) {
		// Raw source, not the blanked form the other greps use: the class being looked for is a
		// string literal, and blanking the literals blanks the answer.
		const code = await read(path);
		for (const match of code.matchAll(/\.approach\s*\([^)]*?'([a-z-]+)'\s*\)/g)) {
			const found = TRAFFIC_CLASSES.find((candidate) => candidate === match[1]);
			if (found) announced.add(found);
		}
	}
	return announced;
}

const ANNOUNCED = await announcedClasses();

/** Every point the city traffic passes: the two ring lanes and the branch. */
function trafficPoints(): [number, number][] {
	const points: [number, number][] = [];
	for (const ring of ROAD_RINGS) {
		for (const edge of ring.edges) {
			for (let along = 0; along <= edge.len; along += ROUTE_STEP) {
				points.push([edge.ox + edge.dx * along, edge.oz + edge.dz * along]);
			}
		}
	}
	for (let i = 1; i < EXIT_BRANCH_ROUTE.length; i++) {
		const from = at(EXIT_BRANCH_ROUTE, i - 1);
		const to = at(EXIT_BRANCH_ROUTE, i);
		const length = Math.hypot(to.x - from.x, to.z - from.z);
		for (let along = 0; along <= length; along += ROUTE_STEP) {
			const t = length === 0 ? 0 : along / length;
			points.push([lerp(from.x, to.x, t), lerp(from.z, to.z, t)]);
		}
	}
	return points;
}

const TRAFFIC_POINTS = trafficPoints();

/**
 * Does anything of this class ever reach the approach strip of this boom? The city traffic
 * drives written routes, so there the answer can be measured. The player drives wherever he
 * likes as long as there is something to get into, and on foot nobody announces at a boom.
 */
function everPassesBy(spec: BarrierSpec, kind: TrafficClass): boolean {
	if (kind === 'player-vehicle') return DRIVEABLE_SPOTS.length > 0;
	if (kind !== 'npc-traffic') return false;
	const strip = barrierApproachBounds(spec);
	return TRAFFIC_POINTS.some(([x, z]) => x >= strip.minX && x <= strip.maxX && z >= strip.minZ && z <= strip.maxZ);
}

/**
 * Drive one vehicle of this class at this boom and report how far it gets. Exactly what App
 * does: the arms first move on what they saw last frame, then the vehicle announces itself,
 * then the world resolves the collision.
 */
function driveAtBoom(spec: BarrierSpec, kind: TrafficClass): number {
	const city = new CollisionWorld();
	const booms = new Barriers(city);
	const strip = barrierApproachBounds(spec);
	const z = midpoint(strip.minZ, strip.maxZ);
	const radius = half(TRAFFIC_CAR.width);
	const direction = -spec.approachSide;
	const target = spec.post.x + direction * (half(BARRIER_HARDWARE.arm.thickness) + THROUGH);
	let x = spec.post.x - direction * spec.sight;
	for (let step = 0; step < Math.ceil(spec.sight / (DRIVE_SPEED * FRAME)) + 1; step++) {
		booms.update(FRAME);
		booms.approach(x, z, kind);
		const solved = city.resolveCircle(
			x + direction * DRIVE_SPEED * FRAME,
			z,
			spec.post.y + HULL_HEIGHT,
			radius,
			4,
			true,
			false,
			true,
		);
		x = solved.x;
		if ((target - x) * direction <= 0) break;
	}
	return x;
}

test('the barrier entities pass the spatial rules', () => {
	const problems = validateSpatialWorld(BARRIER_ENTITIES).map((problem) => `${problem.code}: ${problem.message}`);
	expect(problems, problems.join('\n')).toBeEmpty();
});

test('there is a boom at all', () => {
	expect(BARRIER_SPECS, 'no boom in the world model').not.toBeEmpty();
});

describe.each(BARRIER_SPECS.map((spec) => spec.id))('%s', (id) => {
	const spec = BARRIER_SPECS.find((candidate) => candidate.id === id);
	if (!spec) throw new Error(`no boom ${id}`);
	const gate = barrierGateCollider(spec);
	const strip = barrierApproachBounds(spec);

	test('its gateway starts on its own road surface', () => {
		expect(gate.minY, `the gateway starts at y ${nr(gate.minY)}`).toBeLessThanOrEqual(spec.post.y + EPS);
	});

	test('its gateway reaches over its own hinge', () => {
		expect(gate.maxY, `the gateway stops at ${nr(gate.maxY)}, under the hinge of its own arm`).toBeGreaterThan(
			spec.post.y + BARRIER_HARDWARE.pivotY,
		);
	});

	test('its approach strip is as long as it claims to see', () => {
		expect(
			strip.minX <= spec.post.x - spec.sight + EPS || strip.maxX >= spec.post.x + spec.sight - EPS,
			`the strip is shorter than the ${nr(spec.sight)} m it should see over`,
		).toBeTrue();
	});

	describe.each([...TRAFFIC_CLASSES])('against %s', (kind) => {
		const admitted = barrierAdmits(spec, kind);
		const reached = driveAtBoom(spec, kind);
		const through = (reached - spec.post.x) * -spec.approachSide > 0;

		/**
		 * A permit nobody can present is no permit. The same rule as a `penetration` that cuts
		 * into nothing and an exemption row matching nothing: it is there, it does nothing, and
		 * it reads as policy.
		 */
		test('is admitted only if something announces itself as that', () => {
			if (!admitted) return;
			expect(ANNOUNCED.has(kind), `it admits ${kind}, but nothing in src/ ever announces itself as ${kind} at a boom`).toBeTrue();
		});

		test('is admitted only if that ever reaches its approach strip', () => {
			if (!admitted) return;
			expect(everPassesBy(spec, kind), `it admits ${kind}, but no ${kind} ever reaches its approach strip`).toBeTrue();
		});

		test('gets the answer the boom writes down', () => {
			expect(
				through,
				admitted
					? `it admits ${kind}, but that gets no further than x ${nr(reached)} (post at ${nr(spec.post.x)})`
					: `it does not admit ${kind}, and that drives through to x ${nr(reached)} anyway`,
			).toBe(admitted);
		});
	});
});
