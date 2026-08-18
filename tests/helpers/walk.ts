import type { PedestrianPosture } from '#/data/character';
import { postureHeadroom } from '#/data/character';
import { levelY } from '#/data/levels';
import type { CollisionWorld } from '#/physics/Collision';
import { WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { lerp, span } from '#/util/math';
import { nr, world } from './world.ts';

/**
 * One pedestrian walking a straight line, step by step, and how far it got. Whether that is
 * far enough or much too far is the caller's question.
 *
 * Posture rides along because a pedestrian meets two kinds of obstacle: the body runs into
 * boxes and the head meets a beam the feet never touch. A walk that only resolves the circle
 * passes straight under a closed shutter.
 */

/** Well outside the facade, on the pavement. */
const STREET_X = -50;
/** Roughly one frame of walking. */
const WALK_PROBE_STEP = 0.05;
/** How much of a step has to survive collision before the walk counts as stopped. */
const PROGRESS = 0.5;
/** Past this the pedestrian is being steered around something rather than walking straight. */
const SIDEWAYS = 0.05;

interface Walk {
	x: number;
	complaint: string | null;
}
type Walker = Readonly<{ world: CollisionWorld; posture: PedestrianPosture }>;

const UPRIGHT: Walker = { world, posture: 'standing' };

type Point = readonly [number, number];
type Trip = Readonly<{ x: number; z: number; y: number; complaint: string | null }>;

/**
 * A body following a free polyline at whatever height the ground gives it, for routes that do
 * not run along one axis. It stops at the first step where the floor jumps more than the
 * player's own step height, or where collision moves it off its line.
 */
function followPolyline(points: readonly Point[], startY: number): Trip {
	let y = startY;
	const first = points[0];
	let x = first ? first[0] : 0;
	let z = first ? first[1] : 0;
	for (let i = 1; i < points.length; i++) {
		const from = points[i - 1];
		const to = points[i];
		if (!(from && to)) continue;
		const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / WALK_PROBE_STEP));
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const wantX = lerp(from[0], to[0], t);
			const wantZ = lerp(from[1], to[1], t);
			const ground = world.groundHeightAt(wantX, wantZ, y, WALK_STEP);
			if (Math.abs(ground - y) > WALK_STEP) {
				return { x, z, y, complaint: `at (${nr(wantX)}, ${nr(wantZ)}) the floor jumps from ${nr(y)} to ${nr(ground)}` };
			}
			const solved = world.resolveCircle(wantX, wantZ, ground, PLAYER_RADIUS, 3, true, false, true);
			if (Math.hypot(solved.x - wantX, solved.z - wantZ) > 1e-4) {
				return {
					x,
					z,
					y,
					complaint: `at (${nr(wantX)}, ${nr(wantZ)}) collision pushes you to (${nr(solved.x)}, ${nr(solved.z)})`,
				};
			}
			x = wantX;
			z = wantZ;
			y = ground;
		}
	}
	return { x, z, y, complaint: null };
}

function walkAlongAxis(z: number, from: number, to: number, who: Walker = UPRIGHT): Walk {
	const deckY = levelY('v0');
	const direction = Math.sign(to - from);
	const needed = postureHeadroom(who.posture);
	let x = from;
	let y = deckY;
	// One step of slack: the last one carries past the target rather than up to it.
	const steps = Math.ceil(span(0, Math.abs(to - from)) / WALK_PROBE_STEP) + 1;
	for (let i = 0; i < steps && (to - x) * direction > 0; i++) {
		const wanted = x + direction * WALK_PROBE_STEP;
		const ground = who.world.groundHeightAt(wanted, z, y, WALK_STEP);
		if (Math.abs(ground - deckY) > 1e-6) {
			return {
				x,
				complaint: `at x ${nr(wanted)} (z ${nr(z)}) the floor sits at ${nr(ground)} instead of deck height ${nr(deckY)}`,
			};
		}
		// As the player, not airborne, and outdoors: the pavement outside the facade is where
		// the walk starts, and the indoor form of the query has no colliders there.
		const solved = who.world.resolveCircle(wanted, z, ground, PLAYER_RADIUS, 3, true, false, true);
		if ((solved.x - x) * direction < WALK_PROBE_STEP * PROGRESS) return { x, complaint: null };
		if (who.world.headroomAt(solved.x, z, ground) < needed) return { x, complaint: null };
		if (Math.abs(solved.z - z) > SIDEWAYS) {
			return { x: solved.x, complaint: `at x ${nr(wanted)} the pedestrian is pushed sideways to z ${nr(solved.z)}` };
		}
		x = solved.x;
		y = ground;
	}
	return { x, complaint: null };
}

export type { Point, Trip, Walk, Walker };
export { STREET_X, UPRIGHT, WALK_PROBE_STEP, followPolyline, walkAlongAxis };
