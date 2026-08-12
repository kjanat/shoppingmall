import { describe, expect, test } from 'bun:test';
import { LEVELS, levelAt, levelY } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { HELIPAD_PAD_SPEC, THEATRE_FLOOR_Y, THEATRE_PLAN, THEATRE_PORTAL, WORLD_ENTITIES } from '#/data/world';
import type { MapFeature } from '#/ui/KioskOverlay';
import { featuresOn, minimapLabelPlan } from '#/ui/KioskOverlay';
import { midpoint } from '#/util/math';
import { profilePoint } from '$/scripts/perf/routes.ts';
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
/** Half the minimap, in metres, at its default zoom: beyond this a feature is off the edge. */
const MINIMAP_REACH = 50;
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
		const level = levelAt(pose.y);

		test('has a mapped place inside its own radius', () => {
			const nearest =
				featuresOn(level, 'world')
					.map((feature) => Math.hypot(feature.anchor.x - pose.x, feature.anchor.z - pose.z))
					.toSorted((a, b) => a - b)[0] ?? Number.POSITIVE_INFINITY;
			expect(nearest, `the nearest mapped thing is ${nr(nearest)} m away, so there is nothing to draw`).toBeLessThanOrEqual(
				MINIMAP_REACH,
			);
		});

		test('prints at least one place name', () => {
			expect(labelsAt(pose.x, pose.z, pose.y), 'it names nothing here').not.toBeEmpty();
		});
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
