import { describe, expect, test } from 'bun:test';
import { VerticalConnectorRegistrySchema, VerticalConnectorSchema } from '#/data/connectors';
import { ATRIUM_VOID } from '#/data/layout';
import { LEVELS, levelY } from '#/data/levels';
import { VERTICAL_CONNECTORS } from '#/data/world';
import type { Ramp } from '#/physics/Collision';
import { RAMP_BAND_MARGIN, WALK_STEP } from '#/physics/Collision';
import { half, lerp, midpoint, span } from '#/util/math';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * What a body finds where the mall changes storey.
 *
 * Two things are deliberately not repeated here, because they cannot drift. `connectorRamp`
 * copies the collision fields of a connector straight into its ramp, so comparing those two
 * compares a value with itself, and the slab holes are generated out of `VERTICAL_CONNECTORS`
 * by `connectorOpeningPlansAt`, so a hole cannot go missing without its connector going too.
 *
 * The authored rules themselves live in the zod registry in
 * [connectors](src/data/connectors.ts), and that schema turned out to run nowhere: the deleted
 * world check was its only caller, `build.ts` runs only the level registry, and the spatial
 * tests parse hand-made variants. So the registry is parsed here, and the rest of this file is
 * what neither the schema nor the generator holds: a ramp written by hand instead of derived,
 * the opening against the collision box rather than against the flight, and the walk.
 */

/** A hole is cut around the landings, so it may reach this far past the flight and no further. */
const HOLE_MARGIN = 0.8;
/** The longest flight runs 12 m, so this samples it roughly every 3 cm. */
const SAMPLES = 400;
/** Just outside the ramp band, and then two heights no reading tolerance reaches. */
const BELOW_THE_FOOT = [RAMP_BAND_MARGIN * 2, 1, 2];

const DECK_HEIGHTS = [...LEVELS.map((level) => level.y), ...world.platforms.map((platform) => platform.y)];
const CONNECTOR_IDS = new Set<string>(VERTICAL_CONNECTORS.map((connector) => connector.id));

function rampOf(label: string): Ramp {
	const ramp = world.ramps.find((candidate) => candidate.label === label);
	if (!ramp) throw new Error(`no ramp ${label} in the collision world`);
	return ramp;
}

/**
 * Every rule the connector schema encodes, applied to the connectors the game actually ships:
 * the incline range, the opening against the flight, the collision box against the flight, a
 * carry speed on an escalator, tread and riser against one step, the landing over its
 * endpoint. Parsed per connector as well as as a registry, because the registry rules (unique
 * ids, unique opening ids) fail without naming a culprit and the per-connector parse names one.
 */
describe('the authored connectors', () => {
	test('the registry parses', () => {
		const result = VerticalConnectorRegistrySchema.safeParse(VERTICAL_CONNECTORS);
		const issues = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
		expect(issues, issues.join('\n')).toBeEmpty();
	});

	test.each(VERTICAL_CONNECTORS.map((connector) => connector.id))('%s parses on its own', (id) => {
		const connector = VERTICAL_CONNECTORS.find((candidate) => candidate.id === id);
		const result = VerticalConnectorSchema.safeParse(connector);
		const issues = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
		expect(issues, issues.join('\n')).toBeEmpty();
	});
});

/**
 * For a connector these are the zod schema over again; for a ramp written straight into
 * `CollisionWorld.ramps` they are the only reading of it there is, and that is the case this
 * loop exists for.
 */
describe.each(world.ramps.map((ramp) => ramp.label))('flight %s', (label) => {
	const ramp = rampOf(label);
	const lowZ = Math.min(ramp.zBottom, ramp.zTop);
	const highZ = Math.max(ramp.zBottom, ramp.zTop);

	test('runs uphill over a footprint with area', () => {
		expect(ramp.minX, `minX ${nr(ramp.minX)} does not sit left of maxX ${nr(ramp.maxX)}`).toBeLessThan(ramp.maxX);
		expect(span(lowZ, highZ), 'the flight has no length in z').toBeGreaterThan(EPS);
		expect(ramp.yTop, `yTop ${nr(ramp.yTop)} does not sit above yBottom ${nr(ramp.yBottom)}`).toBeGreaterThan(ramp.yBottom);
	});

	test('opens the deck above it over the flight and no further', () => {
		expect(ramp.openMinZ, `openMinZ ${nr(ramp.openMinZ)} does not come before openMaxZ ${nr(ramp.openMaxZ)}`).toBeLessThan(
			ramp.openMaxZ,
		);
		expect(
			ramp.openMinZ,
			`the hole starts at ${nr(ramp.openMinZ)}, more than ${nr(HOLE_MARGIN)} m before the flight (${nr(lowZ)})`,
		).toBeGreaterThanOrEqual(lowZ - HOLE_MARGIN);
		expect(
			ramp.openMaxZ,
			`the hole ends at ${nr(ramp.openMaxZ)}, more than ${nr(HOLE_MARGIN)} m past the flight (${nr(highZ)})`,
		).toBeLessThanOrEqual(highZ + HOLE_MARGIN);
		expect(
			ramp.openMaxZ > lowZ && ramp.openMinZ < highZ,
			`the hole ${nr(ramp.openMinZ)}..${nr(ramp.openMaxZ)} lies beside the flight ${nr(lowZ)}..${nr(highZ)}`,
		).toBeTrue();
	});

	test.each([
		['yBottom', ramp.yBottom],
		['yTop', ramp.yTop],
	] as const)('%s stands at a height that exists', (end, y) => {
		expect(
			DECK_HEIGHTS.some((height) => Math.abs(height - y) <= EPS),
			`${end} ${nr(y)} is neither a deck nor a platform height (${DECK_HEIGHTS.map(nr).join(', ')})`,
		).toBeTrue();
	});

	test('is either a connector or a ramp somebody decided to write by hand', () => {
		expect(
			CONNECTOR_IDS.has(label) || label === 'slide_ladder',
			`${label} is a new hand-written ramp; the zod registry never sees it, so decide here what holds it`,
		).toBeTrue();
	});
});

/**
 * The collision box is authored beside the flight rather than from it, so it can sit
 * off-centre or reach wider than the hole above it while the schema is satisfied: the schema
 * relates each of them to the flight and never to each other.
 */
describe.each(VERTICAL_CONNECTORS.map((connector) => connector.id))('%s', (id) => {
	const connector = VERTICAL_CONNECTORS.find((candidate) => candidate.id === id);
	if (!connector) throw new Error(`no connector ${id}`);
	const { collision, opening } = connector;

	test('has its collision box centred on the flight', () => {
		expect(midpoint(collision.minX, collision.maxX), 'the collision box hangs to one side of the flight').toBeCloseTo(
			connector.x,
			3,
		);
	});

	test('has a hole at least as wide as its collision box', () => {
		expect(
			opening.size.width,
			`the ${nr(opening.size.width)} m opening is narrower than the ${nr(span(collision.minX, collision.maxX))} m collision box, so the truss pokes through the slab`,
		).toBeGreaterThanOrEqual(span(collision.minX, collision.maxX) - 1e-3);
	});

	/**
	 * Walking the line never reaches the `openMinZ`/`openMaxZ` arm of `groundHeightAt`: on the
	 * line the flight is already within `step` and an earlier branch answers. Stepping into the
	 * stairwell from the deck above is what reads the hole band. Only the connectors pierce a
	 * deck, so only they have somewhere to fall from.
	 */
	test('stepping into the hole from the deck above drops you onto the flight', () => {
		const ramp = rampOf(id);
		const z = midpoint(ramp.openMinZ, ramp.openMaxZ);
		const t = (z - ramp.zBottom) / (ramp.zTop - ramp.zBottom);
		const line = lerp(ramp.yBottom, ramp.yTop, t);
		expect(
			world.groundHeightAt(midpoint(ramp.minX, ramp.maxX), z, ramp.yTop + 1, WALK_STEP),
			'over the open flight the deck above still carries you',
		).toBeCloseTo(line, 6);
	});
});

/**
 * The atrium is the one opening authored twice: `ATRIUM_OPENING` cuts the slab and
 * `ATRIUM_VOID` is what the rest of the mall measures the void with. Sampling the second
 * against the world built from the first is what ties them together.
 */
describe('the atrium void', () => {
	const insideEdge = 0.1;
	const outsideEdge = 0.5;
	const inside: [number, number][] = [
		[half(ATRIUM_VOID.width) - insideEdge, 0],
		[-(half(ATRIUM_VOID.width) - insideEdge), 0],
		[0, half(ATRIUM_VOID.depth) - insideEdge],
		[0, -(half(ATRIUM_VOID.depth) - insideEdge)],
	];
	const outside: [number, number][] = [
		[half(ATRIUM_VOID.width) + outsideEdge, 0],
		[-(half(ATRIUM_VOID.width) + outsideEdge), 0],
		[0, half(ATRIUM_VOID.depth) + outsideEdge],
		[0, -(half(ATRIUM_VOID.depth) + outsideEdge)],
	];

	test.each(inside)('inside the void at (%d, %d) you drop to the ground floor', (x, z) => {
		expect(world.groundHeightAt(x, z, levelY('v1'), WALK_STEP), 'there is floor here while the slab is cut open').toBeCloseTo(
			levelY('v0'),
			6,
		);
	});

	test.each(outside)('beside the void at (%d, %d) the deck carries you', (x, z) => {
		expect(world.groundHeightAt(x, z, levelY('v1'), WALK_STEP), 'no slab beside the atrium').toBeCloseTo(levelY('v1'), 6);
	});
});

interface LineFault {
	x: number;
	z: number;
	ground: number;
	line: number;
}
interface PadOverlap {
	fromZ: number;
	toZ: number;
	y: number;
}

/** Three lanes and not only the centre line: a flight can carry you down its heart and nowhere else. */
function walkFlight(ramp: Ramp): { faults: LineFault[]; pad: PadOverlap | null } {
	const lanes = [ramp.minX + 0.1, midpoint(ramp.minX, ramp.maxX), ramp.maxX - 0.1];
	const faults: LineFault[] = [];
	let padY: number | null = null;
	let padFromZ = Number.POSITIVE_INFINITY;
	let padToZ = Number.NEGATIVE_INFINITY;
	for (const x of lanes) {
		for (let i = 0; i <= SAMPLES; i++) {
			const t = i / SAMPLES;
			const z = lerp(ramp.zBottom, ramp.zTop, t);
			const line = lerp(ramp.yBottom, ramp.yTop, t);
			const ground = world.groundHeightAt(x, z, line, WALK_STEP);
			if (Math.abs(ground - line) <= 1e-4) continue;
			// Near the top of a climb the landing platform is the floor, and that is where you
			// step off; below it the flight still owes you its own surface.
			const platform = world.platforms.find(
				(candidate) => world.platformCovers(candidate, x, z) && Math.abs(candidate.y - ground) <= 1e-4,
			);
			if (platform && line >= platform.y - 0.35) continue;
			const roofPad = world.roofPads.find(
				(candidate) =>
					x >= candidate.minX &&
					x <= candidate.maxX &&
					z >= candidate.minZ &&
					z <= candidate.maxZ &&
					Math.abs(candidate.y - ground) <= 1e-4,
			);
			if (roofPad) {
				padY = roofPad.y;
				padFromZ = Math.min(padFromZ, z);
				padToZ = Math.max(padToZ, z);
				continue;
			}
			faults.push({ x, z, ground, line });
			break;
		}
	}
	return { faults, pad: padY === null ? null : { fromZ: padFromZ, toZ: padToZ, y: padY } };
}

describe.each(world.ramps.map((ramp) => ramp.label))('walking flight %s', (label) => {
	const ramp = rampOf(label);
	const walk = walkFlight(ramp);

	test('the ground follows the incline over its whole run', () => {
		const first = walk.faults[0];
		const message = first
			? `at (${nr(first.x)}, ${nr(first.z)}) the world answers ${nr(first.ground)} while the flight lies at ${nr(first.line)}`
			: '';
		expect(walk.faults, message).toBeEmpty();
	});

	test('no roof pad lies across it', () => {
		const message = walk.pad
			? `a roof pad (y ${nr(walk.pad.y)}) lies over z ${nr(walk.pad.fromZ)}..${nr(walk.pad.toZ)}, so you walk over the stairwell`
			: '';
		expect(walk.pad, message).toBeNull();
	});

	/**
	 * `onRamp` used to carry a fixed 0.6..FLOOR_H−0.6 band, which knew a V0→V1 flight and
	 * declared the secret stairs and the slide ladder flat floor. The band comes from each
	 * flight's own two ends now.
	 */
	test('onRamp knows this flight over its own height', () => {
		const heart = midpoint(ramp.minX, ramp.maxX);
		const midY = midpoint(ramp.yBottom, ramp.yTop);
		const midZ = lerp(ramp.zBottom, ramp.zTop, (midY - ramp.yBottom) / (ramp.yTop - ramp.yBottom));
		expect(world.onRamp(heart, midZ, midY), 'halfway up the flight onRamp says you stand on flat floor').toBeTrue();

		const footY = Math.min(ramp.yBottom, ramp.yTop);
		const footZ = ramp.yBottom < ramp.yTop ? ramp.zBottom : ramp.zTop;
		expect(world.onRamp(heart, footZ, footY - 1), 'a metre under its foot onRamp still counts you on the flight').toBeFalse();

		const headY = Math.max(ramp.yBottom, ramp.yTop);
		const headZ = ramp.yBottom < ramp.yTop ? ramp.zTop : ramp.zBottom;
		expect(world.onRamp(heart, headZ, headY + 1), 'a metre over its head onRamp still counts you on the flight').toBeFalse();
	});

	test('a sim halfway up stands on the flight', () => {
		const heart = midpoint(ramp.minX, ramp.maxX);
		// The ramp band is open at both ends: on the boundary itself the slab still carries you.
		const lowest = Math.min(ramp.yBottom, ramp.yTop) + RAMP_BAND_MARGIN;
		const highest = Math.max(ramp.yBottom, ramp.yTop) - RAMP_BAND_MARGIN;
		const wrong: { z: number; y: number; snapped: number }[] = [];
		for (let i = 1; i < SAMPLES; i++) {
			const y = lerp(lowest, highest, i / SAMPLES);
			const z = lerp(ramp.zBottom, ramp.zTop, (y - ramp.yBottom) / (ramp.yTop - ramp.yBottom));
			const snapped = world.snapFloorY(heart, z, y);
			if (Math.abs(snapped - y) <= EPS) continue;
			wrong.push({ z, y, snapped });
			break;
		}
		const first = wrong[0];
		const message = first
			? `at (${nr(heart)}, ${nr(first.z)}) snapFloorY puts a sim at ${nr(first.snapped)} instead of on the flight (${nr(first.y)})`
			: '';
		expect(wrong, message).toBeEmpty();
	});

	test.each(BELOW_THE_FOOT)('a sim %d m below its foot is not held up by it', (below) => {
		const heart = midpoint(ramp.minX, ramp.maxX);
		const footY = Math.min(ramp.yBottom, ramp.yTop);
		const footZ = ramp.yBottom < ramp.yTop ? ramp.zBottom : ramp.zTop;
		const y = footY - below;
		expect(world.snapFloorY(heart, footZ, y), `snapFloorY keeps a sim hanging at y ${nr(y)}`).not.toBeCloseTo(y, 6);
	});
});
