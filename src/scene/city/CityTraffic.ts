import * as THREE from 'three';
import { labelCanvas, labelTexture } from '@/util/label';
import { at } from '@/util/rand';

/**
 * Ringweg-verkeer: veertien burgerauto's en zes taxi's die eeuwig met de klok
 * mee rondjes rijden om een mall waar ze nooit parkeren. Het pad volgt de
 * strookmiddellijnen van CityRoads (|x| = 51.5, |z| = 37.5).
 *
 * De stoplichten regelen technisch gezien een kruising die op een
 * eenrichtingsring niet bestaat — iedereen stopt er toch keurig voor.
 * Iedereen rijdt bovendien exact op de middenstreep; het rijexamen is in
 * deze stad optioneel.
 */

// Zelfde maten als CityRoads. Niet geïmporteerd: het contract zegt 'three'
// en verder niets, dus de getallen staan hier nog een keer.
const LANE_X = 51.5;
const LANE_Z = 37.5;

type EdgePhase = 'ns' | 'ew';

type Edge = {
	readonly ox: number;
	readonly oz: number;
	readonly dx: number;
	readonly dz: number;
	readonly rotY: number;
	readonly len: number;
	/** Welke lichtfase deze rand groen geeft — 'ns' is voor de noord/zuid-randen. */
	readonly phase: EdgePhase;
};

// Vier randen, met de klok mee (van boven bekeken, +x rechts, +z onder).
// Neus van de auto wijst langs +x bij rotY 0; rotY draait 'm de rand op.
const EDGES: readonly Edge[] = [
	// noordrand: west → oost
	{ ox: -LANE_X, oz: -LANE_Z, dx: 1, dz: 0, rotY: 0, len: 2 * LANE_X, phase: 'ns' },
	// oostrand: noord → zuid
	{ ox: LANE_X, oz: -LANE_Z, dx: 0, dz: 1, rotY: -Math.PI / 2, len: 2 * LANE_Z, phase: 'ew' },
	// zuidrand: oost → west
	{ ox: LANE_X, oz: LANE_Z, dx: -1, dz: 0, rotY: Math.PI, len: 2 * LANE_X, phase: 'ns' },
	// westrand: zuid → noord
	{ ox: -LANE_X, oz: LANE_Z, dx: 0, dz: -1, rotY: Math.PI / 2, len: 2 * LANE_Z, phase: 'ew' },
];

// Cumulatieve boogafstanden, voorgekauwd zodat update() alleen vergelijkt.
const EDGE_START: number[] = [];
const EDGE_END: number[] = [];
{
	let acc = 0;
	for (const e of EDGES) {
		EDGE_START.push(acc);
		acc += e.len;
		EDGE_END.push(acc);
	}
}
/** Omtrek van de ring: 2·103 + 2·75 = 356 m. */
const PERIM = at(EDGE_END, EDGE_END.length - 1);

const N_CARS = 14;
const N_TAXIS = 6;
const N = N_CARS + N_TAXIS;
/** Welke slots taxi zijn — verspreid, anders lijkt het een taxistandplaats. */
const TAXI_SLOT = new Set([1, 4, 8, 11, 14, 18]);

const GAP_BRAKE = 6; // rem als de voorligger dichterbij is (hart-op-hart)
const GAP_HOLD = 4.6; // absolute ondergrens, anders schuiven ze in elkaar
const STOP_GAP = 3.2; // stopstreep: zoveel meter vóór de hoek wachten
const LIGHT_SEE = 15; // vanaf hier "ziet" de bestuurder het rode licht
const BRAKE = 9; // m/s² — stevig, maar niemand morst koffie
const ACCEL = 4; // m/s² — optrekken alsof de benzine gratis is

export class CityTraffic {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];

	private readonly getPhase: () => string;
	/**
	 * Eén record per auto in plaats van vier arrays op dezelfde index — die
	 * konden uit de pas lopen en dwongen bij elke lookup een bounds-check af.
	 */
	private readonly cars: {
		mesh: THREE.Group;
		/** Boogafstand op de ring. */
		s: number;
		/** Huidige snelheid. */
		v: number;
		/** Kruissnelheid — ieder z'n eigen haast, 6..11 m/s. */
		vmax: number;
	}[] = [];

	constructor(getPhase: () => string) {
		this.getPhase = getPhase;
		this.group.name = 'city_traffic';

		// ── gedeelde onderdelen: één setje geometrie voor het hele wagenpark ──
		const bodyGeo = new THREE.BoxGeometry(4.2, 0.75, 1.85);
		const cabinGeo = new THREE.BoxGeometry(2.1, 0.6, 1.6);
		const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
		wheelGeo.rotateX(Math.PI / 2); // as opzij, zoals wielen dat graag hebben
		const lampGeo = new THREE.SphereGeometry(0.09, 8, 6);
		const signGeo = new THREE.PlaneGeometry(1.0, 0.34);
		signGeo.rotateY(Math.PI / 2); // bordje kijkt in de rijrichting
		this.geometries.push(bodyGeo, cabinGeo, wheelGeo, lampGeo, signGeo);

		const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1d262d, roughness: 0.25, metalness: 0.5 }));
		const wheelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 }));
		const lampMat = this.track(new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }));
		const taxiMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.45, metalness: 0.25 }));
		const paint = [0xb0413e, 0x3e63a8, 0x4a4e57, 0xd8d3c8, 0x3f6f4f, 0x23262d, 0x9a7b4f].map((c) =>
			this.track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.3 })),
		);
		const signMat = this.makeTaxiSignMaterial();

		// ── het wagenpark: 20 groups, ieder een eigen plek op de ring ──
		for (let i = 0; i < N; i++) {
			const taxi = TAXI_SLOT.has(i);
			const car = new THREE.Group();

			const body = new THREE.Mesh(bodyGeo, taxi ? taxiMat : paint[i % paint.length]);
			body.position.y = 0.73;
			car.add(body);

			const cabin = new THREE.Mesh(cabinGeo, glassMat);
			cabin.position.set(-0.3, 1.32, 0);
			car.add(cabin);

			for (const wx of [-1.4, 1.4]) {
				for (const wz of [-0.95, 0.95]) {
					const wheel = new THREE.Mesh(wheelGeo, wheelMat);
					wheel.position.set(wx, 0.38, wz);
					car.add(wheel);
				}
			}

			// Koplampen: twee emissive dots, dag en nacht aan. Zuinig is anders.
			for (const lz of [-0.6, 0.6]) {
				const lamp = new THREE.Mesh(lampGeo, lampMat);
				lamp.position.set(2.12, 0.73, lz);
				car.add(lamp);
			}

			if (taxi) {
				const sign = new THREE.Mesh(signGeo, signMat);
				sign.position.set(-0.3, 1.8, 0);
				car.add(sign);
			}

			this.group.add(car);

			// Netjes uitgesmeerd over de omtrek, met wat jitter tegen het kadaver-
			// gevoel van een perfecte colonne.
			const cruise = 6 + Math.random() * 5;
			this.cars.push({
				mesh: car,
				s: ((i + 0.4 * Math.random()) / N) * PERIM,
				v: cruise,
				vmax: cruise,
			});
			this.place(i);
		}
	}

	update(dt: number, _t: number): void {
		const phase = this.getPhase();
		this.cars.forEach((car, i) => {
			// Voorligger zoeken: kleinste positieve afstand vooruit op de ring.
			// O(n²) over 20 auto's — de Pi haalt z'n schouders op.
			let gap = PERIM;
			for (const other of this.cars) {
				if (other === car) continue;
				let d = other.s - car.s;
				if (d <= 0) d += PERIM;
				if (d < gap) gap = d;
			}

			const k = this.edgeOf(car.s);
			const edge = at(EDGES, k);
			const distCorner = at(EDGE_END, k) - car.s;
			const blocked = phase !== edge.phase;

			// Remmen voor blik of voor rood, anders rustig terug naar kruissnelheid.
			const mustBrake = gap < GAP_BRAKE || (blocked && distCorner < LIGHT_SEE);
			car.v = mustBrake ? Math.max(0, car.v - BRAKE * dt) : Math.min(car.vmax, car.v + ACCEL * dt);

			// Harde clampen: nooit door de voorligger heen, nooit de hoek op bij rood.
			let move = car.v * dt;
			const room = gap - GAP_HOLD;
			if (move > room) move = Math.max(0, room);
			if (blocked) {
				const line = distCorner - STOP_GAP;
				if (move > line) move = Math.max(0, line);
			}

			car.s = (car.s + move) % PERIM;
			this.place(i);
		});
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	// ── intern ─────────────────────────────────────────────

	/** Op welke rand boogafstand s ligt. Vier vergelijkingen, geen wiskunde. */
	private edgeOf(s: number): number {
		let k = 0;
		while (k < EDGES.length - 1 && s >= at(EDGE_END, k)) k++;
		return k;
	}

	/** Zet auto i op z'n boogafstand, neus in de rijrichting. Geen allocaties. */
	private place(i: number): void {
		const car = this.cars[i];
		if (!car) return;
		const k = this.edgeOf(car.s);
		const edge = at(EDGES, k);
		const u = car.s - at(EDGE_START, k);
		car.mesh.position.set(edge.ox + edge.dx * u, 0, edge.oz + edge.dz * u);
		car.mesh.rotation.y = edge.rotY;
	}

	/** Geel bordje met TAXI erop. Van achteren staat er IXAT — heel authentiek. */
	private makeTaxiSignMaterial(): THREE.MeshBasicMaterial {
		const { canvas: c, ctx } = labelCanvas(128, 44);
		ctx.fillStyle = '#f7c500';
		ctx.fillRect(0, 0, 128, 44);
		ctx.strokeStyle = '#111';
		ctx.lineWidth = 4;
		ctx.strokeRect(2, 2, 124, 40);
		ctx.fillStyle = '#111';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('TAXI', 64, 24);
		const tex = labelTexture(c);
		this.textures.push(tex);
		return this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
