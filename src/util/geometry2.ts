import { clamp01, half } from '#/util/math';

/** Position of a point projected onto a finite XZ segment, from 0 at A to 1 at B. */
export function segmentParameter2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
	const dx = bx - ax;
	const dz = bz - az;
	const lengthSquared = dx * dx + dz * dz;
	if (lengthSquared === 0) return 0;
	return clamp01(((px - ax) * dx + (pz - az) * dz) / lengthSquared);
}

export function distanceToSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
	const t = segmentParameter2(px, pz, ax, az, bx, bz);
	return Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
}

/** Finite strip used by ramps, stairs, and their clearance volumes. */
export function pointInSegmentStrip2(
	px: number,
	pz: number,
	ax: number,
	az: number,
	bx: number,
	bz: number,
	width: number,
	epsilon = 0,
): boolean {
	const dx = bx - ax;
	const dz = bz - az;
	const length = Math.hypot(dx, dz);
	if (length === 0) return false;
	const along = ((px - ax) * dx + (pz - az) * dz) / length;
	const across = ((px - ax) * -dz + (pz - az) * dx) / length;
	return along >= -epsilon && along <= length + epsilon && Math.abs(across) <= half(width) + epsilon;
}
