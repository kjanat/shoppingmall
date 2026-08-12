import { describe, expect, test } from 'bun:test';
import { MALL_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { planBounds } from '#/data/spatial';
import { PARKING_EXIT_RAMP, THEATRE_PLAN } from '#/data/world';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import type { GarageDeck } from '#/scene/city/cityPlan';
import {
	CITY_GROUND_Y,
	CITY_KAVELS,
	deckDoorways,
	GARAGE_DECKS,
	GARAGE_PLAN,
	GARAGE_RAMP_FOOTPRINT,
	GARAGE_RAMP_LANDINGS,
	GARAGE_RAMP_RUNS,
	PLAZA_TRENCH_GAP,
	TOWER_SPECS,
} from '#/scene/city/cityPlan';
import { half, midpoint } from '#/util/math';
import { read } from './helpers/source-scan.ts';
import { followPolyline } from './helpers/walk.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * The city around the mall, walked rather than looked at.
 *
 * Every step here has been blocked once: the footprint clamp kept you on the roof,
 * `groundHeightAt` still answered ROOF forty metres beside the building, and the outer shell
 * ran up over the deck. The city had no collision at all: towers, theatre and garage were
 * scenery.
 */

const ROOF = levelY('roof');
const EDGE_X = half(MALL_FOOTPRINT.width);
const EDGE_Z = half(MALL_FOOTPRINT.depth);
/** How much pavement the spiral probe takes before it steps onto the lowest slab. */
const RUN_UP = 2;
/** One step onto a deck, past the parapet doorway. */
const ONTO_DECK = 1;

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

function overlaps(a: Rect, b: Rect): boolean {
	return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

test('the skyline is planned from the shared city plan', async () => {
	// A generator of its own beside it puts the towers next to their collision boxes.
	const source = await read('src/scene/city/CityBuildings.ts');
	expect(source.includes('planTowers(rand)'), 'the skyline no longer comes from the shared city plan').toBeTrue();
});

describe('the roof edge', () => {
	test.each([
		[EDGE_X - 0.5, 0],
		[-(EDGE_X - 0.5), 0],
		[0, EDGE_Z - 0.5],
		[0, -(EDGE_Z - 0.5)],
	])('inside the edge at (%d, %d) the roof carries you', (x, z) => {
		expect(world.groundHeightAt(x, z, ROOF, WALK_STEP)).toBeCloseTo(ROOF, 6);
	});

	test.each([
		[EDGE_X + 1.5, 0],
		[-(EDGE_X + 1.5), 0],
		[0, EDGE_Z + 1.5],
		[0, -(EDGE_Z + 1.5)],
	])('beside the roof at (%d, %d) nothing pushes you back', (x, z) => {
		const solved = world.resolveCircle(x, z, ROOF, PLAYER_RADIUS, 3, true, true, true);
		expect(
			Math.hypot(solved.x - x, solved.z - z),
			'the outer shell pushes you back at roof height, so stepping over the edge is impossible',
		).toBeLessThanOrEqual(EPS);
	});

	/**
	 * What lies below is a second question, and due west that is the mouth of the exit trench:
	 * the paving is open there down to the ramp six metres lower. The facade test measures that
	 * gap itself; only this question steps around it.
	 */
	test.each(
		(
			[
				[EDGE_X + 1.5, 0],
				[-(EDGE_X + 1.5), 0],
				[0, EDGE_Z + 1.5],
				[0, -(EDGE_Z + 1.5)],
			] as [number, number][]
		).map(([x, z]): [number, number] => (x < 0 && z === 0 ? [x, PLAZA_TRENCH_GAP.maxZ + 1.5] : [x, z])),
	)('beside the roof at (%d, %d) there is street below', (x, z) => {
		expect(world.groundHeightAt(x, z, ROOF, WALK_STEP), 'you would be walking on air').toBeCloseTo(CITY_GROUND_Y, 6);
	});
});

describe.each(TOWER_SPECS.map((_tower, index) => index))('tower %d', (index) => {
	const tower = TOWER_SPECS[index];
	if (!tower) throw new Error(`no tower ${index}`);
	const footprint = planBounds({ kind: 'rectangle', center: { x: tower.x, z: tower.z }, width: tower.w, depth: tower.d, yaw: 0 });

	test('stops a body', () => {
		const solved = world.resolveCircle(tower.x, tower.z, CITY_GROUND_Y + 1, PLAYER_RADIUS, 3, true, false, true);
		expect(Math.hypot(solved.x - tower.x, solved.z - tower.z), 'you walk straight through it').toBeGreaterThan(EPS);
	});

	test('stands on no reserved plot', () => {
		const trespassing = Object.entries(CITY_KAVELS)
			.filter(([, plot]) => overlaps(footprint, plot))
			.map(([name]) => `it stands on the ${name} plot`);
		expect(trespassing, trespassing.join('\n')).toBeEmpty();
	});
});

describe.each([
	['the auditorium block', THEATRE_PLAN.hall, 'theatre'],
	['the theatre podium', THEATRE_PLAN.podium, 'theatre'],
	['the parking garage', GARAGE_PLAN.footprint, 'garage'],
	['the outer spiral of the garage', GARAGE_RAMP_FOOTPRINT, 'garage'],
] as const)('%s', (_what, rect, plot) => {
	test(`stays inside the ${plot} plot`, () => {
		const bounds = CITY_KAVELS[plot];
		expect(rect.minX, 'it reaches west of its plot').toBeGreaterThanOrEqual(bounds.minX);
		expect(rect.maxX, 'it reaches east of its plot').toBeLessThanOrEqual(bounds.maxX);
		expect(rect.minZ, 'it reaches north of its plot').toBeGreaterThanOrEqual(bounds.minZ);
		expect(rect.maxZ, 'it reaches south of its plot').toBeLessThanOrEqual(bounds.maxZ);
	});
});

test('no city surface reaches into the mall', () => {
	const inside = world.citySurfaces.flatMap((surface) =>
		(
			[
				[surface.minX, surface.minZ],
				[surface.maxX, surface.maxZ],
			] as [number, number][]
		)
			.filter(([x, z]) => world.insideMallPlan(x, z))
			.map(([x, z]) => `city surface ${surface.label} reaches into the mall at (${nr(x)}, ${nr(z)})`),
	);
	expect(inside, inside.join('\n')).toBeEmpty();
});

describe('the theatre stair', () => {
	const stair = THEATRE_PLAN.stair;
	const x = midpoint(stair.minX, stair.maxX);
	const from = stair.zTop + stair.treads * stair.tread + 0.5;
	const to = THEATRE_PLAN.podium.maxZ - 1;

	const climb = ((): { complaint: string | null; y: number } => {
		let y = CITY_GROUND_Y;
		for (let z = from; z >= to; z -= 0.05) {
			const ground = world.groundHeightAt(x, z, y, WALK_STEP);
			if (ground - y > WALK_STEP) {
				return { complaint: `at z ${nr(z)} the next tread is ${nr(ground - y)} m high, more than one step`, y };
			}
			const solved = world.resolveCircle(x, z, ground, PLAYER_RADIUS, 3, true, false, true);
			if (Math.hypot(solved.x - x, solved.z - z) > 1e-4) {
				return { complaint: `at z ${nr(z)} collision pushes you to (${nr(solved.x)}, ${nr(solved.z)})`, y };
			}
			y = ground;
		}
		return { complaint: null, y };
	})();

	test('climbs one tread at a time', () => {
		expect(climb.complaint ?? '').toBe('');
	});

	test('ends on the podium', () => {
		expect(climb.y, `the stair ends at ${nr(climb.y)}`).toBeCloseTo(THEATRE_PLAN.podiumY, 6);
	});
});

describe.each([
	[66, 51],
	[76, 59],
])('the garage ground deck at (%d, %d)', (x, z) => {
	const ground = world.groundHeightAt(x, z, CITY_GROUND_Y, WALK_STEP);

	test('is the floor there', () => {
		expect(ground, `the floor is ${nr(ground)}`).toBeCloseTo(GARAGE_PLAN.groundDeckY, 6);
	});

	test('lets a body stand on it', () => {
		const solved = world.resolveCircle(x, z, ground, PLAYER_RADIUS, 3, true, false, true);
		expect(Math.hypot(solved.x - x, solved.z - z), 'collision pushes you off the deck').toBeLessThanOrEqual(EPS);
	});
});

/**
 * The outer spiral around the south-east corner: from the pavement by the south slab, over the
 * corner landing and the east slab, up to the landing on deck 2. The slabs were scenery — flat
 * city surfaces cannot be an incline, so you walked straight through them to the ground.
 */
describe('the garage spiral', () => {
	const southSlab = GARAGE_RAMP_RUNS[0];
	const eastSlab = GARAGE_RAMP_RUNS[1];
	const topLanding = GARAGE_RAMP_LANDINGS[1];

	test('still has two sloping slabs and two landings', () => {
		expect(GARAGE_RAMP_RUNS.length, 'the spiral lost a sloping slab').toBeGreaterThanOrEqual(2);
		expect(GARAGE_RAMP_LANDINGS.length, 'the spiral lost a landing').toBeGreaterThanOrEqual(2);
	});

	test('can be climbed from the pavement to the landing on deck 2', () => {
		if (!southSlab || !eastSlab || !topLanding) return;
		const trip = followPolyline(
			[
				[southSlab.start.x - RUN_UP, southSlab.start.z],
				[southSlab.end.x, southSlab.end.z],
				[eastSlab.start.x, southSlab.end.z],
				[eastSlab.start.x, midpoint(topLanding.minZ, topLanding.maxZ)],
			],
			CITY_GROUND_Y,
		);
		expect(trip.complaint ?? '').toBe('');
		expect(trip.y, `the climb ends at ${nr(trip.y)} instead of on the landing (${nr(topLanding.y)})`).toBeCloseTo(
			topLanding.y,
			6,
		);
	});
});

/**
 * The parapet used to run as an unbroken ring around each deck, along the seam where the spiral
 * arrives as well, so whoever climbed it stood in front of a metre of wall and only a jump got
 * him over. Each landing cuts its own doorway out of that ring.
 */
function deckBeside(landing: GarageDeck): GarageDeck | null {
	return (
		GARAGE_DECKS.find(
			(candidate) => Math.abs(candidate.y - landing.y) <= EPS && Math.abs(candidate.maxX - landing.minX) <= EPS,
		) ?? null
	);
}

describe.each(GARAGE_RAMP_LANDINGS.map((landing) => landing.id))('the landing %s', (id) => {
	const landing = GARAGE_RAMP_LANDINGS.find((candidate) => candidate.id === id);
	const deck = landing ? deckBeside(landing) : null;

	test('has a doorway in the parapet of the deck beside it', () => {
		if (!landing || !deck) return;
		expect(deckDoorways(deck), `${id} lies against ${deck.id} with no doorway: only a jump gets you onto it`).not.toBeEmpty();
	});

	test('lets you step through onto that deck', () => {
		if (!landing || !deck) return;
		const wrong: string[] = [];
		for (const doorway of deckDoorways(deck)) {
			const z = midpoint(doorway.minZ, doorway.maxZ);
			const trip = followPolyline(
				[
					[midpoint(landing.minX, landing.maxX), z],
					[deck.maxX - ONTO_DECK, z],
				],
				landing.y,
			);
			if (trip.complaint !== null) wrong.push(`${id} to ${deck.id}: ${trip.complaint}`);
			else if (Math.abs(trip.y - deck.y) > EPS) {
				wrong.push(`from ${id} you end up at ${nr(trip.y)} instead of on ${deck.id} (${nr(deck.y)})`);
			}
		}
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});
});

describe.each(GARAGE_DECKS.map((deck) => deck.id))('parking deck %s', (id) => {
	const deck = GARAGE_DECKS.find((candidate) => candidate.id === id);
	if (!deck) throw new Error(`no deck ${id}`);
	const x = midpoint(deck.minX, deck.maxX);

	test('is walkable in the middle', () => {
		expect(world.groundHeightAt(x, midpoint(deck.minZ, deck.maxZ), deck.y, WALK_STEP)).toBeCloseTo(deck.y, 6);
	});

	test('keeps you on it at the parapet', () => {
		const edge = deck.maxZ - half(GARAGE_PLAN.parapet.thickness);
		const solved = world.resolveCircle(x, edge, deck.y, PLAYER_RADIUS, 3, true, false, true);
		expect(solved.z, `the parapet at z ${nr(deck.maxZ)} does not hold you`).toBeLessThan(edge);
	});
});

/**
 * From the pavement into the exit. This was the only way back inside; with the main entrance
 * standing it is the second, and the roof loop walks that one.
 */
describe('walking down the exit ramp from the street', () => {
	const z = PARKING_EXIT_RAMP.start.z;
	const walk = ((): { complaint: string | null; y: number } => {
		let y = CITY_GROUND_Y;
		for (let x = -52; x <= PARKING_EXIT_RAMP.start.x; x += 0.05) {
			const ground = world.groundHeightAt(x, z, y, WALK_STEP);
			if (Math.abs(ground - y) > WALK_STEP) {
				return { complaint: `at x ${nr(x)} the floor jumps from ${nr(y)} to ${nr(ground)}`, y };
			}
			const solved = world.resolveCircle(x, z, ground, PLAYER_RADIUS, 3, true, false, true);
			if (Math.hypot(solved.x - x, solved.z - z) > 1e-4) {
				return { complaint: `at x ${nr(x)} collision pushes you to (${nr(solved.x)}, ${nr(solved.z)})`, y };
			}
			y = ground;
		}
		return { complaint: null, y };
	})();

	test('is walkable the whole way', () => {
		expect(walk.complaint ?? '').toBe('');
	});

	test('ends on the parking floor', () => {
		expect(walk.y, `it ends at ${nr(walk.y)}`).toBeCloseTo(PARKING_EXIT_RAMP.start.y, 3);
	});
});

/**
 * The exemption is per call. Without it a sim still stands inside the footprint; through
 * `boundsMode` the whole mall would walk outside.
 */
describe('the outdoor exemption', () => {
	test('a sim without it stays inside the footprint', () => {
		const sim = world.resolveCircle(51.5, 0, 0.5, 0.35, 3, false, false, false);
		expect(Math.abs(sim.x), `a sim reaches x ${nr(sim.x)}, outside the footprint`).toBeLessThanOrEqual(EDGE_X);
		expect(Math.abs(sim.z), `a sim reaches z ${nr(sim.z)}, outside the footprint`).toBeLessThanOrEqual(EDGE_Z);
	});

	test('the player with it is not clamped after all', () => {
		const player = world.resolveCircle(51.5, 0, 0.5, PLAYER_RADIUS, 3, true, false, true);
		expect(
			Math.hypot(player.x - 51.5, player.z),
			`the player is clamped to (${nr(player.x)}, ${nr(player.z)})`,
		).toBeLessThanOrEqual(EPS);
	});
});
