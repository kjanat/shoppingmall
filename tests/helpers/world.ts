import { CollisionWorld } from '#/physics/Collision';

/**
 * One collision world for every test that walks the mall.
 *
 * Building it costs a full pass over the world model, and the tests only ever read from it, so they share one.
 */

export const world = new CollisionWorld();

/** Slack for values that should be exactly equal. */
export const EPS = 1e-6;

/** A number in a failure message, without a tail of floating-point noise. */
export function nr(value: number): string {
	return Number(value.toFixed(3)).toString();
}

export function almost(a: number, b: number, eps = EPS): boolean {
	return Math.abs(a - b) <= eps;
}

export interface Rect {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

export function covers(rect: Rect, x: number, z: number): boolean {
	return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** Whether two rectangles really overlap; edges that just touch do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
	return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}
