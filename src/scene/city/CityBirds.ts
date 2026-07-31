import * as THREE from 'three';

/**
 * Veertien vogels boven mall en stad (y 18..34). Elke vogel is twee
 * driehoekige vleugelplanes (gedeelde geometry + silhouet-materiaal) die
 * flapperen en in trage cirkels of achten om een eigen middelpunt zweven.
 * Ze doen niks, willen niks, verkopen niks — het dichtst bij rust dat deze
 * mall ooit gaat komen. Beste uitzicht: vanaf de helipad, koffie erbij.
 */

const N_VOGELS = 14;
/** De eerste zoveel vogels cirkelen boven de mall zelf; de rest boven de stad. */
const N_BOVEN_MALL = 5;
const WERELD_X = 95;
const WERELD_Z = 75;
const TWEE_PI = Math.PI * 2;

export class CityBirds {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];

	private readonly vogels: THREE.Group[] = [];
	private readonly vleugelsL: THREE.Mesh[] = [];
	private readonly vleugelsR: THREE.Mesh[] = [];

	// Per-vogel vluchtplan, allemaal voorgebakken — update() alloceert niks.
	private readonly cx = new Float32Array(N_VOGELS);
	private readonly cy = new Float32Array(N_VOGELS);
	private readonly cz = new Float32Array(N_VOGELS);
	private readonly straal = new Float32Array(N_VOGELS);
	/** Huidige hoek op het rondje/achtje. */
	private readonly hoek = new Float32Array(N_VOGELS);
	/** Hoeksnelheid in rad/s; het teken bepaalt de draairichting. */
	private readonly omega = new Float32Array(N_VOGELS);
	private readonly flapFreq = new Float32Array(N_VOGELS);
	private readonly flapFase = new Float32Array(N_VOGELS);
	private readonly bobAmp = new Float32Array(N_VOGELS);
	private readonly bobFreq = new Float32Array(N_VOGELS);
	private readonly bankFreq = new Float32Array(N_VOGELS);
	private readonly bankFase = new Float32Array(N_VOGELS);
	/** true = figuur-acht, false = gewoon rondjes. Vogels met ambitie doen de acht. */
	private readonly achtje: boolean[] = [];

	constructor() {
		this.group.name = 'city_birds';

		// Eén driehoekje voor alle 28 vleugels: scharnier op x=0 langs de z-as,
		// punt naar +x. De linkervleugel is dezelfde geometry met scale.x = -1 —
		// spiegelen is gratis, een tweede geometry niet.
		const vleugelGeo = new THREE.BufferGeometry();
		vleugelGeo.setAttribute(
			'position',
			new THREE.BufferAttribute(
				new Float32Array([0, 0, -0.28, 0, 0, 0.34, 1.0, 0, -0.02]),
				3,
			),
		);
		this.geometries.push(vleugelGeo);
		const silhouet = this.track(
			new THREE.MeshBasicMaterial({ color: 0x151a1f, side: THREE.DoubleSide }),
		);

		for (let i = 0; i < N_VOGELS; i++) {
			const straal = 6 + Math.random() * 8;
			this.straal[i] = straal;

			if (i < N_BOVEN_MALL) {
				// Boven de mall: het dak (y 13.95) is hun foodcourt-uitzicht.
				this.cx[i] = (Math.random() * 2 - 1) * 28;
				this.cz[i] = (Math.random() * 2 - 1) * 16;
			} else if (i % 2 === 0) {
				// Oost/west boven de stad.
				this.cx[i] = (Math.random() < 0.5 ? -1 : 1) * (52 + Math.random() * 26);
				this.cz[i] = (Math.random() * 2 - 1) * 55;
			} else {
				// Noord/zuid boven de stad.
				this.cx[i] = (Math.random() * 2 - 1) * 68;
				this.cz[i] = (Math.random() < 0.5 ? -1 : 1) * (36 + Math.random() * 22);
			}
			// Middelpunt + straal binnen de wereldgrens houden — vogels die de
			// skybox rammen zijn slecht voor de sfeer.
			const maxX = WERELD_X - straal - 2;
			const maxZ = WERELD_Z - straal - 2;
			this.cx[i] = THREE.MathUtils.clamp(this.cx[i], -maxX, maxX);
			this.cz[i] = THREE.MathUtils.clamp(this.cz[i], -maxZ, maxZ);
			this.cy[i] = 19 + Math.random() * 13;

			this.hoek[i] = Math.random() * TWEE_PI;
			this.omega[i] = (0.1 + Math.random() * 0.14) * (Math.random() < 0.5 ? -1 : 1);
			this.flapFreq[i] = 4 + Math.random() * 3;
			this.flapFase[i] = Math.random() * TWEE_PI;
			this.bobAmp[i] = 0.4 + Math.random() * 0.5;
			this.bobFreq[i] = 0.25 + Math.random() * 0.3;
			this.bankFreq[i] = 0.15 + Math.random() * 0.2;
			this.bankFase[i] = Math.random() * TWEE_PI;
			this.achtje.push(Math.random() < 0.45);

			const vogel = new THREE.Group();
			const rechts = new THREE.Mesh(vleugelGeo, silhouet);
			rechts.position.x = 0.05;
			const links = new THREE.Mesh(vleugelGeo, silhouet);
			links.position.x = -0.05;
			links.scale.x = -1;
			// Piepkleine mesh + grote vliegcirkel: culling zou per frame gaan
			// twijfelen, dus gewoon altijd tekenen. Het zijn er maar 28.
			rechts.frustumCulled = false;
			links.frustumCulled = false;
			vogel.add(rechts, links);
			vogel.scale.setScalar(0.85 + Math.random() * 0.5);
			this.vogels.push(vogel);
			this.vleugelsR.push(rechts);
			this.vleugelsL.push(links);
			this.group.add(vogel);
		}
	}

	update(dt: number, t: number): void {
		for (let i = 0; i < N_VOGELS; i++) {
			// ── vluchtpad: hoek doorschuiven, netjes binnen ±2π houden ──
			let th = this.hoek[i] + this.omega[i] * dt;
			if (th > TWEE_PI) th -= TWEE_PI;
			else if (th < -TWEE_PI) th += TWEE_PI;
			this.hoek[i] = th;

			const r = this.straal[i];
			const w = this.omega[i];
			let px = 0;
			let pz = 0;
			let vx = 0;
			let vz = 0;
			if (this.achtje[i]) {
				// Gerono-achtje: x = R·sinθ, z = R·sinθ·cosθ. Raaklijn analytisch,
				// dan hoeft niemand te differentiëren onder werktijd.
				const s = Math.sin(th);
				const c = Math.cos(th);
				px = r * s;
				pz = r * s * c;
				vx = c;
				vz = Math.cos(2 * th);
			} else {
				px = r * Math.cos(th);
				pz = r * Math.sin(th);
				vx = -Math.sin(th);
				vz = Math.cos(th);
			}

			const vogel = this.vogels[i];
			vogel.position.set(
				this.cx[i] + px,
				this.cy[i] + Math.sin(t * this.bobFreq[i] + i * 1.9) * this.bobAmp[i],
				this.cz[i] + pz,
			);
			// Neus in de vliegrichting (lokaal -z voorwaarts); ω's teken keert
			// de snelheid mee om, dus die vermenigvuldigen we er gewoon in.
			vogel.rotation.y = Math.atan2(-vx * w, -vz * w);
			// Af en toe zachtjes bankieren: beetje de bocht in hangen plus een
			// trage sinus, alsof ze ergens over nadenken.
			vogel.rotation.z = (w > 0 ? 0.1 : -0.1) + Math.sin(t * this.bankFreq[i] + this.bankFase[i]) * 0.16;

			// ── flapperen: rechts omhoog, links spiegelbeeldig mee ──
			const flap = Math.sin(t * this.flapFreq[i] + this.flapFase[i]) * 0.55 + 0.12;
			this.vleugelsR[i].rotation.z = flap;
			this.vleugelsL[i].rotation.z = -flap;
		}
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
