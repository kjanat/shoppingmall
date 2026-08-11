import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PedestrianPosture } from '#/data/character';
import { CROUCHING_PEDESTRIAN, postureHeadroom, STANDING_PEDESTRIAN } from '#/data/character';
import type { EscalatorSpec } from '#/data/connectors';
import { CONNECTOR_LIMITS, VerticalConnectorRegistrySchema, validateEscalatorSpec } from '#/data/connectors';
import { LEVEL_LIMITS, LevelRegistrySchema } from '#/data/levelSchema';
import { LEVELS, LEVELS_BOTTOM_UP, levelAt } from '#/data/levels';
import type {
	CardinalSide,
	FlightClearanceGeometry,
	InteractionReceiver,
	PlanShape,
	SpatialVolume,
	WorldEntity,
} from '#/data/spatial';
import {
	geometryBounds,
	PLAN_ENVELOPE_TAG,
	pointInPlan,
	ROOM_SHELL_TAG,
	receiverAccepts,
	validateSpatialWorld,
} from '#/data/spatial';
import { cardinalWallPanels, rectangleCornerPoints, rectangularPerimeterWalls } from '#/data/structure';
import { CONNECTOR_ENTITIES, ELEVATOR_ENTITY, ESCALATORS, VERTICAL_CONNECTORS, WORLD_ENTITIES } from '#/data/world';
import { pointInSegmentStrip2, segmentParameter2 } from '#/util/geometry2';
import { half, lerp, midpoint } from '#/util/math';

const ZERO_ROTATION = { yaw: 0, pitch: 0, roll: 0 } as const;
const STATIC_RECEIVER = {
	mobility: 'static',
	mass: null,
	tags: ['anchored'],
	channels: [],
	responses: { translation: 'none', rotation: 'none' },
} as const;

function entity(id: string, placementClass: WorldEntity['placement']['class'], volumes: readonly SpatialVolume[]): WorldEntity {
	return {
		id,
		label: id,
		category: 'fixture',
		levels: ['test'],
		transform: { position: { x: 0, y: 0, z: 0 }, rotation: ZERO_ROTATION },
		volumes,
		ports: [],
		placement: {
			class: placementClass,
			requiresSupport: placementClass !== 'structure',
			mayCover: placementClass === 'clutter' ? ['decorative-covering'] : [],
			mayBeCoveredBy: placementClass === 'covering' ? ['clutter'] : [],
		},
		kinematics: { kind: 'static' },
		mechanisms: [],
		receiver: STATIC_RECEIVER,
		emitters: [],
		map: { visible: true, layer: 'fixture', priority: 1 },
		tags: [placementClass],
	};
}

function prism(
	id: string,
	role: SpatialVolume['role'],
	centerX: number,
	centerZ: number,
	width: number,
	depth: number,
	minY: number,
	maxY: number,
	blocksMovement: boolean,
	blocksClearance: boolean,
	holes: readonly PlanShape[] = [],
): SpatialVolume {
	return {
		id,
		role,
		geometry: {
			kind: 'prism',
			plan: { kind: 'rectangle', center: { x: centerX, z: centerZ }, width, depth, yaw: 0 },
			minY,
			maxY,
			holes,
		},
		blocksMovement,
		clearance: blocksClearance ? { kind: 'fixed-obstruction' } : { kind: 'clear' },
		allowsOverlapFrom: role === 'decorative-covering' ? ['clutter'] : [],
		tags: [role],
	};
}

function envelope(volume: SpatialVolume): SpatialVolume {
	return { ...volume, tags: [...volume.tags, PLAN_ENVELOPE_TAG] };
}

const OPEN_STAIR: SpatialVolume = {
	id: 'flight',
	role: 'connector-clearance',
	geometry: {
		kind: 'flight-clearance',
		start: { x: 0, y: 0, z: 0 },
		end: { x: 0, y: 4, z: 4 },
		width: 2,
		height: STANDING_PEDESTRIAN.requiredHeadroom,
	},
	blocksMovement: false,
	clearance: { kind: 'clear' },
	allowsOverlapFrom: ['connector'],
	tags: ['stairs', 'headroom'],
};

function clearanceVolume(geometry: FlightClearanceGeometry): SpatialVolume {
	return {
		id: 'route-clearance',
		role: 'connector-clearance',
		geometry,
		blocksMovement: false,
		clearance: { kind: 'clear' },
		allowsOverlapFrom: ['connector'],
		tags: ['headroom'],
	};
}

/** De oostelijke roltrap nagebouwd tegen één plaat: 0.6 m stijging per meter z. */
const CLIPPED_FLIGHT: FlightClearanceGeometry = {
	kind: 'flight-clearance',
	start: { x: 0, y: 0, z: 8 },
	end: { x: 0, y: 6, z: -2 },
	width: 2.2,
	height: STANDING_PEDESTRIAN.requiredHeadroom,
};
const DECK_UNDERSIDE_Y = 5.55;
const DECK_TOP_Y = 6;
/** Het gat zoals het met de hand geschreven stond. Het houdt op bij z 1.6. */
const SHORT_HOLE = { kind: 'rectangle', center: { x: 0, z: -0.5 }, width: 2.6, depth: 4.2, yaw: 0 } as const;
/** Hetzelfde gat, doorgetrokken tot voorbij het scheerpunt op z 2.417. */
const DERIVED_HOLE = { kind: 'rectangle', center: { x: 0, z: 0.708 }, width: 2.6, depth: 5.417, yaw: 0 } as const;
/** De speling waarmee de oude bemonstering de rand van een strook meenam. */
const SAMPLE_EPSILON = 1e-6;

type ClippedFlightWorld = Readonly<{ entities: readonly WorldEntity[]; flight: FlightClearanceGeometry; slab: SpatialVolume }>;

function clippedFlightWorld(...holes: readonly PlanShape[]): ClippedFlightWorld {
	const slab = prism('slab', 'support', 0, 3, 6, 20, DECK_UNDERSIDE_Y, DECK_TOP_Y, false, true, holes);
	return {
		entities: [entity('deck', 'structure', [slab]), entity('escalator', 'structure', [clearanceVolume(CLIPPED_FLIGHT)])],
		flight: CLIPPED_FLIGHT,
		slab,
	};
}

/**
 * De oude bemonstering, uitgeschreven: de hoeken en de middens van het gedeelde
 * venster, negen punten. Hij staat hier zodat een geval dat ertussendoor valt
 * blijft bewijzen dat hij het miste.
 */
function oldSamplerFindsOverlap(world: ClippedFlightWorld): boolean {
	const slab = world.slab.geometry;
	assert.equal(slab.kind, 'prism');
	if (slab.kind !== 'prism') return false;
	const flight = world.flight;
	const reach = geometryBounds(flight);
	const solid = geometryBounds(slab);
	const minX = Math.max(reach.minX, solid.minX);
	const maxX = Math.min(reach.maxX, solid.maxX);
	const minZ = Math.max(reach.minZ, solid.minZ);
	const maxZ = Math.min(reach.maxZ, solid.maxZ);
	for (const x of [minX, midpoint(minX, maxX), maxX]) {
		for (const z of [minZ, midpoint(minZ, maxZ), maxZ]) {
			if (!pointInPlan(slab.plan, x, z) || slab.holes.some((hole) => pointInPlan(hole, x, z))) continue;
			const { start, end } = flight;
			if (!pointInSegmentStrip2(x, z, start.x, start.z, end.x, end.z, flight.width, SAMPLE_EPSILON)) continue;
			const surfaceY = lerp(start.y, end.y, segmentParameter2(x, z, start.x, start.z, end.x, end.z));
			if (slab.minY < surfaceY + flight.height && slab.maxY > surfaceY) return true;
		}
	}
	return false;
}

describe('authoritative spatial world', () => {
	test('the level registry enforces identity, top-down order, and plausible deck spacing', () => {
		assert.equal(LevelRegistrySchema.safeParse(LEVELS).success, true);

		const duplicate = LevelRegistrySchema.safeParse([...LEVELS, LEVELS[0]]);
		assert.equal(duplicate.success, false);
		if (!duplicate.success) {
			assert.ok(duplicate.error.issues.some((issue) => issue.message.includes('duplicate level id')));
			assert.ok(duplicate.error.issues.some((issue) => issue.message.includes('duplicate level code')));
			assert.ok(duplicate.error.issues.some((issue) => issue.message.includes('duplicate deck elevation')));
		}

		const inverted = LevelRegistrySchema.safeParse([LEVELS[1], LEVELS[0], ...LEVELS.slice(2)]);
		assert.equal(inverted.success, false);
		if (!inverted.success) {
			assert.ok(inverted.error.issues.some((issue) => issue.message.includes('physically highest deck')));
		}

		const cramped = LevelRegistrySchema.safeParse([
			LEVELS[0],
			{ ...LEVELS[1], y: LEVELS[0].y - half(LEVEL_LIMITS.deckGap.min) },
			...LEVELS.slice(2),
		]);
		assert.equal(cramped.success, false);
		if (!cramped.success) assert.ok(cramped.error.issues.some((issue) => issue.message.startsWith('deck gap ')));
	});

	test('a rectangular shell expands from one footprint without repeated wall coordinates', () => {
		const walls = rectangularPerimeterWalls({
			footprint: { width: 10, depth: 6 },
			vertical: { min: -1, max: 3 },
			thickness: 0.4,
			capOverlap: 0.2,
		});
		assert.deepEqual(
			walls.map((wall) => wall.id),
			['north', 'south', 'west', 'east'],
		);
		assert.deepEqual(walls[0], {
			id: 'north',
			position: { x: 0, y: 1, z: -3 },
			size: { width: 10.4, height: 4, depth: 0.4 },
		});
		assert.deepEqual(walls[3], {
			id: 'east',
			position: { x: 5, y: 1, z: 0 },
			size: { width: 0.4, height: 4, depth: 6 },
		});

		const openShaft = cardinalWallPanels({
			center: { x: 16, z: -8 },
			offset: { x: 1.12, z: 1.12 },
			span: { width: 2.15, depth: 2.15 },
			thickness: 0.04,
			sides: ['north', 'west', 'east'],
		});
		assert.deepEqual(
			openShaft.map((panel) => panel.id),
			['north', 'west', 'east'],
		);
		const westPanel = openShaft[1];
		assert.ok(westPanel);
		assert.equal(westPanel.id, 'west');
		assert.ok(Math.abs(westPanel.center.x - 14.88) < 1e-12);
		assert.equal(westPanel.center.z, -8);
		assert.deepEqual(westPanel.size, { width: 0.04, depth: 2.15 });

		assert.deepEqual(rectangleCornerPoints({ center: { x: 2, z: 3 }, offset: { x: 1, z: 2 } }), [
			{ id: 'north-west', center: { x: 1, z: 1 } },
			{ id: 'north-east', center: { x: 3, z: 1 } },
			{ id: 'south-west', center: { x: 1, z: 5 } },
			{ id: 'south-east', center: { x: 3, z: 5 } },
		]);
	});

	test('escalator connectivity, containment, incline, and component dimensions are validated', () => {
		for (const escalator of ESCALATORS) assert.deepEqual(validateEscalatorSpec(escalator), []);
		const escalator = ESCALATORS[0];
		assert.ok(escalator);

		const disconnected: EscalatorSpec = {
			...escalator,
			opening: { ...escalator.opening, connects: ['v0'] },
		};
		assert.ok(validateEscalatorSpec(disconnected).includes('floor opening must declare both connected levels'));

		const steep: EscalatorSpec = { ...escalator, zTop: 7 };
		assert.ok(validateEscalatorSpec(steep).some((problem) => problem.startsWith('incline ')));

		const brokenGlass: EscalatorSpec = {
			...escalator,
			appearance: {
				...escalator.appearance,
				balustrade: { ...escalator.appearance.balustrade, glassTop: 0.2 },
			},
		};
		assert.ok(validateEscalatorSpec(brokenGlass).includes('balustrade glass top must sit above its non-negative bottom'));
	});

	test('the connector registry schema enforces ranges and globally unique identities', () => {
		const connector = VERTICAL_CONNECTORS[0];
		assert.ok(connector);
		const invalidWidth = VerticalConnectorRegistrySchema.safeParse([{ ...connector, width: CONNECTOR_LIMITS.width.min - 0.1 }]);
		assert.equal(invalidWidth.success, false);
		if (!invalidWidth.success) assert.ok(invalidWidth.error.issues.some((issue) => issue.path.join('.') === '0.width'));
		const excessiveWidth = VerticalConnectorRegistrySchema.safeParse([{ ...connector, width: CONNECTOR_LIMITS.width.max + 0.1 }]);
		assert.equal(excessiveWidth.success, false);
		if (!excessiveWidth.success) assert.ok(excessiveWidth.error.issues.some((issue) => issue.path.join('.') === '0.width'));

		const duplicate = VerticalConnectorRegistrySchema.safeParse([...VERTICAL_CONNECTORS, connector]);
		assert.equal(duplicate.success, false);
		if (!duplicate.success) {
			assert.ok(duplicate.error.issues.some((issue) => issue.message.includes('duplicate connector id')));
			assert.ok(duplicate.error.issues.some((issue) => issue.message.includes('duplicate connector opening id')));
		}
	});

	test('connector schemas reject impossible relationships between authored dimensions', () => {
		const stairs = VERTICAL_CONNECTORS.find(
			(connector) => connector.kind === 'stairs' && connector.presentation === 'mall-flight',
		);
		assert.ok(stairs);
		const landing = stairs.appearance.landing;
		assert.ok(landing);
		const sparseRail = VerticalConnectorRegistrySchema.safeParse([
			{
				...stairs,
				appearance: {
					...stairs.appearance,
					rail: { ...stairs.appearance.rail, postEverySteps: stairs.steps + 1 },
				},
			},
		]);
		assert.equal(sparseRail.success, false);
		if (!sparseRail.success) {
			assert.ok(
				sparseRail.error.issues.some((issue) => issue.message === 'rail post interval cannot exceed the number of steps'),
			);
		}

		const detachedLanding = VerticalConnectorRegistrySchema.safeParse([
			{
				...stairs,
				appearance: {
					...stairs.appearance,
					landing: { ...landing, bottomOffset: landing.bottomDepth },
				},
			},
		]);
		assert.equal(detachedLanding.success, false);
		if (!detachedLanding.success) {
			assert.ok(
				detachedLanding.error.issues.some(
					(issue) => issue.message === 'landing offset must keep its landing over the flight endpoint',
				),
			);
		}
	});

	test('an escalator rejects a slab intersecting a rider body or eye line anywhere along the flight', () => {
		const spec = ESCALATORS[0];
		assert.ok(spec);
		const escalatorEntity = CONNECTOR_ENTITIES.find((entity) => entity.id === spec.id);
		assert.ok(escalatorEntity);
		const clearance = escalatorEntity.volumes.find((volume) => volume.id === 'route-clearance');
		assert.ok(clearance && clearance.geometry.kind === 'flight-clearance');
		assert.equal(clearance.geometry.height, STANDING_PEDESTRIAN.requiredHeadroom);
		assert.ok(clearance.geometry.height > STANDING_PEDESTRIAN.bodyHeight);
		assert.ok(clearance.geometry.height > STANDING_PEDESTRIAN.eyeHeight);

		const obstructionZ = 1;
		const progress = segmentParameter2(spec.x, obstructionZ, spec.x, spec.zBottom, spec.x, spec.zTop);
		const surfaceY = lerp(clearance.geometry.start.y, clearance.geometry.end.y, progress);
		const eyeY = surfaceY + STANDING_PEDESTRIAN.eyeHeight;
		const bodyTopY = surfaceY + STANDING_PEDESTRIAN.bodyHeight;
		const blockingSlab = entity('uncut-v1-slab', 'structure', [
			prism('slab', 'support', spec.x, obstructionZ, 3, 0.4, eyeY - 0.1, bodyTopY + 0.1, false, true),
		]);
		const problems = validateSpatialWorld([escalatorEntity, blockingSlab]);
		assert.ok(problems.some((problem) => problem.code === 'blocked-clearance'));
	});

	test('the authored world has valid geometry, openings, ports, and interactions', () => {
		assert.deepEqual(validateSpatialWorld(WORLD_ENTITIES), []);
	});

	test('a solid sunk into another solid is rejected until the intruder declares that depth', () => {
		const touching: readonly SpatialVolume['allowsOverlapFrom'][number][] = ['structure', 'fixture'];
		const floor = entity('floor', 'structure', [prism('surface', 'support', 0, 0, 20, 20, -0.3, 0, false, true)]);
		const wall = entity('perimeter', 'structure', [
			{ ...prism('wall', 'solid', 0, -5, 20, 0.4, 0, 4, true, true), allowsOverlapFrom: touching },
		]);
		const shell = { ...prism('shell', 'solid', 0, -3.5, 6, 3.4, 0, 3, true, true), allowsOverlapFrom: touching };
		const room = entity('room', 'fixture', [shell]);

		assert.deepEqual(validateSpatialWorld([floor, wall, room]), [
			{
				code: 'unsupported-placement',
				message: 'perimeter.wall and room.shell overlap 0.400 m, and neither declares a penetration',
				entities: ['perimeter', 'room'],
			},
		]);

		// Een vergunning voor een klasse die dit volume nergens raakt houdt de doorsnijding
		// niet tegen, en blijft daarnaast achter als vergunning die in niets snijdt.
		const wrongClass = entity('room', 'fixture', [{ ...shell, penetration: { depth: 0.4, into: ['furnishing'] } }]);
		assert.deepEqual(
			validateSpatialWorld([floor, wall, wrongClass])
				.map((problem) => problem.code)
				.toSorted(),
			['unsupported-placement', 'unused-penetration'],
		);

		const tooShallow = entity('room', 'fixture', [{ ...shell, penetration: { depth: 0.2, into: ['structure'] } }]);
		assert.equal(validateSpatialWorld([floor, wall, tooShallow]).length, 1);

		const declared = entity('room', 'fixture', [{ ...shell, penetration: { depth: 0.4, into: ['structure'] } }]);
		assert.deepEqual(validateSpatialWorld([floor, wall, declared]), []);
	});

	test('a penetration that reaches into nothing is reported the way an unused protrusion is', () => {
		const floor = entity('floor', 'structure', [prism('surface', 'support', 0, 0, 20, 20, -0.3, 0, false, true)]);
		const clear = { ...prism('shell', 'solid', 0, 6, 6, 3.4, 0, 3, true, true) };
		const room = entity('room', 'fixture', [{ ...clear, penetration: { depth: 0.4, into: ['structure'] } }]);

		assert.deepEqual(validateSpatialWorld([floor, room]), [
			{
				code: 'unused-penetration',
				message: 'room.shell declares 0.400 m of penetration into structure but cuts into nothing',
				entities: ['room'],
			},
		]);
		assert.deepEqual(validateSpatialWorld([floor, entity('room', 'fixture', [clear])]), []);
	});

	test('a corner room shell must rest against the structure behind each backing face it declares', () => {
		const backs: readonly CardinalSide[] = ['north', 'west'];
		const floor = entity('mall-floor', 'structure', [prism('surface', 'support', 0, 0, 40, 40, -0.3, 0, false, true)]);
		// Twee loodrechte gevels, met een kier bij de hoek zodat ze niet coplanair raken.
		const north = entity('perimeter-north', 'structure', [prism('wall', 'solid', 5.1, -10.2, 30, 0.4, 0, 4, true, true)]);
		const west = entity('perimeter-west', 'structure', [prism('wall', 'solid', -10.2, 0, 0.4, 40, 0, 4, true, true)]);
		const cornerRoom = (cx: number, cz: number): WorldEntity =>
			entity('prayer', 'fixture', [
				{
					...prism('room-shell', 'support', cx, cz, 6, 4, 0, 0.08, false, true),
					tags: [PLAN_ENVELOPE_TAG, ROOM_SHELL_TAG],
					backs,
				},
			]);

		// Vloerrand west op x −10, noord op z −10: rug én zijkant raken de gevels.
		assert.deepEqual(validateSpatialWorld([floor, north, west, cornerRoom(-7, -8)]), []);

		// Een halve meter naar het oosten: de rug blijft staan, de zijkant laat los.
		assert.deepEqual(validateSpatialWorld([floor, north, west, cornerRoom(-6.5, -8)]), [
			{
				code: 'detached-backing',
				message: 'prayer.room-shell stands 0.500 m clear of the structure behind its west face and declares 0.000 m',
				entities: ['prayer'],
			},
		]);
	});

	test('a storefront frontage rejects a collider and a solid without one alike', () => {
		const floor = entity('mall-floor', 'structure', [prism('surface', 'support', 0, 0, 40, 40, -0.3, 0, false, true)]);
		const shop = entity('shop', 'fixture', [
			envelope(prism('room-shell', 'solid', 0, -3, 8, 5, 0, 4.2, true, true)),
			prism('frontage', 'storefront-clearance', 0, 0.75, 8, 1.5, 0, 2.2, false, false),
		]);
		const mat = entity('floor-mat', 'covering', [prism('fabric', 'decorative-covering', 0, 0.5, 3, 1, 0, 0.02, false, false)]);
		assert.deepEqual(validateSpatialWorld([floor, shop, mat]), []);

		const backdrop = entity('runway', 'fixture', [prism('backdrop', 'solid', 0, 0.5, 5.4, 0.18, 0, 4.2, false, false)]);
		assert.deepEqual(validateSpatialWorld([floor, shop, backdrop]), [
			{
				code: 'blocked-clearance',
				message: 'runway.backdrop stands in shop.frontage, which is floor kept clear',
				entities: ['shop', 'runway'],
			},
		]);

		const pillar = entity('column', 'structure', [prism('shaft', 'solid', 0, 0.5, 0.7, 0.7, 0, 4, true, true)]);
		assert.deepEqual(validateSpatialWorld([floor, shop, pillar]), [
			{
				code: 'blocked-clearance',
				message: 'column.shaft stands in shop.frontage, which is floor kept clear',
				entities: ['shop', 'column'],
			},
		]);
	});

	test('an entity declares one plan envelope and every other volume of it stays inside', () => {
		const floor = entity('mall-floor', 'structure', [prism('surface', 'support', 0, 0, 40, 40, -0.3, 0, false, true)]);
		const shell = envelope(prism('room-shell', 'solid', 0, 0, 8, 6, 0, 3, true, true));
		const contained = entity('kiosk', 'fixture', [
			shell,
			prism('desk', 'solid', 1, 0, 2, 1, 0, 0.9, true, true),
			prism('frontage', 'storefront-clearance', 0, 3.75, 8, 1.5, 0, 2.2, false, false),
		]);
		assert.deepEqual(validateSpatialWorld([floor, contained]), []);

		const spilling = entity('kiosk', 'fixture', [shell, prism('desk', 'solid', 3.6, 0, 2, 1, 0, 0.9, true, true)]);
		assert.deepEqual(validateSpatialWorld([floor, spilling]), [
			{ code: 'uncontained-volume', message: 'kiosk.desk reaches 0.600 m outside kiosk.room-shell', entities: ['kiosk'] },
		]);
	});

	test('two visible tops at one height over shared ground are rejected unless the join is declared', () => {
		const slab = entity('roof-slab', 'structure', [prism('slab', 'support', 0, 0, 20, 20, 3.5, 4, false, true)]);
		const deck = entity('helipad', 'structure', [prism('deck', 'support', 5, 0, 8, 8, 3.6, 4, false, true)]);
		assert.deepEqual(validateSpatialWorld([slab, deck]), [
			{
				code: 'coplanar-surface',
				message: 'roof-slab.slab and helipad.deck both end at y 4.000 and overlap in plan',
				entities: ['roof-slab', 'helipad'],
			},
		]);

		const lifted = entity('helipad', 'structure', [prism('deck', 'support', 5, 0, 8, 8, 3.6, 4.05, false, true)]);
		assert.deepEqual(validateSpatialWorld([slab, lifted]), []);

		const cap: SpatialVolume = {
			...prism('cap', 'solid', 0, 0, 4, 0.4, 0, 3, true, true),
			penetration: { depth: 0.2, into: ['structure'] },
			allowsOverlapFrom: ['structure'],
		};
		const side: SpatialVolume = {
			...prism('side', 'solid', 1.9, 1, 0.4, 2, 0, 3, true, true),
			allowsOverlapFrom: ['structure'],
		};
		const corner = [entity('wall-cap', 'structure', [cap]), entity('wall-side', 'structure', [side])];
		assert.deepEqual(validateSpatialWorld(corner), []);
	});

	test('a walkable deck laid across a wall is rejected even where neither corner sits inside the other', () => {
		const floor = entity('deck-floor', 'structure', [prism('slab', 'support', 0, 0, 40, 40, -0.3, 0, false, true)]);
		const runway = entity('runway', 'fixture', [prism('deck', 'walkable', 0, 0, 2.7, 16, 0, 0.34, false, false)]);
		const wall = entity('room', 'fixture', [prism('wall-north', 'solid', 0, 6, 8, 0.16, 0, 3, true, true)]);
		assert.ok(
			validateSpatialWorld([floor, runway, wall]).some(
				(problem) => problem.code === 'blocked-clearance' && problem.message === 'runway.deck runs through room.wall-north',
			),
		);

		const shortened = entity('runway', 'fixture', [prism('deck', 'walkable', 0, -3, 2.7, 10, 0, 0.34, false, false)]);
		assert.deepEqual(validateSpatialWorld([floor, shortened, wall]), []);
	});

	test('low fixtures fit below an open stair while tall fixtures intersect it', () => {
		const stairs = entity('stairs', 'connector', [OPEN_STAIR]);
		const floor = entity('floor', 'structure', [prism('surface', 'support', 0, 3, 4, 4, -0.2, 0, false, true)]);
		const low = entity('low-cabinet', 'fixture', [prism('body', 'solid', 0, 3, 1, 0.8, 0, 1.5, true, true)]);
		assert.deepEqual(validateSpatialWorld([floor, stairs, low]), []);

		const tall = entity('tall-cabinet', 'fixture', [prism('body', 'solid', 0, 3, 1, 0.8, 0, 3.2, true, true)]);
		assert.ok(validateSpatialWorld([floor, stairs, tall]).some((problem) => problem.code === 'blocked-clearance'));
	});

	test('a slab edge between the nine old sample points is found, because the window is solved and no longer sampled', () => {
		const world = clippedFlightWorld(SHORT_HOLE);
		assert.deepEqual(validateSpatialWorld(world.entities), [
			{
				code: 'blocked-clearance',
				message: 'deck.slab intersects escalator.route-clearance over z 1.600..2.417',
				entities: ['deck', 'escalator'],
			},
		]);

		// Waarom dit vroeger groen was: de oude vorm nam de hoeken en de middens van
		// het gedeelde venster, negen punten, en geen ervan valt in de strook
		// 1.6..2.42. Deze lus is die bemonstering, en hij mag hier niets vinden.
		assert.equal(oldSamplerFindsOverlap(world), false);
	});

	test('a hole that covers the flight to beyond the graze point leaves the headroom clear', () => {
		assert.deepEqual(validateSpatialWorld(clippedFlightWorld(DERIVED_HOLE).entities), []);
	});

	test('a hole whose coverage is not an interval on the flight axis is reported instead of guessed', () => {
		const circular = { kind: 'circle', center: { x: 0, z: -0.5 }, radius: 2.1 } as const;
		assert.deepEqual(validateSpatialWorld(clippedFlightWorld(circular).entities), [
			{
				code: 'unmeasurable-clearance',
				message: "deck.slab meets escalator.route-clearance where hole shape 'circle' is not an axis-aligned rectangle",
				entities: ['deck', 'escalator'],
			},
		]);

		const yawed = { ...SHORT_HOLE, yaw: Math.PI / 3 } as const;
		assert.deepEqual(
			validateSpatialWorld(clippedFlightWorld(yawed).entities).map((problem) => problem.code),
			['unmeasurable-clearance'],
		);
	});

	test('a hole that leaves a strip of deck beside the flight covers none of it', () => {
		const westHalf = { kind: 'rectangle', center: { x: -0.8, z: -0.5 }, width: 1, depth: 4.2, yaw: 0 } as const;
		assert.deepEqual(validateSpatialWorld(clippedFlightWorld(westHalf).entities), [
			{
				code: 'blocked-clearance',
				message: 'deck.slab intersects escalator.route-clearance over z -2.000..2.417',
				entities: ['deck', 'escalator'],
			},
		]);
	});

	test('two holes over the same stretch cover it once, so their lengths cannot add up to a floor that is not there', () => {
		// Samen 7.15 m gat over 4.42 m beton. Afgetrokken heet dat gedekt; als
		// vereniging blijft de strook achter het kortste gat gewoon staan.
		const twin = { ...SHORT_HOLE, center: { x: 0, z: -0.55 }, depth: 4.1 } as const;
		assert.deepEqual(validateSpatialWorld(clippedFlightWorld(SHORT_HOLE, twin).entities), [
			{
				code: 'blocked-clearance',
				message: 'deck.slab intersects escalator.route-clearance over z 1.600..2.417',
				entities: ['deck', 'escalator'],
			},
		]);
	});

	test('a level flight below the critical height fouls over its whole run', () => {
		const level: FlightClearanceGeometry = {
			kind: 'flight-clearance',
			start: { x: 0, y: 3, z: 0 },
			end: { x: 0, y: 3, z: 6 },
			width: 2,
			height: STANDING_PEDESTRIAN.requiredHeadroom,
		};
		const walkway = entity('walkway', 'structure', [clearanceVolume(level)]);
		const lintel = entity('lintel', 'structure', [prism('beam', 'support', 0, 3, 6, 12, 4, 4.5, false, true)]);
		assert.deepEqual(validateSpatialWorld([walkway, lintel]), [
			{
				code: 'blocked-clearance',
				message: 'walkway.route-clearance intersects lintel.beam over z 0.000..6.000',
				entities: ['walkway', 'lintel'],
			},
		]);

		const raised = entity('lintel', 'structure', [prism('beam', 'support', 0, 3, 6, 12, 5.3, 5.8, false, true)]);
		assert.deepEqual(validateSpatialWorld([walkway, raised]), []);
	});

	test('a bollard under a climbing flight is measured against the flight and not against its bounding box', () => {
		const flight: FlightClearanceGeometry = {
			kind: 'flight-clearance',
			start: { x: 0, y: 0, z: 0 },
			end: { x: 0, y: 6, z: 10 },
			width: 2,
			height: STANDING_PEDESTRIAN.requiredHeadroom,
		};
		const stair = entity('stair', 'structure', [clearanceVolume(flight)]);
		// De omhullende doos van deze vlucht loopt van y 0 tot 8.2 over de hele tien
		// meter; het loopvlak zelf staat bij z 9 al op 5.4. Een paaltje van een meter
		// zit dus in die doos en nergens in de weg.
		const bollard = (centerZ: number): WorldEntity =>
			entity('bollard', 'structure', [
				{
					id: 'post',
					role: 'solid',
					geometry: { kind: 'cylinder', center: { x: 0, y: 0.5, z: centerZ }, radius: 0.2, height: 1, axis: 'y' },
					blocksMovement: true,
					clearance: { kind: 'fixed-obstruction' },
					allowsOverlapFrom: [],
					tags: ['solid'],
				},
			]);

		assert.deepEqual(validateSpatialWorld([stair, bollard(9)]), []);
		// Onderaan diezelfde vlucht staat hetzelfde paaltje er wel in.
		assert.deepEqual(validateSpatialWorld([stair, bollard(0.5)]), [
			{
				code: 'blocked-clearance',
				message: 'stair.route-clearance intersects bollard.post over z 0.300..0.700',
				entities: ['stair', 'bollard'],
			},
		]);
	});

	test('a route declared crouch-only is measured against the crouching profile, and the same duct fails as a standing one', () => {
		assert.ok(postureHeadroom('crouching') < postureHeadroom('standing'));
		const duct: FlightClearanceGeometry = {
			kind: 'flight-clearance',
			start: { x: 0, y: 0, z: 0 },
			end: { x: 0, y: 0, z: 6 },
			width: 1,
			height: CROUCHING_PEDESTRIAN.requiredHeadroom,
		};
		const crawlway = (posture: PedestrianPosture): WorldEntity => ({
			...entity('crawlway', 'structure', [clearanceVolume(duct)]),
			ports: [
				{
					id: 'crawlway-mouth',
					kind: 'opening',
					position: { x: 0, y: 0, z: 0 },
					direction: { x: 0, y: 0, z: 1 },
					width: 1,
					height: postureHeadroom(posture),
					connectsTo: [],
					oneWay: false,
					allows: ['walking'],
					clearanceVolumeId: 'route-clearance',
					posture,
				},
			],
		});

		assert.deepEqual(validateSpatialWorld([crawlway('crouching')]), []);
		assert.deepEqual(validateSpatialWorld([crawlway('standing')]), [
			{
				code: 'insufficient-headroom',
				message: `crawlway.crawlway-mouth is walked standing and needs ${STANDING_PEDESTRIAN.requiredHeadroom.toFixed(
					3,
				)} m, but route-clearance offers ${CROUCHING_PEDESTRIAN.requiredHeadroom.toFixed(3)} m`,
				entities: ['crawlway'],
			},
		]);
	});

	test('a helipad slab over a roof opening fails unless its geometry contains the cut-out', () => {
		const hole = { kind: 'rectangle', center: { x: 0, z: 0 }, width: 2, depth: 3, yaw: 0 } as const;
		const opening = entity('roof-opening', 'structure', [
			prism('clearance', 'opening-clearance', 0, 0, 2, 3, 0, 4, false, false),
		]);
		const closedDeck = entity('closed-deck', 'structure', [prism('deck', 'support', 0, 0, 8, 8, 3.5, 4, false, true)]);
		assert.ok(validateSpatialWorld([opening, closedDeck]).some((problem) => problem.code === 'blocked-clearance'));

		const cutDeck = entity('cut-deck', 'structure', [prism('deck', 'support', 0, 0, 8, 8, 3.5, 4, false, true, [hole])]);
		assert.deepEqual(validateSpatialWorld([opening, cutDeck]), []);
	});

	test('an opaque visual hatch blocks the route unless it has a validated automatic opening mechanism', () => {
		const opening = entity('hatch-opening', 'structure', [
			prism('clearance', 'opening-clearance', 0, 0, 2, 3, 0, 4, false, false),
		]);
		const fixedPlateVolume: SpatialVolume = {
			...prism('lid', 'solid', 0, 0, 2, 3, 3.8, 4, false, false),
			clearance: { kind: 'fixed-obstruction' },
		};
		const fixedPlate = entity('fixed-black-hatch', 'structure', [fixedPlateVolume]);
		assert.ok(validateSpatialWorld([opening, fixedPlate]).some((problem) => problem.code === 'blocked-clearance'));

		const automaticLid: SpatialVolume = { ...fixedPlateVolume, clearance: { kind: 'automatic-gate', mechanismId: 'auto-open' } };
		const trigger = prism('presence', 'trigger', 0, -1.8, 3, 2, 0, 4, false, false);
		const automaticHatch: WorldEntity = {
			...entity('automatic-hatch', 'structure', [automaticLid, trigger]),
			mechanisms: [
				{
					id: 'auto-open',
					kind: 'hinged',
					stateId: 'hatch-angle',
					movingVolumeIds: ['lid'],
					triggerVolumeId: 'presence',
					openState: { rotationRadians: Math.PI / 2 },
					openingSeconds: 0.6,
					failSafe: 'open',
					access: { admits: ['pedestrian'] },
				},
			],
		};
		assert.deepEqual(validateSpatialWorld([opening, automaticHatch]), []);

		const shutToEveryone: WorldEntity = {
			...automaticHatch,
			id: 'sealed-hatch',
			mechanisms: automaticHatch.mechanisms.map((mechanism) => ({ ...mechanism, access: { admits: [] } })),
		};
		assert.ok(
			validateSpatialWorld([opening, shutToEveryone]).some(
				(problem) => problem.code === 'invalid-interaction' && problem.message.includes('admits no traffic class'),
			),
		);
	});

	test('multi-stop elevator ports are reciprocal', () => {
		assert.equal(ELEVATOR_ENTITY.ports.length, 4);
		for (const port of ELEVATOR_ENTITY.ports) assert.equal(port.connectsTo.length, 3);
	});

	test('elevator presentation order follows the physical building stack', () => {
		assert.deepEqual(
			LEVELS.map((entry) => entry.id),
			['roof', 'v1', 'v0', 'p1'],
		);
		for (let index = 1; index < LEVELS.length; index++) {
			const above = LEVELS[index - 1];
			const below = LEVELS[index];
			assert.ok(above && below && above.y > below.y);
		}
		assert.deepEqual(
			LEVELS_BOTTOM_UP.map((entry) => entry.id),
			['p1', 'v0', 'v1', 'roof'],
		);
		assert.equal(levelAt(-6), 'p1');
		assert.equal(levelAt(0), 'v0');
		assert.equal(levelAt(6), 'v1');
		assert.equal(levelAt(13.95), 'roof');
	});

	test('vector effects only select compatible receivers', () => {
		const spec = ESCALATORS[0];
		assert.ok(spec);
		const escalator = CONNECTOR_ENTITIES.find((candidate) => candidate.id === spec.id);
		const emitter = escalator?.emitters[0];
		assert.ok(emitter);
		const passenger: InteractionReceiver = {
			mobility: 'character',
			mass: 80,
			tags: ['grounded'],
			channels: ['conveyor'],
			responses: { translation: 'integrate', rotation: 'none' },
		};
		const railing: InteractionReceiver = {
			mobility: 'static',
			mass: null,
			tags: ['anchored'],
			channels: [],
			responses: { translation: 'none', rotation: 'none' },
		};
		assert.equal(receiverAccepts(emitter, passenger), true);
		assert.equal(receiverAccepts(emitter, railing), false);
	});

	test('clutter may rest over a decorative covering', () => {
		const floor = entity('floor', 'structure', [prism('surface', 'support', 0, 0, 6, 6, -0.2, 0, false, true)]);
		const carpet = entity('carpet', 'covering', [prism('fabric', 'decorative-covering', 0, 0, 4, 4, 0, 0.02, false, false)]);
		const wrapper = entity('burger-wrapper', 'clutter', [prism('paper', 'solid', 0.2, 0, 0.3, 0.25, 0.015, 0.035, true, true)]);
		const coke = entity('coke-can', 'clutter', [
			{
				id: 'can',
				role: 'solid',
				geometry: { kind: 'cylinder', center: { x: -0.2, y: 0.08, z: 0 }, radius: 0.035, height: 0.16, axis: 'y' },
				blocksMovement: true,
				clearance: { kind: 'fixed-obstruction' },
				allowsOverlapFrom: ['covering'],
				tags: ['clutter'],
			},
		]);
		assert.deepEqual(validateSpatialWorld([floor, carpet, wrapper, coke]), []);
	});

	test('clutter without a collider is still rejected inside the structure, and so is paint that crosses it', () => {
		const deck = entity('deck', 'structure', [prism('surface', 'support', 0, 0, 40, 40, -0.3, 0, false, true)]);
		const shell = entity('shell', 'structure', [prism('pillar', 'solid', 0, 0, 0.7, 0.7, 0, 4.4, true, true)]);
		const car = entity('cars', 'clutter', [prism('car', 'solid', 0, 2, 1.9, 4, 0, 1.1, false, false)]);
		assert.deepEqual(validateSpatialWorld([deck, shell, car]), [
			{
				code: 'unsupported-placement',
				message: 'shell.pillar and cars.car interpenetrate, and clutter cannot stand inside the structure',
				entities: ['shell', 'cars'],
			},
		]);

		const paint = entity('bays', 'clutter', [prism('stall', 'decorative-covering', 0, 2, 2.4, 4.8, 0, 0.14, false, false)]);
		assert.deepEqual(validateSpatialWorld([deck, shell, paint]), [
			{
				code: 'unsupported-placement',
				message: 'bays.stall runs through shell.pillar instead of around its footprint',
				entities: ['shell', 'bays'],
			},
		]);

		// Hetzelfde vak om de kolomvoet heen geknipt: twee stroken ernaast en de rest
		// erachter. Het reepje van vijf centimeter vóór de kolom is geen streep meer.
		const clipped = entity('bays', 'clutter', [
			prism('stall-1', 'decorative-covering', -0.775, 2, 0.85, 4.8, 0, 0.14, false, false),
			prism('stall-2', 'decorative-covering', 0.775, 2, 0.85, 4.8, 0, 0.14, false, false),
			prism('stall-3', 'decorative-covering', 0, 2.375, 0.7, 4.05, 0, 0.14, false, false),
		]);
		assert.deepEqual(validateSpatialWorld([deck, shell, clipped]), []);

		const parked = entity('cars', 'clutter', [prism('car', 'solid', 0, 2.4, 1.9, 4, 0, 1.1, false, false)]);
		assert.deepEqual(validateSpatialWorld([deck, shell, parked]), []);
	});
});
