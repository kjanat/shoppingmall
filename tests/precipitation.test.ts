import { describe, expect, test } from 'bun:test';
import { coversColumn, ZONE_ENCLOSURES } from '#/data/zones';
import { midpoint } from '#/util/math';
import { stubDocument } from '$/scripts/stub-dom.ts';

/**
 * Rain and snow fall outside, never through a roof.
 *
 * It snowed inside the theatre because the sky dropped its columns over the whole city
 * plate. Whether a column is dry is derived from the same shells as the zone graph, so a
 * new building keeps its own weather out by existing.
 */

stubDocument();
const { CitySky } = await import('#/scene/city/CitySky');

function nr(value: number): string {
	return Number(value.toFixed(3)).toString();
}

const COLUMNS = new CitySky().precipitationColumns();

describe('nothing falls under a roof', () => {
	test('no precipitation column sits under a building', () => {
		const indoors = COLUMNS.filter((column) => coversColumn(column.x, column.z)).map(
			(column) => `(${nr(column.x)}, ${nr(column.z)})`,
		);
		expect(indoors, `${indoors.length} drop(s) fall under a roof, among them ${indoors.slice(0, 3).join(' ')}`).toBeEmpty();
	});

	// The exclusion must not be empty: every building heart should count as covered, or a
	// drop check that finds nothing would also pass on a shell that covers no one.
	test.each(ZONE_ENCLOSURES.map((enclosure) => enclosure.id))('the heart of %s counts as covered', (id) => {
		const enclosure = ZONE_ENCLOSURES.find((candidate) => candidate.id === id);
		expect(enclosure).toBeDefined();
		if (!enclosure) return;
		const x = midpoint(enclosure.plan.minX, enclosure.plan.maxX);
		const z = midpoint(enclosure.plan.minZ, enclosure.plan.maxZ);
		expect(coversColumn(x, z), `(${nr(x)}, ${nr(z)}) is not called covered`).toBeTrue();
	});
});
