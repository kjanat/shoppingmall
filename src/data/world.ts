import { STANDING_PEDESTRIAN } from '#/data/character';
import type { EscalatorSpec, OpeningDef, StairSpec, VerticalConnector } from '#/data/connectors';
import { ATRIUM_VOID, MALL_FOOTPRINT, PARKING_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, levelY } from '#/data/levels';
import type {
	InteractionEmitter,
	InteractionReceiver,
	PlacementClass,
	PlanShape,
	SpatialRole,
	SpatialVolume,
	WorldEntity,
} from '#/data/spatial';
import { planBounds, rectanglePlan } from '#/data/spatial';
import { shopStores } from '#/data/stores';
import { cardinalWallPanels, rectangleCornerPoints, rectangularPerimeterWalls } from '#/data/structure';
import { half, span } from '#/util/math';

export type WorldCategory = 'floor' | 'ceiling' | 'wall' | 'opening' | 'shop' | 'vertical-circulation' | 'parking';

export const ESCALATOR_SPEED = 0.5;
export const SHOP_HEIGHT = 4.2;
export const SHOP_ROOM_DEPTH_FACTOR = 0.92;
export const ELEVATOR_SPEC = {
	center: { x: 16, z: -8 },
	cabin: {
		width: 2,
		depth: 2,
		height: 2.55,
		wallThickness: 0.04,
		wallInset: 0.05,
		doorThickness: 0.05,
		doorPanelWidth: 0.9,
		doorClosedOffset: 0.42,
		doorOpenOffset: 0.95,
	},
	shaft: {
		wallOffset: 1.12,
		panelSpan: 2.15,
		panelThickness: 0.04,
		postOffset: 1.1,
		postThickness: 0.12,
		bottomOverrun: 0.2,
		topOverrun: 3,
	},
	shaftGap: 0.12,
	landingPad: { width: 5.5, depth: 5.5, thickness: 0.12 },
	speed: 1.85,
} as const;

/** Fixed shaft panels. The south face is intentionally open at every landing. */
export const ELEVATOR_SHAFT_WALLS = cardinalWallPanels({
	center: ELEVATOR_SPEC.center,
	offset: { x: ELEVATOR_SPEC.shaft.wallOffset, z: ELEVATOR_SPEC.shaft.wallOffset },
	span: { width: ELEVATOR_SPEC.shaft.panelSpan, depth: ELEVATOR_SPEC.shaft.panelSpan },
	thickness: ELEVATOR_SPEC.shaft.panelThickness,
	sides: ['north', 'west', 'east'],
});

export const ELEVATOR_SHAFT_POSTS = rectangleCornerPoints({
	center: ELEVATOR_SPEC.center,
	offset: { x: ELEVATOR_SPEC.shaft.postOffset, z: ELEVATOR_SPEC.shaft.postOffset },
});
export const PARKING_EXIT_RAMP = {
	id: 'parking-exit-ramp',
	start: { x: -30, y: levelY('p1'), z: 0 },
	end: { x: -46, y: levelY('v0') + 0.05, z: 0 },
	width: 5.5,
	thickness: 0.28,
	guardHeight: 0.55,
} as const;

export const ATRIUM_OPENING: OpeningDef = {
	id: 'atrium',
	category: 'atrium',
	center: { x: 0, z: 0 },
	size: { width: ATRIUM_VOID.width, depth: ATRIUM_VOID.depth },
	connects: ['v0', 'v1', 'roof'],
};

export const ELEVATOR_OPENING_V1: OpeningDef = {
	id: 'elevator-v1',
	category: 'elevator',
	center: ELEVATOR_SPEC.center,
	size: { width: 2.4, depth: 2.4 },
	connects: ['v0', 'v1'],
};

export const ELEVATOR_OPENING_ROOF: OpeningDef = {
	id: 'elevator-roof',
	category: 'elevator',
	center: ELEVATOR_OPENING_V1.center,
	size: { width: 2.9, depth: 2.9 },
	connects: ['v1', 'roof'],
};

export const ELEVATOR_OPENING_V0: OpeningDef = {
	id: 'elevator-v0',
	category: 'elevator',
	center: ELEVATOR_SPEC.center,
	size: { width: 2.4, depth: 2.4 },
	connects: ['p1', 'v0'],
};

export const ELEVATOR_OPENING_P1: OpeningDef = {
	id: 'elevator-p1',
	category: 'elevator',
	center: ELEVATOR_SPEC.center,
	size: { width: 2.4, depth: 2.4 },
	connects: ['p1'],
};

const ESCALATOR_MODEL = {
	appearance: {
		step: {
			minimumSurfaceY: 0.02,
			treadThickness: 0.07,
			riserThickness: 0.05,
		},
		nose: {
			height: 0.006,
			edgeInset: 0.01,
			surfaceLift: 0.0015,
			depth: 0.05,
		},
		skirt: {
			panelThickness: 0.05,
			treadGap: 0.03,
		},
		balustrade: {
			glassBottom: 0.33,
			glassTop: 0.99,
			glassThickness: 0.03,
		},
		handrail: {
			radius: 0.05,
			glassGap: 0.02,
			textureRepeatLength: 0.32,
		},
	},
	constraints: {
		inclineDegrees: { min: 25, max: 35 },
		alignmentTolerance: 0.001,
	},
} as const;

export const ESCALATORS = [
	{
		id: 'east-escalator',
		label: 'East escalator',
		kind: 'escalator',
		from: 'v0',
		to: 'v1',
		x: 22,
		zBottom: 8,
		zTop: -2,
		width: 2.2,
		steps: 20,
		apron: 1,
		...ESCALATOR_MODEL,
		opening: {
			id: 'escalator-v1',
			category: 'escalator',
			center: { x: 22, z: -0.5 },
			size: { width: 2.6, depth: 4.2 },
			connects: ['v0', 'v1'],
		},
		collision: {
			minX: 20.7,
			maxX: 23.3,
			minZ: -3.5,
			maxZ: 9,
			openMinZ: -2.6,
			openMaxZ: 1.6,
			carrySpeed: ESCALATOR_SPEED,
		},
	},
] as const satisfies readonly EscalatorSpec[];

export const STAIR_CONNECTORS = {
	west: {
		id: 'west-stairs',
		label: 'West stairs',
		kind: 'stairs',
		presentation: 'mall-flight',
		from: 'v0',
		to: 'v1',
		x: -22,
		zBottom: 4,
		zTop: -14,
		width: 2.4,
		steps: 24,
		apron: 1,
		opening: {
			id: 'stairs-v1',
			category: 'stairs',
			center: { x: -22, z: -11 },
			size: { width: 4, depth: 7.2 },
			connects: ['v0', 'v1'],
		},
		collision: {
			minX: -23.5,
			maxX: -20.5,
			minZ: -15.5,
			maxZ: 5,
			openMinZ: -14.6,
			openMaxZ: -7.4,
		},
	},
	secret: {
		id: 'secret-stairs',
		label: 'Secret stairs to roof',
		kind: 'stairs',
		presentation: 'helipad-flight',
		from: 'v1',
		to: 'roof',
		x: 26,
		zBottom: 14,
		zTop: 18,
		width: 2.6,
		steps: 16,
		apron: 0.5,
		opening: {
			id: 'stairs-roof',
			category: 'stairs',
			center: { x: 26, z: 16 },
			size: { width: 3, depth: 4 },
			connects: ['v1', 'roof'],
		},
		collision: {
			minX: 24.7,
			maxX: 27.3,
			minZ: 14,
			maxZ: 18.5,
			openMinZ: 14,
			openMaxZ: 18,
		},
	},
} as const satisfies Readonly<Record<string, StairSpec>>;

export const VERTICAL_CONNECTORS: readonly VerticalConnector[] = [...ESCALATORS, ...Object.values(STAIR_CONNECTORS)];

export type MallWorldCategory = WorldCategory | 'helipad' | 'connector-opening' | 'glass-roof' | 'decorative-surface' | 'prop';

export type MallWorldEntity = WorldEntity<MallWorldCategory, LevelId>;

const ZERO_ROTATION = { yaw: 0, pitch: 0, roll: 0 } as const;
const NO_PORTS = [] as const;
const NO_EMITTERS = [] as const;
const NO_MECHANISMS = [] as const;
const STRUCTURAL_OVERLAP: readonly PlacementClass[] = ['structure', 'fixture', 'connector'];

const STATIC_RECEIVER: InteractionReceiver = {
	mobility: 'static',
	mass: null,
	tags: ['anchored'],
	channels: [],
	responses: { translation: 'none', rotation: 'none' },
};

const CONNECTOR_RECEIVER: InteractionReceiver = {
	mobility: 'static',
	mass: null,
	tags: ['anchored', 'circulation'],
	channels: [],
	responses: { translation: 'none', rotation: 'none' },
};

function rectangle(centerX: number, centerZ: number, width: number, depth: number, yaw = 0): PlanShape {
	return { kind: 'rectangle', center: { x: centerX, z: centerZ }, width, depth, yaw };
}

function solidPrism(
	id: string,
	plan: PlanShape,
	minY: number,
	maxY: number,
	holes: readonly PlanShape[] = [],
	role: SpatialRole = 'solid',
): SpatialVolume {
	return {
		id,
		role,
		geometry: { kind: 'prism', plan, minY, maxY, holes },
		blocksMovement: role === 'solid',
		clearance: role === 'solid' || role === 'support' ? { kind: 'fixed-obstruction' } : { kind: 'clear' },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: ['authored-geometry'],
	};
}

function clearancePrism(
	id: string,
	plan: PlanShape,
	minY: number,
	maxY: number,
	role: 'opening-clearance' | 'connector-clearance',
): SpatialVolume {
	return {
		id,
		role,
		geometry: { kind: 'prism', plan, minY, maxY, holes: [] },
		blocksMovement: false,
		clearance: { kind: 'clear' },
		allowsOverlapFrom: ['connector'],
		tags: [role],
	};
}

function structurePlacement(): MallWorldEntity['placement'] {
	return { class: 'structure', requiresSupport: false, mayCover: [], mayBeCoveredBy: ['covering', 'clutter'] };
}

function connectorPlacement(): MallWorldEntity['placement'] {
	return { class: 'connector', requiresSupport: false, mayCover: [], mayBeCoveredBy: [] };
}

function map(layer: MallWorldEntity['map']['layer'], label?: string, priority = 50): MallWorldEntity['map'] {
	return { visible: true, layer, priority, ...(label === undefined ? {} : { label }) };
}

function openingEntity(
	id: string,
	label: string,
	levels: readonly LevelId[],
	plan: PlanShape,
	minY: number,
	maxY: number,
): MallWorldEntity {
	return {
		id,
		label,
		category: 'connector-opening',
		levels,
		transform: { position: { x: 0, y: 0, z: 0 }, rotation: ZERO_ROTATION },
		volumes: [clearancePrism('clearance', plan, minY, maxY, 'opening-clearance')],
		ports: NO_PORTS,
		placement: { class: 'structure', requiresSupport: false, mayCover: [], mayBeCoveredBy: [] },
		kinematics: { kind: 'static' },
		mechanisms: NO_MECHANISMS,
		receiver: STATIC_RECEIVER,
		emitters: NO_EMITTERS,
		map: map('opening', label, 100),
		tags: ['opening', 'must-remain-clear'],
	};
}

const MALL_FOOTPRINT_PLAN = rectanglePlan({ center: { x: 0, z: 0 }, size: MALL_FOOTPRINT });
const PARKING_FOOTPRINT_PLAN = rectanglePlan({ center: { x: 0, z: 0 }, size: PARKING_FOOTPRINT });
const V1_ATRIUM_PLAN = rectanglePlan(ATRIUM_OPENING);
const V1_ELEVATOR_PLAN = rectanglePlan(ELEVATOR_OPENING_V1);
const V0_ELEVATOR_PLAN = rectanglePlan(ELEVATOR_OPENING_V0);
const P1_ELEVATOR_PLAN = rectanglePlan(ELEVATOR_OPENING_P1);
export const SECRET_STAIRS_OPENING_PLAN = rectanglePlan(STAIR_CONNECTORS.secret.opening);
export const SECRET_STAIRS_OPENING_BOUNDS = planBounds(SECRET_STAIRS_OPENING_PLAN);
const ROOF_ELEVATOR_PLAN = rectanglePlan(ELEVATOR_OPENING_ROOF);

export const HELIPAD_DECK_PLAN = {
	kind: 'polygon',
	points: [
		{ x: 8, z: 7 },
		{ x: 32, z: 7 },
		{ x: 32, z: 23 },
		{ x: 8, z: 23 },
	],
} satisfies PlanShape;
export const HELIPAD_DECK_BOUNDS = planBounds(HELIPAD_DECK_PLAN);
export const HELIPAD_PAD_SPEC = {
	center: { x: 22, z: 16 },
	topRadius: 5.5,
	bottomRadius: 5.8,
	mapRadius: 5.3,
	height: 0.12,
} as const;

function connectorOpeningPlansAt(levelId: LevelId): readonly PlanShape[] {
	return VERTICAL_CONNECTORS.filter((connector) => connector.to === levelId).map((connector) => rectanglePlan(connector.opening));
}

const FLOOR_V1_HOLES = [V1_ATRIUM_PLAN, ...connectorOpeningPlansAt('v1'), V1_ELEVATOR_PLAN];
const ROOF_SLAB_HOLES = [V1_ATRIUM_PLAN, ...connectorOpeningPlansAt('roof'), ROOF_ELEVATOR_PLAN];

type StructuralSlabSpec = Readonly<{
	id: string;
	label: string;
	category: 'floor' | 'ceiling' | 'parking';
	level: LevelId;
	topY: number;
	thickness: number;
	plan: PlanShape;
	holes: readonly PlanShape[];
	mapLabel: string;
}>;

export const MALL_SLAB_SPECS = {
	v0: {
		id: 'mall-floor-v0',
		label: 'Ground-floor slab',
		category: 'floor',
		level: 'v0',
		topY: levelY('v0'),
		thickness: 0.3,
		plan: MALL_FOOTPRINT_PLAN,
		holes: [V0_ELEVATOR_PLAN],
		mapLabel: 'V0',
	},
	v1: {
		id: 'mall-floor-v1',
		label: 'First-floor slab',
		category: 'floor',
		level: 'v1',
		topY: levelY('v1'),
		thickness: 0.45,
		plan: MALL_FOOTPRINT_PLAN,
		holes: FLOOR_V1_HOLES,
		mapLabel: 'V1',
	},
	roof: {
		id: 'mall-roof-slab',
		label: 'Mall roof base',
		category: 'ceiling',
		level: 'roof',
		topY: levelY('roof'),
		thickness: 0.45,
		plan: MALL_FOOTPRINT_PLAN,
		holes: ROOF_SLAB_HOLES,
		mapLabel: 'Dak',
	},
} as const satisfies Readonly<Record<'v0' | 'v1' | 'roof', StructuralSlabSpec>>;

export const PARKING_SLAB_SPEC = {
	id: 'parking-floor',
	label: 'Parking deck',
	category: 'parking',
	level: 'p1',
	topY: levelY('p1'),
	thickness: 0.25,
	plan: PARKING_FOOTPRINT_PLAN,
	holes: [P1_ELEVATOR_PLAN],
	mapLabel: 'P1',
} as const satisfies StructuralSlabSpec;

function slabEntity(spec: StructuralSlabSpec): MallWorldEntity {
	return {
		id: spec.id,
		label: spec.label,
		category: spec.category,
		levels: [spec.level],
		transform: { position: { x: 0, y: spec.topY, z: 0 }, rotation: ZERO_ROTATION },
		volumes: [solidPrism('slab', spec.plan, spec.topY - spec.thickness, spec.topY, spec.holes, 'support')],
		ports: NO_PORTS,
		placement: structurePlacement(),
		kinematics: { kind: 'static' },
		mechanisms: NO_MECHANISMS,
		receiver: STATIC_RECEIVER,
		emitters: NO_EMITTERS,
		map: map(spec.category === 'parking' ? 'parking' : 'structure', spec.mapLabel, spec.category === 'parking' ? 40 : 50),
		tags: ['slab', 'walkable', 'structural', ...(spec.category === 'parking' ? ['parking'] : [])],
	};
}

const floorV0 = slabEntity(MALL_SLAB_SPECS.v0);
const floorV1 = slabEntity(MALL_SLAB_SPECS.v1);
const roofSlab = slabEntity(MALL_SLAB_SPECS.roof);
const parkingFloor = slabEntity(PARKING_SLAB_SPEC);

const MALL_WALL_MIN_Y = -0.3;
const MALL_WALL_MAX_Y = MALL_WALL_MIN_Y + (levelY('v1') - levelY('v0')) * 2 + 2;
const MALL_WALL_THICKNESS = 0.4;

export const MALL_WALL_SPECS = rectangularPerimeterWalls({
	footprint: MALL_FOOTPRINT,
	vertical: { min: MALL_WALL_MIN_Y, max: MALL_WALL_MAX_Y },
	thickness: MALL_WALL_THICKNESS,
	capOverlap: 0.5,
});

const MALL_WALLS: readonly MallWorldEntity[] = MALL_WALL_SPECS.map(({ id, position, size }) => ({
	id: `mall-wall-${id}`,
	label: `${id} mall wall`,
	category: 'wall',
	levels: ['v0', 'v1'],
	transform: { position, rotation: ZERO_ROTATION },
	volumes: [solidPrism('wall', rectangle(position.x, position.z, size.width, size.depth), MALL_WALL_MIN_Y, MALL_WALL_MAX_Y)],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', undefined, 70),
	tags: ['wall', 'structural', id],
}));

export const HELIPAD_DECK: MallWorldEntity = {
	id: 'helipad-deck',
	label: 'Helipad roof deck',
	category: 'helipad',
	levels: ['roof'],
	transform: { position: { x: 0, y: levelY('roof'), z: 0 }, rotation: ZERO_ROTATION },
	volumes: [
		solidPrism('deck', HELIPAD_DECK_PLAN, levelY('roof') - 0.35, levelY('roof'), [SECRET_STAIRS_OPENING_PLAN], 'support'),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', 'Helipad', 80),
	tags: ['helipad', 'slab', 'walkable', 'structural'],
};

export const HELIPAD_HATCH_FRAME_SPEC = { thickness: 0.12, height: 0.15 } as const;
const HATCH_FRAME_THICKNESS = HELIPAD_HATCH_FRAME_SPEC.thickness;
const HATCH_FRAME_HEIGHT = HELIPAD_HATCH_FRAME_SPEC.height;
const HATCH_FRAME_Y = levelY('roof') + half(HATCH_FRAME_HEIGHT);
const HATCH_WIDTH = span(SECRET_STAIRS_OPENING_BOUNDS.minX, SECRET_STAIRS_OPENING_BOUNDS.maxX);
const HATCH_DEPTH = span(SECRET_STAIRS_OPENING_BOUNDS.minZ, SECRET_STAIRS_OPENING_BOUNDS.maxZ);

export const HELIPAD_HATCH_FRAME_RAILS = cardinalWallPanels({
	center: STAIR_CONNECTORS.secret.opening.center,
	offset: {
		x: half(HATCH_WIDTH + HATCH_FRAME_THICKNESS),
		z: half(HATCH_DEPTH + HATCH_FRAME_THICKNESS),
	},
	span: { width: HATCH_WIDTH, depth: HATCH_DEPTH + HATCH_FRAME_THICKNESS * 2 },
	thickness: HATCH_FRAME_THICKNESS,
});

export const HELIPAD_HATCH_FRAME: MallWorldEntity = {
	id: 'helipad-hatch-frame',
	label: 'Secret-stairs roof hatch frame',
	category: 'helipad',
	levels: ['roof'],
	transform: {
		position: { x: STAIR_CONNECTORS.secret.opening.center.x, y: HATCH_FRAME_Y, z: STAIR_CONNECTORS.secret.opening.center.z },
		rotation: ZERO_ROTATION,
	},
	volumes: HELIPAD_HATCH_FRAME_RAILS.map((rail) =>
		solidPrism(rail.id, rectanglePlan(rail), levelY('roof'), levelY('roof') + HATCH_FRAME_HEIGHT),
	),
	ports: NO_PORTS,
	placement: { class: 'fixture', requiresSupport: true, mayCover: [], mayBeCoveredBy: [] },
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: { visible: false, layer: 'fixture', priority: 70 },
	tags: ['hatch-frame', 'structural'],
};

function connectorEntity(connector: VerticalConnector): MallWorldEntity {
	const { kind } = connector;
	const start = { x: connector.x, y: levelY(connector.from), z: connector.zBottom };
	const end = { x: connector.x, y: levelY(connector.to), z: connector.zTop };
	const geometry =
		kind === 'stairs'
			? ({
					kind: 'stair-flight',
					start,
					end,
					width: connector.width,
					treadCount: connector.steps,
					treadThickness: 0.12,
					underside: 'open',
				} as const)
			: ({ kind: 'ramp', start, end, width: connector.width, thickness: 0.2 } as const);
	const sourceVolumeId = 'travel-surface';
	const emitters: readonly InteractionEmitter[] =
		kind === 'escalator' && connector.collision.carrySpeed !== undefined
			? [
					{
						id: 'moving-treads',
						channel: 'conveyor',
						field: {
							kind: 'surface',
							vector: { x: 0, y: 0, z: Math.sign(connector.zTop - connector.zBottom) * connector.collision.carrySpeed },
							space: 'world',
						},
						sourceVolumeId,
						falloff: { kind: 'none' },
						timing: { kind: 'continuous' },
						targets: {
							mobility: ['character', 'dynamic', 'kinematic'],
							requireTags: ['grounded'],
							excludeTags: ['anchored', 'airborne'],
							requireChannels: ['conveyor'],
						},
						occlusion: { mode: 'none', blockingTags: [] },
					},
				]
			: NO_EMITTERS;
	return {
		id: connector.id,
		label: connector.label,
		category: 'vertical-circulation',
		levels: [connector.from, connector.to],
		transform: { position: start, rotation: ZERO_ROTATION },
		volumes: [
			{
				id: sourceVolumeId,
				role: 'walkable',
				geometry,
				blocksMovement: false,
				clearance: { kind: 'clear' },
				allowsOverlapFrom: STRUCTURAL_OVERLAP,
				tags: ['travel-surface'],
			},
			{
				id: 'solid-flight',
				role: 'solid',
				geometry,
				blocksMovement: true,
				clearance: { kind: 'clear' },
				allowsOverlapFrom: STRUCTURAL_OVERLAP,
				tags: ['flight', geometry.kind],
			},
			{
				id: 'route-clearance',
				role: 'connector-clearance',
				geometry: {
					kind: 'flight-clearance',
					start,
					end,
					width: connector.width,
					height: STANDING_PEDESTRIAN.requiredHeadroom,
				},
				blocksMovement: false,
				clearance: { kind: 'clear' },
				allowsOverlapFrom: ['connector'],
				tags: ['headroom', 'circulation'],
			},
		],
		ports: [
			{
				id: `${connector.id}-${connector.from}`,
				kind,
				position: start,
				direction: { x: 0, y: 0, z: Math.sign(connector.zTop - connector.zBottom) },
				width: connector.width,
				height: STANDING_PEDESTRIAN.requiredHeadroom,
				connectsTo: [`${connector.id}-${connector.to}`],
				oneWay: false,
				allows: ['walking'],
				clearanceVolumeId: 'route-clearance',
			},
			{
				id: `${connector.id}-${connector.to}`,
				kind,
				position: end,
				direction: { x: 0, y: 0, z: Math.sign(connector.zBottom - connector.zTop) },
				width: connector.width,
				height: STANDING_PEDESTRIAN.requiredHeadroom,
				connectsTo: [`${connector.id}-${connector.from}`],
				oneWay: false,
				allows: ['walking'],
				clearanceVolumeId: 'route-clearance',
			},
		],
		placement: connectorPlacement(),
		kinematics: { kind: 'static' },
		mechanisms: NO_MECHANISMS,
		receiver: CONNECTOR_RECEIVER,
		emitters,
		map: map('circulation', connector.label, 90),
		tags: ['circulation', kind],
	};
}

export const CONNECTOR_ENTITIES: readonly MallWorldEntity[] = VERTICAL_CONNECTORS.map(connectorEntity);

export const PARKING_EXIT_RAMP_ENTITY: MallWorldEntity = {
	id: PARKING_EXIT_RAMP.id,
	label: 'Parking exit ramp to city',
	category: 'vertical-circulation',
	levels: ['p1', 'v0'],
	transform: { position: PARKING_EXIT_RAMP.start, rotation: ZERO_ROTATION },
	volumes: [
		{
			id: 'travel-surface',
			role: 'walkable',
			geometry: {
				kind: 'ramp',
				start: PARKING_EXIT_RAMP.start,
				end: PARKING_EXIT_RAMP.end,
				width: PARKING_EXIT_RAMP.width,
				thickness: PARKING_EXIT_RAMP.thickness,
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['travel-surface', 'parking-exit'],
		},
		{
			id: 'route-clearance',
			role: 'connector-clearance',
			geometry: {
				kind: 'flight-clearance',
				start: PARKING_EXIT_RAMP.start,
				end: PARKING_EXIT_RAMP.end,
				width: PARKING_EXIT_RAMP.width,
				height: 2.4,
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: ['connector'],
			tags: ['headroom', 'parking-exit'],
		},
	],
	ports: [
		{
			id: 'parking-exit-p1',
			kind: 'ramp',
			position: PARKING_EXIT_RAMP.start,
			direction: { x: -1, y: 0, z: 0 },
			width: PARKING_EXIT_RAMP.width,
			height: 2.4,
			connectsTo: ['parking-exit-city'],
			oneWay: false,
			allows: ['walking', 'wheeled', 'service'],
			clearanceVolumeId: 'route-clearance',
		},
		{
			id: 'parking-exit-city',
			kind: 'ramp',
			position: PARKING_EXIT_RAMP.end,
			direction: { x: 1, y: 0, z: 0 },
			width: PARKING_EXIT_RAMP.width,
			height: 2.4,
			connectsTo: ['parking-exit-p1'],
			oneWay: false,
			allows: ['walking', 'wheeled', 'service'],
			clearanceVolumeId: 'route-clearance',
		},
	],
	placement: connectorPlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: CONNECTOR_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('circulation', 'Uitrit stad', 90),
	tags: ['circulation', 'ramp', 'parking-exit'],
};

const ELEVATOR_SHAFT_WIDTH = ELEVATOR_SPEC.cabin.width + ELEVATOR_SPEC.shaftGap * 2;
const ELEVATOR_SHAFT_DEPTH = ELEVATOR_SPEC.cabin.depth + ELEVATOR_SPEC.shaftGap * 2;
const ELEVATOR_SHAFT_PLAN = rectangle(ELEVATOR_SPEC.center.x, ELEVATOR_SPEC.center.z, ELEVATOR_SHAFT_WIDTH, ELEVATOR_SHAFT_DEPTH);

export const ELEVATOR_ENTITY: MallWorldEntity = {
	id: 'glass-elevator',
	label: 'Glass elevator',
	category: 'vertical-circulation',
	levels: LEVELS.map((entry) => entry.id),
	transform: { position: { x: ELEVATOR_SPEC.center.x, y: levelY('v0'), z: ELEVATOR_SPEC.center.z }, rotation: ZERO_ROTATION },
	volumes: [
		clearancePrism(
			'shaft-clearance',
			ELEVATOR_SHAFT_PLAN,
			levelY('p1') - 0.5,
			levelY('roof') + ELEVATOR_SPEC.cabin.height,
			'connector-clearance',
		),
		{
			id: 'cabin-platform',
			role: 'walkable',
			geometry: {
				kind: 'prism',
				plan: rectangle(ELEVATOR_SPEC.center.x, ELEVATOR_SPEC.center.z, ELEVATOR_SPEC.cabin.width, ELEVATOR_SPEC.cabin.depth),
				minY: levelY('v0'),
				maxY: levelY('v0') + 0.1,
				holes: [],
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: ['connector'],
			tags: ['moving-platform', 'rideable'],
		},
	],
	ports: LEVELS.map((entry) => ({
		id: `elevator-${entry.id}`,
		kind: 'elevator',
		position: { x: ELEVATOR_SPEC.center.x, y: entry.y, z: ELEVATOR_SPEC.center.z + ELEVATOR_SPEC.cabin.depth / 2 },
		direction: { x: 0, y: 0, z: 1 },
		width: ELEVATOR_SPEC.cabin.width,
		height: ELEVATOR_SPEC.cabin.height,
		connectsTo: LEVELS.filter((candidate) => candidate.id !== entry.id).map((candidate) => `elevator-${candidate.id}`),
		oneWay: false,
		allows: ['walking', 'wheeled', 'service'],
		clearanceVolumeId: 'shaft-clearance',
	})),
	placement: connectorPlacement(),
	kinematics: {
		kind: 'linear-path',
		stateId: 'elevator-cabin-position',
		stops: LEVELS.map((entry) => ({ x: ELEVATOR_SPEC.center.x, y: entry.y, z: ELEVATOR_SPEC.center.z })),
		speed: ELEVATOR_SPEC.speed,
		control: 'requested',
		carriesTargets: true,
	},
	mechanisms: NO_MECHANISMS,
	receiver: {
		mobility: 'kinematic',
		mass: null,
		tags: ['elevator', 'anchored-to-path'],
		channels: [],
		responses: { translation: 'set', rotation: 'none' },
	},
	emitters: [
		{
			id: 'cabin-carry',
			channel: 'linear-displacement',
			field: { kind: 'state', stateId: 'elevator-cabin-velocity', initial: { x: 0, y: 0, z: 0 }, space: 'world' },
			sourceVolumeId: 'cabin-platform',
			falloff: { kind: 'none' },
			timing: { kind: 'continuous' },
			targets: {
				mobility: ['character', 'dynamic'],
				requireTags: ['grounded'],
				excludeTags: ['anchored', 'airborne'],
				requireChannels: ['linear-displacement'],
			},
			occlusion: { mode: 'none', blockingTags: [] },
		},
	],
	map: map('circulation', 'Lift', 95),
	tags: ['circulation', 'elevator', 'moving-platform'],
};

const CONNECTOR_OPENING_ENTITIES: readonly MallWorldEntity[] = VERTICAL_CONNECTORS.map((connector) =>
	openingEntity(
		`opening-${connector.opening.id}`,
		`${connector.label} opening`,
		[connector.from, connector.to],
		rectanglePlan(connector.opening),
		levelY(connector.from),
		levelY(connector.to) + 0.5,
	),
);

export const OPENING_ENTITIES: readonly MallWorldEntity[] = [
	openingEntity(
		'opening-elevator-p1',
		'Elevator recess at P1',
		['p1'],
		P1_ELEVATOR_PLAN,
		levelY('p1') - 0.5,
		levelY('p1') + ELEVATOR_SPEC.cabin.height,
	),
	openingEntity(
		'opening-elevator-v0',
		'Elevator opening at V0',
		['p1', 'v0'],
		V0_ELEVATOR_PLAN,
		levelY('p1'),
		levelY('v0') + 0.5,
	),
	openingEntity('opening-atrium-v1', 'Atrium void', ['v0', 'v1'], V1_ATRIUM_PLAN, levelY('v0'), levelY('v1') + 0.5),
	...CONNECTOR_OPENING_ENTITIES,
	openingEntity(
		'opening-elevator-v1',
		'Elevator opening at V1',
		['v0', 'v1'],
		V1_ELEVATOR_PLAN,
		levelY('v0'),
		levelY('v1') + 0.5,
	),
	openingEntity(
		'opening-elevator-roof',
		'Elevator opening at roof',
		['v1', 'roof'],
		ROOF_ELEVATOR_PLAN,
		levelY('v1'),
		levelY('roof') + 0.5,
	),
];

const SPATIAL_SHOPS: readonly MallWorldEntity[] = shopStores().map((store) => ({
	id: `shop-${store.id}`,
	label: store.name,
	category: 'shop',
	levels: [store.level],
	transform: {
		position: { x: store.x, y: levelY(store.level), z: store.z },
		rotation: { yaw: store.rotation, pitch: 0, roll: 0 },
	},
	volumes: [
		solidPrism(
			'room-shell',
			rectangle(
				store.x - Math.sin(store.rotation) * store.depth * SHOP_ROOM_DEPTH_FACTOR * 0.5,
				store.z - Math.cos(store.rotation) * store.depth * SHOP_ROOM_DEPTH_FACTOR * 0.5,
				store.width,
				store.depth * SHOP_ROOM_DEPTH_FACTOR,
				store.rotation,
			),
			levelY(store.level),
			levelY(store.level) + SHOP_HEIGHT,
		),
	],
	ports: NO_PORTS,
	placement: { class: 'fixture', requiresSupport: true, mayCover: [], mayBeCoveredBy: ['clutter'] },
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('shop', store.name, 60),
	tags: ['shop', store.category, 'static'],
}));

export const WORLD_ENTITIES: readonly MallWorldEntity[] = [
	floorV0,
	floorV1,
	roofSlab,
	parkingFloor,
	...MALL_WALLS,
	HELIPAD_DECK,
	HELIPAD_HATCH_FRAME,
	...OPENING_ENTITIES,
	...CONNECTOR_ENTITIES,
	PARKING_EXIT_RAMP_ENTITY,
	ELEVATOR_ENTITY,
	...SPATIAL_SHOPS,
];

/** Relational view of the authored world. Callers do not maintain parallel per-level feature lists. */
export function entitiesOnLevel(levelId: LevelId): readonly MallWorldEntity[] {
	return WORLD_ENTITIES.filter((entity) => entity.levels.includes(levelId));
}

export function levelsContaining(category: MallWorldCategory): readonly LevelId[] {
	return LEVELS.filter((entry) => entitiesOnLevel(entry.id).some((entity) => entity.category === category)).map(
		(entry) => entry.id,
	);
}
