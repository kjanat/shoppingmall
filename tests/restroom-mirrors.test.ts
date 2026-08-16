import { describe, expect, test } from 'bun:test';
import { geometryBounds } from '#/data/spatial';
import { RESTROOMS_MIRRORS, RESTROOMS_SPEC, WORLD_ENTITIES } from '#/data/world';
import { half } from '#/util/math';

/**
 * The restroom mirrors hang on a closed wall, not on the opening.
 *
 * The ladies' mirror hung at z −2.55, the open north side of the block: a wall that does
 * not exist. It belongs above the basins against a closed wall from the shell. Every
 * mirror names that wall; this reads the wall volume out of the restrooms entity and
 * demands the mirror's back sits on the inner face and fits inside it.
 */

const EPS = 1e-6;
const WALL_VOLUME: Record<string, string> = { south: 'wall-south', east: 'wall-east', west: 'wall-west' };

const RESTROOMS = WORLD_ENTITIES.find((entity) => entity.id === 'restrooms');

function nr(value: number): string {
	return Number(value.toFixed(3)).toString();
}

function close(a: number, b: number): boolean {
	return Math.abs(a - b) <= EPS;
}

describe('every restroom mirror hangs on a closed wall', () => {
	test('the restrooms entity still exists', () => {
		expect(RESTROOMS, 'restrooms is gone from WORLD_ENTITIES').toBeDefined();
	});

	test.each(RESTROOMS_MIRRORS.map((mirror) => mirror.id))('%s', (id) => {
		const mirror = RESTROOMS_MIRRORS.find((candidate) => candidate.id === id);
		expect(mirror).toBeDefined();
		if (!(mirror && RESTROOMS)) return;

		const wallId = WALL_VOLUME[mirror.wall];
		expect(wallId, `hangs on '${mirror.wall}', which is the opening and not a closed wall of the shell`).toBeDefined();
		if (wallId === undefined) return;

		const wall = RESTROOMS.volumes.find((volume) => volume.id === wallId);
		expect(wall, `points at wall '${wallId}', which no longer exists`).toBeDefined();
		if (!wall) return;

		expect(wall.blocksMovement, `'${wallId}' does not block movement`).toBeTrue();
		expect(wall.role, `'${wallId}' is not solid`).toBe('solid');

		const bounds = geometryBounds(wall.geometry);
		const x = RESTROOMS_SPEC.center.x + mirror.x;
		const z = RESTROOMS_SPEC.center.z + mirror.z;
		const halfThick = half(mirror.thickness);
		const halfWide = half(mirror.width);

		if (mirror.wall === 'south') {
			const back = z + halfThick;
			expect(close(back, bounds.minZ), `its back sits at z ${nr(back)}, not against ${wallId} at ${nr(bounds.minZ)}`).toBeTrue();
			expect(x - halfWide, `reaches past the wall in x (${nr(bounds.minX)} to ${nr(bounds.maxX)})`).toBeGreaterThanOrEqual(
				bounds.minX - EPS,
			);
			expect(x + halfWide).toBeLessThanOrEqual(bounds.maxX + EPS);
			return;
		}

		const inner = mirror.wall === 'east' ? bounds.minX : bounds.maxX;
		const back = mirror.wall === 'east' ? x + halfThick : x - halfThick;
		expect(close(back, inner), `its back sits at x ${nr(back)}, not against ${wallId} at ${nr(inner)}`).toBeTrue();
		expect(z - halfWide, `reaches past the wall in z (${nr(bounds.minZ)} to ${nr(bounds.maxZ)})`).toBeGreaterThanOrEqual(
			bounds.minZ - EPS,
		);
		expect(z + halfWide).toBeLessThanOrEqual(bounds.maxZ + EPS);
	});
});
