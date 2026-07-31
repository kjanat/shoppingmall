import { at } from '@/util/rand';
import * as THREE from 'three';

/**
 * Lucht boven de 404-stad: twaalf wolkenclusters die gedwee met de wind mee
 * naar +x driften, plus een onweersfront dat om de paar minuten langskomt om
 * te bewijzen dat het dak van de mall niet lekt.
 *
 * Geen echte lights (Pi!): de bliksem is een fel emissive zigzagje en de
 * "flits" is heel even de emissive van de wolken zelf. Goedkoper dan Zeus,
 * en hij komt nog op tijd ook.
 */

// ── wereldmaten ──────────────────────────────────────────
const WERELD_X = 95;
const WERELD_Z = 75;
/** Mall-voetafdruk + marge: hierbinnen geen regen of inslagen — binnen is het droog. */
const MALL_X = 44;
const MALL_Z = 30;

// ── wolken ───────────────────────────────────────────────
const N_CLUSTERS = 12;
const PUFFS = 3;
const KLEUR_HELDER = new THREE.Color(0xf4f6f8);
const KLEUR_STORM = new THREE.Color(0x3d434c);

// ── regen ────────────────────────────────────────────────
const N_DRUPPELS = 700;
/** Vanaf hier vallen de druppels; onder y=0 mogen ze opnieuw solliciteren. */
const REGEN_TOP = 38;

// ── bliksem ──────────────────────────────────────────────
/** Poolgrootte: vier voorgebakken zigzags, om de beurt van stal gehaald. */
const N_BOLTS = 4;
const BOLT_TOP = 40;
const BOLT_ZICHT = 0.1;

export class CitySky {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];

	private readonly clusters: THREE.Group[] = [];
	/** Driftsnelheid per cluster — ieder wolkje z'n eigen tempo. */
	private readonly drift: number[] = [];
	private readonly basisY: number[] = [];
	private readonly cloudMat: THREE.MeshStandardMaterial;

	private readonly regen: THREE.Points;
	private readonly regenMat: THREE.PointsMaterial;
	private readonly regenAttr: THREE.BufferAttribute;
	private readonly regenPos: Float32Array;
	private readonly valsnelheid: Float32Array;

	private readonly bolts: THREE.Group[] = [];
	private boltIndex = 0;
	private boltTimer = 0;

	// ── state-machine: helder 30..55 s → storm 12..16 s → herhaal ──
	private state: 'helder' | 'storm' = 'helder';
	private stateTimer = 30 + Math.random() * 25;
	/** 0 = mooi weer, 1 = volle bak somber. Lerpt er rustig tussenin. */
	private stormMix = 0;
	private flits = 0;
	private boltsTeGaan = 0;
	private volgendeBolt = 0;

	constructor() {
		this.group.name = 'city_sky';

		// ── wolken: 12 clusters × 3 puffs, allemaal dezelfde platte bol ──
		const puffGeo = new THREE.SphereGeometry(1, 10, 7);
		this.geometries.push(puffGeo);
		this.cloudMat = this.track(
			new THREE.MeshStandardMaterial({
				color: KLEUR_HELDER,
				emissive: 0xbcd0ff,
				emissiveIntensity: 0,
				transparent: true,
				opacity: 0.55,
				roughness: 1,
				depthWrite: false,
			}),
		);
		for (let i = 0; i < N_CLUSTERS; i++) {
			const cluster = new THREE.Group();
			for (let j = 0; j < PUFFS; j++) {
				const puff = new THREE.Mesh(puffGeo, this.cloudMat);
				const s = 3.2 + Math.random() * 2.6;
				puff.scale.set(
					s * (0.8 + Math.random() * 0.5),
					s * 0.42, // plat, zoals een wolk met ambitie maar zonder budget
					s * (0.8 + Math.random() * 0.5),
				);
				puff.position.set(
					(j - 1) * (2.6 + Math.random() * 1.6),
					(Math.random() - 0.5) * 1.4,
					(Math.random() - 0.5) * 3,
				);
				cluster.add(puff);
			}
			const y = 40 + Math.random() * 18;
			this.basisY.push(y);
			cluster.position.set((Math.random() * 2 - 1) * WERELD_X, y, (Math.random() * 2 - 1) * WERELD_Z);
			this.drift.push(0.6 + Math.random() * 0.9);
			this.clusters.push(cluster);
			this.group.add(cluster);
		}

		// ── regen: één Points, 700 druppels, posities in een platte array ──
		this.regenPos = new Float32Array(N_DRUPPELS * 3);
		this.valsnelheid = new Float32Array(N_DRUPPELS);
		for (let i = 0; i < N_DRUPPELS; i++) {
			let x = 0;
			let z = 0;
			// Buiten de mall blijven prikken — regen in de foodcourt is slecht voor de omzet.
			do {
				x = (Math.random() * 2 - 1) * (WERELD_X - 4);
				z = (Math.random() * 2 - 1) * (WERELD_Z - 4);
			} while (Math.abs(x) < MALL_X && Math.abs(z) < MALL_Z);
			this.regenPos[i * 3] = x;
			this.regenPos[i * 3 + 1] = Math.random() * REGEN_TOP;
			this.regenPos[i * 3 + 2] = z;
			this.valsnelheid[i] = 16 + Math.random() * 10;
		}
		const regenGeo = new THREE.BufferGeometry();
		this.regenAttr = new THREE.BufferAttribute(this.regenPos, 3);
		this.regenAttr.setUsage(THREE.DynamicDrawUsage);
		regenGeo.setAttribute('position', this.regenAttr);
		// Vaste boundingSphere, anders gaat three per frame zitten rekenen.
		regenGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, REGEN_TOP / 2, 0), 150);
		this.geometries.push(regenGeo);
		this.regenMat = this.track(
			new THREE.PointsMaterial({
				color: 0x8fa6ba,
				size: 0.28,
				transparent: true,
				opacity: 0,
				depthWrite: false,
			}),
		);
		this.regen = new THREE.Points(regenGeo, this.regenMat);
		this.regen.visible = false;
		this.group.add(this.regen);

		// ── bliksempool: dun cilindertje, vier keer anders gekarteld ──
		const segGeo = new THREE.CylinderGeometry(0.09, 0.16, 1, 5);
		this.geometries.push(segGeo);
		const boltMat = this.track(new THREE.MeshBasicMaterial({ color: 0xf8fbff, toneMapped: false }));
		for (let i = 0; i < N_BOLTS; i++) {
			const bolt = this.buildBolt(segGeo, boltMat);
			this.bolts.push(bolt);
			this.group.add(bolt);
		}
	}

	/** Staat het te onweren? Voor wie donder wil afspelen of de was binnenhalen. */
	get storming(): boolean {
		return this.state === 'storm';
	}

	update(dt: number, t: number): void {
		// ── wolken driften naar +x; voorbij de rand → achteraan aansluiten ──
		this.clusters.forEach((c, i) => {
			c.position.x += at(this.drift, i) * dt;
			if (c.position.x > WERELD_X) c.position.x = -WERELD_X;
			c.position.y = at(this.basisY, i) + Math.sin(t * 0.12 + i * 1.7) * 0.6;
		});

		// ── state-machine ──
		this.stateTimer -= dt;
		if (this.state === 'helder') {
			if (this.stateTimer <= 0) {
				this.state = 'storm';
				this.stateTimer = 12 + Math.random() * 4;
				this.boltsTeGaan = 2 + Math.floor(Math.random() * 3); // 2..4 klappen
				this.volgendeBolt = 1 + Math.random() * 2;
			}
		} else {
			this.volgendeBolt -= dt;
			if (this.boltsTeGaan > 0 && this.volgendeBolt <= 0) this.inslag();
			if (this.stateTimer <= 0) {
				this.state = 'helder';
				this.stateTimer = 30 + Math.random() * 25;
			}
		}

		// ── overgang: wolken kleuren mee, in ~2.5 s van wit naar chagrijnig ──
		const doel = this.state === 'storm' ? 1 : 0;
		const stap = dt / 2.5;
		this.stormMix = doel > this.stormMix ? Math.min(doel, this.stormMix + stap) : Math.max(doel, this.stormMix - stap);
		this.cloudMat.color.lerpColors(KLEUR_HELDER, KLEUR_STORM, this.stormMix);
		this.cloudMat.opacity = 0.55 + 0.25 * this.stormMix;

		// Flits dooft snel — donder is andermans afdeling.
		this.flits = Math.max(0, this.flits - dt * 9);
		this.cloudMat.emissiveIntensity = this.flits;

		// Bolt maar heel even tonen; langer en het wordt een lantaarnpaal.
		if (this.boltTimer > 0) {
			this.boltTimer -= dt;
			if (this.boltTimer <= 0) at(this.bolts, this.boltIndex).visible = false;
		}

		// ── regen: vallen, en onder de grond weer bovenaan invoegen ──
		const zichtbaar = this.stormMix > 0.03;
		this.regen.visible = zichtbaar;
		if (zichtbaar) {
			this.regenMat.opacity = 0.55 * this.stormMix;
			const p = this.regenPos;
			for (let i = 0; i < N_DRUPPELS; i++) {
				let y = (p[i * 3 + 1] ?? 0) - at(this.valsnelheid, i) * dt;
				if (y < 0) y += REGEN_TOP;
				p[i * 3 + 1] = y;
			}
			this.regenAttr.needsUpdate = true;
		}
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
	}

	// ── intern ─────────────────────────────────────────────

	/** Volgende bolt uit de pool op een willekeurige plek boven de stad zetten. */
	private inslag(): void {
		this.boltIndex = (this.boltIndex + 1) % N_BOLTS;
		const bolt = at(this.bolts, this.boltIndex);
		let x = 0;
		let z = 0;
		do {
			x = (Math.random() * 2 - 1) * (WERELD_X - 8);
			z = (Math.random() * 2 - 1) * (WERELD_Z - 8);
		} while (Math.abs(x) < MALL_X && Math.abs(z) < MALL_Z);
		bolt.position.set(x, BOLT_TOP, z);
		bolt.rotation.y = Math.random() * Math.PI * 2; // zelfde zigzag, andere kant op
		bolt.visible = true;
		this.boltTimer = BOLT_ZICHT;
		this.flits = 1.6;
		this.boltsTeGaan--;
		// Rest van de klappen uitsmeren over wat er nog aan storm over is.
		this.volgendeBolt = (this.stateTimer / (this.boltsTeGaan + 1)) * (0.5 + Math.random() * 0.9);
	}

	/**
	 * Gekartelde bolt: 5-6 dunne segmenten die van wolkhoogte naar de grond
	 * zigzaggen. Constructor-tijd, dus hier mag gewoon gealloceerd worden.
	 */
	private buildBolt(segGeo: THREE.BufferGeometry, mat: THREE.Material): THREE.Group {
		const g = new THREE.Group();
		const segs = 5 + Math.floor(Math.random() * 2);
		const stapY = BOLT_TOP / segs;
		const punt = new THREE.Vector3(0, 0, 0);
		const richting = new THREE.Vector3();
		const omhoog = new THREE.Vector3(0, 1, 0);
		for (let i = 0; i < segs; i++) {
			const dx = (i % 2 === 0 ? 1 : -1) * (0.9 + Math.random() * 1.6);
			const dz = (Math.random() * 2 - 1) * 1.2;
			richting.set(dx, -stapY, dz);
			const len = richting.length();
			const seg = new THREE.Mesh(segGeo, mat);
			seg.position.copy(punt).addScaledVector(richting, 0.5);
			seg.quaternion.setFromUnitVectors(omhoog, richting.normalize());
			seg.scale.y = len; // unit-cilinder → segmentlengte
			g.add(seg);
			punt.addScaledVector(richting, len);
		}
		g.visible = false;
		return g;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
