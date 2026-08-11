import type { PedestrianPosture } from '#/data/character';
import { postureHeadroom, STANDING_PEDESTRIAN } from '#/data/character';
import type { EscalatorSpec, OpeningDef, StairSpec, VerticalConnector } from '#/data/connectors';
import { ATRIUM_BARRIER, ATRIUM_VOID, MALL_FOOTPRINT, PARKING_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, levelY } from '#/data/levels';
import type {
	Bounds2,
	Bounds3,
	CardinalSide,
	ClearanceMechanism,
	InteractionEmitter,
	InteractionReceiver,
	Penetration,
	PlacementClass,
	PlanShape,
	Protrusion,
	SpatialRole,
	SpatialVolume,
	Standoff,
	TrafficClass,
	Vec2,
	Vec3,
	WorldEntity,
} from '#/data/spatial';
import {
	CARDINAL_OUTWARD,
	GLASS_TAG,
	geometryBounds,
	NOT_A_PORTAL_TAG,
	PLAN_ENVELOPE_TAG,
	PROTRUSION_MARGIN,
	planBounds,
	ROOM_SHELL_TAG,
	rectanglePlan,
	SIGNAGE_TAG,
} from '#/data/spatial';
import type { StoreDef } from '#/data/stores';
import { requireStore, shopStores } from '#/data/stores';
import type { BoxStructureSpec, CardinalBoxStructureSpec } from '#/data/structure';
import { cardinalWallPanels, rectangleCornerPoints, rectangularPerimeterWalls } from '#/data/structure';
import { unreachable } from '#/util/invariant';
import { half, inverseLerpClamped, lerp, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';

export type WorldCategory = 'floor' | 'ceiling' | 'wall' | 'opening' | 'shop' | 'vertical-circulation' | 'parking';

export const ESCALATOR_SPEED = 0.5;
export const SHOP_HEIGHT = 4.2;
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
/**
 * Hoe ver verf boven het vlak ligt waar hij op geschilderd staat.
 *
 * De belijning op P1 lag op 14 cm, een hand boven het beton, en van ooghoogte zag je
 * de streep dus naast zijn eigen vak liggen. Dit is genoeg om niet met de plaat te
 * vechten en niet meer dan dat; de pijlen op de uitrit meten hetzelfde langs de
 * normaal van hun helling.
 */
export const PAINT_LIFT = 0.012;

export const PARKING_EXIT_RAMP = {
	id: 'parking-exit-ramp',
	start: { x: -30, y: levelY('p1'), z: 0 },
	end: { x: -46, y: levelY('v0') + 0.05, z: 0 },
	width: 5.5,
	thickness: 0.28,
	guardHeight: 0.55,
	/** Gap between the deck edge and the guard rail, and the rail's own thickness. */
	railOffset: 0.15,
	railThickness: 0.12,
} as const;

/** Headroom the ramp keeps over its whole run; the lintel above it starts there. */
export const PARKING_EXIT_HEADROOM = 2.4;

/** Kerb the ramp keeps either side of its deck where it passes through the west wall. */
const PARKING_EXIT_WALL_KERB = 0.5;

/**
 * Half the gap the exit ramp needs in the west wall. Collision cuts its wall boxes
 * on this, and the entrance portal starts exactly where it ends, so the two share
 * one jamb instead of two numbers that have to be kept equal by hand.
 */
export const PARKING_EXIT_WALL_GAP = half(PARKING_EXIT_RAMP.width) + PARKING_EXIT_WALL_KERB;

/** Outer face of the guard rail: where the trench's retaining wall stands against it. */
export const PARKING_EXIT_RAIL_OUTER =
	half(PARKING_EXIT_RAMP.width) + PARKING_EXIT_RAMP.railOffset + half(PARKING_EXIT_RAMP.railThickness);

/**
 * De leuning langs de uitrit, per zijde één gedraaide doos, plus de kop die hem bij
 * de mond afdekt.
 *
 * De helling duikt onder maaiveld weg en de leuning duikt mee, dus over het grootste
 * deel van de geul zie je hem niet. Bij de mond komt hij boven het plein uit en hield
 * hij daar op: twee messen van twaalf centimeter dik met een afgeknipt kopvlak in de
 * open lucht. De kop staat op het straateind van de helling, dekt de doorsnede van de
 * leuning én het einde van de keermuur ernaast af, en komt zelf niet voorbij de mond.
 *
 * De maten staan hier en niet in de bouwer omdat `controleParkeeruitrit` de horizontale
 * loop van de gedraaide doos natrekt: een doos onder een hoek beslaat zijn eigen lengte
 * maal de cosinus plus een halve hoogte maal de sinus, en dat is geen maat die je uit
 * een mesh terugleest.
 */
const PARKING_EXIT_RAIL_HEAD_LENGTH = 0.5;
/** Hoeveel de kop boven de leuning uitkomt die hij afdekt. */
const PARKING_EXIT_RAIL_HEAD_MARGIN = 0.07;

const PARKING_EXIT_RUN = span(PARKING_EXIT_RAMP.end.x, PARKING_EXIT_RAMP.start.x);
const PARKING_EXIT_RISE = span(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y);
/** Draaiing van dek, leuning en verf om z. Negatief: naar het westen loopt de helling omhoog. */
export const PARKING_EXIT_RAMP_ANGLE = -Math.atan2(PARKING_EXIT_RISE, PARKING_EXIT_RUN);
/** Lengte van het loopvlak zelf, dus langs de helling en niet in het platte vlak. */
export const PARKING_EXIT_RAMP_LENGTH = Math.hypot(PARKING_EXIT_RUN, PARKING_EXIT_RISE);

/**
 * Het punt `above` meter boven het midden van het loopvlak, gemeten langs de normaal
 * van de helling. Alles wat op de helling ligt hangt hieraan: de leuning en de verf
 * schuiven met dezelfde sinus mee in x, en zonder die term liggen ze naast de helling.
 */
function parkingExitRampCenter(above: number): Vec3 {
	return {
		x: midpoint(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x) - Math.sin(PARKING_EXIT_RAMP_ANGLE) * above,
		y: midpoint(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) + Math.cos(PARKING_EXIT_RAMP_ANGLE) * above,
		z: PARKING_EXIT_RAMP.start.z,
	};
}

export type ParkingExitRail = Readonly<{
	/** Lengte langs de helling. */
	length: number;
	centerX: number;
	centerY: number;
	angle: number;
	height: number;
	thickness: number;
	/** Afstand van de hartlijn van de uitrit tot het hart van een leuning. */
	offsetZ: number;
}>;

function parkingExitRail(): ParkingExitRail {
	const midden = parkingExitRampCenter(half(PARKING_EXIT_RAMP.guardHeight));
	return {
		length: PARKING_EXIT_RAMP_LENGTH,
		centerX: midden.x,
		centerY: midden.y,
		angle: PARKING_EXIT_RAMP_ANGLE,
		height: PARKING_EXIT_RAMP.guardHeight,
		thickness: PARKING_EXIT_RAMP.railThickness,
		offsetZ: PARKING_EXIT_RAIL_OUTER,
	};
}

export const PARKING_EXIT_RAIL: ParkingExitRail = parkingExitRail();

/**
 * De twee koppen bij de mond. Ze lopen van de leuning tot de buitenkant van de
 * keermuur ernaast, staan met hun voet op de helling en komen niet voorbij de mond.
 */
export const PARKING_EXIT_RAIL_HEADS: readonly Bounds3[] = ([-1, 1] as const).map((sign) => {
	const minX = PARKING_EXIT_RAMP.end.x;
	const maxX = minX + PARKING_EXIT_RAIL_HEAD_LENGTH;
	const inner = PARKING_EXIT_RAIL_OUTER - PARKING_EXIT_RAMP.railThickness;
	return {
		minX,
		maxX,
		minY: parkingExitRampY(maxX),
		maxY: PARKING_EXIT_RAMP.end.y + PARKING_EXIT_RAMP.guardHeight + PARKING_EXIT_RAIL_HEAD_MARGIN,
		minZ: Math.min(sign * inner, sign * PARKING_EXIT_WALL_GAP),
		maxZ: Math.max(sign * inner, sign * PARKING_EXIT_WALL_GAP),
	};
});

/** The ramp's travel surface at `x`, clamped to its own ends. */
export function parkingExitRampY(x: number): number {
	const t = inverseLerpClamped(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x, x);
	return lerp(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y, t);
}

/**
 * Het pijlvak op de uitrit.
 *
 * Er lagen vier losse latten twintig centimeter boven een helling die onder ze
 * wegzakte: ze stonden horizontaal terwijl de helling kantelde, ze stonden dwars op
 * de rijrichting, en tegen de mond aan zweefden ze een halve meter boven het beton.
 * Dit is één vlak in het hellingvlak zelf. Zijn hoek is die van de helling en zijn
 * hart hangt aan `parkingExitRampCenter`, dus het kan er niet meer van losraken.
 */
const PARKING_EXIT_CHEVRON_SPEC = {
	/** Vrije rand langs de kop en de voet van de helling, gemeten langs het loopvlak. */
	margin: 1.2,
	/** Vrije rand langs beide leuningen. */
	sideMargin: 0.65,
	/** Hoeveel de verf langs de normaal boven het loopvlak ligt. */
	lift: PAINT_LIFT,
	/** Hoeveel pijlen er in de baan liggen; de textuur herhaalt er één per tegel. */
	count: 5,
} as const;

export type ParkingExitChevrons = Readonly<{
	/** Hart van het vak, langs de normaal boven het loopvlak. */
	center: Vec3;
	/** Draaiing om z, gelijk aan die van de helling. */
	angle: number;
	/** Maat langs de helling en maat dwars erop. */
	length: number;
	width: number;
	count: number;
	lift: number;
}>;

export const PARKING_EXIT_CHEVRONS: ParkingExitChevrons = {
	center: parkingExitRampCenter(PARKING_EXIT_CHEVRON_SPEC.lift),
	angle: PARKING_EXIT_RAMP_ANGLE,
	length: PARKING_EXIT_RAMP_LENGTH - PARKING_EXIT_CHEVRON_SPEC.margin * 2,
	width: PARKING_EXIT_RAMP.width - PARKING_EXIT_CHEVRON_SPEC.sideMargin * 2,
	count: PARKING_EXIT_CHEVRON_SPEC.count,
	lift: PARKING_EXIT_CHEVRON_SPEC.lift,
};

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

/**
 * De dikte van elke dekplaat, hierboven omdat een vloergat eruit gerekend wordt.
 *
 * De plaatspecificaties verderop lezen dezelfde waarden, dus de onderkant waar een
 * roltraphoofd langs moet en het beton dat er ligt kunnen niet uit elkaar lopen.
 */
const SLAB_THICKNESS: Readonly<Record<LevelId, number>> = { p1: 0.25, v0: 0.3, v1: 0.45, roof: 0.45 };

/** Waar een dekplaat aan de onderkant ophoudt. */
function slabUndersideY(level: LevelId): number {
	return levelY(level) - SLAB_THICKNESS[level];
}

type FlightOpeningInput = Readonly<{
	from: LevelId;
	to: LevelId;
	zBottom: number;
	zTop: number;
	apron: number;
}>;

/**
 * De z-strook waarover de bovenste plaat open moet zijn voor één vlucht.
 *
 * Van het bovenste eindpunt tot voorbij de plek waar de vrije hoogte van een
 * staande passagier de onderkant van die plaat raakt, plus de apron van de vlucht.
 * Het loopvlak loopt recht tussen de twee eindpunten, dus die plek volgt uit een
 * deling en niet uit een hoek. Met de hand ingevuld bleef het gat van de oostelijke
 * roltrap 0.8 m te kort en ging het hoofd van de reiziger door de rand van V1.
 *
 * Een vlucht die op het dak uitkomt krijgt zijn koker over de hele lengte. Boven
 * `FLOOR_H + 2` antwoordt een dakplaat in `groundHeightAt` onvoorwaardelijk, dus
 * over het stuk dat de vrije hoogte niet opeist loop je van y 8 af over het trapgat
 * heen omhoog. Bij de geheime trap vraagt de vrije hoogte 1.83 m gat waar de vlucht
 * er 4 lang is, en `hellinglijn` keurt precies dat verschil af.
 */
function connectorOpeningZ(flight: FlightOpeningInput): Readonly<{ min: number; max: number; center: number; depth: number }> {
	const bottomY = levelY(flight.from);
	const run = flight.zTop - flight.zBottom;
	const rise = levelY(flight.to) - bottomY;
	const headClears = slabUndersideY(flight.to) - STANDING_PEDESTRIAN.requiredHeadroom;
	const grazes = flight.zBottom + ((headClears - bottomY) * run) / rise;
	const downhill = Math.sign(flight.zBottom - flight.zTop);
	const beyond = grazes + downhill * flight.apron;
	const edges = flight.to === 'roof' ? [flight.zTop, beyond, flight.zBottom] : [flight.zTop, beyond];
	const min = Math.min(...edges);
	const max = Math.max(...edges);
	return { min, max, center: midpoint(min, max), depth: span(min, max) };
}

const EAST_ESCALATOR_FLIGHT = { from: 'v0', to: 'v1', zBottom: 8, zTop: -2, apron: 1 } as const;
const EAST_ESCALATOR_OPENING = connectorOpeningZ(EAST_ESCALATOR_FLIGHT);
const WEST_STAIRS_FLIGHT = { from: 'v0', to: 'v1', zBottom: 4, zTop: -14, apron: 1 } as const;
const WEST_STAIRS_OPENING = connectorOpeningZ(WEST_STAIRS_FLIGHT);
const SECRET_STAIRS_FLIGHT = { from: 'v1', to: 'roof', zBottom: 14, zTop: 18, apron: 0.5 } as const;
const SECRET_STAIRS_OPENING = connectorOpeningZ(SECRET_STAIRS_FLIGHT);

export const VERTICAL_CONNECTORS = [
	{
		id: 'east-escalator',
		label: 'East escalator',
		kind: 'escalator',
		...EAST_ESCALATOR_FLIGHT,
		x: 22,
		width: 2.2,
		steps: 20,
		...ESCALATOR_MODEL,
		opening: {
			id: 'escalator-v1',
			category: 'escalator',
			center: { x: 22, z: EAST_ESCALATOR_OPENING.center },
			size: { width: 2.6, depth: EAST_ESCALATOR_OPENING.depth },
			connects: ['v0', 'v1'],
		},
		collision: {
			minX: 20.7,
			maxX: 23.3,
			minZ: -3.5,
			maxZ: 9,
			openMinZ: EAST_ESCALATOR_OPENING.min,
			openMaxZ: EAST_ESCALATOR_OPENING.max,
			carrySpeed: ESCALATOR_SPEED,
		},
	},
	{
		id: 'west-stairs',
		label: 'West stairs',
		kind: 'stairs',
		presentation: 'mall-flight',
		...WEST_STAIRS_FLIGHT,
		x: -22,
		width: 2.4,
		steps: 24,
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
			center: { x: -22, z: WEST_STAIRS_OPENING.center },
			size: { width: 4, depth: WEST_STAIRS_OPENING.depth },
			connects: ['v0', 'v1'],
		},
		collision: {
			minX: -23.5,
			maxX: -20.5,
			minZ: -15.5,
			maxZ: 5,
			openMinZ: WEST_STAIRS_OPENING.min,
			openMaxZ: WEST_STAIRS_OPENING.max,
		},
	},
	{
		id: 'secret-stairs',
		label: 'Secret stairs to roof',
		kind: 'stairs',
		presentation: 'helipad-flight',
		...SECRET_STAIRS_FLIGHT,
		x: 26,
		width: 2.6,
		steps: 16,
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
			center: { x: 26, z: SECRET_STAIRS_OPENING.center },
			size: { width: 3, depth: SECRET_STAIRS_OPENING.depth },
			connects: ['v1', 'roof'],
		},
		collision: {
			minX: 24.7,
			maxX: 27.3,
			minZ: 14,
			maxZ: 18.5,
			openMinZ: SECRET_STAIRS_OPENING.min,
			openMaxZ: SECRET_STAIRS_OPENING.max,
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
	| 'prop'
	| 'theatre';

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

/** A sign hung on the building: it has to hang clear of its neighbours and of what carries it. */
function signage(volume: SpatialVolume): SpatialVolume {
	return { ...volume, tags: [...volume.tags, SIGNAGE_TAG] };
}

/** A shop's room shell: it carries the plan the rest of the shop stays inside, and its back has to meet a wall. */
function roomShell(volume: SpatialVolume, standoff?: Standoff): SpatialVolume {
	const envelope = planEnvelope(volume);
	const shell = { ...envelope, tags: [...envelope.tags, ROOM_SHELL_TAG] };
	return standoff === undefined ? shell : { ...shell, standoff };
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
	extraTags: readonly string[] = [],
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
		tags: ['opening', 'must-remain-clear', ...extraTags],
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
export const HELIPAD_HATCH_FRAME_SPEC = { thickness: 0.12, height: 0.15 } as const;

/** Ruimte tussen de rand van het landingsplateau en het kozijn van het trapluik. */
const HELIPAD_PAD_HATCH_GAP = 0.5;
const HELIPAD_PAD_BOTTOM_RADIUS = 5.8;

/**
 * Het plateau staat naast het trapgat, niet erover.
 *
 * Op x 22 lag de schijf over het luik heen: het blad ging open, de vloerplaat
 * ging eraf, en je keek nog steeds op massief plateau. Zijn oostrand komt nu uit
 * het kozijn van het luik, dus de enige trap naar het dak blijft vrij.
 */
export const HELIPAD_PAD_SPEC = {
	center: {
		x: SECRET_STAIRS_OPENING_BOUNDS.minX - HELIPAD_HATCH_FRAME_SPEC.thickness - HELIPAD_PAD_HATCH_GAP - HELIPAD_PAD_BOTTOM_RADIUS,
		z: 16,
	},
	topRadius: 5.5,
	bottomRadius: HELIPAD_PAD_BOTTOM_RADIUS,
	mapRadius: 5.3,
	height: 0.12,
} as const;

function connectorOpeningPlansAt(levelId: LevelId): readonly PlanShape[] {
	return VERTICAL_CONNECTORS.filter((connector) => connector.to === levelId).map((connector) => rectanglePlan(connector.opening));
}

const FLOOR_V1_HOLES = [V1_ATRIUM_PLAN, ...connectorOpeningPlansAt('v1'), V1_ELEVATOR_PLAN];
const ROOF_SLAB_HOLES = [V1_ATRIUM_PLAN, ...connectorOpeningPlansAt('roof'), ROOF_ELEVATOR_PLAN];

export type StructuralSlabSpec = Readonly<{
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
		thickness: SLAB_THICKNESS.v0,
		plan: MALL_FOOTPRINT_PLAN,
		holes: [V0_ELEVATOR_PLAN],
	},
	v1: {
		id: 'mall-floor-v1',
		label: 'First-floor slab',
		category: 'floor',
		level: 'v1',
		topY: levelY('v1'),
		thickness: SLAB_THICKNESS.v1,
		plan: MALL_FOOTPRINT_PLAN,
		holes: FLOOR_V1_HOLES,
	},
	roof: {
		id: 'mall-roof-slab',
		label: 'Mall roof base',
		category: 'ceiling',
		level: 'roof',
		topY: levelY('roof'),
		thickness: SLAB_THICKNESS.roof,
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
	thickness: SLAB_THICKNESS.p1,
	plan: PARKING_FOOTPRINT_PLAN,
	holes: [P1_ELEVATOR_PLAN],
} as const satisfies StructuralSlabSpec;

/**
 * Het dek waar elk niveau op ligt, met de gaten die erin gesneden zijn.
 *
 * De zonegraaf leest hier of twee dekken elkaar op een plek werkelijk zien: door
 * het atriumgat wel, door de vloer eronder niet. Dezelfde vier platen die de
 * entiteiten hierboven bouwen, dus een gat kan er niet aan één kant bij komen.
 */
export const SLAB_SPEC_BY_LEVEL: Readonly<Record<LevelId, StructuralSlabSpec>> = {
	...MALL_SLAB_SPECS,
	p1: PARKING_SLAB_SPEC,
};

/**
 * Waar de plaat op dit niveau open is binnen `rect`, of null als hij daar dicht is.
 *
 * Het gat en niet het punt, want een roltrap loopt schuin: het midden van zijn
 * vrije ruimte zit onder de plaat en zijn bovenste meters komen door het gat dat
 * er precies voor gesneden is. Wie het middelpunt vraagt krijgt "dicht" te horen
 * over een trap waar je bovenaan doorheen loopt.
 */
export function slabOpeningWithin(level: LevelId, rect: Bounds2): Bounds2 | null {
	const slab = SLAB_SPEC_BY_LEVEL[level];
	const plan = planBounds(slab.plan);
	if (rect.maxX <= plan.minX || rect.minX >= plan.maxX || rect.maxZ <= plan.minZ || rect.minZ >= plan.maxZ) return rect;
	let opening: Bounds2 | null = null;
	for (const hole of slab.holes) {
		const bounds = planBounds(hole);
		const minX = Math.max(rect.minX, bounds.minX);
		const maxX = Math.min(rect.maxX, bounds.maxX);
		const minZ = Math.max(rect.minZ, bounds.minZ);
		const maxZ = Math.min(rect.maxZ, bounds.maxZ);
		if (maxX <= minX || maxZ <= minZ) continue;
		opening =
			opening === null
				? { minX, maxX, minZ, maxZ }
				: {
						minX: Math.min(opening.minX, minX),
						maxX: Math.max(opening.maxX, maxX),
						minZ: Math.min(opening.minZ, minZ),
						maxZ: Math.max(opening.maxZ, maxZ),
					};
	}
	return opening;
}

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

/** The unbroken shell. Everything below reads its faces off these four boxes. */
const PERIMETER_WALLS = rectangularPerimeterWalls({
	footprint: MALL_FOOTPRINT,
	vertical: { min: MALL_WALL_MIN_Y, max: MALL_WALL_MAX_Y },
	thickness: MALL_WALL_THICKNESS,
	capOverlap: 0.5,
});

function perimeterWall(side: CardinalSide): CardinalBoxStructureSpec {
	const wall = PERIMETER_WALLS.find((candidate) => candidate.id === side);
	if (!wall) throw new Error(`no ${side} perimeter wall`);
	return wall;
}

const WEST_WALL = perimeterWall('west');

/**
 * The grand street entrance, cut through the west facade.
 *
 * West is the only elevation with room for one. Every other side is store backs
 * with two to four metres between them, while here the twelve metres between
 * Douglas (to z −4) and the restroom block (from z 8.8) are free. Its north jamb
 * is `PARKING_EXIT_WALL_GAP`, so the portal starts exactly where the gap the exit
 * ramp needs in the same wall ends and the two never have to be lined up by hand.
 *
 * The walk-through opening stops under the V1 soffit and the glass carries on to
 * `glassTopY`, five metres higher: the deck above stays whole and the portal still
 * reads two storeys tall from the street.
 */
export const ENTRANCE_SPEC = {
	/** North jamb: where the wall gap for the parking exit ends. */
	minZ: PARKING_EXIT_WALL_GAP,
	/** Clear width of the bay cut through the facade. */
	width: 5.2,
	/** Fixed glass either side of the sliding pair. */
	sidelightWidth: 1,
	/** Head of the walk-through opening. Under the V1 soffit, so the deck above stays whole. */
	doorHeadY: 4.9,
	/** Top of the glazed screen above the doors. */
	glassTopY: 9.2,
	glassThickness: 0.24,
	/** One leaf covers half the doorway and parks behind its sidelight. */
	doorLeafHeight: 2.7,
	doorThickness: 0.1,
	doorSeconds: 1.1,
	/** Step into this apron and the pair opens. Metres out from the facade, and in from it. */
	trigger: { outreach: 2.6, inreach: 1.8, height: 2.4 },
	/** Polished stone hall behind the doors. */
	hall: { depth: 7.8, thickness: 0.02 },
	/** Canopy over the forecourt, hung at the V1 datum and carried on two columns. */
	canopy: {
		projection: 4.4,
		flank: 0.9,
		thickness: 0.4,
		topY: levelY('v1'),
		/**
		 * The bronze fascia around the slab. Every figure here keeps two faces off one
		 * plane: the slab sits `inset` inside the front piece and `inset` inside the
		 * flanks, the flanks start `lap` behind the front piece's back face and stop
		 * `step` short of its outer face, and they run `bite` into the facade. As a
		 * band of the slab's own size the front and the flanks shared four faces with
		 * it and two with each other, and the canopy edge flickered from the forecourt.
		 */
		trim: { reach: 0.22, inset: 0.05, lap: 0.06, step: 0.012, bite: 0.02, proud: 0.03, flankProud: 0.015 },
		/** Bronze ribs across the soffit. Their pitch also sets out the bays between them. */
		rib: { count: 7, width: 0.12, height: 0.08, drop: 0.04 },
		/**
		 * One recessed spot per bay, hung under the ribs rather than level with them.
		 * Spots on a pitch of their own drifted into the ribs and rendered as slivers
		 * z-fighting with bronze, so the bays place them and the rib underside sets
		 * their height.
		 */
		spot: { radius: 0.16, drop: 0.02, shift: 0.15 },
	},
	column: { radius: 0.2, inset: 0.6, offsetZ: 2.1 },
	/**
	 * Red carpet from the threshold to the ring-road zebra, on the portal's own axis.
	 * `startInset` is how far inside the facade it starts, so it does not break off on
	 * the threshold; where it ends is the kerb, and `ENTRANCE_CARPET` in the city plan
	 * reads it off the crossing rather than carrying a length of its own.
	 */
	carpet: { width: 4, thickness: 0.02, startInset: 0.4 },
	/**
	 * MALL SIM · PRAIRIE LAKES across the facade, above the glazed screen.
	 *
	 * At the old 6.9 m it sat behind its own canopy: the sightline from the street
	 * over the canopy's front lip crosses the facade at 7.5 m, so nine tenths of the
	 * lettering was hidden by the roof meant to frame it. `standoff` holds the letters
	 * clear of the facade seam that runs up the entrance bay behind them.
	 */
	lettering: { width: 12, height: 1.5, centerY: 11.4, standoff: 0.14 },
	/**
	 * The two flag masts. They stand in front of the canopy, because the soffit is
	 * 5.6 m up and a mast is 7.4 m, and they flank the carpet rather than the canopy:
	 * north of the forecourt the parking exit trench is open to a ramp six metres
	 * down, and a mast planted at the canopy's north flank stood on nothing at all.
	 */
	flag: { height: 7.4, radius: 0.06, baseFlare: 1.4, forward: 0.7, offset: 0.35, cloth: { width: 1.6, height: 1, drop: 1.1 } },
	/**
	 * Paving that puts a floor under the forecourt: the lot outside is drawn half a
	 * metre lower than the level collision walks you on. It runs from the facade to
	 * the kerb and covers the whole carpet, which crosses it on the portal axis.
	 */
	forecourt: { drop: 0.5, north: 3, south: 11.4, west: -49.4 },
} as const;

const ENTRANCE_MAX_Z = ENTRANCE_SPEC.minZ + ENTRANCE_SPEC.width;
const ENTRANCE_CENTER_Z = midpoint(ENTRANCE_SPEC.minZ, ENTRANCE_MAX_Z);
const ENTRANCE_OUTER_X = WEST_WALL.position.x - half(WEST_WALL.size.width);
const ENTRANCE_INNER_X = WEST_WALL.position.x + half(WEST_WALL.size.width);

/** The portal in world coordinates: wall split, collision, scene and checks all read these. */
export const ENTRANCE_PORTAL = {
	minZ: ENTRANCE_SPEC.minZ,
	maxZ: ENTRANCE_MAX_Z,
	centerZ: ENTRANCE_CENTER_Z,
	/** The moving doorway between the two fixed sidelights. */
	doorMinZ: ENTRANCE_SPEC.minZ + ENTRANCE_SPEC.sidelightWidth,
	doorMaxZ: ENTRANCE_MAX_Z - ENTRANCE_SPEC.sidelightWidth,
	/** Outside face of the facade, inside face, and the plane the glass sits in. */
	outerX: ENTRANCE_OUTER_X,
	innerX: ENTRANCE_INNER_X,
	glassX: WEST_WALL.position.x,
	/** How far a leaf travels to park behind its sidelight. */
	doorTravel: half(span(ENTRANCE_SPEC.minZ, ENTRANCE_MAX_Z) - ENTRANCE_SPEC.sidelightWidth * 2),
	/** Outer edge of the canopy, and where the columns under it stand. */
	canopyX: ENTRANCE_OUTER_X - ENTRANCE_SPEC.canopy.projection,
	columnX: ENTRANCE_OUTER_X - ENTRANCE_SPEC.canopy.projection + ENTRANCE_SPEC.column.inset,
	/** The masts: clear of the canopy in x, and clear of the carpet either side of it in z. */
	flagX: ENTRANCE_OUTER_X - ENTRANCE_SPEC.canopy.projection - ENTRANCE_SPEC.flag.forward,
	flagOffsetZ: half(ENTRANCE_SPEC.carpet.width) + ENTRANCE_SPEC.flag.offset,
	/**
	 * De aanwezigheidszone waar de deuren op afgaan. Het volume in de entiteit en de
	 * test in de scene-bouwer lezen deze doos allebei: twee keer dezelfde zone
	 * uitschrijven is precies hoe een deur opengaat op een andere plek dan het model
	 * zegt dat hij dat doet.
	 */
	trigger: {
		minX: ENTRANCE_OUTER_X - ENTRANCE_SPEC.trigger.outreach,
		maxX: ENTRANCE_INNER_X + ENTRANCE_SPEC.trigger.inreach,
		minZ: ENTRANCE_SPEC.minZ + ENTRANCE_SPEC.sidelightWidth - ENTRANCE_SPEC.trigger.inreach,
		maxZ: ENTRANCE_MAX_Z - ENTRANCE_SPEC.sidelightWidth + ENTRANCE_SPEC.trigger.inreach,
		maxY: ENTRANCE_SPEC.trigger.height,
	},
} as const;

/** One box of the canopy: the slab itself, or a piece of the bronze fascia around it. */
export type EntranceCanopyPart = Bounds3 & Readonly<{ id: string; finish: 'slab' | 'fascia' }>;

const CANOPY_DEPTH = ENTRANCE_SPEC.width + ENTRANCE_SPEC.canopy.flank * 2;
const CANOPY_MIN_Z = ENTRANCE_CENTER_Z - half(CANOPY_DEPTH);
const CANOPY_MAX_Z = ENTRANCE_CENTER_Z + half(CANOPY_DEPTH);
const CANOPY_BOTTOM_Y = ENTRANCE_SPEC.canopy.topY - ENTRANCE_SPEC.canopy.thickness;

/**
 * The canopy as four boxes: the slab, the fascia across its front, and one down each
 * flank. Every face of every piece is either buried inside another piece or alone on
 * its plane, which is what `controleIngang` reads them for.
 */
export const ENTRANCE_CANOPY_PARTS: readonly EntranceCanopyPart[] = ((): readonly EntranceCanopyPart[] => {
	const { topY, trim } = ENTRANCE_SPEC.canopy;
	const front = ENTRANCE_PORTAL.canopyX;
	const flank = (sign: -1 | 1, id: string): EntranceCanopyPart => ({
		id,
		minX: front + trim.reach - trim.lap,
		maxX: ENTRANCE_PORTAL.outerX + trim.bite,
		minY: CANOPY_BOTTOM_Y - trim.flankProud,
		maxY: topY + trim.flankProud,
		minZ: sign < 0 ? CANOPY_MIN_Z + trim.step : CANOPY_MAX_Z - trim.reach,
		maxZ: sign < 0 ? CANOPY_MIN_Z + trim.reach : CANOPY_MAX_Z - trim.step,
		finish: 'fascia',
	});
	return [
		{
			id: 'canopy-slab',
			minX: front + trim.inset,
			maxX: ENTRANCE_PORTAL.outerX,
			minY: CANOPY_BOTTOM_Y,
			maxY: topY,
			minZ: CANOPY_MIN_Z + trim.inset,
			maxZ: CANOPY_MAX_Z - trim.inset,
			finish: 'slab',
		},
		{
			id: 'canopy-fascia-front',
			minX: front,
			maxX: front + trim.reach,
			minY: CANOPY_BOTTOM_Y - trim.proud,
			maxY: topY + trim.proud,
			minZ: CANOPY_MIN_Z,
			maxZ: CANOPY_MAX_Z,
			finish: 'fascia',
		},
		flank(-1, 'canopy-fascia-north'),
		flank(1, 'canopy-fascia-south'),
	];
})();

/** De steek van de ribben onder de luifel, die ook de vakken ertussen uitzet. */
export const ENTRANCE_CANOPY_RIB_PITCH = CANOPY_DEPTH / ENTRANCE_SPEC.canopy.rib.count;

/** De ribben onder de luifel, symmetrisch om de portaalas. */
export const ENTRANCE_CANOPY_RIB_ZS: readonly number[] = Array.from(
	{ length: ENTRANCE_SPEC.canopy.rib.count },
	(_, index) => ENTRANCE_CENTER_Z + (index - half(ENTRANCE_SPEC.canopy.rib.count - 1)) * ENTRANCE_CANOPY_RIB_PITCH,
);

/** De vakken tússen de ribben: daar hangt alles wat onder de luifel licht geeft. */
export const ENTRANCE_CANOPY_BAY_ZS: readonly number[] = ENTRANCE_CANOPY_RIB_ZS.flatMap((z, index, alle) => {
	const volgende = alle[index + 1];
	return volgende === undefined ? [] : [midpoint(z, volgende)];
});

/**
 * Waar de wash-lamp onder de luifel hangt.
 *
 * Op de portaalas staat bij een oneven aantal ribben een rib, en die stond 0,66 m
 * onder de lamp tegen 1,20 m voor zijn buren: kop-op las de luifel als een witte
 * balk. Hij hangt nu in het vak naast die as, net als de spots.
 */
export const ENTRANCE_CANOPY_WASH_Z = ENTRANCE_CANOPY_BAY_ZS.reduce((dichtste, z) =>
	Math.abs(z - ENTRANCE_CENTER_Z) < Math.abs(dichtste - ENTRANCE_CENTER_Z) ? z : dichtste,
);

/**
 * How far a canopy column stands in front of the west wall face, which is what it
 * declares. `controleGevel` measures against the outer envelope of all four wall
 * boxes, and the north and south caps overhang this face, so the figure a column
 * declares is never smaller than the one measured against it.
 */
const ENTRANCE_COLUMN_REACH = ENTRANCE_OUTER_X - (ENTRANCE_PORTAL.columnX - ENTRANCE_SPEC.column.radius);

/**
 * Hoever de luifel zelf voor de westgevel hangt. Hij houdt geen lichaam tegen en
 * viel daarom buiten de oude gevelcontrole, terwijl vier meter dak boven de stoep
 * de grootste uitkraging van het hele gebouw is.
 */
const ENTRANCE_CANOPY_REACH = ENTRANCE_SPEC.canopy.projection;

/**
 * De westgevel is opengesneden voor de hoofdingang: twee wandstukken ernaast en
 * een latei erboven, uit dezelfde perimeter als de andere drie. De mesh in
 * MallBuilder en de wandentiteiten hieronder lezen deze lijst allebei.
 */
function westWallSegments(wall: CardinalBoxStructureSpec): readonly MallWallSpec[] {
	const wallMinZ = wall.position.z - half(wall.size.depth);
	const wallMaxZ = wall.position.z + half(wall.size.depth);
	const headMinY = ENTRANCE_SPEC.glassTopY;
	const headMaxY = wall.position.y + half(wall.size.height);
	const flank = (id: string, minZ: number, maxZ: number): MallWallSpec => ({
		id,
		side: wall.id,
		position: { x: wall.position.x, y: wall.position.y, z: midpoint(minZ, maxZ) },
		size: { width: wall.size.width, height: wall.size.height, depth: span(minZ, maxZ) },
	});
	return [
		flank('west-north', wallMinZ, ENTRANCE_PORTAL.minZ),
		flank('west-south', ENTRANCE_PORTAL.maxZ, wallMaxZ),
		{
			id: 'west-head',
			side: wall.id,
			position: { x: wall.position.x, y: midpoint(headMinY, headMaxY), z: ENTRANCE_PORTAL.centerZ },
			size: { width: wall.size.width, height: span(headMinY, headMaxY), depth: ENTRANCE_SPEC.width },
		},
	];
}

/** A perimeter wall box that still knows which elevation it closes, after any splitting. */
export type MallWallSpec = BoxStructureSpec & Readonly<{ side: CardinalSide }>;

export const MALL_WALL_SPECS: readonly MallWallSpec[] = PERIMETER_WALLS.flatMap((wall) =>
	wall.id === 'west' ? westWallSegments(wall) : [{ ...wall, side: wall.id }],
);

/**
 * Eén stuk gevelvlak, plat gelegd: `u` loopt langs de gevel en `y` omhoog.
 *
 * Langs de gevel is z op west en oost en x op noord en zuid, en dat onderscheid
 * hoort één keer gemaakt te worden in plaats van bij elke vergelijking opnieuw.
 */
export type FacadePanel = Readonly<{ minU: number; maxU: number; minY: number; maxY: number }>;

function alongFacade(side: CardinalSide): boolean {
	return side === 'west' || side === 'east';
}

function facadePanelOfWall(wall: MallWallSpec): FacadePanel {
	const alongZ = alongFacade(wall.side);
	const center = alongZ ? wall.position.z : wall.position.x;
	const extent = alongZ ? wall.size.depth : wall.size.width;
	return {
		minU: center - half(extent),
		maxU: center + half(extent),
		minY: wall.position.y - half(wall.size.height),
		maxY: wall.position.y + half(wall.size.height),
	};
}

const FACADE_PANELS: Readonly<Record<CardinalSide, readonly FacadePanel[]>> = {
	west: MALL_WALL_SPECS.filter((wall) => wall.side === 'west').map(facadePanelOfWall),
	east: MALL_WALL_SPECS.filter((wall) => wall.side === 'east').map(facadePanelOfWall),
	north: MALL_WALL_SPECS.filter((wall) => wall.side === 'north').map(facadePanelOfWall),
	south: MALL_WALL_SPECS.filter((wall) => wall.side === 'south').map(facadePanelOfWall),
};

/** De snijlijnen binnen een band: de rand ervan plus elke paneelrand die erin valt. */
function cutsWithin(low: number, high: number, edges: readonly number[]): readonly number[] {
	const inside = edges.filter((edge) => edge > low && edge < high);
	return [...new Set([low, ...inside, high])].sort((a, b) => a - b);
}

function unionPanel(a: FacadePanel | null, b: FacadePanel): FacadePanel {
	if (a === null) return b;
	return {
		minU: Math.min(a.minU, b.minU),
		maxU: Math.max(a.maxU, b.maxU),
		minY: Math.min(a.minY, b.minY),
		maxY: Math.max(a.maxY, b.maxY),
	};
}

/**
 * Waar een schil van panelen open is binnen `face`, of null als hij daar dicht is.
 *
 * De verticale tegenhanger van `slabOpeningWithin`. De zonegraaf leidde een
 * doorkijk af uit élk volume dat de voetafdruklijn kruist, en de vrije ruimte van
 * de parkeeruitrit is één grove doos die dwars door de westgevel steekt: dat
 * meldde een raam van dertien vierkante meter in een muur die daar dicht is.
 *
 * De gevel is de schil van wandstukken, dus de opening voor een portaal is precies
 * het gat dat die lijst er zelf al in laat vallen. Onder de voet van de schil zit
 * geen paneel meer, en daar is de uitritgeul dan ook echt open. Het theater voert
 * zijn eigen schil aan; twee gebouwen, één som.
 */
export function panelOpeningWithin(panels: readonly FacadePanel[], face: FacadePanel): FacadePanel | null {
	const us = cutsWithin(
		face.minU,
		face.maxU,
		panels.flatMap((panel) => [panel.minU, panel.maxU]),
	);
	const ys = cutsWithin(
		face.minY,
		face.maxY,
		panels.flatMap((panel) => [panel.minY, panel.maxY]),
	);
	let opening: FacadePanel | null = null;
	for (let i = 0; i + 1 < us.length; i++) {
		const minU = at(us, i);
		const maxU = at(us, i + 1);
		const u = midpoint(minU, maxU);
		for (let j = 0; j + 1 < ys.length; j++) {
			const minY = at(ys, j);
			const maxY = at(ys, j + 1);
			const y = midpoint(minY, maxY);
			if (panels.some((panel) => u > panel.minU && u < panel.maxU && y > panel.minY && y < panel.maxY)) continue;
			opening = unionPanel(opening, { minU, maxU, minY, maxY });
		}
	}
	return opening;
}

/** Waar de mallgevel op deze zijde open is: de schil van `MALL_WALL_SPECS`, en verder niets. */
export function facadeOpeningWithin(side: CardinalSide, face: FacadePanel): FacadePanel | null {
	return panelOpeningWithin(FACADE_PANELS[side], face);
}

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
	for (const wall of PERIMETER_WALLS) {
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
			...solidPrism(
				'wall',
				rectangle(position.x, position.z, size.width, size.depth),
				position.y - half(size.height),
				position.y + half(size.height),
			),
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
 * De buitenste omhullende van de vier wandkasten.
 *
 * Niet hetzelfde als de voetafdruk plus een wanddikte: de noord- en zuidkap lopen
 * `capOverlap` voorbij het west- en oostvlak, dus in x ligt de omhullende 0,3 m
 * verder naar buiten dan die twee gevels zelf. `controleGevel` meet hiertegen, en
 * het gevelwerk hieronder schrijft er zijn vergunningen uit tegen.
 */
function mallWallEnvelope(): Bounds2 {
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const wall of PERIMETER_WALLS) {
		minX = Math.min(minX, wall.position.x - half(wall.size.width));
		maxX = Math.max(maxX, wall.position.x + half(wall.size.width));
		minZ = Math.min(minZ, wall.position.z - half(wall.size.depth));
		maxZ = Math.max(maxZ, wall.position.z + half(wall.size.depth));
	}
	return { minX, maxX, minZ, maxZ };
}

export const MALL_WALL_ENVELOPE: Bounds2 = mallWallEnvelope();

/** De naar buiten wijzende normaal per gevel. Mesh, entiteit en controle lezen deze vier. */

/**
 * Het gevelwerk: een plint, twee gordingen, een kroonlijst en de verticale naden
 * ertussen.
 *
 * Vier kale dozen lazen van buiten als ongetextureerde platen. Dit geeft ze een
 * maatverdeling zonder er ook maar één lamp bij te zetten: het is geschaalde
 * geometrie op één InstancedMesh.
 *
 * Elke band wordt geklemd op het wandstuk waar hij op ligt, en de westgevel is
 * al opengesneden voor de hoofdingang, dus het reliëf loopt vanzelf naast het
 * portaal langs in plaats van eroverheen. De latei boven het glas houdt daardoor
 * alleen wat er op zijn eigen hoogte hoort.
 */
export const FACADE_RELIEF_SPEC = {
	/** Het diepste dat een gevelstuk voor zijn eigen wandvlak uit mag komen. */
	reachBudget: 0.45,
	/** Onderste band, van de wandvoet tot ruim boven het maaiveld. */
	plinth: { topY: 0.9, reach: 0.16 },
	/** Horizontale gordingen: één op de V1-dekregel, één halverwege de bovenbouw. */
	courses: [
		{ id: 'course-v1', minY: 5.5, maxY: 5.9, reach: 0.2 },
		{ id: 'course-high', minY: 9.6, maxY: 10, reach: 0.2 },
	],
	/**
	 * Kroonlijst. Hij eindigt onder de wandtop en niet erop: twee bovenkanten op
	 * dezelfde hoogte die elkaar in plan raken zijn coplanair, en dat is precies wat
	 * `validateSpatialWorld` afkeurt.
	 */
	cornice: { minY: 12.8, maxY: 13.4, reach: 0.45 },
	/** Verticale naden tussen plint en kroonlijst, op een heel aantal per wandstuk. */
	seam: { spacing: 4, width: 0.34, reach: 0.1 },
} as const;

/** Minder dan dit hoog is geen band meer maar een streep; die slaat de generator over. */
const FACADE_BAND_MIN_HEIGHT = 0.05;

export type FacadeReliefKind = 'plinth' | 'course' | 'cornice' | 'seam' | 'sign';

/** Eén stuk gevelwerk als wereldbox. De mesh, het volume en de controle lezen dezelfde zes randen. */
export type FacadeReliefPiece = Readonly<{
	id: string;
	side: CardinalSide;
	kind: FacadeReliefKind;
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
	/** Hoever dit stuk voor zijn eigen wandvlak uitkomt. */
	reach: number;
}>;

/**
 * Een gevelvlak zoals het reliëf het nodig heeft: waar het buitenvlak ligt, welke
 * kant naar buiten is, over welke as het wandstuk loopt en hoe hoog het reikt.
 */
type FacadeFace = Readonly<{
	side: CardinalSide;
	face: number;
	outward: number;
	alongMin: number;
	alongMax: number;
	minY: number;
	maxY: number;
	/** Waar: het wandstuk loopt langs x en het reliëf komt in z naar buiten. */
	alongX: boolean;
}>;

function facadeFace(side: CardinalSide, box: BoxStructureSpec): FacadeFace {
	const outward = CARDINAL_OUTWARD[side];
	const minY = box.position.y - half(box.size.height);
	const maxY = box.position.y + half(box.size.height);
	if (outward.x !== 0) {
		return {
			side,
			face: box.position.x + outward.x * half(box.size.width),
			outward: outward.x,
			alongMin: box.position.z - half(box.size.depth),
			alongMax: box.position.z + half(box.size.depth),
			minY,
			maxY,
			alongX: false,
		};
	}
	return {
		side,
		face: box.position.z + outward.z * half(box.size.depth),
		outward: outward.z,
		alongMin: box.position.x - half(box.size.width),
		alongMax: box.position.x + half(box.size.width),
		minY,
		maxY,
		alongX: true,
	};
}

function reliefPiece(
	face: FacadeFace,
	id: string,
	kind: FacadeReliefKind,
	alongMin: number,
	alongMax: number,
	minY: number,
	maxY: number,
	reach: number,
): FacadeReliefPiece {
	const outer = face.face + face.outward * reach;
	const near = Math.min(face.face, outer);
	const far = Math.max(face.face, outer);
	return face.alongX
		? { id, side: face.side, kind, minX: alongMin, maxX: alongMax, minY, maxY, minZ: near, maxZ: far, reach }
		: { id, side: face.side, kind, minX: near, maxX: far, minY, maxY, minZ: alongMin, maxZ: alongMax, reach };
}

type FacadeBand = Readonly<{ id: string; kind: FacadeReliefKind; minY: number; maxY: number; reach: number }>;

function facadeBands(): readonly FacadeBand[] {
	return [
		{
			id: 'plinth',
			kind: 'plinth',
			minY: MALL_WALL_MIN_Y,
			maxY: FACADE_RELIEF_SPEC.plinth.topY,
			reach: FACADE_RELIEF_SPEC.plinth.reach,
		},
		...FACADE_RELIEF_SPEC.courses.map(
			(course): FacadeBand => ({ id: course.id, kind: 'course', minY: course.minY, maxY: course.maxY, reach: course.reach }),
		),
		{
			id: 'cornice',
			kind: 'cornice',
			minY: FACADE_RELIEF_SPEC.cornice.minY,
			maxY: FACADE_RELIEF_SPEC.cornice.maxY,
			reach: FACADE_RELIEF_SPEC.cornice.reach,
		},
	];
}

/**
 * Het reliëf van alle wandstukken samen. Een band die niet binnen de hoogte van
 * zijn wandstuk past wordt erop geklemd en verdwijnt als er niets overblijft, dus
 * de latei boven de hoofdingang draagt de kroonlijst en verder niets.
 */
function facadeReliefPieces(): readonly FacadeReliefPiece[] {
	const pieces: FacadeReliefPiece[] = [];
	const { seam } = FACADE_RELIEF_SPEC;
	for (const wall of MALL_WALL_SPECS) {
		const face = facadeFace(wall.side, wall);
		for (const band of facadeBands()) {
			const minY = Math.max(band.minY, face.minY);
			const maxY = Math.min(band.maxY, face.maxY);
			if (span(minY, maxY) <= FACADE_BAND_MIN_HEIGHT) continue;
			pieces.push(reliefPiece(face, `${wall.id}-${band.id}`, band.kind, face.alongMin, face.alongMax, minY, maxY, band.reach));
		}
		const seamMinY = Math.max(FACADE_RELIEF_SPEC.plinth.topY, face.minY);
		const seamMaxY = Math.min(FACADE_RELIEF_SPEC.cornice.minY, face.maxY);
		if (span(seamMinY, seamMaxY) <= FACADE_BAND_MIN_HEIGHT) continue;
		const run = span(face.alongMin, face.alongMax);
		const count = Math.max(1, Math.round(run / seam.spacing));
		for (let index = 0; index < count; index++) {
			const center = face.alongMin + (run * (index + 0.5)) / count;
			pieces.push(
				reliefPiece(
					face,
					`${wall.id}-seam-${index}`,
					'seam',
					center - half(seam.width),
					center + half(seam.width),
					seamMinY,
					seamMaxY,
					seam.reach,
				),
			);
		}
	}
	return pieces;
}

/**
 * De twee daklijstborden. Ze staan op de kroonlijst van de west- en de zuidgevel,
 * de twee kanten waar je het gebouw van de straat af op je af ziet komen. De
 * belettering is emissief in het materiaal en heeft dus geen enkele lamp nodig.
 */
export const FACADE_SIGN_SPEC = {
	text: 'MALL SIM',
	height: 2.8,
	reach: 0.36,
	/** Rand tussen de bordrand en de letters. */
	inset: 0.45,
	boards: [
		{ side: 'west', width: 15, along: ENTRANCE_CENTER_Z },
		{ side: 'south', width: 19, along: 0 },
	],
} as const satisfies Readonly<{
	text: string;
	height: number;
	reach: number;
	inset: number;
	boards: readonly Readonly<{ side: CardinalSide; width: number; along: number }>[];
}>;

/** Het buitenvlak van een hele gevel, ongesneden: waar een bord dat drie wandstukken beslaat tegenaan staat. */
function elevationFace(side: CardinalSide): FacadeFace {
	return facadeFace(side, perimeterWall(side));
}

function facadeSignBoards(): readonly FacadeReliefPiece[] {
	return FACADE_SIGN_SPEC.boards.map((board) => {
		const face = elevationFace(board.side);
		return reliefPiece(
			face,
			`sign-${board.side}`,
			'sign',
			board.along - half(board.width),
			board.along + half(board.width),
			FACADE_RELIEF_SPEC.cornice.maxY,
			FACADE_RELIEF_SPEC.cornice.maxY + FACADE_SIGN_SPEC.height,
			FACADE_SIGN_SPEC.reach,
		);
	});
}

export const MALL_FACADE_RELIEF: readonly FacadeReliefPiece[] = facadeReliefPieces();
export const MALL_FACADE_SIGNS: readonly FacadeReliefPiece[] = facadeSignBoards();

/**
 * De vergunning die een gevelstuk nodig heeft, uit zijn eigen doos afgeleid.
 *
 * De zijden komen uit de meting, want de kapoverstek maakt dat dezelfde uitkraging
 * op noord en zuid wél en op west en oost níét voorbij de omhullende komt; een
 * vaste lijst zou de helft van de tijd een ongebruikte vergunning zijn. De diepte
 * is wél geschreven: dat is het budget, en geometrie die erbuiten groeit valt
 * daarmee door `controleGevel`.
 */
function facadeProtrusion(piece: FacadeReliefPiece): Protrusion | undefined {
	const sides: CardinalSide[] = [];
	if (MALL_WALL_ENVELOPE.minX - piece.minX > PROTRUSION_MARGIN) sides.push('west');
	if (piece.maxX - MALL_WALL_ENVELOPE.maxX > PROTRUSION_MARGIN) sides.push('east');
	if (MALL_WALL_ENVELOPE.minZ - piece.minZ > PROTRUSION_MARGIN) sides.push('north');
	if (piece.maxZ - MALL_WALL_ENVELOPE.maxZ > PROTRUSION_MARGIN) sides.push('south');
	if (sides.length === 0) return undefined;
	return { depth: FACADE_RELIEF_SPEC.reachBudget, sides };
}

function facadeVolume(piece: FacadeReliefPiece): SpatialVolume {
	const volume = solidPrism(
		piece.id,
		rectangle(
			midpoint(piece.minX, piece.maxX),
			midpoint(piece.minZ, piece.maxZ),
			span(piece.minX, piece.maxX),
			span(piece.minZ, piece.maxZ),
		),
		piece.minY,
		piece.maxY,
		[],
		'solid',
		false,
	);
	const permit = facadeProtrusion(piece);
	return permit === undefined ? volume : { ...volume, protrusion: permit };
}

export const MALL_FACADE_ENTITY: MallWorldEntity = {
	id: 'mall-facade',
	label: 'Facade relief and roof-edge signs',
	category: 'decorative-surface',
	levels: ['v0', 'v1'],
	transform: { position: { x: 0, y: levelY('v0'), z: 0 }, rotation: ZERO_ROTATION },
	volumes: [...MALL_FACADE_RELIEF, ...MALL_FACADE_SIGNS].map(facadeVolume),
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	// Onzichtbaar op de plattegrond: tachtig strookjes van tien centimeter langs de
	// buitenrand tekenen niets wat de wanden daar niet al tekenen, ze maken de lijn
	// alleen dikker.
	map: { visible: false, layer: 'structure', priority: 46 },
	tags: ['facade', 'structural'],
};

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

/**
 * Het luik zelf: de plaat in het gat, en de strook waarop hij opengaat.
 *
 * `reachDown` kijkt de trap in, want wie van V1 omhoog klimt staat onder het dek
 * en zou anders tegen een dicht luik aan lopen.
 */
export const HELIPAD_HATCH_SPEC = {
	lidThickness: 0.06,
	approach: 2.2,
	reachDown: 2.4,
	openSeconds: 1.1,
	/** Vanaf deze stand is het blad ver genoeg weg om erlangs te kunnen. */
	clearFraction: 0.55,
} as const;

export const HELIPAD_HATCH_GATE: ClearanceMechanism = {
	id: 'helipad-hatch',
	kind: 'hinged',
	stateId: 'helipad-hatch-open',
	movingVolumeIds: ['lid'],
	triggerVolumeId: 'presence',
	openState: { rotationRadians: half(Math.PI) },
	openingSeconds: HELIPAD_HATCH_SPEC.openSeconds,
	// Stroom eraf betekent open: een dichtgevallen luik sluit de enige trap naar het dak af.
	failSafe: 'open',
	access: { admits: ['pedestrian'] },
};

const HATCH_PRESENCE_PLAN = rectangle(
	secretStairs.opening.center.x,
	secretStairs.opening.center.z,
	HATCH_WIDTH + HELIPAD_HATCH_SPEC.approach * 2,
	HATCH_DEPTH + HELIPAD_HATCH_SPEC.approach * 2,
);

/**
 * Het luik boven de geheime trap, met zijn kozijn.
 *
 * Het blad houdt zelf niets tegen: `HELIPAD_HATCH_GATE` is wat dichtvalt, en Helipad
 * zet de vloerplaat die daarbij hoort in de wereld.
 */
export const HELIPAD_HATCH: MallWorldEntity = {
	id: 'helipad-hatch',
	label: 'Secret-stairs roof hatch',
	category: 'helipad',
	levels: ['roof'],
	transform: {
		position: { x: secretStairs.opening.center.x, y: HATCH_FRAME_Y, z: secretStairs.opening.center.z },
		rotation: ZERO_ROTATION,
	},
	volumes: [
		...HELIPAD_HATCH_FRAME_RAILS.map((rail) =>
			solidPrism(rail.id, rectanglePlan(rail), HELIPAD_DECK_TOP_Y, HELIPAD_DECK_TOP_Y + HATCH_FRAME_HEIGHT),
		),
		{
			id: 'lid',
			role: 'solid',
			geometry: {
				kind: 'prism',
				plan: SECRET_STAIRS_OPENING_PLAN,
				minY: HELIPAD_DECK_TOP_Y,
				maxY: HELIPAD_DECK_TOP_Y + HELIPAD_HATCH_SPEC.lidThickness,
				holes: [],
			},
			blocksMovement: false,
			clearance: { kind: 'automatic-gate', mechanismId: HELIPAD_HATCH_GATE.id },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['hatch-lid'],
		},
		{
			id: 'presence',
			role: 'trigger',
			geometry: {
				kind: 'prism',
				plan: HATCH_PRESENCE_PLAN,
				minY: HELIPAD_DECK_TOP_Y - HELIPAD_HATCH_SPEC.reachDown,
				maxY: HELIPAD_DECK_TOP_Y + STANDING_PEDESTRIAN.bodyHeight,
				holes: [],
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['trigger', 'presence'],
		},
	],
	ports: NO_PORTS,
	placement: { class: 'fixture', requiresSupport: true, mayCover: [], mayBeCoveredBy: [] },
	kinematics: { kind: 'static' },
	mechanisms: [HELIPAD_HATCH_GATE],
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: { visible: false, layer: 'fixture', priority: 70 },
	tags: ['hatch-frame', 'hatch', 'structural'],
};

/** Het volume waar dit mechanisme op afgaat, uit het mechanisme zelf gelezen. */
export function mechanismTriggerBounds(entity: MallWorldEntity, mechanismId: string): Bounds3 {
	return mechanismVolumeBounds(entity, mechanismId, (mechanism) => [mechanism.triggerVolumeId]);
}

/** Wat dit mechanisme afsluit zolang het dicht staat: de omhullende van zijn bewegende delen. */
export function mechanismGateBounds(entity: MallWorldEntity, mechanismId: string): Bounds3 {
	return mechanismVolumeBounds(entity, mechanismId, (mechanism) => mechanism.movingVolumeIds);
}

function mechanismVolumeBounds(
	entity: MallWorldEntity,
	mechanismId: string,
	pick: (mechanism: ClearanceMechanism) => readonly string[],
): Bounds3 {
	const mechanism = entity.mechanisms.find((candidate) => candidate.id === mechanismId);
	if (!mechanism) throw new Error(`${entity.id} has no mechanism '${mechanismId}'`);
	const ids = pick(mechanism);
	const boxes = entity.volumes.filter((volume) => ids.includes(volume.id)).map((volume) => geometryBounds(volume.geometry));
	const first = boxes[0];
	if (!first) throw new Error(`${entity.id}.${mechanismId} names no volume that exists`);
	return boxes.reduce(
		(joined, box) => ({
			minX: Math.min(joined.minX, box.minX),
			maxX: Math.max(joined.maxX, box.maxX),
			minY: Math.min(joined.minY, box.minY),
			maxY: Math.max(joined.maxY, box.maxY),
			minZ: Math.min(joined.minZ, box.minZ),
			maxZ: Math.max(joined.maxZ, box.maxZ),
		}),
		first,
	);
}

/** Gaat dit mechanisme voor deze verkeersklasse open? Het beleid staat op het mechanisme. */
export function mechanismAdmits(entity: MallWorldEntity, mechanismId: string, traffic: TrafficClass): boolean {
	return entity.mechanisms.some((candidate) => candidate.id === mechanismId && candidate.access.admits.includes(traffic));
}

/** Elke roltrap en elke trap in dit gebouw is een looproute rechtop; de vrije hoogte volgt daaruit. */
const FLIGHT_POSTURE: PedestrianPosture = 'standing';

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
					height: postureHeadroom(FLIGHT_POSTURE),
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
				height: postureHeadroom(FLIGHT_POSTURE),
				connectsTo: [`${connector.id}-${connector.to}`],
				oneWay: false,
				allows: ['walking'],
				clearanceVolumeId: 'route-clearance',
				posture: FLIGHT_POSTURE,
			},
			{
				id: `${connector.id}-${connector.to}`,
				kind,
				position: end,
				direction: { x: 0, y: 0, z: Math.sign(connector.zBottom - connector.zTop) },
				width: connector.width,
				height: postureHeadroom(FLIGHT_POSTURE),
				connectsTo: [`${connector.id}-${connector.from}`],
				oneWay: false,
				allows: ['walking'],
				clearanceVolumeId: 'route-clearance',
				posture: FLIGHT_POSTURE,
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

/**
 * Hoever de uitrit voorbij de westgevel de stad in loopt.
 *
 * Hij hoort daar: de mond ligt tien meter buiten het gebouw en de geul eromheen ook.
 * Dat stond als een blanco vrijstelling in `controleGevel` — één tag en de hele
 * entiteit werd overgeslagen, zonder dat iemand ooit een diepte opschreef. Nu
 * verklaart elk volume dat naar buiten komt hoeveel, net als de luifelkolommen, en
 * meet de controle het na.
 */
const PARKING_EXIT_REACH = span(PARKING_EXIT_RAMP.end.x, MALL_WALL_ENVELOPE.minX);
const PARKING_EXIT_PROTRUSION: Protrusion = { depth: PARKING_EXIT_REACH, sides: ['west'] };

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
			protrusion: PARKING_EXIT_PROTRUSION,
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
				height: PARKING_EXIT_HEADROOM,
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
			height: PARKING_EXIT_HEADROOM,
			connectsTo: ['parking-exit-city'],
			oneWay: false,
			allows: ['walking', 'wheeled', 'service'],
			clearanceVolumeId: 'route-clearance',
			posture: 'standing',
		},
		{
			id: 'parking-exit-city',
			kind: 'ramp',
			position: PARKING_EXIT_RAMP.end,
			direction: { x: 1, y: 0, z: 0 },
			width: PARKING_EXIT_RAMP.width,
			height: PARKING_EXIT_HEADROOM,
			connectsTo: ['parking-exit-p1'],
			oneWay: false,
			allows: ['walking', 'wheeled', 'service'],
			clearanceVolumeId: 'route-clearance',
			posture: 'standing',
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
		posture: 'standing',
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
		[NOT_A_PORTAL_TAG],
	),
	openingEntity(
		'opening-elevator-v0',
		'Elevator opening at V0',
		['p1', 'v0'],
		V0_ELEVATOR_PLAN,
		levelY('p1'),
		levelY('v0') + 0.5,
	),
	// Eén schacht van de begane grond tot het glazen dak, want dat is wat het atrium
	// is: `connects` zei dat al en de entiteit hield op bij V1, dus vanaf het dek
	// keek je door de lichtkoepel een gat in dat niets meer verbond.
	openingEntity(
		`opening-${ATRIUM_OPENING.id}`,
		'Atrium void',
		ATRIUM_OPENING.connects,
		V1_ATRIUM_PLAN,
		levelY('v0'),
		levelY('roof') + 0.5,
	),
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
 * De winkelruimte loopt van de pui tot de binnenkant van de wand erachter.
 *
 * Hij groeide met een aandeel van zijn eigen opgegeven diepte en hield daardoor
 * overal een spleet over: 0,28 m bij de noordwinkels, 0,74 bij SAUCY en 1,2 bij
 * DOUGLAS, GAME MANIA, STARBUCKS, RITUALS en ACTION. Daar keek je tussen de doos
 * en de gevel door, met de losse achterwand in de kier. De perimeter ís de
 * achterwand. KRUIDVAT liep hier al tegenaan: zijn 7 m eindigde 0,24 m buiten de
 * noordgevel. De mesh in MallBuilder, de collider en het volume hieronder lezen
 * dit alle drie.
 */
export function shopRoomDepth(store: StoreDef): number {
	return runToMallInterior(store.x, store.z, -Math.sin(store.rotation), -Math.cos(store.rotation));
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
			roomShell(
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
	/** Which way the room faces, as a yaw about y. A room whose back has to meet a wall needs it. */
	yaw?: number;
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
		transform: {
			position: { x: spec.center.x, y: levelY(spec.level), z: spec.center.z },
			rotation: { ...ZERO_ROTATION, yaw: spec.yaw ?? 0 },
		},
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
 * De show staat in de zuidoosthoek, tussen de pui van GAME MANIA (tot z 4) en die
 * van IKEA (vanaf z 16.5), met de oostgevel achter de laatste stoelenrij. Hij stond
 * op x −28 tot de hoofdingang die strook nodig had: het dek lag dwars over de enige
 * route van de deur naar het atrium.
 *
 * Twee maten houden hem vrij. De achterwand op `startZ − backdrop.offset` is massief
 * en mag dus niet in de puistrook van GAME MANIA komen, en de neus op
 * `tipZ + tipOffset + halfWidth` moet vóór die van IKEA blijven. In x staat hij
 * voorbij x 31, waar geen enkele looproute-tak meer komt.
 */
export const CATWALK_SPEC = {
	runwayX: 32.4,
	startZ: 6,
	tipZ: 14,
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

const ENTRANCE_DOORS: ClearanceMechanism = {
	id: 'entrance-doors',
	kind: 'sliding',
	stateId: 'entrance-door-open',
	movingVolumeIds: ['door-north', 'door-south'],
	triggerVolumeId: 'presence',
	openState: { translation: { x: 0, y: 0, z: ENTRANCE_PORTAL.doorTravel } },
	openingSeconds: ENTRANCE_SPEC.doorSeconds,
	// Stroom eraf betekent open: een dichtgevallen hoofdingang sluit het gebouw op.
	failSafe: 'open',
	access: { admits: ['pedestrian'] },
};

/** Eén schuifdeurblad. Het houdt geen lichaam tegen; het mechanisme erboven schuift het weg. */
function slidingLeaf(id: string, minZ: number, maxZ: number): SpatialVolume {
	return {
		id,
		role: 'solid',
		geometry: {
			kind: 'prism',
			plan: rectangle(ENTRANCE_PORTAL.glassX, midpoint(minZ, maxZ), ENTRANCE_SPEC.doorThickness, span(minZ, maxZ)),
			minY: V0_Y,
			maxY: V0_Y + ENTRANCE_SPEC.doorLeafHeight,
			holes: [],
		},
		blocksMovement: false,
		clearance: { kind: 'automatic-gate', mechanismId: ENTRANCE_DOORS.id },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: [GLASS_TAG, 'door-leaf'],
	};
}

function entranceSidelight(id: string, minZ: number, maxZ: number): SpatialVolume {
	return glazed(
		solidPrism(
			id,
			rectangle(ENTRANCE_PORTAL.glassX, midpoint(minZ, maxZ), ENTRANCE_SPEC.glassThickness, span(minZ, maxZ)),
			V0_Y,
			V0_Y + ENTRANCE_SPEC.doorHeadY,
		),
	);
}

/** Glazing: it stops a body and not a sightline, and the zone graph reads that difference. */
function glazed(volume: SpatialVolume): SpatialVolume {
	return { ...volume, tags: [...volume.tags, GLASS_TAG] };
}

function entranceColumn(id: string, z: number): SpatialVolume {
	const { column, canopy } = ENTRANCE_SPEC;
	const height = canopy.topY - canopy.thickness;
	return {
		...uprightCylinder(id, { x: ENTRANCE_PORTAL.columnX, y: V0_Y + half(height), z }, column.radius, height, 'solid', true),
		// Hij staat met opzet op de stoep. Zonder deze verklaring leest controleGevel
		// hem als geometrie die door de gevel is gezakt, en dat is precies goed.
		protrusion: { depth: ENTRANCE_COLUMN_REACH, sides: ['west'] },
	};
}

/** De naam die de kaart aan het portaal geeft. De controle op de schotel leest hem terug. */
export const ENTRANCE_LABEL = 'HOOFDINGANG';

/**
 * HOOFDINGANG: de doorgang op straatniveau in de westgevel.
 *
 * Straat en V0 liggen allebei op y 0, dus een gat in de gevel is genoeg en er hoeft
 * geen helling bij. `threshold` is de vrijloop die dat gat verklaart: zet er iets
 * vasts in en `validateSpatialWorld` weigert de wereld. De twee bladen zijn een
 * `automatic-gate` van `entrance-doors` en houden zelf niets tegen, en `presence` is
 * het vlak waar dat mechanisme op afgaat.
 */
export const ENTRANCE_ENTITY: MallWorldEntity = {
	id: 'main-entrance',
	label: 'Main street entrance',
	category: 'opening',
	levels: ['v0'],
	transform: { position: { x: ENTRANCE_PORTAL.glassX, y: V0_Y, z: ENTRANCE_PORTAL.centerZ }, rotation: ZERO_ROTATION },
	volumes: [
		clearancePrism(
			'threshold',
			rectangle(
				midpoint(ENTRANCE_PORTAL.outerX, ENTRANCE_PORTAL.innerX + ENTRANCE_SPEC.trigger.inreach),
				ENTRANCE_PORTAL.centerZ,
				span(ENTRANCE_PORTAL.outerX, ENTRANCE_PORTAL.innerX + ENTRANCE_SPEC.trigger.inreach),
				span(ENTRANCE_PORTAL.doorMinZ, ENTRANCE_PORTAL.doorMaxZ),
			),
			V0_Y,
			V0_Y + ENTRANCE_SPEC.doorHeadY,
			'opening-clearance',
		),
		entranceSidelight('sidelight-north', ENTRANCE_PORTAL.minZ, ENTRANCE_PORTAL.doorMinZ),
		entranceSidelight('sidelight-south', ENTRANCE_PORTAL.doorMaxZ, ENTRANCE_PORTAL.maxZ),
		// Het glas boven de deuren houdt wél lichamen tegen: op V1 sta je er anders
		// zo doorheen de straat op. Kijken kan er wel doorheen, en dat is wat de
		// zonegraaf uit `GLASS_TAG` afleest.
		glazed(
			solidPrism(
				'screen',
				rectangle(ENTRANCE_PORTAL.glassX, ENTRANCE_PORTAL.centerZ, ENTRANCE_SPEC.glassThickness, ENTRANCE_SPEC.width),
				V0_Y + ENTRANCE_SPEC.doorHeadY,
				V0_Y + ENTRANCE_SPEC.glassTopY,
			),
		),
		slidingLeaf('door-north', ENTRANCE_PORTAL.doorMinZ, ENTRANCE_PORTAL.centerZ),
		slidingLeaf('door-south', ENTRANCE_PORTAL.centerZ, ENTRANCE_PORTAL.doorMaxZ),
		{
			id: 'presence',
			role: 'trigger',
			geometry: {
				kind: 'prism',
				plan: rectangle(
					midpoint(ENTRANCE_PORTAL.trigger.minX, ENTRANCE_PORTAL.trigger.maxX),
					midpoint(ENTRANCE_PORTAL.trigger.minZ, ENTRANCE_PORTAL.trigger.maxZ),
					span(ENTRANCE_PORTAL.trigger.minX, ENTRANCE_PORTAL.trigger.maxX),
					span(ENTRANCE_PORTAL.trigger.minZ, ENTRANCE_PORTAL.trigger.maxZ),
				),
				minY: V0_Y,
				maxY: V0_Y + ENTRANCE_PORTAL.trigger.maxY,
				holes: [],
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['trigger', 'presence'],
		},
		solidPrism(
			'hall-floor',
			rectangle(
				ENTRANCE_PORTAL.innerX + half(ENTRANCE_SPEC.hall.depth),
				ENTRANCE_PORTAL.centerZ,
				ENTRANCE_SPEC.hall.depth,
				ENTRANCE_SPEC.width,
			),
			V0_Y,
			V0_Y + ENTRANCE_SPEC.hall.thickness,
			[],
			'decorative-covering',
			false,
		),
		{
			...solidPrism(
				'canopy',
				rectangle(
					midpoint(ENTRANCE_PORTAL.canopyX, ENTRANCE_PORTAL.outerX),
					ENTRANCE_PORTAL.centerZ,
					span(ENTRANCE_PORTAL.canopyX, ENTRANCE_PORTAL.outerX),
					ENTRANCE_SPEC.width + ENTRANCE_SPEC.canopy.flank * 2,
				),
				ENTRANCE_SPEC.canopy.topY - ENTRANCE_SPEC.canopy.thickness,
				ENTRANCE_SPEC.canopy.topY,
				[],
				'solid',
				false,
			),
			protrusion: { depth: ENTRANCE_CANOPY_REACH, sides: ['west'] },
		},
		entranceColumn('column-north', ENTRANCE_PORTAL.centerZ - ENTRANCE_SPEC.column.offsetZ),
		entranceColumn('column-south', ENTRANCE_PORTAL.centerZ + ENTRANCE_SPEC.column.offsetZ),
	],
	ports: [
		{
			id: 'entrance-street',
			kind: 'door',
			position: { x: ENTRANCE_PORTAL.outerX, y: V0_Y, z: ENTRANCE_PORTAL.centerZ },
			direction: { x: 1, y: 0, z: 0 },
			width: span(ENTRANCE_PORTAL.doorMinZ, ENTRANCE_PORTAL.doorMaxZ),
			height: ENTRANCE_SPEC.doorHeadY,
			connectsTo: ['entrance-hall'],
			oneWay: false,
			allows: ['walking', 'wheeled', 'service'],
			clearanceVolumeId: 'threshold',
			posture: 'standing',
		},
		{
			id: 'entrance-hall',
			kind: 'door',
			position: { x: ENTRANCE_PORTAL.innerX, y: V0_Y, z: ENTRANCE_PORTAL.centerZ },
			direction: { x: -1, y: 0, z: 0 },
			width: span(ENTRANCE_PORTAL.doorMinZ, ENTRANCE_PORTAL.doorMaxZ),
			height: ENTRANCE_SPEC.doorHeadY,
			connectsTo: ['entrance-street'],
			oneWay: false,
			allows: ['walking', 'wheeled', 'service'],
			clearanceVolumeId: 'threshold',
			posture: 'standing',
		},
	],
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: [ENTRANCE_DOORS],
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('circulation', ENTRANCE_LABEL, 92),
	tags: ['entrance', 'circulation', 'must-remain-clear'],
};

/**
 * Het blok staat met zijn opening op het noorden, aan de hal van de hoofdingang.
 * Op het zuiden stonden Beard-man's Cave en ISLAND HOP ervoor: wie naar de wc liep
 * kwam bij een reisbureau uit. Alles wat hier een kant kiest, kiest daarom noord
 * als voorkant en zuid als achterkant.
 */
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

/**
 * Wandharten van de schil: mesh, collider en volume lezen dezelfde drie. `backZ` is
 * de dichte wand op het zuiden en `fasciaZ` de latei boven de opening op het noorden.
 */
export const RESTROOMS_SHELL = {
	sideX: restroomsWallCenter(half(RESTROOMS_SPEC.shell.width), RESTROOMS_SPEC.wallThickness),
	backZ: restroomsWallCenter(half(RESTROOMS_SPEC.shell.depth), RESTROOMS_SPEC.wallThickness),
	fasciaZ: restroomsWallCenter(half(RESTROOMS_SPEC.shell.depth), RESTROOMS_SPEC.fascia.thickness),
} as const;

const RESTROOMS_WALL_TOP = V0_Y + RESTROOMS_SPEC.wallHeight;
const RESTROOMS_HALF_DEPTH = half(RESTROOMS_SPEC.shell.depth);

// De ruime kier hoort bij de opening en de krappe bij de dichte wand, dus de
// frontGap ligt op het noorden en de backGap op het zuiden.
const RESTROOMS_DIVIDER_MIN_Z = -RESTROOMS_HALF_DEPTH + RESTROOMS_SPEC.divider.frontGap;
const RESTROOMS_DIVIDER_MAX_Z = RESTROOMS_HALF_DEPTH - RESTROOMS_SPEC.divider.backGap;

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
	/** Afstand van de scheidingswand tot het hart van elk van de twee ruimtes. */
	roomOffsetX: 2,
	zone: { width: 3.6, depth: 5.6, thickness: 0.02, centerY: 0.09 },
	urinalWall: { width: 3.2, height: 1.4, thickness: 0.08, centerY: 0.9, offsetZ: 2.6 },
	urinals: { count: 3, spacing: 1.1, offsetZ: 2.45 },
	stall: { width: 1.1, depth: 1.4, height: 2 },
	mensStall: { offsetX: -1.15, offsetZ: -1.1 },
	womensStall: { offsetX: 1, offsetZ: -0.2 },
	basin: { width: 0.7, depth: 0.45, height: 0.98 },
	mensBasin: { offsetX: 1.2, offsetZ: -2.2 },
	womensBasin: { offsetX: 1, offsetZ: -2.3 },
	/**
	 * De wudu-nis staat in de nutstrook tussen het blok en de westgevel.
	 *
	 * Vóór de opening op het noorden stond hij middenin de enige deur: de aanloop
	 * uit de entreehal komt op de scheidingswand uit en liep dwars door een bank van
	 * 2,4 bij 0,7 meter heen. De strook ernaast is de enige plek naast de twee
	 * ruimtes waar geen looplijn overheen gaat, en hij ligt op weg naar de
	 * gebedsruimte, die verderop tegen dezelfde gevel staat.
	 */
	wudu: {
		/** Tegen welke wand hij met zijn rug staat. Grondvlak én mesh draaien hieruit. */
		against: 'west',
		offsetX: -5.45,
		offsetZ: 0,
		/** `length` loopt langs die wand, `depth` er vanaf. */
		bench: { length: 2.4, depth: 0.7, height: 0.35, centerY: 0.2 },
		basin: { length: 2.2, depth: 0.55, height: 0.18, centerY: 0.42 },
		taps: { count: 3, spacing: 0.7, height: 0.72, reach: 0.15 },
		water: { length: 2, depth: 0.4, thickness: 0.04, y: 0.5 },
		sign: { width: 1.6, height: 0.4, y: 1.35, reach: -0.2 },
	},
} as const;

/**
 * De twee ruimtes ten opzichte van de scheidingswand. Met de opening op het noorden
 * houdt heren dezelfde hand als voorheen: wie binnenloopt heeft de urinoirs links.
 */
export const RESTROOMS_ROOMS = {
	mensX: RESTROOMS_INTERIOR.roomOffsetX,
	womensX: -RESTROOMS_INTERIOR.roomOffsetX,
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
	const { zone, urinalWall, stall, basin } = interior;
	const { mensX, womensX } = RESTROOMS_ROOMS;
	const zoneTop = zone.centerY + half(zone.thickness);
	const urinalWallTop = urinalWall.centerY + half(urinalWall.height);
	return [
		restroomsFitting('zone-mens', { x: mensX, z: 0 }, zone.width, zone.depth, zoneTop, 'decorative-covering'),
		restroomsFitting('zone-womens', { x: womensX, z: 0 }, zone.width, zone.depth, zoneTop, 'decorative-covering'),
		restroomsFitting('urinal-wall', { x: mensX, z: urinalWall.offsetZ }, urinalWall.width, urinalWall.thickness, urinalWallTop),
		restroomsFitting(
			'stall-mens',
			{ x: mensX + interior.mensStall.offsetX, z: interior.mensStall.offsetZ },
			stall.width,
			stall.depth,
			stall.height,
		),
		restroomsFitting(
			'stall-womens-west',
			{ x: womensX - interior.womensStall.offsetX, z: interior.womensStall.offsetZ },
			stall.width,
			stall.depth,
			stall.height,
		),
		restroomsFitting(
			'stall-womens-east',
			{ x: womensX + interior.womensStall.offsetX, z: interior.womensStall.offsetZ },
			stall.width,
			stall.depth,
			stall.height,
		),
		restroomsFitting(
			'basin-mens',
			{ x: mensX + interior.mensBasin.offsetX, z: interior.mensBasin.offsetZ },
			basin.width,
			basin.depth,
			basin.height,
		),
		restroomsFitting(
			'basin-womens-west',
			{ x: womensX - interior.womensBasin.offsetX, z: interior.womensBasin.offsetZ },
			basin.width,
			basin.depth,
			basin.height,
		),
		restroomsFitting(
			'basin-womens-east',
			{ x: womensX + interior.womensBasin.offsetX, z: interior.womensBasin.offsetZ },
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
			'wall-south',
			rectangle(
				RESTROOMS_SPEC.center.x,
				RESTROOMS_SPEC.center.z + RESTROOMS_SHELL.backZ,
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
				RESTROOMS_SPEC.center.z - RESTROOMS_SHELL.fasciaZ,
				RESTROOMS_SPEC.shell.width,
				RESTROOMS_SPEC.fascia.thickness,
			),
			RESTROOMS_WALL_TOP - RESTROOMS_SPEC.fascia.height,
			RESTROOMS_WALL_TOP,
			[],
			'solid',
			false,
		),
		// De strook vóór de opening op het noorden, net als bij een winkelpui. Hij
		// ontbrak zolang de wudu-nis er middenin stond; nu die in de nutstrook staat
		// bewaakt hij de enige deur van het blok tegen het volgende meubel.
		clearancePrism(
			'frontage',
			rectangle(
				RESTROOMS_SPEC.center.x,
				RESTROOMS_SPEC.center.z - RESTROOMS_HALF_DEPTH - half(STOREFRONT_CLEARANCE_DEPTH),
				RESTROOMS_SPEC.shell.width,
				STOREFRONT_CLEARANCE_DEPTH,
			),
			V0_Y,
			V0_Y + STANDING_PEDESTRIAN.requiredHeadroom,
			'storefront-clearance',
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
const WUDU_BENCH_TOP_Y = V0_Y + RESTROOMS_INTERIOR.wudu.bench.centerY + half(RESTROOMS_INTERIOR.wudu.bench.height);

/**
 * De draai waarmee iets met zijn rug tegen deze wand de ruimte in kijkt.
 *
 * Voorkant is lokaal +z, dezelfde afspraak als de rest van het toiletblok. Eén
 * tabel, want een nis die draait moet zijn grondvlak meedraaien en die twee
 * mogen niet uit elkaar lopen.
 */
export const BACK_TO_WALL_Y: Readonly<Record<CardinalSide, number>> = {
	west: Math.PI / 2,
	east: -Math.PI / 2,
	north: 0,
	south: Math.PI,
};

/** Loopt de lengte van iets dat tegen deze wand staat langs z? Op west en oost wel. */
export function alongZAgainst(side: CardinalSide): boolean {
	return side === 'west' || side === 'east';
}

const WUDU_ALONG_Z = alongZAgainst(RESTROOMS_INTERIOR.wudu.against);

/** Het grondvlak van een stuk van de nis, gedraaid met de wand waar hij tegenaan staat. */
function wuduPlan(length: number, depth: number): PlanShape {
	return rectangle(WUDU_CENTER.x, WUDU_CENTER.z, WUDU_ALONG_Z ? depth : length, WUDU_ALONG_Z ? length : depth);
}

/**
 * De voetwasnis tussen gebedsruimte en toiletten. Hij staat buiten de tegelplaat,
 * dus buiten het toiletblok, en hij houdt een lichaam tegen: een bank van 38 cm is
 * geen vloer waar je doorheen loopt.
 */
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
				wuduPlan(RESTROOMS_INTERIOR.wudu.bench.length, RESTROOMS_INTERIOR.wudu.bench.depth),
				V0_Y,
				WUDU_BENCH_TOP_Y,
				[],
				'solid',
				true,
			),
		),
		solidPrism(
			'basin',
			wuduPlan(RESTROOMS_INTERIOR.wudu.basin.length, RESTROOMS_INTERIOR.wudu.basin.depth),
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

/** De doos die de nis in de collisionwereld is. Scene en wereldmodel lezen dezelfde maten. */
export const WUDU_COLLIDER = {
	minX: WUDU_CENTER.x - half(WUDU_ALONG_Z ? RESTROOMS_INTERIOR.wudu.bench.depth : RESTROOMS_INTERIOR.wudu.bench.length),
	maxX: WUDU_CENTER.x + half(WUDU_ALONG_Z ? RESTROOMS_INTERIOR.wudu.bench.depth : RESTROOMS_INTERIOR.wudu.bench.length),
	minZ: WUDU_CENTER.z - half(WUDU_ALONG_Z ? RESTROOMS_INTERIOR.wudu.bench.length : RESTROOMS_INTERIOR.wudu.bench.depth),
	maxZ: WUDU_CENTER.z + half(WUDU_ALONG_Z ? RESTROOMS_INTERIOR.wudu.bench.length : RESTROOMS_INTERIOR.wudu.bench.depth),
	topY: WUDU_BENCH_TOP_Y,
} as const;

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
	// De lijst was 3,9 m diep op een vloerplaat van 3,8 en stak dus aan weerszijden
	// vijf centimeter voorbij de doos die hem draagt.
	fascia: { width: 0.2, height: 0.35, depth: islandHopStore.depth, offsetX: 1.55, centerY: 2.45 },
	desk: { width: 1.6, height: 0.9, depth: 0.7, offsetX: 0.55, top: { width: 1.7, depth: 0.78, thickness: 0.08 } },
	/**
	 * De twee vaandels boven de balie.
	 *
	 * Het waren sprites op één hoogte-as: de groene charterbanier en de rode
	 * cash-only-banier overlapten elkaar over 3,5 cm, en omdat een sprite met de
	 * camera meedraait zwaaide elk van de twee bij elke stap dwars door de gouden
	 * lijst heen. Ze hangen nu vóór die lijst, elk in zijn eigen hoogteband.
	 */
	banner: {
		/** Vrije ruimte tussen de voorkant van de lijst en de rug van een bord. */
		standoff: 0.06,
		thickness: 0.03,
		/** Vrije ruimte tussen twee borden onder elkaar. */
		gap: 0.06,
		boards: [
			{ id: 'charter', length: 3.2, height: 0.42 },
			{ id: 'cash-only', length: 2.6, height: 0.3 },
		],
	},
} as const;

export type IslandHopBanner = Bounds3 & Readonly<{ id: string }>;

/**
 * De borden, van boven naar beneden onder de bovenkant van de lijst. De bouwer en de
 * volumes hieronder lezen dezelfde dozen, dus een bord kan niet in de mesh ergens
 * anders hangen dan in het model.
 */
export const ISLAND_HOP_BANNERS: readonly IslandHopBanner[] = ((): readonly IslandHopBanner[] => {
	const { center, fascia, banner } = ISLAND_HOP_SPEC;
	const front = center.x + fascia.offsetX + half(fascia.width) + banner.standoff;
	let top = V0_Y + fascia.centerY + half(fascia.height);
	return banner.boards.map((board) => {
		const box: IslandHopBanner = {
			id: board.id,
			minX: front,
			maxX: front + banner.thickness,
			minY: top - board.height,
			maxY: top,
			minZ: center.z - half(board.length),
			maxZ: center.z + half(board.length),
		};
		top = box.minY - banner.gap;
		return box;
	});
})();

/**
 * Hoever ISLAND HOP vrij van de westgevel staat, en waarom hij dat mag.
 *
 * De noordflank van Beard-man's Cave loopt drie meter de winkelvloer op en ligt
 * dwars achter deze balie, dus de doos kan hier niet tot de gevel doorlopen zoals de
 * achttien andere winkels dat wel doen. Het getal staat er met de hand in: rekende
 * het zich uit de doos zelf terug, dan verklaart de verklaring altijd precies wat
 * er staat en meet niemand meer iets na.
 */
const ISLAND_HOP_STANDOFF: Standoff = { side: 'west', depth: 3.8 };

export const ISLAND_HOP_ENTITY: MallWorldEntity = roomEntity({
	id: `shop-${islandHopStore.id}`,
	label: islandHopStore.name,
	category: 'shop',
	level: 'v0',
	center: ISLAND_HOP_SPEC.center,
	placementClass: 'fixture',
	yaw: islandHopStore.rotation,
	volumes: [
		roomShell(
			solidPrism(
				'room-shell',
				rectangle(ISLAND_HOP_SPEC.center.x, ISLAND_HOP_SPEC.center.z, ISLAND_HOP_SPEC.slab.width, ISLAND_HOP_SPEC.slab.depth),
				V0_Y,
				V0_Y + ISLAND_HOP_SPEC.wallHeight,
			),
			ISLAND_HOP_STANDOFF,
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
		signage(
			solidPrism(
				'fascia',
				rectangle(
					ISLAND_HOP_SPEC.center.x + ISLAND_HOP_SPEC.fascia.offsetX,
					ISLAND_HOP_SPEC.center.z,
					ISLAND_HOP_SPEC.fascia.width,
					ISLAND_HOP_SPEC.fascia.depth,
				),
				V0_Y + ISLAND_HOP_SPEC.fascia.centerY - half(ISLAND_HOP_SPEC.fascia.height),
				V0_Y + ISLAND_HOP_SPEC.fascia.centerY + half(ISLAND_HOP_SPEC.fascia.height),
				[],
				'solid',
				false,
			),
		),
		...ISLAND_HOP_BANNERS.map((board) =>
			signage(
				solidPrism(
					`banner-${board.id}`,
					rectangle(
						midpoint(board.minX, board.maxX),
						midpoint(board.minZ, board.maxZ),
						span(board.minX, board.maxX),
						span(board.minZ, board.maxZ),
					),
					board.minY,
					board.maxY,
					[],
					'solid',
					false,
				),
			),
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

/**
 * De balustrade langs het atriumgat op V1: glas van het dek tot de handrail, met
 * de buis er bovenop. Het Bouwbesluit vraagt 1 m bij een val van 6 m, dus 1,1 m
 * is die eis plus de marge die een winkelcentrum aanhoudt.
 */
export const ATRIUM_BALUSTRADE_SPEC = {
	glassHeight: 1.1,
	railThickness: 0.05,
} as const;

/** Bovenkant van de handrail: hier moet je overheen om het atrium in te springen. */
export const ATRIUM_BALUSTRADE_TOP_Y = V1_Y + ATRIUM_BALUSTRADE_SPEC.glassHeight + half(ATRIUM_BALUSTRADE_SPEC.railThickness);

const ATRIUM_PLANTER_LABEL = 'PLANTENBAK · VIDE';

/**
 * De plantenbak tegen de oostrand van het atriumgat, met een zitrand ervoor.
 * 0,38 m is de zithoogte van een lage parkbank en 0,76 m is tafelhoogte, de rand
 * van een verhoogde bak. Twee optredes van 0,38 m dus.
 *
 * Hij staat er omdat de balustrade 1,1 m hoog is en een mens 0,46 m springt: van
 * het dek kom je daar niet meer overheen, vanaf de bakrand wel. De sprong over de
 * balustrade naar de fontein hangt daaraan, en `controleBalustradesprong` rekent
 * de hele keten na.
 *
 * Die twee maten zijn geen smaak. Elke optrede moet onder JUMP_RISE blijven, anders
 * kom je er niet op, en ze moet ook ruim genoeg onder blijven: zolang je nog geen
 * optrede hoog bent duwt de doos van de volgende trede je weg, en in de tijd die
 * je erboven doorbrengt moet een spelerstraal aan grond passen. Bij 0,38 m is dat
 * 0,53 m lopend tegen de 0,4 m die nodig is; bij 0,44 m is het te krap.
 *
 * `innerX` ligt precies een spelerstraal buiten ATRIUM_BARRIER. Schuift de bak
 * verder naar binnen, dan duwt die klem je van je eigen bakrand af zodra je erop
 * landt, en dan is de bak een decorstuk.
 */
export const ATRIUM_PLANTER_SPEC = {
	innerX: half(ATRIUM_BARRIER.width) + STANDING_PEDESTRIAN.radius,
	centerZ: ATRIUM_OPENING.center.z,
	length: 2.4,
	/** De bak zelf, tegen de balustrade. */
	planter: { height: 0.76, depth: 0.75 },
	/** De zitrand ervoor, waar je vanaf het dek op stapt. */
	bench: { height: 0.38, depth: 0.75 },
	/** Hoeveel steen er rond het grondbed zichtbaar blijft. */
	bedInset: 0.12,
	/** Wat er in de bak groeit; decor, dus geen collider. */
	shrub: { radius: 0.22, count: 4 },
} as const;

export type AtriumPlanterTier = Readonly<{
	id: string;
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	/** Het loopvlak: de bovenkant van deze trede. */
	topY: number;
	/**
	 * Vanaf hier is die bovenkant ook echt te belopen. Tegen de trede erachter
	 * past geen lichaam, dus daar staat de rand van het loopvlak een spelerstraal
	 * verder naar buiten dan de doos.
	 */
	standMinX: number;
}>;

/**
 * De twee treden, hoogste eerst. Collision, de mesh, de kaart en
 * `controleBalustradesprong` lezen deze lijst, zodat er maar één plek is waar de
 * maten staan.
 *
 * De volgorde is niet vrij: `groundHeightAt` neemt het eerste dek dat een punt
 * dekt, en op de naad tussen bak en zitrand dekken ze allebei. Andersom stond je
 * daar op de bakrand en zei de vloer 0,38 m lager te liggen.
 */
export function atriumPlanterTiers(): readonly AtriumPlanterTier[] {
	const { innerX, centerZ, length, planter, bench } = ATRIUM_PLANTER_SPEC;
	const minZ = centerZ - half(length);
	const maxZ = centerZ + half(length);
	const seam = innerX + planter.depth;
	return [
		// De bak zelf heeft niets hogers achter zich: `innerX` houdt al een
		// spelerstraal aan tot de atriumklem.
		{ id: 'planter', minX: innerX, maxX: seam, minZ, maxZ, topY: V1_Y + planter.height, standMinX: innerX },
		{
			id: 'bench',
			minX: seam,
			maxX: seam + bench.depth,
			minZ,
			maxZ,
			topY: V1_Y + bench.height,
			standMinX: seam + STANDING_PEDESTRIAN.radius,
		},
	];
}

export const ATRIUM_PLANTER_ENTITY: MallWorldEntity = roomEntity({
	id: 'atrium-planter',
	label: 'Atrium void planter',
	category: 'prop',
	level: 'v1',
	center: {
		x: ATRIUM_PLANTER_SPEC.innerX + half(ATRIUM_PLANTER_SPEC.planter.depth + ATRIUM_PLANTER_SPEC.bench.depth),
		z: ATRIUM_PLANTER_SPEC.centerZ,
	},
	placementClass: 'furnishing',
	volumes: atriumPlanterTiers().map((tier) =>
		solidPrism(
			tier.id,
			rectangle(
				midpoint(tier.minX, tier.maxX),
				midpoint(tier.minZ, tier.maxZ),
				span(tier.minX, tier.maxX),
				span(tier.minZ, tier.maxZ),
			),
			V1_Y,
			tier.topY,
			[],
			'walkable',
			false,
		),
	),
	map: map('clutter', ATRIUM_PLANTER_LABEL, 58),
	tags: ['atrium', 'furniture', 'planter'],
});

const PARKING_CEILING = { thickness: 0.3, height: 4.6 } as const;

/**
 * Walls and pillars stop at the ceiling's own underside.
 *
 * They used to stop 5 cm below it, and from P1 that seam ran right round the
 * building: through it you saw the city at street level, and the beige underside
 * of the ground-floor slab where it overhangs the parking box.
 */
const PARKING_CLEAR_HEIGHT = PARKING_CEILING.height - half(PARKING_CEILING.thickness);

export const PARKING_DECK_SPEC = {
	/** Height of the walls and the pillars alike, above the deck. */
	clearHeight: PARKING_CLEAR_HEIGHT,
	ceiling: PARKING_CEILING,
	wall: { thickness: 0.35, inset: 0.2 },
	pillar: { width: 0.7, spacing: 8, columns: 3, rows: 2, elevatorKeepOut: 5 },
	booth: { center: { x: 22, z: -4 }, width: 2.2, height: 2.4, depth: 2 },
} as const;

const PARKING_DECK_Y = levelY('p1');
const PARKING_CEILING_Y = PARKING_DECK_Y + PARKING_DECK_SPEC.ceiling.height;
const PARKING_CEILING_TOP_Y = PARKING_CEILING_Y + half(PARKING_DECK_SPEC.ceiling.thickness);
const PARKING_CLEAR_TOP = PARKING_DECK_Y + PARKING_DECK_SPEC.clearHeight;

/** Centre line of the wall panels on each elevation, inset from the footprint edge. */
const PARKING_WALL_X = half(PARKING_FOOTPRINT.width) - PARKING_DECK_SPEC.wall.inset;
const PARKING_WALL_Z = half(PARKING_FOOTPRINT.depth) - PARKING_DECK_SPEC.wall.inset;

/** Outer face of the west wall, where the trench's retaining walls butt against it. */
const PARKING_WALL_WEST_FACE = -(PARKING_WALL_X + half(PARKING_DECK_SPEC.wall.thickness));

/** The two reveals either side of the exit mouth, mirrored about it. */
const PARKING_EXIT_JAMB_Z = midpoint(PARKING_EXIT_WALL_GAP, half(PARKING_FOOTPRINT.depth));
const PARKING_EXIT_JAMB_DEPTH = span(PARKING_EXIT_WALL_GAP, half(PARKING_FOOTPRINT.depth));

/**
 * Underside of the lintel over the exit mouth. Measured at the wall's outer face,
 * the highest point of the ramp under the panel, so the headroom holds across it.
 */
const PARKING_EXIT_HEAD_Y = parkingExitRampY(PARKING_WALL_WEST_FACE) + PARKING_EXIT_HEADROOM;

export type ParkingWallPanel = Readonly<{
	id: string;
	center: Vec2;
	size: Readonly<{ width: number; depth: number }>;
	/** Underside of the panel. Only the lintel over the exit mouth starts above the deck. */
	base: number;
}>;

/**
 * The deck's perimeter. The east elevation used to carry two segments with seven
 * metres of nothing between them, which was a hole straight out of the world at
 * basement level; only the exit mouth is an opening, and even that is capped by a
 * lintel above the ramp's headroom.
 */
export const PARKING_WALL_PANELS: readonly ParkingWallPanel[] = [
	{
		id: 'north',
		center: { x: 0, z: -PARKING_WALL_Z },
		size: { width: PARKING_FOOTPRINT.width, depth: PARKING_DECK_SPEC.wall.thickness },
		base: PARKING_DECK_Y,
	},
	{
		id: 'south',
		center: { x: 0, z: PARKING_WALL_Z },
		size: { width: PARKING_FOOTPRINT.width, depth: PARKING_DECK_SPEC.wall.thickness },
		base: PARKING_DECK_Y,
	},
	{
		id: 'east',
		center: { x: PARKING_WALL_X, z: 0 },
		size: { width: PARKING_DECK_SPEC.wall.thickness, depth: PARKING_FOOTPRINT.depth },
		base: PARKING_DECK_Y,
	},
	{
		id: 'west-north',
		center: { x: -PARKING_WALL_X, z: -PARKING_EXIT_JAMB_Z },
		size: { width: PARKING_DECK_SPEC.wall.thickness, depth: PARKING_EXIT_JAMB_DEPTH },
		base: PARKING_DECK_Y,
	},
	{
		id: 'west-south',
		center: { x: -PARKING_WALL_X, z: PARKING_EXIT_JAMB_Z },
		size: { width: PARKING_DECK_SPEC.wall.thickness, depth: PARKING_EXIT_JAMB_DEPTH },
		base: PARKING_DECK_Y,
	},
	{
		id: 'west-head',
		center: { x: -PARKING_WALL_X, z: PARKING_EXIT_RAMP.start.z },
		size: {
			width: PARKING_DECK_SPEC.wall.thickness,
			depth: span(-PARKING_EXIT_WALL_GAP, PARKING_EXIT_WALL_GAP),
		},
		base: PARKING_EXIT_HEAD_Y,
	},
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

/**
 * The trench the exit ramp lies in, between the deck and the street.
 *
 * Below street level the world outside the parking box has no geometry at all, and
 * the city's ground plane is a single-sided plate seen from underneath here, so
 * looking west out of P1 gave cars and towers floating on the sky colour. These two
 * retaining walls flank the whole ramp and close it.
 */
export const PARKING_EXIT_TRENCH = {
	id: 'parking-exit-trench',
	label: 'Parking exit trench',
	/** Bottom: the deck, so the wedge under the rising slab is closed too. */
	baseY: PARKING_DECK_Y,
	/** Where the facade passes overhead and the ground-floor slab becomes the trench's roof. */
	coverX: ENTRANCE_PORTAL.outerX,
	/** Top of the open stretch: level with the street end of the ramp. */
	skyTopY: PARKING_EXIT_RAMP.end.y,
	/** Top of the covered stretch: the underside of the slab above it. */
	coveredTopY: MALL_SLAB_SPECS.v0.topY - MALL_SLAB_SPECS.v0.thickness,
	minX: PARKING_EXIT_RAMP.end.x,
	maxX: PARKING_WALL_WEST_FACE,
} as const;

/**
 * How far a retaining wall laps the parking box to reach its west face. The wall
 * panels sit inset from the footprint edge, so the last 25 mm of the lap runs
 * inside the ceiling slab; every trench volume declares that as its penetration.
 */
const PARKING_EXIT_TRENCH_LAP: Penetration = {
	depth: span(-half(PARKING_FOOTPRINT.width), PARKING_EXIT_TRENCH.maxX),
	into: ['structure'],
};

export type ParkingTrenchWall = Readonly<{
	id: string;
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	topY: number;
	/** Nothing overhead here, so this stretch is also the kerb that keeps you out of the trench. */
	openToSky: boolean;
}>;

/**
 * Two stretches per side, filling what is left between the ramp's guard rail and
 * the jamb of the mouth it runs out through. The covered stretch stops under the
 * ground-floor slab; carried on to street level it would stand inside the facade.
 */
export const PARKING_EXIT_TRENCH_WALLS: readonly ParkingTrenchWall[] = ([-1, 1] as const).flatMap((sign) => {
	const kant = sign < 0 ? 'north' : 'south';
	const minZ = sign < 0 ? -PARKING_EXIT_WALL_GAP : PARKING_EXIT_RAIL_OUTER;
	const maxZ = sign < 0 ? -PARKING_EXIT_RAIL_OUTER : PARKING_EXIT_WALL_GAP;
	return [
		{
			id: `retaining-${kant}-open`,
			minX: PARKING_EXIT_TRENCH.minX,
			maxX: PARKING_EXIT_TRENCH.coverX,
			minZ,
			maxZ,
			topY: PARKING_EXIT_TRENCH.skyTopY,
			openToSky: true,
		},
		{
			id: `retaining-${kant}-covered`,
			minX: PARKING_EXIT_TRENCH.coverX,
			maxX: PARKING_EXIT_TRENCH.maxX,
			minZ,
			maxZ,
			topY: PARKING_EXIT_TRENCH.coveredTopY,
			openToSky: false,
		},
	];
});

/**
 * De kop over het overdekte deel van de geul.
 *
 * Het parkeerdak ligt 0,95 m onder de begane-grondplaat, dus tussen die twee loopt
 * een holle laag over de hele voetafdruk. De geul kwam daar met zijn volle hoogte in
 * uit: vanaf de helling keek je onder de vloer door de mall in, tweeënzeventig meter
 * ver, met alleen de keermuren opzij. Deze kop vult de geul van het parkeerdak tot de
 * plaat, tussen de keermuren, en laat de doorrijhoogte onder zich vrij: bij de mond
 * ligt de hellinglijn plus `PARKING_EXIT_HEADROOM` nog onder het parkeerdak.
 */
export const PARKING_EXIT_TRENCH_HEAD: Bounds3 = {
	minX: PARKING_EXIT_TRENCH.coverX,
	maxX: PARKING_EXIT_TRENCH.maxX,
	minY: PARKING_CEILING_TOP_Y,
	maxY: PARKING_EXIT_TRENCH.coveredTopY,
	minZ: -PARKING_EXIT_RAIL_OUTER,
	maxZ: PARKING_EXIT_RAIL_OUTER,
};

export const PARKING_EXIT_TRENCH_ENTITY: MallWorldEntity = {
	id: PARKING_EXIT_TRENCH.id,
	label: PARKING_EXIT_TRENCH.label,
	category: 'parking',
	levels: ['p1', 'v0'],
	transform: {
		position: {
			x: midpoint(PARKING_EXIT_TRENCH.minX, PARKING_EXIT_TRENCH.maxX),
			y: PARKING_EXIT_TRENCH.baseY,
			z: PARKING_EXIT_RAMP.start.z,
		},
		rotation: ZERO_ROTATION,
	},
	// De vergunning gaat mee met de muur die hem gebruikt. De twee open stukken
	// stoppen bij de gevel en lappen dus niets: een vergunning die nergens in snijdt
	// is precies wat `unused-penetration` afkeurt. Zij verklaren in plaats daarvan
	// hoe ver ze buiten de gevel liggen, en de twee overdekte stukken andersom.
	volumes: [
		...PARKING_EXIT_TRENCH_WALLS.map((wall) => {
			const prism = solidPrism(
				wall.id,
				rectangle(
					midpoint(wall.minX, wall.maxX),
					midpoint(wall.minZ, wall.maxZ),
					span(wall.minX, wall.maxX),
					span(wall.minZ, wall.maxZ),
				),
				PARKING_EXIT_TRENCH.baseY,
				wall.topY,
			);
			const laps = wall.maxX - -half(PARKING_FOOTPRINT.width) > PROTRUSION_MARGIN;
			return {
				...prism,
				...(laps ? { penetration: PARKING_EXIT_TRENCH_LAP } : {}),
				...(MALL_WALL_ENVELOPE.minX - wall.minX > PROTRUSION_MARGIN ? { protrusion: PARKING_EXIT_PROTRUSION } : {}),
			};
		}),
		solidPrism(
			'trench-head',
			rectangle(
				midpoint(PARKING_EXIT_TRENCH_HEAD.minX, PARKING_EXIT_TRENCH_HEAD.maxX),
				midpoint(PARKING_EXIT_TRENCH_HEAD.minZ, PARKING_EXIT_TRENCH_HEAD.maxZ),
				span(PARKING_EXIT_TRENCH_HEAD.minX, PARKING_EXIT_TRENCH_HEAD.maxX),
				span(PARKING_EXIT_TRENCH_HEAD.minZ, PARKING_EXIT_TRENCH_HEAD.maxZ),
			),
			PARKING_EXIT_TRENCH_HEAD.minY,
			PARKING_EXIT_TRENCH_HEAD.maxY,
		),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	// Geen kaartlabel: de plattegrond tekent de uitrit zelf al, en twee keermuren
	// erlangs zijn diezelfde rijbaan nog een keer.
	map: map('parking', undefined, 41),
	tags: ['parking', 'parking-exit', 'structural'],
};

/**
 * The trench walls as colliders, only where the trench is open to the sky. Under
 * the ground-floor slab nothing can fall in, and a box there would be an invisible
 * wall standing inside the building.
 */
export function parkingExitTrenchColliders(): readonly WorldCollider[] {
	return PARKING_EXIT_TRENCH_WALLS.filter((wall) => wall.openToSky).map((wall) => ({
		minX: wall.minX,
		maxX: wall.maxX,
		minY: PARKING_EXIT_TRENCH.baseY,
		maxY: wall.topY,
		minZ: wall.minZ,
		maxZ: wall.maxZ,
		label: `parking_${wall.id}`,
	}));
}

/** The mall's underside. Cut for the elevator, which travels straight through it. */
export const PARKING_CEILING_SPEC = {
	plan: PARKING_FOOTPRINT_PLAN,
	holes: [P1_ELEVATOR_PLAN],
	thickness: PARKING_DECK_SPEC.ceiling.thickness,
	topY: PARKING_CEILING_TOP_Y,
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
		/** Vaart langs de bocht, in m/s. */
		speed: 8,
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
/** Het hart van de klimkoker: waar de ladder op de plaat uitkomt. */
export const SLIDE_LADDER_X = midpoint(SLIDE_LADDER_CLIMB.minX, SLIDE_LADDER_CLIMB.maxX);

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

type SlideSegment = Readonly<{ id: string; start: Vec3; end: Vec3 }>;

/** De buis in stukken: één doos om de hele bocht zou het halve dek beslaan. */
function slideSegments(): readonly SlideSegment[] {
	const { path } = SLIDE_TOWER_SPEC.tube;
	const segments: SlideSegment[] = [];
	for (let index = 1; index < path.length; index++) {
		const start = path[index - 1];
		const end = path[index];
		if (!start || !end) continue;
		segments.push({ id: `tube-${index}`, start, end });
	}
	return segments;
}

function slideTubeVolumes(): readonly SpatialVolume[] {
	const { tube } = SLIDE_TOWER_SPEC;
	return slideSegments().map((segment) => ({
		id: segment.id,
		role: 'walkable',
		geometry: { kind: 'ramp', start: segment.start, end: segment.end, width: tube.radius * 2, thickness: tube.radius },
		blocksMovement: false,
		clearance: { kind: 'clear' },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: ['slide', 'travel-surface', 'authored-geometry'],
	}));
}

/** De vaart die een buisdeel meegeeft: zijn eigen koers, op de snelheid van de buis. */
function slideDrift(segment: SlideSegment): Vec3 {
	const { speed } = SLIDE_TOWER_SPEC.tube;
	const dx = segment.end.x - segment.start.x;
	const dy = segment.end.y - segment.start.y;
	const dz = segment.end.z - segment.start.z;
	const run = Math.hypot(dx, dy, dz);
	return { x: (dx / run) * speed, y: (dy / run) * speed, z: (dz / run) * speed };
}

/**
 * De buis draagt je zoals de roltraptreden dat doen: per stuk één stroming over het
 * loopvlak van dat stuk, zodat wie erin stapt de bocht volgt in plaats van eruit te
 * vallen.
 */
function slideConveyors(): readonly InteractionEmitter[] {
	return slideSegments().map((segment) => ({
		id: `${segment.id}-flow`,
		channel: 'conveyor',
		field: { kind: 'surface', vector: slideDrift(segment), space: 'world' },
		sourceVolumeId: segment.id,
		falloff: { kind: 'none' },
		timing: { kind: 'continuous' },
		targets: {
			mobility: ['character', 'dynamic', 'kinematic'],
			requireTags: ['grounded'],
			excludeTags: ['anchored'],
			requireChannels: ['conveyor'],
		},
		occlusion: { mode: 'none', blockingTags: [] },
	}));
}

/** De mond van de buis, waar hij aan het platform begint. */
const SLIDE_MOUTH = SLIDE_TOWER_SPEC.tube.path[0];

/**
 * Het instappunt: de mond plus de strook platform ervoor, tot boven een staand
 * lichaam. Wie hier staat wordt door de buis meegenomen; dat is de enige manier
 * erin, en hij ligt daarom op de plaat waar de ladder op uitkomt.
 */
const SLIDE_ENTRY_VOLUME: SpatialVolume = {
	id: 'entry',
	role: 'trigger',
	geometry: {
		kind: 'prism',
		plan: rectangle(SLIDE_MOUTH.x, SLIDE_MOUTH.z, SLIDE_TOWER_SPEC.tube.radius * 2, SLIDE_TOWER_SPEC.tube.radius * 2),
		minY: SLIDE_MOUTH.y - SLIDE_TOWER_SPEC.tube.radius,
		maxY: SLIDE_PLATFORM_TOP_Y + STANDING_PEDESTRIAN.bodyHeight,
		holes: [],
	},
	blocksMovement: false,
	clearance: { kind: 'clear' },
	allowsOverlapFrom: STRUCTURAL_OVERLAP,
	tags: ['trigger', 'slide-entry'],
};

export const ROOF_SLIDE_ENTITY: MallWorldEntity = {
	...roomEntity({
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
			SLIDE_ENTRY_VOLUME,
			...slideTubeVolumes(),
		],
		map: map('fixture', ROOF_SLIDE_LABEL, 67),
		tags: ['roof-island', 'slide', 'static'],
	}),
	emitters: slideConveyors(),
};

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
				panel.base,
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
	],
	map: map('parking', parkingStore.name, 45),
	tags: ['parking', 'shell', 'structural'],
});

/** Wat er op het hokje staat, en wat de plattegrond ervan noemt. */
export const PARKING_BOOTH_LABEL = 'P · TICKETS';

/**
 * Het kaartjeshokje op P1. Het was een volume van de schil, dus het deelde het
 * kaartlabel van het hele dek en stond naamloos op de plattegrond: een blokje in
 * de oosthoek waar de speler niets van kon maken.
 */
export const PARKING_BOOTH_ENTITY: MallWorldEntity = roomEntity({
	id: 'parking-booth',
	label: 'Parking ticket booth',
	category: 'facility',
	level: 'p1',
	center: PARKING_DECK_SPEC.booth.center,
	placementClass: 'fixture',
	volumes: [
		solidPrism(
			'booth',
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
	map: map('fixture', PARKING_BOOTH_LABEL, 44),
	tags: ['parking', 'booth', 'static'],
});

/** De vakken naast het middenpad: de belijning, de nummers en de plattegrond lezen dezelfde rasterstap. */
export const PARKING_BAY_SPEC = {
	rowZ: [-14, 14],
	columns: 5,
	spacing: 5.2,
	stall: { width: 2.4, depth: 4.8 },
	paintY: PAINT_LIFT,
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

/** Het middenpad ligt tussen de twee vakkenrijen; daar liggen de pijlen. */
const PARKING_AISLE_Z = midpoint(PARKING_BAY_SPEC.rowZ[0], PARKING_BAY_SPEC.rowZ[1]);

/** Hart van elke pijl op het middenpad, van west naar oost. */
function parkingAisleArrowX(): readonly number[] {
	const { aisle } = PARKING_BAY_SPEC;
	const centers: number[] = [];
	for (let index = -aisle.arrows; index <= aisle.arrows; index++) centers.push(index * aisle.spacing);
	return centers;
}

/** Speling tussen de verf en een kolomvoet. Nul laat de streep tegen het beton eindigen. */
const PARKING_PAINT_CLEARANCE = 0.05;

/** Onder deze maat is een overgebleven stuk geen markering meer maar een veeg; dat blijft ongeschilderd. */
const PARKING_PAINT_MIN_SIDE = 0.3;

/** De voet van elke kolom plus de speling die de verf eromheen houdt. */
export function parkingPillarFootprints(): readonly Bounds2[] {
	const reach = half(PARKING_DECK_SPEC.pillar.width) + PARKING_PAINT_CLEARANCE;
	return parkingPillarCenters().map((center) => ({
		minX: center.x - reach,
		maxX: center.x + reach,
		minZ: center.z - reach,
		maxZ: center.z + reach,
	}));
}

/** Wat er van `vlak` overblijft als `gat` eruit gesneden is: nul tot vier rechthoeken. */
function planMinusHole(vlak: Bounds2, gat: Bounds2): Bounds2[] {
	const minX = Math.max(vlak.minX, gat.minX);
	const maxX = Math.min(vlak.maxX, gat.maxX);
	return [
		{ ...vlak, maxX: Math.min(vlak.maxX, gat.minX) },
		{ ...vlak, minX: Math.max(vlak.minX, gat.maxX) },
		{ minX, maxX, minZ: vlak.minZ, maxZ: Math.min(vlak.maxZ, gat.minZ) },
		{ minX, maxX, minZ: Math.max(vlak.minZ, gat.maxZ), maxZ: vlak.maxZ },
	].filter((stuk) => span(stuk.minX, stuk.maxX) > 0 && span(stuk.minZ, stuk.maxZ) > 0);
}

export type ParkingPaintPatch = Readonly<{
	id: string;
	kind: 'bay' | 'lane';
	center: Vec2;
	width: number;
	depth: number;
}>;

function paintAround(id: string, kind: ParkingPaintPatch['kind'], vlak: Bounds2, gaten: readonly Bounds2[]): ParkingPaintPatch[] {
	let stukken: Bounds2[] = [vlak];
	for (const gat of gaten) stukken = stukken.flatMap((stuk) => planMinusHole(stuk, gat));
	return stukken
		.filter(
			(stuk) => span(stuk.minX, stuk.maxX) >= PARKING_PAINT_MIN_SIDE && span(stuk.minZ, stuk.maxZ) >= PARKING_PAINT_MIN_SIDE,
		)
		.map((stuk, index) => ({
			id: `${id}-${index + 1}`,
			kind,
			center: { x: midpoint(stuk.minX, stuk.maxX), z: midpoint(stuk.minZ, stuk.maxZ) },
			width: span(stuk.minX, stuk.maxX),
			depth: span(stuk.minZ, stuk.maxZ),
		}));
}

/**
 * Alles wat er op het dek geschilderd staat, al om de kolomvoeten heen geknipt: de
 * vakken naast het middenpad en de pijlen op het pad zelf.
 *
 * De vakken lopen in stappen van 5,2 m, de pijlen in stappen van 6 m en de kolommen
 * in stappen van 8 m, dus zes vakken en drie pijlen liepen dwars door een kolom heen.
 * Verf mag onder een constructie door lopen; er dwars doorheen is een streep die in
 * het beton verdwijnt. Wat er van een pijl overblijft is te klein om er nog een pijl
 * van te maken, dus daar staat er geen.
 */
export function parkingPaintPatches(): readonly ParkingPaintPatch[] {
	const gaten = parkingPillarFootprints();
	const { stall, aisle } = PARKING_BAY_SPEC;
	return [
		...parkingStalls().flatMap((vak) =>
			paintAround(`stall-${vak.id}`, 'bay', planBounds(rectangle(vak.center.x, vak.center.z, stall.width, stall.depth)), gaten),
		),
		...parkingAisleArrowX().flatMap((x, index) =>
			paintAround(`aisle-${index + 1}`, 'lane', planBounds(rectangle(x, PARKING_AISLE_Z, aisle.width, aisle.depth)), gaten),
		),
	];
}

/** Decoratieve auto's. De huurauto's van de speler staan hieronder en houden hun eigen plekken vrij. */
export const PARKED_CAR_SPEC = {
	body: { width: 1.9, length: 4, height: 0.45, centerY: 0.45 },
	cabin: { width: 1.7, length: 2, height: 0.4, centerY: 0.85, offsetZ: -0.15 },
	wheel: { radius: 0.28, width: 0.22, offsetX: 0.85, offsetZ: 1.2 },
	/**
	 * De banden staan met hun onderkant op deze hoogte. Dat was 12 cm, en daarmee stond
	 * elke decorauto een handbreedte boven het dek te zweven; de belijning lag er met
	 * 14 cm nét bovenop en dekte het toe. Nu raken ze allebei het beton.
	 */
	standY: 0,
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
	volumes: parkingPaintPatches().map((patch) =>
		solidPrism(
			patch.id,
			rectangle(patch.center.x, patch.center.z, patch.width, patch.depth),
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

// ── motoren ────────────────────────────────────────────────────────────────

/**
 * Eén motor, en overal dezelfde.
 *
 * Hij staat in de vakken op P1, als showmodel in de hal van de hoofdingang, hij
 * rijdt mee op de ringweg en er staat er één die de speler wegrijdt. Vier bouwers
 * dus, en die lezen allemaal deze maten: de rijstrookbreedte, de volgafstand van
 * het verkeer en de doos waar `controleParkeerplekken` mee rekent hangen er alle
 * drie aan.
 */
export const MOTORCYCLE_SPEC = {
	body: { width: 0.72, length: 2.1, height: 0.34, centerY: 0.66 },
	seat: { width: 0.36, length: 0.7, height: 0.14, centerY: 0.9, offsetZ: -0.3 },
	wheel: { radius: 0.32, width: 0.14, offsetZ: 0.78 },
	bars: { width: 0.74, thickness: 0.06, centerY: 1.06, offsetZ: 0.5 },
	headlight: { radius: 0.12, centerY: 0.92, offsetZ: 0.82 },
	/** De banden raken hiermee het loopvlak waar hij op staat. */
	standY: 0,
} as const;

/** Hoogste punt van een stilstaande motor boven zijn loopvlak: het stuur. */
export const MOTORCYCLE_HEIGHT = MOTORCYCLE_SPEC.bars.centerY + half(MOTORCYCLE_SPEC.bars.thickness);

/** Waar een motor staat. De hoogte staat erbij omdat ze op drie verschillende vlakken staan. */
export type MotorcycleSpot = Readonly<{ x: number; y: number; z: number; yaw: number }>;

/**
 * Motoren in de vakken op P1.
 *
 * Ze delen de vakken met de auto's en staan daarom in de drie vakken die geen auto
 * en geen kolom hebben: A11, B1 en B4. Drie naast elkaar in een vak van 2,4 m past,
 * want een motor is 0,72 m breed; `controleParkeerplekken` rekent dat na tegen de
 * kolommen zoals hij dat voor de auto's doet.
 */
const P1_MOTORCYCLE_ROW_PITCH = 0.8;

function p1MotorcycleRow(centerX: number, z: number, yaw: number): readonly MotorcycleSpot[] {
	return [-1, 0, 1].map((slot) => ({
		x: centerX + slot * P1_MOTORCYCLE_ROW_PITCH,
		y: PARKING_DECK_Y + MOTORCYCLE_SPEC.standY,
		z,
		yaw,
	}));
}

export const PARKED_MOTORCYCLE_SPOTS: readonly MotorcycleSpot[] = [
	...p1MotorcycleRow(26, -14, 0),
	...p1MotorcycleRow(-26, 14, Math.PI),
];

/**
 * De twee showmotoren in de hal van de hoofdingang, met hun achterwiel tegen de
 * noordrand van de hardstenen vloer en hun neus de hal in.
 *
 * Ze staan naast elkaar aan één kant en niet aan weerszijden van de loper, want de
 * zuidkant van de hal is de puistrook van de toiletten: daar neergezet stond de
 * tweede in `restrooms.frontage` en weigerde `validateSpatialWorld` de wereld.
 */
const ENTRANCE_MOTORCYCLE_X = ENTRANCE_PORTAL.innerX + half(ENTRANCE_SPEC.hall.depth);
/** Hart-op-hart van de twee, en hoe ver de noordelijke van de rand van de vloer blijft. */
const ENTRANCE_MOTORCYCLE_PITCH = 1;
const ENTRANCE_MOTORCYCLE_MARGIN = 0.1;
/**
 * Een kwartslag, zodat de neus de diepte van de hal in wijst.
 *
 * De mesh-neus is lokaal +z en de hal loopt in x, dus op yaw 0 stonden ze dwars: je
 * keek er vanaf de deuren tegen de flank van aan en ze wezen de puistrook van de
 * toiletten in. De plattegrondrechthoek draait mee, want die leest dezelfde yaw.
 */
const ENTRANCE_MOTORCYCLE_YAW = half(Math.PI);
/** De noordelijke van de twee; de tweede staat er een steek naast. */
const ENTRANCE_MOTORCYCLE_FIRST_Z = ENTRANCE_PORTAL.minZ + half(MOTORCYCLE_SPEC.body.width) + ENTRANCE_MOTORCYCLE_MARGIN;

export const ENTRANCE_MOTORCYCLE_SPOTS: readonly MotorcycleSpot[] = [0, 1].map((slot) => ({
	x: ENTRANCE_MOTORCYCLE_X,
	y: V0_Y + ENTRANCE_SPEC.hall.thickness + MOTORCYCLE_SPEC.standY,
	z: ENTRANCE_MOTORCYCLE_FIRST_Z + slot * ENTRANCE_MOTORCYCLE_PITCH,
	yaw: ENTRANCE_MOTORCYCLE_YAW,
}));

function motorcycleVolume(spot: MotorcycleSpot, index: number): SpatialVolume {
	return solidPrism(
		`motorcycle-${index + 1}`,
		rectangle(spot.x, spot.z, MOTORCYCLE_SPEC.body.width, MOTORCYCLE_SPEC.body.length, spot.yaw),
		spot.y,
		spot.y + MOTORCYCLE_HEIGHT,
		[],
		'solid',
		false,
	);
}

export const PARKED_MOTORCYCLES_ENTITY: MallWorldEntity = roomEntity({
	id: 'parking-motorcycles',
	label: 'Parked motorcycles',
	category: 'parking',
	level: 'p1',
	center: { x: 0, z: 0 },
	placementClass: 'clutter',
	volumes: PARKED_MOTORCYCLE_SPOTS.map(motorcycleVolume),
	map: map('clutter', 'MOTOREN', 44),
	tags: ['parking', 'motorcycles', 'static'],
});

export const ENTRANCE_MOTORCYCLES_ENTITY: MallWorldEntity = roomEntity({
	id: 'entrance-motorcycles',
	label: 'Show motorcycles in the entrance hall',
	category: 'prop',
	level: 'v0',
	center: { x: ENTRANCE_MOTORCYCLE_X, z: ENTRANCE_MOTORCYCLE_FIRST_Z + half(ENTRANCE_MOTORCYCLE_PITCH) },
	placementClass: 'clutter',
	volumes: ENTRANCE_MOTORCYCLE_SPOTS.map(motorcycleVolume),
	map: map('clutter', 'SHOWMOTOREN', 40),
	tags: ['prop', 'motorcycles', 'static'],
});

// ── wat de speler wegrijdt ─────────────────────────────────────────────────

export type DriveableKind = 'car' | 'motorcycle';

/**
 * Hoe een bestuurbaar voertuig rijdt.
 *
 * Dit stond als losse constanten bovenin `DriveableCars`, en daarmee reed alles wat
 * die klasse uitdeelt per definitie even hard: een tweede soort erbij kon alleen
 * door de rijlus te kopiëren. Nu staat het gedrag naast de plekken en leest de
 * runtime het per exemplaar op.
 */
export type DriveableHandling = Readonly<{
	/** Botsstraal rond het hart. */
	radius: number;
	maxSpeed: number;
	boostSpeed: number;
	accel: number;
	brake: number;
	/** Uitrollen zonder gas (m/s²). */
	friction: number;
	turnRate: number;
	/** Waarover de helling onder het voertuig gemeten wordt: van as tot as. */
	wheelbase: number;
	/** Ooghoogte boven het wegdek, en hoever de stoel achter het hart staat. */
	seatHeight: number;
	seatBack: number;
	/** Rol per eenheid stuur maal snelheid, en hoever hij daarmee mag hangen. */
	leanPerSteerSpeed: number;
	maxLean: number;
}>;

export const DRIVEABLE_HANDLING: Readonly<Record<DriveableKind, DriveableHandling>> = {
	car: {
		radius: 1.35,
		maxSpeed: 18,
		boostSpeed: 28,
		accel: 14,
		brake: 22,
		friction: 5,
		turnRate: 1.85,
		wheelbase: 2.5,
		seatHeight: 1.15,
		seatBack: 0.15,
		leanPerSteerSpeed: 0.012,
		maxLean: 0.12,
	},
	motorcycle: {
		radius: half(MOTORCYCLE_SPEC.body.length),
		maxSpeed: 26,
		boostSpeed: 38,
		accel: 20,
		brake: 24,
		friction: 4,
		turnRate: 2.4,
		wheelbase: MOTORCYCLE_SPEC.wheel.offsetZ * 2,
		seatHeight: MOTORCYCLE_SPEC.seat.centerY + half(MOTORCYCLE_SPEC.seat.height),
		seatBack: -MOTORCYCLE_SPEC.seat.offsetZ,
		leanPerSteerSpeed: 0.022,
		maxLean: 0.55,
	},
};

/** Een voertuig dat op zijn bestuurder staat te wachten. */
export type DriveableSpot = Readonly<{
	kind: DriveableKind;
	x: number;
	y: number;
	z: number;
	yaw: number;
	color: number;
	name: string;
}>;

/** Zo hoog boven het dek zetten de huurauto's hun wielen neer. */
const RENTAL_CAR_LIFT = 0.12;

export const RIDEABLE_MOTORCYCLE_SPOTS: readonly (MotorcycleSpot & Readonly<{ color: number; name: string }>)[] = [
	{ x: -10.4, y: PARKING_DECK_Y + MOTORCYCLE_SPEC.standY, z: 14, yaw: Math.PI, color: 0x212121, name: 'ZWARTE MOTOR' },
];

export const DRIVEABLE_SPOTS: readonly DriveableSpot[] = [
	...RENTAL_CAR_SPOTS.map((spot): DriveableSpot => ({ ...spot, kind: 'car', y: PARKING_DECK_Y + RENTAL_CAR_LIFT })),
	...RIDEABLE_MOTORCYCLE_SPOTS.map((spot): DriveableSpot => ({ ...spot, kind: 'motorcycle' })),
];

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
 * The deck's blocking volumes that stand on the floor, as AABBs. Read off the
 * entities so the walls, pillars and booth the plan draws are the ones you bump
 * into. The lintel over the exit mouth starts above the deck and is skipped: it
 * hangs over the ramp with the full headroom under it.
 */
export function parkingDeckColliders(): readonly WorldCollider[] {
	return [PARKING_DECK_ENTITY, PARKING_BOOTH_ENTITY].flatMap((entity) =>
		entity.volumes.flatMap((volume) => {
			if (!volume.blocksMovement) return [];
			const bounds = geometryBounds(volume.geometry);
			if (bounds.minY > PARKING_DECK_Y) return [];
			return [{ ...bounds, label: `parking_${volume.id}` }];
		}),
	);
}

// ── slagbomen ──────────────────────────────────────────────────────────────

/**
 * De slagbomen, met op elke boom wie eronderdoor mag.
 *
 * De arm van de uitritgeul en die van de stadsgarage stonden allebei in hun eigen
 * scene-bestand, met hun eigen maten en hun eigen bedenktijd, en geen van beide
 * hield iets tegen: je reed er dwars doorheen. Wie erlangs mag is een beleid en
 * geen voertuigtype, dus het staat hier naast de arm die het uitvoert, zoals
 * `carriesTargets` naast de lift staat. De runtime leest het en beslist niets zelf.
 */
export type BarrierSpec = Readonly<{
	id: string;
	label: string;
	/** Voet van de paal, op het loopvlak waar hij op staat. */
	post: Vec3;
	/** Langs welke kant van z de arm ligt: +1 naar oplopende z, −1 andersom. */
	armSide: 1 | -1;
	/** Van het hart van de paal tot de punt van de arm. */
	armLength: number;
	/** Langs welke kant van x een voertuig komt aanrijden. */
	approachSide: 1 | -1;
	/** Vanaf deze afstand vóór de arm ziet hij een voertuig aankomen. */
	sight: number;
	admits: readonly TrafficClass[];
}>;

/** De stalen delen die elke boom deelt. Twee bomen, één maatvoering. */
export const BARRIER_HARDWARE = {
	post: { radius: 0.11, height: 1.05 },
	/** Hoogte van het scharnier boven het loopvlak. */
	pivotY: 1.02,
	arm: { thickness: 0.14, sleeves: 3, sleeveLength: 0.5 },
	/** Standen per seconde van dicht naar open. */
	speed: 0.8,
	/** Onder deze stand hangt de arm nog in de doorgang. */
	clearFraction: 0.9,
} as const;

/** Vrije ruimte tussen de rijstrook en de paal. */
const BARRIER_POST_CLEARANCE = 0.35;

/** Hoe ver west van de mond van de geul de boom van de uitrit staat. */
const PARKING_EXIT_BOOM_SETBACK = 1;

const PARKING_EXIT_BOOM_POST_Z = PARKING_EXIT_RAIL_OUTER + BARRIER_POST_CLEARANCE;

/** Vanaf hier ziet een boom een voertuig aankomen. */
const BARRIER_SIGHT = 10;

export const BARRIER_SPECS: readonly BarrierSpec[] = [
	{
		id: 'parking-exit-boom',
		label: 'Parking exit barrier',
		post: {
			x: PARKING_EXIT_TRENCH.minX - PARKING_EXIT_BOOM_SETBACK,
			y: parkingExitRampY(PARKING_EXIT_TRENCH.minX),
			z: PARKING_EXIT_BOOM_POST_Z,
		},
		armSide: -1,
		// Tot de hartlijn van de geul: wie naar binnen wil staat ervoor, wie naar
		// buiten komt rijdt er langs.
		armLength: PARKING_EXIT_BOOM_POST_Z,
		approachSide: -1,
		sight: BARRIER_SIGHT,
		// De huurauto's van P1 komen hier hun eigen garage uit, dus die mogen erdoor.
		admits: ['npc-traffic', 'player-vehicle'],
	},
	{
		id: 'city-garage-boom',
		label: 'City garage barrier',
		post: { x: 56.9, y: V0_Y, z: 50.4 },
		armSide: 1,
		armLength: 3.6,
		approachSide: -1,
		sight: BARRIER_SIGHT,
		// Je trekt een kaartje bij de automaat naast de paal en de arm gaat omhoog.
		// Hij liet hier `npc-traffic` toe en er rijdt geen enkele sim de stadsgarage
		// in, dus dat was een vergunning voor niemand: een poort die er precies zo
		// uitziet als een werkende en nooit opengaat.
		admits: ['player-vehicle'],
	},
];

/** De hoek waarover de arm kantelt. Hij ligt langs `armSide`, dus die kant bepaalt het teken. */
export function barrierOpenAngle(spec: BarrierSpec): number {
	return -spec.armSide * half(Math.PI);
}

/** De z-strook die de arm bestrijkt, van de paal tot zijn punt. */
function barrierArmBand(spec: BarrierSpec): Bounds2 {
	const tip = spec.post.z + spec.armSide * spec.armLength;
	return {
		minX: spec.post.x - half(BARRIER_HARDWARE.arm.thickness),
		maxX: spec.post.x + half(BARRIER_HARDWARE.arm.thickness),
		minZ: Math.min(spec.post.z, tip),
		maxZ: Math.max(spec.post.z, tip),
	};
}

/** Bovenkant van de arm als hij ligt. */
function barrierArmTopY(spec: BarrierSpec): number {
	return spec.post.y + BARRIER_HARDWARE.pivotY + half(BARRIER_HARDWARE.arm.thickness);
}

/**
 * De doorgang die de liggende arm afsluit.
 *
 * Niet het staal maar de ruimte eronder: de arm zelf is veertien centimeter dik op
 * een meter hoogte, en een doos van die maat wordt door de hoogtefilter van
 * `resolveCircle` overgeslagen voor precies het voertuig dat hij hoort te stuiten.
 * Van het loopvlak tot de bovenkant van de arm is wat je niet kunt kruisen zolang
 * hij ligt.
 */
export function barrierGateCollider(spec: BarrierSpec): WorldCollider {
	return { ...barrierArmBand(spec), minY: spec.post.y, maxY: barrierArmTopY(spec), label: `barrier_${spec.id}` };
}

/** Waar een voertuig vandaan komt: de aanloopstrook vóór de arm, plus de lengte van een auto erachter. */
export function barrierApproachBounds(spec: BarrierSpec): Bounds2 {
	const band = barrierArmBand(spec);
	const near = spec.post.x + spec.approachSide * spec.sight;
	const far = spec.post.x - spec.approachSide * RENTAL_CAR_SPEC.body.length;
	return { minX: Math.min(near, far), maxX: Math.max(near, far), minZ: band.minZ, maxZ: band.maxZ };
}

function barrierEntity(spec: BarrierSpec): MallWorldEntity {
	const band = barrierArmBand(spec);
	const approach = barrierApproachBounds(spec);
	const mechanismId = `${spec.id}-arm`;
	const armPlan = rectangle(spec.post.x, midpoint(band.minZ, band.maxZ), span(band.minX, band.maxX), span(band.minZ, band.maxZ));
	return {
		id: spec.id,
		label: spec.label,
		category: 'facility',
		levels: ['v0'],
		transform: { position: spec.post, rotation: ZERO_ROTATION },
		volumes: [
			uprightCylinder(
				'post',
				{ x: spec.post.x, y: spec.post.y + half(BARRIER_HARDWARE.post.height), z: spec.post.z },
				BARRIER_HARDWARE.post.radius,
				BARRIER_HARDWARE.post.height,
				'solid',
				true,
			),
			{
				id: 'arm',
				role: 'solid',
				geometry: {
					kind: 'prism',
					plan: armPlan,
					minY: barrierArmTopY(spec) - BARRIER_HARDWARE.arm.thickness,
					maxY: barrierArmTopY(spec),
					holes: [],
				},
				// De arm houdt zelf niets tegen: het mechanisme hieronder tilt hem weg,
				// en `barrierGateCollider` is de doorgang die dichtvalt als hij ligt.
				blocksMovement: false,
				clearance: { kind: 'automatic-gate', mechanismId },
				allowsOverlapFrom: STRUCTURAL_OVERLAP,
				tags: ['barrier-arm'],
			},
			{
				id: 'approach',
				role: 'trigger',
				geometry: {
					kind: 'prism',
					plan: rectangle(
						midpoint(approach.minX, approach.maxX),
						midpoint(approach.minZ, approach.maxZ),
						span(approach.minX, approach.maxX),
						span(approach.minZ, approach.maxZ),
					),
					minY: spec.post.y,
					maxY: barrierArmTopY(spec),
					holes: [],
				},
				blocksMovement: false,
				clearance: { kind: 'clear' },
				allowsOverlapFrom: STRUCTURAL_OVERLAP,
				tags: ['barrier-approach'],
			},
		],
		ports: NO_PORTS,
		placement: { class: 'fixture', requiresSupport: false, mayCover: [], mayBeCoveredBy: [] },
		kinematics: { kind: 'static' },
		mechanisms: [
			{
				id: mechanismId,
				kind: 'hinged',
				stateId: `${spec.id}-open`,
				movingVolumeIds: ['arm'],
				triggerVolumeId: 'approach',
				openState: { rotationRadians: barrierOpenAngle(spec) },
				openingSeconds: 1 / BARRIER_HARDWARE.speed,
				// Stroom eraf betekent dicht: een boom die openvalt bewaakt niets.
				failSafe: 'closed',
				access: { admits: spec.admits },
			},
		],
		receiver: STATIC_RECEIVER,
		emitters: NO_EMITTERS,
		map: map('fixture', undefined, 40),
		tags: ['barrier', 'traffic'],
	};
}

/**
 * De bomen als entiteiten. Ze staan bewust buiten `WORLD_ENTITIES`: ze horen bij de
 * straat en niet bij het gebouw, en de gevelcontrole meet alles in die lijst tegen
 * de omhullende van de vier wandkasten.
 */
export const BARRIER_ENTITIES: readonly MallWorldEntity[] = BARRIER_SPECS.map(barrierEntity);

export function barrierSpec(id: string): BarrierSpec {
	const found = BARRIER_SPECS.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`no barrier '${id}'`);
	return found;
}

/** Of deze boom voor deze verkeersklasse omhoog gaat. Het beleid staat op de boom, niet in het voertuig. */
export function barrierAdmits(spec: BarrierSpec, traffic: TrafficClass): boolean {
	return spec.admits.includes(traffic);
}

// ── het theater ────────────────────────────────────────────────────────────

/**
 * PRAIRIE THEATRE op het noordoostkavel: zaalblok, portico op een podium, en een
 * brede trap van vier treden vanaf de stoep.
 *
 * De maten stonden in de stadsplattegrond en het blok was massief: één doos, een
 * gevel met deuren erop geschilderd en verder niets. Ze staan hier omdat het
 * gebouw nu een binnenkant heeft, en die binnenkant wordt door vier partijen
 * tegelijk gelezen — de tekenaar, de collision, de zonegraaf en de stoelen.
 *
 * De vloer binnen ligt op `podiumY`, gelijk met het podium buiten, dus de dorpel
 * in de zuidgevel is vlak. Het zaaldek loopt daarvandaan trapsgewijs omláág naar
 * het toneel: wie binnenkomt komt bovenaan binnen, en dat is wat een zaal rakeren
 * betekent.
 */
export const THEATRE_PLAN = {
	/** Buitenvlak van de schil. De wanden staan er aan de binnenkant tegenaan. */
	hall: { minX: 58, maxX: 86, minZ: -70, maxZ: -52 },
	hallHeight: 13,
	wallThickness: 0.5,
	roofThickness: 0.6,
	/** Voet van de schil, onder het maaiveld, zoals elk stadsblok. */
	baseY: -0.5,
	podium: { minX: 57, maxX: 87, minZ: -52, maxZ: -47 },
	podiumY: 1.5,
	/** Treden lopen zuidwaarts omlaag vanaf `zTop`; `rise` blijft onder WALK_STEP. */
	stair: { minX: 62, maxX: 82, zTop: -47, treads: 4, tread: 0.6, rise: 0.3 },
	columns: { x0: 61.5, pitch: 3, count: 8, z: -50.6, radius: 0.6, bottomY: 1.5, topY: 9.6 },
	/**
	 * De travee in de zuidgevel: twee vaste zijlichten met een schuifpaar ertussen,
	 * dezelfde vorm als de hoofdingang van de mall. Het glas is wat de zonegraaf
	 * leest, dus de foyer blijft vanaf de stoep te zien terwijl de deuren dicht zijn.
	 */
	doors: { width: 11, sidelight: 2.75, headY: 5.1, leafHeight: 3.4, thickness: 0.12, seconds: 1.4 },
	/** Aanwezigheidszone van het schuifpaar, gemeten vanaf de gevelvlakken. */
	trigger: { outreach: 2.4, inreach: 1.6, height: 2.4 },
	foyer: { depth: 5, wallThickness: 0.4, doorway: 2.4, kassa: { width: 5, depth: 1, height: 1.15, inset: 1 } },
	stage: { depth: 5, height: 1.28, set: { thickness: 0.3, height: 6.5, margin: 2 } },
	/**
	 * Het zaaldek. `crossBack` is het dwarsgangpad achter de laatste rij, waar je
	 * vanuit de foyer binnenkomt; elke rij zakt er `rise` onder.
	 */
	seating: { rows: 5, pitch: 0.95, rise: 0.22, bankDepth: 0.62, backHeight: 0.95, crossBack: 1, sideMargin: 0.4 },
	/** Twee gangpaden overlangs, elk `offset` uit de as van de zaal. */
	aisle: { width: 1.4, offset: 6 },
	seat: { pitch: 0.55, width: 0.46, seatY: 0.44, backHeight: 0.95, thickness: 0.07 },
} as const;

/** Bovenkant van trede `i`, geteld vanaf de bovenste (die tegen het podium ligt). */
export function theatreTreadY(i: number): number {
	return THEATRE_PLAN.stair.rise * (THEATRE_PLAN.stair.treads - i);
}

/** Z-strook van trede `i`, van boven naar beneden. */
export function theatreTreadZ(i: number): Readonly<{ minZ: number; maxZ: number }> {
	const { zTop, tread } = THEATRE_PLAN.stair;
	return { minZ: zTop + i * tread, maxZ: zTop + (i + 1) * tread };
}

const THEATRE_WALL_T = THEATRE_PLAN.wallThickness;
const THEATRE_CENTER: Vec2 = {
	x: midpoint(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX),
	z: midpoint(THEATRE_PLAN.hall.minZ, THEATRE_PLAN.hall.maxZ),
};
const THEATRE_HALL_WIDTH = span(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX);
const THEATRE_HALL_DEPTH = span(THEATRE_PLAN.hall.minZ, THEATRE_PLAN.hall.maxZ);

/**
 * De hartlijn van de schil: de rechthoek waar de wanden omheen staan.
 *
 * De zonegraaf meet hierop, precies zoals hij op `MALL_FOOTPRINT` meet. Het
 * buitenvlak van de gevel ligt er een halve wanddikte buiten, en dat verschil is
 * wat een dorpel die de gevel doorsnijdt herkenbaar maakt als doorsnijding.
 */
export const THEATRE_ENVELOPE: Bounds2 = {
	minX: THEATRE_PLAN.hall.minX + half(THEATRE_WALL_T),
	maxX: THEATRE_PLAN.hall.maxX - half(THEATRE_WALL_T),
	minZ: THEATRE_PLAN.hall.minZ + half(THEATRE_WALL_T),
	maxZ: THEATRE_PLAN.hall.maxZ - half(THEATRE_WALL_T),
};

/** Het binnenvlak van de schil: hier begint de zaal. */
export const THEATRE_INTERIOR: Bounds2 = {
	minX: THEATRE_PLAN.hall.minX + THEATRE_WALL_T,
	maxX: THEATRE_PLAN.hall.maxX - THEATRE_WALL_T,
	minZ: THEATRE_PLAN.hall.minZ + THEATRE_WALL_T,
	maxZ: THEATRE_PLAN.hall.maxZ - THEATRE_WALL_T,
};

/** De doos waar de zone `theatre` in ligt: de schil, van zijn voet tot zijn dak. */
export const THEATRE_ZONE_VOLUME: Bounds3 = { ...THEATRE_ENVELOPE, minY: THEATRE_PLAN.baseY, maxY: THEATRE_PLAN.hallHeight };

/** Vloerhoogte binnen de foyer, gelijk aan het podium buiten. */
export const THEATRE_FLOOR_Y = THEATRE_PLAN.podiumY;
const THEATRE_CEILING_Y = THEATRE_PLAN.hallHeight - THEATRE_PLAN.roofThickness;

/** Zuidgrens van het zaaldek: de achterkant van de foyerwand. */
const THEATRE_HOUSE_BACK_Z = THEATRE_INTERIOR.maxZ - THEATRE_PLAN.foyer.depth - THEATRE_PLAN.foyer.wallThickness;
/** Voorkant van het toneel, waar het zaaldek begint. */
const THEATRE_STAGE_FRONT_Z = THEATRE_INTERIOR.minZ + THEATRE_PLAN.stage.depth;

/** Rug van rij `r`, geteld vanaf de achterste rij bij de foyer. */
function theatreRowBackZ(row: number): number {
	return THEATRE_HOUSE_BACK_Z - THEATRE_PLAN.seating.crossBack - row * THEATRE_PLAN.seating.pitch;
}

/** Loopvlak van rij `r`. De zaal zakt naar het toneel toe, dus achterin is hoogst. */
export function theatreRowY(row: number): number {
	return THEATRE_FLOOR_Y - row * THEATRE_PLAN.seating.rise;
}

/**
 * Het dekje onder rij `r`.
 *
 * De achterste draagt ook het dwarsgangpad tot de foyerwand, de voorste het
 * dwarsgangpad tot het toneel; daartussen is elk dek precies één rijafstand diep.
 * Zo tegelen ze het hele zaaldek en ligt er nergens een naad zonder vloer.
 */
export function theatreRowDeck(row: number): Bounds2 {
	const last = THEATRE_PLAN.seating.rows - 1;
	return {
		minX: THEATRE_INTERIOR.minX,
		maxX: THEATRE_INTERIOR.maxX,
		minZ: row === last ? THEATRE_STAGE_FRONT_Z : theatreRowBackZ(row + 1),
		maxZ: row === 0 ? THEATRE_HOUSE_BACK_Z : theatreRowBackZ(row),
	};
}

/** De strook waar de stoelen van rij `r` op staan. */
export function theatreRowBank(row: number): Bounds2 {
	const back = theatreRowBackZ(row);
	return { minX: THEATRE_INTERIOR.minX, maxX: THEATRE_INTERIOR.maxX, minZ: back - THEATRE_PLAN.seating.bankDepth, maxZ: back };
}

/** De twee gangpaden overlangs, in x. */
export const THEATRE_AISLES: readonly Bounds2[] = ([-1, 1] as const).map((sign) => {
	const center = THEATRE_CENTER.x + sign * THEATRE_PLAN.aisle.offset;
	return {
		minX: center - half(THEATRE_PLAN.aisle.width),
		maxX: center + half(THEATRE_PLAN.aisle.width),
		minZ: THEATRE_STAGE_FRONT_Z,
		maxZ: THEATRE_HOUSE_BACK_Z,
	};
});

/** Een stoelenblok: één rij, één vak tussen twee gangpaden. */
export type TheatreSeatBank = Readonly<{ id: string; row: number; block: number; minX: number; maxX: number }>;

/**
 * De vakken van één rij: west van het eerste gangpad, ertussen, en oost van het
 * tweede. De gangpaden snijden ze uit de rij, dus een gangpad verzetten verzet de
 * stoelen mee in plaats van ze erin te laten staan.
 */
export function theatreSeatBanks(): readonly TheatreSeatBank[] {
	const margin = THEATRE_PLAN.seating.sideMargin;
	const edges = [
		THEATRE_INTERIOR.minX + margin,
		...THEATRE_AISLES.flatMap((aisle) => [aisle.minX, aisle.maxX]),
		THEATRE_INTERIOR.maxX - margin,
	];
	const banks: TheatreSeatBank[] = [];
	for (let row = 0; row < THEATRE_PLAN.seating.rows; row++) {
		let block = 0;
		for (let edge = 0; edge + 1 < edges.length; edge += 2) {
			banks.push({ id: `bank-r${row}-b${block}`, row, block, minX: at(edges, edge), maxX: at(edges, edge + 1) });
			block++;
		}
	}
	return banks;
}

/** Elke stoel van een vak, op zijn eigen hart. De tekenaar zet er een stoel op, de controle telt ze. */
export function theatreSeatXs(bank: TheatreSeatBank): readonly number[] {
	const width = span(bank.minX, bank.maxX);
	const count = Math.max(1, Math.floor(width / THEATRE_PLAN.seat.pitch));
	const used = count * THEATRE_PLAN.seat.pitch;
	const start = midpoint(bank.minX, bank.maxX) - half(used) + half(THEATRE_PLAN.seat.pitch);
	return Array.from({ length: count }, (_, index) => start + index * THEATRE_PLAN.seat.pitch);
}

/** Bovenkant van het toneel: de voorste rij plus de speelhoogte. */
export const THEATRE_STAGE_TOP_Y = theatreRowY(THEATRE_PLAN.seating.rows - 1) + THEATRE_PLAN.stage.height;

const THEATRE_DOOR_BAY = {
	minX: THEATRE_CENTER.x - half(THEATRE_PLAN.doors.width),
	maxX: THEATRE_CENTER.x + half(THEATRE_PLAN.doors.width),
} as const;

/** De travee, de deuropening ertussen en de vlakken die de gevel er ter plaatse voor heeft. */
export const THEATRE_PORTAL = {
	minX: THEATRE_DOOR_BAY.minX,
	maxX: THEATRE_DOOR_BAY.maxX,
	centerX: THEATRE_CENTER.x,
	doorMinX: THEATRE_DOOR_BAY.minX + THEATRE_PLAN.doors.sidelight,
	doorMaxX: THEATRE_DOOR_BAY.maxX - THEATRE_PLAN.doors.sidelight,
	/** Buitenvlak van de zuidgevel, binnenvlak, en het vlak waar het glas in staat. */
	outerZ: THEATRE_PLAN.hall.maxZ,
	innerZ: THEATRE_INTERIOR.maxZ,
	glassZ: THEATRE_ENVELOPE.maxZ,
	doorTravel: half(span(THEATRE_DOOR_BAY.minX, THEATRE_DOOR_BAY.maxX) - THEATRE_PLAN.doors.sidelight * 2),
} as const;

/** De vier wanden van de schil, elk tegen de binnenkant van zijn eigen gevelvlak. */
const THEATRE_WALL_PANELS = cardinalWallPanels({
	center: THEATRE_CENTER,
	offset: { x: half(THEATRE_HALL_WIDTH) - half(THEATRE_WALL_T), z: half(THEATRE_HALL_DEPTH) - half(THEATRE_WALL_T) },
	// De noord- en zuidkap lopen over de volle breedte; de zij-wanden stoppen ervoor,
	// zodat de vier kasten elkaar in de hoeken raken zonder in elkaar te staan.
	span: { width: THEATRE_HALL_WIDTH, depth: THEATRE_HALL_DEPTH - THEATRE_WALL_T * 2 },
	thickness: THEATRE_WALL_T,
});

export type TheatreWallSpec = Readonly<{ id: string; side: CardinalSide } & Bounds3>;

/**
 * De schil als dozen, met de travee uit de zuidgevel gesneden: twee wangen ernaast
 * en een latei erboven. Dezelfde ingreep als bij de westgevel van de mall, en om
 * dezelfde reden: het gat dat deze lijst laat vallen ís de opening die de zonegraaf
 * erin vindt.
 */
export const THEATRE_WALL_SPECS: readonly TheatreWallSpec[] = THEATRE_WALL_PANELS.flatMap((panel): TheatreWallSpec[] => {
	const box = {
		minX: panel.center.x - half(panel.size.width),
		maxX: panel.center.x + half(panel.size.width),
		minY: THEATRE_PLAN.baseY,
		maxY: THEATRE_PLAN.hallHeight,
		minZ: panel.center.z - half(panel.size.depth),
		maxZ: panel.center.z + half(panel.size.depth),
	};
	if (panel.id !== 'south') return [{ id: `theatre-wall-${panel.id}`, side: panel.id, ...box }];
	return [
		{ id: 'theatre-wall-south-west', side: panel.id, ...box, maxX: THEATRE_PORTAL.minX },
		{ id: 'theatre-wall-south-east', side: panel.id, ...box, minX: THEATRE_PORTAL.maxX },
		{
			id: 'theatre-wall-south-head',
			side: panel.id,
			...box,
			minX: THEATRE_PORTAL.minX,
			maxX: THEATRE_PORTAL.maxX,
			minY: THEATRE_FLOOR_Y + THEATRE_PLAN.doors.headY,
		},
	];
});

function theatrePanelOfWall(wall: TheatreWallSpec): FacadePanel {
	const alongZ = wall.side === 'west' || wall.side === 'east';
	return {
		minU: alongZ ? wall.minZ : wall.minX,
		maxU: alongZ ? wall.maxZ : wall.maxX,
		minY: wall.minY,
		maxY: wall.maxY,
	};
}

const THEATRE_FACADE_PANELS: Readonly<Record<CardinalSide, readonly FacadePanel[]>> = {
	west: THEATRE_WALL_SPECS.filter((wall) => wall.side === 'west').map(theatrePanelOfWall),
	east: THEATRE_WALL_SPECS.filter((wall) => wall.side === 'east').map(theatrePanelOfWall),
	north: THEATRE_WALL_SPECS.filter((wall) => wall.side === 'north').map(theatrePanelOfWall),
	south: THEATRE_WALL_SPECS.filter((wall) => wall.side === 'south').map(theatrePanelOfWall),
};

/** Waar de theatergevel op deze zijde open is. Alleen de travee laat een gat vallen. */
export function theatreOpeningWithin(side: CardinalSide, face: FacadePanel): FacadePanel | null {
	return panelOpeningWithin(THEATRE_FACADE_PANELS[side], face);
}

function theatreBox(id: string, box: Bounds3, role: SpatialRole = 'solid', blocksMovement = role === 'solid'): SpatialVolume {
	return solidPrism(
		id,
		rectangle(midpoint(box.minX, box.maxX), midpoint(box.minZ, box.maxZ), span(box.minX, box.maxX), span(box.minZ, box.maxZ)),
		box.minY,
		box.maxY,
		[],
		role,
		blocksMovement,
	);
}

/** De foyerwand, met een doorgang op elk gangpad en een latei erboven. */
function theatreFoyerWallVolumes(): readonly SpatialVolume[] {
	const minZ = THEATRE_HOUSE_BACK_Z;
	const maxZ = minZ + THEATRE_PLAN.foyer.wallThickness;
	const band = { minY: THEATRE_FLOOR_Y, maxY: THEATRE_CEILING_Y, minZ, maxZ };
	const edges = [THEATRE_INTERIOR.minX, ...THEATRE_AISLES.flatMap((aisle) => [aisle.minX, aisle.maxX]), THEATRE_INTERIOR.maxX];
	const volumes: SpatialVolume[] = [];
	let panel = 0;
	for (let edge = 0; edge + 1 < edges.length; edge += 2) {
		volumes.push(theatreBox(`foyer-wall-${panel}`, { ...band, minX: at(edges, edge), maxX: at(edges, edge + 1) }));
		panel++;
	}
	for (const [index, aisle] of THEATRE_AISLES.entries()) {
		volumes.push(
			theatreBox(`foyer-lintel-${index}`, {
				...band,
				minX: aisle.minX,
				maxX: aisle.maxX,
				minY: THEATRE_FLOOR_Y + THEATRE_PLAN.foyer.doorway,
			}),
		);
	}
	return volumes;
}

/** De naam die de kaart aan het theater geeft. De controle op de schotel leest hem terug. */
export const THEATRE_LABEL = 'PRAIRIE THEATRE';

/** De omhullende van de schil: waar de gevelcontrole van dit gebouw tegen meet. */
export const THEATRE_WALL_ENVELOPE: Bounds2 = THEATRE_WALL_SPECS.reduce<Bounds2>(
	(envelope, wall) => ({
		minX: Math.min(envelope.minX, wall.minX),
		maxX: Math.max(envelope.maxX, wall.maxX),
		minZ: Math.min(envelope.minZ, wall.minZ),
		maxZ: Math.max(envelope.maxZ, wall.maxZ),
	}),
	{
		minX: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	},
);

/**
 * De schil van het theater: de zes wandkasten en het dak erop.
 *
 * Apart van de zaal erin, want de gevelcontrole leest de huid van een gebouw uit
 * zijn `wall`-entiteiten. Het dak zit met opzet in dezelfde entiteit als de wanden
 * waar het overheen ligt: een lap tussen twee entiteiten vraagt om een vergunning,
 * en een vergunning die binnen één entiteit ligt snijdt volgens diezelfde regel in
 * niets.
 */
export const THEATRE_SHELL_ENTITY: MallWorldEntity = {
	id: 'theatre-shell',
	label: 'Prairie Theatre shell',
	category: 'wall',
	levels: ['v0'],
	transform: { position: { x: THEATRE_CENTER.x, y: THEATRE_FLOOR_Y, z: THEATRE_CENTER.z }, rotation: ZERO_ROTATION },
	volumes: [
		...THEATRE_WALL_SPECS.map((wall) => theatreBox(wall.id, wall)),
		theatreBox('roof', { ...THEATRE_PLAN.hall, minY: THEATRE_CEILING_Y, maxY: THEATRE_PLAN.hallHeight }),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('structure', THEATRE_LABEL, 88),
	tags: ['theatre', 'wall', 'structural'],
};

/**
 * De zaal binnen die schil: foyervloer, foyerwand, het aflopende zaaldek, het
 * toneel en het doek.
 *
 * Alles wat vloer is zit met opzet in één entiteit. `validateSpatialWorld`
 * vergelijkt alleen volumes van verschillende entiteiten, en twee dekjes die
 * tegen elkaar aan liggen delen per definitie hun naad; uit elkaar getrokken over
 * twee entiteiten zou elke naad als `coplanar-surface` gemeld worden.
 */
export const THEATRE_HALL_ENTITY: MallWorldEntity = {
	id: 'theatre-hall',
	label: 'Prairie Theatre auditorium',
	category: 'theatre',
	levels: ['v0'],
	transform: { position: { x: THEATRE_CENTER.x, y: THEATRE_FLOOR_Y, z: THEATRE_CENTER.z }, rotation: ZERO_ROTATION },
	volumes: [
		// De dorpel: het stuk vloer in de dikte van de gevel, precies zo breed als de
		// travee. Zonder hem houdt de foyervloer op het binnenvlak op en de bestrating
		// buiten op het buitenvlak, en stapt wie binnenkomt in een sleuf van een halve
		// meter breed en anderhalve meter diep.
		theatreBox(
			'threshold-floor',
			{
				minX: THEATRE_PORTAL.minX,
				maxX: THEATRE_PORTAL.maxX,
				minZ: THEATRE_INTERIOR.maxZ,
				maxZ: THEATRE_PLAN.hall.maxZ,
				minY: THEATRE_PLAN.baseY,
				maxY: THEATRE_FLOOR_Y,
			},
			'walkable',
			false,
		),
		theatreBox(
			'foyer-floor',
			{ ...THEATRE_INTERIOR, minZ: THEATRE_HOUSE_BACK_Z, minY: THEATRE_PLAN.baseY, maxY: THEATRE_FLOOR_Y },
			'walkable',
			false,
		),
		...theatreFoyerWallVolumes(),
		...Array.from({ length: THEATRE_PLAN.seating.rows }, (_, row) =>
			theatreBox(
				`house-deck-${row}`,
				{ ...theatreRowDeck(row), minY: THEATRE_PLAN.baseY, maxY: theatreRowY(row) },
				'walkable',
				false,
			),
		),
		theatreBox(
			'stage',
			{
				...THEATRE_INTERIOR,
				maxZ: THEATRE_STAGE_FRONT_Z,
				minY: THEATRE_PLAN.baseY,
				maxY: THEATRE_STAGE_TOP_Y,
			},
			'walkable',
			false,
		),
		theatreBox('stage-set', {
			minX: THEATRE_INTERIOR.minX + THEATRE_PLAN.stage.set.margin,
			maxX: THEATRE_INTERIOR.maxX - THEATRE_PLAN.stage.set.margin,
			minZ: THEATRE_INTERIOR.minZ,
			maxZ: THEATRE_INTERIOR.minZ + THEATRE_PLAN.stage.set.thickness,
			minY: THEATRE_STAGE_TOP_Y,
			maxY: THEATRE_STAGE_TOP_Y + THEATRE_PLAN.stage.set.height,
		}),
	],
	ports: NO_PORTS,
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: NO_MECHANISMS,
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	// De schil draagt het kaartlabel; de zaal erin zou het er een tweede keer bij zetten.
	map: { visible: true, layer: 'structure', priority: 62 },
	tags: ['theatre', 'structural'],
};

const THEATRE_DOORS: ClearanceMechanism = {
	id: 'theatre-doors',
	kind: 'sliding',
	stateId: 'theatre-door-open',
	movingVolumeIds: ['door-west', 'door-east'],
	triggerVolumeId: 'presence',
	openState: { translation: { x: THEATRE_PORTAL.doorTravel, y: 0, z: 0 } },
	openingSeconds: THEATRE_PLAN.doors.seconds,
	// Stroom eraf betekent open: een uitverkochte zaal achter een dichtgevallen deur
	// is een nooduitgang die er niet is.
	failSafe: 'open',
	access: { admits: ['pedestrian'] },
};

function theatreLeaf(id: string, minX: number, maxX: number): SpatialVolume {
	return {
		id,
		role: 'solid',
		geometry: {
			kind: 'prism',
			plan: rectangle(midpoint(minX, maxX), THEATRE_PORTAL.glassZ, span(minX, maxX), THEATRE_PLAN.doors.thickness),
			minY: THEATRE_FLOOR_Y,
			maxY: THEATRE_FLOOR_Y + THEATRE_PLAN.doors.leafHeight,
			holes: [],
		},
		blocksMovement: false,
		clearance: { kind: 'automatic-gate', mechanismId: THEATRE_DOORS.id },
		allowsOverlapFrom: STRUCTURAL_OVERLAP,
		tags: [GLASS_TAG, 'door-leaf'],
	};
}

function theatreSidelight(id: string, minX: number, maxX: number): SpatialVolume {
	return glazed(
		solidPrism(
			id,
			rectangle(midpoint(minX, maxX), THEATRE_PORTAL.glassZ, span(minX, maxX), THEATRE_PLAN.doors.thickness),
			THEATRE_FLOOR_Y,
			THEATRE_FLOOR_Y + THEATRE_PLAN.doors.headY,
		),
	);
}

const THEATRE_TRIGGER = {
	minX: THEATRE_PORTAL.doorMinX - THEATRE_PLAN.trigger.inreach,
	maxX: THEATRE_PORTAL.doorMaxX + THEATRE_PLAN.trigger.inreach,
	minZ: THEATRE_PORTAL.innerZ - THEATRE_PLAN.trigger.inreach,
	maxZ: THEATRE_PORTAL.outerZ + THEATRE_PLAN.trigger.outreach,
} as const;

/**
 * De travee in de zuidgevel: de enige weg de zaal in.
 *
 * `threshold` is de vrijloop die het gat verklaart, en hij is ook het enige wat de
 * zonegraaf van dit gebouw als portaal ziet: hij snijdt de gevellijn, dus stad en
 * theater kijken hier op elkaar uit en nergens anders.
 */
export const THEATRE_ENTRANCE_ENTITY: MallWorldEntity = {
	id: 'theatre-entrance',
	label: 'Theatre doors',
	category: 'opening',
	levels: ['v0'],
	transform: { position: { x: THEATRE_PORTAL.centerX, y: THEATRE_FLOOR_Y, z: THEATRE_PORTAL.glassZ }, rotation: ZERO_ROTATION },
	volumes: [
		clearancePrism(
			'threshold',
			rectangle(
				midpoint(THEATRE_PORTAL.doorMinX, THEATRE_PORTAL.doorMaxX),
				midpoint(THEATRE_PORTAL.innerZ - THEATRE_PLAN.trigger.inreach, THEATRE_PORTAL.outerZ),
				span(THEATRE_PORTAL.doorMinX, THEATRE_PORTAL.doorMaxX),
				span(THEATRE_PORTAL.innerZ - THEATRE_PLAN.trigger.inreach, THEATRE_PORTAL.outerZ),
			),
			THEATRE_FLOOR_Y,
			THEATRE_FLOOR_Y + THEATRE_PLAN.doors.headY,
			'opening-clearance',
		),
		theatreSidelight('sidelight-west', THEATRE_PORTAL.minX, THEATRE_PORTAL.doorMinX),
		theatreSidelight('sidelight-east', THEATRE_PORTAL.doorMaxX, THEATRE_PORTAL.maxX),
		theatreLeaf('door-west', THEATRE_PORTAL.doorMinX, THEATRE_PORTAL.centerX),
		theatreLeaf('door-east', THEATRE_PORTAL.centerX, THEATRE_PORTAL.doorMaxX),
		{
			id: 'presence',
			role: 'trigger',
			geometry: {
				kind: 'prism',
				plan: rectangle(
					midpoint(THEATRE_TRIGGER.minX, THEATRE_TRIGGER.maxX),
					midpoint(THEATRE_TRIGGER.minZ, THEATRE_TRIGGER.maxZ),
					span(THEATRE_TRIGGER.minX, THEATRE_TRIGGER.maxX),
					span(THEATRE_TRIGGER.minZ, THEATRE_TRIGGER.maxZ),
				),
				minY: THEATRE_FLOOR_Y,
				maxY: THEATRE_FLOOR_Y + THEATRE_PLAN.trigger.height,
				holes: [],
			},
			blocksMovement: false,
			clearance: { kind: 'clear' },
			allowsOverlapFrom: STRUCTURAL_OVERLAP,
			tags: ['trigger', 'presence'],
		},
	],
	ports: [
		{
			id: 'theatre-street',
			kind: 'door',
			position: { x: THEATRE_PORTAL.centerX, y: THEATRE_FLOOR_Y, z: THEATRE_PORTAL.outerZ },
			direction: { x: 0, y: 0, z: -1 },
			width: span(THEATRE_PORTAL.doorMinX, THEATRE_PORTAL.doorMaxX),
			height: THEATRE_PLAN.doors.headY,
			connectsTo: ['theatre-foyer'],
			oneWay: false,
			allows: ['walking', 'service'],
			posture: 'standing',
			clearanceVolumeId: 'threshold',
		},
		{
			id: 'theatre-foyer',
			kind: 'door',
			position: { x: THEATRE_PORTAL.centerX, y: THEATRE_FLOOR_Y, z: THEATRE_PORTAL.innerZ },
			direction: { x: 0, y: 0, z: 1 },
			width: span(THEATRE_PORTAL.doorMinX, THEATRE_PORTAL.doorMaxX),
			height: THEATRE_PLAN.doors.headY,
			connectsTo: ['theatre-street'],
			oneWay: false,
			allows: ['walking', 'service'],
			posture: 'standing',
			clearanceVolumeId: 'threshold',
		},
	],
	placement: structurePlacement(),
	kinematics: { kind: 'static' },
	mechanisms: [THEATRE_DOORS],
	receiver: STATIC_RECEIVER,
	emitters: NO_EMITTERS,
	map: map('circulation', 'THEATER · ENTREE', 90),
	tags: ['theatre', 'entrance', 'circulation', 'must-remain-clear'],
};

/**
 * De gangpaden, als gereserveerde vloer.
 *
 * Eén doos per gangpad per rij, want het zaaldek zakt trapsgewijs en een enkele
 * doos over de hele lengte zou achterin een halve meter boven het loopvlak hangen
 * en voorin erin steken. `requiredHeadroom` erboven, zodat een latei die te laag
 * hangt er net zo goed in staat als een stoel.
 */
function theatreAisleVolumes(): readonly SpatialVolume[] {
	const volumes: SpatialVolume[] = [];
	for (const [index, aisle] of THEATRE_AISLES.entries()) {
		for (let row = 0; row < THEATRE_PLAN.seating.rows; row++) {
			const deck = theatreRowDeck(row);
			const floor = theatreRowY(row);
			volumes.push({
				id: `aisle-${index}-r${row}`,
				role: 'aisle-clearance',
				geometry: {
					kind: 'prism',
					plan: rectangle(
						midpoint(aisle.minX, aisle.maxX),
						midpoint(deck.minZ, deck.maxZ),
						span(aisle.minX, aisle.maxX),
						span(deck.minZ, deck.maxZ),
					),
					minY: floor,
					maxY: floor + STANDING_PEDESTRIAN.requiredHeadroom,
					holes: [],
				},
				blocksMovement: false,
				clearance: { kind: 'clear' },
				allowsOverlapFrom: ['connector'],
				tags: ['aisle-clearance'],
			});
		}
	}
	return volumes;
}

/**
 * De stoelen, per vak. Eén doos per rij per vak en niet per stoel: de tekenaar zet
 * ze stoel voor stoel uit dezelfde maten neer, en tweehonderd losse volumes zeggen
 * over de vraag die hier gesteld wordt — staat er iets in het gangpad — precies
 * hetzelfde als achttien.
 */
export const THEATRE_SEATING_ENTITY: MallWorldEntity = roomEntity({
	id: 'theatre-seating',
	label: 'Theatre stalls',
	category: 'theatre',
	level: 'v0',
	center: { x: THEATRE_CENTER.x, z: midpoint(theatreRowBackZ(THEATRE_PLAN.seating.rows - 1), THEATRE_HOUSE_BACK_Z) },
	placementClass: 'fixture',
	volumes: theatreSeatBanks().map((bank) => {
		const strook = theatreRowBank(bank.row);
		const floor = theatreRowY(bank.row);
		return theatreBox(bank.id, {
			minX: bank.minX,
			maxX: bank.maxX,
			minZ: strook.minZ,
			maxZ: strook.maxZ,
			minY: floor,
			maxY: floor + THEATRE_PLAN.seating.backHeight,
		});
	}),
	map: map('fixture', 'ZAAL', 60),
	tags: ['theatre', 'seating'],
});

/** De zaalvloer die vrij hoort te blijven, plus de kassa in de foyer. */
export const THEATRE_FOYER_ENTITY: MallWorldEntity = roomEntity({
	id: 'theatre-foyer',
	label: 'Theatre foyer',
	category: 'theatre',
	level: 'v0',
	center: { x: THEATRE_CENTER.x, z: midpoint(THEATRE_HOUSE_BACK_Z, THEATRE_INTERIOR.maxZ) },
	placementClass: 'fixture',
	volumes: [
		...theatreAisleVolumes(),
		theatreBox('kassa', {
			minX: THEATRE_INTERIOR.minX + THEATRE_PLAN.foyer.kassa.inset,
			maxX: THEATRE_INTERIOR.minX + THEATRE_PLAN.foyer.kassa.inset + THEATRE_PLAN.foyer.kassa.width,
			minZ: THEATRE_INTERIOR.maxZ - THEATRE_PLAN.foyer.depth + THEATRE_PLAN.foyer.kassa.inset,
			maxZ: THEATRE_INTERIOR.maxZ - THEATRE_PLAN.foyer.depth + THEATRE_PLAN.foyer.kassa.inset + THEATRE_PLAN.foyer.kassa.depth,
			minY: THEATRE_FLOOR_Y,
			maxY: THEATRE_FLOOR_Y + THEATRE_PLAN.foyer.kassa.height,
		}),
	],
	map: map('fixture', 'KASSA', 58),
	tags: ['theatre', 'foyer'],
});

export const THEATRE_ENTITIES: readonly MallWorldEntity[] = [
	THEATRE_SHELL_ENTITY,
	THEATRE_HALL_ENTITY,
	THEATRE_ENTRANCE_ENTITY,
	THEATRE_SEATING_ENTITY,
	THEATRE_FOYER_ENTITY,
];

/**
 * De blokkerende volumes van het theater als AABB's, uit de entiteiten zelf. Een
 * tweede lijst coördinaten in de collision is een muur die naast zijn gevel staat.
 *
 * `seeThrough` scheidt het glas van het steen: de zijlichten houden een lichaam
 * tegen en geen blik, en een doos die allebei doet zet een muur in de travee waar
 * de zonegraaf juist doorheen kijkt.
 */
export function theatreColliders(): readonly (WorldCollider & Readonly<{ seeThrough: boolean }>)[] {
	return THEATRE_ENTITIES.flatMap((entity) =>
		entity.volumes.flatMap((volume) =>
			volume.blocksMovement
				? [
						{
							...geometryBounds(volume.geometry),
							label: `${entity.id}_${volume.id}`,
							seeThrough: volume.tags.includes(GLASS_TAG),
						},
					]
				: [],
		),
	);
}

/** De loopvlakken binnen het theater: de foyer, elk zaaldek en het toneel. */
export function theatreSurfaces(): readonly Readonly<Bounds2 & { y: number; label: string }>[] {
	return THEATRE_HALL_ENTITY.volumes.flatMap((volume) => {
		if (volume.role !== 'walkable') return [];
		const bounds = geometryBounds(volume.geometry);
		return [{ minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ, y: bounds.maxY, label: volume.id }];
	});
}

export const WORLD_ENTITIES: readonly MallWorldEntity[] = [
	floorV0,
	floorV1,
	roofSlab,
	parkingFloor,
	...MALL_WALLS,
	MALL_FACADE_ENTITY,
	HELIPAD_DECK,
	HELIPAD_HATCH,
	...OPENING_ENTITIES,
	...CONNECTOR_ENTITIES,
	PARKING_EXIT_RAMP_ENTITY,
	PARKING_EXIT_TRENCH_ENTITY,
	ELEVATOR_ENTITY,
	...SPATIAL_SHOPS,
	ISLAND_HOP_ENTITY,
	ENTRANCE_ENTITY,
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
	ATRIUM_PLANTER_ENTITY,
	PARKING_DECK_ENTITY,
	PARKING_BOOTH_ENTITY,
	PARKING_BAYS_ENTITY,
	PARKED_CARS_ENTITY,
	PARKED_MOTORCYCLES_ENTITY,
	ENTRANCE_MOTORCYCLES_ENTITY,
	ROOF_TERRACE_ENTITY,
	TIKI_BAR_ENTITY,
	ROOF_FURNITURE_ENTITY,
	ROOF_SLIDE_ENTITY,
	...THEATRE_ENTITIES,
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
