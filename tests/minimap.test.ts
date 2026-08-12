import { describe, expect, test } from 'bun:test';
import {
	CON_CENTER,
	CON_DARKROOM,
	CON_DEALERS,
	CON_FLOOR_Y,
	CON_HOTEL,
	CON_LABEL,
	CON_PLAZA,
	CON_ROOM_LABELS,
	CON_STAGE,
	CON_STUDIO,
} from '#/data/conPlan';
import { LEVELS, levelAt, levelY } from '#/data/levels';
import { POOL_CENTER, poolFloorY } from '#/data/pool';
import { geometryBounds, pointInPlan } from '#/data/spatial';
import { HELIPAD_PAD_SPEC, THEATRE_FLOOR_Y, THEATRE_PLAN, THEATRE_PORTAL, WORLD_ENTITIES } from '#/data/world';
import { deckAt } from '#/data/zones';
import { PARK_LAWN } from '#/scene/city/CityPark';
import { CITY_GROUND_Y, COLOSSEUM_PLAN, FAVELA_PLAN, GARAGE_DECKS, LANE_X, RIO_MOUNTAIN } from '#/scene/city/cityPlan';
import type { MapFeature } from '#/ui/KioskOverlay';
import { featuresOn, minimapLabelPlan } from '#/ui/KioskOverlay';
import { midpoint } from '#/util/math';
import { profilePoint } from '$/scripts/perf/routes.ts';
import { read } from './helpers/source-scan.ts';
import { stubTextMeasure } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * What the minimap draws, and where the big deck plan differs from it.
 *
 * The two maps answer different questions, and [KioskOverlay](src/ui/KioskOverlay.ts) says so:
 * the deck plan is about the mall and fits itself to the mall's own outline, so a second
 * building fifty metres away would shrink it to a third of the canvas. The minimap stands
 * around the player and is world-wide. That difference is the `'mall'` and `'world'` scope, and
 * it is the whole reason the theatre is on one and not the other.
 */

const metric = stubTextMeasure();
/** How far over a deck the plan takes its section, out of `PLAN_CUT_HEIGHT`. */
const CUT_HEIGHT = 1.2;

function labelsAt(x: number, z: number, y: number, yaw = 0): string[] {
	return minimapLabelPlan(metric, { x, z, yaw, level: levelAt(y) }).plan.map((planned) => planned.text);
}

function named(features: readonly MapFeature[]): string[] {
	return features.map((feature) => feature.label).filter((label) => label !== '');
}

/** A feature carries its label on one line; the entity writes it with the break the map draws. */
function labelOf(entity: (typeof WORLD_ENTITIES)[number]): string {
	return (entity.map.label ?? '').split('\n').join(' ');
}

function labelsOnDeck(x: number, z: number, level: (typeof LEVELS)[number]['id'], yaw = 0): string[] {
	return minimapLabelPlan(metric, { x, z, yaw, level }).plan.map((planned) => planned.text);
}

function center(rect: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>): { x: number; z: number } {
	return { x: midpoint(rect.minX, rect.maxX), z: midpoint(rect.minZ, rect.maxZ) };
}

function localLabels(x: number, z: number, y: number, yaw = 0): string[] {
	return labelsOnDeck(x, z, deckAt(x, y, z), yaw);
}

describe('the minimap', () => {
	describe.each(LEVELS.map((level) => level.id))('on deck %s', (id) => {
		const minimap = featuresOn(id, 'world');
		const deckPlan = featuresOn(id, 'mall');

		test('draws at least one room', () => {
			expect(minimap, 'it is empty here, so you navigate by nothing').not.toBeEmpty();
		});

		test('draws everything the big deck plan draws', () => {
			const drawn = new Set(named(minimap));
			const missing = named(deckPlan).filter((label) => !drawn.has(label));
			expect(missing, `the deck plan draws what the minimap does not: ${missing.join(', ')}`).toBeEmpty();
		});

		// A label is carried by more than one entity — both staircases are TRAP — so a label
		// belongs on this deck as soon as any entity carrying it does.
		test('draws no room that belongs to another deck', () => {
			const strangers = named(minimap).filter(
				(label) => !WORLD_ENTITIES.some((entity) => labelOf(entity) === label && entity.levels.includes(id)),
			);
			expect(strangers, `${strangers.join(', ')} belongs to another deck`).toBeEmpty();
		});
	});

	/**
	 * The roof is the one deck with a painted layer of its own over the schema layers: the
	 * skylight, the helipad H, the pool and the slide tower. The entities behind them have to be
	 * on the roof deck, or that layer paints over an empty plan.
	 */
	describe('on the roof', () => {
		const drawn = new Set(named(featuresOn('roof', 'world')));

		describe.each(['roof-terrace', 'helipad-deck', 'roof-slide'])('%s', (id) => {
			const entity = WORLD_ENTITIES.find((candidate) => candidate.id === id);

			test('is still in the world model', () => {
				expect(entity, `${id} is gone`).toBeDefined();
			});

			test('is drawn on the roof plan', () => {
				if (!entity) return;
				expect(drawn.has(labelOf(entity)), 'it is not drawn on the roof deck').toBeTrue();
			});
		});

		describe('the helipad ring the roof layer paints', () => {
			const pad = WORLD_ENTITIES.find((candidate) => candidate.id === 'helipad-deck');

			test('is painted on the deck the pad stands on', () => {
				expect(pad?.levels.includes('roof'), 'the roof layer paints the H on a deck the pad does not stand on').toBeTrue();
			});

			test('has a radius to paint with', () => {
				expect(HELIPAD_PAD_SPEC.mapRadius).toBeGreaterThan(0);
			});
		});

		test('prints a place name while you stand on the helipad', () => {
			const here = labelsAt(HELIPAD_PAD_SPEC.center.x, HELIPAD_PAD_SPEC.center.z, levelY('roof'));
			expect(here, 'it names nothing while you stand on the pad').not.toBeEmpty();
		});

		test('the app asks the basin-aware deck reader which minimap to show', async () => {
			const source = await read('src/app/App.ts');
			expect(
				/updateMap\s*\(\s*\{[\s\S]*?level:\s*deckAt\s*\(/.test(source),
				'App sends levelAt(camera.y), so a low swimmer receives the V1 minimap',
			).toBeTrue();
		});

		test('a swimmer in the deep basin gets the roof deck', () => {
			const samples: { x: number; z: number; floor: number }[] = [];
			for (let x = POOL_CENTER.x - 8; x <= POOL_CENTER.x + 8; x += 0.5) {
				for (let z = POOL_CENTER.z - 5; z <= POOL_CENTER.z + 5; z += 0.5) {
					const floor = poolFloorY(x, z);
					if (floor !== null) samples.push({ x, z, floor });
				}
			}
			const deepest = samples.toSorted((a, b) => a.floor - b.floor)[0];
			expect(deepest, 'the basin sweep found no pool bottom').toBeDefined();
			if (!deepest) return;
			expect(deckAt(deepest.x, deepest.floor, deepest.z), 'the pool bottom belongs to another deck').toBe('roof');
			expect(levelAt(deepest.floor), 'the sample does not exercise the height-only map bug').not.toBe('roof');
		});
	});

	/**
	 * The venue case: inside the theatre the minimap is the only map that has the building at
	 * all. Its interior is a set of entities of its own, and standing in the hall it should name
	 * what is around you rather than the mall you are fifty metres away from.
	 */
	describe('inside the theatre', () => {
		const deck = levelAt(THEATRE_FLOOR_Y);
		const inside = { x: THEATRE_PORTAL.centerX, z: midpoint(THEATRE_PLAN.hall.minZ, THEATRE_PLAN.hall.maxZ) };
		const printed = labelsAt(inside.x, inside.z, THEATRE_FLOOR_Y);
		const theatreLabels = new Set(
			WORLD_ENTITIES.filter((entity) => entity.id.startsWith('theatre-') && entity.map.visible)
				.map((entity) => labelOf(entity))
				.filter((label) => label !== ''),
		);

		test('the theatre has a labelled interior to draw', () => {
			expect([...theatreLabels], 'the theatre has no labelled rooms at all').not.toBeEmpty();
		});

		test('the deck the hall floor sits on carries theatre rooms', () => {
			const onDeck = named(featuresOn(deck, 'world')).filter((label) => theatreLabels.has(label));
			expect(
				onDeck,
				`nothing of the theatre is on ${deck}, the deck its floor at ${nr(THEATRE_FLOOR_Y)} sits on`,
			).not.toBeEmpty();
		});

		test('prints the name of a theatre room around you', () => {
			const here = printed.filter((label) => theatreLabels.has(label));
			expect(here, `it names ${printed.length === 0 ? 'nothing' : printed.join(', ')}`).not.toBeEmpty();
		});

		test('prints other names than it does in the mall', () => {
			// If the same set came back everywhere it would be a picture and not a map.
			expect(printed.toSorted().join(', '), 'the same names in both buildings').not.toBe(
				labelsAt(0, 0, levelY('v0')).toSorted().join(', '),
			);
		});
	});

	/**
	 * Standing outdoors the minimap is the only map there is, so it has to have something to say
	 * about where you are. The park is lawn, verge and benches in the scene and carries no
	 * map-visible entity at all.
	 */
	describe.each(['v0-entrance-street', 'park-buiten-mall'])('while standing outdoors at %s', (name) => {
		const { pose } = profilePoint(name);

		test('prints at least one place name', () => {
			expect(labelsAt(pose.x, pose.z, pose.y), 'it names nothing here').not.toBeEmpty();
		});
	});
});

describe('the minimap shows the place the player is actually in', () => {
	const places = [
		{
			name: 'Mega Colosseum arena',
			point: { x: COLOSSEUM_PLAN.x, z: COLOSSEUM_PLAN.z },
			y: CITY_GROUND_Y,
			label: COLOSSEUM_PLAN.label,
		},
		{
			name: 'Montanha de Janeiro',
			point: { x: RIO_MOUNTAIN.x, z: RIO_MOUNTAIN.z },
			y: RIO_MOUNTAIN.rockH,
			label: RIO_MOUNTAIN.label,
		},
		{
			name: 'Vila do Monte',
			point: center(FAVELA_PLAN),
			y: midpoint(FAVELA_PLAN.yLow, FAVELA_PLAN.yHigh),
			label: FAVELA_PLAN.label,
		},
	] as const;

	test.each([...places])('$name is named at its own centre', ({ point, y, label }) => {
		const printed = localLabels(point.x, point.z, y);
		expect(printed, `the local minimap names ${printed.length === 0 ? 'nothing' : printed.join(', ')}`).toContain(label);
	});

	const conRooms = [
		{ name: 'dealers den', bounds: CON_DEALERS, label: CON_ROOM_LABELS.dealers },
		{ name: 'main stage', bounds: CON_STAGE, label: CON_ROOM_LABELS.stage },
		{ name: 'con hotel', bounds: CON_HOTEL, label: CON_ROOM_LABELS.hotel },
		{ name: 'darkroom', bounds: CON_DARKROOM, label: CON_ROOM_LABELS.darkroom },
		{ name: 'studio', bounds: CON_STUDIO, label: CON_ROOM_LABELS.studio },
	] as const;

	test('the Fur Con itself is named at its centre', () => {
		expect(localLabels(CON_CENTER.x, CON_CENTER.z, CON_FLOOR_Y)).toContain(CON_LABEL);
	});

	test('the Fur Con is named from its outdoor entrance plaza', () => {
		const point = center(CON_PLAZA);
		expect(localLabels(point.x, point.z, CON_FLOOR_Y), 'the approach to the venue has no local map').toContain(CON_LABEL);
	});

	test.each([...conRooms])('the $name is named inside Fur Con', ({ bounds, label }) => {
		const point = center(bounds);
		const printed = localLabels(point.x, point.z, CON_FLOOR_Y);
		expect(printed, `the local minimap names ${printed.length === 0 ? 'nothing' : printed.join(', ')}`).toContain(label);
	});

	test('the city park has map geometry under the player', () => {
		const point = center(PARK_LAWN);
		const covering = featuresOn('v0', 'world').filter((feature) =>
			feature.shapes.some((shape) => pointInPlan(shape, point.x, point.z)),
		);
		expect(covering, 'the park is scenery outside the minimap model').not.toBeEmpty();
	});

	test('the ring road has map geometry under the player', () => {
		const covering = featuresOn('v0', 'world').filter((feature) => feature.shapes.some((shape) => pointInPlan(shape, LANE_X, 0)));
		expect(covering, 'the outdoor minimap omits the road the player is standing on').not.toBeEmpty();
	});

	test.each(GARAGE_DECKS.map((_deck, index) => [`deck ${index + 1}`, index] as const))(
		'the city garage has a local map on %s',
		(_name, index) => {
			const deck = GARAGE_DECKS[index];
			expect(deck, `garage deck ${index + 1} is missing`).toBeDefined();
			if (!deck) return;
			const point = center(deck);
			expect(localLabels(point.x, point.z, deck.y), 'the garage deck minimap names nothing').not.toBeEmpty();
		},
	);

	test('the roof pool names the venue regardless of player heading', () => {
		const pool = WORLD_ENTITIES.find((entity) => entity.id === 'roof-terrace');
		const label = pool ? labelOf(pool) : '';
		expect(label, 'the roof pool has no authored map label').not.toBe('');
		const missing = [0, Math.PI / 2, Math.PI, -Math.PI / 2].filter(
			(yaw) => !labelsOnDeck(POOL_CENTER.x, POOL_CENTER.z, 'roof', yaw).includes(label),
		);
		expect(missing, `the pool name disappears at headings ${missing.map(nr).join(', ')}`).toBeEmpty();
	});
});

describe('the minimap preserves holes in the deck it draws', () => {
	test('V1 shows the atrium as an opening rather than solid floor', () => {
		const openings = featuresOn('v1', 'world').filter(
			(feature) => feature.layer === 'opening' && feature.shapes.some((shape) => pointInPlan(shape, 0, 0)),
		);
		expect(openings, 'the V1 map paints solid structure across the atrium void').not.toBeEmpty();
	});
});

describe('the big deck plan', () => {
	/** Outdoors the minimap is the only map you have: the deck plan deliberately leaves the city out. */
	describe.each(LEVELS.map((level) => level.id))('of deck %s', (id) => {
		test('draws no city geometry', () => {
			const outside = featuresOn(id, 'mall').filter((feature) => !feature.inMall);
			expect(
				outside.map((feature) => feature.label),
				'it draws city geometry and shrinks the mall',
			).toBeEmpty();
		});
	});

	test('the world has geometry outside the mall to leave out', () => {
		const outside = LEVELS.reduce((count, level) => count + featuresOn(level.id, 'world').filter((f) => !f.inMall).length, 0);
		expect(outside, 'nothing stands outside the mall footprint, so the scopes prove nothing').toBeGreaterThan(0);
	});

	test('differs from the minimap on at least one deck', () => {
		// If they ever came out the same, one of the two scopes stopped doing anything.
		const differing = LEVELS.filter(
			(level) => named(featuresOn(level.id, 'world')).length !== named(featuresOn(level.id, 'mall')).length,
		);
		expect(differing, 'the two scopes draw the same thing everywhere').not.toBeEmpty();
	});
});

/**
 * A room is drawn where its own geometry crosses the cut plane, `PLAN_CUT_HEIGHT` over the deck.
 * That is a section drawing and the right idea, but the plane is measured from the deck and not
 * from the floor the room stands on, so a room whose geometry lies entirely above it is silently
 * dropped: it keeps its label, its layer and its place in the schema, and appears on no map.
 */
describe('the map', () => {
	const drawn = new Set(LEVELS.flatMap((level) => named(featuresOn(level.id, 'world'))));
	const labelled = WORLD_ENTITIES.filter((entity) => entity.map.visible && labelOf(entity) !== '');

	describe.each(labelled.map((entity) => entity.id))('the room %s', (id) => {
		const entity = labelled.find((candidate) => candidate.id === id);

		test('is drawn on some deck', () => {
			if (!entity) return;
			const label = labelOf(entity);
			const cuts = entity.levels.map((level) => `${level} at ${nr(levelY(level) + CUT_HEIGHT)}`).join(', ');
			const solids = entity.volumes
				.filter((volume) => volume.role !== 'storefront-clearance' && volume.role !== 'aisle-clearance')
				.map((volume) => {
					const bounds = geometryBounds(volume.geometry);
					return `${volume.id} ${nr(bounds.minY)}..${nr(bounds.maxY)}`;
				});
			expect(
				drawn.has(label),
				`"${label}" is on no map: its geometry (${solids.join(', ')}) crosses no cut plane (${cuts})`,
			).toBeTrue();
		});
	});
});
