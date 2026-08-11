import * as THREE from 'three';
import {
	CON_BOOTH,
	CON_DEALERS,
	CON_DOOR_BAY,
	CON_FLOOR_Y,
	CON_HALL_HEIGHT,
	CON_HOTEL,
	CON_HOTEL_FLOOR_H,
	CON_HOTEL_FLOORS,
	CON_LABEL,
	CON_PLAZA,
	CON_PORTAL,
	CON_STAGE,
	CON_WALL_T,
	conBoothGrid,
	rectCenter,
	rectInterior,
	rectSize,
} from '#/data/conPlan';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { ACCENT_COLORS, PRIDE_STRIPES } from '#/scene/con/FursuitKit';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';
import { at, mulberry32, pickWith } from '#/util/rand';

/**
 * Plaza, halls, booths, stage, hotel — static scene only.
 * Collision comes from conWorld; this draws what the player sees.
 */
export class ConVenue {
	readonly group = new THREE.Group();
	readonly plazaSpot = new THREE.Vector3(midpoint(CON_PLAZA.minX, CON_PLAZA.maxX), 1.5, 0);
	readonly dealersSpot = new THREE.Vector3(
		midpoint(CON_DEALERS.minX, CON_DEALERS.maxX),
		1.5,
		midpoint(CON_DEALERS.minZ, CON_DEALERS.maxZ),
	);
	readonly stageSpot = new THREE.Vector3(midpoint(CON_STAGE.minX, CON_STAGE.maxX), 2, midpoint(CON_STAGE.minZ, CON_STAGE.maxZ));

	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [this.unitBox];
	private readonly textures: THREE.Texture[] = [];
	private readonly pulseMats: THREE.MeshBasicMaterial[] = [];
	private readonly beams: { mesh: THREE.Mesh; base: number }[] = [];
	private readonly dummy = new THREE.Object3D();

	constructor(pool: LightPool) {
		this.group.name = 'con_venue';
		this.buildPlaza();
		this.buildHallMass(CON_DEALERS, 0x2a2438, 0x1a1528, 'DEALERS DEN');
		this.buildHallMass(CON_STAGE, 0x1a1028, 0x120818, 'MAIN STAGE');
		this.buildHallMass(CON_HOTEL, 0x243040, 0x1a2430, 'CON HOTEL');
		this.buildBooths();
		this.buildStage(pool);
		this.buildHotel();
		this.buildEntrance();
		this.buildMarquee();
		this.buildPride();
		this.buildTrucks();
	}

	update(t: number): void {
		const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (140 / 60));
		for (const m of this.pulseMats) m.color.setRGB(0.4 + 0.6 * beat, 0.1 + 0.2 * beat, 0.5 + 0.5 * beat);
		for (const b of this.beams) {
			b.mesh.rotation.z = Math.sin(t * 2 + b.base) * 0.35;
			b.mesh.visible = beat > 0.35;
		}
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	private mat(color: number, rough = 0.9): THREE.Material {
		const m = lit({ color, roughness: rough });
		this.materials.push(m);
		return m;
	}

	private basic(color: number): THREE.MeshBasicMaterial {
		const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
		this.materials.push(m);
		return m;
	}

	private box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
		const mesh = new THREE.Mesh(this.unitBox, material);
		mesh.scale.set(w, h, d);
		mesh.position.set(x, y, z);
		return mesh;
	}

	private buildPlaza(): void {
		const pad = this.mat(0x3a3548);
		const { w, d } = rectSize(CON_PLAZA);
		const c = rectCenter(CON_PLAZA);
		this.group.add(this.box(w, 0.08, d, pad, c.x, CON_FLOOR_Y + 0.04, c.z));
		const stripe = this.basic(0xff4d9a);
		this.pulseMats.push(stripe);
		for (let i = 0; i < 6; i++) {
			this.group.add(this.box(w - 4, 0.04, 0.35, stripe, c.x, CON_FLOOR_Y + 0.1, CON_PLAZA.minZ + 6 + i * 10));
		}
		const rail = this.mat(0x888090);
		for (const side of [-1, 1] as const) {
			const z = side * 5;
			this.group.add(this.box(22, 0.08, 0.12, rail, CON_PLAZA.maxX - 14, 0.9, z));
			for (let i = 0; i < 6; i++) {
				this.group.add(this.box(0.1, 1.0, 0.1, rail, CON_PLAZA.maxX - 4 - i * 3.5, 0.5, z));
			}
		}
	}

	private buildHallMass(rect: typeof CON_DEALERS, wallCol: number, floorCol: number, title: string): void {
		const wall = this.mat(wallCol);
		const floor = this.mat(floorCol);
		const roof = this.mat(0x141018);
		const size = rectSize(rect);
		const c = rectCenter(rect);
		const t = CON_WALL_T;
		const h = CON_HALL_HEIGHT;
		this.group.add(this.box(size.w - t * 2, 0.12, size.d - t * 2, floor, c.x, CON_FLOOR_Y + 0.06, c.z));
		this.group.add(this.box(size.w, h, t, wall, c.x, half(h), rect.minZ + half(t)));
		this.group.add(this.box(size.w, h, t, wall, c.x, half(h), rect.maxZ - half(t)));
		this.group.add(this.box(t, h, size.d - t * 2, wall, rect.minX + half(t), half(h), c.z));
		this.group.add(this.box(t, h, size.d - t * 2, wall, rect.maxX - half(t), half(h), c.z));
		this.group.add(this.box(size.w, 0.6, size.d, roof, c.x, h - 0.3, c.z));
		const sign = this.sign(title, 10, 1.2, 0xff66cc);
		sign.position.set(c.x, h - 2.2, rect.minZ - 0.2);
		this.group.add(sign);
	}

	/** One InstancedMesh for tabletops + one for legs. Grid size follows dealers interior. */
	private buildBooths(): void {
		const grid = conBoothGrid();
		const slots: { x: number; z: number; color: number }[] = [];
		const rand = mulberry32(0xb007);
		for (let row = 0; row < grid.rows; row++) {
			for (let col = 0; col < grid.cols; col++) {
				slots.push({
					x: grid.startX + col * grid.pitchX,
					z: grid.startZ + row * grid.pitchZ,
					color: pickWith(ACCENT_COLORS, rand),
				});
			}
		}
		const n = slots.length;
		const topGeo = this.unitBox;
		const topMat = this.mat(0x2d2a40);
		const tops = new THREE.InstancedMesh(topGeo, topMat, n);
		const legs = new THREE.InstancedMesh(topGeo, this.mat(0x1a1820), n * 4);
		const color = new THREE.Color();
		tops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
		let legI = 0;
		for (let i = 0; i < n; i++) {
			const s = at(slots, i);
			this.dummy.position.set(s.x, CON_FLOOR_Y + 0.78, s.z);
			this.dummy.scale.set(CON_BOOTH.w * 0.9, 0.08, CON_BOOTH.d * 0.75);
			this.dummy.rotation.set(0, 0, 0);
			this.dummy.updateMatrix();
			tops.setMatrixAt(i, this.dummy.matrix);
			color.setHex(s.color);
			tops.setColorAt(i, color);
			for (const sx of [-1, 1] as const) {
				for (const sz of [-1, 1] as const) {
					this.dummy.position.set(s.x + sx * CON_BOOTH.w * 0.38, CON_FLOOR_Y + 0.39, s.z + sz * CON_BOOTH.d * 0.3);
					this.dummy.scale.set(0.08, 0.78, 0.08);
					this.dummy.updateMatrix();
					legs.setMatrixAt(legI++, this.dummy.matrix);
				}
			}
		}
		this.group.add(tops, legs);
	}

	private buildStage(pool: LightPool): void {
		const inner = rectInterior(CON_STAGE);
		const cx = midpoint(inner.minX, inner.maxX);
		const stageZ = inner.minZ + 7;
		const deckY = CON_FLOOR_Y + 1.1;
		this.group.add(this.box(span(inner.minX + 4, inner.maxX - 4), 1.1, 10, this.mat(0x1c1028), cx, CON_FLOOR_Y + 0.55, stageZ));
		this.group.add(this.box(4.5, 1.0, 1.2, this.mat(0x101018), cx, deckY + 0.5, stageZ - 2));
		const led = this.basic(0xaa44ff);
		this.pulseMats.push(led);
		this.group.add(this.box(28, 8, 0.3, led, cx, deckY + 5, inner.minZ + 1.5));
		const beam = this.basic(0x00ffcc);
		this.pulseMats.push(beam);
		for (let i = 0; i < 8; i++) {
			const mesh = this.box(0.08, 12, 0.08, beam, cx + (i - 3.5) * 3.2, deckY + 6, stageZ + 8);
			mesh.rotation.x = 0.4 + i * 0.05;
			this.group.add(mesh);
			this.beams.push({ mesh, base: i * 0.4 });
		}
		pool.register({
			position: new THREE.Vector3(cx, 8, midpoint(inner.minZ, inner.maxZ)),
			intensity: 18,
			distance: 40,
			decay: 2,
			color: 0xff44aa,
			priority: 1.4,
		});
		const floorGlow = this.basic(0x331144);
		this.pulseMats.push(floorGlow);
		this.group.add(
			this.box(
				span(inner.minX, inner.maxX) - 2,
				0.04,
				span(inner.minZ + 14, inner.maxZ) - 2,
				floorGlow,
				cx,
				CON_FLOOR_Y + 0.09,
				midpoint(inner.minZ + 14, inner.maxZ),
			),
		);
	}

	private buildHotel(): void {
		const inner = rectInterior(CON_HOTEL);
		const c = rectCenter(CON_HOTEL);
		this.group.add(this.box(8, 1.1, 1.4, this.mat(0x3a4555), c.x, CON_FLOOR_Y + 0.55, inner.minZ + 6));
		const sign = this.sign('CHECK-IN · BADGES', 7, 0.7, 0x88ccff);
		sign.position.set(c.x, CON_FLOOR_Y + 1.6, inner.minZ + 6.1);
		this.group.add(sign);
		const shaft = this.mat(0x2a3340);
		for (const sx of [-1, 1] as const) {
			this.group.add(
				this.box(
					2.2,
					CON_HALL_HEIGHT + CON_HOTEL_FLOORS * CON_HOTEL_FLOOR_H - 1,
					2.2,
					shaft,
					c.x + sx * 10,
					half(CON_HALL_HEIGHT),
					c.z,
				),
			);
		}
	}

	private buildEntrance(): void {
		const arch = this.mat(0x2a1838);
		const neon = this.basic(0xff55cc);
		this.pulseMats.push(neon);
		const x = CON_PORTAL.outerX - 0.4;
		const y = CON_FLOOR_Y + half(CON_PORTAL.headY);
		this.group.add(this.box(0.6, CON_PORTAL.headY, 1.2, arch, x, y, CON_DOOR_BAY.minZ - 0.4));
		this.group.add(this.box(0.6, CON_PORTAL.headY, 1.2, arch, x, y, CON_DOOR_BAY.maxZ + 0.4));
		this.group.add(
			this.box(0.6, 0.5, span(CON_DOOR_BAY.minZ, CON_DOOR_BAY.maxZ) + 2, neon, x, CON_FLOOR_Y + CON_PORTAL.headY + 0.2, 0),
		);
		const title = this.sign(CON_LABEL, 14, 1.6, 0xff88dd);
		title.position.set(CON_PLAZA.maxX - 6, 6.5, 0);
		title.rotation.y = Math.PI / 2;
		this.group.add(title);
	}

	private buildMarquee(): void {
		const board = this.mat(0x120818);
		const x = CON_PLAZA.maxX - 1;
		this.group.add(this.box(0.4, 4, 18, board, x, 4, 0));
		const lines = ['GAY FUR WEEKEND', 'TECHNO ALL NIGHT', 'BOYS · BOYS · BOYS', 'ADULT 18+ · HOTEL E'];
		for (let i = 0; i < lines.length; i++) {
			const s = this.sign(at(lines, i), 8, 0.55, i === 0 || i === 2 ? 0xff6b9d : i === 1 ? 0x00ffcc : 0xffffff);
			s.position.set(x - 0.3, 5.4 - i * 0.85, 0);
			s.rotation.y = Math.PI / 2;
			this.group.add(s);
		}
	}

	/** Pride flags along the plaza and over the main doors. */
	private buildPride(): void {
		const pole = this.mat(0x888090);
		const flagW = 3.2;
		const stripeH = 0.28;
		const places = [
			{ x: midpoint(CON_PLAZA.minX, CON_PLAZA.maxX), z: CON_PLAZA.minZ + 6 },
			{ x: midpoint(CON_PLAZA.minX, CON_PLAZA.maxX), z: CON_PLAZA.maxZ - 6 },
			{ x: CON_PORTAL.outerX - 3, z: CON_DOOR_BAY.minZ - 4 },
			{ x: CON_PORTAL.outerX - 3, z: CON_DOOR_BAY.maxZ + 4 },
			{ x: CON_PLAZA.minX + 10, z: 0 },
		];
		for (const p of places) {
			this.group.add(this.box(0.12, 6, 0.12, pole, p.x, 3, p.z));
			for (let i = 0; i < PRIDE_STRIPES.length; i++) {
				const stripe = this.basic(at(PRIDE_STRIPES, i));
				this.group.add(this.box(flagW, stripeH, 0.04, stripe, p.x + half(flagW) + 0.1, 5.2 - i * stripeH, p.z));
			}
		}
		const banner = this.sign('BEARS · OTTERS · TWUNKS · EVERYONE', 16, 1.1, 0xff88dd);
		banner.position.set(midpoint(CON_PLAZA.minX, CON_PLAZA.maxX), 7.5, 0);
		banner.rotation.y = Math.PI / 2;
		this.group.add(banner);
	}

	private buildTrucks(): void {
		const body = this.mat(0xf0a030);
		const cabin = this.mat(0x224466);
		const spots = [
			{ x: CON_PLAZA.minX + 8, z: CON_PLAZA.minZ + 8 },
			{ x: CON_PLAZA.minX + 8, z: CON_PLAZA.maxZ - 8 },
			{ x: CON_PLAZA.minX + 18, z: CON_PLAZA.minZ + 10 },
			{ x: CON_PLAZA.minX + 18, z: CON_PLAZA.maxZ - 10 },
		];
		const names = ['TAKO TRUCK', 'BUNNY BITES', 'PAWBBLE TEA', 'HOTDOGGO'];
		for (let i = 0; i < spots.length; i++) {
			const s = at(spots, i);
			const g = new THREE.Group();
			g.position.set(s.x, CON_FLOOR_Y, s.z);
			g.add(this.box(5.5, 2.4, 2.4, body, 0, 1.4, 0));
			g.add(this.box(1.8, 1.6, 2.3, cabin, -2.2, 1.5, 0));
			const sign = this.sign(at(names, i), 4, 0.5, 0xffffff);
			sign.position.set(0, 2.9, 1.3);
			g.add(sign);
			this.group.add(g);
		}
	}

	private sign(text: string, w: number, h: number, tint: number): THREE.Object3D {
		const pxW = Math.max(128, Math.round(w * 48));
		const pxH = Math.max(48, Math.round(h * 48));
		const { canvas, ctx } = labelCanvas(pxW, pxH);
		ctx.fillStyle = '#120818';
		ctx.fillRect(0, 0, pxW, pxH);
		ctx.fillStyle = '#ffffff';
		fitText(ctx, text, { x: 8, y: 4, w: pxW - 16, h: pxH - 8 }, { size: pxH * 0.55, maxLines: 2 });
		const tex = labelTexture(canvas);
		this.textures.push(tex);
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: tint, toneMapped: false });
		this.materials.push(mat);
		const geo = new THREE.PlaneGeometry(w, h);
		this.geometries.push(geo);
		return backToBackLabel(geo, mat);
	}
}
