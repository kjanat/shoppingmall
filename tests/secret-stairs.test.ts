import { describe, expect, test } from 'bun:test';
import type { Mesh as MeshType, Vector3 as Vector3Type } from 'three';
import { STANDING_PEDESTRIAN } from '#/data/character';
import { levelY } from '#/data/levels';
import {
	HELIPAD_DECK_TOP_Y,
	HELIPAD_HATCH,
	HELIPAD_HATCH_GATE,
	HELIPAD_HATCH_SPEC,
	mechanismAdmits,
	mechanismGateBounds,
	mechanismTriggerBounds,
	SECRET_STAIRS_OPENING_BOUNDS,
} from '#/data/world';
import type { Ramp } from '#/physics/Collision';
import { CollisionWorld, WALK_STEP } from '#/physics/Collision';
import { WALK_SPEED } from '#/player/constants';
import { lerp, midpoint, span } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * The hatch over the secret stairs, and what a body walking those stairs feels underfoot.
 *
 * Controls lets go of the player the moment the floor drops more than WALK_STEP, which is
 * the clean roof-edge fall. On a staircase that must never happen, and on this one it did:
 * the hatch is a roof pad that switches with the player's own presence, and it shadowed the
 * flight in `groundHeightAt`. Climbing under a closed hatch the world answered the deck
 * instead of the tread below it, and the moment the hatch opened the floor fell back to the
 * flight and the cliff check released you.
 */

const ROOF = levelY('roof');
const FRAME = 1 / 60;
/** Where the walker starts: outside the hatch's presence zone. */
const RUN_UP = 2;
/** How far inside the stairwell edge the rays look, so the standing leaf does not count. */
const RAY_INSET = 0.1;
const RAYS_PER_AXIS = 5;

stubDocument();
const { Mesh, Raycaster, Scene, Vector3 } = await import('three');
const [{ LightPool }, { Helipad }] = await Promise.all([import('#/render/LightPool'), import('#/scene/Helipad')]);

const HOLE = SECRET_STAIRS_OPENING_BOUNDS;
const MID_X = midpoint(HOLE.minX, HOLE.maxX);
const MID_Z = midpoint(HOLE.minZ, HOLE.maxZ);
const EYE = ROOF + STANDING_PEDESTRIAN.eyeHeight;
const ZONE = mechanismTriggerBounds(HELIPAD_HATCH, HELIPAD_HATCH_GATE.id);

/** A fresh roof with its own hatch, so each walk starts with the leaf closed. */
function freshRoof(): { deck: CollisionWorld; hatch: InstanceType<typeof Helipad> } {
	const deck = new CollisionWorld();
	return { deck, hatch: new Helipad(new LightPool(new Scene()), deck) };
}

function deckIsClosed(deck: CollisionWorld): boolean {
	return Math.abs(deck.groundHeightAt(MID_X, MID_Z, ROOF, WALK_STEP) - ROOF) <= 1e-3;
}

describe('the hatch is declared as something that opens', () => {
	const gates = HELIPAD_HATCH.volumes.filter((volume) => volume.clearance.kind === 'automatic-gate');

	test('at least one leaf opens by itself', () => {
		expect(gates, `${HELIPAD_HATCH.id} has no leaf that opens automatically`).not.toBeEmpty();
	});

	test.each(gates.map((gate) => gate.id))('%s hangs on a mechanism that admits pedestrians', (id) => {
		const gate = gates.find((candidate) => candidate.id === id);
		if (gate?.clearance.kind !== 'automatic-gate') return;
		const mechanismId = gate.clearance.mechanismId;
		expect(
			HELIPAD_HATCH.mechanisms.some((candidate) => candidate.id === mechanismId),
			`${id} hangs on mechanism '${mechanismId}', which is not on ${HELIPAD_HATCH.id}`,
		).toBeTrue();
		expect(
			mechanismAdmits(HELIPAD_HATCH, mechanismId, 'pedestrian'),
			`${mechanismId} admits no pedestrian, so the only stair to the roof is for nobody`,
		).toBeTrue();
	});

	test('the leaf covers the whole stairwell', () => {
		const leaf = mechanismGateBounds(HELIPAD_HATCH, HELIPAD_HATCH_GATE.id);
		const covered = `${nr(span(leaf.minX, leaf.maxX))}×${nr(span(leaf.minZ, leaf.maxZ))} m of ${nr(span(HOLE.minX, HOLE.maxX))}×${nr(span(HOLE.minZ, HOLE.maxZ))} m`;
		expect(leaf.minX, `the leaf covers ${covered}, so you fall in along the edge`).toBeLessThanOrEqual(HOLE.minX + EPS);
		expect(leaf.maxX, `the leaf covers ${covered}`).toBeGreaterThanOrEqual(HOLE.maxX - EPS);
		expect(leaf.minZ, `the leaf covers ${covered}`).toBeLessThanOrEqual(HOLE.minZ + EPS);
		expect(leaf.maxZ, `the leaf covers ${covered}`).toBeGreaterThanOrEqual(HOLE.maxZ - EPS);
	});
});

describe('the hatch answers to who is standing near it', () => {
	const { deck, hatch } = freshRoof();
	const walker = new Vector3();
	const away = new Vector3(ZONE.maxX + RUN_UP, EYE, MID_Z);
	const waitFrames = Math.ceil(HELIPAD_HATCH_SPEC.openSeconds / FRAME) + 2;

	test('with nobody near, the deck is closed over the stairwell', () => {
		hatch.update(FRAME, away);
		expect(
			deckIsClosed(deck),
			`the world answers ${nr(deck.groundHeightAt(MID_X, MID_Z, ROOF, WALK_STEP))} over the stairwell`,
		).toBeTrue();
	});

	test('walking up to it opens it inside its own opening time', () => {
		const approach = Math.ceil(span(HOLE.maxX, away.x) / (WALK_SPEED * FRAME));
		let x = away.x;
		let inZone = 0;
		let openedAfter = -1;
		for (let step = 0; step < approach + waitFrames && openedAfter < 0; step++) {
			hatch.update(FRAME, walker.set(x, EYE, MID_Z));
			if (!deckIsClosed(deck)) openedAfter = inZone;
			if (x > ZONE.minX && x < ZONE.maxX) inZone += FRAME;
			x = Math.max(HOLE.maxX, x - WALK_SPEED * FRAME);
		}
		expect(openedAfter, 'walking up to the hatch does not open it: the stairwell stays shut').toBeGreaterThanOrEqual(0);
		expect(
			openedAfter,
			`it takes ${nr(openedAfter)} s in the zone while its mechanism promises ${nr(HELIPAD_HATCH_SPEC.openSeconds)} s`,
		).toBeLessThanOrEqual(HELIPAD_HATCH_SPEC.openSeconds + FRAME);
	});

	test('it shuts again once everybody has walked away', () => {
		for (let step = 0; step < waitFrames; step++) hatch.update(FRAME, away);
		expect(deckIsClosed(deck), 'the hatch stays open after everybody left').toBeTrue();
	});

	test('somebody coming up the stairs opens it from below', () => {
		const climber = new Vector3(MID_X, midpoint(ZONE.minY, ROOF), MID_Z);
		for (let step = 0; step < waitFrames; step++) hatch.update(FRAME, climber);
		expect(deckIsClosed(deck), 'coming up the stairs you meet a shut hatch: it only opens from above').toBeFalse();
	});
});

/**
 * The helipad pad lay over the hatch: the leaf opened, the floor plate came off, and you were
 * still looking at solid deck. These rays look straight down through the stairwell from eye
 * height, inside its edge because the open leaf stands upright on the hinge side.
 */
describe('nothing lies over the stairwell', () => {
	const { deck, hatch } = freshRoof();
	const away = new Vector3(ZONE.maxX + RUN_UP, EYE, MID_Z);
	const meshes: MeshType[] = [];
	hatch.group.traverse((part) => {
		if (part instanceof Mesh) meshes.push(part);
	});
	const down = new Vector3(0, -1, 0);
	const ray = new Raycaster(new Vector3(), down);
	const from = new Vector3();
	const leafTop = HELIPAD_DECK_TOP_Y + HELIPAD_HATCH_SPEC.lidThickness;

	function topmostAt(x: number, z: number): { y: number; what: string } | null {
		hatch.group.updateMatrixWorld(true);
		ray.set(from.set(x, EYE, z), down);
		const hit = ray.intersectObjects(meshes, false).find((candidate) => candidate.point.y > HELIPAD_DECK_TOP_Y + EPS);
		return hit ? { y: hit.point.y, what: hit.object.name || hit.object.type } : null;
	}

	const points: { x: number; z: number }[] = [];
	for (let i = 0; i < RAYS_PER_AXIS; i++) {
		for (let j = 0; j < RAYS_PER_AXIS; j++) {
			points.push({
				x: lerp(HOLE.minX + RAY_INSET, HOLE.maxX - RAY_INSET, i / (RAYS_PER_AXIS - 1)),
				z: lerp(HOLE.minZ + RAY_INSET, HOLE.maxZ - RAY_INSET, j / (RAYS_PER_AXIS - 1)),
			});
		}
	}

	test('closed, the leaf itself is the topmost surface', () => {
		hatch.update(FRAME, away);
		expect(deckIsClosed(deck), 'the hatch did not start closed, so this measures the wrong state').toBeTrue();
		const buried = points
			.map((point) => ({ point, top: topmostAt(point.x, point.z) }))
			.filter((entry) => !entry.top || Math.abs(entry.top.y - leafTop) > 1e-3)
			.map((entry) =>
				entry.top
					? `at (${nr(entry.point.x)}, ${nr(entry.point.z)}) ${entry.top.what} lies at ${nr(entry.top.y)} over the leaf at ${nr(leafTop)}`
					: `at (${nr(entry.point.x)}, ${nr(entry.point.z)}) there is nothing: the deck is a hole there`,
			);
		expect(buried, buried.join('\n')).toBeEmpty();
	});

	test('open, nothing is left over the hole', () => {
		const climber = new Vector3(MID_X, midpoint(ZONE.minY, ROOF), MID_Z);
		for (let step = 0; step < Math.ceil(HELIPAD_HATCH_SPEC.openSeconds / FRAME) + 2; step++) hatch.update(FRAME, climber);
		expect(deckIsClosed(deck), 'the hatch did not open, so this measures the wrong state').toBeFalse();
		const left = points
			.map((point) => ({ point, top: topmostAt(point.x, point.z) }))
			.filter((entry) => entry.top !== null)
			.map(
				(entry) =>
					`${entry.top?.what} still lies at ${nr(entry.top?.y ?? 0)} over the stairwell at (${nr(entry.point.x)}, ${nr(entry.point.z)})`,
			);
		expect(left, left.join('\n')).toBeEmpty();
	});
});

type Walkable = Pick<Ramp, 'minX' | 'maxX' | 'zBottom' | 'zTop' | 'yBottom' | 'yTop' | 'label'>;

/**
 * Walk a flight and report the first step where the floor moves more than one WALK_STEP.
 * Down is the cliff check letting go; up is a plate shadowing the tread and gluing you to the
 * deck. `driveHatch` runs the hatch off the walker's own eye position, so it can switch
 * halfway through the climb.
 */
function walkFlightLoose(
	collision: CollisionWorld,
	flight: Walkable,
	direction: 'up' | 'down',
	driveHatch: ((eye: Vector3Type) => void) | null,
): string | null {
	const eye = new Vector3();
	const stride = WALK_SPEED * FRAME;
	const heart = midpoint(flight.minX, flight.maxX);
	const lowZ = flight.yBottom < flight.yTop ? flight.zBottom : flight.zTop;
	const highZ = flight.yBottom < flight.yTop ? flight.zTop : flight.zBottom;
	const startZ = direction === 'up' ? lowZ : highZ;
	const endZ = direction === 'up' ? highZ : lowZ;
	const sign = Math.sign(endZ - startZ);
	let z = startZ;
	let feetY = direction === 'up' ? Math.min(flight.yBottom, flight.yTop) : Math.max(flight.yBottom, flight.yTop);
	// More frames than the walk is long, so the hatch can change state mid-climb.
	const frames = Math.ceil(Math.abs(endZ - startZ) / stride) + Math.ceil(HELIPAD_HATCH_SPEC.openSeconds / FRAME) + 4;
	for (let frame = 0; frame < frames; frame++) {
		if (driveHatch) driveHatch(eye.set(heart, feetY + STANDING_PEDESTRIAN.eyeHeight, z));
		z += sign * stride;
		if (sign > 0 ? z > endZ : z < endZ) z = endZ;
		const ground = collision.groundHeightAt(heart, z, feetY, WALK_STEP);
		if (feetY - ground > WALK_STEP) {
			return `at (${nr(heart)}, ${nr(z)}) the floor drops ${nr(feetY - ground)} m in one step, past WALK_STEP ${nr(WALK_STEP)}, and the cliff check lets go of the stairs`;
		}
		if (ground - feetY > WALK_STEP) {
			return `at (${nr(heart)}, ${nr(z)}) the floor jumps ${nr(ground - feetY)} m up, past WALK_STEP ${nr(WALK_STEP)}, so a plate glues you off the stairs onto the deck`;
		}
		feetY = ground;
	}
	return null;
}

/** The slide ladder is an arcade climb rather than a staircase; the roof file walks that one. */
const STAIRCASES = world.ramps.filter((ramp) => ramp.label !== 'slide_ladder');

describe.each(STAIRCASES.map((flight) => flight.label))('walking %s never goes airborne', (label) => {
	const flight = STAIRCASES.find((candidate) => candidate.label === label);

	test.each(['up', 'down'] as const)('%s', (direction) => {
		if (!flight) return;
		expect(walkFlightLoose(world, flight, direction, null) ?? '').toBe('');
	});
});

describe.each(['up', 'down'] as const)('walking the secret stairs %s under a live hatch', (direction) => {
	test('the floor never moves more than one step', () => {
		const { deck, hatch } = freshRoof();
		const stairs = deck.ramps.find((ramp) => ramp.label === 'secret-stairs');
		expect(stairs, 'no secret stairs in the world to walk').toBeDefined();
		if (!stairs) return;
		expect(walkFlightLoose(deck, stairs, direction, (eye) => hatch.update(FRAME, eye)) ?? '').toBe('');
	});
});
