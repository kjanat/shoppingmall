import * as THREE from 'three';
import { lit } from '#/render/material';
import { LANE_X, LANE_Z } from '#/scene/city/CityRoads';
import { labelCanvas, labelTexture } from '#/util/label';
import { half } from '#/util/math';
import { at } from '#/util/rand';

/**
 * Ringweg-verkeer: veertien burgerauto's en zes taxi's die eeuwig met de klok
 * mee rondjes rijden om een mall waar ze nooit parkeren. Het pad volgt de
 * strookmiddellijnen van CityRoads.
 *
 * De stoplichten regelen technisch gezien een kruising die op een
 * eenrichtingsring niet bestaat — iedereen stopt er toch keurig voor.
 * Iedereen rijdt bovendien exact op de middenstreep; het rijexamen is in
 * deze stad optioneel.
 */

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

/** Carrosserie. De remafstand en de botsstraal hangen eraan, dus staat hij hier. */
const BODY_L = 4.2;
const BODY_W = 1.85;

/**
 * Hoe ver naast de strookmiddellijn een bestuurder je als obstakel ziet: wat de
 * auto veegt plus een schouder. Niet de hele wegbreedte — remmen zodra je de
 * goot aanraakt maakt een aanrijding onmogelijk, en op de berm hoor je veilig
 * te zijn.
 */
const ROAD_REACH = half(BODY_W) + 0.8;
/** Hoger dan dit en je staat op iets, niet op het asfalt. */
const ROAD_HEAD = 1.6;
/** Botsstraal rond het hart van de auto. */
const HIT_R = half(BODY_L) - 0.1;
/** Onder deze snelheid tikt hij je alleen aan. */
const HIT_V = 2.5;
/** Zo lang blijft één aanrijding staan, anders lanceert de colonne je vier keer. */
const HIT_COOLDOWN = 1.5;
/** Extra vaart bovenop die van de auto, en hoe hoog je gaat. */
const HIT_PUSH = 3;
const HIT_LIFT = 5.5;

/** Iets op de rijbaan waar de auto's rekening mee houden. Voeten, niet ogen. */
export type RoadObstacle = { x: number; y: number; z: number };

export class CityTraffic {
	readonly group = new THREE.Group();

	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private textures: THREE.Texture[] = [];

	private readonly getPhase: () => string;
	private getObstacle: (() => RoadObstacle | null) | null = null;
	private onHit: ((vx: number, vz: number, vy: number) => void) | null = null;
	private hitCooldown = 0;
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
		const bodyGeo = new THREE.BoxGeometry(BODY_L, 0.75, BODY_W);
		const cabinGeo = new THREE.BoxGeometry(2.1, 0.6, 1.6);
		const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
		wheelGeo.rotateX(Math.PI / 2); // as opzij, zoals wielen dat graag hebben
		const lampGeo = new THREE.SphereGeometry(0.09, 8, 6);
		const signGeo = new THREE.PlaneGeometry(1.0, 0.34);
		signGeo.rotateY(Math.PI / 2); // bordje kijkt in de rijrichting
		this.geometries.push(bodyGeo, cabinGeo, wheelGeo, lampGeo, signGeo);

		const glassMat = this.track(lit({ color: 0x1d262d, roughness: 0.25, metalness: 0.5 }));
		const wheelMat = this.track(lit({ color: 0x101114, roughness: 0.9 }));
		const lampMat = this.track(new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }));
		const taxiMat = this.track(lit({ color: 0xf2b705, roughness: 0.45, metalness: 0.25 }));
		const paint = [0xb0413e, 0x3e63a8, 0x4a4e57, 0xd8d3c8, 0x3f6f4f, 0x23262d, 0x9a7b4f].map((c) =>
			this.track(lit({ color: c, roughness: 0.5, metalness: 0.3 })),
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

	/** Wie er op de ringweg kan staan (de speler te voet). Geef `null` als hij binnen zit. */
	setObstacleProvider(fn: () => RoadObstacle | null): void {
		this.getObstacle = fn;
	}

	/** Wat er gebeurt als remmen niet meer helpt: een zet langs de rijrichting. */
	setHitHandler(fn: (vx: number, vz: number, vy: number) => void): void {
		this.onHit = fn;
	}

	update(dt: number, _t: number): void {
		const phase = this.getPhase();
		this.hitCooldown = Math.max(0, this.hitCooldown - dt);
		// Eén projectie per frame in plaats van één per auto: de ring verandert niet.
		const obstacle = this.getObstacle?.() ?? null;
		const obstacleS = obstacle === null ? null : this.ringDistance(obstacle);
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
			// Een voetganger op de rijstrook remt net zo hard als blik, maar telt
			// niet mee in de harde clamp hieronder: die zet de auto onvoorwaardelijk
			// stil en dan is aanrijden onmogelijk. Zo beslist de remweg het —
			// ruim op tijd gezien staat hij vóór je, te laat gezien niet.
			let sight = gap;
			if (obstacleS !== null) {
				let d = obstacleS - car.s;
				if (d <= 0) d += PERIM;
				if (d < sight) sight = d;
			}

			const k = this.edgeOf(car.s);
			const edge = at(EDGES, k);
			const distCorner = at(EDGE_END, k) - car.s;
			const blocked = phase !== edge.phase;

			// Remmen voor blik of voor rood, anders rustig terug naar kruissnelheid.
			const mustBrake = sight < GAP_BRAKE || (blocked && distCorner < LIGHT_SEE);
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

			// Wie te laat geremd heeft rijdt er gewoon doorheen; dan is het raak.
			if (obstacle === null || this.hitCooldown > 0 || car.v < HIT_V) return;
			const dx = obstacle.x - car.mesh.position.x;
			const dz = obstacle.z - car.mesh.position.z;
			if (dx * dx + dz * dz > HIT_R * HIT_R) return;
			this.hitCooldown = HIT_COOLDOWN;
			const push = car.v + HIT_PUSH;
			this.onHit?.(edge.dx * push, edge.dz * push, HIT_LIFT);
		});
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	// ── intern ─────────────────────────────────────────────

	/**
	 * Boogafstand van een punt dat op de ring staat, of null als het ernaast of
	 * erboven ligt. Bij de hoeken passen twee randen; de dichtstbijzijnde wint.
	 */
	private ringDistance(p: RoadObstacle): number | null {
		if (Math.abs(p.y) > ROAD_HEAD) return null;
		let best: number | null = null;
		let bestLat = ROAD_REACH;
		for (let k = 0; k < EDGES.length; k++) {
			const edge = at(EDGES, k);
			const u = (p.x - edge.ox) * edge.dx + (p.z - edge.oz) * edge.dz;
			if (u < 0 || u > edge.len) continue;
			const lat = Math.abs((p.x - edge.ox) * -edge.dz + (p.z - edge.oz) * edge.dx);
			if (lat >= bestLat) continue;
			bestLat = lat;
			best = at(EDGE_START, k) + u;
		}
		return best;
	}

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
