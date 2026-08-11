import * as THREE from 'three';
import { ENTRANCE_PORTAL } from '#/data/world';
import type { CollisionWorld } from '#/physics/Collision';
import { lit } from '#/render/material';
import { COLOSSEUM_PLAN } from '#/scene/city/cityPlan';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';

/**
 * ColosseumTransport — Roman Chariot Express Shuttle connecting
 * the Shopping Mall Main Entrance Plaza directly to the Mega Colosseum Arena.
 */
export class ColosseumTransport {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);

	private chariotMesh: THREE.Group;
	private pos = new THREE.Vector3();
	private direction: 'to_colosseum' | 'to_mall' = 'to_colosseum';

	// Key stops along the route
	private readonly stopMall = new THREE.Vector3(-46, 0.1, ENTRANCE_PORTAL.centerZ);
	private readonly stopColosseum = new THREE.Vector3(COLOSSEUM_PLAN.x, 0.1, COLOSSEUM_PLAN.z - COLOSSEUM_PLAN.arenaRadiusZ - 10);

	constructor(world?: CollisionWorld) {
		this.group.name = 'colosseum_transport';
		this.geometries.push(this.unitBox);

		this.chariotMesh = this.buildChariot();
		this.pos.copy(this.stopMall);
		this.chariotMesh.position.copy(this.pos);
		this.group.add(this.chariotMesh);

		this.buildStops();

		if (world) {
			this.registerColliders(world);
		}
	}

	update(_dt: number, time: number): void {
		const cycle = (Math.sin(time * 2.0) + 1.0) / 2.0;

		if (this.direction === 'to_colosseum') {
			this.pos.lerpVectors(this.stopMall, this.stopColosseum, cycle);
		} else {
			this.pos.lerpVectors(this.stopColosseum, this.stopMall, cycle);
		}

		this.chariotMesh.position.copy(this.pos);

		// Orient chariot along direction of travel
		const dir = this.stopColosseum.clone().sub(this.stopMall).normalize();
		this.chariotMesh.rotation.y = Math.atan2(dir.x, dir.z);
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
		const m = new THREE.Mesh(this.unitBox, mat);
		m.scale.set(w, h, d);
		m.position.set(x, y, z);
		m.castShadow = true;
		m.receiveShadow = true;
		return m;
	}

	private buildChariot(): THREE.Group {
		const chariot = new THREE.Group();

		const goldMat = lit({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
		const redMat = lit({ color: 0x990000, roughness: 0.6 });
		const woodMat = lit({ color: 0x5c4033, roughness: 0.8 });
		const whiteHorseMat = lit({ color: 0xf0ede6, roughness: 0.7 });
		this.materials.push(goldMat, redMat, woodMat, whiteHorseMat);

		// Chariot Body Carriage
		const body = this.box(1.8, 0.9, 2.2, goldMat, 0, 0.65, 0);
		chariot.add(body);

		const interior = this.box(1.6, 0.7, 1.8, redMat, 0, 0.75, 0);
		chariot.add(interior);

		// Large Spoke Wheels
		const wheelL = this.box(0.15, 1.2, 1.2, woodMat, -1.0, 0.6, 0);
		const wheelR = this.box(0.15, 1.2, 1.2, woodMat, 1.0, 0.6, 0);
		chariot.add(wheelL, wheelR);

		// Reins Beam
		const beam = this.box(0.15, 0.15, 3.2, woodMat, 0, 0.6, 2.0);
		chariot.add(beam);

		// Two Majestic Sculpted White Horses
		for (const side of [-0.8, 0.8]) {
			const horseGroup = new THREE.Group();
			horseGroup.position.set(side, 0, 3.4);

			// Torso
			const horseBody = this.box(0.7, 0.9, 1.8, whiteHorseMat, 0, 0.95, 0);
			// Legs
			const legFL = this.box(0.2, 0.8, 0.2, whiteHorseMat, -0.22, 0.4, 0.6);
			const legFR = this.box(0.2, 0.8, 0.2, whiteHorseMat, 0.22, 0.4, 0.6);
			const legBL = this.box(0.2, 0.8, 0.2, whiteHorseMat, -0.22, 0.4, -0.6);
			const legBR = this.box(0.2, 0.8, 0.2, whiteHorseMat, 0.22, 0.4, -0.6);
			// Neck & Head
			const neck = this.box(0.4, 0.9, 0.4, whiteHorseMat, 0, 1.6, 0.7);
			neck.rotation.x = -Math.PI / 6;

			horseGroup.add(horseBody, legFL, legFR, legBL, legBR, neck);
			chariot.add(horseGroup);
		}

		return chariot;
	}

	private buildStops(): void {
		const signMat = lit({ color: 0x4a2e18, roughness: 0.8 });
		this.materials.push(signMat);

		// Mall Stop Sign
		const { canvas, ctx } = labelCanvas(512, 96);
		ctx.fillStyle = '#1b263b';
		ctx.fillRect(0, 0, 512, 96);
		ctx.fillStyle = '#e0a96d';
		fitText(ctx, 'COLOSSEUM EXPRESS CHARIOT', { x: 12, y: 12, w: 488, h: 72 }, { size: 32, maxLines: 1 });

		const tex = labelTexture(canvas);
		this.textures.push(tex);

		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);

		const geo = new THREE.PlaneGeometry(8, 1.5);
		this.geometries.push(geo);

		const sign = backToBackLabel(geo, mat);
		sign.position.set(this.stopMall.x, 3.2, this.stopMall.z - 2.5);
		this.group.add(sign);
	}

	private registerColliders(world: CollisionWorld): void {
		world.boxes.push({
			minX: this.stopMall.x - 2,
			maxX: this.stopMall.x + 2,
			minZ: this.stopMall.z - 2,
			maxZ: this.stopMall.z + 2,
			minY: 0,
			maxY: 2.5,
			label: 'chariot_mall_stop',
			outdoor: true,
		});
	}
}
