import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import { MALL_SLAB_SPECS, slabCeilingAbove } from '#/data/world';
import { HOVER_HEIGHT, SAUCER_BOB, SAUCER_DOME_RISE, saucerHoverY } from '#/scene/AlienProbe';

/**
 * The saucer stays under the ceiling that actually hangs over its victims.
 *
 * Clamped to the roof it hovered over a V0 cluster with its dome straight through the V1
 * floor. The ceiling differs per column, and under the atrium opening there is none.
 */

const V0 = levelY('v0');
const V1 = levelY('v1');
/** A column that is covered on both decks, away from the atrium and the connectors. */
const COVERED = { x: 20, z: -10 };

function domeTop(floorY: number, x: number, z: number): number {
	return saucerHoverY(floorY, x, z) + SAUCER_BOB + SAUCER_DOME_RISE;
}

const DECKS = [
	{ name: 'V0 sits under the V1 slab', floorY: V0, underside: MALL_SLAB_SPECS.v1.topY - MALL_SLAB_SPECS.v1.thickness },
	{ name: 'V1 sits under the roof slab', floorY: V1, underside: MALL_SLAB_SPECS.roof.topY - MALL_SLAB_SPECS.roof.thickness },
];

describe('the saucer stays under the ceiling above its victims', () => {
	// Each measuring point proves its own assumption first: a point that secretly sits
	// under an opening would quietly empty the clamp requirement.
	test.each(DECKS)('$name', ({ floorY, underside }) => {
		expect(slabCeilingAbove(COVERED.x, COVERED.z, floorY), 'the measuring point has no ceiling above it').toBe(underside);
		expect(domeTop(floorY, COVERED.x, COVERED.z), 'the dome pokes through the slab above it').toBeLessThanOrEqual(underside);
	});

	test('under the open atrium there is nothing to clamp to', () => {
		expect(slabCeilingAbove(0, 0, V0), 'the atrium heart should be open up to the skylight').toBeNull();
		expect(saucerHoverY(V0, 0, 0)).toBe(V0 + HOVER_HEIGHT);
	});
});
