import { STANDING_PEDESTRIAN } from '#/data/character';
import type { EscalatorSpec, OpeningDef, StairSpec, VerticalConnector } from '#/data/connectors';
import { ATRIUM_VOID, MALL_FOOTPRINT, PARKING_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, levelY } from '#/data/levels';
import type {
	Bounds2,
	InteractionEmitter,
	InteractionReceiver,
	Penetration,
	PlacementClass,
	PlanShape,
	SpatialRole,
	SpatialVolume,
	Vec2,
	Vec3,
	WorldEntity,
} from '#/data/spatial';
import { geometryBounds, PLAN_ENVELOPE_TAG, planBounds, rectanglePlan } from '#/data/spatial';
import type { StoreDef } from '#/data/stores';
import { requireStore, shopStores } from '#/data/stores';
import { cardinalWallPanels, rectangleCornerPoints, rectangularPerimeterWalls } from '#/data/structure';
import { unreachable } from '#/util/invariant';
import { half, midpoint, span } from '#/util/math';

export type WorldCategory = 'floor' | 'ceiling' | 'wall' | 'opening' | 'shop' | 'vertical-circulation' | 'parking';

export const ESCALATOR_SPEED = 0.5;
export const SHOP_HEIGHT = 4.2;
export const SHOP_ROOM_DEPTH_FACTOR = 0.92;
/** Floor a shopfront keeps for itself, so a shopper can stand at the window and step in. */
export const STOREFRONT_CLEARANCE_DEPTH = 1.5;
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
			riserHeightExtra: 0.02,
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
			widthScale: 1.4,
		},
		structure: {
			trussDrop: 0.4,
			surfaceGap: 0.02,
			lightStripExtraThickness: 0.005,
		},
		landing: {
			lateralOverhang: 0.2,
			bottomThickness: 0.02,
			bottomDepthExtension: 0.3,
			topThickness: 0.14,
			combDepthExtension: 0.05,
			combThickness: 0.05,
			combSurfaceLift: 0.02,
		},
		newel: {
			heightAboveGlassCenter: 0.02,
			thickness: 0.16,
			depth: 0.85,
		},
		guard: {
			height: 0.95,
			glassThickness: 0.03,
			slabOffset: 0.12,
			railOverhang: 0.04,
			railHeight: 0.07,
		},
		sign: {
			gantryHeight: 2.6,
			widthMargin: 0.4,
			postRadius: 0.05,
			verticalGap: 0.06,
		},
	},
	constraints: {
		inclineDegrees: { min: 25, max: 35 },
		alignmentTolerance: 0.001,
	},
} as const;

export const VERTICAL_CONNECTORS = [
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
	{
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
		appearance: {
			surfaceOffset: 0,
			step: {
				widthInset: 0,
				treadThickness: 0.12,
				treadDepthRatio: 0.92,
				riserThickness: 0.06,
				riserHeightRatio: 0.95,
				riserDepthRatio: 0.45,
			},
			landing: {
				widthExtra: 0.6,
				bottomDepth: 1.4,
				bottomOffset: 0.5,
				topDepth: 1.5,
				topOffset: 0.35,
			},
			rail: {
				sideOffsetFromEdge: 0.06,
				height: 0.75,
				postCenterDrop: 0.35,
				postRadius: 0.03,
				postEverySteps: 1,
				segmentThickness: 0.06,
			},
			guard: {
				height: 0.95,
				glassThickness: 0.03,
				slabOffset: 0.12,
				railOverhang: 0.04,
				railHeight: 0.07,
			},
			stringer: { width: 0.1, heightExtra: 0.08, depthRatio: 0.95 },
			sign: { width: 1.9, height: 0.48, centerY: 1.6, approachOffset: 0.2 },
		},
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
	{
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
		appearance: {
			surfaceOffset: 0.05,
			step: {
				widthInset: 0.4,
				treadThickness: 0.12,
				treadDepthRatio: 0.9,
				riserThickness: 0.06,
				riserHeightRatio: 0.95,
				riserDepthRatio: 0.42,
			},
			rail: {
				sideOffsetFromEdge: -0.1,
				height: 0.7,
				postCenterDrop: 0.35,
				postRadius: 0.03,
				postEverySteps: 2,
				segmentThickness: 0.06,
			},
			guard: {
				height: 0.95,
				glassThickness: 0.03,
				slabOffset: 0.12,
				railOverhang: 0.04,
				railHeight: 0.07,
			},
			serviceEntrance: {
				door: {
					width: 1.4,
					height: 2.2,
					thickness: 0.12,
					lateralOffset: -1.2,
					verticalOffset: 1.1,
					depthOffset: -0.8,
				},
				sign: {
					width: 1.5,
					height: 0.55,
					lateralOffset: -1.2,
					verticalOffset: 2,
					depthOffset: -0.72,
				},
			},
		},
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
] as const satisfies readonly VerticalConnector[];

function partitionVerticalConnectors(connectors: readonly VerticalConnector[]): Readonly<{
	escalators: readonly EscalatorSpec[];
	stairs: readonly StairSpec[];
}> {
	const escalators: EscalatorSpec[] = [];
	const stairs: StairSpec[] = [];
	for (const connector of connectors) {
		switch (connector.kind) {
			case 'escalator':
				escalators.push(connector);
				break;
			case 'stairs':
				stairs.push(connector);
				break;
			default:
				unreachable(connector, 'unknown vertical connector kind');
		}
	}
	return { escalators, stairs };
}

const CONNECTORS_BY_KIND = partitionVerticalConnectors(VERTICAL_CONNECTORS);
export const ESCALATORS = CONNECTORS_BY_KIND.escalators;
export const STAIR_CONNECTORS = CONNECTORS_BY_KIND.stairs;

export function stairConnector(id: string): StairSpec {
	const connector = STAIR_CONNECTORS.find((candidate) => candidate.id === id);
	if (!connector) throw new Error(`no stair connector '${id}'`);
	return connector;
}

const secretStairs = stairConnector('secret-stairs');

export type MallWorldCategory =
	| WorldCategory
	| 'helipad'
	| 'connector-opening'
	| 'glass-roof'
	| 'decorative-surface'
	| 'facility'
	| 'prop';

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
	blocksMovement: boolean = role === 'solid',
): SpatialVolume {
	return {
		id,
		role,
		geometry: { kind: 'prism', plan, minY, maxY, holes },
		blocksMovement,
		clearance: blocksMovement || role === 'support' ? { kind: 'fixed-obstruction' } : { kind: 'clear' },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: ['authored-geometry'],
	};
}

function uprightCylinder(
	id: string,
	center: Vec3,
	radius: number,
	height: number,
	role: SpatialRole,
	blocksMovement: boolean,
): SpatialVolume {
	return {
		id,
		role,
		geometry: { kind: 'cylinder', center, radius, height, axis: 'y' },
		blocksMovement,
		clearance: blocksMovement ? { kind: 'fixed-obstruction' } : { kind: 'clear' },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: ['authored-geometry'],
	};
}

function clearancePrism(
	id: string,
	plan: PlanShape,
	minY: number,
	maxY: number,
	role: 'opening-clearance' | 'connector-clearance' | 'storefront-clearance',
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

function planEnvelope(volume: SpatialVolume): SpatialVolume {
	return { ...volume, tags: [...volume.tags, PLAN_ENVELOPE_TAG] };
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
export const SECRET_STAIRS_OPENING_PLAN = rectanglePlan(secretStairs.opening);
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
/**
 * De dekplaat ligt óp de dakplaat. Als dikke plaat mét zijn bovenkant op
 * levelY('roof') lag hij in het dak en flikkerde hij over de hele 24×16 m.
 * Het loopvlak blijft levelY('roof'): het dak heeft één hoogte en check-world
 * eist dat de uiteinden van elke vlucht daarop uitkomen.
 */
export const HELIPAD_DECK_THICKNESS = 0.05;
export const HELIPAD_DECK_TOP_Y = levelY('roof') + HELIPAD_DECK_THICKNESS;
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
		// Geen kaartlabel: een vloerplaat beslaat het hele dek, dus zijn label landt
		// midden op de kaart. Op het dak was dat het atriumgat, met het woord DAK in
		// een gat waar juist geen dak zit.
		map: map(spec.category === 'parking' ? 'parking' : 'structure', undefined, spec.category === 'parking' ? 40 : 50),
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

/**
 * De vier wandkasten delen hun hoeken: de noord- en zuidkap lopen over het
 * uiteinde van de zij-wanden heen, precies een halve wanddikte diep.
 */
const MALL_WALL_CORNER_JOIN: Penetration = { depth: half(MALL_WALL_THICKNESS), into: ['structure'] };

/**
 * The inner faces of the perimeter walls. A room may stand against one; it starts
 * poking out through the facade once its geometry runs past one without saying so.
 */
function mallInteriorBounds(): Bounds2 {
	let minX = Number.NEGATIVE_INFINITY;
	let maxX = Number.POSITIVE_INFINITY;
	let minZ = Number.NEGATIVE_INFINITY;
	let maxZ = Number.POSITIVE_INFINITY;
	for (const wall of MALL_WALL_SPECS) {
		switch (wall.id) {
			case 'west':
				minX = Math.max(minX, wall.position.x + half(wall.size.width));
				break;
			case 'east':
				maxX = Math.min(maxX, wall.position.x - half(wall.size.width));
				break;
			case 'north':
				minZ = Math.max(minZ, wall.position.z + half(wall.size.depth));
				break;
			case 'south':
				maxZ = Math.min(maxZ, wall.position.z - half(wall.size.depth));
				break;
		}
	}
	return { minX, maxX, minZ, maxZ };
}

const MALL_INTERIOR = mallInteriorBounds();

const MALL_WALLS: readonly MallWorldEntity[] = MALL_WALL_SPECS.map(({ id, position, size }) => ({
	id: `mall-wall-${id}`,
	label: `${id} mall wall`,
	category: 'wall',
	levels: ['v0', 'v1'],
	transform: { position, rotation: ZERO_ROTATION },
	volumes: [
		{
			...solidPrism('wall', rectangle(position.x, position.z, size.width, size.depth), MALL_WALL_MIN_Y, MALL_WALL_MAX_Y),
			penetration: MALL_WALL_CORNER_JOIN,
		},
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', undefined, 70),
	tags: ['wall', 'structural', id],
}));

/**
 * De plattegrond is Nederlands en schrijft plekken in kapitalen. Waar de
 * directory een plek al benoemt, schrijft het kaartlabel die naam niet over.
 */
const helipadStore = requireStore('helipad');
const elevatorStore = requireStore('elevator');

export const HELIPAD_DECK: MallWorldEntity = {
	id: 'helipad-deck',
	label: 'Helipad roof deck',
	category: 'helipad',
	levels: ['roof'],
	transform: { position: { x: 0, y: levelY('roof'), z: 0 }, rotation: ZERO_ROTATION },
	volumes: [solidPrism('deck', HELIPAD_DECK_PLAN, levelY('roof'), HELIPAD_DECK_TOP_Y, [SECRET_STAIRS_OPENING_PLAN], 'support')],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', helipadStore.name, 80),
	tags: ['helipad', 'slab', 'walkable', 'structural'],
};

export const HELIPAD_HATCH_FRAME_SPEC = { thickness: 0.12, height: 0.15 } as const;
const HATCH_FRAME_THICKNESS = HELIPAD_HATCH_FRAME_SPEC.thickness;
const HATCH_FRAME_HEIGHT = HELIPAD_HATCH_FRAME_SPEC.height;
const HATCH_FRAME_Y = HELIPAD_DECK_TOP_Y + half(HATCH_FRAME_HEIGHT);
const HATCH_WIDTH = span(SECRET_STAIRS_OPENING_BOUNDS.minX, SECRET_STAIRS_OPENING_BOUNDS.maxX);
const HATCH_DEPTH = span(SECRET_STAIRS_OPENING_BOUNDS.minZ, SECRET_STAIRS_OPENING_BOUNDS.maxZ);

export const HELIPAD_HATCH_FRAME_RAILS = cardinalWallPanels({
	center: secretStairs.opening.center,
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
		position: { x: secretStairs.opening.center.x, y: HATCH_FRAME_Y, z: secretStairs.opening.center.z },
		rotation: ZERO_ROTATION,
	},
	volumes: HELIPAD_HATCH_FRAME_RAILS.map((rail) =>
		solidPrism(rail.id, rectanglePlan(rail), HELIPAD_DECK_TOP_Y, HELIPAD_DECK_TOP_Y + HATCH_FRAME_HEIGHT),
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
		map: map('circulation', kind === 'escalator' ? 'ROLTRAP' : 'TRAP', 90),
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
	map: map('circulation', 'UITRIT STAD', 90),
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
		position: { x: ELEVATOR_SPEC.center.x, y: entry.y, z: ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth) },
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
	map: map('circulation', elevatorStore.name, 95),
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

/** How far a point may travel along a direction before it leaves the mall interior. */
function runToMallInterior(x: number, z: number, dirX: number, dirZ: number): number {
	const limits: number[] = [];
	if (dirX > 0) limits.push((MALL_INTERIOR.maxX - x) / dirX);
	if (dirX < 0) limits.push((MALL_INTERIOR.minX - x) / dirX);
	if (dirZ > 0) limits.push((MALL_INTERIOR.maxZ - z) / dirZ);
	if (dirZ < 0) limits.push((MALL_INTERIOR.minZ - z) / dirZ);
	return limits.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...limits);
}

/**
 * De winkelruimte groeit vanaf de pui naar achteren. KRUIDVAT's 7 m eindigde
 * 0.24 m buiten de noordgevel, dus de achterwand stopt bij de binnenkant van de
 * perimetermuur. De mesh in MallBuilder en het volume hieronder lezen dit samen.
 */
export function shopRoomDepth(store: StoreDef): number {
	const authored = store.depth * SHOP_ROOM_DEPTH_FACTOR;
	const run = runToMallInterior(store.x, store.z, -Math.sin(store.rotation), -Math.cos(store.rotation));
	return Math.min(authored, run);
}

function shopEntity(store: StoreDef): MallWorldEntity {
	const roomDepth = shopRoomDepth(store);
	return {
		id: `shop-${store.id}`,
		label: store.name,
		category: 'shop',
		levels: [store.level],
		transform: {
			position: { x: store.x, y: levelY(store.level), z: store.z },
			rotation: { yaw: store.rotation, pitch: 0, roll: 0 },
		},
		volumes: [
			planEnvelope(
				solidPrism(
					'room-shell',
					rectangle(
						store.x - Math.sin(store.rotation) * half(roomDepth),
						store.z - Math.cos(store.rotation) * half(roomDepth),
						store.width,
						roomDepth,
						store.rotation,
					),
					levelY(store.level),
					levelY(store.level) + SHOP_HEIGHT,
				),
			),
			clearancePrism(
				'frontage',
				rectangle(
					store.x + Math.sin(store.rotation) * half(STOREFRONT_CLEARANCE_DEPTH),
					store.z + Math.cos(store.rotation) * half(STOREFRONT_CLEARANCE_DEPTH),
					store.width,
					STOREFRONT_CLEARANCE_DEPTH,
					store.rotation,
				),
				levelY(store.level),
				levelY(store.level) + STANDING_PEDESTRIAN.requiredHeadroom,
				'storefront-clearance',
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
	};
}

const SPATIAL_SHOPS: readonly MallWorldEntity[] = shopStores().map(shopEntity);

// ── authored rooms, props and the parking deck ─────────────────────────────
// Each spec is read by its scene builder as well as by the entity below it.

const restroomsStore = requireStore('toilets');
const prayerStore = requireStore('prayer');
const beardCaveStore = requireStore('beard_cave');
const islandHopStore = requireStore('island_hop');
const parkingStore = requireStore('parking');
const kioskStore = requireStore('info');
const foodCourtStore = requireStore('foodcourt');
const protestStore = requireStore('protest');

const V0_Y = levelY('v0');
const V1_Y = levelY('v1');
const ROOF_Y = levelY('roof');

type RoomEntitySpec = Readonly<{
	id: string;
	label: string;
	category: MallWorldCategory;
	level: LevelId;
	center: Vec2;
	placementClass: PlacementClass;
	volumes: readonly SpatialVolume[];
	map: MallWorldEntity['map'];
	tags: readonly string[];
}>;

function roomEntity(spec: RoomEntitySpec): MallWorldEntity {
	return {
		id: spec.id,
		label: spec.label,
		category: spec.category,
		levels: [spec.level],
		transform: { position: { x: spec.center.x, y: levelY(spec.level), z: spec.center.z }, rotation: ZERO_ROTATION },
		volumes: spec.volumes,
		ports: NO_PORTS,
		placement: { class: spec.placementClass, requiresSupport: true, mayCover: [], mayBeCoveredBy: ['clutter'] },
		kinematics: { kind: 'static' },
		mechanisms: NO_MECHANISMS,
		receiver: STATIC_RECEIVER,
		emitters: NO_EMITTERS,
		map: spec.map,
		tags: spec.tags,
	};
}

/**
 * De hele installatie past tussen de winkelpui van Douglas (tot z −4) en de
 * toiletblok-wand (vanaf z 8.85). Elk backdrop dat op de hartlijn x −28 staat is
 * breder dan die 0,5 m tot de Douglas-frontage, dus de vrije ruimte is z, niet x.
 */
export const CATWALK_SPEC = {
	runwayX: -28,
	startZ: -2,
	tipZ: 6,
	podiumY: 0.34,
	halfWidth: 1.35,
	/** Extra deck length beyond the walked span, split over both ends. */
	deckMargin: 2.4,
	tipOffset: 1.2,
	backdrop: { width: 5.4, height: 4.2, thickness: 0.18, offset: 1.6 },
	seating: { offsetX: 2.3, firstOffset: 1.4, spacing: 2 },
} as const;

const CATWALK_DECK_CENTER_Z = midpoint(CATWALK_SPEC.startZ, CATWALK_SPEC.tipZ);
const CATWALK_DECK_LENGTH = span(CATWALK_SPEC.startZ, CATWALK_SPEC.tipZ) + CATWALK_SPEC.deckMargin;
const CATWALK_DECK_TOP = V0_Y + CATWALK_SPEC.podiumY;
const CATWALK_DECK_PLAN = rectangle(CATWALK_SPEC.runwayX, CATWALK_DECK_CENTER_Z, CATWALK_SPEC.halfWidth * 2, CATWALK_DECK_LENGTH);

/** Runway footprint the deck mesh, the walkable platform and the kerb all read. */
export const CATWALK_DECK = {
	centerZ: CATWALK_DECK_CENTER_Z,
	length: CATWALK_DECK_LENGTH,
	topY: CATWALK_DECK_TOP,
	minX: CATWALK_SPEC.runwayX - CATWALK_SPEC.halfWidth,
	maxX: CATWALK_SPEC.runwayX + CATWALK_SPEC.halfWidth,
	minZ: CATWALK_DECK_CENTER_Z - half(CATWALK_DECK_LENGTH),
	maxZ: CATWALK_SPEC.tipZ + CATWALK_SPEC.tipOffset + CATWALK_SPEC.halfWidth,
	noseCenterZ: CATWALK_SPEC.tipZ + CATWALK_SPEC.tipOffset,
	noseRadius: CATWALK_SPEC.halfWidth,
} as const;

/** Chairs run alongside the walked span and stop before the nose. */
export function catwalkSeatRows(): number {
	const { startZ, tipZ, seating } = CATWALK_SPEC;
	return Math.floor((span(startZ, tipZ) - seating.firstOffset) / seating.spacing) + 1;
}

export const CATWALK_ENTITY: MallWorldEntity = roomEntity({
	id: 'catwalk',
	label: 'Fashion Week runway',
	category: 'prop',
	level: 'v0',
	center: { x: CATWALK_SPEC.runwayX, z: CATWALK_DECK_CENTER_Z },
	placementClass: 'fixture',
	volumes: [
		solidPrism('deck', CATWALK_DECK_PLAN, V0_Y, CATWALK_DECK_TOP, [], 'walkable'),
		uprightCylinder(
			'deck-tip',
			{ x: CATWALK_SPEC.runwayX, y: midpoint(V0_Y, CATWALK_DECK_TOP), z: CATWALK_DECK.noseCenterZ },
			CATWALK_DECK.noseRadius,
			CATWALK_SPEC.podiumY,
			'walkable',
			false,
		),
		solidPrism(
			'backdrop',
			rectangle(
				CATWALK_SPEC.runwayX,
				CATWALK_SPEC.startZ - CATWALK_SPEC.backdrop.offset,
				CATWALK_SPEC.backdrop.width,
				CATWALK_SPEC.backdrop.thickness,
			),
			V0_Y,
			V0_Y + CATWALK_SPEC.backdrop.height,
			[],
			'solid',
			false,
		),
	],
	map: map('fixture', 'CATWALK', 65),
	tags: ['catwalk', 'runway', 'spotlight'],
});

export const RESTROOMS_SPEC = {
	center: { x: restroomsStore.x, z: restroomsStore.z },
	shell: { width: 8.2, depth: 6.4 },
	floorThickness: 0.08,
	wallHeight: 3,
	wallThickness: 0.16,
	/** The shell walls stand just inside the tiled floor edge. */
	wallInset: 0.05,
	fascia: { height: 0.5, thickness: 0.12 },
	/** Heren and dames are separate rooms; the gap between their floor zones is this wall. */
	divider: { thickness: 0.3, backGap: 0.4, frontGap: 0.6 },
} as const;

/**
 * De inzet gold voor de hartlijn en niet voor het wandvlak, dus stak elke wand
 * een halve dikte voorbij de tegelplaat waar hij uit gemeten is.
 */
function restroomsWallCenter(halfSpan: number, thickness: number): number {
	return halfSpan - RESTROOMS_SPEC.wallInset - half(thickness);
}

/** Wandharten van de schil: mesh, collider en volume lezen dezelfde drie. */
export const RESTROOMS_SHELL = {
	sideX: restroomsWallCenter(half(RESTROOMS_SPEC.shell.width), RESTROOMS_SPEC.wallThickness),
	frontZ: restroomsWallCenter(half(RESTROOMS_SPEC.shell.depth), RESTROOMS_SPEC.wallThickness),
	fasciaZ: restroomsWallCenter(half(RESTROOMS_SPEC.shell.depth), RESTROOMS_SPEC.fascia.thickness),
} as const;

const RESTROOMS_WALL_TOP = V0_Y + RESTROOMS_SPEC.wallHeight;
const RESTROOMS_HALF_DEPTH = half(RESTROOMS_SPEC.shell.depth);

const RESTROOMS_DIVIDER_MIN_Z = -RESTROOMS_HALF_DEPTH + RESTROOMS_SPEC.divider.backGap;
const RESTROOMS_DIVIDER_MAX_Z = RESTROOMS_HALF_DEPTH - RESTROOMS_SPEC.divider.frontGap;

/** The divider wall in the block's own frame: mesh, collider and plan all read this. */
export const RESTROOMS_DIVIDER = {
	minZ: RESTROOMS_DIVIDER_MIN_Z,
	maxZ: RESTROOMS_DIVIDER_MAX_Z,
	centerZ: midpoint(RESTROOMS_DIVIDER_MIN_Z, RESTROOMS_DIVIDER_MAX_Z),
	depth: span(RESTROOMS_DIVIDER_MIN_Z, RESTROOMS_DIVIDER_MAX_Z),
	thickness: RESTROOMS_SPEC.divider.thickness,
} as const;

/**
 * Wat er ín het blok staat. De hokjes, de urinoirwand en de wastafels bestonden
 * alleen als meubels in Restrooms.ts, dus tekende de plattegrond een lege doos
 * van acht bij zes meter met een streep in het midden.
 */
export const RESTROOMS_INTERIOR = {
	/** Heren links van de scheidingswand, dames rechts. */
	roomOffsetX: 2,
	zone: { width: 3.6, depth: 5.6, thickness: 0.02, centerY: 0.09 },
	urinalWall: { width: 3.2, height: 1.4, thickness: 0.08, centerY: 0.9, offsetZ: -2.6 },
	urinals: { count: 3, spacing: 1.1, offsetZ: -2.45 },
	stall: { width: 1.1, depth: 1.4, height: 2 },
	mensStall: { offsetX: 1.15, offsetZ: 1.1 },
	womensStall: { offsetX: 1, offsetZ: 0.2 },
	basin: { width: 0.7, depth: 0.45, height: 0.98 },
	mensBasin: { offsetX: -1.2, offsetZ: 2.2 },
	womensBasin: { offsetX: 1, offsetZ: 2.3 },
	/** De wudu-nis staat vóór de pui: naast de twee zones is geen meter over. */
	wudu: {
		offsetX: -0.1,
		offsetZ: 3.6,
		bench: { width: 2.4, depth: 0.7, height: 0.35, centerY: 0.2 },
		basin: { width: 2.2, depth: 0.55, height: 0.18, centerY: 0.42 },
	},
} as const;

function restroomsFitting(
	id: string,
	offset: Vec2,
	width: number,
	depth: number,
	height: number,
	role: SpatialRole = 'solid',
): SpatialVolume {
	return solidPrism(
		id,
		rectangle(RESTROOMS_SPEC.center.x + offset.x, RESTROOMS_SPEC.center.z + offset.z, width, depth),
		V0_Y,
		V0_Y + height,
		[],
		role,
		false,
	);
}

/** Het meubilair van beide toiletruimtes, uit dezelfde maten als de meshes. */
function restroomsInteriorVolumes(): readonly SpatialVolume[] {
	const interior = RESTROOMS_INTERIOR;
	const { roomOffsetX, zone, urinalWall, stall, basin } = interior;
	const zoneTop = zone.centerY + half(zone.thickness);
	const urinalWallTop = urinalWall.centerY + half(urinalWall.height);
	return [
		restroomsFitting('zone-mens', { x: -roomOffsetX, z: 0 }, zone.width, zone.depth, zoneTop, 'decorative-covering'),
		restroomsFitting('zone-womens', { x: roomOffsetX, z: 0 }, zone.width, zone.depth, zoneTop, 'decorative-covering'),
		restroomsFitting(
			'urinal-wall',
			{ x: -roomOffsetX, z: urinalWall.offsetZ },
			urinalWall.width,
			urinalWall.thickness,
			urinalWallTop,
		),
		restroomsFitting(
			'stall-mens',
			{ x: -roomOffsetX + interior.mensStall.offsetX, z: interior.mensStall.offsetZ },
			stall.width,
			stall.depth,
			stall.height,
		),
		restroomsFitting(
			'stall-womens-west',
			{ x: roomOffsetX - interior.womensStall.offsetX, z: interior.womensStall.offsetZ },
			stall.width,
			stall.depth,
			stall.height,
		),
		restroomsFitting(
			'stall-womens-east',
			{ x: roomOffsetX + interior.womensStall.offsetX, z: interior.womensStall.offsetZ },
			stall.width,
			stall.depth,
			stall.height,
		),
		restroomsFitting(
			'basin-mens',
			{ x: -roomOffsetX + interior.mensBasin.offsetX, z: interior.mensBasin.offsetZ },
			basin.width,
			basin.depth,
			basin.height,
		),
		restroomsFitting(
			'basin-womens-west',
			{ x: roomOffsetX - interior.womensBasin.offsetX, z: interior.womensBasin.offsetZ },
			basin.width,
			basin.depth,
			basin.height,
		),
		restroomsFitting(
			'basin-womens-east',
			{ x: roomOffsetX + interior.womensBasin.offsetX, z: interior.womensBasin.offsetZ },
			basin.width,
			basin.depth,
			basin.height,
		),
	];
}

export const RESTROOMS_ENTITY: MallWorldEntity = roomEntity({
	id: 'restrooms',
	label: 'Restroom block',
	category: 'facility',
	level: 'v0',
	center: RESTROOMS_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		planEnvelope(
			solidPrism(
				'floor-tile',
				rectangle(RESTROOMS_SPEC.center.x, RESTROOMS_SPEC.center.z, RESTROOMS_SPEC.shell.width, RESTROOMS_SPEC.shell.depth),
				V0_Y,
				V0_Y + RESTROOMS_SPEC.floorThickness,
				[],
				'decorative-covering',
			),
		),
		solidPrism(
			'wall-north',
			rectangle(
				RESTROOMS_SPEC.center.x,
				RESTROOMS_SPEC.center.z - RESTROOMS_SHELL.frontZ,
				RESTROOMS_SPEC.shell.width,
				RESTROOMS_SPEC.wallThickness,
			),
			V0_Y,
			RESTROOMS_WALL_TOP,
		),
		solidPrism(
			'wall-west',
			rectangle(
				RESTROOMS_SPEC.center.x - RESTROOMS_SHELL.sideX,
				RESTROOMS_SPEC.center.z,
				RESTROOMS_SPEC.wallThickness,
				RESTROOMS_SPEC.shell.depth,
			),
			V0_Y,
			RESTROOMS_WALL_TOP,
		),
		solidPrism(
			'wall-east',
			rectangle(
				RESTROOMS_SPEC.center.x + RESTROOMS_SHELL.sideX,
				RESTROOMS_SPEC.center.z,
				RESTROOMS_SPEC.wallThickness,
				RESTROOMS_SPEC.shell.depth,
			),
			V0_Y,
			RESTROOMS_WALL_TOP,
		),
		solidPrism(
			'divider',
			rectangle(
				RESTROOMS_SPEC.center.x,
				RESTROOMS_SPEC.center.z + RESTROOMS_DIVIDER.centerZ,
				RESTROOMS_DIVIDER.thickness,
				RESTROOMS_DIVIDER.depth,
			),
			V0_Y,
			RESTROOMS_WALL_TOP,
		),
		solidPrism(
			'fascia',
			rectangle(
				RESTROOMS_SPEC.center.x,
				RESTROOMS_SPEC.center.z + RESTROOMS_SHELL.fasciaZ,
				RESTROOMS_SPEC.shell.width,
				RESTROOMS_SPEC.fascia.thickness,
			),
			RESTROOMS_WALL_TOP - RESTROOMS_SPEC.fascia.height,
			RESTROOMS_WALL_TOP,
			[],
			'solid',
			false,
		),
		...restroomsInteriorVolumes(),
	],
	map: map('fixture', restroomsStore.name, 62),
	tags: ['restrooms', restroomsStore.category, 'static'],
});

const WUDU_CENTER: Vec2 = {
	x: RESTROOMS_SPEC.center.x + RESTROOMS_INTERIOR.wudu.offsetX,
	z: RESTROOMS_SPEC.center.z + RESTROOMS_INTERIOR.wudu.offsetZ,
};
const WUDU_LABEL = 'WUDU · ABLUTIE';
const WUDU_BASIN_Y = V0_Y + RESTROOMS_INTERIOR.wudu.basin.centerY;

/** De voetwasnis tussen gebedsruimte en toiletten. Hij staat buiten de tegelplaat, dus buiten het toiletblok. */
export const WUDU_ENTITY: MallWorldEntity = roomEntity({
	id: 'wudu-niche',
	label: 'Wudu niche',
	category: 'facility',
	level: 'v0',
	center: WUDU_CENTER,
	placementClass: 'furnishing',
	volumes: [
		planEnvelope(
			solidPrism(
				'bench',
				rectangle(WUDU_CENTER.x, WUDU_CENTER.z, RESTROOMS_INTERIOR.wudu.bench.width, RESTROOMS_INTERIOR.wudu.bench.depth),
				V0_Y,
				V0_Y + RESTROOMS_INTERIOR.wudu.bench.centerY + half(RESTROOMS_INTERIOR.wudu.bench.height),
				[],
				'solid',
				false,
			),
		),
		solidPrism(
			'basin',
			rectangle(WUDU_CENTER.x, WUDU_CENTER.z, RESTROOMS_INTERIOR.wudu.basin.width, RESTROOMS_INTERIOR.wudu.basin.depth),
			WUDU_BASIN_Y - half(RESTROOMS_INTERIOR.wudu.basin.height),
			WUDU_BASIN_Y + half(RESTROOMS_INTERIOR.wudu.basin.height),
			[],
			'solid',
			false,
		),
	],
	map: map('fixture', WUDU_LABEL, 61),
	tags: ['wudu', restroomsStore.category, 'static'],
});

const PRAYER_WALL_THICKNESS = 0.15;

export const PRAYER_ROOM_SPEC = {
	center: { x: prayerStore.x, z: prayerStore.z },
	room: { width: prayerStore.width, depth: prayerStore.depth },
	floorThickness: 0.08,
	wallHeight: 3.2,
	wallThickness: PRAYER_WALL_THICKNESS,
	backWallOffset: 2,
	/** Hartlijn, dus een halve dikte binnen de vloerrand: 2,7 zette het wandvlak 25 mm ernaast. */
	sideWallOffset: half(prayerStore.width) - half(PRAYER_WALL_THICKNESS),
	carpet: { width: 4.2, depth: 2.8, thickness: 0.03, centerY: 0.1, offsetZ: -0.2 },
} as const;

const PRAYER_WALL_TOP = V0_Y + PRAYER_ROOM_SPEC.wallHeight;
const PRAYER_CARPET_Y = V0_Y + PRAYER_ROOM_SPEC.carpet.centerY;

export const PRAYER_ROOM_ENTITY: MallWorldEntity = roomEntity({
	id: 'prayer-room',
	label: 'Prayer room',
	category: 'facility',
	level: 'v0',
	center: PRAYER_ROOM_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		planEnvelope(
			solidPrism(
				'floor',
				rectangle(PRAYER_ROOM_SPEC.center.x, PRAYER_ROOM_SPEC.center.z, PRAYER_ROOM_SPEC.room.width, PRAYER_ROOM_SPEC.room.depth),
				V0_Y,
				V0_Y + PRAYER_ROOM_SPEC.floorThickness,
				[],
				'support',
			),
		),
		solidPrism(
			'wall-north',
			rectangle(
				PRAYER_ROOM_SPEC.center.x,
				PRAYER_ROOM_SPEC.center.z - PRAYER_ROOM_SPEC.backWallOffset,
				PRAYER_ROOM_SPEC.room.width,
				PRAYER_ROOM_SPEC.wallThickness,
			),
			V0_Y,
			PRAYER_WALL_TOP,
		),
		solidPrism(
			'wall-west',
			rectangle(
				PRAYER_ROOM_SPEC.center.x - PRAYER_ROOM_SPEC.sideWallOffset,
				PRAYER_ROOM_SPEC.center.z,
				PRAYER_ROOM_SPEC.wallThickness,
				PRAYER_ROOM_SPEC.room.depth,
			),
			V0_Y,
			PRAYER_WALL_TOP,
		),
		solidPrism(
			'wall-east',
			rectangle(
				PRAYER_ROOM_SPEC.center.x + PRAYER_ROOM_SPEC.sideWallOffset,
				PRAYER_ROOM_SPEC.center.z,
				PRAYER_ROOM_SPEC.wallThickness,
				PRAYER_ROOM_SPEC.room.depth,
			),
			V0_Y,
			PRAYER_WALL_TOP,
		),
		solidPrism(
			'carpet',
			rectangle(
				PRAYER_ROOM_SPEC.center.x,
				PRAYER_ROOM_SPEC.center.z + PRAYER_ROOM_SPEC.carpet.offsetZ,
				PRAYER_ROOM_SPEC.carpet.width,
				PRAYER_ROOM_SPEC.carpet.depth,
			),
			PRAYER_CARPET_Y - half(PRAYER_ROOM_SPEC.carpet.thickness),
			PRAYER_CARPET_Y + half(PRAYER_ROOM_SPEC.carpet.thickness),
			[],
			'decorative-covering',
		),
	],
	map: map('fixture', prayerStore.name, 62),
	tags: ['prayer-room', prayerStore.category, 'static'],
});

export const BEARD_CAVE_SPEC = {
	entrance: { x: beardCaveStore.x, z: beardCaveStore.z },
	/** The hollow sits west of the mouth the path targets. */
	interiorOffsetX: -1,
	floor: { width: 3.4, height: 0.18, depth: 4.2, centerY: 0.05 },
	backWall: { width: 0.55, height: 2.8, depth: 4.4, offsetX: -2.35, centerY: 1.35 },
	ceiling: { width: 3.2, height: 0.4, depth: 4, centerY: 2.7 },
	sideWall: { width: 3, height: 2.6, depth: 0.5, offsetZ: 2.15, centerY: 1.25 },
	pillar: { topRadius: 0.38, bottomRadius: 0.48, height: 2.6, offsetX: 0.55, offsetZ: 1.15, centerY: 1.25 },
	arch: { radius: 1.25, tube: 0.28, centerY: 2.15 },
	/** Treasure pile: the torch light leans on it and App throws heist confetti at it. */
	loot: { offsetX: -1.2, centerY: 0.4 },
} as const;

export const BEARD_CAVE_LOOT_CENTER = {
	x: BEARD_CAVE_SPEC.entrance.x + BEARD_CAVE_SPEC.loot.offsetX,
	y: V0_Y + BEARD_CAVE_SPEC.loot.centerY,
	z: BEARD_CAVE_SPEC.entrance.z,
} as const;

const BEARD_CAVE_INTERIOR_X = BEARD_CAVE_SPEC.entrance.x + BEARD_CAVE_SPEC.interiorOffsetX;

function beardCaveSideWall(id: string, sign: number): SpatialVolume {
	const { sideWall } = BEARD_CAVE_SPEC;
	return solidPrism(
		id,
		rectangle(BEARD_CAVE_INTERIOR_X, BEARD_CAVE_SPEC.entrance.z + sign * sideWall.offsetZ, sideWall.width, sideWall.depth),
		V0_Y + sideWall.centerY - half(sideWall.height),
		V0_Y + sideWall.centerY + half(sideWall.height),
	);
}

/**
 * De grot is met opzet in de westmuur uitgehold, dus elk schilvolume verklaart
 * hoe ver zijn eigen geometrie voorbij de binnenkant van die muur reikt.
 */
function recessedInWestWall(volume: SpatialVolume): SpatialVolume {
	const depth = MALL_INTERIOR.minX - geometryBounds(volume.geometry).minX;
	if (depth <= 0) return volume;
	return { ...volume, penetration: { depth, into: ['structure'] } };
}

function beardCavePillar(id: string, sign: number): SpatialVolume {
	const { pillar } = BEARD_CAVE_SPEC;
	return uprightCylinder(
		id,
		{
			x: BEARD_CAVE_SPEC.entrance.x + pillar.offsetX,
			y: V0_Y + pillar.centerY,
			z: BEARD_CAVE_SPEC.entrance.z + sign * pillar.offsetZ,
		},
		pillar.bottomRadius,
		pillar.height,
		'solid',
		false,
	);
}

export const BEARD_CAVE_ENTITY: MallWorldEntity = roomEntity({
	id: 'beard-cave',
	label: "Beard-man's cave",
	category: 'prop',
	level: 'v0',
	center: BEARD_CAVE_SPEC.entrance,
	placementClass: 'fixture',
	volumes: [
		solidPrism(
			'cave-floor',
			rectangle(BEARD_CAVE_INTERIOR_X, BEARD_CAVE_SPEC.entrance.z, BEARD_CAVE_SPEC.floor.width, BEARD_CAVE_SPEC.floor.depth),
			V0_Y + BEARD_CAVE_SPEC.floor.centerY - half(BEARD_CAVE_SPEC.floor.height),
			V0_Y + BEARD_CAVE_SPEC.floor.centerY + half(BEARD_CAVE_SPEC.floor.height),
			[],
			'support',
		),
		solidPrism(
			'cave-back-wall',
			rectangle(
				BEARD_CAVE_SPEC.entrance.x + BEARD_CAVE_SPEC.backWall.offsetX,
				BEARD_CAVE_SPEC.entrance.z,
				BEARD_CAVE_SPEC.backWall.width,
				BEARD_CAVE_SPEC.backWall.depth,
			),
			V0_Y + BEARD_CAVE_SPEC.backWall.centerY - half(BEARD_CAVE_SPEC.backWall.height),
			V0_Y + BEARD_CAVE_SPEC.backWall.centerY + half(BEARD_CAVE_SPEC.backWall.height),
		),
		beardCaveSideWall('cave-wall-north', -1),
		beardCaveSideWall('cave-wall-south', 1),
		solidPrism(
			'cave-ceiling',
			rectangle(BEARD_CAVE_INTERIOR_X, BEARD_CAVE_SPEC.entrance.z, BEARD_CAVE_SPEC.ceiling.width, BEARD_CAVE_SPEC.ceiling.depth),
			V0_Y + BEARD_CAVE_SPEC.ceiling.centerY - half(BEARD_CAVE_SPEC.ceiling.height),
			V0_Y + BEARD_CAVE_SPEC.ceiling.centerY + half(BEARD_CAVE_SPEC.ceiling.height),
		),
		beardCavePillar('cave-pillar-north', -1),
		beardCavePillar('cave-pillar-south', 1),
	].map(recessedInWestWall),
	map: map('fixture', beardCaveStore.name, 62),
	tags: ['beard-cave', beardCaveStore.category, 'static'],
});

export const ISLAND_HOP_SPEC = {
	center: { x: islandHopStore.x, z: islandHopStore.z },
	slab: { width: islandHopStore.width, depth: islandHopStore.depth, thickness: 0.1 },
	wallHeight: 2.6,
	backWall: { thickness: 0.18, offsetX: -1.9 },
	sideWall: { width: 3.6, thickness: 0.16, offsetX: -0.1, offsetZ: 1.85 },
	fascia: { width: 0.2, height: 0.35, depth: 3.9, offsetX: 1.55, centerY: 2.45 },
	desk: { width: 1.6, height: 0.9, depth: 0.7, offsetX: 0.55, top: { width: 1.7, depth: 0.78, thickness: 0.08 } },
} as const;

export const ISLAND_HOP_ENTITY: MallWorldEntity = roomEntity({
	id: `shop-${islandHopStore.id}`,
	label: islandHopStore.name,
	category: 'shop',
	level: 'v0',
	center: ISLAND_HOP_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		planEnvelope(
			solidPrism(
				'room-shell',
				rectangle(ISLAND_HOP_SPEC.center.x, ISLAND_HOP_SPEC.center.z, ISLAND_HOP_SPEC.slab.width, ISLAND_HOP_SPEC.slab.depth),
				V0_Y,
				V0_Y + ISLAND_HOP_SPEC.wallHeight,
			),
		),
		solidPrism(
			'desk',
			rectangle(
				ISLAND_HOP_SPEC.center.x + ISLAND_HOP_SPEC.desk.offsetX,
				ISLAND_HOP_SPEC.center.z,
				ISLAND_HOP_SPEC.desk.width,
				ISLAND_HOP_SPEC.desk.depth,
			),
			V0_Y,
			V0_Y + ISLAND_HOP_SPEC.desk.height,
		),
		// Deze winkel loopt niet via shopEntity, en dat was de enige plek waar een
		// puiprisma ontstond: als enige van de negentien stond zijn pui open.
		clearancePrism(
			'frontage',
			rectangle(
				ISLAND_HOP_SPEC.center.x + half(ISLAND_HOP_SPEC.slab.width) + half(STOREFRONT_CLEARANCE_DEPTH),
				ISLAND_HOP_SPEC.center.z,
				STOREFRONT_CLEARANCE_DEPTH,
				ISLAND_HOP_SPEC.slab.depth,
			),
			V0_Y,
			V0_Y + STANDING_PEDESTRIAN.requiredHeadroom,
			'storefront-clearance',
		),
	],
	map: map('shop', islandHopStore.name, 60),
	tags: ['shop', islandHopStore.category, 'static'],
});

export const FOUNTAIN_SPEC = {
	center: ATRIUM_OPENING.center,
	/** Kerb radius: what the collider blocks, where the accent ring starts and what the plan draws. */
	kerbRadius: 2.6,
	accentWidth: 0.4,
	blockHeight: 3.5,
	basin: { topRadius: 2.4, bottomRadius: 2.8, height: 0.45, centerY: 0.22 },
} as const;

const FOUNTAIN_LABEL = 'FONTEIN · GOD';

export const FOUNTAIN_ENTITY: MallWorldEntity = roomEntity({
	id: 'atrium-fountain',
	label: FOUNTAIN_LABEL,
	category: 'prop',
	level: 'v0',
	center: FOUNTAIN_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		{
			id: 'kerb',
			role: 'solid',
			geometry: {
				kind: 'cylinder',
				center: { x: FOUNTAIN_SPEC.center.x, y: V0_Y + half(FOUNTAIN_SPEC.blockHeight), z: FOUNTAIN_SPEC.center.z },
				radius: FOUNTAIN_SPEC.kerbRadius,
				height: FOUNTAIN_SPEC.blockHeight,
				axis: 'y',
			},
			blocksMovement: true,
			// A kerb you walk around still leaves the atrium void open above and beside it.
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['authored-geometry'],
		},
	],
	map: map('fixture', FOUNTAIN_LABEL, 75),
	tags: ['fountain', 'atrium', 'static'],
});

const KIOSK_LABEL = 'KIOSK · START';

/** The directory record and the graph node both mark where you stand at the kiosk. */
const KIOSK_STAND_GAP = 1;

export const KIOSK_SPEC = {
	center: { x: kioskStore.x, z: kioskStore.z + KIOSK_STAND_GAP },
	/** The cabinet you bump into; the screen leans out over it. */
	baseRadius: 1,
	height: 3,
} as const;

export const KIOSK_ENTITY: MallWorldEntity = roomEntity({
	id: 'info-kiosk',
	label: KIOSK_LABEL,
	category: 'prop',
	level: 'v0',
	center: KIOSK_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		solidPrism(
			'cabinet',
			rectangle(KIOSK_SPEC.center.x, KIOSK_SPEC.center.z, KIOSK_SPEC.baseRadius * 2, KIOSK_SPEC.baseRadius * 2),
			V0_Y,
			V0_Y + KIOSK_SPEC.height,
		),
	],
	map: map('fixture', KIOSK_LABEL, 78),
	tags: ['kiosk', kioskStore.category, 'static'],
});

export const FOOD_COURT_SPEC = {
	center: { x: foodCourtStore.x, z: foodCourtStore.z },
	plaza: { width: foodCourtStore.width, depth: 5.2, thickness: 0.06 },
	stripe: { width: 14.2, thickness: 0.04, depth: 0.18, offsetZ: 2.5, centerY: 0.06 },
} as const;

export const FOOD_COURT_ENTITY: MallWorldEntity = roomEntity({
	id: 'food-court',
	label: foodCourtStore.name,
	category: 'facility',
	level: 'v1',
	center: FOOD_COURT_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		solidPrism(
			'plaza',
			rectangle(FOOD_COURT_SPEC.center.x, FOOD_COURT_SPEC.center.z, FOOD_COURT_SPEC.plaza.width, FOOD_COURT_SPEC.plaza.depth),
			V1_Y,
			V1_Y + FOOD_COURT_SPEC.plaza.thickness,
			[],
			'decorative-covering',
		),
	],
	map: map('fixture', foodCourtStore.name, 64),
	tags: ['food-court', foodCourtStore.category, 'static'],
});

/** A crowd occupies a patch of floor, so its footprint is the directory record and nothing else. */
export const PROTEST_ENTITY: MallWorldEntity = roomEntity({
	id: 'protest',
	label: protestStore.name,
	category: 'prop',
	level: 'v0',
	center: { x: protestStore.x, z: protestStore.z },
	placementClass: 'furnishing',
	volumes: [
		solidPrism(
			'gathering',
			rectangle(protestStore.x, protestStore.z, protestStore.width, protestStore.depth),
			V0_Y,
			V0_Y + STANDING_PEDESTRIAN.bodyHeight,
			[],
			'trigger',
			false,
		),
	],
	map: map('fixture', protestStore.name, 63),
	tags: ['protest', protestStore.category, 'crowd'],
});

const SPACESHIP_LABEL = 'UFO · WEIDE';

export const SPACESHIP_SPEC = {
	center: ATRIUM_OPENING.center,
	/** Hazard frame around the V1 void edge, lying on the deck. */
	frame: { thickness: 0.35, height: 0.05, edgeOffset: 0.2, overhang: 0.4 },
	saucer: { hullRadius: 4.2, scale: 0.78, height: 1.6, hoverY: 9.6 },
} as const;

const SPACESHIP_SAUCER_RADIUS = SPACESHIP_SPEC.saucer.hullRadius * SPACESHIP_SPEC.saucer.scale;

export const SPACESHIP_FRAME_RAILS = cardinalWallPanels({
	center: SPACESHIP_SPEC.center,
	offset: {
		x: half(ATRIUM_VOID.width) + SPACESHIP_SPEC.frame.edgeOffset,
		z: half(ATRIUM_VOID.depth) + SPACESHIP_SPEC.frame.edgeOffset,
	},
	span: {
		width: ATRIUM_VOID.width + SPACESHIP_SPEC.frame.overhang * 2,
		depth: ATRIUM_VOID.depth + SPACESHIP_SPEC.frame.overhang * 2,
	},
	thickness: SPACESHIP_SPEC.frame.thickness,
});

export const SPACESHIP_FRAME_Y = V1_Y + half(SPACESHIP_SPEC.frame.height);

export const SPACESHIP_ENTITY: MallWorldEntity = roomEntity({
	id: 'spaceship',
	label: SPACESHIP_LABEL,
	category: 'prop',
	level: 'v1',
	center: SPACESHIP_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		...SPACESHIP_FRAME_RAILS.map((rail) =>
			solidPrism(
				`void-frame-${rail.id}`,
				rectanglePlan(rail),
				V1_Y,
				V1_Y + SPACESHIP_SPEC.frame.height,
				[],
				'decorative-covering',
			),
		),
		uprightCylinder(
			'saucer',
			{ x: SPACESHIP_SPEC.center.x, y: SPACESHIP_SPEC.saucer.hoverY, z: SPACESHIP_SPEC.center.z },
			SPACESHIP_SAUCER_RADIUS,
			SPACESHIP_SPEC.saucer.height,
			'solid',
			false,
		),
	],
	map: map('fixture', SPACESHIP_LABEL, 76),
	tags: ['spaceship', 'atrium', 'landmark'],
});

export const PARKING_DECK_SPEC = {
	/** Height of the walls and the pillars alike, above the deck. */
	clearHeight: 4.4,
	ceiling: { thickness: 0.3, height: 4.6 },
	wall: { thickness: 0.35, inset: 0.2 },
	westWallSegments: [
		{ id: 'north', z: -14, depth: 14 },
		{ id: 'south', z: 14, depth: 14 },
	],
	eastWallSegments: [
		{ id: 'north', z: -14, depth: 14 },
		{ id: 'south', z: 10, depth: 20 },
	],
	pillar: { width: 0.7, spacing: 8, columns: 3, rows: 2, elevatorKeepOut: 5 },
	booth: { center: { x: 22, z: -4 }, width: 2.2, height: 2.4, depth: 2 },
} as const;

export type ParkingWallPanel = Readonly<{
	id: string;
	center: Vec2;
	size: Readonly<{ width: number; depth: number }>;
}>;

export const PARKING_WALL_PANELS: readonly ParkingWallPanel[] = [
	{
		id: 'north',
		center: { x: 0, z: -half(PARKING_FOOTPRINT.depth) + PARKING_DECK_SPEC.wall.inset },
		size: { width: PARKING_FOOTPRINT.width, depth: PARKING_DECK_SPEC.wall.thickness },
	},
	{
		id: 'south',
		center: { x: 0, z: half(PARKING_FOOTPRINT.depth) - PARKING_DECK_SPEC.wall.inset },
		size: { width: PARKING_FOOTPRINT.width, depth: PARKING_DECK_SPEC.wall.thickness },
	},
	...PARKING_DECK_SPEC.westWallSegments.map((segment) => ({
		id: `west-${segment.id}`,
		center: { x: -half(PARKING_FOOTPRINT.width) + PARKING_DECK_SPEC.wall.inset, z: segment.z },
		size: { width: PARKING_DECK_SPEC.wall.thickness, depth: segment.depth },
	})),
	...PARKING_DECK_SPEC.eastWallSegments.map((segment) => ({
		id: `east-${segment.id}`,
		center: { x: half(PARKING_FOOTPRINT.width) - PARKING_DECK_SPEC.wall.inset, z: segment.z },
		size: { width: PARKING_DECK_SPEC.wall.thickness, depth: segment.depth },
	})),
];

/** The grid minus the bay the elevator landing needs. */
export function parkingPillarCenters(): readonly Vec2[] {
	const { pillar } = PARKING_DECK_SPEC;
	const centers: Vec2[] = [];
	for (let column = -pillar.columns; column <= pillar.columns; column++) {
		for (let row = -pillar.rows; row <= pillar.rows; row++) {
			const x = column * pillar.spacing;
			const z = row * pillar.spacing;
			const clearsElevator =
				Math.abs(x - ELEVATOR_SPEC.center.x) >= pillar.elevatorKeepOut ||
				Math.abs(z - ELEVATOR_SPEC.center.z) >= pillar.elevatorKeepOut;
			if (clearsElevator) centers.push({ x, z });
		}
	}
	return centers;
}

const PARKING_DECK_Y = levelY('p1');
const PARKING_CEILING_Y = PARKING_DECK_Y + PARKING_DECK_SPEC.ceiling.height;
const PARKING_CLEAR_TOP = PARKING_DECK_Y + PARKING_DECK_SPEC.clearHeight;

/** The mall's underside. Cut for the elevator, which travels straight through it. */
export const PARKING_CEILING_SPEC = {
	plan: PARKING_FOOTPRINT_PLAN,
	holes: [P1_ELEVATOR_PLAN],
	thickness: PARKING_DECK_SPEC.ceiling.thickness,
	topY: PARKING_CEILING_Y + half(PARKING_DECK_SPEC.ceiling.thickness),
} as const;

/** Zandplaat van het dakeiland. De dekmesh, de collider en de plattegrond lezen dezelfde randen. */
export const ROOF_ISLAND_PAD = { minX: -32, maxX: -6, minZ: -20, maxZ: 20 } as const;

/**
 * De zandplaat is een deklaag óp de dakplaat. Als dikke plaat mét zijn bovenkant
 * op levelY('roof') lag hij precies in het dak en flikkerde hij over 26×40 m.
 */
export const ROOF_ISLAND_DECK_THICKNESS = 0.04;
const ROOF_ISLAND_SAND_TOP_Y = levelY('roof') + ROOF_ISLAND_DECK_THICKNESS;

/**
 * Het dakterras beslaat een derde van het dek en stond nergens in het model, dus
 * de plattegrond tekende een naamloos vlak waar de speler niets van kon maken.
 */
const ROOF_TERRACE_PLAN = rectangle(
	midpoint(ROOF_ISLAND_PAD.minX, ROOF_ISLAND_PAD.maxX),
	midpoint(ROOF_ISLAND_PAD.minZ, ROOF_ISLAND_PAD.maxZ),
	span(ROOF_ISLAND_PAD.minX, ROOF_ISLAND_PAD.maxX),
	span(ROOF_ISLAND_PAD.minZ, ROOF_ISLAND_PAD.maxZ),
);

export const ROOF_TERRACE_ENTITY: MallWorldEntity = {
	id: 'roof-terrace',
	label: 'Roof island sun deck',
	category: 'prop',
	levels: ['roof'],
	transform: {
		position: { x: midpoint(ROOF_ISLAND_PAD.minX, ROOF_ISLAND_PAD.maxX), y: levelY('roof'), z: 0 },
		rotation: ZERO_ROTATION,
	},
	volumes: [
		{
			id: 'sand',
			role: 'decorative-covering',
			geometry: {
				kind: 'prism',
				plan: ROOF_TERRACE_PLAN,
				minY: levelY('roof'),
				maxY: ROOF_ISLAND_SAND_TOP_Y,
				holes: [],
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: ['structure', 'fixture', 'furnishing', 'clutter', 'covering', 'connector'],
			tags: ['sand', 'terrace'],
		},
	],
	ports: NO_PORTS,
	placement: {
		class: 'covering',
		requiresSupport: false,
		mayCover: ['walkable', 'support'],
		mayBeCoveredBy: ['clutter', 'fixture'],
	},
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('fixture', 'DAKEILAND · ZWEMBAD', 66),
	tags: ['roof-island', 'terrace', 'pool'],
};

/** Tikibar op het dek: de bar, de palen, de krukken en het rieten dak. */
export const TIKI_BAR_SPEC = {
	center: { x: -12.3, z: 14.5 },
	post: { offset: 1.4, radius: 0.08, height: 3.2, centerY: 1.6 },
	counter: { width: 1, depth: 3.2, height: 1.1, offsetX: -0.6 },
	thatch: { radius: 2.7, height: 1.8, centerY: 4 },
	stool: { topRadius: 0.24, bottomRadius: 0.2, height: 0.68, centerY: 0.34, offsetX: -1.7, z: [13.2, 14.5, 15.8] },
	sign: { width: 2.4, height: 0.8, offsetX: -1.55, centerY: 2.6 },
} as const;

const TIKI_BAR_LABEL = 'TIKI BAR';

function tikiPost(id: string, signX: number, signZ: number): SpatialVolume {
	const { center, post } = TIKI_BAR_SPEC;
	return uprightCylinder(
		id,
		{ x: center.x + signX * post.offset, y: ROOF_Y + post.centerY, z: center.z + signZ * post.offset },
		post.radius,
		post.height,
		'solid',
		false,
	);
}

export const TIKI_BAR_ENTITY: MallWorldEntity = roomEntity({
	id: 'tiki-bar',
	label: 'Roof island tiki bar',
	category: 'prop',
	level: 'roof',
	center: TIKI_BAR_SPEC.center,
	placementClass: 'fixture',
	volumes: [
		planEnvelope(
			uprightCylinder(
				'thatch-roof',
				{ x: TIKI_BAR_SPEC.center.x, y: ROOF_Y + TIKI_BAR_SPEC.thatch.centerY, z: TIKI_BAR_SPEC.center.z },
				TIKI_BAR_SPEC.thatch.radius,
				TIKI_BAR_SPEC.thatch.height,
				'solid',
				false,
			),
		),
		solidPrism(
			'counter',
			rectangle(
				TIKI_BAR_SPEC.center.x + TIKI_BAR_SPEC.counter.offsetX,
				TIKI_BAR_SPEC.center.z,
				TIKI_BAR_SPEC.counter.width,
				TIKI_BAR_SPEC.counter.depth,
			),
			ROOF_Y,
			ROOF_Y + TIKI_BAR_SPEC.counter.height,
			[],
			'solid',
			false,
		),
		tikiPost('post-nw', -1, -1),
		tikiPost('post-ne', 1, -1),
		tikiPost('post-sw', -1, 1),
		tikiPost('post-se', 1, 1),
		...TIKI_BAR_SPEC.stool.z.map((z, index) =>
			uprightCylinder(
				`stool-${index + 1}`,
				{ x: TIKI_BAR_SPEC.center.x + TIKI_BAR_SPEC.stool.offsetX, y: ROOF_Y + TIKI_BAR_SPEC.stool.centerY, z },
				TIKI_BAR_SPEC.stool.topRadius,
				TIKI_BAR_SPEC.stool.height,
				'solid',
				false,
			),
		),
	],
	map: map('fixture', TIKI_BAR_LABEL, 65),
	tags: ['tiki-bar', 'roof-island', 'static'],
});

/** De reling langs de dakrand, met de entree aan de oostkant. */
export const ROOF_RAILING_SPEC = {
	height: 1.05,
	barThickness: 0.07,
	postRadius: 0.035,
	postSpacing: 2,
	/** Tussen deze twee z-waarden staat aan de oostrand geen reling: daar loop je het dek op. */
	entranceHalfDepth: 2.5,
} as const;

export const ROOF_PALM_SPEC = { trunk: { topRadius: 0.09, bottomRadius: 0.17, height: 3.4 } } as const;

export const ROOF_PALM_SPOTS = [
	{ x: -30.2, z: -17.5, scale: 1.1 },
	{ x: -8.5, z: -17, scale: 0.95 },
	{ x: -30, z: 16.5, scale: 1.05 },
	{ x: -8.6, z: 17.5, scale: 1 },
	{ x: -30.5, z: -6, scale: 0.9 },
	{ x: -9, z: 7, scale: 1.15 },
	{ x: -15, z: -15, scale: 1 },
	{ x: -25.5, z: 13, scale: 0.85 },
] as const;

export const ROOF_LOUNGER_SPEC = {
	seat: { width: 0.7, depth: 1.8, thickness: 0.16, centerY: 0.18 },
	back: { width: 0.7, depth: 0.8, thickness: 0.06, centerY: 0.42, offset: 0.75, tilt: -0.65 },
	row: { x: -10.6, firstZ: -13.2, spacing: 2.4, count: 6, yaw: -Math.PI / 2 },
} as const;

export type RoofLounger = Readonly<{ x: number; z: number; yaw: number }>;

/** Zes op een rij langs de oostrand, twee los bij het bad. Handdoeken en volumes lezen dezelfde plekken. */
export const ROOF_LOUNGER_SPOTS: readonly RoofLounger[] = [
	...Array.from({ length: ROOF_LOUNGER_SPEC.row.count }, (_, index) => ({
		x: ROOF_LOUNGER_SPEC.row.x,
		z: ROOF_LOUNGER_SPEC.row.firstZ + index * ROOF_LOUNGER_SPEC.row.spacing,
		yaw: ROOF_LOUNGER_SPEC.row.yaw,
	})),
	{ x: -18, z: -5.5, yaw: 0.15 },
	{ x: -15.5, z: -5, yaw: -0.1 },
];

const ROOF_FURNITURE_LABEL = 'LIGSTOELEN · PALMEN';

function roofRailingBar(id: string, centerX: number, centerZ: number, width: number, depth: number): SpatialVolume {
	return solidPrism(
		id,
		rectangle(centerX, centerZ, width, depth),
		ROOF_Y,
		ROOF_Y + ROOF_RAILING_SPEC.height + half(ROOF_RAILING_SPEC.barThickness),
		[],
		'solid',
		false,
	);
}

function roofRailingVolumes(): readonly SpatialVolume[] {
	const { minX, maxX, minZ, maxZ } = ROOF_ISLAND_PAD;
	const { barThickness, entranceHalfDepth } = ROOF_RAILING_SPEC;
	const deckWidth = span(minX, maxX);
	return [
		roofRailingBar('railing-west', minX, midpoint(minZ, maxZ), barThickness, span(minZ, maxZ)),
		roofRailingBar('railing-north', midpoint(minX, maxX), minZ, deckWidth, barThickness),
		roofRailingBar('railing-south', midpoint(minX, maxX), maxZ, deckWidth, barThickness),
		roofRailingBar('railing-east-north', maxX, midpoint(minZ, -entranceHalfDepth), barThickness, span(minZ, -entranceHalfDepth)),
		roofRailingBar('railing-east-south', maxX, midpoint(entranceHalfDepth, maxZ), barThickness, span(entranceHalfDepth, maxZ)),
	];
}

export const ROOF_FURNITURE_ENTITY: MallWorldEntity = roomEntity({
	id: 'roof-furniture',
	label: 'Roof island furniture',
	category: 'prop',
	level: 'roof',
	center: {
		x: midpoint(ROOF_ISLAND_PAD.minX, ROOF_ISLAND_PAD.maxX),
		z: midpoint(ROOF_ISLAND_PAD.minZ, ROOF_ISLAND_PAD.maxZ),
	},
	placementClass: 'furnishing',
	volumes: [
		...roofRailingVolumes(),
		...ROOF_LOUNGER_SPOTS.map((spot, index) =>
			solidPrism(
				`lounger-${index + 1}`,
				rectangle(spot.x, spot.z, ROOF_LOUNGER_SPEC.seat.width, ROOF_LOUNGER_SPEC.seat.depth, spot.yaw),
				ROOF_Y,
				ROOF_Y + ROOF_LOUNGER_SPEC.back.centerY + half(ROOF_LOUNGER_SPEC.back.depth),
				[],
				'solid',
				false,
			),
		),
		...ROOF_PALM_SPOTS.map((spot, index) =>
			uprightCylinder(
				`palm-${index + 1}`,
				{ x: spot.x, y: ROOF_Y + half(ROOF_PALM_SPEC.trunk.height * spot.scale), z: spot.z },
				ROOF_PALM_SPEC.trunk.bottomRadius * spot.scale,
				ROOF_PALM_SPEC.trunk.height * spot.scale,
				'solid',
				false,
			),
		),
	],
	map: map('clutter', ROOF_FURNITURE_LABEL, 58),
	tags: ['roof-island', 'furniture', 'railing'],
});

/** Glijbaantoren: de plaat waar je bovenop staat. Mesh, collider, kaart en klim lezen deze. */
export const SLIDE_PLATFORM = {
	center: { x: -28.5, z: -10 },
	size: 1.9,
	thickness: 0.15,
	standHeight: 4,
} as const;

/** Loopvlak van die plaat: bovenkant van de doos, niet het hart. */
export const SLIDE_PLATFORM_TOP_Y = ROOF_Y + SLIDE_PLATFORM.standHeight + half(SLIDE_PLATFORM.thickness);

/**
 * De toren en de buis. De ladder is ruimer dan zijn sporten (arcade-klimmen) en
 * alles is gemeten vanaf de plaat waar hij op uitkomt: los ingetikt liep hij ernaast.
 */
export const SLIDE_TOWER_SPEC = {
	leg: { radius: 0.09, offset: 0.8 },
	ladder: { halfWidth: 0.7, topInset: 0.05, run: 1.3, openBefore: 0.6, openAfter: 0.5, rungs: 8, rungThickness: 0.05 },
	tube: {
		radius: 0.5,
		path: [
			{ x: -27.7, y: ROOF_Y + 3.8, z: -10 },
			{ x: -26.2, y: ROOF_Y + 3.1, z: -8.6 },
			{ x: -24.4, y: ROOF_Y + 2.4, z: -7.8 },
			{ x: -22.8, y: ROOF_Y + 1.7, z: -6 },
			{ x: -22.6, y: ROOF_Y + 1, z: -3.6 },
			{ x: -22.3, y: ROOF_Y + 0.2, z: 0.9 },
		],
	},
} as const;

const SLIDE_LADDER_TOP_Z = SLIDE_PLATFORM.center.z - half(SLIDE_PLATFORM.size) + SLIDE_TOWER_SPEC.ladder.topInset;

/** Klimkoker van de ladder, zoals CollisionWorld hem als helling opneemt. */
export const SLIDE_LADDER_CLIMB = {
	minX: SLIDE_PLATFORM.center.x - SLIDE_TOWER_SPEC.ladder.halfWidth,
	maxX: SLIDE_PLATFORM.center.x + SLIDE_TOWER_SPEC.ladder.halfWidth,
	zTop: SLIDE_LADDER_TOP_Z,
	zBottom: SLIDE_LADDER_TOP_Z - SLIDE_TOWER_SPEC.ladder.run,
	openMinZ: SLIDE_LADDER_TOP_Z - SLIDE_TOWER_SPEC.ladder.openBefore,
	openMaxZ: SLIDE_LADDER_TOP_Z + SLIDE_TOWER_SPEC.ladder.openAfter,
} as const;

const ROOF_SLIDE_LABEL = 'GLIJBAAN';
const SLIDE_LADDER_X = midpoint(SLIDE_LADDER_CLIMB.minX, SLIDE_LADDER_CLIMB.maxX);

function slideLeg(id: string, signX: number, signZ: number): SpatialVolume {
	const { leg } = SLIDE_TOWER_SPEC;
	return uprightCylinder(
		id,
		{
			x: SLIDE_PLATFORM.center.x + signX * leg.offset,
			y: ROOF_Y + half(SLIDE_PLATFORM.standHeight),
			z: SLIDE_PLATFORM.center.z + signZ * leg.offset,
		},
		leg.radius,
		SLIDE_PLATFORM.standHeight,
		'solid',
		false,
	);
}

/** De buis als vluchten tussen de punten van de curve: één doos eromheen zou het halve dek beslaan. */
function slideTubeVolumes(): readonly SpatialVolume[] {
	const { tube } = SLIDE_TOWER_SPEC;
	const volumes: SpatialVolume[] = [];
	for (let index = 1; index < tube.path.length; index++) {
		const start = tube.path[index - 1];
		const end = tube.path[index];
		if (!start || !end) continue;
		volumes.push({
			id: `tube-${index}`,
			role: 'solid',
			geometry: { kind: 'ramp', start, end, width: tube.radius * 2, thickness: tube.radius },
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['slide', 'authored-geometry'],
		});
	}
	return volumes;
}

export const ROOF_SLIDE_ENTITY: MallWorldEntity = roomEntity({
	id: 'roof-slide',
	label: 'Roof island water slide',
	category: 'prop',
	level: 'roof',
	center: SLIDE_PLATFORM.center,
	placementClass: 'fixture',
	volumes: [
		slideLeg('leg-nw', -1, -1),
		slideLeg('leg-ne', 1, -1),
		slideLeg('leg-sw', -1, 1),
		slideLeg('leg-se', 1, 1),
		solidPrism(
			'platform',
			rectangle(SLIDE_PLATFORM.center.x, SLIDE_PLATFORM.center.z, SLIDE_PLATFORM.size, SLIDE_PLATFORM.size),
			SLIDE_PLATFORM_TOP_Y - SLIDE_PLATFORM.thickness,
			SLIDE_PLATFORM_TOP_Y,
			[],
			'walkable',
			false,
		),
		{
			id: 'ladder',
			role: 'walkable',
			geometry: {
				kind: 'stair-flight',
				start: { x: SLIDE_LADDER_X, y: ROOF_Y, z: SLIDE_LADDER_CLIMB.zBottom },
				end: { x: SLIDE_LADDER_X, y: SLIDE_PLATFORM_TOP_Y, z: SLIDE_LADDER_CLIMB.zTop },
				width: span(SLIDE_LADDER_CLIMB.minX, SLIDE_LADDER_CLIMB.maxX),
				treadCount: SLIDE_TOWER_SPEC.ladder.rungs,
				treadThickness: SLIDE_TOWER_SPEC.ladder.rungThickness,
				underside: 'open',
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['ladder', 'travel-surface'],
		},
		...slideTubeVolumes(),
	],
	map: map('fixture', ROOF_SLIDE_LABEL, 67),
	tags: ['roof-island', 'slide', 'static'],
});

export const PARKING_DECK_ENTITY: MallWorldEntity = roomEntity({
	id: 'parking-deck',
	label: 'Parking deck shell',
	category: 'parking',
	level: 'p1',
	center: { x: 0, z: 0 },
	placementClass: 'structure',
	volumes: [
		planEnvelope(
			solidPrism(
				'ceiling',
				PARKING_CEILING_SPEC.plan,
				PARKING_CEILING_SPEC.topY - PARKING_CEILING_SPEC.thickness,
				PARKING_CEILING_SPEC.topY,
				PARKING_CEILING_SPEC.holes,
			),
		),
		...PARKING_WALL_PANELS.map((panel) =>
			solidPrism(
				`wall-${panel.id}`,
				rectangle(panel.center.x, panel.center.z, panel.size.width, panel.size.depth),
				PARKING_DECK_Y,
				PARKING_CLEAR_TOP,
			),
		),
		...parkingPillarCenters().map((center, index) =>
			solidPrism(
				`pillar-${index}`,
				rectangle(center.x, center.z, PARKING_DECK_SPEC.pillar.width, PARKING_DECK_SPEC.pillar.width),
				PARKING_DECK_Y,
				PARKING_CLEAR_TOP,
			),
		),
		solidPrism(
			'ticket-booth',
			rectangle(
				PARKING_DECK_SPEC.booth.center.x,
				PARKING_DECK_SPEC.booth.center.z,
				PARKING_DECK_SPEC.booth.width,
				PARKING_DECK_SPEC.booth.depth,
			),
			PARKING_DECK_Y,
			PARKING_DECK_Y + PARKING_DECK_SPEC.booth.height,
		),
	],
	map: map('parking', parkingStore.name, 45),
	tags: ['parking', 'shell', 'structural'],
});

/** De vakken naast het middenpad: de belijning, de nummers en de plattegrond lezen dezelfde rasterstap. */
export const PARKING_BAY_SPEC = {
	rowZ: [-14, 14],
	columns: 5,
	spacing: 5.2,
	stall: { width: 2.4, depth: 4.8 },
	paintY: 0.14,
	number: { width: 0.8, height: 0.35, offsetZ: 1.8 },
	aisle: { arrows: 4, spacing: 6, width: 1.2, depth: 0.4 },
} as const;

export type ParkingStall = Readonly<{ id: string; center: Vec2 }>;

/** Rij A ten noorden van het middenpad, rij B ten zuiden; het nummer telt vanaf de westkant. */
export function parkingStalls(): readonly ParkingStall[] {
	const { rowZ, columns, spacing } = PARKING_BAY_SPEC;
	const stalls: ParkingStall[] = [];
	for (const z of rowZ) {
		for (let column = -columns; column <= columns; column++) {
			stalls.push({ id: `${z < 0 ? 'A' : 'B'}${column + columns + 1}`, center: { x: column * spacing, z } });
		}
	}
	return stalls;
}

/** Decoratieve auto's. De huurauto's van de speler staan hieronder en houden hun eigen plekken vrij. */
export const PARKED_CAR_SPEC = {
	body: { width: 1.9, length: 4, height: 0.45, centerY: 0.45 },
	cabin: { width: 1.7, length: 2, height: 0.4, centerY: 0.85, offsetZ: -0.15 },
	wheel: { radius: 0.28, width: 0.22, offsetX: 0.85, offsetZ: 1.2 },
	standY: 0.12,
} as const;

/** De huurauto's die de speler kan wegrijden, gebouwd door DriveableCars. */
export const RENTAL_CAR_SPEC = {
	body: { width: 1.9, length: 4.2, height: 0.5, centerY: 0.5 },
} as const;

export type ParkedCarSpot = Readonly<{ x: number; z: number; yaw: number }>;

/**
 * De vakkenrij loopt in stappen van 5,2 m en de kolommenrij in stappen van 8 m,
 * dus het vak op x 0 en dat op x ±15,6 staan óm een kolom heen. Een auto daarin
 * stond 0,35 m in het beton en geen enkele regel zag het: beide volumes hebben
 * `blocksMovement: false`. De huurauto's staan in dezelfde vakken en liepen tegen
 * dezelfde kolommen aan, dus staan hun plekken hier en niet in de scene-bouwer;
 * `controleParkeerplekken` in check-world houdt beide lijsten vrij.
 */
export const PARKED_CAR_SPOTS: readonly ParkedCarSpot[] = [
	{ x: -5.2, z: -14, yaw: 0.3 },
	{ x: -20.8, z: -14, yaw: 0 },
	{ x: 10.4, z: -14, yaw: 0.15 },
	{ x: 20.8, z: -14, yaw: 0 },
	{ x: 10.4, z: 14, yaw: Math.PI },
	{ x: 5.2, z: 14, yaw: Math.PI },
	{ x: -20.8, z: 14, yaw: Math.PI - 0.05 },
];

export type RentalCarSpot = ParkedCarSpot & Readonly<{ color: number; name: string }>;

export const RENTAL_CAR_SPOTS: readonly RentalCarSpot[] = [
	{ x: -26, z: -14, yaw: 0, color: 0xc62828, name: 'RODE HATCH' },
	{ x: -10.4, z: -14, yaw: 0.05, color: 0x1565c0, name: 'BLAUWE SEDAN' },
	{ x: 5.2, z: -14, yaw: -0.08, color: 0xffc107, name: 'TAXI #88' },
	{ x: 20.8, z: 14, yaw: Math.PI, color: 0x2e7d32, name: 'GROENE SUV' },
	{ x: -5.2, z: 14, yaw: Math.PI + 0.1, color: 0x6a1b9a, name: 'PAARSE COUPE' },
];

const PARKED_CAR_TOP_Y =
	PARKING_DECK_Y + PARKED_CAR_SPEC.standY + PARKED_CAR_SPEC.cabin.centerY + half(PARKED_CAR_SPEC.cabin.height);

export const PARKING_BAYS_ENTITY: MallWorldEntity = roomEntity({
	id: 'parking-bays',
	label: 'Parking bays',
	category: 'parking',
	level: 'p1',
	center: { x: 0, z: 0 },
	placementClass: 'clutter',
	volumes: parkingStalls().map((stall) =>
		solidPrism(
			`stall-${stall.id}`,
			rectangle(stall.center.x, stall.center.z, PARKING_BAY_SPEC.stall.width, PARKING_BAY_SPEC.stall.depth),
			PARKING_DECK_Y,
			PARKING_DECK_Y + PARKING_BAY_SPEC.paintY,
			[],
			'decorative-covering',
			false,
		),
	),
	map: map('clutter', 'PARKEERVAKKEN', 42),
	tags: ['parking', 'bays', 'static'],
});

export const PARKED_CARS_ENTITY: MallWorldEntity = roomEntity({
	id: 'parking-cars',
	label: 'Parked cars',
	category: 'parking',
	level: 'p1',
	center: { x: 0, z: 0 },
	placementClass: 'clutter',
	volumes: PARKED_CAR_SPOTS.map((spot, index) =>
		solidPrism(
			`car-${index + 1}`,
			rectangle(spot.x, spot.z, PARKED_CAR_SPEC.body.width, PARKED_CAR_SPEC.body.length, spot.yaw),
			PARKING_DECK_Y,
			PARKED_CAR_TOP_Y,
			[],
			'solid',
			false,
		),
	),
	map: map('clutter', "GEPARKEERDE AUTO'S", 44),
	tags: ['parking', 'cars', 'static'],
});

export type WorldCollider = Readonly<{
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
	label: string;
}>;

/**
 * The deck shell's blocking volumes that stand on the floor, as AABBs. Read off the
 * entity so the walls, pillars and booth the plan draws are the ones you bump into.
 */
export function parkingDeckColliders(): readonly WorldCollider[] {
	return PARKING_DECK_ENTITY.volumes.flatMap((volume) => {
		if (!volume.blocksMovement) return [];
		const bounds = geometryBounds(volume.geometry);
		if (bounds.minY > PARKING_DECK_Y) return [];
		return [{ ...bounds, label: `parking_${volume.id}` }];
	});
}

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
	ISLAND_HOP_ENTITY,
	CATWALK_ENTITY,
	RESTROOMS_ENTITY,
	WUDU_ENTITY,
	PRAYER_ROOM_ENTITY,
	BEARD_CAVE_ENTITY,
	FOUNTAIN_ENTITY,
	KIOSK_ENTITY,
	FOOD_COURT_ENTITY,
	PROTEST_ENTITY,
	SPACESHIP_ENTITY,
	PARKING_DECK_ENTITY,
	PARKING_BAYS_ENTITY,
	PARKED_CARS_ENTITY,
	ROOF_TERRACE_ENTITY,
	TIKI_BAR_ENTITY,
	ROOF_FURNITURE_ENTITY,
	ROOF_SLIDE_ENTITY,
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
