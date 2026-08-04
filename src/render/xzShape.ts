import * as THREE from 'three';
import { half } from '#/util/math';

export type RectangleXZ = Readonly<{
	center: Readonly<{ x: number; z: number }>;
	size: Readonly<{ width: number; depth: number }>;
}>;

function traceRectangle(path: THREE.Path | THREE.Shape, rectangle: RectangleXZ): void {
	const { center, size } = rectangle;
	const minX = center.x - half(size.width);
	const maxX = center.x + half(size.width);
	// ExtrudeGeometry is rotated onto XZ. Shape Y therefore maps to world -Z.
	const minShapeY = -center.z - half(size.depth);
	const maxShapeY = -center.z + half(size.depth);
	path.moveTo(minX, minShapeY);
	path.lineTo(maxX, minShapeY);
	path.lineTo(maxX, maxShapeY);
	path.lineTo(minX, maxShapeY);
	path.closePath();
}

export function xzRectangleShape(rectangle: RectangleXZ): THREE.Shape {
	const shape = new THREE.Shape();
	traceRectangle(shape, rectangle);
	return shape;
}

export function addXZRectangleHole(shape: THREE.Shape, rectangle: RectangleXZ): void {
	const hole = new THREE.Path();
	traceRectangle(hole, rectangle);
	shape.holes.push(hole);
}
