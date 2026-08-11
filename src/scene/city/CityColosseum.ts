import * as THREE from 'three';
import type { CollisionWorld } from '#/physics/Collision';
import { lit } from '#/render/material';
import { COLOSSEUM_PLAN } from '#/scene/city/cityPlan';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { clamp, half, lerp, span } from '#/util/math';

export type GateState = 'closed' | 'opening' | 'open' | 'closing';

/**
 * CityColosseum — Monumental Solid Stone Ancient Roman Colosseum.
 * Constructed with heavy 3D masonry: solid stepped Cavea seating bowl,
 * 4-story outer arcade facade with Roman columns and semi-circular arch vaults,
 * solid floor decks, subterranean Hypogeum pit, and Imperial Pulvinar Box.
 */
export class CityColosseum {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];

	// Subterranean Cage Gates
	private northGateMesh: THREE.Mesh | null = null;
	private southGateMesh: THREE.Mesh | null = null;
	private northGateY = 0;
	private southGateY = 0;
	private gateState: GateState = 'closed';
	private gateProgress = 0;

	// Torch flame materials
	private flameMaterials: THREE.MeshBasicMaterial[] = [];

	constructor(world?: CollisionWorld) {
		this.group.name = 'city_colosseum';

		this.buildSubterraneanHypogeum();
		this.buildSolidSeatingBowl();
		this.buildFacadeArcades();
		this.buildImperialPulvinar();
		this.buildSubterraneanGates();
		this.buildTorchesAndBanners();
		this.buildSign();

		if (world) {
			this.registerColliders(world);
		}
	}

	update(dt: number, time: number): void {
		// Torch braziers pulsing illumination
		const pulse = 0.82 + 0.18 * Math.sin(time * 5.5);
		for (const flameMat of this.flameMaterials) {
			flameMat.color.setRGB(1.0 * pulse, 0.52 * pulse, 0.08 * pulse);
		}

		// Gate animation
		if (this.gateState === 'opening') {
			this.gateProgress = clamp(this.gateProgress + dt * 0.8, 0, 1);
			if (this.gateProgress >= 1) this.gateState = 'open';
		} else if (this.gateState === 'closing') {
			this.gateProgress = clamp(this.gateProgress - dt * 0.8, 0, 1);
			if (this.gateProgress <= 0) this.gateState = 'closed';
		}

		const openOffset = lerp(0, 3.8, this.gateProgress);
		if (this.northGateMesh) this.northGateMesh.position.y = this.northGateY + openOffset;
		if (this.southGateMesh) this.southGateMesh.position.y = this.southGateY + openOffset;
	}

	setGates(state: GateState): void {
		this.gateState = state;
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent = this.group): THREE.Mesh {
		const m = new THREE.Mesh(geo, mat);
		m.castShadow = true;
		m.receiveShadow = true;
		parent.add(m);
		this.geometries.push(geo);
		return m;
	}

	private buildSubterraneanHypogeum(): void {
		const { x: cx, z: cz, arenaRadiusX, arenaRadiusZ, hypogeumDepth } = COLOSSEUM_PLAN;

		const stoneMat = lit({ color: 0x4a3e32, roughness: 0.9 });
		const woodMat = lit({ color: 0x3d2b1c, roughness: 0.85 });
		const ironMat = lit({ color: 0x1e1e1e, roughness: 0.5, metalness: 0.8 });
		this.materials.push(stoneMat, woodMat, ironMat);

		// Subterranean Floor Slab
		const floorGeo = new THREE.BoxGeometry(arenaRadiusX * 1.8, 0.5, arenaRadiusZ * 1.8);
		const floor = this.addMesh(floorGeo, stoneMat);
		floor.position.set(cx, -hypogeumDepth, cz);

		// Subterranean Corridor Walls
		for (let i = -2; i <= 2; i += 2) {
			const offsetZ = i * 5;
			const wallGeo = new THREE.BoxGeometry(arenaRadiusX * 1.6, hypogeumDepth, 1.2);
			const wall = this.addMesh(wallGeo, stoneMat);
			wall.position.set(cx, -half(hypogeumDepth), cz + offsetZ);

			// Iron Cage Grids along subterranean corridors
			for (let dx = -12; dx <= 12; dx += 8) {
				const cageGeo = new THREE.BoxGeometry(0.15, hypogeumDepth, 3.2);
				const cage = this.addMesh(cageGeo, ironMat);
				cage.position.set(cx + dx, -half(hypogeumDepth), cz + offsetZ + 2.4);
			}
		}

		// Central Wooden Arena Platform over Hypogeum
		const sandMat = lit({ color: 0xd4b880, roughness: 0.95 });
		this.materials.push(sandMat);

		const arenaFloorGeo = new THREE.CylinderGeometry(arenaRadiusX, arenaRadiusX, 0.4, 36);
		const arenaFloor = this.addMesh(arenaFloorGeo, sandMat);
		arenaFloor.scale.set(1, 1, arenaRadiusZ / arenaRadiusX);
		arenaFloor.position.set(cx, 0.1, cz);

		// Timber Trapdoor Cover
		const timberGeo = new THREE.BoxGeometry(9.0, 0.2, 17.0);
		const timber = this.addMesh(timberGeo, woodMat);
		timber.position.set(cx, 0.12, cz);
	}

	private buildSolidSeatingBowl(): void {
		const { x: cx, z: cz, arenaRadiusX, arenaRadiusZ, radiusX, radiusZ } = COLOSSEUM_PLAN;

		const marbleMat = lit({ color: 0xe8dbca, roughness: 0.5 });
		const stoneMat = lit({ color: 0xad9c86, roughness: 0.8 });
		const darkStoneMat = lit({ color: 0x786956, roughness: 0.85 });
		this.materials.push(marbleMat, stoneMat, darkStoneMat);

		// Solid Arena Podium Wall (2.8m high masonry wall around sand floor)
		const podiumRadiusX = arenaRadiusX + 0.6;
		const podiumRadiusZ = arenaRadiusZ + 0.6;
		const podiumGeo = new THREE.CylinderGeometry(podiumRadiusX, podiumRadiusX, 2.8, 36, 1, true);
		const podium = this.addMesh(podiumGeo, stoneMat);
		podium.scale.set(1, 1, podiumRadiusZ / podiumRadiusX);
		podium.position.set(cx, 1.4, cz);

		// 3 Solid Stepped Cavea Seating Rings (Ima, Media, Summa Cavea)
		// Ima Cavea (Patrician Marble Tier)
		const imaInnerX = arenaRadiusX + 0.8;
		const imaOuterX = arenaRadiusX + 5.0;
		const imaGeo = new THREE.CylinderGeometry(imaOuterX, imaInnerX, 3.2, 36, 1, false);
		const ima = this.addMesh(imaGeo, marbleMat);
		ima.scale.set(1, 1, (arenaRadiusZ + 5.0) / imaOuterX);
		ima.position.set(cx, 3.0, cz);

		// Media Cavea (Middle Citizen Tier)
		const mediaInnerX = imaOuterX + 0.2;
		const mediaOuterX = imaOuterX + 5.5;
		const mediaGeo = new THREE.CylinderGeometry(mediaOuterX, mediaInnerX, 5.0, 36, 1, false);
		const media = this.addMesh(mediaGeo, stoneMat);
		media.scale.set(1, 1, (arenaRadiusZ + 10.5) / mediaOuterX);
		media.position.set(cx, 6.5, cz);

		// Summa Cavea (Upper Plebeian Tier)
		const summaInnerX = mediaOuterX + 0.2;
		const summaOuterX = radiusX - 2.5;
		const summaGeo = new THREE.CylinderGeometry(summaOuterX, summaInnerX, 6.5, 36, 1, false);
		const summa = this.addMesh(summaGeo, darkStoneMat);
		summa.scale.set(1, 1, (radiusZ - 2.5) / summaOuterX);
		summa.position.set(cx, 11.5, cz);

		// Colonnade Portico Ring on Top Seating Deck
		const porticoGeo = new THREE.CylinderGeometry(radiusX - 2.0, radiusX - 2.8, 0.6, 36, 1, false);
		const portico = this.addMesh(porticoGeo, marbleMat);
		portico.scale.set(1, 1, (radiusZ - 2.0) / (radiusX - 2.0));
		portico.position.set(cx, 15.0, cz);

		// Radial Stairways (Vomitoria Exit Paths cutting through seating bowl)
		const stairways = 8;
		for (let i = 0; i < stairways; i++) {
			const angle = (i / stairways) * Math.PI * 2;
			const sx = cx + Math.cos(angle) * half(arenaRadiusX + radiusX);
			const sz = cz + Math.sin(angle) * half(arenaRadiusZ + radiusZ);

			const stairGeo = new THREE.BoxGeometry(2.6, 12.0, span(arenaRadiusX, radiusX));
			const stair = this.addMesh(stairGeo, darkStoneMat);
			stair.position.set(sx, 7.5, sz);
			stair.rotation.y = angle + Math.PI / 2;
		}
	}

	private buildFacadeArcades(): void {
		const { x: cx, z: cz, radiusX, radiusZ, wallHeight, levels } = COLOSSEUM_PLAN;

		const travertineMat = lit({ color: 0xd6caa8, roughness: 0.8 });
		const darkTravertine = lit({ color: 0x8a7b66, roughness: 0.85 });
		const corniceMat = lit({ color: 0xe0d4c0, roughness: 0.7 });
		const statueMat = lit({ color: 0xede9e1, roughness: 0.3 });
		this.materials.push(travertineMat, darkTravertine, corniceMat, statueMat);

		const tierH = wallHeight / levels;
		const archesPerTier = 32;

		// 4 Solid Outer Wall Arcade Shells
		for (let lvl = 0; lvl < levels; lvl++) {
			const yBase = lvl * tierH;
			const tierInset = lvl * 0.6;
			const rx = radiusX - tierInset;
			const rz = radiusZ - tierInset;

			// Story Solid Outer Ring Wall
			const wallGeo = new THREE.CylinderGeometry(rx, rx - 1.2, tierH, 48, 1, true);
			const wall = this.addMesh(wallGeo, travertineMat);
			wall.scale.set(1, 1, rz / rx);
			wall.position.set(cx, yBase + half(tierH), cz);

			// Story Cornice Belt Ring
			const corniceGeo = new THREE.CylinderGeometry(rx + 0.4, rx + 0.4, 0.6, 48, 1, false);
			const cornice = this.addMesh(corniceGeo, corniceMat);
			cornice.scale.set(1, 1, (rz + 0.4) / (rx + 0.4));
			cornice.position.set(cx, yBase + tierH, cz);

			// Exterior Classical Columns & Arch Vaults around perimeter
			for (let i = 0; i < archesPerTier; i++) {
				const angle = (i / archesPerTier) * Math.PI * 2;
				const px = cx + Math.cos(angle) * (rx + 0.2);
				const pz = cz + Math.sin(angle) * (rz + 0.2);
				const rotY = angle + Math.PI / 2;

				if (lvl < 3) {
					// Round Roman Columns against piers
					const colGeo = new THREE.CylinderGeometry(0.55, 0.6, tierH * 0.8, 12);
					const column = this.addMesh(colGeo, corniceMat);
					column.position.set(px, yBase + half(tierH * 0.8), pz);

					// Curved Arch Header Vault
					const archVaultGeo = new THREE.CylinderGeometry(1.6, 1.6, 1.4, 12, 1, false, 0, Math.PI);
					const archVault = this.addMesh(archVaultGeo, darkTravertine);
					archVault.position.set(px, yBase + tierH * 0.72, pz);
					archVault.rotation.z = Math.PI / 2;
					archVault.rotation.y = rotY;

					// Story 1: Carved Marble Statues inside every arch bay
					if (lvl === 1 && i % 2 === 0) {
						const statueGeo = new THREE.CylinderGeometry(0.35, 0.45, 2.4, 8);
						const statue = this.addMesh(statueGeo, statueMat);
						statue.position.set(px, yBase + 1.5, pz);
					}
				} else {
					// Story 4: Attic Wall Pilasters & Rectangular Windows
					const pilasterGeo = new THREE.BoxGeometry(0.8, tierH, 0.4);
					const pilaster = this.addMesh(pilasterGeo, corniceMat);
					pilaster.position.set(px, yBase + half(tierH), pz);
					pilaster.rotation.y = rotY;

					if (i % 2 === 0) {
						const winGeo = new THREE.BoxGeometry(1.4, 1.8, 0.5);
						const win = this.addMesh(winGeo, darkTravertine);
						win.position.set(px, yBase + half(tierH), pz);
						win.rotation.y = rotY;
					}
				}
			}
		}

		// Velarium Awning Masts along Top Attic Rim
		const woodMastMat = lit({ color: 0x543a24, roughness: 0.85 });
		this.materials.push(woodMastMat);

		const mastCount = 32;
		for (let i = 0; i < mastCount; i++) {
			const angle = (i / mastCount) * Math.PI * 2;
			const mx = cx + Math.cos(angle) * (radiusX - 1.8);
			const mz = cz + Math.sin(angle) * (radiusZ - 1.8);

			const mastGeo = new THREE.CylinderGeometry(0.18, 0.22, 6.5, 8);
			const mast = this.addMesh(mastGeo, woodMastMat);
			mast.position.set(mx, wallHeight + 3.25, mz);
		}
	}

	private buildImperialPulvinar(): void {
		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		const goldMat = lit({ color: 0xd4af37, roughness: 0.25, metalness: 0.85 });
		const imperialRedMat = lit({ color: 0x7a0000, roughness: 0.5 });
		const marbleMat = lit({ color: 0xfaf8f5, roughness: 0.3 });
		this.materials.push(goldMat, imperialRedMat, marbleMat);

		// Imperial Pulvinar Pavilion on North Podium Wall
		const boxZ = cz - arenaRadiusZ + 0.8;
		const boxY = 3.8;

		// Balcony Platform Floor
		const floorGeo = new THREE.BoxGeometry(11.0, 0.7, 5.5);
		const floor = this.addMesh(floorGeo, marbleMat);
		floor.position.set(cx, boxY, boxZ);

		// Ornate Double Corinthian Columns
		for (const side of [-4.5, -1.5, 1.5, 4.5]) {
			const colGeo = new THREE.CylinderGeometry(0.32, 0.38, 3.8, 12);
			const col = this.addMesh(colGeo, marbleMat);
			col.position.set(cx + side, boxY + 2.2, boxZ + 2.0);

			const capGeo = new THREE.BoxGeometry(0.7, 0.45, 0.7);
			const cap = this.addMesh(capGeo, goldMat);
			cap.position.set(cx + side, boxY + 4.0, boxZ + 2.0);
		}

		// Imperial Canopy Roof & Red Backdrop
		const roofGeo = new THREE.BoxGeometry(11.5, 0.7, 5.8);
		const roof = this.addMesh(roofGeo, imperialRedMat);
		roof.position.set(cx, boxY + 4.4, boxZ);

		const backGeo = new THREE.BoxGeometry(11.2, 1.8, 0.15);
		const back = this.addMesh(backGeo, imperialRedMat);
		back.position.set(cx, boxY + 3.3, boxZ - 2.4);

		// Emperor's Golden Throne
		const seatGeo = new THREE.BoxGeometry(1.6, 0.65, 1.4);
		const seat = this.addMesh(seatGeo, goldMat);
		seat.position.set(cx, boxY + 0.65, boxZ - 0.6);

		const backrestGeo = new THREE.BoxGeometry(1.6, 1.8, 0.28);
		const backrest = this.addMesh(backrestGeo, goldMat);
		backrest.position.set(cx, boxY + 1.5, boxZ - 1.2);

		const cushionGeo = new THREE.BoxGeometry(1.4, 0.22, 1.2);
		const cushion = this.addMesh(cushionGeo, imperialRedMat);
		cushion.position.set(cx, boxY + 0.75, boxZ - 0.6);

		// Golden Eagle Aquila on peak
		const eagleGeo = new THREE.BoxGeometry(1.5, 1.0, 0.35);
		const eagle = this.addMesh(eagleGeo, goldMat);
		eagle.position.set(cx, boxY + 5.2, boxZ + 2.2);
	}

	private buildSubterraneanGates(): void {
		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		const ironMat = lit({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.9 });
		const archMat = lit({ color: 0x7c6e5e, roughness: 0.8 });
		this.materials.push(ironMat, archMat);

		// North Gate (Porta Libitinaria)
		const northZ = cz - arenaRadiusZ;
		const northArchGeo = new THREE.BoxGeometry(6.5, 5.5, 1.8);
		const northArch = this.addMesh(northArchGeo, archMat);
		northArch.position.set(cx, 2.75, northZ);

		const northGateGeo = new THREE.BoxGeometry(5.2, 4.2, 0.2);
		const northGate = this.addMesh(northGateGeo, ironMat);
		northGate.position.set(cx, 2.1, northZ);
		this.northGateMesh = northGate;
		this.northGateY = 2.1;

		// South Gate (Porta Triumphalis)
		const southZ = cz + arenaRadiusZ;
		const southArchGeo = new THREE.BoxGeometry(6.5, 5.5, 1.8);
		const southArch = this.addMesh(southArchGeo, archMat);
		southArch.position.set(cx, 2.75, southZ);

		const southGateGeo = new THREE.BoxGeometry(5.2, 4.2, 0.2);
		const southGate = this.addMesh(southGateGeo, ironMat);
		southGate.position.set(cx, 2.1, southZ);
		this.southGateMesh = southGate;
		this.southGateY = 2.1;
	}

	private buildTorchesAndBanners(): void {
		const { x: cx, z: cz, arenaRadiusX, arenaRadiusZ } = COLOSSEUM_PLAN;

		const flameBasicMat = new THREE.MeshBasicMaterial({ color: 0xff7700, toneMapped: false });
		this.materials.push(flameBasicMat);
		this.flameMaterials.push(flameBasicMat);

		// Flame Torches on Arena Wall
		const torchCount = 14;
		for (let i = 0; i < torchCount; i++) {
			const angle = (i / torchCount) * Math.PI * 2;
			const tx = cx + Math.cos(angle) * (arenaRadiusX + 0.5);
			const tz = cz + Math.sin(angle) * (arenaRadiusZ + 0.5);

			const flameGeo = new THREE.ConeGeometry(0.38, 1.1, 6);
			const flameMesh = this.addMesh(flameGeo, flameBasicMat);
			flameMesh.position.set(tx, 3.7, tz);
		}
	}

	private buildSign(): void {
		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		const { canvas, ctx } = labelCanvas(896, 144);
		ctx.fillStyle = '#220b05';
		ctx.fillRect(0, 0, 896, 144);
		ctx.strokeStyle = '#d4af37';
		ctx.lineWidth = 10;
		ctx.strokeRect(10, 10, 876, 124);

		ctx.fillStyle = '#f7e7c4';
		fitText(ctx, COLOSSEUM_PLAN.label, { x: 28, y: 20, w: 840, h: 104 }, { size: 54, maxLines: 1 });

		const tex = labelTexture(canvas);
		this.textures.push(tex);

		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);

		const geo = new THREE.PlaneGeometry(18, 3.0);
		this.geometries.push(geo);

		const sign = backToBackLabel(geo, mat);
		sign.position.set(cx, 7.5, cz - arenaRadiusZ - 5.5);
		this.group.add(sign);
	}

	private registerColliders(world: CollisionWorld): void {
		const { x: cx, z: cz, arenaRadiusX, arenaRadiusZ, radiusX, radiusZ, wallHeight } = COLOSSEUM_PLAN;

		// Main Arena Sand Floor Surface
		world.boxes.push({
			minX: cx - arenaRadiusX,
			maxX: cx + arenaRadiusX,
			minZ: cz - arenaRadiusZ,
			maxZ: cz + arenaRadiusZ,
			minY: -0.1,
			maxY: 0.1,
			label: 'colosseum_arena_floor',
			outdoor: true,
		});

		// Outer Ring Facade Boundary Colliders
		world.boxes.push({
			minX: cx - radiusX - 2,
			maxX: cx + radiusX + 2,
			minZ: cz - radiusZ - 2,
			maxZ: cz - radiusZ,
			minY: 0,
			maxY: wallHeight,
			label: 'colosseum_north_facade',
			outdoor: true,
		});

		world.boxes.push({
			minX: cx - radiusX - 2,
			maxX: cx + radiusX + 2,
			minZ: cz + radiusZ,
			maxZ: cz + radiusZ + 2,
			minY: 0,
			maxY: wallHeight,
			label: 'colosseum_south_facade',
			outdoor: true,
		});
	}
}
