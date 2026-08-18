import { EXIT_BRANCH_ROUTE, ROAD_RINGS, TRAFFIC_LANE_CLEARANCE } from '#/scene/city/cityPlan';
import { distanceToSegment2 } from '#/util/geometry2';
import { at } from '#/util/rand';
import { nr } from './world.ts';

/**
 * Whether a measuring viewpoint stands clear of every lane and of the branch to the garage.
 */
export function trafficConflicts(name: string, x: number, z: number): string[] {
	const out: string[] = [];
	for (const ring of ROAD_RINGS) {
		for (const edge of ring.edges) {
			const distance = distanceToSegment2(
				{ x, z },
				{ a: { x: edge.ox, z: edge.oz }, b: { x: edge.ox + edge.dx * edge.len, z: edge.oz + edge.dz * edge.len } },
			);
			if (distance < TRAFFIC_LANE_CLEARANCE) {
				out.push(
					`${name} stands ${nr(distance)} m from a lane, less than the ${nr(TRAFFIC_LANE_CLEARANCE)} m a car takes up on its own`,
				);
			}
		}
	}
	for (let i = 0; i + 1 < EXIT_BRANCH_ROUTE.length; i++) {
		const from = at(EXIT_BRANCH_ROUTE, i);
		const to = at(EXIT_BRANCH_ROUTE, i + 1);
		const distance = distanceToSegment2({ x, z }, { a: from, b: to });
		if (distance < TRAFFIC_LANE_CLEARANCE) out.push(`${name} stands ${nr(distance)} m from the branch to the garage`);
	}
	return out;
}
