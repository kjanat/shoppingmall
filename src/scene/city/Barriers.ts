import * as THREE from 'three';
import type { TrafficClass } from '#/data/spatial';
import type { BarrierSpec } from '#/data/world';
import {
	BARRIER_HARDWARE,
	BARRIER_SPECS,
	barrierAdmits,
	barrierApproachBounds,
	barrierGateCollider,
	barrierOpenAngle,
} from '#/data/world';
import type { AABB, CollisionWorld } from '#/physics/Collision';
import { lit } from '#/render/material';
import { clamp, half } from '#/util/math';

/**
 * De slagbomen van de stad, met hun beleid uit het wereldmodel.
 *
 * De arm van de uitritgeul hing aan het ringverkeer en die van de stadsgarage aan
 * een sinus, en geen van beide hield iets tegen: je reed er dwars doorheen, in een
 * huurauto net zo goed als in de schrobmachine. Wie erlangs mag staat op de boom
 * (`BARRIER_SPECS`), niet in het voertuig dat aankomt: hier wordt alleen gevraagd
 * wat er aankomt en waar het staat.
 *
 * Zolang de arm ligt is zijn doorgang een collider; zodra hij ver genoeg omhoog is
 * verdwijnt die. Dat is één vlag op één doos, geen dozen die in en uit de lijst
 * springen waar de botsingslus elke frame drie keer overheen loopt.
 */

type Barrier = {
	spec: BarrierSpec;
	pivot: THREE.Group;
	gate: AABB;
	/** 0 = dicht over de rijstrook, 1 = rechtop. */
	open: number;
	/** Wat er deze frame is aangekomen en langs mag. */
	want: boolean;
};

export class Barriers {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly barriers = new Map<string, Barrier>();

	constructor(world: CollisionWorld) {
		this.group.name = 'city_barriers';

		const staal = this.track(lit({ color: 0xe8e8e2, roughness: 0.5, metalness: 0.2 }));
		const rood = this.track(new THREE.MeshBasicMaterial({ color: 0xc62f28, toneMapped: false }));
		const donker = this.track(lit({ color: 0x3b4046, roughness: 0.8 }));

		const { post, arm, pivotY } = BARRIER_HARDWARE;
		const postGeo = new THREE.CylinderGeometry(post.radius, post.radius, post.height, 10);
		const sleeveGeo = new THREE.BoxGeometry(arm.thickness + 0.02, arm.thickness + 0.02, arm.sleeveLength);
		this.geometries.push(postGeo, sleeveGeo);

		for (const spec of BARRIER_SPECS) {
			const paal = new THREE.Mesh(postGeo, donker);
			paal.position.set(spec.post.x, spec.post.y + half(post.height), spec.post.z);
			this.group.add(paal);

			const armGeo = new THREE.BoxGeometry(arm.thickness, arm.thickness, spec.armLength);
			this.geometries.push(armGeo);
			const pivot = new THREE.Group();
			pivot.position.set(spec.post.x, spec.post.y + pivotY, spec.post.z);
			const balk = new THREE.Mesh(armGeo, staal);
			balk.position.z = spec.armSide * half(spec.armLength);
			pivot.add(balk);
			for (let i = 0; i < arm.sleeves; i++) {
				const sleeve = new THREE.Mesh(sleeveGeo, rood);
				sleeve.position.z = (spec.armSide * spec.armLength * (i + 1)) / (arm.sleeves + 1);
				pivot.add(sleeve);
			}
			this.group.add(pivot);

			const box = barrierGateCollider(spec);
			this.barriers.set(spec.id, {
				spec,
				pivot,
				gate: world.addBox(box.minX, box.maxX, box.minZ, box.maxZ, {
					minY: box.minY,
					maxY: box.maxY,
					label: box.label,
					outdoor: true,
				}),
				open: 0,
				want: false,
			});
		}
	}

	/**
	 * Meld dat er iets aankomt. De boom kijkt zelf of het punt in zijn aanloopstrook
	 * ligt en of hij deze klasse doorlaat; een voertuig weet daar niets van.
	 */
	approach(x: number, z: number, traffic: TrafficClass): void {
		for (const barrier of this.barriers.values()) {
			if (barrier.want || !barrierAdmits(barrier.spec, traffic)) continue;
			const strook = barrierApproachBounds(barrier.spec);
			if (x < strook.minX || x > strook.maxX || z < strook.minZ || z > strook.maxZ) continue;
			barrier.want = true;
		}
	}

	/** Hangt de arm nog in de doorgang? Dan komt er niets langs, wie het ook is. */
	blocks(id: string): boolean {
		const barrier = this.barriers.get(id);
		return barrier === undefined ? false : barrier.open < BARRIER_HARDWARE.clearFraction;
	}

	update(dt: number): void {
		for (const barrier of this.barriers.values()) {
			const richting = barrier.want ? BARRIER_HARDWARE.speed : -BARRIER_HARDWARE.speed;
			barrier.open = clamp(barrier.open + richting * dt, 0, 1);
			barrier.pivot.rotation.x = barrierOpenAngle(barrier.spec) * barrier.open;
			barrier.gate.disabled = barrier.open >= BARRIER_HARDWARE.clearFraction;
			barrier.want = false;
		}
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		this.group.clear();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
