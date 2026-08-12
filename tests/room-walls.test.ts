import { describe, expect, test } from 'bun:test';
import type { SpatialVolume } from '#/data/spatial';
import { geometryBounds } from '#/data/spatial';
import { WORLD_ENTITIES } from '#/data/world';
import { stubDocument } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * The floor plan draws the walls from the world model and the player walks into the boxes from
 * `getColliders()`. Those two stood up to 30 cm apart, and the restroom divider existed only
 * as a collision box: five metres of invisible wall across one drawn room.
 */

stubDocument();
const { Scene } = await import('three');
const [{ LightPool }, { Restrooms }, { PrayerRoom }, { BeardCave }] = await Promise.all([
	import('#/render/LightPool'),
	import('#/scene/Restrooms'),
	import('#/scene/PrayerRoom'),
	import('#/scene/BeardCave'),
]);

/**
 * Which collision box belongs to which volume. `entity:volume` where the volume sits on
 * another entity: the wudu niche is an entity of its own but is built by the restrooms, and
 * without that spelling that bench would have had no box at all.
 */
const ROOM_WALLS: Record<string, Record<string, string>> = {
	restrooms: {
		wc_wall_w: 'wall-west',
		wc_wall_e: 'wall-east',
		wc_wall_s: 'wall-south',
		wc_divider: 'divider',
		wc_wudu_bench: 'wudu-niche:bench',
	},
	'prayer-room': { prayer_back: 'wall-north', prayer_w: 'wall-west', prayer_e: 'wall-east' },
	'beard-cave': { cave_back: 'cave-back-wall', cave_n: 'cave-wall-north', cave_s: 'cave-wall-south' },
};

const BY_ID = new Map(WORLD_ENTITIES.map((entity) => [entity.id, entity]));

function wallVolume(roomId: string, reference: string): SpatialVolume | null {
	const split = reference.indexOf(':');
	const entityId = split < 0 ? roomId : reference.slice(0, split);
	const volumeId = split < 0 ? reference : reference.slice(split + 1);
	return BY_ID.get(entityId)?.volumes.find((candidate) => candidate.id === volumeId) ?? null;
}

const pool = new LightPool(new Scene());
const ROOMS: Record<string, { minX: number; maxX: number; minZ: number; maxZ: number; label: string }[]> = {
	restrooms: new Restrooms(pool).getColliders(),
	'prayer-room': new PrayerRoom(pool).getColliders(),
	'beard-cave': new BeardCave(pool).getColliders(),
};

describe.each(Object.keys(ROOM_WALLS))('%s', (roomId) => {
	const table = ROOM_WALLS[roomId] ?? {};
	const colliders = ROOMS[roomId] ?? [];

	test('is still in the world model', () => {
		expect(BY_ID.get(roomId), `${roomId} is gone from WORLD_ENTITIES`).toBeDefined();
	});

	test.each(Object.keys(table))('the box %s exists and names a volume that exists', (label) => {
		const reference = table[label] ?? '';
		expect(
			colliders.some((collider) => collider.label === label),
			`${roomId} has no collision box '${label}' any more, renamed or dropped`,
		).toBeTrue();
		expect(wallVolume(roomId, reference), `${roomId} has no volume '${reference}' for collision box '${label}'`).not.toBeNull();
	});

	test('every collision box belongs to a drawn volume', () => {
		const orphans = colliders
			.filter((collider) => table[collider.label] === undefined)
			.map((collider) => `collision box '${collider.label}' belongs to no volume at all`);
		expect(orphans, orphans.join('\n')).toBeEmpty();
	});

	test('every box stands exactly where its wall is drawn', () => {
		const drifted: string[] = [];
		for (const collider of colliders) {
			const reference = table[collider.label];
			if (reference === undefined) continue;
			const volume = wallVolume(roomId, reference);
			if (!volume) continue;
			const drawn = geometryBounds(volume.geometry);
			for (const [side, box, model] of [
				['minX', collider.minX, drawn.minX],
				['maxX', collider.maxX, drawn.maxX],
				['minZ', collider.minZ, drawn.minZ],
				['maxZ', collider.maxZ, drawn.maxZ],
			] as const) {
				if (Math.abs(box - model) <= 1e-6) continue;
				drifted.push(`${reference}: the box ${side} ${nr(box)} differs from the drawn wall (${nr(model)})`);
			}
		}
		expect(drifted, drifted.join('\n')).toBeEmpty();
	});
});
