import { describe, expect, test } from 'bun:test';
import { MALL_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { poolFloorY } from '#/data/pool';
import { CollisionWorld, RAMP_BAND_MARGIN, WALK_STEP } from '#/physics/Collision';
import { half } from '#/util/math';

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
