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

export interface ProfilePoint {
	name: string;
	pose: RoutePose;
}
export interface ProfileRoute {
	id: string;
	description: string;
	seed: number | null;
	points: readonly ProfilePoint[];
}

function eye(level: LevelId): number {
	return levelY(level) + EYE;
}

function point(name: string, x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number): ProfilePoint {
	return { name, pose: { x, y, z, lookX, lookY, lookZ } };
}

/**
 * A reproducible west-to-east, ground-to-upper-floor course. It begins with a
 * cheap wall view, crosses the busiest atrium sight lines, climbs the east
 * escalator and finishes at Kruidvat plus the upper atrium.
 */
export const MALL_ROUTE: ProfileRoute = {
	id: 'mall-main-v1',
	description: 'West wall through both atriums, east escalator and Kruidvat',
	seed: null,
	points: [
		point('west-wall', -27, eye('v0'), -1, -33, eye('v0'), -1),
		point('west-ring', -20, eye('v0'), -10, -8, eye('v0'), -8),
		point('north-spine', -6, eye('v0'), -8, 0, 2.2, 0),
		point('atrium-north', 0, eye('v0'), -5, 0, 2.2, 5),
		point('atrium-south', 0, eye('v0'), 7, 0, 2.2, 0),
		point('east-concourse', 14, eye('v0'), 6, 21, 2, 1),
		point('escalator-bottom', 21.5, eye('v0'), 7.5, 21.5, eye('v1'), -2),
		point('escalator-top', 21.5, eye('v1'), -1.5, 14, eye('v1'), -8),
		point('kruidvat', 17, eye('v1'), -9, 18, eye('v1'), -15),
		point('upper-atrium-east', 12, eye('v1'), 0, 0, 5, 0),
		point('upper-atrium-south', 0, eye('v1'), 9.5, 0, eye('v1'), 0),
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
	'park-buiten-mall',
	PARK_VIEW.x,
	eye('v0'),
	PARK_VIEW.z,
	midpoint(MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.maxX),
	levelY(PARK_VIEW.aimLevel),
	midpoint(MALL_WALL_ENVELOPE.minZ, MALL_WALL_ENVELOPE.maxZ),
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
		entry: point('roof-helipad', 22, eye('roof'), 16, 12, levelY('roof'), 4),
		areas: [
			point('roof-middle', 20, eye('roof'), 4, 0, levelY('roof'), 0),
			point('roof-west', -18, eye('roof'), 8, 0, levelY('roof'), 0),
		],
		exit: point('roof-elevator-depart', 16, eye('roof'), -8, 0, eye('v1'), 0),
	},
	{
		entry: point('v1-elevator-arrive', 16, eye('v1'), -8, 0, eye('v1'), 0),
		areas: [
			point('v1-northeast', 14, eye('v1'), -10, 0, eye('v1'), 0),
			point('v1-southeast', 14, eye('v1'), 10, 0, eye('v1'), 0),
			point('v1-southwest', -14, eye('v1'), 10, 0, eye('v1'), 0),
			point('v1-northwest', -14, eye('v1'), -10, 0, eye('v1'), 0),
		],
		exit: point('v1-elevator-depart', 16, eye('v1'), -8, 0, eye('v0'), 0),
	},
	{
		entry: point('v0-elevator-arrive', 16, eye('v0'), -8, 0, eye('v0'), 0),
		areas: [
			point('v0-northeast', 14, eye('v0'), -10, 0, eye('v0'), 0),
			point('v0-southeast', 14, eye('v0'), 10, 0, eye('v0'), 0),
			point('v0-center', 0, eye('v0'), 0, 12, eye('v0'), 0),
			point('v0-southwest', -14, eye('v0'), 10, 0, eye('v0'), 0),
			point('v0-west-corridor', -26, eye('v0'), 0, -14, eye('v0'), 0),
			// Van de stoep terug op de hoofdingang. Het enige standpunt buiten de
			// gevel op dit dek: de luifel, het portaal en de belettering zijn van
			// binnenuit onzichtbaar en op een plattegrond een streep.
			point(
				'v0-entrance-street',
				ENTRANCE_PORTAL.outerX - ENTRANCE_STREET_VIEW.back,
				eye('v0'),
				ENTRANCE_PORTAL.centerZ + ENTRANCE_STREET_VIEW.side,
				ENTRANCE_PORTAL.innerX,
				ENTRANCE_STREET_VIEW.aim,
				ENTRANCE_PORTAL.centerZ,
			),
			PARK_TOWARD_MALL,
			PARK_AWAY_FROM_MALL,
			point('v0-northwest', -14, eye('v0'), -10, 0, eye('v0'), 0),
		],
		exit: point('v0-elevator-depart', 16, eye('v0'), -8, 0, eye('p1'), 0),
	},
	{
		entry: point('p1-elevator-arrive', 16, eye('p1'), -8, 0, eye('p1'), 0),
		areas: [
			point('p1-northeast', 20, eye('p1'), -14, 0, eye('p1'), 0),
			point('p1-southeast', 20, eye('p1'), 14, 0, eye('p1'), 0),
			point('p1-center', 0, eye('p1'), 0, 20, eye('p1'), 0),
			point('p1-southwest', -20, eye('p1'), 14, 0, eye('p1'), 0),
			point('p1-northwest', -20, eye('p1'), -14, 0, eye('p1'), 0),
			point(
				'p1-exit-bottom',
				PARKING_EXIT_RAMP.start.x,
				PARKING_EXIT_RAMP.start.y + EYE,
				PARKING_EXIT_RAMP.start.z,
				PARKING_EXIT_RAMP.end.x,
				PARKING_EXIT_RAMP.end.y + EYE,
				PARKING_EXIT_RAMP.end.z,
			),
			point(
				'p1-exit-mid',
				midpoint(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x),
				midpoint(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) + EYE,
				midpoint(PARKING_EXIT_RAMP.start.z, PARKING_EXIT_RAMP.end.z),
				PARKING_EXIT_RAMP.end.x,
				PARKING_EXIT_RAMP.end.y + EYE,
				PARKING_EXIT_RAMP.end.z,
			),
			point(
				'p1-exit-top',
				PARKING_EXIT_RAMP.end.x,
				PARKING_EXIT_RAMP.end.y + EYE,
				PARKING_EXIT_RAMP.end.z,
				PARKING_EXIT_RAMP.start.x,
				PARKING_EXIT_RAMP.start.y + EYE,
				PARKING_EXIT_RAMP.start.z,
			),
		],
	},
];

export function fullMallRoute(seed: number | null = null): ProfileRoute {
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

export const FULL_MALL_ROUTE = fullMallRoute();
export const PROFILE_ROUTES: readonly ProfileRoute[] = [FULL_MALL_ROUTE, MALL_ROUTE];

export function profileRoute(id: string, seed: number | null = null): ProfileRoute {
	if (id === FULL_MALL_ROUTE.id) return fullMallRoute(seed);
	const route = PROFILE_ROUTES.find((candidate) => candidate.id === id);
	if (!route) throw new Error(`unknown route '${id}'; choose ${PROFILE_ROUTES.map((candidate) => candidate.id).join(', ')}`);
	if (seed !== null) throw new Error(`route '${id}' does not support shuffled level fixtures`);
	return route;
}

export function profilePoint(name: string): ProfilePoint {
	for (const route of PROFILE_ROUTES) {
		const found = route.points.find((candidate) => candidate.name === name);
		if (found) return found;
	}
	throw new Error(`unknown profile point '${name}'`);
}
