import type { RoutePose } from './probe.ts';

export type ProfilePoint = { name: string; pose: RoutePose };
export type ProfileRoute = { id: string; description: string; points: readonly ProfilePoint[] };

const EYE_V0 = 1.7;
const EYE_V1 = 7.7;

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
	points: [
		point('west-wall', -27, EYE_V0, -1, -33, EYE_V0, -1),
		point('west-ring', -20, EYE_V0, -10, -8, EYE_V0, -8),
		point('north-spine', -6, EYE_V0, -8, 0, 2.2, 0),
		point('atrium-north', 0, EYE_V0, -5, 0, 2.2, 5),
		point('atrium-south', 0, EYE_V0, 7, 0, 2.2, 0),
		point('east-concourse', 14, EYE_V0, 6, 21, 2, 1),
		point('escalator-bottom', 21.5, EYE_V0, 7.5, 21.5, EYE_V1, -2),
		point('escalator-top', 21.5, EYE_V1, -1.5, 14, EYE_V1, -8),
		point('kruidvat', 17, EYE_V1, -9, 18, EYE_V1, -15),
		point('upper-atrium-east', 12, EYE_V1, 0, 0, 5, 0),
		point('upper-atrium-south', 0, EYE_V1, 9.5, 0, EYE_V1, 0),
	],
};
