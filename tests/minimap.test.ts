import { describe, expect, test } from 'bun:test';
import { LEVELS, levelAt, levelY } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { HELIPAD_PAD_SPEC, THEATRE_FLOOR_Y, THEATRE_PLAN, THEATRE_PORTAL, WORLD_ENTITIES } from '#/data/world';
import type { MapFeature } from '#/ui/KioskOverlay';
import { featuresOn, minimapLabelPlan } from '#/ui/KioskOverlay';
import { midpoint, span } from '#/util/math';
import { profilePoint } from '$/scripts/perf/routes.ts';
import { stubTextMeasure } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * What the dish draws, and where the deck plan differs from it.
 *
 * The two maps answer different questions, and [KioskOverlay](src/ui/KioskOverlay.ts) says so:
 * the deck plan is about the mall and fits itself to the mall's own outline, so a second
 * building fifty metres away would shrink it to a third of the canvas. The dish stands around
 * the player and is world-wide. That difference is the `'mall'` and `'world'` scope, and it is
 * the whole reason the theatre is on one and not the other.
 *
 * Everything below reads the same selector the painter reads, so a level that draws nothing,
 * an outdoors that draws only the mall, or a venue with no interior on the dish shows up here
 * rather than on the screen.
 */

const metric = stubTextMeasure();
/** Half the dish, in metres, at its default zoom: beyond this a feature is off the edge. */
const DISH_REACH = 50;

function labelsAt(x: number, z: number, y: number, yaw = 0): string[] {
	return minimapLabelPlan(metric, { x, z, yaw, level: levelAt(y) }).plan.map((planned) => planned.text);
}

function named(features: readonly MapFeature[]): string[] {
	return features.map((feature) => feature.label).filter((label) => label !== '');
}

/** A feature carries its label on one line; the entity writes it with the break the map draws. */
function oneLine(label: string): string {
	return label.split('\n').join(' ');
}

function labelOf(entity: (typeof WORLD_ENTITIES)[number]): string {
	return oneLine(entity.map.label ?? '');
}

describe.each(LEVELS.map((level) => level.id))('standing on %s', (id) => {
	const dish = featuresOn(id, 'world');
	const plan = featuresOn(id, 'mall');

	test('the dish draws something at all', () => {
		expect(dish, 'the dish is empty on this deck, so you navigate by nothing').not.toBeEmpty();
	});

	test('the deck plan is a subset of the dish', () => {
		const dishLabels = new Set(named(dish));
		const extra = named(plan).filter((label) => !dishLabels.has(label));
		expect(extra, `the deck plan draws what the dish does not: ${extra.join(', ')}`).toBeEmpty();
	});

	// A label is carried by more than one entity — both staircases are TRAP — so a label belongs
	// on this deck as soon as any entity carrying it does.
	test('nothing from another deck leaks onto it', () => {
		const strangers = named(dish).filter(
			(label) => !WORLD_ENTITIES.some((entity) => labelOf(entity) === label && entity.levels.includes(id)),
		);
		expect(strangers, `${strangers.join(', ')} belongs to another deck`).toBeEmpty();
	});
});

/**
 * A room is drawn where its own geometry crosses the cut plane, `PLAN_CUT_HEIGHT` over the deck.
 * That is a section drawing and the right idea, but the plane is measured from the deck and not
 * from the floor the room stands on, and a room whose geometry lies entirely above or below it
 * is silently dropped: it keeps its label, its layer and its place in the schema, and appears on
 * no map at all.
 */
describe('every labelled room reaches a cut plane somewhere', () => {
	const CUT_HEIGHT = 1.2;
	const drawn = new Set(LEVELS.flatMap((level) => named(featuresOn(level.id, 'world'))));
	const labelled = WORLD_ENTITIES.filter((entity) => entity.map.visible && labelOf(entity) !== '');

	test.each(labelled.map((entity) => entity.id))('%s', (id) => {
		const entity = labelled.find((candidate) => candidate.id === id);
		if (!entity) return;
		const label = labelOf(entity);
		if (drawn.has(label)) return;
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

/**
 * Outdoors the dish is the only map you have: the deck plan deliberately leaves the city out.
 * So everything standing outside the mall footprint has to be on the dish and off the plan.
 */
describe('the city on the dish and off the deck plan', () => {
	const outsideByLevel = LEVELS.map((level) => ({
		id: level.id,
		outside: featuresOn(level.id, 'world').filter((feature) => !feature.inMall),
	}));

	test('there is city geometry to draw at all', () => {
		const total = outsideByLevel.reduce((count, level) => count + level.outside.length, 0);
		expect(total, 'no feature outside the mall footprint on any deck, so this proves nothing').toBeGreaterThan(0);
	});

	test.each(outsideByLevel.map((level) => level.id))('the %s deck plan leaves the city out', (id) => {
		const outsideOnPlan = featuresOn(id, 'mall').filter((feature) => !feature.inMall);
		expect(
			outsideOnPlan.map((feature) => feature.label),
			'the deck plan draws city geometry and shrinks the mall',
		).toBeEmpty();
	});
});

/**
 * Standing outdoors the dish is the only map there is, so it has to have something to say about
 * where you are. The park is the case that fails: it is lawn, verge and benches in the scene and
 * carries no map-visible entity, so from the park bench the nearest thing the dish knows is the
 * theatre, over a hundred metres away and far outside the dish.
 */
describe.each(['v0-entrance-street', 'park-buiten-mall'])('from the viewpoint %s', (name) => {
	const { pose } = profilePoint(name);
	const level = levelAt(pose.y);

	test('something mapped stands within reach of the dish', () => {
		const reach = ((): number => {
			const nearest = featuresOn(level, 'world')
				.map((feature) => Math.hypot(feature.anchor.x - pose.x, feature.anchor.z - pose.z))
				.toSorted((a, b) => a - b)[0];
			return nearest ?? Number.POSITIVE_INFINITY;
		})();
		expect(reach, `the nearest mapped thing is ${nr(reach)} m away, so the dish has nothing to draw here`).toBeLessThanOrEqual(
			DISH_REACH,
		);
	});

	test('the dish names something', () => {
		const labels = labelsAt(pose.x, pose.z, pose.y);
		expect(labels, 'the dish names nothing here').not.toBeEmpty();
	});
});

/**
 * The roof is the one deck with a painted layer of its own on top of the schema layers: the
 * skylight, the helipad H, the pool and the slide tower. The entities behind them have to be on
 * the roof deck, or that layer draws over an empty plan.
 */
describe('the roof deck', () => {
	const roof = featuresOn('roof', 'world');
	const labels = new Set(named(roof));

	test.each(['roof-terrace', 'helipad-deck', 'roof-slide'])('%s is on the roof plan', (id) => {
		const entity = WORLD_ENTITIES.find((candidate) => candidate.id === id);
		expect(entity, `${id} is gone from the world model`).toBeDefined();
		if (!entity) return;
		expect(labels.has(labelOf(entity)), `${id} is not drawn on the roof deck`).toBeTrue();
	});

	test('the helipad ring the roof layer draws sits on the deck it draws it on', () => {
		const deck = WORLD_ENTITIES.find((candidate) => candidate.id === 'helipad-deck');
		expect(deck?.levels.includes('roof'), 'the roof layer draws the helipad H on a deck the pad does not stand on').toBeTrue();
		expect(HELIPAD_PAD_SPEC.mapRadius, 'the helipad ring has no radius to draw').toBeGreaterThan(0);
	});

	test('standing on the roof the dish names the roof', () => {
		const labelsHere = labelsAt(HELIPAD_PAD_SPEC.center.x, HELIPAD_PAD_SPEC.center.z, levelY('roof'));
		expect(labelsHere, 'the dish names nothing while you stand on the helipad').not.toBeEmpty();
	});
});

/**
 * The venue case: inside the theatre the dish is the only map that has the building at all. Its
 * interior is a set of entities of its own, and standing in the hall the dish should name what
 * is around you rather than the mall you are fifty metres away from.
 */
describe('inside the theatre', () => {
	const deck = levelAt(THEATRE_FLOOR_Y);
	const inside = { x: THEATRE_PORTAL.centerX, z: midpoint(THEATRE_PLAN.hall.minZ, THEATRE_PLAN.hall.maxZ) };
	const labels = labelsAt(inside.x, inside.z, THEATRE_FLOOR_Y);
	const theatreLabels = new Set(
		WORLD_ENTITIES.filter((entity) => entity.id.startsWith('theatre-') && entity.map.visible).map((entity) => labelOf(entity)),
	);

	test('the theatre has map-visible interior of its own', () => {
		expect(
			[...theatreLabels].filter((label) => label !== ''),
			'the theatre has no labelled interior to draw',
		).not.toBeEmpty();
	});

	test('the deck the hall floor sits on carries it', () => {
		const onDeck = named(featuresOn(deck, 'world')).filter((label) => theatreLabels.has(label));
		expect(
			onDeck,
			`nothing of the theatre is on the ${deck} plan, the deck its floor at ${nr(THEATRE_FLOOR_Y)} sits on`,
		).not.toBeEmpty();
	});

	test('the dish names the theatre around you', () => {
		const here = labels.filter((label) => theatreLabels.has(label));
		expect(here, `standing in the hall the dish names ${labels.length === 0 ? 'nothing' : labels.join(', ')}`).not.toBeEmpty();
	});

	test('the mall deck plan does not draw it', () => {
		const onPlan = named(featuresOn(deck, 'mall')).filter((label) => theatreLabels.has(label));
		expect(onPlan, `the deck plan draws ${onPlan.join(', ')} and shrinks the mall to fit a second building`).toBeEmpty();
	});
});

/**
 * The dish rotates around the player, so what it names depends on where you stand. If the same
 * set came back everywhere it would be a picture and not a map.
 */
test('the dish names different places in different buildings', () => {
	const inTheMall = labelsAt(0, 0, levelY('v0')).toSorted().join(', ');
	const atTheTheatre = labelsAt(THEATRE_PORTAL.centerX, midpoint(THEATRE_PLAN.hall.minZ, THEATRE_PLAN.hall.maxZ), THEATRE_FLOOR_Y)
		.toSorted()
		.join(', ');
	expect(atTheTheatre, 'the dish names the same things in the mall and in the theatre').not.toBe(inTheMall);
});

test('the deck plan and the dish disagree by exactly the city', () => {
	// If they ever came out the same, one of the two scopes stopped doing anything.
	const differing = LEVELS.filter((level) => {
		const dish = named(featuresOn(level.id, 'world')).length;
		const plan = named(featuresOn(level.id, 'mall')).length;
		return dish !== plan;
	});
	expect(
		differing,
		`no deck where the dish shows more than the plan; the ${nr(span(0, 2))} scopes are the same thing`,
	).not.toBeEmpty();
});
