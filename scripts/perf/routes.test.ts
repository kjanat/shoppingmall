import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { levelY } from '#/data/levels';
import { PARKING_EXIT_RAMP } from '#/data/world';
import { EYE } from '#/player/constants';
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
		assert.equal(profilePoint('p1-exit-mid').pose.y, (PARKING_EXIT_RAMP.start.y + PARKING_EXIT_RAMP.end.y) / 2 + EYE);
		assert.equal(profilePoint('p1-exit-top').pose.y, PARKING_EXIT_RAMP.end.y + EYE);
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
