import * as THREE from 'three';
import { lit } from '#/render/material';
import type { RoadRing, RoutePoint } from '#/scene/city/cityPlan';
import { EXIT_APRON_TOP_Y, EXIT_BOOM, EXIT_BRANCH_ROUTE, LANE_OFFSET, ROAD_RINGS, TRAFFIC_CAR } from '#/scene/city/cityPlan';
import { labelCanvas, labelTexture } from '#/util/label';
import { clamp, half, inverseLerpClamped, lerp } from '#/util/math';
import { at } from '#/util/rand';

/**
 * Ringweg-verkeer: veertien burgerauto's en zes taxi's die eeuwig om een mall
 * rijden waar ze nooit parkeren.
 *
 * Tweerichtingsverkeer over twee rijstroken. Iedereen houdt rechts, en op een
 * ring betekent dat: met de klok mee rijd je aan de binnenkant van de rijbaan,
 * ertegenin aan de buitenkant. Elke richting is dus een eigen rechthoek naast
 * de middellijn van de rijbaan, met een eigen omtrek, en volgt en remt alleen
 * voor zijn eigen strook. De rechthoeken zelf staan in de stadsplattegrond,
 * waar de wereldcontrole ze naleest.
 *
 * De stoplichten regelen technisch gezien een kruising die op een ring niet
 * bestaat — beide richtingen stoppen er toch keurig voor.
 */

/** De twee rijstroken uit de stadsplattegrond: binnenste met de klok mee, buitenste ertegenin. */
const RINGS: readonly RoadRing[] = ROAD_RINGS;

const N_CARS = 14;
const N_TAXIS = 6;
const N = N_CARS + N_TAXIS;
/** Om en om over de twee richtingen, zodat het beide kanten op even druk is. */
const PER_RING = N / RINGS.length;
/** Welke slots taxi zijn — verspreid, anders lijkt het een taxistandplaats. */
const TAXI_SLOT = new Set([1, 4, 8, 11, 14, 18]);

const GAP_BRAKE = 6; // rem als de voorligger dichterbij is (hart-op-hart)
const GAP_HOLD = 4.6; // absolute ondergrens, anders schuiven ze in elkaar
const STOP_GAP = 3.2; // stopstreep: zoveel meter vóór de hoek wachten
const LIGHT_SEE = 15; // vanaf hier "ziet" de bestuurder het rode licht
const BRAKE = 9; // m/s² — stevig, maar niemand morst koffie
const ACCEL = 4; // m/s² — optrekken alsof de benzine gratis is

/** Carrosserie. De remafstand, de botsstraal en de breedte van een rijstrook hangen eraan. */
const BODY_L = TRAFFIC_CAR.length;
const BODY_W = TRAFFIC_CAR.width;

/**
 * Hoe ver naast zijn éigen strookhart een bestuurder je als obstakel ziet: de
 * halve rijstrook plus een schouder. LANE_OFFSET ís die halve strook, dus de
 * twee stroken samen dekken de hele rijbaan en er blijft nergens een reepje
 * asfalt over waar niemand voor remt. De schouder houdt het bereik bovendien
 * ruimer dan HIT_R hieronder: alles wat geraakt kan worden, wordt gezien.
 */
const LANE_SHOULDER = 0.4;
const ROAD_REACH = LANE_OFFSET + LANE_SHOULDER;
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

/**
 * Boogafstand van een punt dat op deze strook staat, of null als het ernaast of
 * erboven ligt. Bij de hoeken passen twee randen; de dichtstbijzijnde wint.
 */
function ringDistance(ring: RoadRing, p: RoadObstacle): number | null {
	if (Math.abs(p.y) > ROAD_HEAD) return null;
	let best: number | null = null;
	let bestLat = ROAD_REACH;
	for (let k = 0; k < ring.edges.length; k++) {
		const edge = at(ring.edges, k);
		const u = (p.x - edge.ox) * edge.dx + (p.z - edge.oz) * edge.dz;
		if (u < 0 || u > edge.len) continue;
		const lat = Math.abs((p.x - edge.ox) * -edge.dz + (p.z - edge.oz) * edge.dx);
		if (lat >= bestLat) continue;
		bestLat = lat;
		best = at(ring.starts, k) + u;
	}
	return best;
}

/** Hoe ver `target` vooruit ligt vanaf `from`, één keer rond. Niets vooruit is de hele omtrek. */
function ahead(target: number | null, from: number, perim: number): number {
	if (target === null) return perim;
	const d = target - from;
	return d <= 0 ? d + perim : d;
}

/** Op welke rand boogafstand s ligt. Vier vergelijkingen, geen wiskunde. */
function edgeOf(ring: RoadRing, s: number): number {
	let k = 0;
	while (k < ring.edges.length - 1 && s >= at(ring.ends, k)) k++;
	return k;
}

// ── de aftakking naar P1 ───────────────────────────────────

/** Hoeveel seconden er minstens tussen twee inritten zit. Eén auto tegelijk in de geul. */
const BRANCH_EVERY = 26;
/** Zo lang staat hij beneden geparkeerd voor hij omdraait. */
const BRANCH_PARK = 6;
/** Op een helling in een garage rijdt niemand zijn kruissnelheid van de ringweg. */
const BRANCH_VMAX = 4;
/** Vanaf hier ziet de slagboom hem aankomen. */
const BOOM_SEE = 10;
/** Speling tussen de neus van de wachtende auto en de arm. */
const BOOM_GAP = 0.4;
/** Hoe snel de arm van dicht naar open gaat, in standen per seconde. */
const BOOM_SPEED = 0.8;
/** Onder deze stand hangt de arm nog in de doorgang. */
const BOOM_CLEAR = 0.9;

/** Eén recht stuk van de aftakking, met zijn boogafstand, koers en helling voorgekauwd. */
type BranchLeg = Readonly<{
	from: RoutePoint;
	to: RoutePoint;
	len: number;
	start: number;
	rotY: number;
	/** Positief loopt het stuk omhoog; de auto kantelt er even ver in mee. */
	pitch: number;
}>;

function branchLegs(route: readonly RoutePoint[]): BranchLeg[] {
	const legs: BranchLeg[] = [];
	let acc = 0;
	for (let i = 0; i + 1 < route.length; i++) {
		const from = at(route, i);
		const to = at(route, i + 1);
		const run = Math.hypot(to.x - from.x, to.z - from.z);
		const rise = to.y - from.y;
		const len = Math.hypot(run, rise);
		legs.push({ from, to, len, start: acc, rotY: Math.atan2(-(to.z - from.z), to.x - from.x), pitch: Math.atan2(rise, run) });
		acc += len;
	}
	return legs;
}

const BRANCH_LEGS: readonly BranchLeg[] = branchLegs(EXIT_BRANCH_ROUTE);
const BRANCH_LENGTH = BRANCH_LEGS.reduce((sum, leg) => sum + leg.len, 0);

/** Het stuk waar boogafstand s op ligt. */
function branchLegAt(s: number): BranchLeg {
	for (let k = BRANCH_LEGS.length - 1; k > 0; k--) {
		const leg = at(BRANCH_LEGS, k);
		if (s >= leg.start) return leg;
	}
	return at(BRANCH_LEGS, 0);
}

/** Boogafstand van een x op de heenweg. De terugweg komt er niet aan te pas: die ligt verderop. */
function branchArcAtX(x: number): number {
	for (const leg of BRANCH_LEGS) {
		if (x < Math.min(leg.from.x, leg.to.x) || x > Math.max(leg.from.x, leg.to.x)) continue;
		return leg.start + leg.len * inverseLerpClamped(leg.from.x, leg.to.x, x);
	}
	return 0;
}

/** Waar de auto beneden stilstaat: het knikpunt dat zichzelf als parkeerplek opgeeft. */
const BRANCH_PARK_S = BRANCH_LEGS.find((leg) => leg.from.park === true)?.start ?? 0;
const BOOM_S = branchArcAtX(EXIT_BOOM.x);
/** Waar hij voor een dichte boom stilstaat: met zijn neus vlak voor de arm. */
const BOOM_STOP_S = BOOM_S - half(BODY_L) - BOOM_GAP;

/** De aftakking hangt aan de binnenste strook: die passeert de mond in de goede richting. */
const BRANCH_RING = 0;

function branchHook(point: RoutePoint | undefined): number | null {
	return point === undefined ? null : ringDistance(at(RINGS, BRANCH_RING), point);
}

/** Waar hij de ring verlaat en waar hij er weer op komt. Null als de route er niet op aansluit. */
const BRANCH_ENTER_S = branchHook(EXIT_BRANCH_ROUTE[0]);
const BRANCH_LEAVE_S = branchHook(EXIT_BRANCH_ROUTE[EXIT_BRANCH_ROUTE.length - 1]);

/**
 * Eén auto. `branchS` is zijn afstand op de aftakking en null zolang hij zijn ring
 * rijdt: twee plaatsen tegelijk bestaan niet, en `s` is dan wat hij was.
 */
type Car = {
	mesh: THREE.Group;
	/** Index in RINGS: welke strook, en dus welke richting. */
	ri: number;
	/** Boogafstand op die ring. */
	s: number;
	/** Boogafstand op de aftakking, of null zolang hij op zijn ring rijdt. */
	branchS: number | null;
	/** Resterende parkeertijd beneden, en of hij daar al gestaan heeft. */
	dwell: number;
	parked: boolean;
	/** Huidige snelheid. */
	v: number;
	/** Kruissnelheid — ieder z'n eigen haast, 6..11 m/s. */
	vmax: number;
};

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
	private readonly cars: Car[] = [];
	/** Boogafstand van de voetganger per ring, één keer per frame gevuld. */
	private readonly obstacleS: (number | null)[] = RINGS.map(() => null);
	/** Idem voor wie op de aftakking nog een rijstrook in steekt. */
	private readonly queueS: (number | null)[] = RINGS.map(() => null);
	/** De arm van de slagboom: 0 = dicht over de heenstrook, 1 = rechtop. */
	private readonly boomPivot = new THREE.Group();
	private boomOpen = 0;
	private boomWant = false;
	/** Aftellen tot de volgende auto de geul in mag. */
	private branchTimer = BRANCH_EVERY;

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

			// Netjes uitgesmeerd over de omtrek van de eigen ring, met wat jitter
			// tegen het kadaver-gevoel van een perfecte colonne.
			const ri = i % RINGS.length;
			const cruise = 6 + Math.random() * 5;
			this.cars.push({
				mesh: car,
				ri,
				s: ((Math.floor(i / RINGS.length) + 0.4 * Math.random()) / PER_RING) * at(RINGS, ri).perim,
				branchS: null,
				dwell: 0,
				parked: false,
				v: cruise,
				vmax: cruise,
			});
			this.place(i);
		}

		this.buildBoom();
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
		this.branchTimer = Math.max(0, this.branchTimer - dt);
		// De arm loopt op wat hij vorige frame zag: de auto's beslissen hieronder of
		// hij open moet, en anders zakt hij vanzelf weer dicht.
		this.boomOpen = clamp(this.boomOpen + (this.boomWant ? BOOM_SPEED : -BOOM_SPEED) * dt, 0, 1);
		this.boomPivot.rotation.x = EXIT_BOOM.openAngle * this.boomOpen;
		this.boomWant = false;
		// Eén projectie per ring per frame in plaats van één per auto: de ringen
		// veranderen niet en de voetganger staat maar op één plek.
		const obstacle = this.getObstacle?.() ?? null;
		// Wie op de aftakking voor de slagboom staat te wachten steekt de binnenste
		// strook nog in. Zodra hij de geul in duikt valt hij vanzelf weg: dan ligt hij
		// te laag om nog op de rijbaan te staan.
		const wachtende = this.cars.find((car) => car.branchS !== null)?.mesh.position ?? null;
		for (let r = 0; r < RINGS.length; r++) {
			this.obstacleS[r] = obstacle === null ? null : ringDistance(at(RINGS, r), obstacle);
			this.queueS[r] = wachtende === null ? null : ringDistance(at(RINGS, r), wachtende);
		}
		this.cars.forEach((car, i) => {
			if (car.branchS !== null) {
				this.driveBranch(car, i, dt, obstacle);
				return;
			}
			const ring = at(RINGS, car.ri);
			// Voorligger zoeken: kleinste positieve afstand vooruit op de ring.
			// Alleen wie dezelfde strook rijdt telt mee; boogafstanden van twee
			// ringen liggen niet op dezelfde meetlat, en tegenliggers passeer je.
			// O(n²) over 20 auto's — de Pi haalt z'n schouders op.
			let gap = ring.perim;
			for (const other of this.cars) {
				if (other === car || other.ri !== car.ri || other.branchS !== null) continue;
				const d = ahead(other.s, car.s, ring.perim);
				if (d < gap) gap = d;
			}
			// Blik is blik: wie voor de slagboom staat telt net zo hard mee als een
			// voorligger, inclusief de harde clamp hieronder.
			const queue = ahead(at(this.queueS, car.ri), car.s, ring.perim);
			if (queue < gap) gap = queue;
			// Een voetganger op de rijstrook remt net zo hard als blik, maar telt
			// niet mee in die clamp: die zet de auto onvoorwaardelijk stil en dan is
			// aanrijden onmogelijk. Zo beslist de remweg het — ruim op tijd gezien
			// staat hij vóór je, te laat gezien niet.
			const sight = Math.min(gap, ahead(at(this.obstacleS, car.ri), car.s, ring.perim));

			const k = edgeOf(ring, car.s);
			const edge = at(ring.edges, k);
			const distCorner = at(ring.ends, k) - car.s;
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

			const was = car.s;
			car.s = (car.s + move) % ring.perim;
			// Af en toe draait er eentje de geul in. Wie precies staat niet vast: het
			// is degene die als eerste langs de afslag komt nadat de klok is afgelopen.
			if (this.turnsIn(car, was, move)) {
				car.branchS = 0;
				car.dwell = 0;
				car.parked = false;
				this.branchTimer = BRANCH_EVERY;
				this.place(i);
				return;
			}
			this.place(i);

			// De rand ná de zet, want de botsing wordt op de nieuwe positie gemeten:
			// wie tijdens de hoek raakt kreeg anders de richting van de vorige rand mee.
			this.checkHit(car, obstacle, at(ring.edges, edgeOf(ring, car.s)).rotY);
		});
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	// ── intern ─────────────────────────────────────────────

	/**
	 * Wie te laat geremd heeft rijdt er gewoon doorheen; dan is het raak. `rotY` is
	 * de koers waarin hij je meeneemt. De hoogte telt mee omdat de aftakking onder
	 * de winkelvloer door loopt: een auto zes meter onder je is geen aanrijding.
	 */
	private checkHit(car: Car, obstacle: RoadObstacle | null, rotY: number): void {
		if (obstacle === null || this.hitCooldown > 0 || car.v < HIT_V) return;
		if (Math.abs(obstacle.y - car.mesh.position.y) > ROAD_HEAD) return;
		const dx = obstacle.x - car.mesh.position.x;
		const dz = obstacle.z - car.mesh.position.z;
		if (dx * dx + dz * dz > HIT_R * HIT_R) return;
		this.hitCooldown = HIT_COOLDOWN;
		const push = car.v + HIT_PUSH;
		this.onHit?.(Math.cos(rotY) * push, -Math.sin(rotY) * push, HIT_LIFT);
	}

	/** Of deze auto met deze zet net langs de afslag naar de geul komt, en of dat mag. */
	private turnsIn(car: Car, was: number, move: number): boolean {
		if (BRANCH_ENTER_S === null || this.branchTimer > 0 || car.ri !== BRANCH_RING) return false;
		if (this.cars.some((other) => other.branchS !== null)) return false;
		const ring = at(RINGS, BRANCH_RING);
		let d = BRANCH_ENTER_S - was;
		if (d < 0) d += ring.perim;
		return d <= move;
	}

	/**
	 * Of er bij de invoegplek een gat in de ring zit. Alleen vooruit gekeken: wie
	 * erachter aankomt remt al voor de wachtende auto, en invoegen is juist wat die
	 * file weer op gang helpt. Ook achteruit kijken zet de twee op elkaar te wachten.
	 */
	private ringHasRoom(): boolean {
		if (BRANCH_LEAVE_S === null) return false;
		const perim = at(RINGS, BRANCH_RING).perim;
		return this.cars.every(
			(other) => other.branchS !== null || other.ri !== BRANCH_RING || ahead(other.s, BRANCH_LEAVE_S, perim) > GAP_HOLD,
		);
	}

	/**
	 * Eén auto op de aftakking: de inrit op, de geul af, beneden even stilstaan,
	 * omdraaien en wachten tot de ring hem er weer bij laat.
	 *
	 * Hetzelfde rem-model als op de ring, alleen is er hier één ding om voor te
	 * stoppen tegelijk: de slagboom op de heenweg, of het einde van de aftakking.
	 */
	private driveBranch(car: Car, i: number, dt: number, obstacle: RoadObstacle | null): void {
		const s = car.branchS;
		if (s === null) return;
		if (car.dwell > 0) {
			car.dwell = Math.max(0, car.dwell - dt);
			car.v = 0;
			this.place(i);
			return;
		}
		// Zolang hij naar binnen rijdt ziet de boom hem aankomen, en blijft hij open
		// tot de auto er met carrosserie en al onderdoor is.
		if (s < BRANCH_PARK_S && s > BOOM_S - BOOM_SEE && s < BOOM_S + BODY_L) this.boomWant = true;

		const dicht = s < BOOM_S && this.boomOpen < BOOM_CLEAR;
		const stop = dicht ? BOOM_STOP_S : BRANCH_LENGTH;
		const ruimte = Math.max(0, stop - s);
		const kruis = Math.min(car.vmax, BRANCH_VMAX);
		// Remmen op remweg en niet op een vaste afstand. Op een vaste afstand stond hij
		// stil ruim voor zijn streep en kwam hij nooit meer op gang: remmen omdat de
		// streep dichtbij is, en dichtbij blijven omdat hij remt.
		const remweg = half(car.v * car.v) / BRAKE;
		car.v = ruimte <= remweg ? Math.max(0, car.v - BRAKE * dt) : Math.min(kruis, car.v + ACCEL * dt);
		const move = Math.min(car.v * dt, ruimte);
		const next = s + move;

		// Beneden staat hij zijn parkeertijd uit voor hij de bocht om gaat.
		if (!car.parked && next >= BRANCH_PARK_S) {
			car.parked = true;
			car.dwell = BRANCH_PARK;
			car.branchS = BRANCH_PARK_S;
			car.v = 0;
			this.place(i);
			return;
		}
		car.branchS = next;
		this.place(i);
		this.checkHit(car, obstacle, branchLegAt(next).rotY);
		if (next >= BRANCH_LENGTH && BRANCH_LEAVE_S !== null && this.ringHasRoom()) {
			car.branchS = null;
			car.s = BRANCH_LEAVE_S;
		}
	}

	/** Zet auto i op z'n boogafstand, neus in de rijrichting. Geen allocaties. */
	private place(i: number): void {
		const car = this.cars[i];
		if (!car) return;
		if (car.branchS !== null) {
			const leg = branchLegAt(car.branchS);
			const t = inverseLerpClamped(leg.start, leg.start + leg.len, car.branchS);
			car.mesh.position.set(lerp(leg.from.x, leg.to.x, t), lerp(leg.from.y, leg.to.y, t), lerp(leg.from.z, leg.to.z, t));
			car.mesh.rotation.set(0, leg.rotY, 0);
			// Om zijn eigen lengte-as kantelen: op de helling staat hij met de neus
			// omlaag in plaats van vlak door het beton.
			car.mesh.rotateZ(leg.pitch);
			return;
		}
		const ring = at(RINGS, car.ri);
		const k = edgeOf(ring, car.s);
		const edge = at(ring.edges, k);
		const u = car.s - at(ring.starts, k);
		car.mesh.position.set(edge.ox + edge.dx * u, 0, edge.oz + edge.dz * u);
		car.mesh.rotation.set(0, edge.rotY, 0);
	}

	/**
	 * De slagboom op de inrit. Zijn arm ligt over de heenstrook en gaat alleen open
	 * voor wie er echt aankomt; de terugstrook laat hij vrij.
	 */
	private buildBoom(): void {
		const { post, arm, armLength, pivotY, x, postZ } = EXIT_BOOM;
		const staal = this.track(lit({ color: 0xe8e8e2, roughness: 0.5, metalness: 0.2 }));
		const rood = this.track(new THREE.MeshBasicMaterial({ color: 0xc62f28, toneMapped: false }));
		const donker = this.track(lit({ color: 0x3b4046, roughness: 0.8 }));

		const postGeo = new THREE.CylinderGeometry(post.radius, post.radius, post.height, 10);
		const armGeo = new THREE.BoxGeometry(arm.thickness, arm.thickness, armLength);
		const sleeveGeo = new THREE.BoxGeometry(arm.thickness + 0.02, arm.thickness + 0.02, arm.sleeveLength);
		this.geometries.push(postGeo, armGeo, sleeveGeo);

		const paal = new THREE.Mesh(postGeo, donker);
		paal.position.set(x, EXIT_APRON_TOP_Y + half(post.height), postZ);
		this.group.add(paal);

		const balk = new THREE.Mesh(armGeo, staal);
		balk.position.z = -half(armLength);
		this.boomPivot.add(balk);
		for (let i = 0; i < arm.sleeves; i++) {
			const sleeve = new THREE.Mesh(sleeveGeo, rood);
			sleeve.position.z = -(armLength * (i + 1)) / (arm.sleeves + 1);
			this.boomPivot.add(sleeve);
		}
		this.boomPivot.position.set(x, EXIT_APRON_TOP_Y + pivotY, postZ);
		this.group.add(this.boomPivot);
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
