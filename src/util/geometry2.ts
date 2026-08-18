import { clamp01, half } from '#/util/math';

export type Point2 = Readonly<{ x: number; z: number }>;
export type Segment2 = Readonly<{ a: Point2; b: Point2 }>;

/** Position of a point projected onto a finite XZ segment, from 0 at A to 1 at B. */
export function segmentParameter2(point: Point2, segment: Segment2): number {
	const { x: px, z: pz } = point;
	const { a, b } = segment;
	const { x: ax, z: az } = a;
	const { x: bx, z: bz } = b;
	const dx = bx - ax;
	const dz = bz - az;
	const lengthSquared = dx * dx + dz * dz;
	if (lengthSquared === 0) return 0;
	return clamp01(((px - ax) * dx + (pz - az) * dz) / lengthSquared);
}

export function distanceToSegment2(point: Point2, segment: Segment2): number {
	const { x: px, z: pz } = point;
	const { a, b } = segment;
	const t = segmentParameter2(point, segment);
	const { x: ax, z: az } = a;
	const { x: bx, z: bz } = b;
	return Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
}

/** Finite strip used by ramps, stairs, and their clearance volumes. */
export function pointInSegmentStrip2({ point, segment, width, epsilon = 0 }: Readonly<{
	point: Point2;
	segment: Segment2;
	width: number;
	epsilon?: number;
}>): boolean {
	const { x: px, z: pz } = point;
	const { a, b } = segment;
	const { x: ax, z: az } = a;
	const { x: bx, z: bz } = b;
	const dx = bx - ax;
	const dz = bz - az;
	const length = Math.hypot(dx, dz);
	if (length === 0) return false;
	const along = ((px - ax) * dx + (pz - az) * dz) / length;
	const across = ((px - ax) * -dz + (pz - az) * dx) / length;
	return along >= -epsilon && along <= length + epsilon && Math.abs(across) <= half(width) + epsilon;
}
