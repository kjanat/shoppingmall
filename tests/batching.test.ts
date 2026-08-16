import { describe, expect, test } from 'bun:test';
import type { Mesh as MeshType } from 'three';
import { MALL_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { SLAB_SPEC_BY_LEVEL } from '#/data/world';
import { zoneBit, zoneMaskOfBounds, zonesOfMask } from '#/data/zones';
import { half } from '#/util/math';
import { stubDocument, stubLocalStorage } from './helpers/stub-dom.ts';

/**
 * No batch loses the deck of one of its sources.
 *
 * The batcher merges same-material surfaces per cell, and the cell key reads the mesh
 * translation rather than the vertex positions, so two plates on different decks with their
 * vertices baked around the origin share a cell and therefore a batch. Static batches skip
 * `update()`, so a mistake in the mask at build time is permanent: that is how the floor batch
 * disappeared, with the mask missing the second deck and no portal cone covering it.
 */

stubDocument();
stubLocalStorage();
const { Box3, BoxGeometry, Mesh, MeshLambertMaterial, Scene, Vector3 } = await import('three');
const { SceneBatcher } = await import('#/render/SceneBatcher');
const { tagZoneSpan, zoneSpanOf } = await import('#/render/ZoneVisibility');

/**
 * The rendered V1 plate ends a fraction below y=6 because of the Float32 positions of
 * ExtrudeGeometry. Its top face is still the V1 floor, so its mask has to carry V1: otherwise
 * it vanishes the moment you turn from the atrium towards the closed south wall and no V1→V0
 * portal cone rescues it.
 */
test('the V1 plate keeps V1 through the rounding at the deck line', () => {
	const topFace = levelY('v1') - 1.2e-8;
	const mask = zoneMaskOfBounds({
		minX: -half(MALL_FOOTPRINT.width),
		maxX: half(MALL_FOOTPRINT.width),
		minY: topFace - SLAB_SPEC_BY_LEVEL.v1.thickness,
		maxY: topFace,
		minZ: -half(MALL_FOOTPRINT.depth),
		maxZ: half(MALL_FOOTPRINT.depth),
	});
	expect(mask & zoneBit('mall-v1'), 'the rendered V1 plate loses V1 to Float32 rounding at the deck line').not.toBe(0);
});

/**
 * A borderline case built on purpose: a sign that declares V1 on top of its V0 box, next to an
 * ordinary surface of the same material, which is what the escalator sign is.
 */
function batchedScene(): { batcher: InstanceType<typeof SceneBatcher>; sign: MeshType } {
	const scene = new Scene();
	const material = new MeshLambertMaterial({ color: 0x808080 });
	const geometry = new BoxGeometry(4, 0.2, 4);
	const floor = new Mesh(geometry, material);
	floor.position.set(0, 0, 0.5);
	scene.add(floor);
	const sign = new Mesh(geometry, material);
	sign.position.set(0, 0, -0.5);
	tagZoneSpan(sign, zoneBit('mall-v1'));
	scene.add(sign);
	return { batcher: new SceneBatcher(scene), sign };
}

const { batcher, sign } = batchedScene();
const BATCHES = [...batcher.auditBatches()];

describe('every batch covers all of its sources', () => {
	test('the borderline sign really landed in a batch carrying its declared V1', () => {
		// Without this the three tests below can pass on a scene where the case never occurred.
		expect(
			BATCHES.some((batch) => batch.sources.includes(sign) && (batch.zoneMask & zoneBit('mall-v1')) !== 0),
			'the borderline sign never reached a batch with its declared V1, so this proves nothing',
		).toBeTrue();
	});

	test('no batch mask misses a declared span', () => {
		const lost = BATCHES.flatMap((batch) =>
			batch.sources
				.map((source) => ({ span: zoneSpanOf(source), mask: batch.zoneMask }))
				.filter((entry) => (entry.mask & entry.span) !== entry.span)
				.map(
					(entry) => `a batch misses the declared span ${zonesOfMask(entry.span)} of a source (mask ${zonesOfMask(entry.mask)})`,
				),
		);
		expect(lost, lost.join('\n')).toBeEmpty();
	});

	test('no batch mask misses the deck a source box stands on', () => {
		const box = new Box3();
		const lost: string[] = [];
		for (const batch of BATCHES) {
			for (const source of batch.sources) {
				box.setFromObject(source);
				if (box.isEmpty()) continue;
				const boxMask = zoneMaskOfBounds({
					minX: box.min.x,
					maxX: box.max.x,
					minY: box.min.y,
					maxY: box.max.y,
					minZ: box.min.z,
					maxZ: box.max.z,
				});
				if ((batch.zoneMask & boxMask) === boxMask) continue;
				lost.push(`a batch misses deck ${zonesOfMask(boxMask)} of a source box (mask ${zonesOfMask(batch.zoneMask)})`);
			}
		}
		expect(lost, lost.join('\n')).toBeEmpty();
	});

	test('every batch sphere holds the boxes of its sources', () => {
		const box = new Box3();
		const corner = new Vector3();
		const outside: string[] = [];
		for (const batch of BATCHES) {
			if (!batch.sphere) continue;
			for (const source of batch.sources) {
				box.setFromObject(source);
				if (box.isEmpty()) continue;
				for (const x of [box.min.x, box.max.x]) {
					for (const y of [box.min.y, box.max.y]) {
						for (const z of [box.min.z, box.max.z]) {
							if (batch.sphere.containsPoint(corner.set(x, y, z))) continue;
							outside.push(`the batch sphere leaves the corner (${x}, ${y}, ${z}) of a source box outside it`);
						}
					}
				}
			}
		}
		expect(outside, outside.join('\n')).toBeEmpty();
	});
});
