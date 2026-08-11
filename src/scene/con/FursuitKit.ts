import * as THREE from 'three';
import { CON_BODY } from '#/data/conPlan';
import { lit } from '#/render/material';

/** Shared low-poly body parts for every fursuiter (crowd + adult). */
export const FUR_COLORS = [
	0xc4783a, 0xe8a070, 0x8b5a2b, 0xd4a574, 0xf0c8a0, 0x6b4f3a, 0xb0b8c0, 0xe8d0e8, 0x4a90d9, 0x2a2a38, 0xf5e6d3,
] as const;
/** Pride / club accents — pink, purple, cyan, rainbow stripe colours. */
export const ACCENT_COLORS = [
	0xff6b9d, 0x7c5cff, 0x00e5a0, 0xffc857, 0xff4d6d, 0x5eead4, 0xff2d95, 0x38bdf8, 0xa855f7, 0xf472b6, 0x22d3ee, 0xe879f9,
] as const;
/** Progress pride-ish flag stripe colours for banners. */
export const PRIDE_STRIPES = [0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x24408e, 0x732982, 0x5bcefa, 0xf5a9b8, 0xffffff] as const;
export const SPECIES = ['wolf', 'fox', 'dragon', 'cat', 'bunny', 'husky', 'protogen'] as const;
export type Species = (typeof SPECIES)[number];

/**
 * Skeleton was authored at body height 1.9 m (= STANDING_PEDESTRIAN.bodyHeight).
 * All bone metres multiply by this so a character change rescales the con cast.
 */
const U = CON_BODY / 1.9;

export type BodyPartId =
	| 'pelvis'
	| 'waist'
	| 'chest'
	| 'top'
	| 'thighL'
	| 'thighR'
	| 'shinL'
	| 'shinR'
	| 'footL'
	| 'footR'
	| 'armL'
	| 'armR'
	| 'skull'
	| 'snout'
	| 'tail';

/** One bone in the off-scene pose skeleton. */
export type Bone = {
	id: BodyPartId;
	node: THREE.Object3D;
	/** Which material channel: fur body vs cloth accent vs dark. */
	channel: 'fur' | 'cloth' | 'dark';
};

/**
 * Pose skeleton used only for matrix math. Never added to the scene.
 * Limb chains are parented so thigh rotation carries shin and foot.
 */
export function makeSkeleton(): { root: THREE.Object3D; hips: THREE.Object3D; bones: readonly Bone[] } {
	const root = new THREE.Object3D();
	const hips = new THREE.Object3D();
	hips.name = 'hips';
	hips.position.y = 0.92 * U;
	root.add(hips);

	const bones: Bone[] = [];
	const add = (
		id: BodyPartId,
		parent: THREE.Object3D,
		x: number,
		y: number,
		z: number,
		channel: Bone['channel'] = 'fur',
	): THREE.Object3D => {
		const node = new THREE.Object3D();
		node.name = id;
		node.position.set(x * U, y * U, z * U);
		parent.add(node);
		bones.push({ id, node, channel });
		return node;
	};

	add('pelvis', hips, 0, 0, 0);
	add('waist', hips, 0, 0.28, 0);
	add('chest', hips, 0, 0.55, 0.04);
	add('top', hips, 0, 0.52, 0);

	const thighL = add('thighL', hips, -0.14, 0, 0);
	const shinL = add('shinL', thighL, 0, -0.34, 0);
	add('footL', shinL, 0, -0.38, 0.06, 'dark');

	const thighR = add('thighR', hips, 0.14, 0, 0);
	const shinR = add('shinR', thighR, 0, -0.34, 0);
	add('footR', shinR, 0, -0.38, 0.06, 'dark');

	add('armL', hips, -0.32, 0.48, 0);
	add('armR', hips, 0.32, 0.48, 0);
	add('skull', hips, 0, 0.95, 0);
	add('snout', hips, 0, 0.91, 0.14);
	add('tail', hips, 0, 0.1, -0.28);

	return { root, hips, bones };
}

export function partGeometry(id: BodyPartId): THREE.BufferGeometry {
	switch (id) {
		case 'pelvis':
			return new THREE.SphereGeometry(0.24 * U, 8, 6);
		case 'waist':
			return new THREE.SphereGeometry(0.16 * U, 8, 6);
		case 'chest':
			return new THREE.SphereGeometry(0.22 * U, 8, 6);
		case 'top':
			return new THREE.SphereGeometry(0.2 * U, 8, 6);
		case 'thighL':
		case 'thighR':
			return new THREE.CapsuleGeometry(0.13 * U, 0.36 * U, 3, 6);
		case 'shinL':
		case 'shinR':
			return new THREE.CapsuleGeometry(0.09 * U, 0.34 * U, 3, 6);
		case 'footL':
		case 'footR':
			return new THREE.SphereGeometry(0.1 * U, 6, 4);
		case 'armL':
		case 'armR':
			return new THREE.CapsuleGeometry(0.07 * U, 0.42 * U, 3, 6);
		case 'skull':
			return new THREE.SphereGeometry(0.16 * U, 8, 6);
		case 'snout':
			return new THREE.SphereGeometry(0.09 * U, 6, 4);
		case 'tail':
			return new THREE.CapsuleGeometry(0.06 * U, 0.5 * U, 3, 6);
	}
}

/** Rest pose scale baked into geometry via matrix, applied once at mesh build. */
export function partRestScale(id: BodyPartId): THREE.Vector3 {
	switch (id) {
		case 'pelvis':
			return new THREE.Vector3(1.35, 0.85, 1.15);
		case 'waist':
			return new THREE.Vector3(1.05, 1.1, 0.9);
		case 'chest':
			return new THREE.Vector3(1.45, 1.05, 1.1);
		case 'top':
			return new THREE.Vector3(1.5, 0.7, 1.15);
		case 'footL':
		case 'footR':
			return new THREE.Vector3(1.1, 0.55, 1.6);
		case 'snout':
			return new THREE.Vector3(0.9, 0.75, 1.4);
		default:
			return new THREE.Vector3(1, 1, 1);
	}
}

/** Local mesh offset so capsules sit under their bone origin. */
export function partRestOffset(id: BodyPartId): THREE.Vector3 {
	switch (id) {
		case 'thighL':
		case 'thighR':
			return new THREE.Vector3(0, -0.22 * U, 0);
		case 'shinL':
		case 'shinR':
			return new THREE.Vector3(0, -0.22 * U, 0);
		default:
			return new THREE.Vector3(0, 0, 0);
	}
}

const litCache = new Map<number, THREE.Material>();

export function furMat(color: number, rough = 0.88): THREE.Material {
	const key = (color >>> 0) ^ (Math.round(rough * 50) << 24);
	const hit = litCache.get(key);
	if (hit) return hit;
	const m = lit({ color, roughness: rough });
	litCache.set(key, m);
	return m;
}

export function disposeFurMats(): void {
	for (const m of litCache.values()) m.dispose();
	litCache.clear();
}
