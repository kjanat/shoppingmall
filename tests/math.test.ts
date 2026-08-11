import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { distanceToSegment2, pointInSegmentStrip2, segmentParameter2 } from '#/util/geometry2';
import {
	clamp,
	clamp01,
	ease,
	easeFactor,
	half,
	inverseLerpClamped,
	lerp,
	median,
	midpoint,
	shortestAngle,
	span,
} from '#/util/math';
import { jitterWith, mulberry32, plusMinusWith } from '#/util/rand';

describe('shared calculations', () => {
	test('scalar and interval helpers preserve their boundary semantics', () => {
		assert.equal(half(8), 4);
		assert.equal(midpoint(-6, 14), 4);
		assert.equal(span(-6, 14), 20);
		assert.equal(lerp(-6, 14, 0.25), -1);
		assert.equal(lerp(0.1, 0.3, 0), 0.1);
		assert.equal(lerp(0.1, 0.3, 1), 0.3);
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

describe('easing toward a target', () => {
	test('easeFactor stops at the target however long the frame was', () => {
		assert.equal(easeFactor(6, 0.016), 6 * 0.016);
		assert.equal(easeFactor(6, 1), 1);
		assert.equal(easeFactor(0.9, 0), 0);
	});

	test('easeFactor does not care which way round a site wrote the product', () => {
		assert.equal(easeFactor(2.4, 1 / 3), Math.min(1, (1 / 3) * 2.4));
	});

	test('ease returns the weighted lerp its call sites already returned', () => {
		assert.equal(ease(0.35, 0.9, 2.5, 0.02), lerp(0.35, 0.9, Math.min(1, 2.5 * 0.02)));
		assert.equal(ease(1.7, -0.4, 8, 0.0125), lerp(1.7, -0.4, 0.1));
		assert.equal(ease(2, 5, 40, 1), 5);
	});

	test('the additive spelling is a different double, so those sites keep theirs', () => {
		const current = 0.35;
		const target = 0.9;
		assert.equal(ease(current, target, 2.5, 0.02), 0.37749999999999995);
		assert.equal(current + (target - current) * easeFactor(2.5, 0.02), 0.3775);
	});

	test('shortestAngle folds a turn into half a circle either way', () => {
		assert.equal(shortestAngle(0, Math.PI), Math.PI);
		assert.equal(shortestAngle(0, Math.PI * 2), 0);
		assert.equal(shortestAngle(-3, 3), 6 - Math.PI * 2);
		assert.equal(shortestAngle(3, -3), -6 + Math.PI * 2);
	});
});

describe('the shared random shapes', () => {
	test('each form reproduces the expression its call sites wrote out', () => {
		const draw = 0.3;
		const rng = () => draw;
		assert.equal(jitterWith(0.4, rng), (draw - 0.5) * 0.4);
		assert.equal(plusMinusWith(28, rng), (draw * 2 - 1) * 28);
	});

	test('the two forms agree once the half-width is doubled', () => {
		for (const draw of [0.0001, 0.123456789, 0.3, 0.7, 0.9999]) {
			const rng = () => draw;
			for (const extent of [0.18, 0.4, 3, 28, 68]) {
				assert.equal(jitterWith(extent * 2, rng), plusMinusWith(extent, rng));
			}
		}
	});

	test('mulberry32 keeps the stream the city was planned against', () => {
		const rng = mulberry32(0x404);
		assert.equal(rng(), 0.0721409993711859);
		assert.equal(rng(), 0.17390184593386948);
		assert.equal(rng(), 0.9325132640078664);
	});

	test('mulberry32 normalises its seed, so a negative one is its unsigned twin', () => {
		assert.equal(mulberry32(-1)(), mulberry32(0xffffffff)());
	});
});
