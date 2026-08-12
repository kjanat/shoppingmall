import { describe, expect, test } from 'bun:test';
import { levelAt, levelY } from '#/data/levels';
import type { Bounds3, CardinalSide } from '#/data/spatial';
import { geometryBounds } from '#/data/spatial';
import type { FacadePanel } from '#/data/world';
import {
	BACKSTAGE_CORRIDOR,
	BACKSTAGE_FLOOR_Y,
	BACKSTAGE_INTERIOR,
	BACKSTAGE_LANDING,
	THEATRE_AISLES,
	THEATRE_ARTIST_PORTAL,
	THEATRE_BACKSTAGE_DOORS_ENTITY,
	THEATRE_ENTRANCE_ENTITY,
	THEATRE_FLOOR_Y,
	THEATRE_FOYER_ENTITY,
	THEATRE_INTERIOR,
	THEATRE_LABEL,
	THEATRE_PLAN,
	THEATRE_PORTAL,
	THEATRE_SEATING_ENTITY,
	THEATRE_STAGE_FRONT_Z,
	THEATRE_STAGE_TOP_Y,
	theatreOpeningWithin,
	theatreRowBank,
	theatreRowDeck,
	theatreRowY,
	theatreSeatBanks,
	theatreSeatXs,
} from '#/data/world';
import type { ZoneId } from '#/data/zones';
import { reachableZones, ZONE_ENCLOSURES, ZONE_PORTALS, zoneAt, zoneMaskOfBounds, zonesOfMask } from '#/data/zones';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { minimapLabelPlan } from '#/ui/KioskOverlay';
import { half, lerp, midpoint } from '#/util/math';
import { at } from '#/util/rand';
import { stubDocument, stubTextMeasure } from './helpers/stub-dom.ts';
import { followPolyline, WALK_PROBE_STEP } from './helpers/walk.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * The theatre, walked the way the player walks it.
 *
 * The block was a facade with doors painted on. What it is now sits in four places at once: the
 * bay in the facade spec, the boxes in Collision, the volumes in the world model and the zone
 * behind it. This asks whether you really get in, and its counterpart — beside the doors nobody
 * gets in — because without that half a theatre without walls passes just as well.
 */

const V0 = levelY('v0');
/** Where the walk starts: on the podium, well before the threshold. */
const START_Z = midpoint(THEATRE_PLAN.podium.minZ, THEATRE_PLAN.podium.maxZ);
/** And how far in it has to get: to the front row, at the bottom of the aisle. */
const TARGET_Z = midpoint(theatreRowDeck(THEATRE_PLAN.seating.rows - 1).minZ, theatreRowBank(THEATRE_PLAN.seating.rows - 1).minZ);
/** Between the colonnade and the facade: where a walk that tests the facade itself starts. */
const FRONTAGE_Z = THEATRE_PLAN.columns.z - THEATRE_PLAN.columns.radius - PLAYER_RADIUS - 0.1;
/** How far out of the corner the closed facade is probed: beside the outermost column. */
const FACADE_INSET = 1.5;
/** The clearance in which two buildings do not yet touch. Below it one box shares them. */
const BUILDINGS_APART = 1;
/** How far in front of the building the camera stands, and how far it looks away from the hall. */
const VIEW_DISTANCE = 4;
const LOOK_FAR = 40;

stubDocument();
const THREE = await import('three');
const [{ LightPool }, { CityTheatre }, { ZoneCuller }] = await Promise.all([
	import('#/render/LightPool'),
	import('#/scene/city/CityTheatre'),
	import('#/render/ZoneCuller'),
]);

const HALL_X = THEATRE_PORTAL.centerX;
const AISLE_X = midpoint(at(THEATRE_AISLES, 0).minX, at(THEATRE_AISLES, 0).maxX);
const FOYER_Z = midpoint(THEATRE_INTERIOR.maxZ - THEATRE_PLAN.foyer.depth, THEATRE_INTERIOR.maxZ);

describe('walking in through the bay', () => {
	const walk = followPolyline(
		[
			[HALL_X, START_Z],
			[HALL_X, FOYER_Z],
			[AISLE_X, FOYER_Z],
			[AISLE_X, TARGET_Z],
		],
		THEATRE_FLOOR_Y,
	);

	test('is never obstructed', () => {
		expect(walk.complaint ?? '').toBe('');
	});

	test('ends inside the auditorium zone', () => {
		expect(zoneAt(walk.x, walk.y, walk.z), `it ends at (${nr(walk.x)}, ${nr(walk.z)})`).toBe('theatre');
	});
});

/**
 * The edge between the front row and the stage is a wall, not a fall. The hall floor steps down
 * to the front row and the stage stands well over it; the stage is a walking surface without a
 * collision box, so whoever walked over the edge found no reachable floor and dropped through to
 * street level, stuck between the seats.
 */
describe('the edge between the front row and the stage', () => {
	const frontRowY = theatreRowY(THEATRE_PLAN.seating.rows - 1);
	const stageZ = midpoint(THEATRE_INTERIOR.minZ, THEATRE_STAGE_FRONT_Z);
	const steps = Math.max(1, Math.ceil(Math.abs(stageZ - TARGET_Z) / WALK_PROBE_STEP));
	const walk = ((): { fellThrough: { z: number; y: number } | null; y: number; z: number } => {
		let y = frontRowY;
		let z = TARGET_Z;
		for (let step = 1; step <= steps; step++) {
			const wantZ = lerp(TARGET_Z, stageZ, step / steps);
			const ground = world.groundHeightAt(AISLE_X, wantZ, y, WALK_STEP);
			const solved = world.resolveCircle(AISLE_X, wantZ, ground, PLAYER_RADIUS, 3, true, false, true);
			// The wall holding you is exactly what should happen.
			if (Math.hypot(solved.x - AISLE_X, solved.z - wantZ) > 1e-4) break;
			if (ground < frontRowY - WALK_STEP) return { fellThrough: { z: wantZ, y: ground }, y, z };
			z = wantZ;
			y = ground;
		}
		return { fellThrough: null, y, z };
	})();

	test('is not a hole to fall through', () => {
		const message = walk.fellThrough
			? `at z ${nr(walk.fellThrough.z)} the floor drops to ${nr(walk.fellThrough.y)} instead of holding you`
			: '';
		expect(walk.fellThrough, message).toBeNull();
	});

	test('leaves you on the row or on the stage', () => {
		if (walk.fellThrough) return;
		expect(
			Math.abs(walk.y - frontRowY) <= WALK_STEP || Math.abs(walk.y - THEATRE_STAGE_TOP_Y) <= WALK_STEP,
			`you end at ${nr(walk.y)} at z ${nr(walk.z)}, neither the row nor the stage`,
		).toBeTrue();
	});
});

/**
 * Beside the bay nobody gets in: not through a sidelight, which is glass to the eye and wall to
 * the body, and not through the closed facade next to it. Started from the frontage line rather
 * than the podium, because the colonnade stands in front and every one of these three would run
 * into a column, proving the portico is in the way instead of the facade being closed.
 */
describe.each([
	['the western sidelight', midpoint(THEATRE_PORTAL.minX, THEATRE_PORTAL.doorMinX)],
	['the eastern sidelight', midpoint(THEATRE_PORTAL.doorMaxX, THEATRE_PORTAL.maxX)],
	['the closed south facade', THEATRE_PLAN.hall.minX + FACADE_INSET],
] as const)('%s', (_what, x) => {
	test('lets nobody into the hall', () => {
		const across = followPolyline(
			[
				[x, FRONTAGE_Z],
				[x, FOYER_Z],
			],
			THEATRE_FLOOR_Y,
		);
		expect(zoneAt(x, across.y, across.z), `the pedestrian walks to z ${nr(across.z)}, into the hall`).not.toBe('theatre');
	});
});

/**
 * The walks above each run on one line and cannot see a three-metre hole two metres beside them;
 * the opening the zone graph reads off the facade is the whole facade at once. Exactly one hole,
 * and that is the bay.
 */
describe('the shell', () => {
	const wholeFacade = (minU: number, maxU: number): FacadePanel => ({
		minU,
		maxU,
		minY: THEATRE_PLAN.baseY,
		maxY: THEATRE_PLAN.hallHeight,
	});
	const northZ = THEATRE_PLAN.hall.minZ - THEATRE_PLAN.backstage.depth;

	const closedSides: CardinalSide[] = ['west', 'east'];

	test.each(closedSides)('is closed on the %s', (side) => {
		const opening = theatreOpeningWithin(
			side,
			wholeFacade(northZ + THEATRE_PLAN.wallThickness, THEATRE_PLAN.hall.maxZ - THEATRE_PLAN.wallThickness),
		);
		expect(opening, `the ${side} facade stands open from ${nr(opening?.minU ?? 0)} to ${nr(opening?.maxU ?? 0)}`).toBeNull();
	});

	describe('the bay in the south facade', () => {
		const bay = theatreOpeningWithin('south', wholeFacade(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX));

		test('exists', () => {
			expect(bay, 'the south facade is closed, so there is no bay at all').not.toBeNull();
		});

		test('is the portal, at the height the doors declare', () => {
			if (!bay) return;
			expect(bay.minU, 'the bay starts elsewhere than the portal').toBeCloseTo(THEATRE_PORTAL.minX, 6);
			expect(bay.maxU, 'the bay ends elsewhere than the portal').toBeCloseTo(THEATRE_PORTAL.maxX, 6);
			expect(bay.maxY, 'the bay reaches to another height than the door head').toBeCloseTo(
				THEATRE_FLOOR_Y + THEATRE_PLAN.doors.headY,
				6,
			);
		});
	});

	describe('the artist entrance in the north facade', () => {
		const opening = theatreOpeningWithin('north', wholeFacade(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX));
		const head = BACKSTAGE_FLOOR_Y + THEATRE_PLAN.backstage.door.headY;

		test('exists', () => {
			expect(opening, 'the north facade is closed, so there is no artist entrance').not.toBeNull();
		});

		test('sits over the backstage corridor at stage height', () => {
			if (!opening) return;
			expect(opening.minU).toBeCloseTo(THEATRE_ARTIST_PORTAL.minX, 6);
			expect(opening.maxU).toBeCloseTo(THEATRE_ARTIST_PORTAL.maxX, 6);
			expect(opening.maxY).toBeCloseTo(head, 6);
		});
	});
});

function overlaps3(a: Bounds3, b: Bounds3): boolean {
	return (
		a.minX < b.maxX - EPS &&
		b.minX < a.maxX - EPS &&
		a.minY < b.maxY - EPS &&
		b.minY < a.maxY - EPS &&
		a.minZ < b.maxZ - EPS &&
		b.minZ < a.maxZ - EPS
	);
}

describe('the seating', () => {
	const aisles = THEATRE_FOYER_ENTITY.volumes.filter((volume) => volume.role === 'aisle-clearance');

	test('has aisles kept clear at all', () => {
		expect(aisles, 'the hall has no aisle volume, so no floor is kept free').not.toBeEmpty();
	});

	// The banks are cut out of the row by the aisles, so this should hold by construction — and
	// that is exactly why it is measured: one bank writing down its own width empties the hall.
	test('stands out of the aisles', () => {
		const blocking = THEATRE_SEATING_ENTITY.volumes.flatMap((bank) =>
			aisles
				.filter((aisle) => overlaps3(geometryBounds(bank.geometry), geometryBounds(aisle.geometry)))
				.map((aisle) => `${THEATRE_SEATING_ENTITY.id}.${bank.id} stands in aisle ${THEATRE_FOYER_ENTITY.id}.${aisle.id}`),
		);
		expect(blocking, blocking.join('\n')).toBeEmpty();
	});

	test.each(theatreSeatBanks().map((bank) => bank.id))('every seat of %s stands on its own row', (id) => {
		const bank = theatreSeatBanks().find((candidate) => candidate.id === id);
		if (!bank) return;
		const floor = theatreRowY(bank.row);
		const strip = theatreRowBank(bank.row);
		const wrong = theatreSeatXs(bank).flatMap((x) => {
			const complaints: string[] = [];
			if (x < bank.minX || x > bank.maxX) {
				complaints.push(`a seat at x ${nr(x)} stands outside its own bank (${nr(bank.minX)}..${nr(bank.maxX)})`);
			}
			const ground = world.groundHeightAt(x, midpoint(strip.minZ, strip.maxZ), floor, WALK_STEP);
			if (Math.abs(ground - floor) > 1e-6) {
				complaints.push(`a seat at x ${nr(x)} stands at ${nr(floor)} while the floor there is ${nr(ground)}`);
			}
			return complaints;
		});
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});
});

/**
 * What stands in the hall belongs to the hall alone. `accepts` gets the mask
 * `zoneMaskOfBounds` makes of the box, so a hall claiming the city as well is drawn from across
 * the street, seats and all.
 */
const SEAT_MASK = zoneMaskOfBounds(geometryBounds(at(THEATRE_SEATING_ENTITY.volumes, 0).geometry));

test('a bank of seats claims the auditorium and nothing else', () => {
	expect(zonesOfMask(SEAT_MASK).join(' and '), 'the seats claim more than the auditorium').toBe('theatre');
});

/**
 * Exactly two openings tie the hall to the city — the bay at the front and the artist entrance
 * at the back. The door from the stage lies inside the zone and is therefore no portal.
 */
describe('the zone graph around the auditorium', () => {
	const portals = ZONE_PORTALS.filter((portal) => zonesOfMask(portal.mask).includes('theatre'));
	const expected = [THEATRE_ENTRANCE_ENTITY.id, THEATRE_BACKSTAGE_DOORS_ENTITY.id];

	test('hangs on exactly those two portals', () => {
		expect(portals.map((portal) => portal.id).toSorted(), 'the hall hangs on other portals').toEqual(expected.toSorted());
	});

	test.each(expected)('%s sees both ways', (id) => {
		const portal = portals.find((candidate) => candidate.id === id);
		for (const [from, to] of [
			['stad', 'theatre'],
			['theatre', 'stad'],
		] as [ZoneId, ZoneId][]) {
			expect(
				portal?.faces.some((face) => face.from === from && face.to === to),
				`${id} gives no view from ${from} to ${to}`,
			).toBeTrue();
		}
	});

	test('the shop floor is reachable from the hall', () => {
		expect(reachableZones('theatre').includes('mall-v0'), 'no portal route from the hall to the shops').toBeTrue();
	});
});

/**
 * `zoneMaskOfBounds` reads the city off "fits in no single building", and that answer holds only
 * as long as no box fits in the union of two shells without fitting in one of them.
 */
describe('the gap between the buildings', () => {
	const pairs = ZONE_ENCLOSURES.flatMap((a, i) => ZONE_ENCLOSURES.slice(i + 1).map((b) => [a, b] as const));

	test.each(pairs.map(([a, b]) => `${a.id} and ${b.id}`))('%s', (name) => {
		const pair = pairs.find(([a, b]) => `${a.id} and ${b.id}` === name);
		if (!pair) return;
		const [a, b] = pair;
		const gap = Math.max(
			a.plan.minX - b.plan.maxX,
			b.plan.minX - a.plan.maxX,
			a.plan.minZ - b.plan.maxZ,
			b.plan.minZ - a.plan.maxZ,
		);
		expect(gap, `they stand ${nr(gap)} m apart; below ${nr(BUILDINGS_APART)} m one box shares them`).toBeGreaterThanOrEqual(
			BUILDINGS_APART,
		);
	});
});

describe('the artist entrance', () => {
	const landingZ = midpoint(BACKSTAGE_LANDING.minZ, BACKSTAGE_LANDING.maxZ);
	const corridorZ = midpoint(BACKSTAGE_INTERIOR.minZ, BACKSTAGE_INTERIOR.maxZ);
	const dressingX = midpoint(BACKSTAGE_INTERIOR.minX, BACKSTAGE_CORRIDOR.minX);

	test('leads from the back landing into a dressing room', () => {
		const walk = followPolyline(
			[
				[THEATRE_ARTIST_PORTAL.centerX, landingZ],
				[THEATRE_ARTIST_PORTAL.centerX, corridorZ],
				[dressingX, corridorZ],
			],
			BACKSTAGE_FLOOR_Y,
		);
		expect(walk.complaint ?? '').toBe('');
		expect(zoneAt(walk.x, walk.y, walk.z), `it ends at (${nr(walk.x)}, ${nr(walk.z)})`).toBe('theatre');
	});

	test('lets nobody in through the closed wall beside it', () => {
		const x = THEATRE_ARTIST_PORTAL.minX - PLAYER_RADIUS - 0.1;
		const walk = followPolyline(
			[
				[x, landingZ],
				[x, corridorZ],
			],
			BACKSTAGE_FLOOR_Y,
		);
		expect(zoneAt(walk.x, walk.y, walk.z), `the pedestrian reaches z ${nr(walk.z)}, inside the backstage`).not.toBe('theatre');
	});
});

/**
 * Out of each dressing room straight into the wings. The corridor leads through the central
 * stage door to the middle of the stage, but a performer should also reach the stage through the
 * side wall, past the wing beside the curtain.
 */
describe.each([
	['the west dressing room', THEATRE_INTERIOR.minX + half(THEATRE_PLAN.stage.set.margin)],
	['the east dressing room', THEATRE_INTERIOR.maxX - half(THEATRE_PLAN.stage.set.margin)],
] as const)('%s', (_what, doorX) => {
	test('opens onto the stage', () => {
		const walk = followPolyline(
			[
				[doorX, BACKSTAGE_INTERIOR.maxZ - THEATRE_PLAN.stage.set.margin],
				[doorX, midpoint(THEATRE_INTERIOR.minZ, THEATRE_STAGE_FRONT_Z)],
			],
			BACKSTAGE_FLOOR_Y,
		);
		expect(walk.complaint ?? '').toBe('');
		expect(zoneAt(walk.x, walk.y, walk.z), `it ends at (${nr(walk.x)}, ${nr(walk.z)})`).toBe('theatre');
		expect(Math.abs(walk.y - THEATRE_STAGE_TOP_Y), `it ends at y ${nr(walk.y)}, not on the stage`).toBeLessThanOrEqual(WALK_STEP);
	});
});

/** The collision floor between backstage and stage existed, but the builder skipped the sills. */
describe('the theatre builder', () => {
	const drawn = new CityTheatre(new LightPool(new THREE.Scene()));

	test.each(['stage-door-sill', 'wing-door-sill-west', 'wing-door-sill-east', 'artist-door-sill'])('%s', (id) => {
		expect(
			drawn.group.getObjectByName(`theatre_${id}`),
			`collision knows ${id} but the builder draws no such surface`,
		).toBeDefined();
	});
});

/**
 * The stress test of the whole zone scheme: the interior exists only through the bay. The four
 * mall zones lie above each other in one footprint and share their holes with the city. The
 * theatre is the first building standing beside it, which is exactly the case in which too wide
 * a cone culls nothing.
 */
describe('the auditorium seen from outside', () => {
	const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
	const culler = new ZoneCuller();
	const eye = THEATRE_FLOOR_Y + 1.6;
	const atTheDoor = { x: THEATRE_PORTAL.centerX, z: THEATRE_PLAN.stair.zTop + VIEW_DISTANCE };

	function look(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, zone: ZoneId): void {
		camera.position.set(from.x, from.y, from.z);
		camera.lookAt(to.x, to.y, to.z);
		camera.updateMatrixWorld(true);
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
		camera.updateProjectionMatrix();
		culler.update(camera, zone);
	}

	test('straight at the bay the hall is visible', () => {
		look({ x: atTheDoor.x, y: eye, z: atTheDoor.z }, { x: atTheDoor.x, y: eye, z: THEATRE_INTERIOR.minZ }, 'stad');
		expect(culler.seesZone('theatre'), 'the hall is called invisible while you look right through it').toBeTrue();
	});

	test('straight at the bay the foyer behind the doors is kept', () => {
		look({ x: atTheDoor.x, y: eye, z: atTheDoor.z }, { x: atTheDoor.x, y: eye, z: THEATRE_INTERIOR.minZ }, 'stad');
		const inTheFoyer = new THREE.Sphere(new THREE.Vector3(THEATRE_PORTAL.centerX, eye, THEATRE_INTERIOR.maxZ - VIEW_DISTANCE), 1);
		expect(culler.accepts(SEAT_MASK, inTheFoyer), 'the foyer behind the doors is culled away').toBeTrue();
	});

	test('with your back to the bay the hall is gone', () => {
		look({ x: atTheDoor.x, y: eye, z: atTheDoor.z }, { x: atTheDoor.x, y: eye, z: atTheDoor.z + LOOK_FAR }, 'stad');
		expect(culler.seesZone('theatre'), 'with your back to the bay the hall is still called visible').toBeFalse();
		const onTheRow = new THREE.Sphere(new THREE.Vector3(THEATRE_PORTAL.centerX, THEATRE_FLOOR_Y, TARGET_Z), 1);
		expect(culler.accepts(SEAT_MASK, onTheRow), 'a seat in the hall is still accepted').toBeFalse();
	});

	test.each([THEATRE_INTERIOR.minZ, -THEATRE_INTERIOR.minZ])(
		'from the shop floor looking at z %s the hall does not exist',
		(z) => {
			look({ x: 0, y: V0 + 1.6, z: 0 }, { x: THEATRE_PORTAL.centerX, y: V0 + 1.6, z }, 'mall-v0');
			expect(culler.seesZone('theatre'), 'the hall is called visible while no portal leads there').toBeFalse();
			expect(culler.accepts(SEAT_MASK, null), 'geometry from the hall is still accepted').toBeFalse();
		},
	);
});

/**
 * The minimap names the theatre when you stand in front of it. The deck plan deliberately does
 * not: that is about the mall, and a second building fifty metres away shrinks the building it
 * is about.
 */
test('the minimap names the theatre from in front of its stair', () => {
	const named = minimapLabelPlan(stubTextMeasure(), {
		x: THEATRE_PORTAL.centerX,
		z: THEATRE_PLAN.stair.zTop + VIEW_DISTANCE,
		yaw: 0,
		level: levelAt(THEATRE_FLOOR_Y),
	}).plan;
	expect(
		named.some((label) => label.text === THEATRE_LABEL),
		`it draws ${named.length === 0 ? 'nothing' : named.map((label) => label.text).join(', ')}`,
	).toBeTrue();
});
