import { type LevelId, levelY } from '#/data/levels';
import { PARKING_EXIT_RAMP } from '#/data/world';
import { EYE } from '#/player/constants';
import type { RoutePose } from './probe.ts';

export type ProfilePoint = { name: string; pose: RoutePose };
export type ProfileRoute = { id: string; description: string; seed: number | null; points: readonly ProfilePoint[] };

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

type LevelCourse = {
	entry: ProfilePoint;
	areas: readonly ProfilePoint[];
	exit?: ProfilePoint;
};

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
				(PARKING_EXIT_RAMP.start.x + PARKING_EXIT_RAMP.end.x) / 2,
				(PARKING_EXIT_RAMP.start.y + PARKING_EXIT_RAMP.end.y) / 2 + EYE,
				(PARKING_EXIT_RAMP.start.z + PARKING_EXIT_RAMP.end.z) / 2,
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

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
	const result = [...values];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const current = result[i];
		const replacement = result[j];
		if (current === undefined || replacement === undefined) continue;
		result[i] = replacement;
		result[j] = current;
	}
	return result;
}

export function fullMallRoute(seed: number | null = null): ProfileRoute {
	const random = seed === null ? null : seededRandom(seed);
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
