import { describe, expect, test } from 'bun:test';
import { ATRIUM_VOID } from '#/data/layout';
import { LEVELS, levelY } from '#/data/levels';
import type { PlanShape } from '#/data/spatial';
import { ATRIUM_OPENING, SLAB_SPEC_BY_LEVEL, VERTICAL_CONNECTORS } from '#/data/world';
import type { Ramp } from '#/physics/Collision';
import { RAMP_BAND_MARGIN, WALK_STEP } from '#/physics/Collision';
import { half, lerp, midpoint, span } from '#/util/math';
import { EPS, nr, world } from './helpers/world.ts';

/** A hole is cut around the landings, so it may reach this far past the flight and no further. */
const HOLE_MARGIN = 0.8;
/** The longest flight runs 12 m, so this samples it roughly every 3 cm. */
const SAMPLES = 400;
/** Just outside the ramp band, and then two heights no reading tolerance reaches. */
const BELOW_THE_FOOT = [RAMP_BAND_MARGIN * 2, 1, 2];

const DECK_HEIGHTS = [...LEVELS.map((level) => level.y), ...world.platforms.map((platform) => platform.y)];

function rampOf(label: string): Ramp {
	const ramp = world.ramps.find((candidate) => candidate.label === label);
	if (!ramp) throw new Error(`no ramp ${label} in the collision world`);
	return ramp;
}

function cutsRectangle(
	holes: readonly PlanShape[],
	center: { x: number; z: number },
	size: { width: number; depth: number },
): boolean {
	return holes.some(
		(plan) =>
			plan.kind === 'rectangle' &&
			Math.abs(plan.center.x - center.x) <= EPS &&
			Math.abs(plan.center.z - center.z) <= EPS &&
			Math.abs(plan.width - size.width) <= EPS &&
			Math.abs(plan.depth - size.depth) <= EPS,
	);
}

describe.each(world.ramps.map((ramp) => ramp.label))('flight %s', (label) => {
	const ramp = rampOf(label);
	const lowZ = Math.min(ramp.zBottom, ramp.zTop);
	const highZ = Math.max(ramp.zBottom, ramp.zTop);

	test('has a walkable footprint', () => {
		expect(ramp.minX, `minX ${nr(ramp.minX)} does not sit left of maxX ${nr(ramp.maxX)}`).toBeLessThan(ramp.maxX);
		expect(span(lowZ, highZ), 'the flight has no length in z').toBeGreaterThan(EPS);
		expect(ramp.yTop, `yTop ${nr(ramp.yTop)} does not sit above yBottom ${nr(ramp.yBottom)}`).toBeGreaterThan(ramp.yBottom);
	});

	test('has a hole with a front and a back', () => {
		expect(ramp.openMinZ, `openMinZ ${nr(ramp.openMinZ)} does not come before openMaxZ ${nr(ramp.openMaxZ)}`).toBeLessThan(
			ramp.openMaxZ,
		);
	});

	test('keeps its hole over the flight', () => {
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
});

describe('the slab manifest is cut where something climbs through it', () => {
	test(`${ATRIUM_OPENING.id} is cut out of the ${SLAB_SPEC_BY_LEVEL.v1.id}`, () => {
		expect(cutsRectangle(SLAB_SPEC_BY_LEVEL.v1.holes, ATRIUM_OPENING.center, ATRIUM_OPENING.size)).toBeTrue();
	});

	test.each(VERTICAL_CONNECTORS.map((connector) => connector.id))('%s', (id) => {
		const connector = VERTICAL_CONNECTORS.find((candidate) => candidate.id === id);
		if (!connector) throw new Error(`no connector ${id}`);
		expect(
			cutsRectangle(SLAB_SPEC_BY_LEVEL[connector.to].holes, connector.opening.center, connector.opening.size),
			`${connector.opening.id} is missing from the shared ${connector.to} slab manifest`,
		).toBeTrue();
	});
});

describe.each(VERTICAL_CONNECTORS.map((connector) => connector.id))('%s and the ramp built from it', (id) => {
	const connector = VERTICAL_CONNECTORS.find((candidate) => candidate.id === id);
	if (!connector) throw new Error(`no connector ${id}`);
	const ramp = rampOf(connector.id);

	test('runs down the middle of its ramp', () => {
		expect(connector.x, 'the connector x does not sit on the middle of its ramp').toBeCloseTo(midpoint(ramp.minX, ramp.maxX), 3);
	});

	test.each([
		['zBottom', connector.zBottom, ramp.zBottom],
		['zTop', connector.zTop, ramp.zTop],
	] as const)('%s matches the ramp', (_end, authored, built) => {
		expect(authored).toBeCloseTo(built, 3);
	});

	test('cuts the z span the ramp reckons with', () => {
		const extent = half(connector.opening.size.depth);
		expect(connector.opening.center.z - extent, 'the near edge of the hole is not where the ramp opens').toBeCloseTo(
			ramp.openMinZ,
			3,
		);
		expect(connector.opening.center.z + extent, 'the far edge of the hole is not where the ramp opens').toBeCloseTo(
			ramp.openMaxZ,
			3,
		);
	});

	test('cuts a hole at least as wide as the flight', () => {
		expect(
			connector.opening.size.width,
			`the opening is narrower than the ramp, so the truss pokes through the slab`,
		).toBeGreaterThanOrEqual(span(ramp.minX, ramp.maxX) - 1e-3);
	});

	test('carries its steps at the speed the ramp uses', () => {
		const authored = 'carrySpeed' in connector.collision ? connector.collision.carrySpeed : undefined;
		if (authored === undefined) return;
		expect(ramp.carrySpeed, `${id} names a step speed but the ramp has none: the treads move and you do not`).toBeDefined();
		expect(ramp.carrySpeed ?? 0).toBeCloseTo(authored, 6);
	});
});

describe('the atrium hole is open where the manifest cuts it', () => {
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

	test.each(inside)('inside the hole at (%s, %s) you drop to the ground floor', (x, z) => {
		expect(world.groundHeightAt(x, z, levelY('v1'), WALK_STEP), 'there is floor here while the manifest cuts a hole').toBeCloseTo(
			levelY('v0'),
			6,
		);
	});

	test.each(outside)('beside the hole at (%s, %s) the deck carries you', (x, z) => {
		expect(world.groundHeightAt(x, z, levelY('v1'), WALK_STEP), 'no slab beside the atrium').toBeCloseTo(levelY('v1'), 6);
	});
});

type LineFault = { x: number; z: number; ground: number; line: number };
type PadOverlap = { fromZ: number; toZ: number; y: number };

/** Three lanes and not only the centre line: a flight can carry you down its heart and nowhere else. */
function walkFlight(ramp: Ramp): { faults: LineFault[]; pad: PadOverlap | null } {
	const lanes = [ramp.minX + 0.1, midpoint(ramp.minX, ramp.maxX), ramp.maxX - 0.1];
	const faults: LineFault[] = [];
	let pad: PadOverlap | null = null;
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
				pad = { fromZ: Math.min(pad?.fromZ ?? z, z), toZ: Math.max(pad?.toZ ?? z, z), y: roofPad.y };
				continue;
			}
			faults.push({ x, z, ground, line });
			break;
		}
	}
	return { faults, pad };
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

	test.each(BELOW_THE_FOOT)('a sim %s m below its foot is not held up by it', (below) => {
		const heart = midpoint(ramp.minX, ramp.maxX);
		const footY = Math.min(ramp.yBottom, ramp.yTop);
		const footZ = ramp.yBottom < ramp.yTop ? ramp.zBottom : ramp.zTop;
		const y = footY - below;
		expect(world.snapFloorY(heart, footZ, y), `snapFloorY keeps a sim hanging at y ${nr(y)}`).not.toBeCloseTo(y, 6);
	});
});
