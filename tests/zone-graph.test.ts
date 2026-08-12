import { describe, expect, test } from 'bun:test';
import { NOT_A_PORTAL_TAG } from '#/data/spatial';
import { ATRIUM_OPENING, ENTRANCE_ENTITY, PARKING_EXIT_RAMP_ENTITY, WORLD_ENTITIES } from '#/data/world';
import { portalOfEntity, reachableZones, ZONE_PORTALS, ZONES, zoneOfLevel, zonesOfMask } from '#/data/zones';

/**
 * The zone graph: every zone reachable, and every declared see-through accounted for.
 *
 * The graph is derived from the clearance and glass volumes of the world model, so a zone
 * is closed off by moving geometry and not by forgetting a list. That is exactly why it
 * needs checking: a deck nobody can see is no longer drawn by the render cull either, and
 * then a whole floor is quietly gone.
 */

describe('every zone is reachable through portals', () => {
	test.each([...ZONES])('from %s', (zone) => {
		const reachable = reachableZones(zone);
		const missing = ZONES.filter((target) => !reachable.includes(target));
		expect(missing, `${missing.join(', ')} cannot be reached from ${zone} through any portal`).toBeEmpty();
	});
});

describe('a portal has something to see through', () => {
	test('every portal carries at least one interface face', () => {
		const blind = ZONE_PORTALS.filter((portal) => portal.faces.length === 0).map(
			(portal) => `${portal.id} touches ${zonesOfMask(portal.mask).join(' and ')} but has no face`,
		);
		expect(blind, blind.join('\n')).toBeEmpty();
	});
});

/**
 * An entity that declares clearance or glass is a portal, unless it writes down that it
 * connects nothing. An exemption that does connect is the same fault as an unused permit
 * on the facade.
 */
describe('declaring see-through and connecting two zones are the same thing', () => {
	test('no entity carries the tag while connecting two zones', () => {
		const wrong = WORLD_ENTITIES.filter((entity) => {
			const candidate = portalOfEntity(entity);
			return candidate !== null && zonesOfMask(candidate.mask).length > 1 && entity.tags.includes(NOT_A_PORTAL_TAG);
		}).map((entity) => `${entity.id} carries ${NOT_A_PORTAL_TAG} but connects two zones`);
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});

	test('no entity declares see-through into nothing without the tag', () => {
		const wrong = WORLD_ENTITIES.filter((entity) => {
			const candidate = portalOfEntity(entity);
			return candidate !== null && zonesOfMask(candidate.mask).length <= 1 && !entity.tags.includes(NOT_A_PORTAL_TAG);
		}).map((entity) => `${entity.id} declares see-through and connects nothing; tag it or give it a second zone`);
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});

	test('no entity carries the tag without declaring see-through at all', () => {
		const wrong = WORLD_ENTITIES.filter(
			(entity) => portalOfEntity(entity) === null && entity.tags.includes(NOT_A_PORTAL_TAG),
		).map((entity) => `${entity.id} carries ${NOT_A_PORTAL_TAG} but declares no see-through`);
		expect(wrong, wrong.join('\n')).toBeEmpty();
	});
});

/**
 * The main entrance is glass from the floor to above the V1 deck line, so it ties the
 * street to both shop decks. And it must not tie V0 to V1: there is a floor slab between
 * them.
 */
describe('the main entrance', () => {
	const entrance = ZONE_PORTALS.find((portal) => portal.id === ENTRANCE_ENTITY.id);

	test('is a portal at all', () => {
		expect(entrance, `${ENTRANCE_ENTITY.id} is not a portal, while it is the only door in the facade`).toBeDefined();
	});

	test.each(['mall-v0', 'mall-v1'] as const)('looks from the pavement into %s', (deck) => {
		expect(entrance?.faces.some((face) => face.from === 'stad' && face.to === deck)).toBeTrue();
	});

	test('reports no see-through from V0 to V1', () => {
		expect(entrance?.faces.some((face) => face.from === 'mall-v0' && face.to === 'mall-v1')).toBeFalse();
	});
});

/** The atrium is one shaft from the ground floor to the skylight. */
describe('the atrium', () => {
	const atrium = ZONE_PORTALS.find((portal) => portal.id === `opening-${ATRIUM_OPENING.id}`);

	test('is a portal at all', () => {
		expect(atrium, `opening-${ATRIUM_OPENING.id} is not a portal`).toBeDefined();
	});

	// Both directions: `connects` and the built shaft have to name exactly the same zones.
	test('connects the zones it declares', () => {
		const declared = ATRIUM_OPENING.connects.map(zoneOfLevel).toSorted().join(', ');
		expect(
			zonesOfMask(atrium?.mask ?? 0)
				.toSorted()
				.join(', '),
		).toBe(declared);
	});

	test('looks from the roof down onto the ground floor', () => {
		expect(atrium?.faces.some((face) => face.from === 'roof' && face.to === 'mall-v0')).toBeTrue();
	});
});

/**
 * The exit trench ties the street to the garage and not to the shop floor: the ramp's
 * clearance is one coarse box straight through the west facade, and at V0 height
 * `wall_w_above_exit` stands there. Without this bite the graph reported a thirteen square
 * metre window and the cull drew half the interior from the pavement.
 */
describe('the parking exit trench', () => {
	const trench = ZONE_PORTALS.find((portal) => portal.id === PARKING_EXIT_RAMP_ENTITY.id);

	test('is a portal at all', () => {
		expect(trench, `${PARKING_EXIT_RAMP_ENTITY.id} is not a portal, while it ties the garage to the city`).toBeDefined();
	});

	test('looks from the pavement into the garage', () => {
		expect(trench?.faces.some((face) => face.from === 'stad' && face.to === 'p1')).toBeTrue();
	});

	test('opens the pavement onto nothing else', () => {
		const extra = (trench?.faces ?? [])
			.filter((face) => face.from === 'stad' && face.to !== 'p1')
			.map((face) => `the trench reports see-through from the pavement to ${face.to}, while the west facade is closed`);
		expect(extra, extra.join('\n')).toBeEmpty();
	});
});
