import { ATRIUM_VOID, MALL_FOOTPRINT, PARKING_FOOTPRINT } from '#/data/layout';
import { LEVELS, type LevelId, levelY } from '#/data/levels';
import type {
	InteractionEmitter,
	InteractionReceiver,
	PlacementClass,
	PlanShape,
	SpatialRole,
	SpatialVolume,
	WorldEntity,
} from '#/data/spatial';
import { shopStores } from '#/data/stores';

export type WorldCategory = 'floor' | 'ceiling' | 'wall' | 'opening' | 'shop' | 'vertical-circulation' | 'parking';

export type OpeningDef = Readonly<{
	id: string;
	category: 'atrium' | 'escalator' | 'stairs' | 'elevator';
	center: Readonly<{ x: number; z: number }>;
	size: Readonly<{ width: number; depth: number }>;
	connects: readonly LevelId[];
}>;

export type VerticalConnector = Readonly<{
	id: string;
	label: string;
	from: LevelId;
	to: LevelId;
	x: number;
	zBottom: number;
	zTop: number;
	width: number;
	steps: number;
	apron: number;
	opening: OpeningDef;
	collision: Readonly<{
		minX: number;
		maxX: number;
		minZ: number;
		maxZ: number;
		openMinZ: number;
		openMaxZ: number;
		carrySpeed?: number;
	}>;
}>;

export const ESCALATOR_SPEED = 0.5;
export const SHOP_HEIGHT = 4.2;
export const SHOP_ROOM_DEPTH_FACTOR = 0.92;
export const ELEVATOR_SPEC = {
	center: { x: 16, z: -8 },
	cabin: { width: 2, depth: 2, height: 2.55 },
	shaftGap: 0.12,
	padHalf: 2.75,
	speed: 1.85,
} as const;
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

export const ESCALATOR = {
	id: 'escalator',
	label: 'East escalator',
	from: 'v0',
	to: 'v1',
	x: 22,
	zBottom: 8,
	zTop: -2,
	width: 2.2,
	steps: 20,
	apron: 1,
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
} satisfies VerticalConnector;

export const STAIRS = {
	id: 'stairs',
	label: 'West stairs',
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
} satisfies VerticalConnector;

export const SECRET_STAIRS = {
	id: 'secret_stairs',
	label: 'Secret stairs to roof',
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
} satisfies VerticalConnector;

export const VERTICAL_CONNECTORS = [ESCALATOR, STAIRS, SECRET_STAIRS] as const;

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

const V1_ATRIUM_PLAN = rectangle(0, 0, ATRIUM_VOID.width, ATRIUM_VOID.depth);
const V1_ESCALATOR_PLAN = rectangle(
	ESCALATOR.opening.center.x,
	ESCALATOR.opening.center.z,
	ESCALATOR.opening.size.width,
	ESCALATOR.opening.size.depth,
);
const V1_STAIRS_PLAN = rectangle(
	STAIRS.opening.center.x,
	STAIRS.opening.center.z,
	STAIRS.opening.size.width,
	STAIRS.opening.size.depth,
);
const V1_ELEVATOR_PLAN = rectangle(
	ELEVATOR_OPENING_V1.center.x,
	ELEVATOR_OPENING_V1.center.z,
	ELEVATOR_OPENING_V1.size.width,
	ELEVATOR_OPENING_V1.size.depth,
);
const V0_ELEVATOR_PLAN = rectangle(
	ELEVATOR_OPENING_V0.center.x,
	ELEVATOR_OPENING_V0.center.z,
	ELEVATOR_OPENING_V0.size.width,
	ELEVATOR_OPENING_V0.size.depth,
);
const P1_ELEVATOR_PLAN = rectangle(
	ELEVATOR_OPENING_P1.center.x,
	ELEVATOR_OPENING_P1.center.z,
	ELEVATOR_OPENING_P1.size.width,
	ELEVATOR_OPENING_P1.size.depth,
);
export const SECRET_STAIRS_OPENING_PLAN = rectangle(
	SECRET_STAIRS.opening.center.x,
	SECRET_STAIRS.opening.center.z,
	SECRET_STAIRS.opening.size.width,
	SECRET_STAIRS.opening.size.depth,
);
export const SECRET_STAIRS_OPENING_BOUNDS = {
	minX: SECRET_STAIRS.opening.center.x - SECRET_STAIRS.opening.size.width / 2,
	maxX: SECRET_STAIRS.opening.center.x + SECRET_STAIRS.opening.size.width / 2,
	minZ: SECRET_STAIRS.opening.center.z - SECRET_STAIRS.opening.size.depth / 2,
	maxZ: SECRET_STAIRS.opening.center.z + SECRET_STAIRS.opening.size.depth / 2,
} as const;
const ROOF_ELEVATOR_PLAN = rectangle(
	ELEVATOR_OPENING_ROOF.center.x,
	ELEVATOR_OPENING_ROOF.center.z,
	ELEVATOR_OPENING_ROOF.size.width,
	ELEVATOR_OPENING_ROOF.size.depth,
);

export const HELIPAD_DECK_PLAN = {
	kind: 'polygon',
	points: [
		{ x: 8, z: 7 },
		{ x: 32, z: 7 },
		{ x: 32, z: 23 },
		{ x: 8, z: 23 },
	],
} satisfies PlanShape;
export const HELIPAD_DECK_BOUNDS = { minX: 8, maxX: 32, minZ: 7, maxZ: 23 } as const;
export const HELIPAD_PAD_SPEC = {
	center: { x: 22, z: 16 },
	topRadius: 5.5,
	bottomRadius: 5.8,
	mapRadius: 5.3,
	height: 0.12,
} as const;

const FLOOR_V1_HOLES = [V1_ATRIUM_PLAN, V1_ESCALATOR_PLAN, V1_STAIRS_PLAN, V1_ELEVATOR_PLAN] as const;
const ROOF_SLAB_HOLES = [V1_ATRIUM_PLAN, SECRET_STAIRS_OPENING_PLAN, ROOF_ELEVATOR_PLAN] as const;

const floorV0: MallWorldEntity = {
	id: 'mall-floor-v0',
	label: 'Ground-floor slab',
	category: 'floor',
	levels: ['v0'],
	transform: { position: { x: 0, y: 0, z: 0 }, rotation: ZERO_ROTATION },
	volumes: [
		solidPrism('slab', rectangle(0, 0, MALL_FOOTPRINT.width, MALL_FOOTPRINT.depth), -0.3, 0, [V0_ELEVATOR_PLAN], 'support'),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', 'V0'),
	tags: ['slab', 'walkable', 'structural'],
};

const floorV1: MallWorldEntity = {
	id: 'mall-floor-v1',
	label: 'First-floor slab',
	category: 'floor',
	levels: ['v1'],
	transform: { position: { x: 0, y: levelY('v1'), z: 0 }, rotation: ZERO_ROTATION },
	volumes: [
		solidPrism(
			'slab',
			rectangle(0, 0, MALL_FOOTPRINT.width, MALL_FOOTPRINT.depth),
			levelY('v1') - 0.45,
			levelY('v1'),
			FLOOR_V1_HOLES,
			'support',
		),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', 'V1'),
	tags: ['slab', 'walkable', 'structural'],
};

const roofSlab: MallWorldEntity = {
	id: 'mall-roof-slab',
	label: 'Mall roof base',
	category: 'ceiling',
	levels: ['roof'],
	transform: { position: { x: 0, y: levelY('roof'), z: 0 }, rotation: ZERO_ROTATION },
	volumes: [
		solidPrism(
			'slab',
			rectangle(0, 0, MALL_FOOTPRINT.width, MALL_FOOTPRINT.depth),
			levelY('roof') - 0.45,
			levelY('roof'),
			ROOF_SLAB_HOLES,
			'support',
		),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', 'Dak'),
	tags: ['slab', 'walkable', 'structural'],
};

const parkingFloor: MallWorldEntity = {
	id: 'parking-floor',
	label: 'Parking deck',
	category: 'parking',
	levels: ['p1'],
	transform: { position: { x: 0, y: levelY('p1'), z: 0 }, rotation: ZERO_ROTATION },
	volumes: [
		solidPrism(
			'slab',
			rectangle(0, 0, PARKING_FOOTPRINT.width, PARKING_FOOTPRINT.depth),
			levelY('p1') - 0.25,
			levelY('p1'),
			[P1_ELEVATOR_PLAN],
			'support',
		),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('parking', 'P1', 40),
	tags: ['slab', 'walkable', 'parking', 'structural'],
};

const MALL_WALL_HEIGHT = (levelY('v1') - levelY('v0')) * 2 + 2;
const MALL_WALL_MIN_Y = -0.3;
const MALL_WALL_MAX_Y = MALL_WALL_MIN_Y + MALL_WALL_HEIGHT;
const MALL_WALL_THICKNESS = 0.4;

const MALL_WALLS: readonly MallWorldEntity[] = [
	['north', 0, -MALL_FOOTPRINT.halfDepth, MALL_FOOTPRINT.width + 1, MALL_WALL_THICKNESS],
	['south', 0, MALL_FOOTPRINT.halfDepth, MALL_FOOTPRINT.width + 1, MALL_WALL_THICKNESS],
	['west', -MALL_FOOTPRINT.halfWidth, 0, MALL_WALL_THICKNESS, MALL_FOOTPRINT.depth],
	['east', MALL_FOOTPRINT.halfWidth, 0, MALL_WALL_THICKNESS, MALL_FOOTPRINT.depth],
].map(([side, x, z, width, depth]) => ({
	id: `mall-wall-${String(side)}`,
	label: `${String(side)} mall wall`,
	category: 'wall',
	levels: ['v0', 'v1'],
	transform: {
		position: { x: Number(x), y: (MALL_WALL_MIN_Y + MALL_WALL_MAX_Y) / 2, z: Number(z) },
		rotation: ZERO_ROTATION,
	},
	volumes: [solidPrism('wall', rectangle(Number(x), Number(z), Number(width), Number(depth)), MALL_WALL_MIN_Y, MALL_WALL_MAX_Y)],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', undefined, 70),
	tags: ['wall', 'structural', String(side)],
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
const HATCH_FRAME_Y = levelY('roof') + HELIPAD_HATCH_FRAME_SPEC.height / 2;
const HATCH_WIDTH = SECRET_STAIRS_OPENING_BOUNDS.maxX - SECRET_STAIRS_OPENING_BOUNDS.minX;
const HATCH_DEPTH = SECRET_STAIRS_OPENING_BOUNDS.maxZ - SECRET_STAIRS_OPENING_BOUNDS.minZ;

export const HELIPAD_HATCH_FRAME: MallWorldEntity = {
	id: 'helipad-hatch-frame',
	label: 'Secret-stairs roof hatch frame',
	category: 'helipad',
	levels: ['roof'],
	transform: {
		position: { x: SECRET_STAIRS.opening.center.x, y: HATCH_FRAME_Y, z: SECRET_STAIRS.opening.center.z },
		rotation: ZERO_ROTATION,
	},
	volumes: [
		solidPrism(
			'west-rail',
			rectangle(
				SECRET_STAIRS_OPENING_BOUNDS.minX - HATCH_FRAME_THICKNESS / 2,
				SECRET_STAIRS.opening.center.z,
				HATCH_FRAME_THICKNESS,
				HATCH_DEPTH + HATCH_FRAME_THICKNESS * 2,
			),
			levelY('roof'),
			levelY('roof') + HATCH_FRAME_HEIGHT,
		),
		solidPrism(
			'east-rail',
			rectangle(
				SECRET_STAIRS_OPENING_BOUNDS.maxX + HATCH_FRAME_THICKNESS / 2,
				SECRET_STAIRS.opening.center.z,
				HATCH_FRAME_THICKNESS,
				HATCH_DEPTH + HATCH_FRAME_THICKNESS * 2,
			),
			levelY('roof'),
			levelY('roof') + HATCH_FRAME_HEIGHT,
		),
		solidPrism(
			'north-rail',
			rectangle(
				SECRET_STAIRS.opening.center.x,
				SECRET_STAIRS_OPENING_BOUNDS.minZ - HATCH_FRAME_THICKNESS / 2,
				HATCH_WIDTH,
				HATCH_FRAME_THICKNESS,
			),
			levelY('roof'),
			levelY('roof') + HATCH_FRAME_HEIGHT,
		),
		solidPrism(
			'south-rail',
			rectangle(
				SECRET_STAIRS.opening.center.x,
				SECRET_STAIRS_OPENING_BOUNDS.maxZ + HATCH_FRAME_THICKNESS / 2,
				HATCH_WIDTH,
				HATCH_FRAME_THICKNESS,
			),
			levelY('roof'),
			levelY('roof') + HATCH_FRAME_HEIGHT,
		),
	],
	ports: NO_PORTS,
	placement: { class: 'fixture', requiresSupport: true, mayCover: [], mayBeCoveredBy: [] },
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: { visible: false, layer: 'fixture', priority: 70 },
	tags: ['hatch-frame', 'structural'],
};

function connectorEntity(connector: VerticalConnector, kind: 'stairs' | 'escalator'): MallWorldEntity {
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
		kind === 'escalator'
			? [
					{
						id: 'moving-treads',
						channel: 'conveyor',
						field: { kind: 'surface', vector: { x: 0, y: 0, z: -ESCALATOR_SPEED }, space: 'world' },
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
				geometry: { kind: 'flight-clearance', start, end, width: connector.width, height: 2.2 },
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
				height: 2.2,
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
				height: 2.2,
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

export const CONNECTOR_ENTITIES: readonly MallWorldEntity[] = [
	connectorEntity(ESCALATOR, 'escalator'),
	connectorEntity(STAIRS, 'stairs'),
	connectorEntity(SECRET_STAIRS, 'stairs'),
];

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
	openingEntity('opening-escalator-v1', 'Escalator opening', ['v0', 'v1'], V1_ESCALATOR_PLAN, levelY('v0'), levelY('v1') + 0.5),
	openingEntity('opening-stairs-v1', 'West stairs opening', ['v0', 'v1'], V1_STAIRS_PLAN, levelY('v0'), levelY('v1') + 0.5),
	openingEntity(
		'opening-elevator-v1',
		'Elevator opening at V1',
		['v0', 'v1'],
		V1_ELEVATOR_PLAN,
		levelY('v0'),
		levelY('v1') + 0.5,
	),
	openingEntity(
		'opening-secret-stairs-roof',
		'Secret stairs roof opening',
		['v1', 'roof'],
		SECRET_STAIRS_OPENING_PLAN,
		levelY('v1'),
		levelY('roof') + 0.5,
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
