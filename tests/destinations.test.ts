import { describe, expect, test } from 'bun:test';
import { NODES } from '#/data/graph';
import { STORES } from '#/data/stores';
import { WORLD_ENTITIES } from '#/data/world';

/**
 * The directory and the graph name places; the world model builds them.
 *
 * As long as nothing held those two against each other, five destinations could keep
 * existing as a name with nothing ever standing there. A destination without geometry may
 * therefore only exist with a reason attached, and that reason has to go the moment the
 * geometry arrives.
 */

/** Where a store finds its geometry when it is not called `shop-<id>`. */
const STORE_ENTITY: Record<string, string> = {
	toilets: 'restrooms',
	prayer: 'prayer-room',
	beard_cave: 'beard-cave',
	helipad: 'helipad-deck',
	secret_stairs: 'secret-stairs',
	elevator: 'glass-elevator',
	parking: 'parking-deck',
	info: 'info-kiosk',
	foodcourt: 'food-court',
	protest: 'protest',
};

/** And where a node label finds its own, when no store points at that node. */
const NODE_ENTITY: Record<string, string> = {
	entrance_street: 'main-entrance',
	entrance_hall: 'main-entrance',
	f0_c: 'opening-atrium',
	e0: 'east-escalator',
	e1: 'east-escalator',
	st0: 'west-stairs',
	st1: 'west-stairs',
	elev_fb: 'glass-elevator',
	elev_f1: 'glass-elevator',
	elev_f2: 'glass-elevator',
	sec_mid: 'secret-stairs',
	s_kruidvat: 'shop-kruidvat',
};

const STORE_WITHOUT_ENTITY: Record<string, string> = {};

const NODE_WITHOUT_ENTITY: Record<string, string> = {
	f0_ww: 'corridor point in the western strip, not a destination',
	roof_mid: 'path point between the lift and the helipad, not a destination',
};

const STORE_IDS = new Set(STORES.map((store) => store.id));
const NODE_IDS = new Set(NODES.map((node) => node.id));
const BY_ID = new Map(WORLD_ENTITIES.map((entity) => [entity.id, entity]));
const STORE_PER_NODE = new Map(STORES.map((store) => [String(store.nodeId), store.id]));
const LABELLED_NODES = NODES.filter((node) => node.label !== undefined);

describe('the destination tables point at things that exist', () => {
	test('every store named in STORE_ENTITY is in the directory and its target in the world', () => {
		const wrong = Object.entries(STORE_ENTITY).flatMap(([id, target]) => [
			...(STORE_IDS.has(id) ? [] : [`STORE_ENTITY names store ${id}, which is not in STORES`]),
			...(BY_ID.has(target) ? [] : [`STORE_ENTITY points ${id} at ${target}, which is not in WORLD_ENTITIES`]),
		]);
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});

	test('every node named in NODE_ENTITY is in the graph and its target in the world', () => {
		const wrong = Object.entries(NODE_ENTITY).flatMap(([id, target]) => [
			...(NODE_IDS.has(id) ? [] : [`NODE_ENTITY names node ${id}, which is not in the graph`]),
			...(BY_ID.has(target) ? [] : [`NODE_ENTITY points ${id} at ${target}, which is not in WORLD_ENTITIES`]),
		]);
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});

	test('every exemption names something that still exists', () => {
		const wrong = [
			...Object.keys(STORE_WITHOUT_ENTITY)
				.filter((id) => !STORE_IDS.has(id))
				.map((id) => `store ${id} is not in STORES`),
			...Object.keys(NODE_WITHOUT_ENTITY)
				.filter((id) => !NODE_IDS.has(id))
				.map((id) => `node ${id} is not in the graph`),
		];
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});
});

describe.each(STORES.map((store) => store.id))('store %s', (id) => {
	const target = STORE_ENTITY[id] ?? `shop-${id}`;
	const exists = BY_ID.has(target);
	const reason = STORE_WITHOUT_ENTITY[id];

	test('has geometry, or an exemption that is still true', () => {
		if (reason === undefined) {
			expect(exists, `in the directory but has no entity ${target}: it exists as text only`).toBeTrue();
			return;
		}
		expect(exists, `exempt ("${reason}") but now has ${target} — drop the exemption`).toBeFalse();
	});
});

describe.each(LABELLED_NODES.map((node) => node.id))('node %s', (id) => {
	const node = LABELLED_NODES.find((candidate) => candidate.id === id);
	const viaStore = STORE_PER_NODE.get(id);
	const target = NODE_ENTITY[id];
	const reason = NODE_WITHOUT_ENTITY[id];

	test('is claimed by exactly one source', () => {
		const claims = [viaStore, target, reason].filter((value) => value !== undefined);
		expect(
			claims.length,
			`"${node?.label}" sits in more than one table; let one source point at its geometry`,
		).toBeLessThanOrEqual(1);
		expect(claims.length, `"${node?.label}" names a place with no entity: give it geometry or exempt it`).toBeGreaterThan(0);
	});
});
