import { describe, expect, test } from 'bun:test';
import { PARKING_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { geometryBounds, planBounds } from '#/data/spatial';
import type { MallWorldEntity } from '#/data/world';
import {
	ENTRANCE_SPEC,
	MOTORCYCLE_SPEC,
	PARKED_CAR_SPEC,
	PARKED_CAR_SPOTS,
	PARKED_MOTORCYCLE_SPOTS,
	PARKING_CEILING_SPEC,
	PARKING_DECK_ENTITY,
	PARKING_DECK_SPEC,
	PARKING_EXIT_CHEVRONS,
	PARKING_EXIT_HEADROOM,
	PARKING_EXIT_RAIL,
	PARKING_EXIT_RAIL_HEADS,
	PARKING_EXIT_RAIL_OUTER,
	PARKING_EXIT_RAMP,
	PARKING_EXIT_TRENCH,
	PARKING_EXIT_TRENCH_ENTITY,
	PARKING_EXIT_TRENCH_GUARDS,
	PARKING_EXIT_WALL_GAP,
	PARKING_WALL_PANELS,
	parkingExitRampY,
	parkingPaintPatches,
	parkingPillarCenters,
	parkingPillarFootprints,
	parkingStalls,
	RENTAL_CAR_SPEC,
	RENTAL_CAR_SPOTS,
	RIDEABLE_MOTORCYCLE_SPOTS,
} from '#/data/world';
import { WALK_STEP } from '#/physics/Collision';
import { JUMP_RISE, PLAYER_RADIUS } from '#/player/constants';
import { half, lerp, midpoint, span } from '#/util/math';
import { read } from './helpers/source-scan.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * The garage: the ramp you drive out of it, the shell that keeps the world outside, and the
 * paint and the parked cars that share the deck with its columns.
 *
 * Paint and cars are the reason half of this exists. Neither carries a collider, so no
 * placement rule in [spatial](src/data/spatial.ts) looks at them, and four cars stood 0.35 m
 * inside a concrete column while six bays ran straight through one.
 */

const P1 = levelY('p1');
const V0 = levelY('v0');
const BUILDER = await read('src/scene/ParkingGarage.ts');

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

function rectanglesOverlap(a: Rect, b: Rect): boolean {
	return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function footprintOf(spot: { x: number; z: number; yaw: number }, body: { width: number; length: number }): Rect {
	return planBounds({
		kind: 'rectangle',
		center: { x: spot.x, z: spot.z },
		width: body.width,
		depth: body.length,
		yaw: spot.yaw,
	});
}

describe('driving out of the garage', () => {
	const STEPS = 320;

	// The ramp lies diagonally in x and y, so the z-only ramp reading never saw it; this walks
	// it in player-sized steps and asks collision at every one whether the passage is open.
	test.each([
		['up', 1],
		['down', -1],
	] as const)('walking %s the exit ramp stays on the incline', (_way, direction) => {
		const faults: string[] = [];
		let currentY = direction === 1 ? PARKING_EXIT_RAMP.start.y : PARKING_EXIT_RAMP.end.y;
		for (let i = 0; i <= STEPS && faults.length === 0; i++) {
			const t = direction === 1 ? i / STEPS : 1 - i / STEPS;
			const x = lerp(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x, t);
			const z = lerp(PARKING_EXIT_RAMP.start.z, PARKING_EXIT_RAMP.end.z, t);
			const expected = lerp(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y, t);
			const ground = world.groundHeightAt(x, z, currentY, WALK_STEP);
			if (Math.abs(ground - expected) > 1e-4) {
				faults.push(`at (${nr(x)}, ${nr(z)}) collision answers ${nr(ground)} instead of ${nr(expected)}`);
				break;
			}
			const solved = world.resolveCircle(x, z, ground, PLAYER_RADIUS, 3, true, false);
			if (Math.hypot(solved.x - x, solved.z - z) > 1e-4) {
				faults.push(`the passage is blocked at (${nr(x)}, ${nr(z)}): pushed to (${nr(solved.x)}, ${nr(solved.z)})`);
			}
			currentY = ground;
		}
		expect(faults, faults.join('\n')).toBeEmpty();
	});
});

/**
 * A rotated box takes up its length times the cosine plus half its height times the sine. At
 * the mouth the rail comes out above street level, so anything reaching past the incline
 * there stands on the plaza like a knife. Only the mouth side is bounded: at the deck side
 * the rail deliberately runs on a little, because a rail stopping on that seam leaves a gap.
 */
describe('the rail along the exit', () => {
	const MARGIN = 1e-4;
	const halfSpanX =
		half(PARKING_EXIT_RAIL.length) * Math.abs(Math.cos(PARKING_EXIT_RAIL.angle)) +
		half(PARKING_EXIT_RAIL.height) * Math.abs(Math.sin(PARKING_EXIT_RAIL.angle));
	const mouth = PARKING_EXIT_RAMP.end.x;
	const deck = PARKING_EXIT_RAMP.start.x;

	test('stops at the mouth instead of running onto the plaza', () => {
		expect(PARKING_EXIT_RAIL.centerX - halfSpanX, 'the rail reaches past the mouth onto the plaza').toBeGreaterThanOrEqual(
			mouth - MARGIN,
		);
	});

	describe.each([-1, 1] as const)('on the %s side', (side) => {
		const midZ = side * PARKING_EXIT_RAIL.offsetZ;
		const head = PARKING_EXIT_RAIL_HEADS.find(
			(candidate) => midZ >= candidate.minZ - MARGIN && midZ <= candidate.maxZ + MARGIN && candidate.minX <= mouth + MARGIN,
		);

		test('the open end is capped', () => {
			expect(head, `the rail at z ${nr(midZ)} ends at the mouth with its end face open to the plaza`).toBeDefined();
		});

		test('the cap stays between the mouth and the deck', () => {
			if (!head) return;
			expect(head.minX, `the cap at z ${nr(midZ)} reaches past the mouth`).toBeGreaterThanOrEqual(mouth - MARGIN);
			expect(head.maxX, `the cap at z ${nr(midZ)} reaches past the deck`).toBeLessThanOrEqual(deck + MARGIN);
		});

		test('the cap covers the full height of the rail', () => {
			if (!head) return;
			expect(head.maxY, `the cap at z ${nr(midZ)} leaves the top of the rail open`).toBeGreaterThanOrEqual(
				PARKING_EXIT_RAMP.end.y + PARKING_EXIT_RAIL.height - MARGIN,
			);
		});
	});
});

/**
 * On the reported pose only a kerb-high retaining wall held the walker back; during a jump
 * that collision fell away and you dropped into the trench with no visible warning.
 */
describe('the fence along the open trench', () => {
	const POSE = { x: -37.2, z: -3.6, heading: 181 } as const;
	const STEP = 0.05;
	const guard = PARKING_EXIT_TRENCH_GUARDS.find(
		(candidate) => candidate.centerZ < 0 && POSE.x >= candidate.minX && POSE.x <= candidate.maxX,
	);

	test('exists on the pose it was reported from', () => {
		expect(guard, `no northern fence along the trench at (${nr(POSE.x)}, ${nr(POSE.z)})`).toBeDefined();
	});

	test('stands higher than a jump reaches', () => {
		if (!guard) return;
		expect(guard.maxY, `the fence reaches ${nr(guard.maxY)} and a jump reaches ${nr(V0 + JUMP_RISE)}`).toBeGreaterThanOrEqual(
			V0 + JUMP_RISE,
		);
	});

	test.each([
		['walking', V0],
		['jumping', V0 + JUMP_RISE],
	] as const)('%s into it does not get through', (_how, feetY) => {
		if (!guard) return;
		const yaw = (POSE.heading * Math.PI) / 180;
		let x: number = POSE.x;
		let z: number = POSE.z;
		for (let i = 0; i < 20; i++) {
			const solved = world.resolveCircle(
				x - Math.sin(yaw) * STEP,
				z - Math.cos(yaw) * STEP,
				feetY,
				PLAYER_RADIUS,
				3,
				true,
				feetY > V0,
				true,
			);
			x = solved.x;
			z = solved.z;
		}
		expect(z, `you end up at (${nr(x)}, ${nr(z)}), past the fence`).toBeLessThanOrEqual(guard.centerZ);
	});
});

/**
 * From P1 you looked straight out of the world in two places at once: the walls stopped 5 cm
 * under the ceiling and that seam ran all the way round, and outside the facade there is no
 * wall at all below street level, so through the mouth of the trench cars and towers floated
 * on the background colour.
 */
describe('the shell around P1', () => {
	const STEP = 0.25;
	/** Slack under the ceiling and above the deck where the shell still has to be solid. */
	const MARGIN = 0.05;
	const shell = [PARKING_DECK_ENTITY, PARKING_EXIT_TRENCH_ENTITY];
	const ceilingUnderside = P1 + PARKING_DECK_SPEC.ceiling.height - half(PARKING_DECK_SPEC.ceiling.thickness);
	const wallTop = P1 + PARKING_DECK_SPEC.clearHeight;
	const lintel = PARKING_WALL_PANELS.find((panel) => panel.id === 'west-head');

	function solidAt(entities: readonly MallWorldEntity[], x: number, y: number, z: number): boolean {
		return entities.some((entity) =>
			entity.volumes.some((volume) => {
				if (!volume.blocksMovement) return false;
				const b = geometryBounds(volume.geometry);
				return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
			}),
		);
	}

	test('the walls reach the ceiling', () => {
		expect(wallTop, 'the seam between wall top and ceiling is a gap running all the way round').toBeCloseTo(ceilingUnderside, 6);
	});

	test('the mouth has a lintel over it', () => {
		expect(lintel, 'the west wall has no lintel over the exit mouth, so the mouth runs up to the ceiling').toBeDefined();
	});

	test('the lintel leaves the driving height free', () => {
		if (!lintel) return;
		const needed = parkingExitRampY(PARKING_EXIT_TRENCH.maxX) + PARKING_EXIT_HEADROOM;
		expect(lintel.base, `the lintel starts at ${nr(lintel.base)} and leaves too little driving height`).toBeGreaterThanOrEqual(
			needed - EPS,
		);
	});

	test('the lintel is as wide as the mouth', () => {
		if (!lintel) return;
		expect(lintel.size.depth, 'the lintel does not cover the mouth').toBeCloseTo(
			span(-PARKING_EXIT_WALL_GAP, PARKING_EXIT_WALL_GAP),
			6,
		);
	});

	const wallX = half(PARKING_FOOTPRINT.width) - PARKING_DECK_SPEC.wall.inset;
	const wallZ = half(PARKING_FOOTPRINT.depth) - PARKING_DECK_SPEC.wall.inset;
	const heights = [P1 + MARGIN, midpoint(P1, ceilingUnderside), ceilingUnderside - MARGIN];
	const sides = [
		{ name: 'north', alongX: true, fixed: -wallZ, from: -half(PARKING_FOOTPRINT.width), to: half(PARKING_FOOTPRINT.width) },
		{ name: 'south', alongX: true, fixed: wallZ, from: -half(PARKING_FOOTPRINT.width), to: half(PARKING_FOOTPRINT.width) },
		{ name: 'east', alongX: false, fixed: wallX, from: -half(PARKING_FOOTPRINT.depth), to: half(PARKING_FOOTPRINT.depth) },
		{ name: 'west', alongX: false, fixed: -wallX, from: -half(PARKING_FOOTPRINT.depth), to: half(PARKING_FOOTPRINT.depth) },
	];

	test.each(sides.map((side) => side.name))('the %s facade is closed', (name) => {
		const side = sides.find((candidate) => candidate.name === name);
		if (!side || !lintel) return;
		const holes: string[] = [];
		for (let s = side.from; s <= side.to && holes.length === 0; s += STEP) {
			const x = side.alongX ? s : side.fixed;
			const z = side.alongX ? side.fixed : s;
			for (const y of heights) {
				const throughTheMouth = name === 'west' && Math.abs(z) <= PARKING_EXIT_WALL_GAP && y < lintel.base;
				if (throughTheMouth || solidAt(shell, x, y, z)) continue;
				holes.push(`a hole at (${nr(x)}, ${nr(z)}) at height ${nr(y)}`);
				break;
			}
		}
		expect(holes, holes.join('\n')).toBeEmpty();
	});

	test('the trench is walled over its whole length', () => {
		const bandZ = midpoint(PARKING_EXIT_RAIL_OUTER, PARKING_EXIT_WALL_GAP);
		const holes: string[] = [];
		for (let x = PARKING_EXIT_TRENCH.minX; x <= PARKING_EXIT_TRENCH.maxX && holes.length === 0; x += STEP) {
			const top = x < PARKING_EXIT_TRENCH.coverX ? PARKING_EXIT_TRENCH.skyTopY : PARKING_EXIT_TRENCH.coveredTopY;
			for (const z of [-bandZ, bandZ]) {
				for (const y of [PARKING_EXIT_TRENCH.baseY + MARGIN, parkingExitRampY(x), top - MARGIN]) {
					if (solidAt(shell, x, y, z)) continue;
					holes.push(`open at (${nr(x)}, ${nr(z)}) at height ${nr(y)}, so you look out under the world`);
					break;
				}
			}
		}
		expect(holes, holes.join('\n')).toBeEmpty();
	});

	/**
	 * The parking roof sits nearly a metre below the ground-floor slab, so a hollow layer runs
	 * over the whole footprint. Without a head over the covered part of the trench you look
	 * from the ramp into the mall, seventy-two metres under the floor.
	 */
	test('the cavity over the covered trench is closed', () => {
		const holes: string[] = [];
		const bandZ = [-PARKING_EXIT_RAIL_OUTER + MARGIN, 0, PARKING_EXIT_RAIL_OUTER - MARGIN];
		const heightsInCavity = [
			PARKING_CEILING_SPEC.topY + MARGIN,
			midpoint(PARKING_CEILING_SPEC.topY, PARKING_EXIT_TRENCH.coveredTopY),
			PARKING_EXIT_TRENCH.coveredTopY - MARGIN,
		];
		for (let x = PARKING_EXIT_TRENCH.coverX; x <= PARKING_EXIT_TRENCH.maxX && holes.length === 0; x += STEP) {
			for (const z of bandZ) {
				for (const y of heightsInCavity) {
					if (solidAt(shell, x, y, z)) continue;
					holes.push(`open at (${nr(x)}, ${nr(z)}) at height ${nr(y)}, so you look under the ground floor into the mall`);
					break;
				}
				if (holes.length > 0) break;
			}
		}
		expect(holes, holes.join('\n')).toBeEmpty();
	});

	test.each([-PARKING_EXIT_RAIL_OUTER, PARKING_EXIT_RAIL_OUTER])('the retaining wall at z %s pushes you back', (z) => {
		const x = midpoint(PARKING_EXIT_TRENCH.minX, PARKING_EXIT_TRENCH.coverX);
		const solved = world.resolveCircle(x, z, parkingExitRampY(x), PLAYER_RADIUS, 3, true, false, true);
		expect(
			Math.abs(solved.z),
			`nothing stops you on the edge of the exit at (${nr(x)}, ${nr(z)}); beside the ramp is a six metre drop`,
		).toBeLessThan(Math.abs(z));
	});
});

const PARKED_VEHICLES: [string, Rect][] = [
	...PARKED_CAR_SPOTS.map((spot, index): [string, Rect] => [`parked car ${index + 1}`, footprintOf(spot, PARKED_CAR_SPEC.body)]),
	...RENTAL_CAR_SPOTS.map((spot): [string, Rect] => [spot.name, footprintOf(spot, RENTAL_CAR_SPEC.body)]),
	// The bikes stand in the same row of bays and run into the same columns.
	...PARKED_MOTORCYCLE_SPOTS.map((spot, index): [string, Rect] => [
		`motorcycle ${index + 1}`,
		footprintOf(spot, MOTORCYCLE_SPEC.body),
	]),
	...RIDEABLE_MOTORCYCLE_SPOTS.map((spot): [string, Rect] => [spot.name, footprintOf(spot, MOTORCYCLE_SPEC.body)]),
];

describe('parked vehicles stand beside the columns, not in them', () => {
	const pillars = parkingPillarCenters().map((center, index) => ({
		index,
		center,
		rect: planBounds({
			kind: 'rectangle',
			center,
			width: PARKING_DECK_SPEC.pillar.width,
			depth: PARKING_DECK_SPEC.pillar.width,
			yaw: 0,
		}),
	}));

	test.each(PARKED_VEHICLES.map(([name]) => name))('%s', (name) => {
		const entry = PARKED_VEHICLES.find(([candidate]) => candidate === name);
		if (!entry) return;
		const hit = pillars.filter((pillar) => rectanglesOverlap(entry[1], pillar.rect));
		expect(
			hit,
			hit.map((pillar) => `stands in column ${pillar.index} at (${nr(pillar.center.x)}, ${nr(pillar.center.z)})`).join('\n'),
		).toBeEmpty();
	});
});

/**
 * Bays run every 5.2 m, the arrows on the centre aisle every 6 m and the columns every 8 m,
 * so paint and concrete drift in and out of each other. `parkingPaintPatches` cuts around
 * every column foot; cutting the bay away instead of the column is the same mistake in
 * reverse, so both directions are read.
 */
describe('the paint on the deck', () => {
	const patches = parkingPaintPatches();
	const feet = parkingPillarFootprints();

	test('there is paint at all', () => {
		expect(patches, 'parkingPaintPatches yields nothing, so the deck is bare').not.toBeEmpty();
	});

	test('no patch runs through a column foot', () => {
		const through: string[] = [];
		for (const patch of patches) {
			const paint = planBounds({ kind: 'rectangle', center: patch.center, width: patch.width, depth: patch.depth, yaw: 0 });
			for (const foot of feet) {
				if (span(Math.max(paint.minX, foot.minX), Math.min(paint.maxX, foot.maxX)) <= EPS) continue;
				if (span(Math.max(paint.minZ, foot.minZ), Math.min(paint.maxZ, foot.maxZ)) <= EPS) continue;
				through.push(
					`${patch.id} runs through the column foot at (${nr(midpoint(foot.minX, foot.maxX))}, ${nr(midpoint(foot.minZ, foot.maxZ))})`,
				);
			}
		}
		expect(through, through.join('\n')).toBeEmpty();
	});

	test.each(parkingStalls().map((stall) => stall.id))('bay %s keeps its striping', (id) => {
		expect(
			patches.some((patch) => patch.id.startsWith(`stall-${id}-`)),
			'the bay was cut away instead of the column',
		).toBeTrue();
	});

	test('the centre aisle still points at the exit', () => {
		expect(
			patches.some((patch) => patch.kind === 'lane'),
			'no arrow left on the centre aisle',
		).toBeTrue();
	});
});

/**
 * Four loose slats used to lie twenty centimetres over an incline that sank away underneath
 * them. A patch that really lies in the plane of the incline has the same distance to the
 * surface at all four corners, and that is `lift` over the cosine of the slope, because the
 * distance is measured along the normal and checked vertically.
 */
describe('the chevron patch on the exit ramp', () => {
	const MARGIN = 1e-4;
	const cos = Math.cos(PARKING_EXIT_CHEVRONS.angle);
	const expected = PARKING_EXIT_CHEVRONS.lift / cos;
	const corners = [-half(PARKING_EXIT_CHEVRONS.length), half(PARKING_EXIT_CHEVRONS.length)].flatMap((along) =>
		[-half(PARKING_EXIT_CHEVRONS.width), half(PARKING_EXIT_CHEVRONS.width)].map((across) => ({
			x: PARKING_EXIT_CHEVRONS.center.x + along * cos,
			y: PARKING_EXIT_CHEVRONS.center.y + along * Math.sin(PARKING_EXIT_CHEVRONS.angle),
			z: PARKING_EXIT_CHEVRONS.center.z + across,
		})),
	);

	test.each(corners.map((_corner, index) => index))('corner %s lies in the plane of the incline', (index) => {
		const corner = corners[index];
		if (!corner) return;
		const gap = corner.y - parkingExitRampY(corner.x);
		expect(gap, `the corner at (${nr(corner.x)}, ${nr(corner.z)}) hangs askew over the incline`).toBeCloseTo(expected, 4);
	});

	test.each(corners.map((_corner, index) => index))('corner %s stays on the incline', (index) => {
		const corner = corners[index];
		if (!corner) return;
		expect(corner.x, 'the patch reaches past the foot of the incline').toBeGreaterThanOrEqual(PARKING_EXIT_RAMP.end.x - MARGIN);
		expect(corner.x, 'the patch reaches past the top of the incline').toBeLessThanOrEqual(PARKING_EXIT_RAMP.start.x + MARGIN);
		expect(Math.abs(corner.z), 'the patch lies beside the incline').toBeLessThanOrEqual(half(PARKING_EXIT_RAMP.width) + MARGIN);
	});
});

test('the forecourt paving keeps the mouth of the trench open', () => {
	expect(
		ENTRANCE_SPEC.forecourt.north,
		`the paving starts at z ${nr(ENTRANCE_SPEC.forecourt.north)} and covers the open exit (to z ${nr(PARKING_EXIT_RAIL_OUTER)})`,
	).toBeGreaterThanOrEqual(PARKING_EXIT_RAIL_OUTER - 1e-4);
});

/**
 * The paint and the fences are data with no collider, so a builder that stops reading them
 * leaves every test above green with nothing on the deck.
 */
describe('the garage builder still draws what these tests measure', () => {
	test.each(['PARKING_EXIT_TRENCH_GUARDS', 'PARKING_EXIT_CHEVRONS', 'parkingPaintPatches(', "'← PARKING'"])(
		'it reads %s',
		async (fragment) => {
			expect(BUILDER.includes(fragment), `${fragment} is gone from the builder`).toBeTrue();
		},
	);
});
