import { describe, expect, test } from 'bun:test';
import { MALL_FOOTPRINT } from '#/data/layout';
import { LEVELS, levelY } from '#/data/levels';
import { poolFloorY } from '#/data/pool';
import { planBounds } from '#/data/spatial';
import { SLAB_SPEC_BY_LEVEL } from '#/data/world';
import { CollisionWorld, RAMP_BAND_MARGIN, WALK_STEP } from '#/physics/Collision';
import { half, midpoint } from '#/util/math';

/**
 * The player floor and the sim floor answer the same question the same way.
 *
 * `groundHeightAt` serves the player and `snapFloorY` serves the sims. Where they
 * disagree somebody stands on nothing: over the pool basin snapFloorY promised the roof
 * deck at 13.95 while the bottom sat a metre lower, and over an open stairwell it did the
 * same.
 */

const V1 = levelY('v1');
const ROOF = levelY('roof');
const EPS = 1e-6;
const EYE = ROOF + RAMP_BAND_MARGIN;

const world = new CollisionWorld();

function nr(value: number): string {
	return Number(value.toFixed(3)).toString();
}

type Sample = { x: number; z: number; ground: number; sim: number };

function sampleDeck(): { pool: Sample[]; hole: Sample[]; disagreeing: Sample[] } {
	const halfWidth = half(MALL_FOOTPRINT.width);
	const halfDepth = half(MALL_FOOTPRINT.depth);
	const pool: Sample[] = [];
	const hole: Sample[] = [];
	const disagreeing: Sample[] = [];
	for (let x = -halfWidth; x <= halfWidth; x += 1) {
		for (let z = -halfDepth; z <= halfDepth; z += 1) {
			const ground = world.groundHeightAt(x, z, EYE, WALK_STEP);
			const sim = world.snapFloorY(x, z, EYE);
			// Only where the floor sits at or below the deck: that is where snapFloorY
			// promised the deck while the bottom sat lower. A roof-reaching ramp (the slide
			// ladder) lies above the deck and has its own mid-ramp meaning.
			if (ground > ROOF + EPS) continue;
			const sample = { x, z, ground, sim };
			if (poolFloorY(x, z) !== null) pool.push(sample);
			else if (ground > V1 && ground < ROOF) hole.push(sample);
			if (Math.abs(ground - sim) > EPS) disagreeing.push(sample);
		}
	}
	return { pool, hole, disagreeing };
}

const SAMPLES = sampleDeck();

describe('the player floor and the sim floor agree', () => {
	test('the sweep hits the pool basin', () => {
		expect(SAMPLES.pool, 'no pool point sampled at roof height, so basin consistency is never touched').not.toBeEmpty();
	});

	test('the sweep hits a roof-reaching opening', () => {
		expect(SAMPLES.hole, 'no roof-reaching hole sampled, so opening consistency is never touched').not.toBeEmpty();
	});

	test('groundHeightAt and snapFloorY answer the same everywhere', () => {
		const first = SAMPLES.disagreeing[0];
		const message = first
			? `(${nr(first.x)}, ${nr(first.z)}): groundHeightAt=${nr(first.ground)} but snapFloorY=${nr(first.sim)}`
			: '';
		expect(SAMPLES.disagreeing, message).toBeEmpty();
	});
});

/**
 * Everything below is the same question the describe above asks, put where that sweep cannot
 * look. It stands at one eye height on the roof and skips every column whose floor sits above
 * the deck, so a platform and a hole one storey down are both outside it.
 */

/**
 * The same comparison from every deck a body can stand on, with nothing skipped. Failures are
 * grouped by the pair of answers rather than listed per column, because one cause covers
 * hundreds of columns and a list of coordinates hides that.
 */
type Disagreement = { columns: number; sample: string };

function disagreementsFrom(deck: number): Map<string, Disagreement> {
	const halfWidth = half(MALL_FOOTPRINT.width);
	const halfDepth = half(MALL_FOOTPRINT.depth);
	const found = new Map<string, Disagreement>();
	for (let x = -halfWidth; x <= halfWidth; x += 1) {
		for (let z = -halfDepth; z <= halfDepth; z += 1) {
			const eye = deck + 0.05;
			const ground = world.groundHeightAt(x, z, eye, WALK_STEP);
			const sim = world.snapFloorY(x, z, eye);
			if (Math.abs(ground - sim) <= EPS) continue;
			const key = `the player gets ${nr(ground)} and a sim ${nr(sim)}`;
			const seen = found.get(key);
			if (seen) seen.columns++;
			else found.set(key, { columns: 1, sample: `(${nr(x)}, ${nr(z)})` });
		}
	}
	return found;
}

describe.each(LEVELS.map((level) => level.id))('standing on %s', (id) => {
	const found = disagreementsFrom(levelY(id));

	test('the two floor readers answer the same over the whole deck', () => {
		const complaints = [...found].map(([answers, where]) => `${where.columns} columns where ${answers}, e.g. ${where.sample}`);
		expect(complaints, complaints.join('\n')).toBeEmpty();
	});
});

/**
 * `snapFloorY` reads the pool, the roof pads, the slabs and the roof-reaching flights, and
 * `world.platforms` appears in none of them: a sim asking for the floor on the catwalk, on the
 * planter tiers or on the slide platform is answered with the slab underneath.
 */
describe.each(world.platforms.map((platform) => platform.label))('a sim on the %s deck', (label) => {
	const platform = world.platforms.find((candidate) => candidate.label === label);
	if (!platform) throw new Error(`no platform ${label}`);
	const x = midpoint(platform.minX, platform.maxX);
	const z = midpoint(platform.minZ, platform.maxZ);
	const standing = platform.y + 0.05;

	test('stands on the deck the player stands on', () => {
		expect(
			world.snapFloorY(x, z, standing),
			`the player floor is ${nr(world.groundHeightAt(x, z, standing, WALK_STEP))} and a sim is dropped to ${nr(world.snapFloorY(x, z, standing))}`,
		).toBeCloseTo(world.groundHeightAt(x, z, standing, WALK_STEP), 6);
	});
});

/**
 * A hole in a deck is a hole for both readers.
 *
 * `snapFloorY` handles the roof-reaching flights and the pool inside an `if (y >= 10)`, and
 * below that height nothing looks at the slab holes at all: the fallthrough returns the storey
 * the height falls in. Standing on V1 over the atrium the player is given the ground floor and
 * a sim the deck it is standing over, six metres of nothing between them. The roof got this
 * treatment when a sim was caught hovering over the secret stairs; V1 never did.
 *
 * The lift shaft is the control: its cabin floor closes the hole, and there the two agree.
 */
const SLAB_HOLES = Object.entries(SLAB_SPEC_BY_LEVEL).flatMap(([level, spec]) =>
	spec.holes.map((hole, index) => {
		const bounds = planBounds(hole);
		return {
			name: `${level} hole ${index} at (${nr(midpoint(bounds.minX, bounds.maxX))}, ${nr(midpoint(bounds.minZ, bounds.maxZ))})`,
			x: midpoint(bounds.minX, bounds.maxX),
			z: midpoint(bounds.minZ, bounds.maxZ),
			standing: spec.topY + 0.05,
		};
	}),
);

describe.each(SLAB_HOLES.map((hole) => hole.name))('%s', (name) => {
	const hole = SLAB_HOLES.find((candidate) => candidate.name === name);
	if (!hole) throw new Error(`no hole ${name}`);

	test('is as open to a sim as it is to the player', () => {
		const player = world.groundHeightAt(hole.x, hole.z, hole.standing, WALK_STEP);
		const sim = world.snapFloorY(hole.x, hole.z, hole.standing);
		expect(sim, `the player drops to ${nr(player)} and a sim stands on ${nr(sim)}`).toBeCloseTo(player, 6);
	});
});
