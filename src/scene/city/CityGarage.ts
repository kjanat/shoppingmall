import * as THREE from 'three';
import { ctx2d } from '@/util/dom';
import { at, pickWith } from '@/util/rand';

/**
 * Parkeergarage op het ZO-blok (x 56..86, z 44..68). Vier open parkeerdekken
 * (platen + kolommen + borstweringen), een buitenspiraal-suggestie van schuine
 * platen om de zuidoosthoek, en op de westgevel een groot blauw P-bord met
 * daaronder 'VOL' in rood.
 *
 * Over dat VOL: er staan 18 auto's op ruwweg 128 plekken. Niemand heeft het
 * bord meer omgezet sinds de opening, en de slagboom gaat gewoon op en neer,
 * onafhankelijk van wie er aankomt. Vertrouwen is hier infrastructuur.
 *
 * Pi-budget: zes InstancedMeshes (dekken, kolommen, borstwering, tl-balken,
 * carrosserieën+cabines+wielen), verder losse meshes op één gedeelde unit-kubus.
 * Geen lampen — de tl-balken zijn MeshBasicMaterial en doen alsof.
 */

/** Deterministische RNG (mulberry32) — de garage staat er elke reload exact zo bij. */
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

// ── voetafdruk van het hoofdgebouw; de oostelijke strook (x 83..86) is voor de spiraal ──
const X0 = 58;
const X1 = 83;
const Z0 = 46;
const Z1 = 64;
const CX = (X0 + X1) / 2; // 70.5
const CZ = (Z0 + Z1) / 2; // 55
const W = X1 - X0; // 25
const D = Z1 - Z0; // 18

const FLOOR_H = 3.2;
const SLAB_T = 0.35;
/** Parkeerdekken 0..3; de plaat op 4·FLOOR_H is het dak (leeg — VOL is een gemoedstoestand). */
const DECKS = 4;

/** Bovenkant van dek i — de begane grond is een dunnere plaat op het parkeerterrein. */
const deckTop = (i: number): number => (i === 0 ? 0.2 : i * FLOOR_H + SLAB_T / 2);

// Kolommen op de gaten tússen de parkeervakken, zodat niemand instanced blik
// door instanced beton hoeft te zien steken.
const COL_X = [59, 62.8, 71.2, 79.6, 82.4];
const COL_Z = [46.8, 55, 63.2];

// Parkeervakken: 8 sloten per rij, twee rijen per dek, neus naar de wand of
// naar het gangpad — de bewoners zijn het onderling nooit eens geworden.
const SLOT_X0 = 61.4;
const SLOT_PITCH = 2.8;
const SLOTS = 8;
const ROW_Z = [49.8, 60.2];

/** Wiel-offsets in auto-lokale ruimte, zelfde onderstel als het ringweg-wagenpark. */
const WHEEL_OFFSETS: readonly [number, number][] = [
	[-1.4, -0.95],
	[-1.4, 0.95],
	[1.4, -0.95],
	[1.4, 0.95],
];

interface Placement {
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	sz: number;
	ry: number;
}

const P = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): Placement => ({ x, y, z, sx, sy, sz, ry });

export class CityGarage {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly instanced: THREE.InstancedMesh[] = [];

	/** Gedeelde eenheidskubus — zo'n beetje elk plat en hoekig ding hier is deze kubus, geschaald. */
	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
	private readonly dummy = new THREE.Object3D();

	private readonly beton: THREE.MeshStandardMaterial;
	private readonly betonDonker: THREE.MeshStandardMaterial;

	private boomPivot!: THREE.Group;
	/** 0 = slagboom dicht, 1 = open. Traag, zoals het hoort bij gemeentelijk staal. */
	private boomOpen = 0;

	constructor() {
		this.group.name = 'city_garage';
		this.geometries.push(this.unitBox);

		this.beton = this.track(new THREE.MeshStandardMaterial({ color: 0x74787a, roughness: 0.95, metalness: 0.05 }));
		this.betonDonker = this.track(new THREE.MeshStandardMaterial({ color: 0x585c5e, roughness: 0.9, metalness: 0.1 }));

		const rand = mulberry32(0x9a1a9e); // garage, ongeveer, als je scheel kijkt
		this.buildStructure();
		this.buildRamp();
		this.buildSign();
		this.buildCars(rand);
		this.buildBoom();
	}

	update(dt: number, t: number): void {
		// Geklemde sinus: de slagboom hangt even boven, hangt even beneden, en
		// beweegt daartussen alsof hij ergens over nadenkt. De ease loopt op dt
		// zodat de bedenktijd niet meeschaalt met de framerate van de Pi.
		const doel = THREE.MathUtils.clamp(Math.sin(t * 0.35) * 1.8, -1, 1) * 0.5 + 0.5;
		this.boomOpen += (doel - this.boomOpen) * Math.min(1, dt * 1.6);
		this.boomPivot.rotation.x = -1.25 * this.boomOpen;
	}

	dispose(): void {
		for (const m of this.instanced) m.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const tx of this.textures) tx.dispose();
		this.group.clear();
	}

	// ── bouw ─────────────────────────────────────────────

	/** Dekken, kolommen, borstweringen en tl-balken — het betonnen casco. */
	private buildStructure(): void {
		// Vijf platen: dunne vloerplaat op maaiveld + vier dekken (waarvan één dak).
		const slabs: Placement[] = [P(CX, 0.1, CZ, W, 0.2, D)];
		for (let i = 1; i <= DECKS; i++) slabs.push(P(CX, i * FLOOR_H, CZ, W, SLAB_T, D));
		const slabMesh = this.fill(this.unitBox, this.beton, slabs, 'garage_dekken');
		slabMesh.receiveShadow = true;

		// Kolommen in één stuk van vloer tot dak; ze prikken onzichtbaar door de
		// platen heen, net als bij echte systeembouw.
		const cols: Placement[] = [];
		for (const x of COL_X) {
			for (const z of COL_Z) cols.push(P(x, 6.5, z, 0.45, 12.6, 0.45));
		}
		this.fill(this.unitBox, this.betonDonker, cols, 'garage_kolommen');

		// Borstweringen op elk dek, rondom — laag genoeg om overheen te kijken,
		// hoog genoeg om er een verzekeringspolis op te baseren.
		const borst: Placement[] = [];
		for (let i = 1; i <= DECKS; i++) {
			const y = deckTop(i) + 0.5;
			borst.push(P(CX, y, Z0 + 0.09, W, 1.0, 0.18));
			borst.push(P(CX, y, Z1 - 0.09, W, 1.0, 0.18));
			borst.push(P(X0 + 0.09, y, CZ, 0.18, 1.0, D - 0.36));
			borst.push(P(X1 - 0.09, y, CZ, 0.18, 1.0, D - 0.36));
		}
		this.fill(this.unitBox, this.beton, borst, 'garage_borstwering');

		// Tl-balken onder elk dek: MeshBasicMaterial dat koud kantoorlicht
		// suggereert zonder de GPU om een gunst te vragen.
		const stripMat = this.track(new THREE.MeshBasicMaterial({ color: 0xbcd6e4, toneMapped: false }));
		const strips: Placement[] = [];
		for (let i = 1; i <= DECKS; i++) {
			const y = i * FLOOR_H - SLAB_T / 2 - 0.05;
			for (const z of [50.5, 59.5]) strips.push(P(CX, y, z, 21, 0.08, 0.24));
		}
		this.fill(this.unitBox, stripMat, strips, 'garage_tl');
	}

	/**
	 * Buitenspiraal-suggestie om de ZO-hoek: schuine plaat zuid (maaiveld → dek 1),
	 * hoekbordes, schuine plaat oost (dek 1 → dek 2), landing noord. De rest van
	 * de spiraal is binnen, zegt de bewegwijzering, en die geloven we.
	 */
	private buildRamp(): void {
		const aZuid = Math.atan2(3.2, 23);
		const aOost = Math.atan2(3.2, 15);

		// Zuidplaat: komt op x≈60 van het parkeerterrein en klimt oostwaarts.
		this.addBox(this.beton, 23.3, 0.25, 3.2, 71.5, 1.6, 65.8, 0, aZuid);
		this.addBox(this.betonDonker, 23.3, 0.6, 0.12, 71.5, 2.03, 67.34, 0, aZuid);

		// Hoekbordes ZO (vlak op dek 1-hoogte), dan de oostplaat noordwaarts omhoog.
		this.addBox(this.beton, 2.8, 0.25, 4.4, 84.5, 3.08, 65.4);
		this.addBox(this.beton, 2.8, 0.25, 15.4, 84.5, 4.8, 55.9, aOost, 0);
		this.addBox(this.betonDonker, 0.12, 0.6, 15.4, 85.86, 5.22, 55.9, aOost, 0);
		this.addBox(this.beton, 2.8, 0.25, 3.4, 84.5, 6.28, 47.0);

		// Steunpoten — drie stuks, want beton dat zichtbaar zweeft roept vragen op.
		this.addBox(this.betonDonker, 0.3, 3.0, 0.3, 84.5, 1.5, 65.4);
		this.addBox(this.betonDonker, 0.3, 3.8, 0.3, 84.5, 1.9, 60.0);
		this.addBox(this.betonDonker, 0.3, 5.6, 0.3, 84.5, 2.8, 51.0);
	}

	/** Groot blauw P-bord op de westgevel (richting mall), met VOL in rood eronder. */
	private buildSign(): void {
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 384;
		const ctx = ctx2d(c);
		ctx.fillStyle = '#0a49b8';
		ctx.fillRect(0, 0, 256, 384);
		ctx.strokeStyle = '#f4f6f8';
		ctx.lineWidth = 10;
		ctx.strokeRect(10, 10, 236, 364);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 190px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('P', 128, 150);
		// Het VOL-plankje. Al jaren niet omgedraaid; zie het klasse-commentaar.
		ctx.fillStyle = '#f2f3ef';
		ctx.fillRect(40, 270, 176, 84);
		ctx.fillStyle = '#d0261c';
		ctx.font = 'bold 64px system-ui,sans-serif';
		ctx.fillText('VOL', 128, 314);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		this.textures.push(tex);

		// Donker draagvlak over de open gevel, anders hangt het bord in het niets.
		this.addBox(this.betonDonker, 0.14, 4.9, 3.4, X0 + 0.02, 8.6, CZ);
		const geo = new THREE.PlaneGeometry(3.1, 4.65);
		this.geometries.push(geo);
		const sign = new THREE.Mesh(geo, this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
		sign.rotation.y = -Math.PI / 2; // kijkt naar −x, dus naar de mall
		sign.position.set(X0 - 0.12, 8.6, CZ);
		this.group.add(sign);
	}

	/** 18 geparkeerde auto's: zelfde silhouet als het ringweg-wagenpark, kleur per instance. */
	private buildCars(rand: Rand): void {
		const bodyGeo = new THREE.BoxGeometry(4.2, 0.75, 1.85);
		bodyGeo.translate(0, 0.73, 0);
		const cabinGeo = new THREE.BoxGeometry(2.1, 0.6, 1.6);
		cabinGeo.translate(-0.3, 1.32, 0);
		const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
		wheelGeo.rotateX(Math.PI / 2);
		this.geometries.push(bodyGeo, cabinGeo, wheelGeo);

		const bodyMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }));
		const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1d262d, roughness: 0.25, metalness: 0.5 }));
		const wheelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 }));

		// Bezetting per dek loopt af naar boven; niemand rijdt vrijwillig door.
		const perDek = [6, 5, 4, 3];
		const bodies: Placement[] = [];
		const wheels: Placement[] = [];
		for (let dek = 0; dek < perDek.length; dek++) {
			const base = deckTop(dek);
			// Alle 16 vakken van dit dek, geschud (Fisher–Yates), de eerste n bezet.
			const vakken: [number, number][] = [];
			for (let k = 0; k < SLOTS; k++) {
				for (const rz of ROW_Z) vakken.push([SLOT_X0 + k * SLOT_PITCH, rz]);
			}
			for (let i = vakken.length - 1; i > 0; i--) {
				const j = Math.floor(rand() * (i + 1));
				const tmp = at(vakken, i);
				vakken[i] = at(vakken, j);
				vakken[j] = tmp;
			}
			for (let n = 0; n < at(perDek, dek); n++) {
				const [x, z] = at(vakken, n);
				const ry = rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
				bodies.push(P(x, base, z, 1, 1, 1, ry));
				const cos = Math.cos(ry);
				const sin = Math.sin(ry);
				for (const [wx, wz] of WHEEL_OFFSETS) {
					wheels.push(P(x + wx * cos + wz * sin, base + 0.38, z - wx * sin + wz * cos, 1, 1, 1, ry));
				}
			}
		}

		const bodyMesh = this.fill(bodyGeo, bodyMat, bodies, 'garage_autos');
		// Gedempte lakkleuren met een tikje jitter — hetzelfde palet als buiten,
		// want in deze stad bestaat er precies één autodealer.
		const palet = [0xb0413e, 0x3e63a8, 0x4a4e57, 0xd8d3c8, 0x3f6f4f, 0x23262d, 0x9a7b4f];
		const kleur = new THREE.Color();
		for (let i = 0; i < bodies.length; i++) {
			kleur.setHex(pickWith(palet, rand));
			kleur.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
			bodyMesh.setColorAt(i, kleur);
		}
		this.fill(cabinGeo, glassMat, bodies, 'garage_cabines'); // zelfde transforms als de body's
		this.fill(wheelGeo, wheelMat, wheels, 'garage_wielen');
	}

	/** Slagboom + kaartautomaat bij de westingang. De oprit zelf heeft niets; daar heerst vertrouwen. */
	private buildBoom(): void {
		const wit = this.track(new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5, metalness: 0.2 }));
		const rood = this.track(new THREE.MeshBasicMaterial({ color: 0xc62f28, toneMapped: false }));
		const scherm = this.track(new THREE.MeshBasicMaterial({ color: 0x8fd8a0, toneMapped: false }));

		this.addBox(this.betonDonker, 0.22, 1.05, 0.22, 56.9, 0.53, 50.4); // slagboompaal
		this.addBox(this.betonDonker, 0.55, 1.15, 0.45, 56.9, 0.58, 49.2); // kaartautomaat
		this.addBox(scherm, 0.05, 0.3, 0.32, 56.6, 0.85, 49.2); // schermpje: altijd groen, betekent niets

		// Arm scharniert om x: bij rotatie 0 ligt hij over de inrit (z 50.4 → 54),
		// bij −1.25 rad wijst hij omhoog en mag iedereen erdoor. Ook bij 0 trouwens.
		this.boomPivot = new THREE.Group();
		this.boomPivot.position.set(56.9, 1.02, 50.4);
		const arm = new THREE.Mesh(this.unitBox, wit);
		arm.scale.set(0.14, 0.14, 3.6);
		arm.position.set(0, 0, 1.8);
		this.boomPivot.add(arm);
		for (const zz of [0.9, 2.0, 3.1]) {
			const sleeve = new THREE.Mesh(this.unitBox, rood);
			sleeve.scale.set(0.18, 0.18, 0.5);
			sleeve.position.set(0, 0, zz);
			this.boomPivot.add(sleeve);
		}
		this.group.add(this.boomPivot);
	}

	// ── gereedschap ─────────────────────────────────────────────

	/** Eén InstancedMesh uit een lijstje plaatsingen — het stedelijke standaardrecept. */
	private fill(geo: THREE.BufferGeometry, mat: THREE.Material, items: readonly Placement[], name: string): THREE.InstancedMesh {
		const mesh = new THREE.InstancedMesh(geo, mat, items.length);
		mesh.name = name;
		items.forEach((p, i) => {
			this.dummy.position.set(p.x, p.y, p.z);
			this.dummy.rotation.set(0, p.ry, 0);
			this.dummy.scale.set(p.sx, p.sy, p.sz);
			this.dummy.updateMatrix();
			mesh.setMatrixAt(i, this.dummy.matrix);
		});
		mesh.computeBoundingSphere();
		this.instanced.push(mesh);
		this.group.add(mesh);
		return mesh;
	}

	/** Losse geschaalde unit-kubus voor eenmalige onderdelen (platen, poten, paal). */
	private addBox(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, rz = 0): void {
		const m = new THREE.Mesh(this.unitBox, mat);
		m.scale.set(sx, sy, sz);
		m.position.set(x, y, z);
		m.rotation.x = rx;
		m.rotation.z = rz;
		this.group.add(m);
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
