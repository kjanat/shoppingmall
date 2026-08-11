import * as THREE from 'three';
import { CON_BODY } from '#/data/conPlan';
import { lit } from '#/render/material';

/** Body fur — warm canines, greys, pastels, classic suit dyes. */
export const FUR_COLORS = [
	0xc4783a, 0xe8a070, 0x8b5a2b, 0xd4a574, 0xf0c8a0, 0x6b4f3a, 0xb0b8c0, 0xe8d0e8, 0x4a90d9, 0x2a2a38, 0xf5e6d3, 0xff8c42,
	0x8b7355, 0x5c4033, 0xd2691e, 0x9e9e9e,
] as const;

/** Cream / belly two-tone. */
export const BELLY_COLORS = [0xfff0dd, 0xffe4c4, 0xf5e6d3, 0xfff8f0, 0xe8dcc8, 0xffeaa7, 0xf0e6ff] as const;

/** Pride / club accents — ears tips, shirt, harness. */
export const ACCENT_COLORS = [
	0xff6b9d, 0x7c5cff, 0x00e5a0, 0xffc857, 0xff4d6d, 0x5eead4, 0xff2d95, 0x38bdf8, 0xa855f7, 0xf472b6, 0x22d3ee, 0xe879f9,
] as const;

export const PRIDE_STRIPES = [0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x24408e, 0x732982, 0x5bcefa, 0xf5a9b8, 0xffffff] as const;

export const SPECIES = ['wolf', 'fox', 'dragon', 'cat', 'bunny', 'husky', 'protogen'] as const;
export type Species = (typeof SPECIES)[number];

/**
 * Skeleton authored at body height 1.9 m.
 */
const U = CON_BODY / 1.9;

export type BodyPartId =
	| 'pelvis'
	| 'waist'
	| 'chest'
	| 'belly'
	| 'top'
	| 'thighL'
	| 'thighR'
	| 'shinL'
	| 'shinR'
	| 'footL'
	| 'footR'
	| 'armL'
	| 'armR'
	| 'handL'
	| 'handR'
	| 'skull'
	| 'snout'
	| 'nose'
	| 'eyeL'
	| 'eyeR'
	| 'earL'
	| 'earR'
	| 'tail';

export type FurChannel = 'fur' | 'belly' | 'cloth' | 'dark' | 'eye' | 'nose';

export type Bone = {
	id: BodyPartId;
	node: THREE.Object3D;
	channel: FurChannel;
};

/** Per-species head / tail / ear read so a fox is not a wolf with longer ears. */
export type SpeciesLook = Readonly<{
	earH: number;
	earW: number;
	earD: number;
	earZ: number;
	earSpread: number;
	snoutL: number;
	snoutW: number;
	skull: number;
	tailL: number;
	tailW: number;
	nose: number;
}>;

export const SPECIES_LOOK: Readonly<Record<Species, SpeciesLook>> = {
	wolf: {
		earH: 1.15,
		earW: 1,
		earD: 0.85,
		earZ: 0,
		earSpread: 1,
		snoutL: 1.35,
		snoutW: 1.05,
		skull: 1.08,
		tailL: 1.2,
		tailW: 1.15,
		nose: 1.1,
	},
	fox: {
		earH: 1.45,
		earW: 0.85,
		earD: 0.7,
		earZ: 0.05,
		earSpread: 1.05,
		snoutL: 1.55,
		snoutW: 0.85,
		skull: 0.98,
		tailL: 1.55,
		tailW: 1.45,
		nose: 0.95,
	},
	dragon: {
		earH: 0.7,
		earW: 0.55,
		earD: 1.4,
		earZ: -0.1,
		earSpread: 1.25,
		snoutL: 1.7,
		snoutW: 1.15,
		skull: 1.12,
		tailL: 1.8,
		tailW: 0.9,
		nose: 1.2,
	},
	cat: {
		earH: 1.05,
		earW: 1.1,
		earD: 0.55,
		earZ: 0.02,
		earSpread: 1.15,
		snoutL: 0.85,
		snoutW: 0.95,
		skull: 1.02,
		tailL: 1.35,
		tailW: 0.75,
		nose: 0.85,
	},
	bunny: {
		earH: 2.4,
		earW: 0.55,
		earD: 0.45,
		earZ: -0.05,
		earSpread: 0.85,
		snoutL: 0.75,
		snoutW: 1.05,
		skull: 1.05,
		tailL: 0.45,
		tailW: 1.6,
		nose: 0.9,
	},
	husky: {
		earH: 1.05,
		earW: 1.05,
		earD: 0.9,
		earZ: 0,
		earSpread: 1,
		snoutL: 1.25,
		snoutW: 1.1,
		skull: 1.1,
		tailL: 1.15,
		tailW: 1.25,
		nose: 1.15,
	},
	protogen: {
		earH: 0.9,
		earW: 0.7,
		earD: 0.9,
		earZ: 0.08,
		earSpread: 1.1,
		snoutL: 1.1,
		snoutW: 1.25,
		skull: 1.15,
		tailL: 1.1,
		tailW: 1,
		nose: 0.7,
	},
};

/**
 * Pose skeleton for matrix math. Never added to the scene.
 * Head bits parent under skull so one yaw moves the whole face.
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
		channel: FurChannel = 'fur',
	): THREE.Object3D => {
		const node = new THREE.Object3D();
		node.name = id;
		node.position.set(x * U, y * U, z * U);
		parent.add(node);
		bones.push({ id, node, channel });
		return node;
	};

	add('pelvis', hips, 0, 0, 0);
	add('waist', hips, 0, 0.26, 0.02);
	add('chest', hips, 0, 0.52, 0.05);
	add('belly', hips, 0, 0.32, 0.14, 'belly');
	add('top', hips, 0, 0.5, 0.02, 'cloth');

	const thighL = add('thighL', hips, -0.15, 0, 0);
	const shinL = add('shinL', thighL, 0, -0.34, 0.04);
	add('footL', shinL, 0, -0.36, 0.1, 'dark');

	const thighR = add('thighR', hips, 0.15, 0, 0);
	const shinR = add('shinR', thighR, 0, -0.34, 0.04);
	add('footR', shinR, 0, -0.36, 0.1, 'dark');

	const armL = add('armL', hips, -0.34, 0.48, 0);
	const armR = add('armR', hips, 0.34, 0.48, 0);
	add('handL', armL, 0, -0.42, 0.02, 'fur');
	add('handR', armR, 0, -0.42, 0.02, 'fur');

	const skull = add('skull', hips, 0, 0.98, 0.02);
	add('snout', skull, 0, -0.04, 0.18);
	add('nose', skull, 0, -0.02, 0.32, 'nose');
	add('eyeL', skull, -0.08, 0.05, 0.14, 'eye');
	add('eyeR', skull, 0.08, 0.05, 0.14, 'eye');
	add('earL', skull, -0.13, 0.18, -0.04);
	add('earR', skull, 0.13, 0.18, -0.04);
	add('tail', hips, 0, 0.08, -0.32);

	return { root, hips, bones };
}

export function partGeometry(id: BodyPartId): THREE.BufferGeometry {
	switch (id) {
		case 'pelvis':
			return new THREE.SphereGeometry(0.26 * U, 10, 8);
		case 'waist':
			return new THREE.SphereGeometry(0.17 * U, 8, 6);
		case 'chest':
			return new THREE.SphereGeometry(0.24 * U, 10, 8);
		case 'belly':
			return new THREE.SphereGeometry(0.14 * U, 8, 6);
		case 'top':
			return new THREE.SphereGeometry(0.2 * U, 8, 6);
		case 'thighL':
		case 'thighR':
			return new THREE.CapsuleGeometry(0.14 * U, 0.34 * U, 4, 8);
		case 'shinL':
		case 'shinR':
			return new THREE.CapsuleGeometry(0.095 * U, 0.32 * U, 4, 8);
		case 'footL':
		case 'footR':
			return new THREE.SphereGeometry(0.11 * U, 8, 6);
		case 'armL':
		case 'armR':
			return new THREE.CapsuleGeometry(0.075 * U, 0.4 * U, 4, 8);
		case 'handL':
		case 'handR':
			return new THREE.SphereGeometry(0.09 * U, 8, 6);
		case 'skull':
			return new THREE.SphereGeometry(0.2 * U, 12, 10);
		case 'snout':
			return new THREE.CapsuleGeometry(0.09 * U, 0.16 * U, 4, 8);
		case 'nose':
			return new THREE.SphereGeometry(0.045 * U, 8, 6);
		case 'eyeL':
		case 'eyeR':
			return new THREE.SphereGeometry(0.038 * U, 8, 6);
		case 'earL':
		case 'earR':
			return new THREE.ConeGeometry(0.09 * U, 0.22 * U, 7);
		case 'tail':
			return new THREE.CapsuleGeometry(0.075 * U, 0.55 * U, 4, 8);
	}
}

export function partRestScale(id: BodyPartId): THREE.Vector3 {
	switch (id) {
		case 'pelvis':
			return new THREE.Vector3(1.45, 0.9, 1.25);
		case 'waist':
			return new THREE.Vector3(1.1, 1.15, 0.95);
		case 'chest':
			return new THREE.Vector3(1.55, 1.15, 1.2);
		case 'belly':
			return new THREE.Vector3(1.35, 1.5, 0.85);
		case 'top':
			return new THREE.Vector3(1.55, 0.65, 1.2);
		case 'footL':
		case 'footR':
			return new THREE.Vector3(1.15, 0.55, 1.85);
		case 'handL':
		case 'handR':
			return new THREE.Vector3(1.2, 0.85, 1.35);
		case 'skull':
			return new THREE.Vector3(1.15, 1.1, 1.2);
		case 'snout':
			return new THREE.Vector3(0.95, 0.85, 1.65);
		case 'nose':
			return new THREE.Vector3(1.1, 0.85, 1.3);
		case 'eyeL':
		case 'eyeR':
			return new THREE.Vector3(1, 1.15, 0.7);
		case 'earL':
		case 'earR':
			return new THREE.Vector3(1, 1.2, 0.7);
		case 'tail':
			return new THREE.Vector3(1.1, 1.1, 1.15);
		default:
			return new THREE.Vector3(1, 1, 1);
	}
}

export function partRestOffset(id: BodyPartId): THREE.Vector3 {
	switch (id) {
		case 'thighL':
		case 'thighR':
			return new THREE.Vector3(0, -0.22 * U, 0);
		case 'shinL':
		case 'shinR':
			return new THREE.Vector3(0, -0.2 * U, 0.02 * U);
		case 'armL':
		case 'armR':
			return new THREE.Vector3(0, -0.18 * U, 0);
		case 'snout':
			return new THREE.Vector3(0, 0, 0.06 * U);
		case 'tail':
			return new THREE.Vector3(0, 0, -0.12 * U);
		default:
			return new THREE.Vector3(0, 0, 0);
	}
}

/** Rest pose matrix for a part (shared), before species multiply. */
export function partRestMatrix(id: BodyPartId): THREE.Matrix4 {
	const s = partRestScale(id);
	const o = partRestOffset(id);
	const m = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z));
	if (id === 'tail') m.multiply(new THREE.Matrix4().makeRotationX(0.95));
	if (id === 'armL') m.multiply(new THREE.Matrix4().makeRotationZ(-0.3));
	if (id === 'armR') m.multiply(new THREE.Matrix4().makeRotationZ(0.3));
	if (id === 'snout') m.multiply(new THREE.Matrix4().makeRotationX(1.15));
	if (id === 'earL') m.multiply(new THREE.Matrix4().makeRotationZ(0.2));
	if (id === 'earR') m.multiply(new THREE.Matrix4().makeRotationZ(-0.2));
	return m;
}

/** Extra scale/offset for species identity on head & tail. */
export function speciesPartScale(species: Species, id: BodyPartId): THREE.Vector3 {
	const L = SPECIES_LOOK[species];
	switch (id) {
		case 'skull':
			return new THREE.Vector3(L.skull, L.skull, L.skull);
		case 'snout':
			return new THREE.Vector3(L.snoutW, L.snoutW * 0.9, L.snoutL);
		case 'nose':
			return new THREE.Vector3(L.nose, L.nose * 0.85, L.nose * 1.15);
		case 'earL':
		case 'earR':
			return new THREE.Vector3(L.earW, L.earH, L.earD);
		case 'tail':
			return new THREE.Vector3(L.tailW, L.tailW, L.tailL);
		case 'eyeL':
		case 'eyeR':
			return species === 'protogen' ? new THREE.Vector3(1.35, 0.7, 0.55) : new THREE.Vector3(1, 1, 1);
		default:
			return new THREE.Vector3(1, 1, 1);
	}
}

export function speciesEarSpread(species: Species): number {
	return SPECIES_LOOK[species].earSpread;
}

export function channelColor(channel: FurChannel, fur: number, belly: number, cloth: number): number {
	switch (channel) {
		case 'cloth':
			return cloth;
		case 'belly':
			return belly;
		case 'dark':
			return 0x1a1218;
		case 'eye':
			return 0x111111;
		case 'nose':
			return 0x1a1014;
		default:
			return fur;
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

/**
 * Close-up fursuit (adult wing). Same parts as the crowd so they read as the same cast.
 */
export function buildHeroSuit(
	species: Species,
	fur: number,
	belly: number,
	cloth: number,
	rand: () => number,
	opts?: { male?: boolean },
): THREE.Group {
	const root = new THREE.Group();
	const skin = furMat(fur);
	const bellyM = furMat(belly);
	const clothM = furMat(cloth);
	const dark = furMat(0x1a1218);
	const eyeM = furMat(0x0a0a0c, 0.35);
	const noseM = furMat(0x1a1014, 0.45);
	const look = SPECIES_LOOK[species];

	const hips = new THREE.Group();
	hips.name = 'hips';
	hips.position.y = 0.92 * U;
	root.add(hips);

	const matOf = (ch: FurChannel): THREE.Material => {
		switch (ch) {
			case 'belly':
				return bellyM;
			case 'cloth':
				return clothM;
			case 'dark':
				return dark;
			case 'eye':
				return eyeM;
			case 'nose':
				return noseM;
			default:
				return skin;
		}
	};

	const addPart = (id: BodyPartId, parent: THREE.Object3D, x: number, y: number, z: number, channel: FurChannel) => {
		const geo = partGeometry(id);
		const mesh = new THREE.Mesh(geo, matOf(channel));
		const s = partRestScale(id);
		const o = partRestOffset(id);
		const sp = speciesPartScale(species, id);
		mesh.scale.set(s.x * sp.x, s.y * sp.y, s.z * sp.z);
		mesh.position.set(x * U + o.x, y * U + o.y, z * U + o.z);
		if (id === 'tail') mesh.rotation.x = 0.95;
		if (id === 'armL') mesh.rotation.z = -0.3;
		if (id === 'armR') mesh.rotation.z = 0.3;
		if (id === 'snout') mesh.rotation.x = 1.15;
		if (id === 'earL') mesh.rotation.z = 0.22 * look.earSpread;
		if (id === 'earR') mesh.rotation.z = -0.22 * look.earSpread;
		parent.add(mesh);
		return mesh;
	};

	addPart('pelvis', hips, 0, 0, 0, 'fur');
	addPart('waist', hips, 0, 0.26, 0.02, 'fur');
	addPart('chest', hips, 0, 0.52, 0.05, 'fur');
	addPart('belly', hips, 0, 0.32, 0.14, 'belly');
	addPart('top', hips, 0, 0.5, 0.02, 'cloth');

	const head = new THREE.Group();
	head.position.set(0, 0.98 * U, 0.02 * U);
	hips.add(head);
	addPart('skull', head, 0, 0, 0, 'fur');
	addPart('snout', head, 0, -0.04, 0.18, 'fur');
	addPart('nose', head, 0, -0.02, 0.32, 'nose');
	addPart('eyeL', head, -0.08, 0.05, 0.14, 'eye');
	addPart('eyeR', head, 0.08, 0.05, 0.14, 'eye');
	addPart('earL', head, -0.13 * look.earSpread, 0.18, -0.04 + look.earZ, 'fur');
	addPart('earR', head, 0.13 * look.earSpread, 0.18, -0.04 + look.earZ, 'fur');

	for (const sx of [-1, 1] as const) {
		const leg = new THREE.Group();
		leg.position.set(sx * 0.15 * U, 0, 0);
		hips.add(leg);
		addPart(sx < 0 ? 'thighL' : 'thighR', leg, 0, 0, 0, 'fur');
		addPart(sx < 0 ? 'shinL' : 'shinR', leg, 0, -0.34, 0.04, 'fur');
		addPart(sx < 0 ? 'footL' : 'footR', leg, 0, -0.7, 0.14, 'dark');
		const arm = new THREE.Group();
		arm.position.set(sx * 0.34 * U, 0.48 * U, 0);
		hips.add(arm);
		addPart(sx < 0 ? 'armL' : 'armR', arm, 0, 0, 0, 'fur');
		addPart(sx < 0 ? 'handL' : 'handR', arm, 0, -0.42, 0.02, 'fur');
	}
	addPart('tail', hips, 0, 0.08, -0.32, 'fur');

	if (opts?.male) {
		const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.055 * U, 0.32 * U, 4, 8), furMat(0xf0b898, 0.55));
		shaft.name = 'shaft';
		shaft.position.set(0, -0.06 * U, 0.26 * U);
		shaft.rotation.x = -1.15;
		hips.add(shaft);
		const balls = new THREE.Mesh(new THREE.SphereGeometry(0.07 * U, 8, 6), furMat(0xe8a878, 0.7));
		balls.scale.set(1.55, 0.95, 1.15);
		balls.position.set(0, -0.15 * U, 0.16 * U);
		hips.add(balls);
	}

	root.scale.setScalar(0.94 + rand() * 0.14);
	return root;
}
