import type { BufferGeometry, Material, Texture } from 'three';
import {
	BoxGeometry,
	Color,
	CylinderGeometry,
	Group,
	InstancedMesh,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PlaneGeometry,
} from 'three';
import type { LitMaterial } from '#/render/material';
import { lit } from '#/render/material';
import type { GarageRampRun, Rand } from '#/scene/city/cityPlan';
import {
	GARAGE_PARAPETS,
	GARAGE_PLAN,
	GARAGE_RAMP_EAST_EDGE_X,
	GARAGE_RAMP_EAST_X,
	GARAGE_RAMP_LANDINGS,
	GARAGE_RAMP_RUNS,
	GARAGE_RAMP_SOUTH_EDGE_Z,
	garageDeckTop,
	garageEastSpiralY,
} from '#/scene/city/cityPlan';
import { labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint, span } from '#/util/math';
import { at, jitterWith, mulberry32, pickWith } from '#/util/rand';

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

// ── voetafdruk van het hoofdgebouw; de oostelijke strook (x 83..86) is voor de spiraal ──
const { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 } = GARAGE_PLAN.footprint;
const CX = midpoint(X0, X1); // 70.5
const CZ = midpoint(Z0, Z1); // 55
const W = span(X0, X1); // 25
const D = span(Z0, Z1); // 18

const FLOOR_H = GARAGE_PLAN.floorHeight;
const SLAB_T = GARAGE_PLAN.slabThickness;
/** Parkeerdekken 0..3; de plaat op 4·FLOOR_H is het dak (leeg — VOL is een gemoedstoestand). */
const DECKS = GARAGE_PLAN.decks;
const GROND_DEK_Y = GARAGE_PLAN.groundDeckY;
const RAMP = GARAGE_PLAN.ramp;

// Kolommen op de gaten tússen de parkeervakken, zodat niemand instanced blik
// door instanced beton hoeft te zien steken.
const COL_X = GARAGE_PLAN.columnX;
const COL_Z = GARAGE_PLAN.columnZ;

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

const P = ({ x, y, z, sx = 1, sy = 1, sz = 1, ry = 0 }: { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; ry?: number }): Placement => ({ x, y, z, sx, sy, sz, ry });

export class CityGarage {
	readonly group = new Group();

	private readonly materials: Material[] = [];
	private readonly geometries: BufferGeometry[] = [];
	private readonly textures: Texture[] = [];
	private readonly instanced: InstancedMesh[] = [];

	/** Gedeelde eenheidskubus — zo'n beetje elk plat en hoekig ding hier is deze kubus, geschaald. */
	private readonly unitBox = new BoxGeometry(1, 1, 1);
	private readonly dummy = new Object3D();

	private readonly beton: LitMaterial;
	private readonly betonDonker: LitMaterial;

	constructor() {
		this.group.name = 'city_garage';
		this.geometries.push(this.unitBox);

		this.beton = this.track(lit({ color: 0x74787a, roughness: 0.95, metalness: 0.05 }));
		this.betonDonker = this.track(lit({ color: 0x585c5e, roughness: 0.9, metalness: 0.1 }));

		const rand = mulberry32(0x9a1a9e); // garage, ongeveer, als je scheel kijkt
		this.buildStructure();
		this.buildRamp();
		this.buildSign();
		this.buildCars(rand);
		this.buildTicketMachine();
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
		const slabs: Placement[] = [P({ x: CX, y: half(GROND_DEK_Y), z: CZ, sx: W, sy: GROND_DEK_Y, sz: D })];
		for (let i = 1; i <= DECKS; i++) slabs.push(P({ x: CX, y: i * FLOOR_H, z: CZ, sx: W, sy: SLAB_T, sz: D }));
		const slabMesh = this.fill(this.unitBox, this.beton, slabs, 'garage_dekken');
		slabMesh.receiveShadow = true;

		// Kolommen in één stuk van vloer tot dak; ze prikken onzichtbaar door de
		// platen heen, net als bij echte systeembouw.
		const cols: Placement[] = [];
		const kolomHoogte = span(GROND_DEK_Y, GARAGE_PLAN.columnTopY);
		const kolomMidden = midpoint(GROND_DEK_Y, GARAGE_PLAN.columnTopY);
		for (const x of COL_X) {
			for (const z of COL_Z) {
				cols.push(P({ x, y: kolomMidden, z, sx: GARAGE_PLAN.columnSize, sy: kolomHoogte, sz: GARAGE_PLAN.columnSize }));
			}
		}
		this.fill(this.unitBox, this.betonDonker, cols, 'garage_kolommen');

		// Borstweringen op elk dek, rondom — laag genoeg om overheen te kijken,
		// hoog genoeg om er een verzekeringspolis op te baseren. Het zijn dezelfde
		// dozen die de collision als kerb gebruikt.
		const borst: Placement[] = GARAGE_PARAPETS.map((p) =>
				P({
					x: midpoint(p.minX, p.maxX), y: midpoint(p.minY, p.maxY), z: midpoint(p.minZ, p.maxZ),
					sx: span(p.minX, p.maxX), sy: span(p.minY, p.maxY), sz: span(p.minZ, p.maxZ),
				}),
		);
		this.fill(this.unitBox, this.beton, borst, 'garage_borstwering');

		// Tl-balken onder elk dek: MeshBasicMaterial dat koud kantoorlicht
		// suggereert zonder de GPU om een gunst te vragen.
		const stripMat = this.track(new MeshBasicMaterial({ color: 0xbcd6e4, toneMapped: false }));
		const strips: Placement[] = [];
		for (let i = 1; i <= DECKS; i++) {
			const y = i * FLOOR_H - half(SLAB_T) - 0.05;
			for (const z of [50.5, 59.5]) strips.push(P({ x: CX, y, z, sx: 21, sy: 0.08, sz: 0.24 }));
		}
		this.fill(this.unitBox, stripMat, strips, 'garage_tl');
	}

	/**
	 * Buitenspiraal om de ZO-hoek: schuine plaat zuid (maaiveld → dek 1),
	 * hoekbordes, schuine plaat oost (dek 1 → dek 2), bordes noord. De rest van
	 * de spiraal is binnen, zegt de bewegwijzering, en die geloven we.
	 *
	 * Elke maat komt uit `GARAGE_PLAN.ramp`, want de collision loopt over
	 * dezelfde platen.
	 */
	private buildRamp(): void {
		for (const run of GARAGE_RAMP_RUNS) this.addRampPlate(run);

		for (const bordes of GARAGE_RAMP_LANDINGS) {
			this.addBox({ mat: this.beton, sx: span(bordes.minX, bordes.maxX), sy: RAMP.thickness, sz: span(bordes.minZ, bordes.maxZ), x: midpoint(bordes.minX, bordes.maxX), y: bordes.y - half(RAMP.thickness), z: midpoint(bordes.minZ, bordes.maxZ) });
		}

		// Steunpoten — drie stuks, want beton dat zichtbaar zweeft roept vragen op.
		for (const z of RAMP.legZ) {
			const top = garageEastSpiralY(z) - RAMP.thickness;
			this.addBox({ mat: this.betonDonker, sx: RAMP.legSize, sy: top, sz: RAMP.legSize, x: GARAGE_RAMP_EAST_X, y: half(top), z });
		}
	}

	/**
	 * Eén schuine plaat, met zijn bovenkant precies op de looplijn van `run`, plus
	 * de leuning langs de buitenrand. Het hart van de plaat zakt daarvoor een halve
	 * dikte langs de normaal; de leuning staat er een halve leuninghoogte boven.
	 */
	private addRampPlate(run: GarageRampRun): void {
		const langsX = run.start.z === run.end.z;
		const loop = langsX ? span(run.start.x, run.end.x) : span(run.end.z, run.start.z);
		const stijging = span(run.start.y, run.end.y);
		const lengte = Math.hypot(loop, stijging);
		const hoek = Math.atan2(stijging, loop);
		const zak = half(RAMP.thickness);
		const leuning = half(RAMP.guard.height);
		const x = midpoint(run.start.x, run.end.x);
		const y = midpoint(run.start.y, run.end.y);
		const z = midpoint(run.start.z, run.end.z);
		if (langsX) {
			this.addBox({ mat: this.beton, sx: lengte, sy: RAMP.thickness, sz: run.width, x: x + Math.sin(hoek) * zak, y: y - Math.cos(hoek) * zak, z, rz: hoek });
			this.addBox({ mat: this.betonDonker, sx: lengte, sy: RAMP.guard.height, sz: RAMP.guard.thickness, x: x - Math.sin(hoek) * leuning, y: y + Math.cos(hoek) * leuning, z: GARAGE_RAMP_SOUTH_EDGE_Z - half(RAMP.guard.thickness), rz: hoek });
			return;
		}
		this.addBox({ mat: this.beton, sx: run.width, sy: RAMP.thickness, sz: lengte, x, y: y - Math.cos(hoek) * zak, z: z - Math.sin(hoek) * zak, rx: hoek });
		this.addBox({ mat: this.betonDonker, sx: RAMP.guard.thickness, sy: RAMP.guard.height, sz: lengte, x: GARAGE_RAMP_EAST_EDGE_X - half(RAMP.guard.thickness), y: y + Math.cos(hoek) * leuning, z: z + Math.sin(hoek) * leuning, rx: hoek });
	}

	/** Groot blauw P-bord op de westgevel (richting mall), met VOL in rood eronder. */
	private buildSign(): void {
		const { canvas: c, ctx } = labelCanvas(256, 384);
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
		const tex = labelTexture(c);
		this.textures.push(tex);

		// Donker draagvlak over de open gevel, anders hangt het bord in het niets.
		this.addBox({ mat: this.betonDonker, sx: 0.14, sy: 4.9, sz: 3.4, x: X0 + 0.02, y: 8.6, z: CZ });
		const geo = new PlaneGeometry(3.1, 4.65);
		this.geometries.push(geo);
		const sign = new Mesh(geo, this.track(new MeshBasicMaterial({ map: tex, toneMapped: false })));
		sign.rotation.y = -Math.PI / 2; // kijkt naar −x, dus naar de mall
		sign.position.set(X0 - 0.12, 8.6, CZ);
		this.group.add(sign);
	}

	/** 18 geparkeerde auto's: zelfde silhouet als het ringweg-wagenpark, kleur per instance. */
	private buildCars(rand: Rand): void {
		const bodyGeo = new BoxGeometry(4.2, 0.75, 1.85);
		bodyGeo.translate(0, 0.73, 0);
		const cabinGeo = new BoxGeometry(2.1, 0.6, 1.6);
		cabinGeo.translate(-0.3, 1.32, 0);
		const wheelGeo = new CylinderGeometry(0.34, 0.34, 0.24, 10);
		wheelGeo.rotateX(Math.PI / 2);
		this.geometries.push(bodyGeo, cabinGeo, wheelGeo);

		const bodyMat = this.track(lit({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }));
		const glassMat = this.track(lit({ color: 0x1d262d, roughness: 0.25, metalness: 0.5 }));
		const wheelMat = this.track(lit({ color: 0x101114, roughness: 0.9 }));

		// Bezetting per dek loopt af naar boven; niemand rijdt vrijwillig door.
		const perDek = [6, 5, 4, 3];
		const bodies: Placement[] = [];
		const wheels: Placement[] = [];
		for (let dek = 0; dek < perDek.length; dek++) {
			const base = garageDeckTop(dek);
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
				bodies.push(P({ x, y: base, z, ry }));
				const cos = Math.cos(ry);
				const sin = Math.sin(ry);
				for (const [wx, wz] of WHEEL_OFFSETS) {
					wheels.push(P({ x: x + wx * cos + wz * sin, y: base + 0.38, z: z - wx * sin + wz * cos, ry }));
				}
			}
		}

		const bodyMesh = this.fill(bodyGeo, bodyMat, bodies, 'garage_autos');
		// Gedempte lakkleuren met een tikje jitter — hetzelfde palet als buiten,
		// want in deze stad bestaat er precies één autodealer.
		const palet = [0xb0413e, 0x3e63a8, 0x4a4e57, 0xd8d3c8, 0x3f6f4f, 0x23262d, 0x9a7b4f];
		const kleur = new Color();
		for (let i = 0; i < bodies.length; i++) {
			kleur.setHex(pickWith(palet, rand));
			kleur.offsetHSL(0, 0, jitterWith(0.08, rand));
			bodyMesh.setColorAt(i, kleur);
		}
		this.fill(cabinGeo, glassMat, bodies, 'garage_cabines'); // zelfde transforms als de body's
		this.fill(wheelGeo, wheelMat, wheels, 'garage_wielen');
	}

	/**
	 * De kaartautomaat bij de westingang. De oprit zelf heeft niets; daar heerst vertrouwen.
	 *
	 * De slagboom ernaast stond hier ook, met eigen maten en een sinus die hem los van
	 * wie er aankwam op en neer liet gaan; hij staat nu bij de andere bomen in het
	 * wereldmodel, met een beleid dat zegt wie erlangs mag.
	 */
	private buildTicketMachine(): void {
		const scherm = this.track(new MeshBasicMaterial({ color: 0x8fd8a0, toneMapped: false }));
		this.addBox({ mat: this.betonDonker, sx: 0.55, sy: 1.15, sz: 0.45, x: 56.9, y: 0.58, z: 49.2 }); // kaartautomaat
		this.addBox({ mat: scherm, sx: 0.05, sy: 0.3, sz: 0.32, x: 56.6, y: 0.85, z: 49.2 }); // schermpje: altijd groen, betekent niets
	}

	// ── gereedschap ─────────────────────────────────────────────

	/** Eén InstancedMesh uit een lijstje plaatsingen — het stedelijke standaardrecept. */
	private fill(geo: BufferGeometry, mat: Material, items: readonly Placement[], name: string): InstancedMesh {
		const mesh = new InstancedMesh(geo, mat, items.length);
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
	private addBox(options: { mat: Material; sx: number; sy: number; sz: number; x: number; y: number; z: number; rx?: number; rz?: number }): void {
		const { mat, sx, sy, sz, x, y, z, rx = 0, rz = 0 } = options;
		const m = new Mesh(this.unitBox, mat);
		m.scale.set(sx, sy, sz);
		m.position.set(x, y, z);
		m.rotation.x = rx;
		m.rotation.z = rz;
		this.group.add(m);
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
