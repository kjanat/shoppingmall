import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { STANDING_PEDESTRIAN } from '#/data/character';
import { type EscalatorSpec, validateEscalatorSpec } from '#/data/connectors';
import { LEVELS, LEVELS_BOTTOM_UP, levelAt } from '#/data/levels';
import type { InteractionReceiver, PlanShape, SpatialVolume, WorldEntity } from '#/data/spatial';
import { receiverAccepts, validateSpatialWorld } from '#/data/spatial';
import { rectangularPerimeterWalls } from '#/data/structure';
import { CONNECTOR_ENTITIES, ELEVATOR_ENTITY, ESCALATOR, WORLD_ENTITIES } from '#/data/world';
import { segmentParameter2 } from '#/util/geometry2';
import { lerp } from '#/util/math';

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

describe('authoritative spatial world', () => {
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
	});

	test('escalator connectivity, containment, incline, and component dimensions are validated', () => {
		assert.deepEqual(validateEscalatorSpec(ESCALATOR), []);

		const disconnected: EscalatorSpec = {
			...ESCALATOR,
			opening: { ...ESCALATOR.opening, connects: ['v0'] },
		};
		assert.ok(validateEscalatorSpec(disconnected).includes('floor opening must declare both connected levels'));

		const steep: EscalatorSpec = { ...ESCALATOR, zTop: 7 };
		assert.ok(validateEscalatorSpec(steep).some((problem) => problem.startsWith('incline ')));

		const brokenGlass: EscalatorSpec = {
			...ESCALATOR,
			appearance: {
				...ESCALATOR.appearance,
				balustrade: { ...ESCALATOR.appearance.balustrade, glassTop: 0.2 },
			},
		};
		assert.ok(validateEscalatorSpec(brokenGlass).includes('balustrade glass top must sit above its non-negative bottom'));
	});

	test('an escalator rejects a slab intersecting a rider body or eye line anywhere along the flight', () => {
		const escalator = CONNECTOR_ENTITIES.find((entity) => entity.id === ESCALATOR.id);
		assert.ok(escalator);
		const clearance = escalator.volumes.find((volume) => volume.id === 'route-clearance');
		assert.ok(clearance && clearance.geometry.kind === 'flight-clearance');
		assert.equal(clearance.geometry.height, STANDING_PEDESTRIAN.requiredHeadroom);
		assert.ok(clearance.geometry.height > STANDING_PEDESTRIAN.bodyHeight);
		assert.ok(clearance.geometry.height > STANDING_PEDESTRIAN.eyeHeight);

		const obstructionZ = 1;
		const progress = segmentParameter2(ESCALATOR.x, obstructionZ, ESCALATOR.x, ESCALATOR.zBottom, ESCALATOR.x, ESCALATOR.zTop);
		const surfaceY = lerp(clearance.geometry.start.y, clearance.geometry.end.y, progress);
		const eyeY = surfaceY + STANDING_PEDESTRIAN.eyeHeight;
		const bodyTopY = surfaceY + STANDING_PEDESTRIAN.bodyHeight;
		const blockingSlab = entity('uncut-v1-slab', 'structure', [
			prism('slab', 'support', ESCALATOR.x, obstructionZ, 3, 0.4, eyeY - 0.1, bodyTopY + 0.1, false, true),
		]);
		const problems = validateSpatialWorld([escalator, blockingSlab]);
		assert.ok(problems.some((problem) => problem.code === 'blocked-clearance'));
	});

	test('the authored world has valid geometry, openings, ports, and interactions', () => {
		assert.deepEqual(validateSpatialWorld(WORLD_ENTITIES), []);
	});

	test('low fixtures fit below an open stair while tall fixtures intersect it', () => {
		const stairs = entity('stairs', 'connector', [OPEN_STAIR]);
		const floor = entity('floor', 'structure', [prism('surface', 'support', 0, 3, 4, 4, -0.2, 0, false, true)]);
		const low = entity('low-cabinet', 'fixture', [prism('body', 'solid', 0, 3, 1, 0.8, 0, 1.5, true, true)]);
		assert.deepEqual(validateSpatialWorld([floor, stairs, low]), []);

		const tall = entity('tall-cabinet', 'fixture', [prism('body', 'solid', 0, 3, 1, 0.8, 0, 3.2, true, true)]);
		assert.ok(validateSpatialWorld([floor, stairs, tall]).some((problem) => problem.code === 'blocked-clearance'));
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
				},
			],
		};
		assert.deepEqual(validateSpatialWorld([opening, automaticHatch]), []);
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
		const escalator = CONNECTOR_ENTITIES.find((candidate) => candidate.id === 'escalator');
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
});
