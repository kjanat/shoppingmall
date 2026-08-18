import { STANDING_PEDESTRIAN } from '#/data/character';
import { MALL_FOOTPRINT } from '#/data/layout';
import type { Bounds2, Bounds3 } from '#/data/spatial';
import { clamp, half, lerp, midpoint, span } from '#/util/math';

/**
 * Prairie Fur Con — scale is not freehand.
 *
 * - Hall mass ≈ RAI-ish relative to the mall (multiple of MALL_FOOTPRINT).
 * - Placed east of the ring road with a plaza that bridges road → doors.
 * - People, booths, doors, audio falloff all read human metres from character.ts.
 *
 * Ring outer face east matches cityPlan: ROAD_INNER_X (48) + ROAD_PLAN.width (7).
 * check-world `conschaal` fails if those drift apart.
 */
const CON_RING_OUTER_X = 55;

/** One body height in world metres. Every con figure is a multiple of this. */
const CON_BODY = STANDING_PEDESTRIAN.bodyHeight;

const ROAD_OUTER_X = CON_RING_OUTER_X;

/**
 * Exhibition complex vs mall. RAI-scale: many mall footprints.
 * 5 × 72 = 360 m east-west, 4 × 48 = 192 m north-south (~69 000 m² shell).
 */
const CON_SPAN_X = MALL_FOOTPRINT.width * 5;
const CON_SPAN_Z = MALL_FOOTPRINT.depth * 4;

/** Gap between road outer face and the west edge of the approach plaza. */
const PLAZA_FROM_ROAD = MALL_FOOTPRINT.width * 0.4;

/** Plaza depth (along x): full mall-width approach, queues + trucks + marquee. */
const PLAZA_DEPTH_X = MALL_FOOTPRINT.width * 0.9;

/** West face of the indoor shell (doors). */
const SHELL_WEST_X = ROAD_OUTER_X + PLAZA_FROM_ROAD + PLAZA_DEPTH_X;

const CON_GROUND_Y = 0;
const CON_FLOOR_Y = 0.05;
const CON_BASE_Y = -0.5;
const CON_WALL_T = 0.5;

/** Exhibition hall free height: ~9 body heights (big-hall / arena feel). */
const CON_HALL_HEIGHT = CON_BODY * 9;
const CON_ROOF_T = 0.9;
const CON_CEILING_Y = CON_HALL_HEIGHT - CON_ROOF_T;

/** Hotel storey: standing headroom + slab. */
const CON_HOTEL_FLOOR_H = STANDING_PEDESTRIAN.requiredHeadroom + 1.0;
const CON_HOTEL_FLOORS = 6;

/** Outdoor plaza on the city-facing (west) side — stays in `stad`. */
const CON_PLAZA: Bounds2 = {
	minX: ROAD_OUTER_X + PLAZA_FROM_ROAD,
	maxX: SHELL_WEST_X - 0.5,
	minZ: -half(CON_SPAN_Z) * 0.55,
	maxZ: half(CON_SPAN_Z) * 0.55,
};

/**
 * One indoor footprint for the whole con (dealers + stage + hotel + adult).
 * Zone shell, gevel and colliders all read this outer box.
 */
const CON_FOOTPRINT: Bounds2 = {
	minX: SHELL_WEST_X,
	maxX: SHELL_WEST_X + CON_SPAN_X,
	minZ: -half(CON_SPAN_Z),
	maxZ: half(CON_SPAN_Z),
};

/** Interior regions as fractions of the shell (same ratios, any scale). */
function shellFrac(minU: number, maxU: number, minV: number, maxV: number): Bounds2 {
	const { minX, maxX, minZ, maxZ } = CON_FOOTPRINT;
	return {
		minX: lerp(minX, maxX, minU),
		maxX: lerp(minX, maxX, maxU),
		minZ: lerp(minZ, maxZ, minV),
		maxZ: lerp(minZ, maxZ, maxV),
	};
}

/** Dealers den + artist alley — west half, south. */
const CON_DEALERS: Bounds2 = shellFrac(0, 0.58, 0, 0.54);

/** Main techno hall — west-centre, north. */
const CON_STAGE: Bounds2 = shellFrac(0, 0.47, 0.58, 1);

/** Hotel — east, north. */
const CON_HOTEL: Bounds2 = shellFrac(0.62, 1, 0.54, 1);

/** Adult wing — east of dealers, south (small rooms, human scale). */
const CON_DARKROOM: Bounds2 = shellFrac(0.59, 0.72, 0.04, 0.32);
const CON_STUDIO: Bounds2 = shellFrac(0.73, 0.91, 0.04, 0.32);

const CON_ADULT_WING: Bounds2 = {
	minX: CON_DARKROOM.minX,
	maxX: CON_STUDIO.maxX,
	minZ: Math.min(CON_DARKROOM.minZ, CON_STUDIO.minZ),
	maxZ: Math.max(CON_DARKROOM.maxZ, CON_STUDIO.maxZ),
};

/** Zone plan heartline (half wall inside footprint outer face). */
const CON_ENVELOPE: Bounds2 = {
	minX: CON_FOOTPRINT.minX + half(CON_WALL_T),
	maxX: CON_FOOTPRINT.maxX - half(CON_WALL_T),
	minZ: CON_FOOTPRINT.minZ + half(CON_WALL_T),
	maxZ: CON_FOOTPRINT.maxZ - half(CON_WALL_T),
};

const CON_ZONE_VOLUME: Bounds3 = {
	...CON_ENVELOPE,
	minY: CON_BASE_Y,
	maxY: CON_HALL_HEIGHT + CON_HOTEL_FLOORS * CON_HOTEL_FLOOR_H,
};

const CON_CENTER = {
	x: midpoint(CON_FOOTPRINT.minX, CON_FOOTPRINT.maxX),
	z: midpoint(CON_FOOTPRINT.minZ, CON_FOOTPRINT.maxZ),
} as const;

/** Main doors: ~16 shoulder-widths (wide con entry, not a shop door). */
const DOOR_WIDTH = STANDING_PEDESTRIAN.radius * 2 * 16;

const CON_PORTAL = {
	outerX: CON_FOOTPRINT.minX,
	innerX: CON_FOOTPRINT.minX + CON_WALL_T,
	glassX: CON_FOOTPRINT.minX + half(CON_WALL_T),
	minZ: -half(DOOR_WIDTH),
	maxZ: half(DOOR_WIDTH),
	centerZ: 0,
	/** Tall con entry, still below hall clear. */
	headY: STANDING_PEDESTRIAN.requiredHeadroom * 1.9,
	width: DOOR_WIDTH,
} as const;

const CON_DOOR_BAY = {
	minZ: CON_PORTAL.centerZ - half(CON_PORTAL.width),
	maxZ: CON_PORTAL.centerZ + half(CON_PORTAL.width),
} as const;

/** Adult door: one body wide, standing headroom. */
const CON_ADULT_GATE = {
	x: CON_DARKROOM.minX,
	minZ: midpoint(CON_DARKROOM.minZ, CON_DARKROOM.maxZ) - STANDING_PEDESTRIAN.radius * 1.5,
	maxZ: midpoint(CON_DARKROOM.minZ, CON_DARKROOM.maxZ) + STANDING_PEDESTRIAN.radius * 1.5,
	headY: STANDING_PEDESTRIAN.requiredHeadroom,
	leaf: 0.18,
} as const;

const CON_ADULT_GATE_LEAF: Bounds3 = {
	minX: CON_ADULT_GATE.x,
	maxX: CON_ADULT_GATE.x + CON_ADULT_GATE.leaf,
	minY: CON_FLOOR_Y,
	maxY: CON_FLOOR_Y + CON_ADULT_GATE.headY,
	minZ: CON_ADULT_GATE.minZ,
	maxZ: CON_ADULT_GATE.maxZ,
};

const CON_ADULT_GATE_TRIGGER: Bounds3 = {
	minX: CON_ADULT_GATE.x - 2.5,
	maxX: CON_ADULT_GATE.x + 2.5,
	minY: CON_FLOOR_Y,
	maxY: CON_FLOOR_Y + CON_ADULT_GATE.headY,
	minZ: CON_ADULT_GATE.minZ - 1,
	maxZ: CON_ADULT_GATE.maxZ + 1,
};

const CON_LABEL = 'PRAIRIE FUR CON';

/** Names printed over the independently navigable rooms. */
const CON_ROOM_LABELS = {
	dealers: 'DEALERS DEN',
	stage: 'MAIN STAGE',
	hotel: 'CON HOTEL',
	darkroom: 'DARKROOM 18+',
	studio: 'PORN STUDIO',
} as const;

/**
 * Dealer table footprint in metres (human table, not a freehand number).
 * Grid fills the dealers interior; counts are derived.
 */
const CON_BOOTH = {
	w: 3.6,
	d: 2.8,
	aisleX: 1.4,
	aisleZ: 1.6,
	margin: STANDING_PEDESTRIAN.requiredHeadroom * 1.5,
} as const;

/** Walkable floor area of the main halls (for density). */
function hallArea(rect: Bounds2): number {
	return Math.max(0, span(rect.minX, rect.maxX) - CON_WALL_T * 2) * Math.max(0, span(rect.minZ, rect.maxZ) - CON_WALL_T * 2);
}

const WALK_AREA = hallArea(CON_DEALERS) + hallArea(CON_STAGE) + hallArea(CON_HOTEL) + hallArea(CON_PLAZA) * 0.35;

/**
 * Busy con density without melting the frame: one walker per ~55 m² of walk space.
 * Cap high enough that a RAI-scale lot still feels packed.
 */
const CON_CROWD_COUNT = Math.round(clamp(WALK_AREA / 55, 80, 280));

const CON_TECHNO_SOURCE = {
	x: midpoint(CON_STAGE.minX, CON_STAGE.maxX),
	y: CON_BODY * 1.05,
	z: midpoint(CON_STAGE.minZ, CON_STAGE.maxZ),
} as const;

/** Audio audible across the lot; falloff keyed to footprint diagonal. */
const CON_TECHNO_RANGE =
	Math.hypot(span(CON_FOOTPRINT.minX, CON_FOOTPRINT.maxX), span(CON_FOOTPRINT.minZ, CON_FOOTPRINT.maxZ)) * 0.65;

const CON_AGE_GATE_KEY = 'mallsim.con.adult.v1';

/** Lot kept for city kavel / tower keep-out (plaza + building). */
const CON_LOT: Bounds2 = {
	minX: CON_PLAZA.minX,
	maxX: CON_FOOTPRINT.maxX,
	minZ: Math.min(CON_PLAZA.minZ, CON_FOOTPRINT.minZ),
	maxZ: Math.max(CON_PLAZA.maxZ, CON_FOOTPRINT.maxZ),
};

/** City clamp / far clip: con far corner + margin past shell. */
const CON_CITY_MARGIN = 22;

function rectInterior(rect: Bounds2, wall = CON_WALL_T): Bounds2 {
	return {
		minX: rect.minX + wall,
		maxX: rect.maxX - wall,
		minZ: rect.minZ + wall,
		maxZ: rect.maxZ - wall,
	};
}

function rectCenter(rect: Bounds2): { x: number; z: number } {
	return { x: midpoint(rect.minX, rect.maxX), z: midpoint(rect.minZ, rect.maxZ) };
}

function rectSize(rect: Bounds2): { w: number; d: number } {
	return { w: span(rect.minX, rect.maxX), d: span(rect.minZ, rect.maxZ) };
}

function inRect2(rect: Bounds2, x: number, z: number): boolean {
	return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

function inBounds3(box: Bounds3, x: number, y: number, z: number): boolean {
	return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && z >= box.minZ && z <= box.maxZ;
}

/** How many booth cells fit in the dealers den at this scale. */
function conBoothGrid(): { cols: number; rows: number; startX: number; startZ: number; pitchX: number; pitchZ: number } {
	const inner = rectInterior(CON_DEALERS, CON_WALL_T + CON_BOOTH.margin);
	const pitchX = CON_BOOTH.w + CON_BOOTH.aisleX;
	const pitchZ = CON_BOOTH.d + CON_BOOTH.aisleZ;
	const cols = Math.max(1, Math.floor(span(inner.minX, inner.maxX) / pitchX));
	const rows = Math.max(1, Math.floor(span(inner.minZ, inner.maxZ) / pitchZ));
	const usedX = cols * pitchX - CON_BOOTH.aisleX;
	const usedZ = rows * pitchZ - CON_BOOTH.aisleZ;
	return {
		cols,
		rows,
		startX: midpoint(inner.minX, inner.maxX) - half(usedX) + half(CON_BOOTH.w),
		startZ: midpoint(inner.minZ, inner.maxZ) - half(usedZ) + half(CON_BOOTH.d),
		pitchX,
		pitchZ,
	};
}

export { CON_BODY, CON_RING_OUTER_X, CON_GROUND_Y, CON_FLOOR_Y, CON_BASE_Y, CON_WALL_T, CON_HALL_HEIGHT, CON_ROOF_T, CON_CEILING_Y, CON_HOTEL_FLOOR_H, CON_HOTEL_FLOORS, CON_PLAZA, CON_FOOTPRINT, CON_DEALERS, CON_STAGE, CON_HOTEL, CON_DARKROOM, CON_STUDIO, CON_ADULT_WING, CON_ENVELOPE, CON_ZONE_VOLUME, CON_CENTER, CON_PORTAL, CON_DOOR_BAY, CON_ADULT_GATE, CON_ADULT_GATE_LEAF, CON_ADULT_GATE_TRIGGER, CON_LABEL, CON_ROOM_LABELS, CON_BOOTH, CON_CROWD_COUNT, CON_TECHNO_SOURCE, CON_TECHNO_RANGE, CON_AGE_GATE_KEY, CON_LOT, CON_CITY_MARGIN, rectInterior, rectCenter, rectSize, inRect2, inBounds3, conBoothGrid };
