import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { levelY } from '#/data/levels';
import { MALL_WALL_ENVELOPE, PARKING_EXIT_RAMP } from '#/data/world';
import { EYE } from '#/player/constants';
import { CITY_KAVELS, ROAD_RINGS, TRAFFIC_LANE_CLEARANCE } from '#/scene/city/cityPlan';
import { distanceToSegment2 } from '#/util/geometry2';
import { midpoint } from '#/util/math';
import { FULL_MALL_ROUTE, fullMallRoute, profilePoint } from './routes.ts';

function names(seed: number | null = null): string[] {
	return fullMallRoute(seed).points.map((point) => point.name);
}

function firstIndex(points: readonly string[], prefix: string): number {
	return points.findIndex((name) => name.startsWith(prefix));
}

describe('full-building performance route', () => {
	test('descends from roof through every level and samples multiple areas on each', () => {
		const points = names();
		const roof = firstIndex(points, 'roof-');
		const v1 = firstIndex(points, 'v1-');
		const v0 = firstIndex(points, 'v0-');
		const p1 = firstIndex(points, 'p1-');

		assert.equal(roof, 0);
		assert.ok(roof < v1 && v1 < v0 && v0 < p1);
		for (const prefix of ['roof-', 'v1-', 'v0-', 'p1-']) {
			assert.ok(points.filter((name) => name.startsWith(prefix)).length >= 3, `${prefix} needs multiple viewpoints`);
		}
		assert.equal(FULL_MALL_ROUTE.seed, null);
	});

	test('uses the canonical deck and player eye heights', () => {
		for (const [name, level] of [
			['roof-elevator-depart', 'roof'],
			['v1-elevator-arrive', 'v1'],
			['v0-elevator-arrive', 'v0'],
			['p1-elevator-arrive', 'p1'],
		] as const) {
			assert.equal(profilePoint(name).pose.y, levelY(level) + EYE);
		}
		assert.equal(profilePoint('p1-exit-bottom').pose.y, PARKING_EXIT_RAMP.start.y + EYE);
		assert.equal(profilePoint('p1-exit-mid').pose.y, midpoint(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) + EYE);
		assert.equal(profilePoint('p1-exit-top').pose.y, PARKING_EXIT_RAMP.end.y + EYE);
	});

	test('parks both outdoor viewpoints on the same clear spot, one facing the mall and one facing away', () => {
		const toward = profilePoint('park-buiten-mall');
		const away = profilePoint('park-buiten-weg');

		assert.deepEqual(
			{ x: away.pose.x, y: away.pose.y, z: away.pose.z },
			{ x: toward.pose.x, y: toward.pose.y, z: toward.pose.z },
			'the two park poses must differ only in where they look',
		);
		for (const { name, pose } of [toward, away]) {
			const { park } = CITY_KAVELS;
			assert.ok(
				pose.x >= park.minX && pose.x <= park.maxX && pose.z >= park.minZ && pose.z <= park.maxZ,
				`${name} stands outside the park lot`,
			);
			for (const ring of ROAD_RINGS) {
				for (const edge of ring.edges) {
					const gap = distanceToSegment2(
						pose.x,
						pose.z,
						edge.ox,
						edge.oz,
						edge.ox + edge.dx * edge.len,
						edge.oz + edge.dz * edge.len,
					);
					assert.ok(gap >= TRAFFIC_LANE_CLEARANCE, `${name} stands ${gap.toFixed(2)} m from a traffic lane`);
				}
			}
		}
		// Every corner of the facade envelope in front of the one pose and behind the
		// other. Per corner rather than per centre: on ninety metres the building still
		// covers a wide arc, so a centre in front says nothing about its far corner.
		for (const [viewpoint, expected] of [
			[toward, true],
			[away, false],
		] as const) {
			const { pose } = viewpoint;
			for (const cornerX of [MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.maxX]) {
				for (const cornerZ of [MALL_WALL_ENVELOPE.minZ, MALL_WALL_ENVELOPE.maxZ]) {
					const ahead = (pose.lookX - pose.x) * (cornerX - pose.x) + (pose.lookZ - pose.z) * (cornerZ - pose.z) > 0;
					assert.equal(ahead, expected, `${viewpoint.name} has facade corner (${cornerX}, ${cornerZ}) on the wrong side`);
				}
			}
		}
	});

	test('replays one seed exactly and changes only area ordering for another seed', () => {
		const authored = names();
		const first = names(0x1234_5678);
		const repeated = names(0x1234_5678);
		const other = names(0x8765_4321);

		assert.deepEqual(first, repeated);
		assert.notDeepEqual(first, other);
		assert.deepEqual([...first].sort(), [...authored].sort());
		assert.deepEqual([...other].sort(), [...authored].sort());
	});
});
