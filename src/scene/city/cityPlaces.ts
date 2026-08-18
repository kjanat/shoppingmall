import { CON_LOT } from '#/data/conPlan';
import { half, midpoint } from '#/util/math';

type Rect = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

/** Binnenrand en breedte van de ringweg. */
const ROAD_INNER_X = 48;
const ROAD_INNER_Z = 34;
const ROAD_PLAN = { width: 7 } as const;
const LANE_X = ROAD_INNER_X + half(ROAD_PLAN.width);
const LANE_Z = ROAD_INNER_Z + half(ROAD_PLAN.width);

/** Kavels die stadsscène, fysica en kaart samen lezen. */
const CITY_KAVELS = {
	theatre: { minX: 52, maxX: 90, minZ: -87, maxZ: -40 },
	garage: { minX: 52, maxX: 90, minZ: 40, maxZ: 72 },
	park: { minX: -140, maxX: -52, minZ: -100, maxZ: -36 },
	con: { minX: CON_LOT.minX, maxX: CON_LOT.maxX, minZ: CON_LOT.minZ, maxZ: CON_LOT.maxZ },
	rio: { minX: -140, maxX: -58, minZ: 36, maxZ: 92 },
	favela: { minX: -108, maxX: -46, minZ: 38, maxZ: 92 },
	colosseum: { minX: -45, maxX: 45, minZ: 50, maxZ: 160 },
} as const satisfies Record<string, Rect>;

const COLOSSEUM_PLAN = {
	x: 0,
	z: 104,
	radiusX: 44,
	radiusZ: 52,
	arenaRadiusX: 20,
	arenaRadiusZ: 25,
	wallHeight: 32,
	levels: 4,
	archesPerLevel: 36,
	hypogeumDepth: 3.5,
	label: 'MEGA COLOSSEUM ARENA',
} as const;

const RIO_MOUNTAIN = {
	x: midpoint(CITY_KAVELS.rio.minX, CITY_KAVELS.rio.maxX),
	z: midpoint(CITY_KAVELS.rio.minZ, CITY_KAVELS.rio.maxZ),
	baseW: 48,
	baseD: 40,
	rockH: 48,
	statueH: 20,
	armSpan: 18,
	label: 'MONTANHA DE JANEIRO',
} as const;

const FAVELA_PLAN = {
	minX: CITY_KAVELS.favela.minX,
	maxX: CITY_KAVELS.favela.maxX,
	minZ: CITY_KAVELS.favela.minZ,
	maxZ: CITY_KAVELS.favela.maxZ,
	yLow: 0.05,
	yHigh: RIO_MOUNTAIN.rockH + 0.05,
	cols: 18,
	rows: 20,
	seed: 0xfa9e1a,
	label: 'VILA DO MONTE',
	alleyHalf: 1.5,
	streetHalf: 1.2,
	contours: 8,
	plazaR: 10,
} as const;

const PARK_BERM = 4;

/** Het gras zelf: het parkkavel min zijn onbeplante berm. */
const PARK_LAWN = {
	minX: CITY_KAVELS.park.minX + PARK_BERM,
	maxX: CITY_KAVELS.park.maxX - PARK_BERM,
	minZ: CITY_KAVELS.park.minZ + PARK_BERM,
	maxZ: CITY_KAVELS.park.maxZ - PARK_BERM,
} as const;

const GARAGE_PLAN = {
	footprint: { minX: 58, maxX: 83, minZ: 46, maxZ: 64 },
	floorHeight: 3.2,
	slabThickness: 0.35,
	decks: 4,
	groundDeckY: 0.2,
	columnX: [59, 62.8, 71.2, 79.6, 81.2],
	columnZ: [46.8, 55, 63.2],
	columnSize: 0.45,
	columnTopY: 12.8,
	parapet: { height: 1, thickness: 0.18, doorway: 2 },
	ramp: {
		thickness: 0.25,
		guard: { height: 0.6, thickness: 0.12 },
		south: { z: 65.8, width: 3.2, fromX: 60 },
		east: { width: 2.8, fromZ: 63, toZ: 48.4 },
		landingDepth: 3.4,
		legZ: [65.4, 60, 51],
		legSize: 0.3,
	},
} as const;

function garageDeckTop(index: number): number {
	return index === 0 ? GARAGE_PLAN.groundDeckY : index * GARAGE_PLAN.floorHeight + half(GARAGE_PLAN.slabThickness);
}

type GarageDeck = Readonly<Rect & { id: string; y: number }>;

const GARAGE_DECKS: readonly GarageDeck[] = Array.from({ length: GARAGE_PLAN.decks }, (_, index) => ({
	id: `garage_deck_${index + 1}`,
	...GARAGE_PLAN.footprint,
	y: garageDeckTop(index + 1),
}));

export {
	CITY_KAVELS,
	COLOSSEUM_PLAN,
	FAVELA_PLAN,
	GARAGE_DECKS,
	GARAGE_PLAN,
	LANE_X,
	LANE_Z,
	PARK_LAWN,
	RIO_MOUNTAIN,
	ROAD_INNER_X,
	ROAD_INNER_Z,
	ROAD_PLAN,
	garageDeckTop,
};
export type { GarageDeck, Rect };
