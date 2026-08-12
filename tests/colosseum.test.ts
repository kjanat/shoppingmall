import { describe, expect, test } from 'bun:test';
import { CollisionWorld, WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { CITY_GROUND_Y, COLOSSEUM_PLAN } from '#/scene/city/cityPlan';
import { half, lerp } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';
import { WALK_PROBE_STEP } from './helpers/walk.ts';
import { nr } from './helpers/world.ts';

/**
 * The colosseum: the shell is closed except for its two gates.
 *
 * Whether it reads as a colosseum sits in the picture and a screenshot judges that. What a test
 * holds is the promise underneath: the elliptical ring stops a pedestrian, bar the two axial
 * gates, and through such a gate you walk over the podium opening onto the sand. The old shell
 * had only a north and a south strip, so from the side you walked straight through it. This is
 * the counterpart of the theatre: getting in through the gate, and not getting in beside it.
 */

const { x: CX, z: CZ, radiusX, radiusZ, arenaRadiusX, arenaRadiusZ, wallHeight } = COLOSSEUM_PLAN;
/** Below this many boxes the facade ring is not a closed shell. */
const RING_BOXES = 24;
/** How close to the heart of the arena a walk through the gate has to come. */
const HEART = 1;

stubDocument();
const THREE = await import('three');
const { CityColosseum } = await import('#/scene/city/CityColosseum');

const colosseumWorld = new CollisionWorld();
const structure = new CityColosseum(colosseumWorld);

/** One pedestrian walking a straight line in this world of its own. */
function walk(fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number; stopped: boolean } {
	const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toZ - fromZ) / WALK_PROBE_STEP));
	let x = fromX;
	let z = fromZ;
	for (let step = 1; step <= steps; step++) {
		const t = step / steps;
		const wantX = lerp(fromX, toX, t);
		const wantZ = lerp(fromZ, toZ, t);
		const ground = colosseumWorld.groundHeightAt(wantX, wantZ, CITY_GROUND_Y, WALK_STEP);
		const solved = colosseumWorld.resolveCircle(wantX, wantZ, ground, PLAYER_RADIUS, 3, true, false, true);
		if (Math.hypot(solved.x - wantX, solved.z - wantZ) > 1e-4) return { x, z, stopped: true };
		x = wantX;
		z = wantZ;
	}
	return { x, z, stopped: false };
}

test('the facade ring is a closed shell', () => {
	// Without it the rest of this file is empty.
	const boxes = colosseumWorld.boxes.filter((box) => box.label === 'colosseum_facade').length;
	expect(boxes, `the ring counts only ${boxes} collision boxes`).toBeGreaterThanOrEqual(RING_BOXES);
});

describe.each([
	['the eastern flank', 1],
	['the western flank', -1],
] as const)('%s', (_what, side) => {
	const report = walk(CX + side * (radiusX + 2), CZ, CX, CZ);

	test('stops a pedestrian', () => {
		expect(
			report.stopped,
			`the pedestrian walks through the shell to (${nr(report.x)}, ${nr(report.z)}): the ring leaks`,
		).toBeTrue();
	});

	test('stops him outside the arena', () => {
		if (!report.stopped) return;
		expect(
			Math.abs(report.x - CX),
			`he reaches (${nr(report.x)}, ${nr(report.z)}), inside the arena: the shell stops him too late`,
		).toBeGreaterThanOrEqual(arenaRadiusX);
	});
});

describe('the northern gate', () => {
	const report = walk(CX, CZ - radiusZ + 0.5, CX, CZ);

	test('lets a pedestrian in', () => {
		expect(report.stopped, `he strands at (${nr(report.x)}, ${nr(report.z)}) instead of reaching the sand`).toBeFalse();
	});

	test('leads to the heart of the arena', () => {
		expect(
			Math.hypot(report.x - CX, report.z - CZ),
			`the walk ends at (${nr(report.x)}, ${nr(report.z)}), not in the heart`,
		).toBeLessThanOrEqual(HEART);
	});

	test('the arena floor lies at sand level', () => {
		const sand = colosseumWorld.groundHeightAt(CX, CZ, CITY_GROUND_Y, WALK_STEP);
		expect(Math.abs(sand - CITY_GROUND_Y), `the arena floor lies at ${nr(sand)}`).toBeLessThanOrEqual(WALK_STEP);
	});
});

/**
 * An amphitheatre is open to the sky. A closed CylinderGeometry lays its cap as a disc over the
 * full diameter, and that put a lid at 7.65 m over the arena. A ray straight up out of the heart
 * and a few arena points may hit no mesh of the structure below crown height.
 */
describe('the column to the sky is open', () => {
	structure.group.updateMatrixWorld(true);
	const up = new THREE.Vector3(0, 1, 0);
	const ray = new THREE.Raycaster();
	ray.near = 0;
	ray.far = wallHeight + 5;

	test.each([
		[CX, CZ],
		[CX + half(arenaRadiusX), CZ],
		[CX - half(arenaRadiusX), CZ],
		[CX, CZ + half(arenaRadiusZ)],
		[CX, CZ - half(arenaRadiusZ)],
	])('over the arena at (%s, %s)', (x, z) => {
		ray.set(new THREE.Vector3(x, 1, z), up);
		const lid = ray.intersectObject(structure.group, true).find((hit) => hit.point.y < wallHeight - 0.01);
		expect(
			lid,
			lid
				? `a lid lies at y ${nr(lid.point.y)} (${lid.object.name || lid.object.type}), under the crown at ${nr(wallHeight)}`
				: '',
		).toBeUndefined();
	});
});
