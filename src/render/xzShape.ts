import * as THREE from 'three';
import type { PlanShape } from '#/data/spatial';
import { half } from '#/util/math';

export type RectangleXZ = Readonly<{
	center: Readonly<{ x: number; z: number }>;
	size: Readonly<{ width: number; depth: number }>;
}>;

export type XZExtrusionSpec = Readonly<{
	plan: PlanShape;
	holes?: readonly PlanShape[];
	topY: number;
	thickness: number;
	name?: string;
	castShadow?: boolean;
	receiveShadow?: boolean;
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

function tracePlan(path: THREE.Path | THREE.Shape, plan: PlanShape): void {
	if (plan.kind === 'rectangle') {
		if (plan.yaw === 0) {
			traceRectangle(path, { center: plan.center, size: { width: plan.width, depth: plan.depth } });
			return;
		}
		const cosine = Math.cos(plan.yaw);
		const sine = Math.sin(plan.yaw);
		const corners = [
			{ x: -half(plan.width), z: -half(plan.depth) },
			{ x: half(plan.width), z: -half(plan.depth) },
			{ x: half(plan.width), z: half(plan.depth) },
			{ x: -half(plan.width), z: half(plan.depth) },
		];
		for (const [index, corner] of corners.entries()) {
			const x = plan.center.x + corner.x * cosine - corner.z * sine;
			const z = plan.center.z + corner.x * sine + corner.z * cosine;
			if (index === 0) path.moveTo(x, -z);
			else path.lineTo(x, -z);
		}
		path.closePath();
		return;
	}
	if (plan.kind === 'circle') {
		path.absarc(plan.center.x, -plan.center.z, plan.radius, 0, Math.PI * 2, true);
		path.closePath();
		return;
	}
	const first = plan.points[0];
	if (!first) throw new Error('polygon plan requires at least one point');
	path.moveTo(first.x, -first.z);
	for (const point of plan.points.slice(1)) path.lineTo(point.x, -point.z);
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

export function xzPlanShape(plan: PlanShape): THREE.Shape {
	const shape = new THREE.Shape();
	tracePlan(shape, plan);
	return shape;
}

export function addXZPlanHole(shape: THREE.Shape, plan: PlanShape): void {
	const hole = new THREE.Path();
	tracePlan(hole, plan);
	shape.holes.push(hole);
}

export function extrudedXZGeometry(plan: PlanShape, holes: readonly PlanShape[], thickness: number): THREE.ExtrudeGeometry {
	const shape = xzPlanShape(plan);
	for (const hole of holes) addXZPlanHole(shape, hole);
	const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
	geometry.rotateX(-Math.PI / 2);
	return geometry;
}

/** Builds a horizontal prism from its walkable top instead of exposing extrusion-axis bookkeeping. */
export function addExtrudedXZMesh(
	parent: THREE.Object3D,
	material: THREE.Material,
	{ plan, holes = [], topY, thickness, name, castShadow = false, receiveShadow = false }: XZExtrusionSpec,
): THREE.Mesh {
	const geometry = extrudedXZGeometry(plan, holes, thickness);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = topY - thickness;
	if (name) mesh.name = name;
	mesh.castShadow = castShadow;
	mesh.receiveShadow = receiveShadow;
	parent.add(mesh);
	return mesh;
}
