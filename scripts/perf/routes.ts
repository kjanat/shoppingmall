import type { LevelId } from '#/data/levels';
import { levelY } from '#/data/levels';
import { ENTRANCE_PORTAL, MALL_WALL_ENVELOPE, PARKING_EXIT_RAMP } from '#/data/world';
import { EYE } from '#/player/constants';
import { CITY_KAVELS, ROAD_INNER_X, ROAD_PLAN, TRAFFIC_LANE_CLEARANCE } from '#/scene/city/cityPlan';
import { midpoint, span } from '#/util/math';
import { mulberry32, shuffled } from '#/util/rand';
import type { RoutePose } from './probe.ts';

/**
 * Waar de camera vandaan kijkt om de hoofdingang in beeld te krijgen: schuin van
 * opzij, zodat de luifel diepte houdt, en met de blik iets omhoog naar de
 * belettering boven het glas.
 *
 * Op de bestrating en niet op de rijbaan. Op zeventien meter stond hij vijf
 * centimeter naast het hart van de buitenste rijstrook: een passerende auto van
 * 4,2 meter dekte dan het onderste halve beeld af en het aantal draw calls van het
 * enige buitenstandpunt dat het project heeft hing af van waar het verkeer net
 * reed. `ingang` in de wereldcontrole meet deze pose tegen elke rijstrook en tegen
 * de aftakking naar de garage.
 *
 * En naar het zuiden: ten noorden van de portaalas ligt de uitritgeul open en
 * loopt de aftakking waarover auto's de garage in rijden.
 */
const ENTRANCE_STREET_VIEW = { back: 11, side: 9.5, aim: 6 } as const;

/**
 * Het standpunt in het stadspark, aan de overkant van de westelijke ringweg.
 *
 * Het kavel is niet de grasmat: `CITY_KAVELS.park` loopt tot x −52 en dat ligt tússen
 * de twee rijstroken, want het kavel houdt alleen de skyline vrij. De oostrand van
 * het gras is de buitenrand van de rijbaan, en daar hoort een lichaam nog de ruimte
 * naast te krijgen die een auto in zijn strook inneemt.
 *
 * `z` is het hart van het kavel, dus ruim ten noorden van de mall: van hier uit staat
 * het hele gebouw schuin in beeld en het park in de rug.
 */
const PARK_VIEW = {
	x: -(ROAD_INNER_X + ROAD_PLAN.width + TRAFFIC_LANE_CLEARANCE),
	z: midpoint(CITY_KAVELS.park.minZ, CITY_KAVELS.park.maxZ),
	/** Waar de blik op het gebouw landt: het hart van de gevelomtrek, op de eerste verdieping. */
	aimLevel: 'v1',
} as const satisfies { x: number; z: number; aimLevel: LevelId };

interface ProfilePoint {
	name: string;
	pose: RoutePose;
}
interface ProfileRoute {
	id: string;
	description: string;
	seed: number | null;
	points: readonly ProfilePoint[];
}

function eye(level: LevelId): number {
	return levelY(level) + EYE;
}

function point({ name, x, y, z, lookX, lookY, lookZ }: {
	name: string;
	x: number;
	y: number;
	z: number;
	lookX: number;
	lookY: number;
	lookZ: number;
}): ProfilePoint {
	return { name, pose: { x, y, z, lookX, lookY, lookZ } };
}

/**
 * A reproducible west-to-east, ground-to-upper-floor course. It begins with a
 * cheap wall view, crosses the busiest atrium sight lines, climbs the east
 * escalator and finishes at Kruidvat plus the upper atrium.
 */
const MALL_ROUTE: ProfileRoute = {
	id: 'mall-main-v1',
	description: 'West wall through both atriums, east escalator and Kruidvat',
	seed: null,
	points: [
		point({ name: 'west-wall', x: -27, y: eye('v0'), z: -1, lookX: -33, lookY: eye('v0'), lookZ: -1 }),
		point({ name: 'west-ring', x: -20, y: eye('v0'), z: -10, lookX: -8, lookY: eye('v0'), lookZ: -8 }),
		point({ name: 'north-spine', x: -6, y: eye('v0'), z: -8, lookX: 0, lookY: 2.2, lookZ: 0 }),
		point({ name: 'atrium-north', x: 0, y: eye('v0'), z: -5, lookX: 0, lookY: 2.2, lookZ: 5 }),
		point({ name: 'atrium-south', x: 0, y: eye('v0'), z: 7, lookX: 0, lookY: 2.2, lookZ: 0 }),
		point({ name: 'east-concourse', x: 14, y: eye('v0'), z: 6, lookX: 21, lookY: 2, lookZ: 1 }),
		point({ name: 'escalator-bottom', x: 21.5, y: eye('v0'), z: 7.5, lookX: 21.5, lookY: eye('v1'), lookZ: -2 }),
		point({ name: 'escalator-top', x: 21.5, y: eye('v1'), z: -1.5, lookX: 14, lookY: eye('v1'), lookZ: -8 }),
		point({ name: 'kruidvat', x: 17, y: eye('v1'), z: -9, lookX: 18, lookY: eye('v1'), lookZ: -15 }),
		point({ name: 'upper-atrium-east', x: 12, y: eye('v1'), z: 0, lookX: 0, lookY: 5, lookZ: 0 }),
		point({ name: 'upper-atrium-south', x: 0, y: eye('v1'), z: 9.5, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
	],
};

/**
 * Hetzelfde standpunt met zijn kijkdoel precies in de rug.
 *
 * Alleen in het horizontale vlak gespiegeld en de blik blijft op ooghoogte: een
 * meegespiegelde neerwaartse hoek richt deze pose op het gras twee meter verderop, en
 * dan meet de tegenmeting de zoden in plaats van de stad erachter.
 */
function backTo(name: string, from: ProfilePoint): ProfilePoint {
	const { pose } = from;
	return {
		name,
		pose: {
			...pose,
			lookX: pose.x + span(pose.lookX, pose.x),
			lookY: pose.y,
			lookZ: pose.z + span(pose.lookZ, pose.z),
		},
	};
}

/** Vanuit het park op de mall. Het enige standpunt dat het hele gebouw van buiten in beeld heeft. */
const PARK_TOWARD_MALL = point(
	{
		name: 'park-buiten-mall',
		x: PARK_VIEW.x,
		y: eye('v0'),
		z: PARK_VIEW.z,
		lookX: midpoint(MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.maxX),
		lookY: levelY(PARK_VIEW.aimLevel),
		lookZ: midpoint(MALL_WALL_ENVELOPE.minZ, MALL_WALL_ENVELOPE.maxZ),
	},
);

/** Dezelfde plek met de mall in de rug: wat er van het gebouw overblijft als niets ervan in beeld staat. */
const PARK_AWAY_FROM_MALL = backTo('park-buiten-weg', PARK_TOWARD_MALL);

interface LevelCourse {
	entry: ProfilePoint;
	areas: readonly ProfilePoint[];
	exit?: ProfilePoint;
}

const FULL_COURSE: readonly LevelCourse[] = [
	{
		entry: point({ name: 'roof-helipad', x: 22, y: eye('roof'), z: 16, lookX: 12, lookY: levelY('roof'), lookZ: 4 }),
		areas: [
			point({ name: 'roof-middle', x: 20, y: eye('roof'), z: 4, lookX: 0, lookY: levelY('roof'), lookZ: 0 }),
			point({ name: 'roof-west', x: -18, y: eye('roof'), z: 8, lookX: 0, lookY: levelY('roof'), lookZ: 0 }),
		],
		exit: point({ name: 'roof-elevator-depart', x: 16, y: eye('roof'), z: -8, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
	},
	{
		entry: point({ name: 'v1-elevator-arrive', x: 16, y: eye('v1'), z: -8, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
		areas: [
			point({ name: 'v1-northeast', x: 14, y: eye('v1'), z: -10, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
			point({ name: 'v1-southeast', x: 14, y: eye('v1'), z: 10, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
			point({ name: 'v1-southwest', x: -14, y: eye('v1'), z: 10, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
			point({ name: 'v1-northwest', x: -14, y: eye('v1'), z: -10, lookX: 0, lookY: eye('v1'), lookZ: 0 }),
		],
		exit: point({ name: 'v1-elevator-depart', x: 16, y: eye('v1'), z: -8, lookX: 0, lookY: eye('v0'), lookZ: 0 }),
	},
	{
		entry: point({ name: 'v0-elevator-arrive', x: 16, y: eye('v0'), z: -8, lookX: 0, lookY: eye('v0'), lookZ: 0 }),
		areas: [
			point({ name: 'v0-northeast', x: 14, y: eye('v0'), z: -10, lookX: 0, lookY: eye('v0'), lookZ: 0 }),
			point({ name: 'v0-southeast', x: 14, y: eye('v0'), z: 10, lookX: 0, lookY: eye('v0'), lookZ: 0 }),
			point({ name: 'v0-center', x: 0, y: eye('v0'), z: 0, lookX: 12, lookY: eye('v0'), lookZ: 0 }),
			point({ name: 'v0-southwest', x: -14, y: eye('v0'), z: 10, lookX: 0, lookY: eye('v0'), lookZ: 0 }),
			point({ name: 'v0-west-corridor', x: -26, y: eye('v0'), z: 0, lookX: -14, lookY: eye('v0'), lookZ: 0 }),
			// Van de stoep terug op de hoofdingang. Het enige standpunt buiten de
			// gevel op dit dek: de luifel, het portaal en de belettering zijn van
			// binnenuit onzichtbaar en op een plattegrond een streep.
			point({
				name: 'v0-entrance-street',
				x: ENTRANCE_PORTAL.outerX - ENTRANCE_STREET_VIEW.back,
				y: eye('v0'),
				z: ENTRANCE_PORTAL.centerZ + ENTRANCE_STREET_VIEW.side,
				lookX: ENTRANCE_PORTAL.innerX,
				lookY: ENTRANCE_STREET_VIEW.aim,
				lookZ: ENTRANCE_PORTAL.centerZ,
			}),
			PARK_TOWARD_MALL,
			PARK_AWAY_FROM_MALL,
			point({ name: 'v0-northwest', x: -14, y: eye('v0'), z: -10, lookX: 0, lookY: eye('v0'), lookZ: 0 }),
		],
		exit: point({ name: 'v0-elevator-depart', x: 16, y: eye('v0'), z: -8, lookX: 0, lookY: eye('p1'), lookZ: 0 }),
	},
	{
		entry: point({ name: 'p1-elevator-arrive', x: 16, y: eye('p1'), z: -8, lookX: 0, lookY: eye('p1'), lookZ: 0 }),
		areas: [
			point({ name: 'p1-northeast', x: 20, y: eye('p1'), z: -14, lookX: 0, lookY: eye('p1'), lookZ: 0 }),
			point({ name: 'p1-southeast', x: 20, y: eye('p1'), z: 14, lookX: 0, lookY: eye('p1'), lookZ: 0 }),
			point({ name: 'p1-center', x: 0, y: eye('p1'), z: 0, lookX: 20, lookY: eye('p1'), lookZ: 0 }),
			point({ name: 'p1-southwest', x: -20, y: eye('p1'), z: 14, lookX: 0, lookY: eye('p1'), lookZ: 0 }),
			point({ name: 'p1-northwest', x: -20, y: eye('p1'), z: -14, lookX: 0, lookY: eye('p1'), lookZ: 0 }),
			point({
				name: 'p1-exit-bottom',
				x: PARKING_EXIT_RAMP.start.x,
				y: PARKING_EXIT_RAMP.start.y + EYE,
				z: PARKING_EXIT_RAMP.start.z,
				lookX: PARKING_EXIT_RAMP.end.x,
				lookY: PARKING_EXIT_RAMP.end.y + EYE,
				lookZ: PARKING_EXIT_RAMP.end.z,
			}),
			point({
				name: 'p1-exit-mid',
				x: midpoint(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x),
				y: midpoint(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) + EYE,
				z: midpoint(PARKING_EXIT_RAMP.start.z, PARKING_EXIT_RAMP.end.z),
				lookX: PARKING_EXIT_RAMP.end.x,
				lookY: PARKING_EXIT_RAMP.end.y + EYE,
				lookZ: PARKING_EXIT_RAMP.end.z,
			}),
			point({
				name: 'p1-exit-top',
				x: PARKING_EXIT_RAMP.end.x,
				y: PARKING_EXIT_RAMP.end.y + EYE,
				z: PARKING_EXIT_RAMP.end.z,
				lookX: PARKING_EXIT_RAMP.start.x,
				lookY: PARKING_EXIT_RAMP.start.y + EYE,
				lookZ: PARKING_EXIT_RAMP.start.z,
			}),
		],
	},
];

function fullMallRoute(seed: number | null = null): ProfileRoute {
	const random = seed === null ? null : mulberry32(seed);
	const points: ProfilePoint[] = [];
	for (const level of FULL_COURSE) {
		points.push(level.entry);
		points.push(...(random ? shuffled(level.areas, random) : level.areas));
		if (level.exit) points.push(level.exit);
	}
	return {
		id: 'mall-full-v1',
		description: 'Roof through V1 and V0 to P1 and its city exit, sampling multiple areas on every level',
		seed,
		points,
	};
}

const FULL_MALL_ROUTE = fullMallRoute();
const PROFILE_ROUTES: readonly ProfileRoute[] = [FULL_MALL_ROUTE, MALL_ROUTE];

function profileRoute(id: string, seed: number | null = null): ProfileRoute {
	if (id === FULL_MALL_ROUTE.id) return fullMallRoute(seed);
	const route = PROFILE_ROUTES.find((candidate) => candidate.id === id);
	if (!route) throw new Error(`unknown route '${id}'; choose ${PROFILE_ROUTES.map((candidate) => candidate.id).join(', ')}`);
	if (seed !== null) throw new Error(`route '${id}' does not support shuffled level fixtures`);
	return route;
}

function profilePoint(name: string): ProfilePoint {
	for (const route of PROFILE_ROUTES) {
		const found = route.points.find((candidate) => candidate.name === name);
		if (found) return found;
	}
	throw new Error(`unknown profile point '${name}'`);
}

export type { ProfilePoint, ProfileRoute };
export { FULL_MALL_ROUTE, MALL_ROUTE, PROFILE_ROUTES, fullMallRoute, profilePoint, profileRoute };
