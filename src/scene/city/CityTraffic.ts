import * as THREE from 'three';
import { MOTORCYCLE_SPEC } from '#/data/world';
import { lit } from '#/render/material';
import type { Barriers } from '#/scene/city/Barriers';
import type { RoadRing, RoutePoint } from '#/scene/city/cityPlan';
import { EXIT_BOOM, EXIT_BRANCH_ROUTE, LANE_OFFSET, ROAD_RINGS, TRAFFIC_CAR, TRAFFIC_RIDER } from '#/scene/city/cityPlan';
import { backToBackLabel, labelCanvas, labelTexture } from '#/util/label';
import { half, inverseLerpClamped, lerp } from '#/util/math';
import { at } from '#/util/rand';

/**
 * Ringweg-verkeer: veertien burgerauto's, zes taxi's en vier motorrijders die eeuwig
 * om een mall rijden waar ze nooit parkeren.
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
/** Welke slots taxi zijn — verspreid, anders lijkt het een taxistandplaats. */
const TAXI_SLOT = new Set([1, 4, 8, 11, 14, 18]);
/**
 * En welke motor. Even en oneven, dus beide richtingen krijgen er twee: staan ze
 * alle vier op dezelfde ring, dan rijdt de tegenrichting alleen blik.
 */
const RIDER_SLOT = new Set([3, 6, 15, 20]);
/** Elke bezette plaats telt uit zijn eigen lijst; een tweede getal ernaast liep uit de pas. */
const N = N_CARS + TAXI_SLOT.size + RIDER_SLOT.size;
/** Om en om over de twee richtingen, zodat het beide kanten op even druk is. */
const PER_RING = N / RINGS.length;

const STOP_GAP = 3.2; // stopstreep: zoveel meter vóór de hoek wachten
const LIGHT_SEE = 15; // vanaf hier "ziet" de bestuurder het rode licht
const BRAKE = 9; // m/s² — stevig, maar niemand morst koffie
const ACCEL = 4; // m/s² — optrekken alsof de benzine gratis is

/**
 * Wat er van een carrosserie op de weg te merken is.
 *
 * De volgafstanden en de botsstraal stonden hier als drie losse getallen die alle
 * drie de lengte van een auto in zich hadden zitten, dus een smaller voertuig kon er
 * niet bij zonder ze te kopiëren. Ze worden nu uit de eigen maat gerekend: een motor
 * volgt korter en raakt je pas dichterbij, met precies hetzelfde remmodel.
 */
export type TrafficProfile = Readonly<{
	length: number;
	width: number;
	/** Rem als de voorligger dichterbij is (hart-op-hart). */
	brakeGap: number;
	/** Absolute ondergrens, anders schuiven ze in elkaar. */
	holdGap: number;
	/** Botsstraal rond het hart. */
	hit: number;
}>;

/** Speling tussen twee stilstaande voertuigen, bovenop de lengte van de achterste. */
const FOLLOW_CLEARANCE = 0.4;
/** En hoeveel eerder dan die grens hij van zijn gas gaat. */
const FOLLOW_SIGHT = 1.8;
/** Zoveel binnen zijn eigen neus zit de botsstraal. */
const HIT_INSET = 0.1;

function trafficProfile(body: Readonly<{ length: number; width: number }>): TrafficProfile {
	return {
		length: body.length,
		width: body.width,
		brakeGap: body.length + FOLLOW_SIGHT,
		holdGap: body.length + FOLLOW_CLEARANCE,
		hit: half(body.length) - HIT_INSET,
	};
}

/** De twee soorten die de ring rijdt, elk met zijn eigen volgprofiel. */
export const TRAFFIC_PROFILES = {
	car: trafficProfile(TRAFFIC_CAR),
	rider: trafficProfile(TRAFFIC_RIDER),
} as const;

/** Welk profiel elk slot van het wagenpark rijdt. De controle op de wegen leest hem terug. */
export const TRAFFIC_FLEET: readonly (keyof typeof TRAFFIC_PROFILES)[] = Array.from({ length: N }, (_unused, slot) =>
	RIDER_SLOT.has(slot) ? 'rider' : 'car',
);

/** Carrosserie van een auto. De breedte van een rijstrook hangt eraan. */
const BODY_L = TRAFFIC_CAR.length;
const BODY_W = TRAFFIC_CAR.width;

/**
 * Hoe ver naast zijn éigen strookhart een bestuurder je als obstakel ziet: de
 * halve rijstrook plus een schouder. LANE_OFFSET ís die halve strook, dus de
 * twee stroken samen dekken de hele rijbaan en er blijft nergens een reepje
 * asfalt over waar niemand voor remt. De schouder houdt het bereik bovendien
 * ruimer dan de botsstraal van welk profiel dan ook: alles wat geraakt kan worden,
 * wordt gezien.
 */
const LANE_SHOULDER = 0.4;
const ROAD_REACH = LANE_OFFSET + LANE_SHOULDER;
/** Hoger dan dit en je staat op iets, niet op het asfalt. */
const ROAD_HEAD = 1.6;
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
/** Speling tussen de neus van de wachtende auto en de arm. */
const BOOM_GAP = 0.4;

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

/**
 * Boogafstand van een punt dat op de aftakking staat, of null als het ernaast of
 * erboven ligt. Dezelfde vraag als `ringDistance`, want een voetganger op de
 * inrit hoort net zo hard geremd te worden als een voorligger op de ring.
 */
function branchDistance(p: RoadObstacle): number | null {
	let best: number | null = null;
	let bestLat = ROAD_REACH;
	for (const leg of BRANCH_LEGS) {
		const dx = leg.to.x - leg.from.x;
		const dz = leg.to.z - leg.from.z;
		const run = Math.hypot(dx, dz);
		if (run <= 0) continue;
		const ux = dx / run;
		const uz = dz / run;
		const u = (p.x - leg.from.x) * ux + (p.z - leg.from.z) * uz;
		if (u < 0 || u > run) continue;
		const t = inverseLerpClamped(0, run, u);
		if (Math.abs(p.y - lerp(leg.from.y, leg.to.y, t)) > ROAD_HEAD) continue;
		const lat = Math.abs((p.x - leg.from.x) * -uz + (p.z - leg.from.z) * ux);
		if (lat >= bestLat) continue;
		bestLat = lat;
		best = leg.start + leg.len * t;
	}
	return best;
}

/** Waar de auto beneden stilstaat: het knikpunt dat zichzelf als parkeerplek opgeeft. */
const BRANCH_PARK_S = BRANCH_LEGS.find((leg) => leg.from.park === true)?.start ?? 0;
const BOOM_S = branchArcAtX(EXIT_BOOM.post.x);

/** Waar dit voertuig voor een dichte boom stilstaat: met zijn eigen neus vlak voor de arm. */
function boomStop(profile: TrafficProfile): number {
	return BOOM_S - half(profile.length) - BOOM_GAP;
}

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
	/** Zijn carrosserie op de weg: volgafstand en botsstraal. */
	profile: TrafficProfile;
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
	/** De slagbomen van de stad. De inrit heeft er een, en die laat dit verkeer toe. */
	private readonly barriers: Barriers;
	/** Aftellen tot de volgende auto de geul in mag. */
	private branchTimer = BRANCH_EVERY;

	constructor(getPhase: () => string, barriers: Barriers) {
		this.getPhase = getPhase;
		this.barriers = barriers;
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

		// ── de motoren: dezelfde machine als op P1, met de lengte langs x ──
		const { body: riderBody, seat: riderSeat, wheel: riderWheel, bars: riderBars } = MOTORCYCLE_SPEC;
		const riderBodyGeo = new THREE.BoxGeometry(riderBody.length, riderBody.height, riderBody.width);
		const riderSeatGeo = new THREE.BoxGeometry(riderSeat.length, riderSeat.height, riderSeat.width);
		const riderWheelGeo = new THREE.CylinderGeometry(riderWheel.radius, riderWheel.radius, riderWheel.width, 10);
		riderWheelGeo.rotateX(Math.PI / 2);
		const riderBarGeo = new THREE.BoxGeometry(riderBars.thickness, riderBars.thickness, riderBars.width);
		this.geometries.push(riderBodyGeo, riderSeatGeo, riderWheelGeo, riderBarGeo);
		const riderPaint = [0x1d1f24, 0xa62828].map((c) => this.track(lit({ color: c, roughness: 0.4, metalness: 0.5 })));
		const chromeMat = this.track(lit({ color: 0xb0bec5, roughness: 0.25, metalness: 0.8 }));

		// ── het wagenpark: 24 groups, ieder een eigen plek op de ring ──
		for (let i = 0; i < N; i++) {
			const taxi = TAXI_SLOT.has(i);
			const rider = RIDER_SLOT.has(i);
			const car = new THREE.Group();

			if (rider) {
				const tank = new THREE.Mesh(riderBodyGeo, at(riderPaint, i));
				tank.position.y = riderBody.centerY;
				car.add(tank);

				const saddle = new THREE.Mesh(riderSeatGeo, wheelMat);
				saddle.position.set(-riderSeat.offsetZ, riderSeat.centerY, 0);
				car.add(saddle);

				for (const side of [-1, 1]) {
					const wheel = new THREE.Mesh(riderWheelGeo, wheelMat);
					wheel.rotation.z = Math.PI / 2;
					wheel.position.set(side * riderWheel.offsetZ, riderWheel.radius, 0);
					car.add(wheel);
				}

				const bar = new THREE.Mesh(riderBarGeo, chromeMat);
				bar.position.set(riderBars.offsetZ, riderBars.centerY, 0);
				car.add(bar);

				const lamp = new THREE.Mesh(lampGeo, lampMat);
				lamp.position.set(MOTORCYCLE_SPEC.headlight.offsetZ, MOTORCYCLE_SPEC.headlight.centerY, 0);
				car.add(lamp);
			} else {
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
					const sign = backToBackLabel(signGeo, signMat);
					sign.position.set(-0.3, 1.8, 0);
					car.add(sign);
				}
			}

			this.group.add(car);

			// Netjes uitgesmeerd over de omtrek van de eigen ring, met wat jitter
			// tegen het kadaver-gevoel van een perfecte colonne.
			const ri = i % RINGS.length;
			const cruise = 6 + Math.random() * 5;
			this.cars.push({
				mesh: car,
				profile: TRAFFIC_PROFILES[at(TRAFFIC_FLEET, i)],
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
			const mustBrake = sight < car.profile.brakeGap || (blocked && distCorner < LIGHT_SEE);
			car.v = mustBrake ? Math.max(0, car.v - BRAKE * dt) : Math.min(car.vmax, car.v + ACCEL * dt);

			// Harde clampen: nooit door de voorligger heen, nooit de hoek op bij rood.
			let move = car.v * dt;
			const room = gap - car.profile.holdGap;
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
		if (dx * dx + dz * dz > car.profile.hit * car.profile.hit) return;
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
	private ringHasRoom(profile: TrafficProfile): boolean {
		if (BRANCH_LEAVE_S === null) return false;
		const perim = at(RINGS, BRANCH_RING).perim;
		return this.cars.every(
			(other) => other.branchS !== null || other.ri !== BRANCH_RING || ahead(other.s, BRANCH_LEAVE_S, perim) > profile.holdGap,
		);
	}

	/**
	 * Eén auto op de aftakking: de inrit op, de geul af, beneden even stilstaan,
	 * omdraaien en wachten tot de ring hem er weer bij laat.
	 *
	 * Hetzelfde rem-model als op de ring: hij stopt voor de dichtstbijzijnde van de
	 * slagboom op de heenweg, een voetganger op de inrit, en het einde van de
	 * aftakking. Zonder die middelste reed hij de speler op de helling omver in
	 * plaats van erachter te wachten, terwijl hij op de ring keurig voor hem remt.
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
		// Hij meldt zich bij de bomen die hij tegenkomt; welke opengaat en voor wie
		// staat op de boom zelf.
		if (s < BRANCH_PARK_S) this.barriers.approach(car.mesh.position.x, car.mesh.position.z, 'npc-traffic');

		const dicht = s < BOOM_S && this.barriers.blocks(EXIT_BOOM.id);
		let stop = dicht ? boomStop(car.profile) : BRANCH_LENGTH;
		const voetganger = obstacle === null ? null : branchDistance(obstacle);
		if (voetganger !== null && voetganger > s) stop = Math.min(stop, voetganger - car.profile.holdGap);
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
		if (next >= BRANCH_LENGTH && BRANCH_LEAVE_S !== null && this.ringHasRoom(car.profile)) {
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
		return this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
