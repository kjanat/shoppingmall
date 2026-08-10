import type { Vec2 } from '#/data/spatial';
import {
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
	MALL_WALL_ENVELOPE,
	PARKING_EXIT_RAIL_OUTER,
	PARKING_EXIT_RAMP,
	PARKING_EXIT_TRENCH,
	PARKING_EXIT_WALL_GAP,
	parkingExitRampY,
} from '#/data/world';
import { zoneAt, zoneBit } from '#/data/zones';
import { half, inverseLerpClamped, lerp, midpoint, span } from '#/util/math';
import { at, jitterWith, mulberry32 } from '#/util/rand';

/**
 * De maten van de stad buiten de mall, op één plek.
 *
 * De skyline, het theater en de garage tekenden hun eigen coördinaten, en de
 * fysica had er geen. Nu de speler van het dak kan springen en er buiten
 * rondloopt, moeten collision en scene exact hetzelfde blok bedoelen: elke
 * tweede kopie van een getal is een muur die net naast zijn gevel staat.
 */

export type Rect = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

/** De wereldrand. Collision klemt hierop, de drone ook. */
export const CITY_BOUNDS = { minX: -95, maxX: 95, minZ: -75, maxZ: 75 } as const;

/** Straatniveau. Buiten de mall ligt hier de vloer, tenzij een citySurface hoger komt. */
export const CITY_GROUND_Y = 0;

/** Binnenrand van de ringweg. Het plein tussen mall en weg loopt tot hier. */
export const ROAD_INNER_X = 48;
export const ROAD_INNER_Z = 34;

/**
 * De ringweg zelf: één rijbaan van `width` meter, met twee rijstroken naast elkaar.
 *
 * De strookindeling staat hier en niet bij de tekenaar, want het verkeer rijdt erop en
 * de wereldcontrole leest hem na. Welke kant een strook op loopt en aan welke kant van
 * de middenstreep hij ligt is één afspraak; twee kopieën ervan laten de helft van het
 * verkeer tegen de richting in rijden en niemand die het opmerkt.
 */
export const ROAD_PLAN = { width: 7 } as const;

const ROAD_HALF_WIDTH = half(ROAD_PLAN.width);

/** Middellijnen van de rijbaan. De middenstreep ligt hier, het verkeer ernaast. */
export const LANE_X = ROAD_INNER_X + ROAD_HALF_WIDTH;
export const LANE_Z = ROAD_INNER_Z + ROAD_HALF_WIDTH;

/**
 * Hart van een rijstrook: een kwart rijbaan naast de middellijn, want twee stroken met
 * de middenstreep ertussen delen de rijbaan doormidden.
 */
export const LANE_OFFSET = half(ROAD_HALF_WIDTH);

/** Welke lichtfase deze rand groen geeft. 'ns' hoort bij de randen die langs x lopen. */
export type RoadPhase = 'ns' | 'ew';

/** Eén rechte rand van een rijstrook: waar hij begint, welke kant hij op loopt, hoe lang. */
export type RoadEdge = Readonly<{
	ox: number;
	oz: number;
	dx: number;
	dz: number;
	rotY: number;
	len: number;
	phase: RoadPhase;
}>;

/** Eén rijstrook: vier randen met de boogafstanden erlangs voorgekauwd. */
export type RoadRing = Readonly<{
	/** +1 is met de klok mee van boven gezien (+x rechts, +z onder). */
	turn: 1 | -1;
	edges: readonly RoadEdge[];
	starts: readonly number[];
	ends: readonly number[];
	perim: number;
}>;

/**
 * De rechthoek van één richting. Met de klok mee ligt hij `LANE_OFFSET` naar binnen,
 * ertegenin evenveel naar buiten, en dat is precies wat rechts houden op een ring is.
 * De tegenrichting loopt dezelfde hoeken de andere kant rond.
 */
function roadRing(turn: 1 | -1): RoadRing {
	const hx = LANE_X - turn * LANE_OFFSET;
	const hz = LANE_Z - turn * LANE_OFFSET;
	const clockwise: readonly (readonly [number, number])[] = [
		[-hx, -hz], // noordwest
		[hx, -hz], // noordoost
		[hx, hz], // zuidoost
		[-hx, hz], // zuidwest
	];
	const corners = turn === 1 ? clockwise : [...clockwise].reverse();

	const edges: RoadEdge[] = [];
	const starts: number[] = [];
	const ends: number[] = [];
	let acc = 0;
	for (let i = 0; i < corners.length; i++) {
		const [ox, oz] = at(corners, i);
		const [nx, nz] = at(corners, i + 1);
		// Elke rand loopt langs één as, dus één van de twee termen is nul.
		const len = Math.abs(nx - ox) + Math.abs(nz - oz);
		const dx = Math.sign(nx - ox);
		const dz = Math.sign(nz - oz);
		// Neus van de auto wijst langs +x bij rotY 0; rotY draait 'm de rand op.
		edges.push({ ox, oz, dx, dz, rotY: Math.atan2(-dz, dx), len, phase: dz === 0 ? 'ns' : 'ew' });
		starts.push(acc);
		acc += len;
		ends.push(acc);
	}
	return { turn, edges, starts, ends, perim: acc };
}

/** Binnenste strook met de klok mee, buitenste ertegenin. */
export const ROAD_RINGS: readonly RoadRing[] = [roadRing(1), roadRing(-1)];

/** Het hart van de binnenste rijstrook langs de westrand: de strook die de mall passeert. */
export const RING_INNER_WEST_X = -(LANE_X - LANE_OFFSET);

/** Carrosserie van het stadsverkeer. Botsstraal, remafstand en strookbreedte hangen eraan. */
export const TRAFFIC_CAR = { length: 4.2, width: 1.85 } as const;

/**
 * Eén zebrapad: balken dwars op de rijrichting. `sideInset` is wat er aan beide
 * kanten van de rijbaan onbeschilderd blijft, dus de balk is zoveel korter.
 */
export const ZEBRA_PLAN = { bars: 6, pitch: 0.85, barWidth: 0.55, sideInset: 0.3 } as const;

/** Van de eerste tot de laatste balk: zo breed steek je over. */
export const ZEBRA_WIDTH = (ZEBRA_PLAN.bars - 1) * ZEBRA_PLAN.pitch + ZEBRA_PLAN.barWidth;

/** Een oversteekplaats op de ringweg: waar hij ligt en hoe de balken erop liggen. */
export type RoadCrossing = Readonly<{ id: string; x: number; z: number; rotY: number }>;

/**
 * De vier oversteekplaatsen. De westelijke ligt op de as van de hoofdingang en niet
 * op het midden van zijn rand: de loper liep vanaf de dorpel met een knik naar een
 * zebra vijf meter zuidelijker, en die knik bestond alleen omdat de entree en de
 * oversteek elkaars maat niet kenden. Nu verzet wie de deur verzet ze allebei.
 */
export const ROAD_CROSSINGS: readonly RoadCrossing[] = [
	{ id: 'north', x: 0, z: -LANE_Z, rotY: 0 },
	{ id: 'south', x: 0, z: LANE_Z, rotY: 0 },
	{ id: 'west', x: -LANE_X, z: ENTRANCE_PORTAL.centerZ, rotY: Math.PI / 2 },
	{ id: 'east', x: LANE_X, z: 0, rotY: Math.PI / 2 },
];

function crossing(id: string): RoadCrossing {
	const found = ROAD_CROSSINGS.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`geen oversteekplaats ${id}`);
	return found;
}

/** De oversteek waar de loper van de hoofdingang op uitkomt. */
export const ENTRANCE_CROSSING = crossing('west');

/**
 * Het plein rond de mall: de ring tussen de gevel en de binnenrand van de ringweg.
 *
 * Daar lag alleen het grondvlak van de wereld, één grijze plaat op y −0,5 terwijl
 * collision je op 0 laat lopen. Ruim drieduizend vierkante meter effen grijs een
 * halve meter onder je voeten, precies waar je uit de hoofdingang komt.
 *
 * De bestrating ligt `sink` onder het loopvlak in plaats van erop: het voorplein van
 * de hoofdingang eindigt al op 0, en twee vlakken op dezelfde hoogte die elkaar
 * overlappen flikkeren tegen elkaar op. Twee centimeter zie je niet en ze vechten
 * niet meer.
 */
export const PLAZA_PLAN = {
	sink: 0.02,
	/** Dik genoeg om onder het grondvlak van de wereld door te lopen, dus geen rand in zicht. */
	thickness: 0.6,
	/** Meters wereld per tegelherhaling van de bestrating. */
	tile: 4,
	/** Twee ringen straatmeubilair: één langs de gevel, één langs de stoeprand. */
	facadeOffset: 4,
	kerbOffset: 3,
	/** Afstand tussen twee stuks langs zo'n ring. */
	spacing: 25,
	/** Vrije ruimte om de uitritgeul en het voorplein, gemeten vanaf hun eigen rand. */
	keepOut: 1.5,
} as const;

/** Buitenrand van de bestrating: de binnenrand van de ringweg. */
export const PLAZA_OUTER: Rect = { minX: -ROAD_INNER_X, maxX: ROAD_INNER_X, minZ: -ROAD_INNER_Z, maxZ: ROAD_INNER_Z };

/**
 * De mond van de uitritgeul blijft open. Bestrating erover is een plaat dwars over
 * de helling waar je onderdoor omhoog rijdt.
 */
export const PLAZA_TRENCH_GAP: Rect = {
	minX: PARKING_EXIT_TRENCH.minX,
	maxX: PARKING_EXIT_TRENCH.coverX,
	minZ: -PARKING_EXIT_WALL_GAP,
	maxZ: PARKING_EXIT_WALL_GAP,
};

/**
 * Het voorplein van de hoofdingang legt zijn eigen bestrating en de loper naar het
 * zebrapad. Daar hoeft geen straatmeubilair bij te komen staan.
 */
export const PLAZA_ENTRANCE_GAP: Rect = {
	minX: ENTRANCE_SPEC.forecourt.west,
	maxX: MALL_WALL_ENVELOPE.minX,
	minZ: ENTRANCE_SPEC.forecourt.north,
	maxZ: ENTRANCE_SPEC.forecourt.south,
};

/**
 * De loper van de hoofdingang: één rechte baan van de dorpel tot de stoeprand, op de
 * as van het portaal en dus op de as van de oversteek erachter. De loper ís de maat
 * die de entree en het zebrapad delen, en `controleIngang` leest hem daarop na.
 */
export const ENTRANCE_CARPET: Rect = {
	minX: PLAZA_OUTER.minX,
	maxX: ENTRANCE_PORTAL.outerX + ENTRANCE_SPEC.carpet.startInset,
	minZ: ENTRANCE_PORTAL.centerZ - half(ENTRANCE_SPEC.carpet.width),
	maxZ: ENTRANCE_PORTAL.centerZ + half(ENTRANCE_SPEC.carpet.width),
};

/** Bovenkant van de bestrating. */
export const PLAZA_TOP_Y = CITY_GROUND_Y - PLAZA_PLAN.sink;

/**
 * Het maaiveld van de wereld buiten de mall.
 *
 * Dat was één plaat op y −0,5 terwijl collision je op `CITY_GROUND_Y` laat lopen en
 * alles wat er buiten staat zijn voet op 0 heeft: de torens, het park, het
 * theaterpodium en het maaiveld-dek van de garage stonden allemaal een halve meter
 * boven de grond die ze moesten raken. De plaat ligt nu net onder het loopvlak, en
 * nog een tikje onder de bestrating zodat die twee niet tegen elkaar op flikkeren.
 */
export const CITY_GROUND_PLANE_Y = PLAZA_TOP_Y - PLAZA_PLAN.sink;

/**
 * De inrit: het stuk rijbaan tussen de binnenrand van de ringweg en de mond van de
 * uitritgeul. Daartussen lag twee meter bestrating, dus het asfalt hield op x −48 op
 * en de helling begon pas op x −46 — een naad waar niemand overheen kon rijden.
 * Hij ligt op de hoogte van het straateind van de helling, zodat er geen drempel op
 * de naad staat.
 */
export const EXIT_APRON: Rect = {
	minX: PLAZA_OUTER.minX,
	maxX: PARKING_EXIT_TRENCH.minX,
	minZ: -PARKING_EXIT_RAIL_OUTER,
	maxZ: PARKING_EXIT_RAIL_OUTER,
};

/** Bovenkant van de inrit: het loopvlak van de helling waar hij tegenaan komt. */
export const EXIT_APRON_TOP_Y = parkingExitRampY(EXIT_APRON.maxX);

/** Halve rijstrook op de uitrit: naar binnen rijd je +z, naar buiten −z, en dat is rechts houden. */
export const EXIT_LANE_OFFSET = half(half(PARKING_EXIT_RAMP.width));

/** Waar de auto beneden omdraait: tussen twee kolomlijnen in, ruim voor de vakken langs. */
const EXIT_TURN_X = -20;

/** Een knikpunt van de aftakking. `park` is het punt waar de auto beneden stilstaat. */
export type RoutePoint = Readonly<{ x: number; y: number; z: number; park?: boolean }>;

/**
 * De aftakking van de ringweg naar P1: van de binnenste rijstrook de inrit op, de
 * geul af, beneden omdraaien en dezelfde weg terug naar dezelfde strook.
 *
 * De heen- en terugbaan liggen elk op hun eigen helft van de geul, dus de auto die
 * naar binnen rijdt en die naar buiten komt passeren elkaar zoals ze dat op de ring
 * ook doen. De hoogtes komen van de helling zelf: een tweede getal ernaast zou de
 * auto een halve meter boven of onder zijn eigen dek zetten.
 */
export const EXIT_BRANCH_ROUTE: readonly RoutePoint[] = [
	{ x: RING_INNER_WEST_X, y: CITY_GROUND_Y, z: EXIT_LANE_OFFSET },
	{ x: EXIT_APRON.maxX, y: EXIT_APRON_TOP_Y, z: EXIT_LANE_OFFSET },
	{ x: PARKING_EXIT_RAMP.start.x, y: PARKING_EXIT_RAMP.start.y, z: EXIT_LANE_OFFSET },
	{ x: EXIT_TURN_X, y: PARKING_EXIT_RAMP.start.y, z: EXIT_LANE_OFFSET, park: true },
	{ x: EXIT_TURN_X, y: PARKING_EXIT_RAMP.start.y, z: -EXIT_LANE_OFFSET },
	{ x: PARKING_EXIT_RAMP.start.x, y: PARKING_EXIT_RAMP.start.y, z: -EXIT_LANE_OFFSET },
	{ x: EXIT_APRON.maxX, y: EXIT_APRON_TOP_Y, z: -EXIT_LANE_OFFSET },
	{ x: RING_INNER_WEST_X, y: CITY_GROUND_Y, z: -EXIT_LANE_OFFSET },
];

/**
 * De zones waar het stadsverkeer in rijdt, uit de routes zelf.
 *
 * De hele stadblok-simulatie hing aan `stad` alleen, terwijl de aftakking de geul
 * in rijdt en binnen de voetafdruk op P1 parkeert. Wie daar naast zo'n auto stond
 * zonder de geul in beeld liet hem op vier hertz tikken terwijl hij vol in beeld
 * stond. Afgeleid en niet opgeschreven, zodat een route die morgen ergens anders
 * heen loopt zijn eigen klok meeneemt.
 */
export const CITY_TRAFFIC_ZONES: number = (() => {
	let mask = 0;
	for (const point of EXIT_BRANCH_ROUTE) mask |= zoneBit(zoneAt(point.x, point.y, point.z));
	for (const ring of ROAD_RINGS) {
		for (const rand of ring.edges) {
			mask |= zoneBit(zoneAt(rand.ox, CITY_GROUND_Y, rand.oz));
			mask |= zoneBit(zoneAt(rand.ox + rand.dx * rand.len, CITY_GROUND_Y, rand.oz + rand.dz * rand.len));
		}
	}
	return mask;
})();

/** Vrije ruimte tussen de rijstrook en de paal van de slagboom. */
const EXIT_BOOM_CLEARANCE = 0.35;

const EXIT_BOOM_POST_Z = EXIT_APRON.maxZ + EXIT_BOOM_CLEARANCE;

/**
 * De slagboom op de inrit. Hij staat naast de heenstrook en zijn arm reikt tot de
 * hartlijn van de geul, dus wie naar binnen wil staat ervoor en wie naar buiten
 * komt rijdt er langs.
 */
export const EXIT_BOOM = {
	x: midpoint(EXIT_APRON.minX, EXIT_APRON.maxX),
	postZ: EXIT_BOOM_POST_Z,
	/** Van de paal tot de hartlijn van de geul. */
	armLength: EXIT_BOOM_POST_Z,
	post: { radius: 0.11, height: 1.05 },
	pivotY: 1.02,
	arm: { thickness: 0.14, sleeves: 3, sleeveLength: 0.5 },
	/** De arm wijst naar −z, dus een positieve hoek om x kantelt hem omhoog. */
	openAngle: Math.PI / 2,
} as const;

/** Hoeveel de plaat voorbij de wereldrand doorloopt, zodat er geen kant in beeld komt. */
const CITY_GROUND_MARGIN = 25;

/** Groeit een rechthoek met `margin` aan alle kanten. */
export function grownRect(rect: Rect, margin: number): Rect {
	return { minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin };
}

/** Waar de maaiveldplaat ligt: de hele wereld, met een rand eromheen. */
export const CITY_GROUND_PLAN: Rect = grownRect(CITY_BOUNDS, CITY_GROUND_MARGIN);

function inRect(rect: Rect, x: number, z: number): boolean {
	return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/**
 * Stations op de omtrek van `ring`, om de `spacing` meter, beginnend op de
 * noordwesthoek. Het aantal wordt op een heel getal afgerond zodat de laatste stap
 * even lang is als de eerste en de ring dus rond loopt.
 */
export function ringStations(ring: Rect, spacing: number): readonly Vec2[] {
	const width = span(ring.minX, ring.maxX);
	const depth = span(ring.minZ, ring.maxZ);
	const perimeter = (width + depth) * 2;
	const count = Math.max(1, Math.round(perimeter / spacing));
	const stations: Vec2[] = [];
	for (let index = 0; index < count; index++) {
		let travelled = (perimeter * index) / count;
		if (travelled < width) {
			stations.push({ x: ring.minX + travelled, z: ring.minZ });
			continue;
		}
		travelled -= width;
		if (travelled < depth) {
			stations.push({ x: ring.maxX, z: ring.minZ + travelled });
			continue;
		}
		travelled -= depth;
		if (travelled < width) {
			stations.push({ x: ring.maxX - travelled, z: ring.maxZ });
			continue;
		}
		travelled -= width;
		stations.push({ x: ring.minX, z: ring.maxZ - travelled });
	}
	return stations;
}

/**
 * Waar het straatmeubilair mag staan: op de twee ringen, en niet in de geul of op
 * het voorplein van de hoofdingang, waar de entree zijn eigen bestrating heeft.
 */
export function plazaStations(): readonly Vec2[] {
	const rings: Rect[] = [grownRect(MALL_WALL_ENVELOPE, PLAZA_PLAN.facadeOffset), grownRect(PLAZA_OUTER, -PLAZA_PLAN.kerbOffset)];
	const keepOut = [PLAZA_TRENCH_GAP, PLAZA_ENTRANCE_GAP].map((rect) => grownRect(rect, PLAZA_PLAN.keepOut));
	return rings.flatMap((ring) => ringStations(ring, PLAZA_PLAN.spacing).filter((s) => !keepOut.some((r) => inRect(r, s.x, s.z))));
}

export type Rand = () => number;

export const TOWER_SEED = 0x404;

export type TowerSpec = Readonly<{ x: number; z: number; w: number; d: number; h: number; rot: number }>;

/**
 * Kavels van theater, garage en park — daar bouwt de skyline niet overheen.
 * "Building's in the way" was letterlijk waar: torens verzwolgen de marquee.
 */
export const CITY_KAVELS = {
	theatre: { minX: 52, maxX: 90, minZ: -70, maxZ: -40 },
	garage: { minX: 52, maxX: 90, minZ: 40, maxZ: 72 },
	park: { minX: -94, maxX: -52, minZ: -74, maxZ: -36 },
} as const satisfies Record<string, Rect>;

const KAVELS: readonly Rect[] = Object.values(CITY_KAVELS);

function opKavel(x: number, z: number, w: number, d: number): boolean {
	return KAVELS.some((k) => x + half(w) > k.minX && x - half(w) < k.maxX && z + half(d) > k.minZ && z - half(d) < k.maxZ);
}

/**
 * ~30 torens in vier banden om de ringweg: |x| 58..90 of |z| 44..72,
 * netjes binnen de wereldgrens, ook mét halve breedte.
 */
export function planTowers(rand: Rand): TowerSpec[] {
	const specs: TowerSpec[] = [];
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
				// Niet op elkaars tenen (de hoeken van de banden overlappen),
				// en niet op een gereserveerd kavel
				const vrij =
					!opKavel(x, z, w, d) &&
					specs.every((s) => Math.abs(s.x - x) > half(s.w + w) + 1.5 || Math.abs(s.z - z) > half(s.d + d) + 1.5);
				if (vrij) {
					// Ietsje scheef van het grid — net genoeg om te verontrusten
					specs.push({ x, z, w, d, h, rot: jitterWith(0.12, rand) });
					break;
				}
				// Na 8 pogingen dan maar geen toren; een gat in de skyline is ook moody.
			}
		}
	}
	return specs;
}

/**
 * Dezelfde lijst die CityBuildings tekent. Deterministisch uit `TOWER_SEED`,
 * dus wie hem hier opvraagt krijgt exact de torens die er staan.
 */
export const TOWER_SPECS: readonly TowerSpec[] = planTowers(mulberry32(TOWER_SEED));

/**
 * PRAIRIE THEATRE op het NO-kavel: zaalblok, portico op een podium, en een
 * brede trap van vier treden vanaf de stoep. De trap is de enige manier omhoog.
 */
export const THEATRE_PLAN = {
	hall: { minX: 58, maxX: 86, minZ: -66, maxZ: -52 },
	hallHeight: 13,
	podium: { minX: 57, maxX: 87, minZ: -52, maxZ: -47 },
	podiumY: 1.5,
	/** Treden lopen zuidwaarts omlaag vanaf `zTop`; `rise` blijft onder WALK_STEP. */
	stair: { minX: 62, maxX: 82, zTop: -47, treads: 4, tread: 0.6, rise: 0.3 },
	columns: { x0: 61.5, pitch: 3, count: 8, z: -50.6, radius: 0.6, bottomY: 1.5, topY: 9.6 },
} as const;

/** Bovenkant van trede `i`, geteld vanaf de bovenste (die tegen het podium ligt). */
export function theatreTreadY(i: number): number {
	return THEATRE_PLAN.stair.rise * (THEATRE_PLAN.stair.treads - i);
}

/** Z-strook van trede `i`, van boven naar beneden. */
export function theatreTreadZ(i: number): { minZ: number; maxZ: number } {
	const { zTop, tread } = THEATRE_PLAN.stair;
	return { minZ: zTop + i * tread, maxZ: zTop + (i + 1) * tread };
}

/**
 * De parkeergarage op het ZO-kavel. Het maaiveld-dek is open aan alle zijden,
 * dus daar loop je zo tussen de kolommen door naar binnen.
 *
 * De buitenspiraal om de ZO-hoek stond als losse getallen in `buildRamp` en was
 * daarmee decor: de platen hadden geen fysica en je liep er dwars doorheen naar
 * beneden. Ze staan hier omdat de mesh, de collision en de wereldcontrole
 * dezelfde helling moeten bedoelen.
 */
export const GARAGE_PLAN = {
	footprint: { minX: 58, maxX: 83, minZ: 46, maxZ: 64 },
	floorHeight: 3.2,
	slabThickness: 0.35,
	decks: 4,
	groundDeckY: 0.2,
	/**
	 * De oostelijke kolomlijn stond op 82,4 en daarmee pal achter de opening waar de
	 * spiraal een dek bereikt: de kolom vulde de doorgang die de borstwering vrijlaat.
	 * Op 81,2 staat hij nog binnen de plaat en laat hij de aanloop open.
	 */
	columnX: [59, 62.8, 71.2, 79.6, 81.2],
	columnZ: [46.8, 55, 63.2],
	columnSize: 0.45,
	columnTopY: 12.8,
	/**
	 * Borstwering rondom elk dek: laag genoeg om overheen te kijken, hoog genoeg om je
	 * te houden. `doorway` is de vrije breedte die de opening naar een bordes minstens
	 * krijgt: de naad tussen het hoekbordes en dek 1 is maar een meter lang, en met de
	 * borstweringhoeken erbij bleef daar geen schouderbreedte van over.
	 */
	parapet: { height: 1, thickness: 0.18, doorway: 2 },
	ramp: {
		thickness: 0.25,
		guard: { height: 0.6, thickness: 0.12 },
		/** Zuidplaat: klimt oostwaarts van het parkeerterrein naar dek 1, zuid van de gevel. */
		south: { z: 65.8, width: 3.2, fromX: 60 },
		/** Oostplaat: klimt noordwaarts van dek 1 naar dek 2, in de strook oost van de gevel. */
		east: { width: 2.8, fromZ: 63, toZ: 48.4 },
		/** Diepte van het bovenste bordes, noordwaarts voorbij het einde van de oostplaat. */
		landingDepth: 3.4,
		/** Steunpoten onder de oostelijke strook, op hun z. */
		legZ: [65.4, 60, 51],
		legSize: 0.3,
	},
} as const;

/** Bovenkant van dek `i` — de begane grond is een dunnere plaat op het parkeerterrein. */
export function garageDeckTop(i: number): number {
	return i === 0 ? GARAGE_PLAN.groundDeckY : i * GARAGE_PLAN.floorHeight + half(GARAGE_PLAN.slabThickness);
}

const RAMP = GARAGE_PLAN.ramp;

/** De strook oost van de gevel waarin de oostplaat en beide bordessen liggen. */
const EAST_MIN_X = GARAGE_PLAN.footprint.maxX;
const EAST_MAX_X = EAST_MIN_X + RAMP.east.width;
const EAST_X = midpoint(EAST_MIN_X, EAST_MAX_X);

/** Een schuine plaat van de spiraal: `start` en `end` liggen op zijn loopvlak. */
export type GarageRampRun = Readonly<{
	id: string;
	start: Readonly<{ x: number; y: number; z: number }>;
	end: Readonly<{ x: number; y: number; z: number }>;
	width: number;
}>;

/** Een vlak loopvlak van de garage: een bordes van de spiraal of een heel dek. */
export type GarageDeck = Readonly<Rect & { id: string; y: number }>;

/** Een borstweringdoos: hij houdt je tegen zolang je op het dek eronder staat. */
export type GarageParapet = Readonly<Rect & { id: string; minY: number; maxY: number }>;

export const GARAGE_RAMP_RUNS: readonly GarageRampRun[] = [
	{
		id: 'garage_ramp_south',
		start: { x: RAMP.south.fromX, y: CITY_GROUND_Y, z: RAMP.south.z },
		end: { x: EAST_MIN_X, y: garageDeckTop(1), z: RAMP.south.z },
		width: RAMP.south.width,
	},
	{
		id: 'garage_ramp_east',
		start: { x: EAST_X, y: garageDeckTop(1), z: RAMP.east.fromZ },
		end: { x: EAST_X, y: garageDeckTop(2), z: RAMP.east.toZ },
		width: RAMP.east.width,
	},
];

/** Het hoekbordes waar de klim van oost naar noord draait, en het bordes bovenaan. */
export const GARAGE_RAMP_LANDINGS: readonly GarageDeck[] = [
	{
		id: 'garage_ramp_corner',
		minX: EAST_MIN_X,
		maxX: EAST_MAX_X,
		minZ: RAMP.east.fromZ,
		maxZ: RAMP.south.z + half(RAMP.south.width),
		y: garageDeckTop(1),
	},
	{
		id: 'garage_ramp_landing',
		minX: EAST_MIN_X,
		maxX: EAST_MAX_X,
		minZ: RAMP.east.toZ - RAMP.landingDepth,
		maxZ: RAMP.east.toZ,
		y: garageDeckTop(2),
	},
];

/** De parkeerdekken boven het maaiveld, inclusief het dak: loopvlak zodra je er staat. */
export const GARAGE_DECKS: readonly GarageDeck[] = Array.from({ length: GARAGE_PLAN.decks }, (_, index) => ({
	id: `garage_deck_${index + 1}`,
	...GARAGE_PLAN.footprint,
	y: garageDeckTop(index + 1),
}));

/** Speling voor maten die exact gelijk horen te zijn. */
const PLAN_EPS = 1e-6;

/** Een z-strook, zoals een doorgang of een stuk borstwering die eromheen valt. */
export type ZBand = Readonly<{ minZ: number; maxZ: number }>;

/**
 * Waar een bordes van de spiraal op dekhoogte tegen de oostrand van een dek aankomt.
 *
 * Daar hoort de borstwering open te staan. Hij liep ongebroken rond elk dek, ook
 * langs die rand, dus wie de hele spiraal opklom stond voor een muur van een meter
 * en kwam er alleen met een sprong overheen: de helling leverde je nergens af.
 */
export function deckDoorways(deck: GarageDeck): readonly ZBand[] {
	const wanted = GARAGE_PLAN.parapet.doorway;
	return GARAGE_RAMP_LANDINGS.filter(
		(landing) =>
			Math.abs(landing.y - deck.y) <= PLAN_EPS && landing.minX <= deck.maxX + PLAN_EPS && landing.maxX > deck.maxX + PLAN_EPS,
	)
		.map((landing) => ({ minZ: Math.max(landing.minZ, deck.minZ), maxZ: Math.min(landing.maxZ, deck.maxZ) }))
		.filter((gap) => span(gap.minZ, gap.maxZ) > PLAN_EPS)
		.map((gap) => {
			// Te korte naad: verbreed hem om zijn eigen midden. Naast het hoekbordes ligt
			// de klimmende oostplaat, dus wat de opening erbij krijgt komt op een loopvlak uit.
			const grow = half(Math.max(0, wanted - span(gap.minZ, gap.maxZ)));
			return { minZ: Math.max(deck.minZ, gap.minZ - grow), maxZ: Math.min(deck.maxZ, gap.maxZ + grow) };
		});
}

/** Wat er van de strook `minZ..maxZ` overblijft als `gaps` eruit gesneden zijn. */
function bandsBetween(minZ: number, maxZ: number, gaps: readonly ZBand[]): ZBand[] {
	let bands: ZBand[] = [{ minZ, maxZ }];
	for (const gap of gaps) {
		bands = bands.flatMap((band) =>
			[
				{ minZ: band.minZ, maxZ: Math.min(band.maxZ, gap.minZ) },
				{ minZ: Math.max(band.minZ, gap.maxZ), maxZ: band.maxZ },
			].filter((piece) => span(piece.minZ, piece.maxZ) > PLAN_EPS),
		);
	}
	return bands;
}

function overlapsAny(band: ZBand, gaps: readonly ZBand[]): boolean {
	return gaps.some((gap) => gap.maxZ > band.minZ + PLAN_EPS && gap.minZ < band.maxZ - PLAN_EPS);
}

/**
 * De westrand van een bordes waar geen loopvlak achter ligt.
 *
 * Het bovenste bordes steekt een meter noordelijker dan het dek waar het op uitkomt,
 * en daar stapte je van zes en een halve meter hoogte zo het maaiveld op zonder dat
 * iets je tegenhield. Waar wél een dek of een schuine plaat aansluit blijft de rand
 * open: dat is de doorgang zelf.
 */
function landingParapets(landing: GarageDeck): GarageParapet[] {
	const t = GARAGE_PLAN.parapet.thickness;
	const carried: ZBand[] = [
		...GARAGE_DECKS.filter(
			(deck) => Math.abs(deck.y - landing.y) <= PLAN_EPS && Math.abs(deck.maxX - landing.minX) <= PLAN_EPS,
		).map((deck): ZBand => ({ minZ: deck.minZ, maxZ: deck.maxZ })),
		...GARAGE_RAMP_RUNS.filter(
			(run) => run.start.z === run.end.z && Math.abs(Math.max(run.start.x, run.end.x) - landing.minX) <= PLAN_EPS,
		).map((run): ZBand => ({ minZ: run.start.z - half(run.width), maxZ: run.start.z + half(run.width) })),
	];
	return bandsBetween(landing.minZ, landing.maxZ, carried).map((band, index) => ({
		id: `${landing.id}_parapet_w${index}`,
		minX: landing.minX,
		maxX: landing.minX + t,
		...band,
		minY: landing.y,
		maxY: landing.y + GARAGE_PLAN.parapet.height,
	}));
}

const GARAGE_DECK_PARAPETS: readonly GarageParapet[] = GARAGE_DECKS.flatMap((deck): GarageParapet[] => {
	const { minX, maxX, minZ, maxZ } = GARAGE_PLAN.footprint;
	const t = GARAGE_PLAN.parapet.thickness;
	const kant = { minY: deck.y, maxY: deck.y + GARAGE_PLAN.parapet.height };
	const doorways = deckDoorways(deck);
	// De doorgang zit in de oostrand, dus een noord- of zuidrand die eraan grenst
	// loopt een borstweringdikte korter; anders staat die hoek nog in de opening.
	const endX = (band: ZBand): number => (overlapsAny(band, doorways) ? maxX - t : maxX);
	const north: ZBand = { minZ, maxZ: minZ + t };
	const south: ZBand = { minZ: maxZ - t, maxZ };
	return [
		{ id: `${deck.id}_parapet_n`, minX, maxX: endX(north), ...north, ...kant },
		{ id: `${deck.id}_parapet_s`, minX, maxX: endX(south), ...south, ...kant },
		{ id: `${deck.id}_parapet_w`, minX, maxX: minX + t, minZ: minZ + t, maxZ: maxZ - t, ...kant },
		...bandsBetween(minZ + t, maxZ - t, doorways).map(
			(band, index): GarageParapet => ({
				id: `${deck.id}_parapet_e${index}`,
				minX: maxX - t,
				maxX,
				...band,
				...kant,
			}),
		),
	];
});

export const GARAGE_PARAPETS: readonly GarageParapet[] = [
	...GARAGE_DECK_PARAPETS,
	...GARAGE_RAMP_LANDINGS.flatMap(landingParapets),
];

/**
 * Het loopvlak van de spiraal in de oostelijke strook op `z`: het hoekbordes,
 * de klimmende oostplaat, of het bordes bovenaan. De steunpoten lezen hem, en
 * zo staan ze precies onder wat ze dragen.
 */
export function garageEastSpiralY(z: number): number {
	return lerp(garageDeckTop(1), garageDeckTop(2), inverseLerpClamped(RAMP.east.fromZ, RAMP.east.toZ, z));
}

/** Buitenrand van de oostelijke strook, waar de leuning van de oostplaat staat. */
export const GARAGE_RAMP_EAST_EDGE_X = EAST_MAX_X;

/** Zuidrand van de zuidplaat, waar zijn leuning staat. */
export const GARAGE_RAMP_SOUTH_EDGE_Z = RAMP.south.z + half(RAMP.south.width);

/** Hart van de oostelijke strook, waar de poten staan. */
export const GARAGE_RAMP_EAST_X = EAST_X;

/** De voetafdruk van de hele spiraal, voor wie hem alleen als vlak nodig heeft. */
export const GARAGE_RAMP_FOOTPRINT: Rect = {
	minX: RAMP.south.fromX,
	maxX: EAST_MAX_X,
	minZ: RAMP.east.toZ - RAMP.landingDepth,
	maxZ: GARAGE_RAMP_SOUTH_EDGE_Z,
};
