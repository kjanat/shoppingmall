import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { distanceToSegment2, pointInSegmentStrip2, segmentParameter2 } from '#/util/geometry2';
import { clamp, clamp01, half, inverseLerpClamped, lerp, midpoint, span } from '#/util/math';
import { median } from './perf/stats.ts';

describe('shared calculations', () => {
	test('scalar and interval helpers preserve their boundary semantics', () => {
		assert.equal(half(8), 4);
		assert.equal(midpoint(-6, 14), 4);
		assert.equal(span(-6, 14), 20);
		assert.equal(lerp(-6, 14, 0.25), -1);
		assert.equal(clamp(8, -2, 5), 5);
		assert.equal(clamp01(-0.1), 0);
		assert.equal(inverseLerpClamped(10, 20, 15), 0.5);
		assert.equal(inverseLerpClamped(10, 10, 15), 0);
	});

	test('segment helpers clamp projection and use the finite strip ends', () => {
		assert.equal(segmentParameter2(5, 2, 0, 0, 10, 0), 0.5);
		assert.equal(segmentParameter2(-5, 0, 0, 0, 10, 0), 0);
		assert.equal(distanceToSegment2(5, 3, 0, 0, 10, 0), 3);
		assert.equal(pointInSegmentStrip2(5, 0.9, 0, 0, 10, 0, 2), true);
		assert.equal(pointInSegmentStrip2(11, 0, 0, 0, 10, 0, 2), false);
	});

	test('performance median keeps the existing upper-middle convention', () => {
		assert.equal(median([]), 0);
		assert.equal(median([9, 1, 4]), 4);
		assert.equal(median([9, 1, 4, 7]), 7);
	});
});
