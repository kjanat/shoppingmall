import type { BufferGeometry, CanvasTexture, Material } from 'three';
import {
	BoxGeometry,
	Color,
	CylinderGeometry,
	Group,
	InstancedMesh,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	SphereGeometry,
} from 'three';
import { shellShadowOn } from '#/render/graphicsPrefs';
import { lit } from '#/render/material';
import type { Rand, TowerSpec } from '#/scene/city/cityPlan';
import { planTowers, TOWER_SEED } from '#/scene/city/cityPlan';
import { labelCanvas, labelTexture } from '#/util/label';
import { easeFactor, half } from '#/util/math';
import { jitterWith, mulberry32, pickWith, plusMinusWith } from '#/util/rand';

/**
 * Skyline rond de mall — een ring laagpoly torens buiten de ringweg.
 *
 * Vibe: 'this website does not exist'. Niemand woont hier aantoonbaar, maar
 * overal branden ramen. Op elke gevel brandt bovendien exact hetzelfde raam
 * rood, omdat de textuur gedeeld is en wij dat een feature noemen.
 *
 * Pi-budget: één InstancedMesh voor alle torens (per-instance nachttint),
 * twee InstancedMeshes voor dakrommel, drie knipperbolletjes. Geen lampen.
 */

// ── AC-bakken op het dak: hoogte is basis plus random, de draai staat er scheef op ──
const AC_HOOGTE_BASIS = 0.5;
const AC_HOOGTE_SPREIDING = 0.5;
/** Volle breedte van de scheefstand rond de torenhoek, in radialen. */
const AC_DRAAI_SPREIDING = 0.5;

// ── gevelraam binnen zijn celletje, als deel van de celmaat ──
const RAAM_MARGE_X = 0.22;
const RAAM_MARGE_Y = 0.24;
const RAAM_BREEDTE = 0.56;
const RAAM_HOOGTE = 0.5;

interface Beacon {
	mat: MeshBasicMaterial;
	phase: number;
	level: number;
}

export class CityBuildings {
	readonly group = new Group();

	private readonly materials: Material[] = [];
	private readonly geometries: BufferGeometry[] = [];
	private readonly textures: CanvasTexture[] = [];
	private readonly instanced: InstancedMesh[] = [];
	private readonly beacons: Beacon[] = [];

	/** Eenheidskubus met origin op straatniveau — torens én dakbakken schalen hieruit. */
	private readonly unitBox: BoxGeometry;
	private readonly dummy = new Object3D();

	constructor() {
		this.group.name = 'city_buildings';

		this.unitBox = new BoxGeometry(1, 1, 1);
		this.unitBox.translate(0, 0.5, 0);
		this.geometries.push(this.unitBox);

		const rand = mulberry32(TOWER_SEED);
		const towers = planTowers(rand);
		this.buildTowers(towers, rand);
		this.buildRoofDetails(towers, rand);
		this.buildBeacons(towers);
	}

	update(dt: number, t: number): void {
		// Luchtvaartlampjes: hard aan, zacht uit. De ease loopt op dt zodat het
		// knipperen niet meeknippert met de framerate van de Pi.
		const k = easeFactor(10, dt);
		for (const b of this.beacons) {
			const target = Math.sin(t * 1.7 + b.phase) > 0.4 ? 1 : 0.05;
			b.level += (target - b.level) * k;
			b.mat.color.setRGB(b.level * 1.6, b.level * 0.12, b.level * 0.1);
		}
	}

	dispose(): void {
		for (const m of this.instanced) m.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const tx of this.textures) tx.dispose();
		this.group.clear();
	}

	/** Eén InstancedMesh, per-instance nachttint, gedeelde raam-textuur die 's avonds gloeit. */
	private buildTowers(specs: readonly TowerSpec[], rand: Rand): void {
		const tex = this.makeWindowTexture(rand);
		const facade = lit({
			color: 0xffffff,
			map: tex,
			emissive: 0xffffff,
			emissiveMap: tex,
			emissiveIntensity: 0.8,
			roughness: 0.9,
			metalness: 0.05,
		});
		const roof = lit({ color: 0x171a22, roughness: 0.95 });
		this.materials.push(facade, roof);

		// BoxGeometry-groups: +x,-x,+y,-y,+z,-z → dak en bodem zónder raampjes,
		// anders kijkt de drone op verlichte plafonds neer.
		const mesh = new InstancedMesh(this.unitBox, [facade, facade, roof, roof, facade, facade], specs.length);
		mesh.name = 'city_towers';
		// Buiten de zon-schaduwcamera (±55/±45 rond de oorsprong), dus dit werpt pas
		// iets zodra die camera de torens omvat; hier voor de volledigheid van de schil.
		mesh.castShadow = shellShadowOn();

		const tint = new Color();
		specs.forEach((s, i) => {
			this.dummy.position.set(s.x, 0, s.z);
			this.dummy.rotation.set(0, s.rot, 0);
			this.dummy.scale.set(s.w, s.h, s.d);
			this.dummy.updateMatrix();
			mesh.setMatrixAt(i, this.dummy.matrix);
			// Gedempte nachttinten: leisteen → indigo, met heel af en toe een
			// roestvlek van een toren die betere tijden heeft gekend.
			const hue = rand() < 0.08 ? 0.02 : 0.55 + rand() * 0.17;
			tint.setHSL(hue, 0.1 + rand() * 0.14, 0.32 + rand() * 0.2);
			mesh.setColorAt(i, tint);
		});
		mesh.computeBoundingSphere();
		this.instanced.push(mesh);
		this.group.add(mesh);
	}

	/** Dakrommel: watertorens (cilinders) + AC-bakken/antennes (geschaalde kubusjes), dun gestrooid. */
	private buildRoofDetails(specs: readonly TowerSpec[], rand: Rand): void {
		interface Blob {
			x: number;
			y: number;
			z: number;
			sx: number;
			sy: number;
			sz: number;
			rot: number;
		}
		const water: Blob[] = [];
		const boxes: Blob[] = [];

		for (const s of specs) {
			const mx = half(s.w) - 1.4;
			const mz = half(s.d) - 1.4;
			if (mx <= 0 || mz <= 0) continue;
			const cos = Math.cos(s.rot);
			const sin = Math.sin(s.rot);
			const opDak = (ox: number, oz: number): [number, number] => [s.x + ox * cos - oz * sin, s.z + ox * sin + oz * cos];

			if (rand() < 0.38) {
				const sc = 1.6 + rand();
				const [x, z] = opDak(plusMinusWith(mx, rand), plusMinusWith(mz, rand));
				water.push({ x, y: s.h, z, sx: sc, sy: sc * 1.3, sz: sc, rot: s.rot });
			}
			const nAc = Math.floor(rand() * 3);
			for (let i = 0; i < nAc; i++) {
				const [x, z] = opDak(plusMinusWith(mx, rand), plusMinusWith(mz, rand));
				boxes.push({
					x,
					y: s.h,
					z,
					sx: 0.9 + rand() * 1.1,
					sy: AC_HOOGTE_BASIS + rand() * AC_HOOGTE_SPREIDING,
					sz: 0.9 + rand() * 1.1,
					rot: s.rot + jitterWith(AC_DRAAI_SPREIDING, rand),
				});
			}
			if (rand() < 0.33) {
				const [x, z] = opDak(plusMinusWith(mx, rand) * 0.6, plusMinusWith(mz, rand) * 0.6);
				boxes.push({ x, y: s.h, z, sx: 0.12, sy: 3 + rand() * 5, sz: 0.12, rot: 0 });
			}
		}

		const cyl = new CylinderGeometry(0.5, 0.62, 1, 7);
		cyl.translate(0, 0.5, 0);
		this.geometries.push(cyl);
		const waterMat = lit({ color: 0x4b3a30, roughness: 0.9 });
		const boxMat = lit({ color: 0x262c36, roughness: 0.85 });
		this.materials.push(waterMat, boxMat);

		const vul = (geo: BufferGeometry, mat: Material, list: Blob[], name: string) => {
			if (list.length === 0) return;
			const mesh = new InstancedMesh(geo, mat, list.length);
			mesh.name = name;
			list.forEach((b, i) => {
				this.dummy.position.set(b.x, b.y, b.z);
				this.dummy.rotation.set(0, b.rot, 0);
				this.dummy.scale.set(b.sx, b.sy, b.sz);
				this.dummy.updateMatrix();
				mesh.setMatrixAt(i, this.dummy.matrix);
			});
			mesh.computeBoundingSphere();
			this.instanced.push(mesh);
			this.group.add(mesh);
		};
		vul(cyl, waterMat, water, 'city_watertorens');
		vul(this.unitBox, boxMat, boxes, 'city_dakbakken');
	}

	/** Rood knipperlicht op de 3 hoogste torens — pure emissive, geen lamp. */
	private buildBeacons(specs: readonly TowerSpec[]): void {
		const bulbGeo = new SphereGeometry(0.5, 10, 8);
		const mastGeo = new CylinderGeometry(0.06, 0.06, 1.4, 6);
		this.geometries.push(bulbGeo, mastGeo);
		const mastMat = lit({ color: 0x2b313c, roughness: 0.8 });
		this.materials.push(mastMat);

		const hoogste = [...specs].sort((a, b) => b.h - a.h).slice(0, 3);
		hoogste.forEach((s, i) => {
			const mat = new MeshBasicMaterial({ color: 0xff1a1a, toneMapped: false });
			this.materials.push(mat);
			const mast = new Mesh(mastGeo, mastMat);
			mast.position.set(s.x, s.h + 0.7, s.z);
			const bulb = new Mesh(bulbGeo, mat);
			bulb.position.set(s.x, s.h + 1.55, s.z);
			this.group.add(mast, bulb);
			// Uit fase — synchroon knipperende torens zien eruit als een bug.
			this.beacons.push({ mat, phase: i * 2.4, level: 1 });
		});
	}

	/** Gedeelde gevel-textuur: donkere nacht, ~30% ramen aan, één raam rood. */
	private makeWindowTexture(rand: Rand): CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(256, 512);
		const bg = ctx.createLinearGradient(0, 0, 0, 512);
		bg.addColorStop(0, '#0d1019');
		bg.addColorStop(1, '#141827');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 256, 512);

		const cols = 9;
		const rows = 20;
		const cw = 256 / cols;
		const ch = 512 / rows;
		const litWindowColors = ['#e8c98a', '#f4dfae', '#aac6dd', '#8ea6bf'];
		const redCol = Math.floor(rand() * cols);
		const redRow = 2 + Math.floor(rand() * (rows - 4));
		for (let r = 0; r < rows; r++) {
			for (let col = 0; col < cols; col++) {
				if (col === redCol && r === redRow) {
					ctx.fillStyle = '#87201d'; // dat éne raam. Niet naar kijken.
				} else if (rand() < 0.3) {
					ctx.fillStyle = pickWith(litWindowColors, rand);
				} else {
					ctx.fillStyle = '#181d2c'; // donker raam, nét lichter dan de gevel
				}
				ctx.globalAlpha = 0.72 + rand() * 0.28;
				ctx.fillRect(col * cw + cw * RAAM_MARGE_X, r * ch + ch * RAAM_MARGE_Y, cw * RAAM_BREEDTE, ch * RAAM_HOOGTE);
			}
		}
		ctx.globalAlpha = 1;

		const tex = labelTexture(c);
		tex.anisotropy = 4;
		this.textures.push(tex);
		return tex;
	}
}
