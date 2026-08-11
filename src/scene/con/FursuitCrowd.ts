import * as THREE from 'three';
import {
	CON_BODY,
	CON_CROWD_COUNT,
	CON_DEALERS,
	CON_FLOOR_Y,
	CON_HOTEL,
	CON_PLAZA,
	CON_PORTAL,
	CON_STAGE,
	inRect2,
	rectInterior,
} from '#/data/conPlan';

const HIP_Y = CON_BODY * (0.92 / 1.9);
const PATH_INSET = CON_BODY * 4;

import {
	ACCENT_COLORS,
	type BodyPartId,
	type Bone,
	FUR_COLORS,
	furMat,
	makeSkeleton,
	partGeometry,
	partRestOffset,
	partRestScale,
} from '#/scene/con/FursuitKit';
import { lerp } from '#/util/math';
import { at, mulberry32, pickWith } from '#/util/rand';

const SEED = 0xf47c0de;
const PARTS: readonly BodyPartId[] = [
	'pelvis',
	'waist',
	'chest',
	'top',
	'thighL',
	'thighR',
	'shinL',
	'shinR',
	'footL',
	'footR',
	'armL',
	'armR',
	'skull',
	'snout',
	'tail',
];

type Agent = {
	mode: 'walk' | 'dance' | 'idle';
	phase: number;
	speed: number;
	path: readonly { x: number; z: number }[];
	pathI: number;
	x: number;
	z: number;
	yaw: number;
	scale: number;
	fur: number;
	cloth: number;
	/** Index of hand-holding partner, or -1. Couples share a path and stay close. */
	partner: number;
	/** Lateral offset when following partner (m). */
	pairSide: number;
};

type Layer = {
	id: BodyPartId;
	mesh: THREE.InstancedMesh;
	bone: Bone;
	rest: THREE.Matrix4;
};

/**
 * ~100 suiters as 15 InstancedMeshes (one per body part).
 * Pose math on one off-scene skeleton; GPU gets matrices only.
 */
export class FursuitCrowd {
	readonly group = new THREE.Group();
	private readonly agents: Agent[] = [];
	private readonly layers: Layer[] = [];
	private readonly skeleton = makeSkeleton();
	private readonly boneById: Map<BodyPartId, Bone>;
	private readonly scratch = new THREE.Matrix4();
	private readonly geos: THREE.BufferGeometry[] = [];

	constructor() {
		this.group.name = 'fursuit_crowd';
		this.boneById = new Map(this.skeleton.bones.map((b) => [b.id, b]));
		this.buildLayers();
		this.spawnAgents();
		this.writeAll();
	}

	update(dt: number, t: number): void {
		for (const a of this.agents) this.stepAgent(a, dt, t);
		this.writeAll();
	}

	dispose(): void {
		for (const layer of this.layers) {
			layer.mesh.dispose();
			this.group.remove(layer.mesh);
		}
		for (const g of this.geos) g.dispose();
	}

	private buildLayers(): void {
		const n = CON_CROWD_COUNT;
		const white = furMat(0xffffff);
		for (const id of PARTS) {
			const bone = this.boneById.get(id);
			if (!bone) continue;
			const geo = partGeometry(id);
			this.geos.push(geo);
			const s = partRestScale(id);
			const o = partRestOffset(id);
			const rest = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z));
			if (id === 'tail') rest.multiply(new THREE.Matrix4().makeRotationX(0.9));
			if (id === 'armL') rest.multiply(new THREE.Matrix4().makeRotationZ(-0.25));
			if (id === 'armR') rest.multiply(new THREE.Matrix4().makeRotationZ(0.25));

			const mesh = new THREE.InstancedMesh(geo, white, n);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.frustumCulled = false;
			mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
			this.group.add(mesh);
			this.layers.push({ id, mesh, bone, rest });
		}
	}

	private spawnAgents(): void {
		const rand = mulberry32(SEED);
		const paths = this.paths();
		const n = CON_CROWD_COUNT;
		// ~55% walk as gay couples (hand-hold pairs); rest solo.
		const coupleSlots = Math.floor(n * 0.55) & ~1;
		for (let i = 0; i < n; i++) {
			const path = at(paths, i % paths.length);
			const start = at(path, Math.floor(rand() * path.length));
			const roll = rand();
			const inCouple = i < coupleSlots;
			const lead = inCouple && i % 2 === 0;
			const partner = !inCouple ? -1 : lead ? i + 1 : i - 1;
			this.agents.push({
				mode: roll < 0.4 ? 'walk' : roll < 0.78 ? 'dance' : 'idle',
				phase: rand() * Math.PI * 2,
				speed: 1.05 + rand() * 0.85,
				path,
				pathI: Math.floor(rand() * path.length),
				x: start.x + (inCouple && !lead ? 0.55 : 0),
				z: start.z + (inCouple && !lead ? 0.2 : 0),
				yaw: rand() * Math.PI * 2,
				scale: 0.94 + rand() * 0.14,
				fur: pickWith(FUR_COLORS, rand),
				cloth: pickWith(ACCENT_COLORS, rand),
				partner,
				pairSide: lead ? -0.45 : 0.45,
			});
		}
		// Couples share path + phase so they stay together.
		for (let i = 0; i < coupleSlots; i += 2) {
			const a = this.agents[i];
			const b = this.agents[i + 1];
			if (!a || !b) continue;
			b.path = a.path;
			b.pathI = a.pathI;
			b.mode = a.mode === 'idle' ? 'walk' : a.mode;
			b.speed = a.speed;
			b.phase = a.phase + 0.4;
		}
	}

	private paths(): readonly (readonly { x: number; z: number }[])[] {
		const ring = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, n: number) => {
			const pts: { x: number; z: number }[] = [];
			const edge = (along: number) => {
				if (along < 1) return { x: lerp(r.minX, r.maxX, along), z: r.minZ };
				if (along < 2) return { x: r.maxX, z: lerp(r.minZ, r.maxZ, along - 1) };
				if (along < 3) return { x: lerp(r.maxX, r.minX, along - 2), z: r.maxZ };
				return { x: r.minX, z: lerp(r.maxZ, r.minZ, along - 3) };
			};
			for (let i = 0; i < n; i++) pts.push(edge((i / n) * 4));
			return pts;
		};
		const dealers = rectInterior(CON_DEALERS, 3);
		const stage = rectInterior(CON_STAGE, 3);
		const hotel = rectInterior(CON_HOTEL, 3);
		const plaza = CON_PLAZA;
		return [
			ring(dealers, 16),
			ring(stage, 12),
			ring(hotel, 10),
			[
				{ x: plaza.minX + 10, z: 0 },
				{ x: plaza.maxX - 4, z: -6 },
				{ x: CON_PORTAL.innerX + 2, z: 0 },
				{ x: plaza.maxX - 4, z: 6 },
			],
			[
				{ x: dealers.minX + PATH_INSET, z: dealers.minZ + PATH_INSET },
				{ x: dealers.maxX - PATH_INSET, z: dealers.minZ + PATH_INSET },
				{ x: dealers.maxX - PATH_INSET, z: dealers.maxZ - PATH_INSET },
				{ x: dealers.minX + PATH_INSET, z: dealers.maxZ - PATH_INSET },
			],
		];
	}

	private stepAgent(a: Agent, dt: number, t: number): void {
		a.phase += dt * a.speed;
		// Follower: stick to partner's side (hand-hold).
		if (a.partner >= 0) {
			const p = this.agents[a.partner];
			if (p && a.pairSide > 0) {
				const sideX = Math.cos(p.yaw) * a.pairSide;
				const sideZ = -Math.sin(p.yaw) * a.pairSide;
				const tx = p.x + sideX;
				const tz = p.z + sideZ;
				const dx = tx - a.x;
				const dz = tz - a.z;
				const dist = Math.hypot(dx, dz);
				if (dist > 0.05) {
					const step = Math.min(dist, a.speed * CON_BODY * 1.1 * dt);
					a.x += (dx / dist) * step;
					a.z += (dz / dist) * step;
				}
				a.yaw = p.yaw;
				a.mode = p.mode === 'idle' ? 'walk' : p.mode;
				return;
			}
		}
		if (a.mode === 'walk') {
			const target = at(a.path, a.pathI);
			const dx = target.x - a.x;
			const dz = target.z - a.z;
			const dist = Math.hypot(dx, dz);
			if (dist < CON_BODY * 0.18) a.pathI = (a.pathI + 1) % a.path.length;
			else {
				const step = Math.min(dist, a.speed * CON_BODY * 0.85 * dt);
				a.x += (dx / dist) * step;
				a.z += (dz / dist) * step;
				a.yaw = Math.atan2(dx, dz);
			}
		} else if (a.mode === 'dance' && inRect2(CON_STAGE, a.x, a.z)) {
			a.yaw = t * 0.4 + a.phase;
		}
	}

	private poseAgent(a: Agent): void {
		const { root, hips } = this.skeleton;
		root.position.set(a.x, CON_FLOOR_Y, a.z);
		root.rotation.set(0, a.yaw, 0);
		root.scale.setScalar(a.scale);

		const thighL = this.boneById.get('thighL')?.node;
		const thighR = this.boneById.get('thighR')?.node;
		const shinL = this.boneById.get('shinL')?.node;
		const shinR = this.boneById.get('shinR')?.node;

		if (a.mode === 'walk') {
			const swing = Math.sin(a.phase * 6) * 0.45;
			if (thighL) thighL.rotation.x = swing;
			if (thighR) thighR.rotation.x = -swing;
			if (shinL) shinL.rotation.x = Math.max(0, -swing) * 0.4;
			if (shinR) shinR.rotation.x = Math.max(0, swing) * 0.4;
			hips.rotation.set(0, Math.sin(a.phase * 3) * 0.08, 0);
			hips.position.y = HIP_Y;
		} else if (a.mode === 'dance') {
			hips.position.y = HIP_Y + Math.abs(Math.sin(a.phase * 4)) * 0.08 * CON_BODY;
			hips.rotation.set(0, Math.sin(a.phase * 2) * 0.35, Math.sin(a.phase * 3) * 0.12);
			if (thighL) thighL.rotation.x = Math.sin(a.phase * 4) * 0.25;
			if (thighR) thighR.rotation.x = Math.sin(a.phase * 4 + 1) * 0.25;
			if (shinL) shinL.rotation.x = 0;
			if (shinR) shinR.rotation.x = 0;
		} else {
			hips.rotation.set(0, Math.sin(a.phase * 0.7) * 0.1, 0);
			hips.position.y = HIP_Y + Math.sin(a.phase) * 0.01 * CON_BODY;
			if (thighL) thighL.rotation.x = 0;
			if (thighR) thighR.rotation.x = 0;
			if (shinL) shinL.rotation.x = 0;
			if (shinR) shinR.rotation.x = 0;
		}

		const tail = this.boneById.get('tail')?.node;
		if (tail) tail.rotation.x = Math.sin(a.phase * 2) * 0.1;

		root.updateMatrixWorld(true);
	}

	private writeAll(): void {
		const color = new THREE.Color();
		for (let i = 0; i < this.agents.length; i++) {
			const a = at(this.agents, i);
			this.poseAgent(a);
			for (const layer of this.layers) {
				this.scratch.copy(layer.bone.node.matrixWorld).multiply(layer.rest);
				layer.mesh.setMatrixAt(i, this.scratch);
				const hex = layer.bone.channel === 'cloth' ? a.cloth : layer.bone.channel === 'dark' ? 0x1a1218 : a.fur;
				color.setHex(hex);
				layer.mesh.setColorAt(i, color);
			}
		}
		for (const layer of this.layers) {
			layer.mesh.instanceMatrix.needsUpdate = true;
			if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
			layer.mesh.computeBoundingSphere();
		}
	}
}
