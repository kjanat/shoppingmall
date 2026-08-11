import * as THREE from 'three';
import type { CollisionWorld } from '#/physics/Collision';
import { lit } from '#/render/material';
import { COLOSSEUM_PLAN } from '#/scene/city/cityPlan';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { clamp, half, lerp, midpoint } from '#/util/math';

export type GateState = 'closed' | 'opening' | 'open' | 'closing';

/**
 * CityColosseum — a monumental Roman amphitheatre read as one closed elliptical
 * ring of masonry. The arcades are holes in a solid wall, not columns holding up
 * air: every tier is a dark recessed wall behind light piers and round arches, a
 * solid attic caps the ring with a flat cornice, and the seating descends inward
 * as a stepped cavea to the sand arena. Two axial gates (north Porta Libitinaria,
 * south Porta Triumphalis) are the only breaks in the shell.
 */
export class CityColosseum {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];

	/** Ellipse squash: the z-radius is this much larger than the x-radius. */
	private readonly aspect = COLOSSEUM_PLAN.radiusZ / COLOSSEUM_PLAN.radiusX;

	// Subterranean cage gates that rise into the arena.
	private northGateMesh: THREE.Mesh | null = null;
	private southGateMesh: THREE.Mesh | null = null;
	private northGateY = 0;
	private southGateY = 0;
	private gateState: GateState = 'closed';
	private gateProgress = 0;

	private flameMaterials: THREE.MeshBasicMaterial[] = [];

	constructor(world?: CollisionWorld) {
		this.group.name = 'city_colosseum';

		this.buildSubterraneanHypogeum();
		this.buildArenaAndPodium();
		this.buildCavea();
		this.buildFacade();
		this.buildImperialPulvinar();
		this.buildSubterraneanGates();
		this.buildTorches();
		this.buildSign();

		if (world) this.registerColliders(world);
	}

	update(dt: number, time: number): void {
		const pulse = 0.82 + 0.18 * Math.sin(time * 5.5);
		for (const flameMat of this.flameMaterials) {
			flameMat.color.setRGB(1.0 * pulse, 0.52 * pulse, 0.08 * pulse);
		}

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

	// ── geometry helpers ────────────────────────────────────────────────────

	private track<T extends THREE.BufferGeometry>(geo: T): T {
		this.geometries.push(geo);
		return geo;
	}

	private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.group): THREE.Mesh {
		const m = new THREE.Mesh(this.track(geo), mat);
		m.castShadow = true;
		m.receiveShadow = true;
		parent.add(m);
		return m;
	}

	/** A point on the ground ellipse at angle `a` and x-radius `rx`. */
	private onEllipse(a: number, rx: number): [number, number] {
		return [COLOSSEUM_PLAN.x + Math.cos(a) * rx, COLOSSEUM_PLAN.z + Math.sin(a) * rx * this.aspect];
	}

	/** A closed or open elliptical ring wall, squashed from a cylinder of x-radius `rx`. */
	private ringWall(
		rx: number,
		yCenter: number,
		height: number,
		mat: THREE.Material,
		opts: { openEnded?: boolean; radialTop?: number } = {},
	): THREE.Mesh {
		const geo = new THREE.CylinderGeometry(opts.radialTop ?? rx, rx, height, 56, 1, opts.openEnded ?? false);
		const ring = this.addMesh(geo, mat);
		ring.scale.set(1, 1, this.aspect);
		ring.position.set(COLOSSEUM_PLAN.x, yCenter, COLOSSEUM_PLAN.z);
		return ring;
	}

	/** A box whose long axis follows the ellipse tangent at angle `a`. */
	private tangentBox(
		a: number,
		rx: number,
		width: number,
		height: number,
		depth: number,
		yCenter: number,
		mat: THREE.Material,
	): void {
		const [x, z] = this.onEllipse(a, rx);
		const geo = new THREE.BoxGeometry(width, height, depth);
		const box = this.addMesh(geo, mat);
		box.position.set(x, yCenter, z);
		box.rotation.y = -a;
	}

	/** Half the angular reach of a gate opening, wide enough for the axial tunnel. */
	private readonly gateCos = 0.14;

	/** True where the shell opens for one of the two axial gates (north −z, south +z). */
	private nearGate(a: number): boolean {
		return Math.abs(Math.cos(a)) < this.gateCos;
	}

	// ── the underground ─────────────────────────────────────────────────────

	private buildSubterraneanHypogeum(): void {
		const { x: cx, z: cz, arenaRadiusX, arenaRadiusZ, hypogeumDepth } = COLOSSEUM_PLAN;

		const stoneMat = lit({ color: 0x4a3e32, roughness: 0.9 });
		const woodMat = lit({ color: 0x3d2b1c, roughness: 0.85 });
		const ironMat = lit({ color: 0x1e1e1e, roughness: 0.5, metalness: 0.8 });
		this.materials.push(stoneMat, woodMat, ironMat);

		const floorGeo = new THREE.BoxGeometry(arenaRadiusX * 1.8, 0.5, arenaRadiusZ * 1.8);
		const floor = this.addMesh(floorGeo, stoneMat);
		floor.position.set(cx, -hypogeumDepth, cz);

		for (let i = -2; i <= 2; i += 2) {
			const offsetZ = i * 5;
			const wallGeo = new THREE.BoxGeometry(arenaRadiusX * 1.6, hypogeumDepth, 1.2);
			const wall = this.addMesh(wallGeo, stoneMat);
			wall.position.set(cx, -half(hypogeumDepth), cz + offsetZ);

			for (let dx = -12; dx <= 12; dx += 8) {
				const cageGeo = new THREE.BoxGeometry(0.15, hypogeumDepth, 3.2);
				const cage = this.addMesh(cageGeo, ironMat);
				cage.position.set(cx + dx, -half(hypogeumDepth), cz + offsetZ + 2.4);
			}
		}
	}

	// ── the sand and the barrier wall around it ──────────────────────────────

	private buildArenaAndPodium(): void {
		const { x: cx, z: cz, arenaRadiusX, archesPerLevel } = COLOSSEUM_PLAN;

		const sandMat = lit({ color: 0xd4b880, roughness: 0.95 });
		const woodMat = lit({ color: 0x3d2b1c, roughness: 0.85 });
		const podiumMat = lit({ color: 0x8f7f68, roughness: 0.85 });
		const podiumCapMat = lit({ color: 0xbfb08c, roughness: 0.8 });
		this.materials.push(sandMat, woodMat, podiumMat, podiumCapMat);

		// Flat sand floor sitting on the trapdoor deck over the hypogeum.
		const arenaFloorGeo = new THREE.CylinderGeometry(arenaRadiusX, arenaRadiusX, 0.4, 48);
		const arenaFloor = this.addMesh(arenaFloorGeo, sandMat);
		arenaFloor.scale.set(1, 1, this.aspect);
		arenaFloor.position.set(cx, 0.1, cz);

		const timberGeo = new THREE.BoxGeometry(9.0, 0.2, 17.0);
		const timber = this.addMesh(timberGeo, woodMat);
		timber.position.set(cx, 0.12, cz);

		// The podium: a faceted barrier wall right at the sand, broken only by the
		// two gates. Its cap is a lighter band so the arena reads as walled, not open.
		const podiumRx = arenaRadiusX + 1.0;
		const podiumHeight = 3.0;
		const chord = 2 * podiumRx * Math.sin(Math.PI / archesPerLevel) * 1.3;
		for (let i = 0; i < archesPerLevel; i++) {
			const a = (i / archesPerLevel) * Math.PI * 2;
			if (this.nearGate(a)) continue;
			this.tangentBox(a, podiumRx, chord, podiumHeight, 0.8, half(podiumHeight), podiumMat);
			this.tangentBox(a, podiumRx, chord, 0.4, 1.0, podiumHeight, podiumCapMat);
		}
	}

	// ── the seating bowl ─────────────────────────────────────────────────────

	/** The top of the seating; it climbs almost the whole inner wall to the crown. */
	private readonly caveaTopY = COLOSSEUM_PLAN.wallHeight - 2;

	/** A flat elliptical annulus (a seating tread) lying in the xz-plane at height y. */
	private tread(innerRx: number, outerRx: number, y: number, mat: THREE.Material): void {
		const geo = new THREE.RingGeometry(innerRx, outerRx, 56, 1);
		const ring = this.addMesh(geo, mat);
		ring.rotation.x = -half(Math.PI);
		ring.scale.set(1, this.aspect, 1);
		ring.position.set(COLOSSEUM_PLAN.x, y, COLOSSEUM_PLAN.z);
	}

	private buildCavea(): void {
		const { radiusX, arenaRadiusX } = COLOSSEUM_PLAN;

		// The seating faces inward, so every surface is DoubleSide: a solid ring would
		// only show the renderer its outer face and read as a blank wall from the sand.
		const lightRow = lit({ color: 0xe7dcc0, roughness: 0.6, side: THREE.DoubleSide });
		const darkRow = lit({ color: 0x877663, roughness: 0.85, side: THREE.DoubleSide });
		const treadMat = lit({ color: 0xcabfa2, roughness: 0.8, side: THREE.DoubleSide });
		const aisleMat = lit({ color: 0x554a38, roughness: 0.9, side: THREE.DoubleSide });
		const crownMat = lit({ color: 0xe4d9c2, roughness: 0.7, side: THREE.DoubleSide });
		this.materials.push(lightRow, darkRow, treadMat, aisleMat, crownMat);

		// The whole inner face is seating: thin risers and treads climbing from the
		// podium to the crown, each an open shell so the rows behind the nearest one
		// stay visible. From the sand the wall reads as a flight of alternating steps,
		// never a smooth cone, because there is no plain wall left above the top row.
		const rows = 22;
		const innerRx = arenaRadiusX + 1.2;
		const outerRx = radiusX - 3.0;
		const baseY = 2.6;
		const rowRx = (t: number): number => lerp(innerRx, outerRx, t);
		const rowY = (t: number): number => lerp(baseY, this.caveaTopY, t);
		for (let k = 0; k < rows; k++) {
			const t0 = k / rows;
			const t1 = (k + 1) / rows;
			this.ringWall(rowRx(t0), midpoint(rowY(t0), rowY(t1)), rowY(t1) - rowY(t0), k % 2 === 0 ? lightRow : darkRow, {
				openEnded: true,
			});
			this.tread(rowRx(t0), rowRx(t1), rowY(t1), treadMat);
		}
		// The crown: one light lip ring capping the top row.
		this.ringWall(outerRx + 0.2, this.caveaTopY + 0.4, 0.8, crownMat, { openEnded: true });

		// Radial vomitoria: a flight of dark treads down each aisle, cutting the rings
		// so the rows do not read as one unbroken band.
		const aisles = 8;
		for (let i = 0; i < aisles; i++) {
			const a = (i / aisles) * Math.PI * 2 + Math.PI / aisles;
			if (this.nearGate(a)) continue;
			for (let k = 0; k < rows; k++) {
				const t = k / rows;
				const [x, z] = this.onEllipse(a, rowRx(t) - 0.1);
				const stepGeo = new THREE.BoxGeometry(2.6, 0.4, 1.5);
				const step = this.addMesh(stepGeo, aisleMat);
				step.position.set(x, rowY(t) + 0.12, z);
				step.rotation.y = -a;
			}
		}
	}

	// ── the outer wall: arcades that read as holes in solid mass ──────────────

	private buildFacade(): void {
		const { radiusX, wallHeight, levels, archesPerLevel } = COLOSSEUM_PLAN;

		const travertineMat = lit({ color: 0xd6caa8, roughness: 0.8 });
		const pierMat = lit({ color: 0xc9bc9a, roughness: 0.8 });
		const shadowMat = lit({ color: 0x5b503f, roughness: 0.95 });
		const corniceMat = lit({ color: 0xe4d9c2, roughness: 0.7 });
		this.materials.push(travertineMat, pierMat, shadowMat, corniceMat);

		const tierH = wallHeight / levels;
		const pierRx = radiusX;
		const darkRx = radiusX - 2.6;
		const chord = 2 * pierRx * Math.sin(Math.PI / archesPerLevel);
		const pierWidth = chord * 0.44;
		const openingHalf = chord * 0.28;

		// Plinth: one solid band at the foot so the ground arcade sits on stone.
		this.ringWall(radiusX + 0.3, 0.6, 1.2, corniceMat);

		for (let lvl = 0; lvl < levels - 1; lvl++) {
			const yBase = lvl * tierH;

			// The recessed wall the arches open into. Ground tier keeps the two gates
			// open with per-bay dark panels; the upper tiers are a closed dark ring.
			if (lvl === 0) {
				const panelChord = chord * 1.25;
				for (let i = 0; i < archesPerLevel; i++) {
					const a = (i / archesPerLevel) * Math.PI * 2;
					if (this.nearGate(a)) continue;
					this.tangentBox(a, darkRx, panelChord, tierH, 0.6, yBase + half(tierH), shadowMat);
				}
			} else {
				this.ringWall(darkRx, yBase + half(tierH), tierH, shadowMat);
			}

			// Piers and their round arches, one bay at a time, gates left open.
			for (let i = 0; i < archesPerLevel; i++) {
				const a = (i / archesPerLevel) * Math.PI * 2;
				if (this.nearGate(a)) continue;
				this.tangentBox(a, pierRx, pierWidth, tierH, 2.4, yBase + half(tierH), pierMat);
				this.buildArch(a, pierRx, openingHalf, yBase + tierH * 0.66, pierMat);
			}

			// Entablature: a continuous cornice band capping the tier.
			this.ringWall(radiusX + 0.5, yBase + tierH, 0.7, corniceMat, { openEnded: false });
		}

		// The attic: a solid closed ring, tall and unbroken, with shallow pilasters
		// and recessed square windows. This is the closed crown, and it carries the
		// flat rim instead of a fence of masts.
		const atticBase = (levels - 1) * tierH;
		this.ringWall(radiusX - 0.4, atticBase + half(tierH), tierH, travertineMat);
		for (let i = 0; i < archesPerLevel; i++) {
			const a = (i / archesPerLevel) * Math.PI * 2;
			this.tangentBox(a, radiusX, 0.8, tierH, 0.4, atticBase + half(tierH), corniceMat);
			if (i % 2 === 0) {
				this.tangentBox(a, radiusX - 0.5, 1.4, 1.8, 0.5, atticBase + half(tierH), shadowMat);
			}
		}
		// The crowning cornice: one clean horizontal rim around the top.
		this.ringWall(radiusX + 0.6, wallHeight, 0.9, corniceMat);

		// The two gate portals: a tall arch marks each axial entrance, sitting flush
		// in the wall face, with the opening itself left clear for the tunnel.
		for (const a of [half(Math.PI), half(Math.PI) * 3]) {
			this.buildArch(a, pierRx - 0.4, openingHalf * 1.7, tierH * 2 - 1.2, corniceMat);
		}
	}

	/** A semicircular arch frame standing over one bay opening, facing outward. */
	private buildArch(a: number, rx: number, openingHalf: number, springY: number, mat: THREE.Material): void {
		const geo = new THREE.RingGeometry(openingHalf, openingHalf + 0.7, 14, 1, 0, Math.PI);
		const arch = new THREE.Mesh(this.track(geo), mat);
		arch.castShadow = true;
		arch.receiveShadow = true;
		const [x, z] = this.onEllipse(a, rx + 0.1);
		arch.position.set(x, springY, z);
		arch.rotation.y = -a + half(Math.PI);
		this.group.add(arch);
	}

	// ── the imperial box on the north podium ──────────────────────────────────

	private buildImperialPulvinar(): void {
		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		const goldMat = lit({ color: 0xd4af37, roughness: 0.25, metalness: 0.85 });
		const imperialRedMat = lit({ color: 0x7a0000, roughness: 0.5 });
		const marbleMat = lit({ color: 0xfaf8f5, roughness: 0.3 });
		this.materials.push(goldMat, imperialRedMat, marbleMat);

		const boxZ = cz - arenaRadiusZ + 0.6;
		const boxY = 3.4;

		const floorGeo = new THREE.BoxGeometry(11.0, 0.7, 5.0);
		const floor = this.addMesh(floorGeo, marbleMat);
		floor.position.set(cx, boxY, boxZ);

		for (const side of [-4.5, -1.5, 1.5, 4.5]) {
			const colGeo = new THREE.CylinderGeometry(0.32, 0.38, 3.6, 12);
			const col = this.addMesh(colGeo, marbleMat);
			col.position.set(cx + side, boxY + 2.1, boxZ + 1.8);

			const capGeo = new THREE.BoxGeometry(0.7, 0.45, 0.7);
			const cap = this.addMesh(capGeo, goldMat);
			cap.position.set(cx + side, boxY + 3.9, boxZ + 1.8);
		}

		const roofGeo = new THREE.BoxGeometry(11.5, 0.7, 5.4);
		const roof = this.addMesh(roofGeo, imperialRedMat);
		roof.position.set(cx, boxY + 4.2, boxZ);

		const backGeo = new THREE.BoxGeometry(11.2, 1.8, 0.15);
		const back = this.addMesh(backGeo, imperialRedMat);
		back.position.set(cx, boxY + 3.1, boxZ - 2.2);

		const seatGeo = new THREE.BoxGeometry(1.6, 0.65, 1.4);
		const seat = this.addMesh(seatGeo, goldMat);
		seat.position.set(cx, boxY + 0.65, boxZ - 0.4);

		const backrestGeo = new THREE.BoxGeometry(1.6, 1.8, 0.28);
		const backrest = this.addMesh(backrestGeo, goldMat);
		backrest.position.set(cx, boxY + 1.5, boxZ - 1.0);

		const cushionGeo = new THREE.BoxGeometry(1.4, 0.22, 1.2);
		const cushion = this.addMesh(cushionGeo, imperialRedMat);
		cushion.position.set(cx, boxY + 0.75, boxZ - 0.4);

		const eagleGeo = new THREE.BoxGeometry(1.5, 1.0, 0.35);
		const eagle = this.addMesh(eagleGeo, goldMat);
		eagle.position.set(cx, boxY + 5.0, boxZ + 2.0);
	}

	// ── the arena cage gates ──────────────────────────────────────────────────

	private buildSubterraneanGates(): void {
		const { x: cx, z: cz, arenaRadiusZ } = COLOSSEUM_PLAN;

		const ironMat = lit({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.9 });
		const archMat = lit({ color: 0x6f6252, roughness: 0.85 });
		this.materials.push(ironMat, archMat);

		for (const dir of [-1, 1]) {
			const gz = cz + dir * (arenaRadiusZ + 0.4);

			const archGeo = new THREE.BoxGeometry(6.5, 5.5, 1.6);
			const arch = this.addMesh(archGeo, archMat);
			arch.position.set(cx, 2.75, gz);

			const gateGeo = new THREE.BoxGeometry(5.2, 4.2, 0.2);
			const gate = this.addMesh(gateGeo, ironMat);
			gate.position.set(cx, 2.1, gz);
			if (dir < 0) {
				this.northGateMesh = gate;
				this.northGateY = 2.1;
			} else {
				this.southGateMesh = gate;
				this.southGateY = 2.1;
			}
		}
	}

	// ── braziers on the podium rim ─────────────────────────────────────────────

	private buildTorches(): void {
		const { arenaRadiusX } = COLOSSEUM_PLAN;

		const flameBasicMat = new THREE.MeshBasicMaterial({ color: 0xff7700, toneMapped: false });
		this.materials.push(flameBasicMat);
		this.flameMaterials.push(flameBasicMat);

		const torchCount = 14;
		for (let i = 0; i < torchCount; i++) {
			const a = (i / torchCount) * Math.PI * 2;
			if (this.nearGate(a)) continue;
			const [tx, tz] = this.onEllipse(a, arenaRadiusX + 1.4);
			const flameGeo = new THREE.ConeGeometry(0.38, 1.1, 6);
			const flame = this.addMesh(flameGeo, flameBasicMat);
			flame.position.set(tx, 3.7, tz);
		}
	}

	// ── the sign over the south gate ───────────────────────────────────────────

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

		const geo = this.track(new THREE.PlaneGeometry(18, 3.0));
		const sign = backToBackLabel(geo, mat);
		sign.position.set(cx, COLOSSEUM_PLAN.wallHeight + 2.5, cz + arenaRadiusZ + 6.5);
		this.group.add(sign);
	}

	// ── collision: the shell is closed for pedestrians except at the gates ─────

	private registerColliders(world: CollisionWorld): void {
		const { radiusX, arenaRadiusX, wallHeight } = COLOSSEUM_PLAN;

		// The two axial approach tunnels stay clear; the walkable sand is city ground.
		this.ringColliders(world, radiusX, 0, wallHeight, 'colosseum_facade');
		this.ringColliders(world, arenaRadiusX + 1.0, 0, 3.0, 'colosseum_podium');
	}

	/** A closed ring of axis-aligned wall boxes around the ellipse, open at the two gates. */
	private ringColliders(world: CollisionWorld, rx: number, minY: number, maxY: number, label: string): void {
		const segments = 72;
		const thickness = 1.6;
		const h = half(thickness);
		for (let i = 0; i < segments; i++) {
			const a0 = (i / segments) * Math.PI * 2;
			const a1 = ((i + 1) / segments) * Math.PI * 2;
			if (this.nearGate(midpoint(a0, a1))) continue;
			const [x0, z0] = this.onEllipse(a0, rx);
			const [x1, z1] = this.onEllipse(a1, rx);
			world.boxes.push({
				minX: Math.min(x0, x1) - h,
				maxX: Math.max(x0, x1) + h,
				minZ: Math.min(z0, z1) - h,
				maxZ: Math.max(z0, z1) + h,
				minY,
				maxY,
				label,
				outdoor: true,
			});
		}
	}
}
