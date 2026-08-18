import { describe, expect, test } from 'bun:test';
import { levelY } from '#/data/levels';
import { ATRIUM_BALUSTRADE_TOP_Y, ATRIUM_PLANTER_SPEC, atriumPlanterTiers } from '#/data/world';
import { CollisionWorld, WALK_STEP } from '#/physics/Collision';
import {
	AIR_STEP,
	CROUCH_LEG_TUCK,
	CROUCH_RATE,
	GRAVITY,
	JUMP_RISE,
	JUMP_V,
	PLAYER_RADIUS,
	STANCE_SETTLE,
	WALK_SPEED,
} from '#/player/constants';
import { ease, span } from '#/util/math';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * Both jumps are integrated in Controls' own order: horizontally through collision, then the
 * ground read at the height from before the fall, then the fall. Read the ground after the
 * fall instead and a body lands on the floor it was about to leave.
 */

/**
 * The frame loop hands Controls whatever the display gives it, clamped at 50 ms
 * ([App](src/app/App.ts) `animate`), so a jump proven at 60 fps is a jump proven at one point
 * of that range. A body that only clears a step at one frame rate clears it for some players
 * and not others, so every jump below is integrated at both ends of the range and in between.
 */
const FRAME_TIMES = [1 / 120, 1 / 60, 1 / 30, 0.05];
/** Six seconds of flight at the shortest step; every jump here lands inside a second. */
const SECONDS = 6;

/** Walking and without the take-off shove: the slowest a player can cross, so faster gaits follow. */
function jumpTowardsTheVoid(startX: number, z: number, startY: number, frameTime: number): { x: number; y: number } {
	let x = startX;
	let feetY = startY;
	let vy = JUMP_V;
	for (let frame = 0; frame < SECONDS / frameTime; frame++) {
		const solved = world.resolveCircle(x - WALK_SPEED * frameTime, z, feetY, PLAYER_RADIUS, 3, true, true, false);
		x = solved.x;
		const ground = world.groundHeightAt(x, z, feetY, AIR_STEP);
		vy -= GRAVITY * frameTime;
		feetY += vy * frameTime;
		if (feetY <= ground) return { x, y: ground };
	}
	return { x, y: feetY };
}

/**
 * A human JUMP_RISE no longer clears the balustrade from the deck, so the route runs over
 * the planter and the four conditions below sit in four different files.
 */
describe('climbing the atrium planter and jumping the balustrade', () => {
	const planter = atriumPlanterTiers().find((tier) => tier.id === 'planter');
	const bench = atriumPlanterTiers().find((tier) => tier.id === 'bench');
	const V0 = levelY('v0');
	const V1 = levelY('v1');

	test('the planter still has both tiers', () => {
		expect(bench, 'the planter at the void has no bench tier').toBeDefined();
		expect(planter, 'the planter at the void has no basin tier').toBeDefined();
	});

	if (!(planter && bench)) return;

	test.each([
		['the deck onto the bench', V1, bench.topY],
		['the bench onto the basin', bench.topY, planter.topY],
	] as const)('%s fits inside one jump', (_step, from, to) => {
		expect(span(from, to), `the step from ${nr(from)} to ${nr(to)} is higher than a jump reaches`).toBeLessThanOrEqual(
			JUMP_RISE + EPS,
		);
	});

	test('the basin rim puts you over the handrail', () => {
		expect(
			planter.topY + JUMP_RISE,
			`from the basin rim you reach ${nr(planter.topY + JUMP_RISE)} and the handrail sits at ${nr(ATRIUM_BALUSTRADE_TOP_Y)}, so you jump straight through it`,
		).toBeGreaterThanOrEqual(ATRIUM_BALUSTRADE_TOP_Y);
	});

	// The whole climb, tier by tier: each jump starts where the previous one puts you down.
	describe.each(FRAME_TIMES)('at %d s a frame', (frameTime) => {
		test.each([
			['onto the bench', bench.maxX + PLAYER_RADIUS, V1, bench.topY],
			['onto the basin', bench.standMinX, bench.topY, planter.topY],
		] as const)('a walking jump %s lands on that tier', (_step, fromX, fromY, toY) => {
			const landing = jumpTowardsTheVoid(fromX, ATRIUM_PLANTER_SPEC.centerZ, fromY, frameTime);
			expect(landing.y, `from x ${nr(fromX)} at ${nr(fromY)} you end up at ${nr(landing.y)}`).toBeCloseTo(toY, 3);
		});

		// Over the hole the floor is V0 and beside it the V1 slab, so one landing height says
		// whether the jump went through the void or landed next to it.
		test('the jump off the basin drops through the void to the ground floor', () => {
			const landing = jumpTowardsTheVoid(planter.standMinX, ATRIUM_PLANTER_SPEC.centerZ, planter.topY, frameTime);
			expect(landing.y, `the jump strands at x ${nr(landing.x)} on height ${nr(landing.y)}`).toBeCloseTo(V0, 3);
		});
	});
});

/** Wider than a body, so the run-up cannot pass the ledge beside it. */
const LEDGE_HALF = 1.6;
const LEDGE_KERB_LIP = 0.04;
/**
 * Above what a standing jump clears and below what a crouched one clears. Pull
 * CROUCH_LEG_TUCK to zero and both limits meet, which makes the pair of tests below
 * contradictory rather than merely red.
 */
const LEDGE_HEIGHT = 0.75;

/**
 * `crouchInAir` tucks the legs after take-off, so the body's underside counts CROUCH_LEG_TUCK
 * higher. The tuck arrives through `ease` at CROUCH_RATE, which is where the frame time bites:
 * at a long frame the knees come up in fewer, coarser steps than at a short one.
 */
function jumpOntoLedge({ ledgeWorld, startX, z, floorY, crouchInAir, frameTime }: Readonly<{
	ledgeWorld: CollisionWorld;
	startX: number;
	z: number;
	floorY: number;
	crouchInAir: boolean;
	frameTime: number;
}>): number {
	let x = startX;
	let feetY = floorY;
	let vy = JUMP_V;
	let stance = 0;
	for (let frame = 0; frame < SECONDS / frameTime; frame++) {
		const target = crouchInAir ? 1 : 0;
		const eased = ease(stance, target, CROUCH_RATE, frameTime);
		stance = Math.abs(target - eased) < STANCE_SETTLE ? target : eased;
		const lift = stance * CROUCH_LEG_TUCK;
		const solved = ledgeWorld.resolveCircle(x + WALK_SPEED * frameTime, z, feetY + lift, PLAYER_RADIUS, 3, true, true, false);
		x = solved.x;
		const ground = ledgeWorld.groundHeightAt(x, z, feetY + lift, AIR_STEP);
		vy -= GRAVITY * frameTime;
		feetY += vy * frameTime;
		if (feetY <= ground) return ground;
	}
	return feetY;
}

/** A flat V0 cell with no box pushing the run-up or the landing away. */
function clearCell(candidateWorld: CollisionWorld, floorY: number): { x: number; z: number } | null {
	for (let z = -18; z <= 18; z += 2) {
		for (let x = -22; x <= 22; x += 2) {
			const stands = (px: number): boolean => {
				if (Math.abs(candidateWorld.groundHeightAt(px, z, floorY, WALK_STEP) - floorY) > EPS) return false;
				const solved = candidateWorld.resolveCircle(px, z, floorY, PLAYER_RADIUS, 3, true, false, false);
				return Math.hypot(solved.x - px, solved.z - z) <= 1e-4;
			};
			if (stands(x) && stands(x + 2)) return { x, z };
		}
	}
	return null;
}

/** The ledge stands in a collision world of its own, so no other test runs into it. */
describe('the crouch jump clears what a standing jump cannot', () => {
	const ledgeWorld = new CollisionWorld();
	const V0 = levelY('v0');
	const cell = clearCell(ledgeWorld, V0);

	test('there is a clear cell on V0 to put the test ledge on', () => {
		expect(cell).not.toBeNull();
	});

	if (!cell) return;

	const centerX = cell.x + 2.4;
	const ledgeY = V0 + LEDGE_HEIGHT;
	const ledge = {
		minX: centerX - LEDGE_HALF,
		maxX: centerX + LEDGE_HALF,
		minZ: cell.z - LEDGE_HALF,
		maxZ: cell.z + LEDGE_HALF,
		y: ledgeY,
		label: 'crouch ledge',
	};
	ledgeWorld.platforms.push(ledge);
	ledgeWorld.addBox(ledge.minX, ledge.maxX, ledge.minZ, ledge.maxZ, {
		minY: V0 - 0.5,
		maxY: ledgeY - LEDGE_KERB_LIP,
		label: 'crouch kerb',
	});
	const startX = ledge.minX - PLAYER_RADIUS - 0.02;

	describe.each(FRAME_TIMES)('at %d s a frame', (frameTime) => {
		test('a standing jump does not reach the ledge', () => {
			const landing = jumpOntoLedge({ ledgeWorld, startX, z: cell.z, floorY: V0, crouchInAir: false, frameTime });
			expect(landing, `a standing jump already clears ${nr(LEDGE_HEIGHT)} m, so crouching proves nothing`).not.toBeCloseTo(
				ledgeY,
				2,
			);
		});

		test('a crouched jump lands on top of it', () => {
			const landing = jumpOntoLedge({ ledgeWorld, startX, z: cell.z, floorY: V0, crouchInAir: true, frameTime });
			expect(landing, `a crouched jump lands at ${nr(landing)} instead of on the ${nr(LEDGE_HEIGHT)} m ledge`).toBeCloseTo(
				ledgeY,
				2,
			);
		});
	});
});
