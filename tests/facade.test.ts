import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import type { CardinalSide, SpatialRole } from '#/data/spatial';
import { CARDINAL_OUTWARD, geometryBounds, PROTRUSION_MARGIN, ROOM_SHELL_TAG } from '#/data/spatial';
import {
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
	FACADE_RELIEF_SPEC,
	MALL_FACADE_RELIEF,
	MALL_FACADE_SIGNS,
	MALL_WALL_ENVELOPE,
	MALL_WALL_SPECS,
	PARKING_EXIT_TRENCH_WALLS,
	parkingExitRampY,
	WORLD_ENTITIES,
} from '#/data/world';
import { ZONE_ENCLOSURES } from '#/data/zones';
import { WALK_STEP } from '#/physics/Collision';
import {
	CITY_BOUNDS,
	CITY_GROUND_PLAN,
	CITY_GROUND_PLANE_Y,
	CITY_GROUND_Y,
	EXIT_LANE_OFFSET,
	grownRect,
	PLAZA_ENTRANCE_GAP,
	PLAZA_OUTER,
	PLAZA_PLAN,
	PLAZA_TOP_Y,
	PLAZA_TRENCH_GAP,
	plazaStations,
} from '#/scene/city/cityPlan';
import { half, span } from '#/util/math';
import { at } from '#/util/rand';
import { read } from './helpers/source-scan.ts';
import { followPolyline } from './helpers/walk.ts';
import { nr, world } from './helpers/world.ts';

/**
 * The skin of the buildings: what may sit in it, what may stick out of it, and what is hung on
 * the outside of it.
 */

const V0 = levelY('v0');
const MARGIN = 1e-6;
/** How far the drawn ground may sit under the surface you walk on before you can see it. */
const GROUND_SLACK = 0.1;

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

function covers(rect: Rect, x: number, z: number): boolean {
	return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

const SIDES = [
	{ side: 'west', name: 'west' },
	{ side: 'east', name: 'east' },
	{ side: 'north', name: 'north' },
	{ side: 'south', name: 'south' },
] as const satisfies readonly { side: CardinalSide; name: string }[];

/** Roles that are standing material. Everything else is clearance, trigger or paint. */
const BUILT: readonly SpatialRole[] = ['solid', 'walkable', 'support'];

function standsOn(plan: Rect, box: Rect): boolean {
	return box.minX <= plan.maxX && box.maxX >= plan.minX && box.minZ <= plan.maxZ && box.maxZ >= plan.minZ;
}

/**
 * The building an entity belongs to. There used to be one, so the question was never asked and
 * everything was measured against the envelope of the mall. With the theatre standing that is a
 * facade fifty metres away and every auditorium wall reached past it by definition. Anything
 * touching no footprint keeps the mall, which is what the exit trench and the canopy always did.
 */
function buildingOf(entity: (typeof WORLD_ENTITIES)[number]): { id: string; touched: number } {
	const touched = ZONE_ENCLOSURES.filter((building) =>
		entity.volumes.some((volume) => standsOn(building.plan, geometryBounds(volume.geometry))),
	);
	return { id: (touched[0] ?? at(ZONE_ENCLOSURES, 0)).id, touched: touched.length };
}

const WALLS = WORLD_ENTITIES.filter((entity) => entity.category === 'wall');

describe('every building has a skin of its own', () => {
	test('there are wall entities at all', () => {
		expect(WALLS, 'no wall entity in WORLD_ENTITIES — where is the perimeter?').not.toBeEmpty();
	});

	test('no entity stands in two buildings at once', () => {
		const straddling = WORLD_ENTITIES.filter((entity) => buildingOf(entity).touched > 1).map(
			(entity) => `${entity.id} stands in two buildings at once; two buildings share no floor`,
		);
		expect(straddling, straddling.join('\n')).toBeEmpty();
	});

	test.each(ZONE_ENCLOSURES.map((building) => building.id))('%s is walled by its own wall entities', (id) => {
		const own = WALLS.filter((wall) => buildingOf(wall).id === id);
		expect(own, `${id} has no wall entity, so that building has no skin to measure against`).not.toBeEmpty();
	});
});

/**
 * The envelope the zone graph hands out is measured here rather than believed: with a wall
 * cabinet standing outside it, everything below would be measured against a facade that is not
 * there.
 */
function skinOf(id: string): Rect | null {
	const own = WALLS.filter((wall) => buildingOf(wall).id === id);
	if (own.length === 0) return null;
	const measured: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
	for (const wall of own) {
		for (const volume of wall.volumes) {
			const box = geometryBounds(volume.geometry);
			measured.minX = Math.min(measured.minX, box.minX);
			measured.maxX = Math.max(measured.maxX, box.maxX);
			measured.minZ = Math.min(measured.minZ, box.minZ);
			measured.maxZ = Math.max(measured.maxZ, box.maxZ);
		}
	}
	return Number.isFinite(measured.minX) && Number.isFinite(measured.minZ) ? measured : null;
}

describe.each(ZONE_ENCLOSURES.map((building) => building.id))('the declared envelope of %s', (id) => {
	const building = ZONE_ENCLOSURES.find((candidate) => candidate.id === id);
	const skin = skinOf(id);

	test('is the envelope its wall cabinets actually build', () => {
		if (!building || !skin) return;
		for (const [axis, declared, built] of [
			['minX', building.envelope.minX, skin.minX],
			['maxX', building.envelope.maxX, skin.maxX],
			['minZ', building.envelope.minZ, skin.minZ],
			['maxZ', building.envelope.maxZ, skin.maxZ],
		] as const) {
			expect(declared, `${id} declares ${axis} ${nr(declared)} while its wall cabinets stand at ${nr(built)}`).toBeCloseTo(
				built,
				Math.round(-Math.log10(PROTRUSION_MARGIN)),
			);
		}
	});
});

/**
 * Sitting inside the wall thickness is allowed: a cave hollowed out of the west wall belongs
 * there and declares its depth with `penetration`. Coming out the far side is not, and that is
 * what is measured. Some things do belong outside: the canopy columns stand on the pavement and
 * the exit trench runs ten metres into the city. Those declare it with `protrusion`, and then
 * the question is no longer whether a volume comes out but whether it comes out further than it
 * said. A declaration that sticks out nowhere is a fault of its own, like an unused exemption
 * row: otherwise a permit stays behind for geometry long since pushed back inside.
 *
 * Everything built is measured, not only what stops a body: what you see is what crosses the
 * property line, and the canopy reaches four metres over the pavement with `blocksMovement`
 * off. Clearance and trigger volumes stay out of it, because reaching past their own geometry
 * is exactly what they are for.
 */
describe('nothing comes out through a facade unannounced', () => {
	const used = new Set<string>();
	const escaping: string[] = [];

	for (const entity of WORLD_ENTITIES) {
		if (entity.category === 'wall') continue;
		const skin = skinOf(buildingOf(entity).id);
		if (!skin) continue;
		for (const volume of entity.volumes) {
			if (!volume.blocksMovement && !BUILT.includes(volume.role)) continue;
			const box = geometryBounds(volume.geometry);
			const out: Record<CardinalSide, number> = {
				west: skin.minX - box.minX,
				east: box.maxX - skin.maxX,
				north: skin.minZ - box.minZ,
				south: box.maxZ - skin.maxZ,
			};
			for (const { side, name } of SIDES) {
				const reach = out[side];
				if (reach <= PROTRUSION_MARGIN) continue;
				const permit = volume.protrusion;
				if (permit?.sides.includes(side) && reach <= permit.depth + PROTRUSION_MARGIN) {
					used.add(`${entity.id}.${volume.id}|${side}`);
					continue;
				}
				const declared = permit?.sides.includes(side)
					? `, and declares only ${nr(permit.depth)} m there`
					: ' without declaring anything on that side';
				escaping.push(`${entity.id}.${volume.id} reaches ${nr(reach)} m past the ${name} facade${declared}`);
			}
		}
	}

	test('no volume reaches past a facade further than it declares', () => {
		expect(escaping, escaping.join('\n')).toBeEmpty();
	});

	test('no declaration is left over for geometry that no longer sticks out', () => {
		const stale = WORLD_ENTITIES.flatMap((entity) =>
			entity.volumes.flatMap((volume) =>
				(volume.protrusion?.sides ?? [])
					.filter((side) => !used.has(`${entity.id}.${volume.id}|${side}`))
					.map(
						(side) =>
							`${entity.id}.${volume.id} declares ${nr(volume.protrusion?.depth ?? 0)} m past the ${side} facade but sticks out nowhere there`,
					),
			),
		);
		expect(stale, stale.join('\n')).toBeEmpty();
	});
});

/** The outer faces of the wall pieces per facade: that is what the relief stands against. */
function wallFaces(side: CardinalSide): readonly number[] {
	const outward = CARDINAL_OUTWARD[side];
	return MALL_WALL_SPECS.filter((wall) => wall.side === side).map((wall) =>
		outward.x !== 0 ? wall.position.x + outward.x * half(wall.size.width) : wall.position.z + outward.z * half(wall.size.depth),
	);
}

/**
 * The envelope of the four wall cabinets lies thirty centimetres outside the west and east
 * facades, because the north and south caps run over them, so a band corbelling out three
 * decimetres there never passes the envelope and the check above cannot see it. This measures
 * against the wall face itself.
 */
describe.each(SIDES.map((side) => side.name))('the %s facade', (name) => {
	const side = SIDES.find((candidate) => candidate.name === name)?.side ?? 'west';
	const pieces = MALL_FACADE_RELIEF.filter((piece) => piece.side === side);

	test('carries a band, so it does not read as a bare plate', () => {
		expect(
			pieces.some((piece) => piece.kind !== 'seam'),
			'no band at all on this facade',
		).toBeTrue();
	});

	test('carries a seam, so it has a sense of scale', () => {
		expect(
			pieces.some((piece) => piece.kind === 'seam'),
			'no seam at all on this facade',
		).toBeTrue();
	});
});

describe.each([...MALL_FACADE_RELIEF, ...MALL_FACADE_SIGNS].map((piece) => piece.id))('%s', (id) => {
	const piece = [...MALL_FACADE_RELIEF, ...MALL_FACADE_SIGNS].find((candidate) => candidate.id === id);
	if (!piece) throw new Error(`no facade piece ${id}`);
	const outward = CARDINAL_OUTWARD[piece.side];
	const alongX = outward.x !== 0;
	const back = alongX ? (outward.x < 0 ? piece.maxX : piece.minX) : outward.z < 0 ? piece.maxZ : piece.minZ;
	const depth = alongX ? span(piece.minX, piece.maxX) : span(piece.minZ, piece.maxZ);

	test('stands with its back against a wall piece', () => {
		expect(
			wallFaces(piece.side).some((face) => Math.abs(face - back) <= MARGIN),
			`its back sits at ${nr(back)}, against no wall piece of the ${piece.side} facade`,
		).toBeTrue();
	});

	test('stays inside the corbelling budget', () => {
		expect(depth, `it corbels ${nr(depth)} m out`).toBeLessThanOrEqual(FACADE_RELIEF_SPEC.reachBudget + MARGIN);
	});

	test('is as deep as it says it is', () => {
		expect(depth, `it measures ${nr(depth)} m deep while declaring ${nr(piece.reach)} m`).toBeCloseTo(piece.reach, 6);
	});
});

test('no relief runs across the entrance bay', () => {
	const glassTop = V0 + ENTRANCE_SPEC.glassTopY;
	const across = MALL_FACADE_RELIEF.filter(
		(piece) =>
			piece.side === 'west' &&
			piece.minY < glassTop - MARGIN &&
			piece.maxZ > ENTRANCE_PORTAL.minZ + MARGIN &&
			piece.minZ < ENTRANCE_PORTAL.maxZ - MARGIN,
	).map(
		(piece) =>
			`${piece.id} runs at height ${nr(piece.minY)} straight through the entrance bay (z ${nr(ENTRANCE_PORTAL.minZ)}..${nr(ENTRANCE_PORTAL.maxZ)})`,
	);
	expect(across, across.join('\n')).toBeEmpty();
});

describe.each(MALL_FACADE_SIGNS.map((sign) => sign.id))('the sign %s', (id) => {
	const sign = MALL_FACADE_SIGNS.find((candidate) => candidate.id === id);
	if (!sign) throw new Error(`no sign ${id}`);
	const alongX = CARDINAL_OUTWARD[sign.side].x === 0;
	const pieces = MALL_WALL_SPECS.filter((wall) => wall.side === sign.side);
	const from = alongX ? sign.minX : sign.minZ;
	const to = alongX ? sign.maxX : sign.maxZ;
	const facadeMin = Math.min(
		...pieces.map((wall) => (alongX ? wall.position.x - half(wall.size.width) : wall.position.z - half(wall.size.depth))),
	);
	const facadeMax = Math.max(
		...pieces.map((wall) => (alongX ? wall.position.x + half(wall.size.width) : wall.position.z + half(wall.size.depth))),
	);

	test('sits on the cornice', () => {
		expect(
			sign.minY,
			`it starts at ${nr(sign.minY)} instead of on the cornice, so it hangs loose from the roof line`,
		).toBeCloseTo(FACADE_RELIEF_SPEC.cornice.maxY, 6);
	});

	test('stays within its own facade', () => {
		expect(from, `it runs from ${nr(from)} and reaches past its own facade`).toBeGreaterThanOrEqual(facadeMin - MARGIN);
		expect(to, `it runs to ${nr(to)} and reaches past its own facade`).toBeLessThanOrEqual(facadeMax + MARGIN);
	});
});

describe('the plaza', () => {
	test('is paved below the surface you walk on', () => {
		expect(
			PLAZA_TOP_Y,
			`the paving sits at ${nr(PLAZA_TOP_Y)}, level with the walking surface, so it flickers against the forecourt`,
		).toBeLessThan(CITY_GROUND_Y - MARGIN);
	});

	test.each(PARKING_EXIT_TRENCH_WALLS.filter((wall) => wall.openToSky).map((wall) => wall.id))(
		'the gap in the paving clears %s',
		(id) => {
			const wall = PARKING_EXIT_TRENCH_WALLS.find((candidate) => candidate.id === id);
			if (!wall) return;
			expect(
				wall.minX >= PLAZA_TRENCH_GAP.minX - MARGIN &&
					wall.maxX <= PLAZA_TRENCH_GAP.maxX + MARGIN &&
					wall.minZ >= PLAZA_TRENCH_GAP.minZ - MARGIN &&
					wall.maxZ <= PLAZA_TRENCH_GAP.maxZ + MARGIN,
				`${id} lies outside the gap in the paving, so the trench is paved over there`,
			).toBeTrue();
		},
	);

	const furniture = plazaStations();
	const trench = grownRect(PLAZA_TRENCH_GAP, PLAZA_PLAN.keepOut);
	const forecourt = grownRect(PLAZA_ENTRANCE_GAP, PLAZA_PLAN.keepOut);

	test('carries street furniture at all', () => {
		expect(furniture, 'the plaza has no street furniture, so it stays a hectare of grey').not.toBeEmpty();
	});

	test.each(furniture.map((_spot, index) => index))('street furniture %s stands where it may', (index) => {
		const spot = furniture[index];
		if (!spot) return;
		const where = `(${nr(spot.x)}, ${nr(spot.z)})`;
		expect(covers(PLAZA_OUTER, spot.x, spot.z), `furniture at ${where} stands off the paving, on the ring road`).toBeTrue();
		expect(covers(MALL_WALL_ENVELOPE, spot.x, spot.z), `furniture at ${where} stands inside the building`).toBeFalse();
		expect(covers(trench, spot.x, spot.z), `furniture at ${where} stands in the exit trench`).toBeFalse();
		expect(covers(forecourt, spot.x, spot.z), `furniture at ${where} stands on the entrance forecourt`).toBeFalse();
	});
});

/**
 * Outside the ring road the paving stops, and there the mall builder's own plate used to lie at
 * y −0.5 while collision walks you at `CITY_GROUND_Y` and every tower, the park, the theatre
 * podium and the garage ground deck have their feet at 0. Everything there stood with half a
 * metre of air under it.
 */
describe('the city ground', () => {
	test('lies at the height you walk on', () => {
		expect(
			CITY_GROUND_Y - CITY_GROUND_PLANE_Y,
			`the ground plate sits at ${nr(CITY_GROUND_PLANE_Y)}, under the walking surface (${nr(CITY_GROUND_Y)}); everything on it floats`,
		).toBeLessThanOrEqual(GROUND_SLACK);
	});

	test('stays below the paving instead of fighting it', () => {
		expect(
			CITY_GROUND_PLANE_Y,
			`the ground plate reaches up to the paving (${nr(PLAZA_TOP_Y)}) and the two flicker`,
		).toBeLessThan(PLAZA_TOP_Y - MARGIN);
	});

	test.each([
		[CITY_BOUNDS.minX, CITY_BOUNDS.minZ],
		[CITY_BOUNDS.maxX, CITY_BOUNDS.minZ],
		[CITY_BOUNDS.minX, CITY_BOUNDS.maxZ],
		[CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ],
	])('covers the world corner (%s, %s)', (x, z) => {
		expect(covers(CITY_GROUND_PLAN, x, z), 'you look under the world at this corner').toBeTrue();
	});

	/**
	 * The gap in the paving is a gap under your feet too. The ground query outside the mall
	 * answered street level everywhere, so you walked over the open trench as if a plate lay
	 * there: six metres of air under your shoes and the ramp coming up underneath unseen.
	 */
	test('is open over the trench, where the ramp is the floor', () => {
		const wrong: string[] = [];
		for (let x = PLAZA_TRENCH_GAP.minX + 0.25; x < PLAZA_TRENCH_GAP.maxX && wrong.length === 0; x += 0.25) {
			for (const z of [-EXIT_LANE_OFFSET, 0, EXIT_LANE_OFFSET]) {
				const ground = world.groundHeightAt(x, z, CITY_GROUND_Y, WALK_STEP);
				const ramp = parkingExitRampY(x);
				if (Math.abs(ground - ramp) <= GROUND_SLACK) continue;
				wrong.push(
					`over the open trench at (${nr(x)}, ${nr(z)}) the ground answers ${nr(ground)} while the ramp lies at ${nr(ramp)}`,
				);
				break;
			}
		}
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});

	test('is not covered again by a plate of the mall builder', async () => {
		const builder = await read('src/scene/MallBuilder.ts');
		expect(
			/new THREE\.PlaneGeometry\(\s*\d{3}/.test(builder),
			'MallBuilder lays its own ground plane again; the city ground comes from CityPlaza',
		).toBeFalse();
	});
});

/**
 * The storefront rule in `validateSpatialWorld` only works where a storefront prism exists, and
 * that prism came from one place: `shopEntity`. ISLAND HOP is built through `roomEntity` and was
 * the only one of the nineteen without one, so anything could end up in front of its counter.
 */
describe.each(WORLD_ENTITIES.filter((entity) => entity.category === 'shop').map((shop) => shop.id))('%s', (id) => {
	const shop = WORLD_ENTITIES.find((entity) => entity.id === id);

	test('has a storefront clearance volume', () => {
		expect(
			shop?.volumes.some((volume) => volume.role === 'storefront-clearance'),
			'nothing guards its frontage',
		).toBeTrue();
	});

	test('has a room shell, so its back wall is measured against the facade', () => {
		expect(
			shop?.volumes.some((volume) => volume.tags.includes(ROOM_SHELL_TAG)),
			`no ${ROOM_SHELL_TAG} volume, so nothing checks that its back wall touches the facade`,
		).toBeTrue();
	});
});

/**
 * The back-wall collider used to rotate its centre only and kept its width on X, which for the
 * quarter-turned shops became an invisible cross wall on Z. These three reported poses walk one
 * metre straight ahead along the facade.
 */
describe.each([
	['GAME MANIA', 37.5, -0.8, 182],
	['SAUCY', 37.2, -10.8, 184],
	['DOUGLAS', -37.2, -8.8, 169],
] as const)('the outside route past %s', (_name, x, z, heading) => {
	test('stays walkable', () => {
		const yaw = (heading * Math.PI) / 180;
		const trip = followPolyline(
			[
				[x, z],
				[x - Math.sin(yaw), z - Math.cos(yaw)],
			],
			V0,
		);
		expect(trip.complaint ?? '', `from (${nr(x)}, ${nr(z)}) heading ${heading} degrees you cannot walk forward`).toBe('');
	});
});
