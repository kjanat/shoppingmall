import * as THREE from 'three';
import { ctx2d } from '@/util/dom';
import { at } from '@/util/rand';

/**
 * Rechthoekige ringweg om de mall. Vier stroken asfalt, vier zebrapaden,
 * vier stoplichten die niemand gehoorzaamt omdat de sims binnen winkelen.
 *
 * Binnenrand op |x|=48 / |z|=34, wegbreedte 7 → buitenrand |x|=55 / |z|=41.
 * Alles ruim binnen de wereldgrens (|x|≤95, |z|≤75) en ruim buiten de mall.
 */
const INNER_X = 48;
const INNER_Z = 34;
const ROAD_W = 7;
const HALF_W = ROAD_W / 2;
const ROAD_Y = 0.03; // net boven de parkeerplaats-plane, anders z-fight bingo
const ZEBRA_Y = 0.06;

/** Middellijnen van de stroken. */
const LANE_X = INNER_X + HALF_W; // 51.5 — de noord-zuid stroken
const LANE_Z = INNER_Z + HALF_W; // 37.5 — de oost-west stroken

/** Één texture-tegel is 8 wereldmeter asfalt; de streep zit in het midden. */
const TILE_LEN = 8;
/** Oost-west stroken dekken ook de hoeken af: x van -55 tot 55. */
const EW_LEN = 2 * (INNER_X + ROAD_W);
/** Noord-zuid stroken stoppen bij de hoeken: z van -34 tot 34. */
const NS_LEN = 2 * INNER_Z;

/**
 * Fasemachine. 'ns' en 'ew' duren elk 9 s (waarvan de laatste 2 s oranje —
 * lightPhase blijft dan gewoon 'ns'/'ew' melden, het verkeer rijdt immers nog),
 * met tussen elke wissel 2 s 'all-red' zodat niemand theoretisch botst.
 * Cyclus: ns 9 s → all-red 2 s → ew 9 s → all-red 2 s = 22 s.
 */
export type LightPhase = 'ns' | 'ew' | 'all-red';

const GREEN_T = 7;
const AMBER_T = 2;
const ALLRED_T = 2;
const CYCLE = 2 * (GREEN_T + AMBER_T + ALLRED_T); // 22 s

/** Segmentgrenzen binnen de cyclus, voorgekauwd zodat update() alleen vergelijkt. */
const SEG_ENDS = [
	GREEN_T, // 0: ns groen
	GREEN_T + AMBER_T, // 1: ns oranje
	GREEN_T + AMBER_T + ALLRED_T, // 2: alles rood
	CYCLE - AMBER_T - ALLRED_T, // 3: ew groen
	CYCLE - ALLRED_T, // 4: ew oranje
	CYCLE, // 5: alles rood
];

type LampState = 'red' | 'amber' | 'green';

type Head = {
	dir: 'ns' | 'ew';
	red: THREE.Mesh;
	amber: THREE.Mesh;
	green: THREE.Mesh;
};

export class CityRoads {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];
	private heads: Head[] = [];
	private zebras!: THREE.InstancedMesh;

	// Lampmaterialen — gedeeld over alle koppen, we wisselen alleen referenties
	private redOn!: THREE.Material;
	private amberOn!: THREE.Material;
	private greenOn!: THREE.Material;
	private redOff!: THREE.Material;
	private amberOff!: THREE.Material;
	private greenOff!: THREE.Material;

	private clock = 0;
	private seg = -1; // -1 forceert de eerste applyLamps in update

	constructor() {
		this.group.name = 'city_roads';
		this.buildLampMaterials();
		this.buildStrips();
		this.buildZebras();
		this.buildTrafficLights();
	}

	/**
	 * Welke richting nu groen/oranje heeft. 'all-red' is de 2 s waarin
	 * beide richtingen naar een rood bolletje staren.
	 */
	get lightPhase(): LightPhase {
		if (this.seg <= 1) return 'ns';
		if (this.seg === 3 || this.seg === 4) return 'ew';
		return 'all-red';
	}

	update(dt: number, _t: number): void {
		this.clock = (this.clock + dt) % CYCLE;
		let seg = 0;
		while (seg < 5 && this.clock >= at(SEG_ENDS, seg)) seg++;
		if (seg !== this.seg) {
			this.seg = seg;
			this.applyLamps();
		}
	}

	dispose(): void {
		this.zebras.dispose();
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	// ── asfalt ─────────────────────────────────────────────

	/**
	 * Asfalt-tegel: donkergrijs met vlekjes, doorgetrokken kantlijnen en een
	 * onderbroken middenstreep. U loopt langs de rijrichting, dus RepeatWrapping
	 * op wrapS maakt er vanzelf een nette dash van.
	 */
	private makeAsphaltTexture(repeatX: number): THREE.Texture {
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 128;
		const ctx = ctx2d(c);
		ctx.fillStyle = '#26282c';
		ctx.fillRect(0, 0, 256, 128);
		// Vlekjes — asfalt zonder textuur is gewoon een sombere plane
		for (let i = 0; i < 220; i++) {
			const shade = 30 + Math.floor(Math.random() * 26);
			ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 4})`;
			ctx.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
		}
		// Kantlijnen
		ctx.fillStyle = '#8f939a';
		ctx.fillRect(0, 5, 256, 3);
		ctx.fillRect(0, 120, 256, 3);
		// Middenstreep: ~40% van de tegel streep, de rest gat
		ctx.fillStyle = '#d9d4c2';
		ctx.fillRect(24, 61, 104, 6);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.RepeatWrapping;
		tex.repeat.set(repeatX, 1);
		this.textures.push(tex);
		return tex;
	}

	private buildStrips(): void {
		// Twee textures uit dezelfde tegel-logica: de stroken verschillen in
		// lengte en repeat is een texture-eigenschap, dus delen gaat niet.
		const ewMat = this.track(
			new THREE.MeshStandardMaterial({
				map: this.makeAsphaltTexture(EW_LEN / TILE_LEN),
				roughness: 0.95,
			}),
		);
		const nsMat = this.track(
			new THREE.MeshStandardMaterial({
				map: this.makeAsphaltTexture(NS_LEN / TILE_LEN),
				roughness: 0.95,
			}),
		);

		const ewGeo = new THREE.PlaneGeometry(EW_LEN, ROAD_W);
		ewGeo.rotateX(-Math.PI / 2);
		this.geometries.push(ewGeo);
		const nsGeo = new THREE.PlaneGeometry(NS_LEN, ROAD_W);
		nsGeo.rotateX(-Math.PI / 2);
		this.geometries.push(nsGeo);

		// Oost-west stroken (rijrichting langs x), inclusief de vier hoeken
		for (const sz of [-1, 1] as const) {
			const strip = new THREE.Mesh(ewGeo, ewMat);
			strip.position.set(0, ROAD_Y, sz * LANE_Z);
			strip.receiveShadow = true;
			this.group.add(strip);
		}
		// Noord-zuid stroken (rijrichting langs z), tussen de hoeken in
		for (const sx of [-1, 1] as const) {
			const strip = new THREE.Mesh(nsGeo, nsMat);
			strip.rotation.y = Math.PI / 2;
			strip.position.set(sx * LANE_X, ROAD_Y, 0);
			strip.receiveShadow = true;
			this.group.add(strip);
		}
	}

	// ── zebrapaden ─────────────────────────────────────────

	/** Vier oversteekplaatsen op de middens, 6 balken per stuk, één InstancedMesh. */
	private buildZebras(): void {
		const BARS = 6;
		const barGeo = new THREE.PlaneGeometry(0.55, ROAD_W - 0.6);
		barGeo.rotateX(-Math.PI / 2);
		this.geometries.push(barGeo);
		const barMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.9 }));

		this.zebras = new THREE.InstancedMesh(barGeo, barMat, BARS * 4);
		const dummy = new THREE.Object3D();
		let idx = 0;
		// Balk-lange-as staat haaks op de rijrichting: bestuurder ziet een ladder.
		const crossings: { x: number; z: number; rotY: number }[] = [
			{ x: 0, z: -LANE_Z, rotY: 0 },
			{ x: 0, z: LANE_Z, rotY: 0 },
			{ x: -LANE_X, z: 0, rotY: Math.PI / 2 },
			{ x: LANE_X, z: 0, rotY: Math.PI / 2 },
		];
		for (const cr of crossings) {
			for (let i = 0; i < BARS; i++) {
				const off = (i - (BARS - 1) / 2) * 0.85;
				dummy.position.set(cr.x + (cr.rotY === 0 ? off : 0), ZEBRA_Y, cr.z + (cr.rotY === 0 ? 0 : off));
				dummy.rotation.set(0, cr.rotY, 0);
				dummy.updateMatrix();
				this.zebras.setMatrixAt(idx++, dummy.matrix);
			}
		}
		this.zebras.instanceMatrix.needsUpdate = true;
		this.group.add(this.zebras);
	}

	// ── stoplichten ────────────────────────────────────────

	private buildLampMaterials(): void {
		// Aan = MeshBasic zonder tone mapping (fel, gratis licht). Uit = dof
		// getint glas, zodat je nog ziet welk bolletje wat zou kunnen.
		this.redOn = this.track(new THREE.MeshBasicMaterial({ color: 0xff2418, toneMapped: false }));
		this.amberOn = this.track(new THREE.MeshBasicMaterial({ color: 0xffb300, toneMapped: false }));
		this.greenOn = this.track(new THREE.MeshBasicMaterial({ color: 0x22e05a, toneMapped: false }));
		this.redOff = this.track(new THREE.MeshStandardMaterial({ color: 0x3a1210, roughness: 0.4 }));
		this.amberOff = this.track(new THREE.MeshStandardMaterial({ color: 0x3a2c0c, roughness: 0.4 }));
		this.greenOff = this.track(new THREE.MeshStandardMaterial({ color: 0x0f2f18, roughness: 0.4 }));
	}

	/**
	 * Vier palen op de binnenhoeken. Elke paal bedient één richting:
	 * de (+,+)- en (−,−)-hoek zijn voor noord-zuid, de andere twee oost-west.
	 * Twee koppen per paal zou realistischer zijn; de gemeente had budget voor één.
	 */
	private buildTrafficLights(): void {
		const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x37404a, metalness: 0.6, roughness: 0.45 }));
		const housingMat = this.track(new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.7 }));
		const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8);
		this.geometries.push(poleGeo);
		const housingGeo = new THREE.BoxGeometry(0.5, 1.35, 0.3);
		this.geometries.push(housingGeo);
		const bulbGeo = new THREE.SphereGeometry(0.14, 10, 8);
		this.geometries.push(bulbGeo);

		for (const sx of [-1, 1] as const) {
			for (const sz of [-1, 1] as const) {
				const post = new THREE.Group();
				// Binnenhoek van de weg, op de denkbeeldige stoep
				post.position.set(sx * (INNER_X - 1.4), 0, sz * (INNER_Z - 1.4));

				const pole = new THREE.Mesh(poleGeo, poleMat);
				pole.position.y = 2.1;
				post.add(pole);

				const head = new THREE.Group();
				head.position.y = 4.4;
				// Kop kijkt diagonaal de kruising op — cosmetisch, geen CBR-examen
				head.rotation.y = Math.atan2(sx, sz);
				post.add(head);

				const housing = new THREE.Mesh(housingGeo, housingMat);
				head.add(housing);

				const dir: 'ns' | 'ew' = sx * sz > 0 ? 'ns' : 'ew';
				const bulb = (y: number, off: THREE.Material): THREE.Mesh => {
					const b = new THREE.Mesh(bulbGeo, off);
					b.position.set(0, y, 0.14);
					head.add(b);
					return b;
				};
				this.heads.push({
					dir,
					red: bulb(0.42, this.redOff),
					amber: bulb(0, this.amberOff),
					green: bulb(-0.42, this.greenOff),
				});

				this.group.add(post);
			}
		}
	}

	/** Zet per richting de juiste lampen aan — alleen bij een segmentwissel. */
	private applyLamps(): void {
		const ns: LampState = this.seg === 0 ? 'green' : this.seg === 1 ? 'amber' : 'red';
		const ew: LampState = this.seg === 3 ? 'green' : this.seg === 4 ? 'amber' : 'red';
		for (const h of this.heads) {
			const s = h.dir === 'ns' ? ns : ew;
			h.red.material = s === 'red' ? this.redOn : this.redOff;
			h.amber.material = s === 'amber' ? this.amberOn : this.amberOff;
			h.green.material = s === 'green' ? this.greenOn : this.greenOff;
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
