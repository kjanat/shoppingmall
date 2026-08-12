import { describe, expect, test } from 'bun:test';
import { NODES } from '#/data/graph';
import { getInventory } from '#/data/inventory';
import { geometryBounds } from '#/data/spatial';
import { STORES, shopStores } from '#/data/stores';
import { entitiesOnLevel, levelsContaining, WORLD_ENTITIES } from '#/data/world';
import { span } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';

/**
 * The directory, the waypoint graph and the world model describe the same shops.
 *
 * A shop that exists in the directory but not as a fixture is a name on a map with
 * nothing behind it, and a shop whose node is missing from the graph cannot be walked to.
 */

const EPS = 1e-6;
const NODE_IDS = new Set(NODES.map((node) => node.id));
const SHOPS = shopStores();

stubDocument();
const { Scene } = await import('three');
const [{ LightPool }, { MallBuilder }, { StockDisplay }] = await Promise.all([
	import('#/render/LightPool'),
	import('#/scene/MallBuilder'),
	import('#/scene/StockDisplay'),
]);

/**
 * Pods and shelves cover exactly `shopStores()`. A utility destination is a name on the plan and
 * nothing else: when only MallBuilder filtered on that and StockDisplay walked STORES itself,
 * there was a ten-metre rack on the landing deck of the helipad, and nine more elsewhere. Both
 * builders are really built here, because ticking off the list says nothing about who uses it.
 */
const mall = new MallBuilder();
mall.build();
// The shelves rent their till lamps from the light pool; how many there are is not the question
// here, and the light tests answer it.
const stock = new StockDisplay(new LightPool(new Scene()));
const BUILT: readonly [string, ReadonlySet<string>][] = [
	['a shop pod', new Set(mall.storeMeshes.keys())],
	['shelves', new Set(stock.registers.keys())],
];

describe.each(BUILT.map(([what]) => what))('%s', (what) => {
	const built = BUILT.find(([candidate]) => candidate === what)?.[1] ?? new Set<string>();

	test('is built for every shop in the directory', () => {
		const missing = SHOPS.filter((shop) => !built.has(shop.id)).map((shop) => `${shop.id} gets none`);
		expect(missing, missing.join('\n')).toBeEmpty();
	});

	test('is built for nothing else', () => {
		const expected = new Set(SHOPS.map((shop) => shop.id));
		const extra = [...built].filter((id) => !expected.has(id)).map((id) => `${id} is a utility destination and gets one anyway`);
		expect(extra, extra.join('\n')).toBeEmpty();
	});
});

describe('the store directory holds together', () => {
	test('no store id appears twice', () => {
		const counts = new Map<string, number>();
		for (const store of STORES) counts.set(store.id, (counts.get(store.id) ?? 0) + 1);
		const twice = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
		expect(twice, twice.join(', ')).toBeEmpty();
	});

	test('every store points at a node in the graph', () => {
		const dangling = STORES.filter((store) => !NODE_IDS.has(store.nodeId)).map(
			(store) => `${store.id} points at node ${store.nodeId}, which is not in the graph`,
		);
		expect(dangling, dangling.join('\n')).toBeEmpty();
	});

	test('the world model holds at least one deck with shop fixtures', () => {
		expect(levelsContaining('shop'), 'no deck carries shop fixtures').not.toBeEmpty();
	});
});

describe.each(SHOPS.map((shop) => shop.id))('%s', (id) => {
	const shop = SHOPS.find((candidate) => candidate.id === id);

	test('has inventory', () => {
		expect(getInventory(id), 'no inventory, so empty shelves').toBeDefined();
	});

	test('stands as a fixture on its own deck', () => {
		if (!shop) return;
		const onDeck = entitiesOnLevel(shop.level);
		expect(
			onDeck.some((entity) => entity.id === `shop-${id}` && entity.category === 'shop'),
			`in the directory but not a fixture on deck ${shop.level}`,
		).toBeTrue();
	});

	test('stands on a deck that carries a floor', () => {
		if (!shop) return;
		const onDeck = entitiesOnLevel(shop.level);
		expect(
			onDeck.some((entity) => entity.tags.includes('slab') && entity.volumes.some((volume) => volume.role === 'support')),
			`deck ${shop.level} has no load-bearing floor`,
		).toBeTrue();
	});
});

/**
 * Catwalk, restrooms, prayer room, cave, travel agency and the parking shell each existed
 * as text alone for a while: an emoji on a loose coordinate in the kiosk and nothing in
 * the world model. They have a footprint now, and that must not quietly go back. An
 * entity without a volume that has size, or with `map.visible = false`, draws as little
 * as no entity at all.
 */
const WRITTEN_FEATURES = [
	'atrium-fountain',
	'beard-cave',
	'catwalk',
	'food-court',
	'info-kiosk',
	'main-entrance',
	'parking-bays',
	'parking-booth',
	'parking-cars',
	'parking-deck',
	'prayer-room',
	'protest',
	'restrooms',
	'roof-furniture',
	'roof-slide',
	'roof-terrace',
	'shop-island_hop',
	'spaceship',
	'tiki-bar',
	'wudu-niche',
];

const BY_ID = new Map(WORLD_ENTITIES.map((entity) => [entity.id, entity]));

describe('a written feature has a body, not just a label', () => {
	test.each(WRITTEN_FEATURES)('%s', (id) => {
		const entity = BY_ID.get(id);
		expect(entity, `${id} is gone from WORLD_ENTITIES — back to a floating label`).toBeDefined();
		if (!entity) return;

		const sized = entity.volumes.some((volume) => {
			const bounds = geometryBounds(volume.geometry);
			return span(bounds.minX, bounds.maxX) > EPS && span(bounds.minZ, bounds.maxZ) > EPS && span(bounds.minY, bounds.maxY) > EPS;
		});
		expect(sized, 'no volume with size in x, z and y').toBeTrue();
		expect(entity.map.visible, 'map.visible is false, so it drops off the floor plan').toBeTrue();
		expect(entity.map.label?.trim() ?? '', 'no map label, so nothing to draw with').not.toBe('');
	});
});
