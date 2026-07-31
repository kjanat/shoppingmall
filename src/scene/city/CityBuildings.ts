import * as THREE from 'three';

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

/** Deterministische RNG (mulberry32) — de stad hoort er elke reload hetzelfde bij te staan. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Rand = () => number;

interface TowerSpec {
	x: number;
	z: number;
	w: number;
	d: number;
	h: number;
	rot: number;
}

interface Beacon {
	mat: THREE.MeshBasicMaterial;
	phase: number;
	level: number;
}

export class CityBuildings {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly instanced: THREE.InstancedMesh[] = [];
	private readonly beacons: Beacon[] = [];

	/** Eenheidskubus met origin op straatniveau — torens én dakbakken schalen hieruit. */
	private readonly unitBox: THREE.BoxGeometry;
	private readonly dummy = new THREE.Object3D();

	constructor() {
		this.group.name = 'city_buildings';

		this.unitBox = new THREE.BoxGeometry(1, 1, 1);
		this.unitBox.translate(0, 0.5, 0);
		this.geometries.push(this.unitBox);

		const rand = mulberry32(0x404);
		const towers = this.planTowers(rand);
		this.buildTowers(towers, rand);
		this.buildRoofDetails(towers, rand);
		this.buildBeacons(towers);
	}

	update(dt: number, t: number): void {
		// Luchtvaartlampjes: hard aan, zacht uit. De ease loopt op dt zodat het
		// knipperen niet meeknippert met de framerate van de Pi.
		const k = Math.min(1, dt * 10);
		for (let i = 0; i < this.beacons.length; i++) {
			const b = this.beacons[i];
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

	/**
	 * ~30 torens in vier banden om de ringweg: |x| 58..90 of |z| 44..72,
	 * netjes binnen de wereldgrens (|x| ≤ 95, |z| ≤ 75), ook mét halve breedte.
	 */
	private planTowers(rand: Rand): TowerSpec[] {
		const specs: TowerSpec[] = [];
		const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
		const bands: [number, () => [number, number]][] = [
			[8, () => [lerp(-85, 85, rand()), -lerp(46, 67, rand())]], // noord
			[8, () => [lerp(-85, 85, rand()), lerp(46, 67, rand())]], // zuid
			[7, () => [lerp(60, 87, rand()), lerp(-64, 64, rand())]], // oost
			[7, () => [-lerp(60, 87, rand()), lerp(-64, 64, rand())]], // west
		];
		for (const [count, pick] of bands) {
			for (let i = 0; i < count; i++) {
				for (let attempt = 0; attempt < 8; attempt++) {
					const [x, z] = pick();
					const w = lerp(6, 13, rand());
					const d = lerp(6, 13, rand());
					// Meest middelhoog, ~1 op 5 een uitschieter richting 46.
					const h = rand() < 0.22 ? 30 + 16 * rand() : 10 + 20 * rand();
					// Niet op elkaars tenen (de hoeken van de banden overlappen)
					const vrij = specs.every(
						(s) =>
							Math.abs(s.x - x) > (s.w + w) * 0.5 + 1.5
							|| Math.abs(s.z - z) > (s.d + d) * 0.5 + 1.5,
					);
					if (vrij) {
						// Ietsje scheef van het grid — net genoeg om te verontrusten
						specs.push({ x, z, w, d, h, rot: (rand() - 0.5) * 0.12 });
						break;
					}
					// Na 8 pogingen dan maar geen toren; een gat in de skyline is ook moody.
				}
			}
		}
		return specs;
	}

	/** Eén InstancedMesh, per-instance nachttint, gedeelde raam-textuur die 's avonds gloeit. */
	private buildTowers(specs: TowerSpec[], rand: Rand): void {
		const tex = this.makeWindowTexture(rand);
		const facade = new THREE.MeshStandardMaterial({
			color: 0xffffff,
			map: tex,
			emissive: 0xffffff,
			emissiveMap: tex,
			emissiveIntensity: 0.8,
			roughness: 0.9,
			metalness: 0.05,
		});
		const roof = new THREE.MeshStandardMaterial({ color: 0x171a22, roughness: 0.95 });
		this.materials.push(facade, roof);

		// BoxGeometry-groups: +x,-x,+y,-y,+z,-z → dak en bodem zónder raampjes,
		// anders kijkt de drone op verlichte plafonds neer.
		const mesh = new THREE.InstancedMesh(
			this.unitBox,
			[facade, facade, roof, roof, facade, facade],
			specs.length,
		);
		mesh.name = 'city_towers';

		const tint = new THREE.Color();
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
	private buildRoofDetails(specs: TowerSpec[], rand: Rand): void {
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
			const mx = s.w * 0.5 - 1.4;
			const mz = s.d * 0.5 - 1.4;
			if (mx <= 0 || mz <= 0) continue;
			const cos = Math.cos(s.rot);
			const sin = Math.sin(s.rot);
			const opDak = (ox: number, oz: number): [number, number] => [
				s.x + ox * cos - oz * sin,
				s.z + ox * sin + oz * cos,
			];

			if (rand() < 0.38) {
				const sc = 1.6 + rand();
				const [x, z] = opDak((rand() * 2 - 1) * mx, (rand() * 2 - 1) * mz);
				water.push({ x, y: s.h, z, sx: sc, sy: sc * 1.3, sz: sc, rot: s.rot });
			}
			const nAC = Math.floor(rand() * 3);
			for (let i = 0; i < nAC; i++) {
				const [x, z] = opDak((rand() * 2 - 1) * mx, (rand() * 2 - 1) * mz);
				boxes.push({
					x,
					y: s.h,
					z,
					sx: 0.9 + rand() * 1.1,
					sy: 0.5 + rand() * 0.5,
					sz: 0.9 + rand() * 1.1,
					rot: s.rot + (rand() - 0.5) * 0.5,
				});
			}
			if (rand() < 0.33) {
				const [x, z] = opDak((rand() * 2 - 1) * mx * 0.6, (rand() * 2 - 1) * mz * 0.6);
				boxes.push({ x, y: s.h, z, sx: 0.12, sy: 3 + rand() * 5, sz: 0.12, rot: 0 });
			}
		}

		const cyl = new THREE.CylinderGeometry(0.5, 0.62, 1, 7);
		cyl.translate(0, 0.5, 0);
		this.geometries.push(cyl);
		const waterMat = new THREE.MeshStandardMaterial({ color: 0x4b3a30, roughness: 0.9 });
		const boxMat = new THREE.MeshStandardMaterial({ color: 0x262c36, roughness: 0.85 });
		this.materials.push(waterMat, boxMat);

		const vul = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Blob[], name: string) => {
			if (list.length === 0) return;
			const mesh = new THREE.InstancedMesh(geo, mat, list.length);
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
	private buildBeacons(specs: TowerSpec[]): void {
		const bulbGeo = new THREE.SphereGeometry(0.5, 10, 8);
		const mastGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6);
		this.geometries.push(bulbGeo, mastGeo);
		const mastMat = new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.8 });
		this.materials.push(mastMat);

		const hoogste = [...specs].sort((a, b) => b.h - a.h).slice(0, 3);
		hoogste.forEach((s, i) => {
			const mat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, toneMapped: false });
			this.materials.push(mat);
			const mast = new THREE.Mesh(mastGeo, mastMat);
			mast.position.set(s.x, s.h + 0.7, s.z);
			const bulb = new THREE.Mesh(bulbGeo, mat);
			bulb.position.set(s.x, s.h + 1.55, s.z);
			this.group.add(mast, bulb);
			// Uit fase — synchroon knipperende torens zien eruit als een bug.
			this.beacons.push({ mat, phase: i * 2.4, level: 1 });
		});
	}

	/** Gedeelde gevel-textuur: donkere nacht, ~30% ramen aan, één raam rood. */
	private makeWindowTexture(rand: Rand): THREE.CanvasTexture {
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 512;
		const ctx = c.getContext('2d')!;
		const bg = ctx.createLinearGradient(0, 0, 0, 512);
		bg.addColorStop(0, '#0d1019');
		bg.addColorStop(1, '#141827');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 256, 512);

		const cols = 9;
		const rows = 20;
		const cw = 256 / cols;
		const ch = 512 / rows;
		const lit = ['#e8c98a', '#f4dfae', '#aac6dd', '#8ea6bf'];
		const redCol = Math.floor(rand() * cols);
		const redRow = 2 + Math.floor(rand() * (rows - 4));
		for (let r = 0; r < rows; r++) {
			for (let col = 0; col < cols; col++) {
				if (col === redCol && r === redRow) {
					ctx.fillStyle = '#87201d'; // dat éne raam. Niet naar kijken.
				} else if (rand() < 0.3) {
					ctx.fillStyle = lit[Math.floor(rand() * lit.length)];
				} else {
					ctx.fillStyle = '#181d2c'; // donker raam, nét lichter dan de gevel
				}
				ctx.globalAlpha = 0.72 + rand() * 0.28;
				ctx.fillRect(col * cw + cw * 0.22, r * ch + ch * 0.24, cw * 0.56, ch * 0.5);
			}
		}
		ctx.globalAlpha = 1;

		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 4;
		this.textures.push(tex);
		return tex;
	}
}
