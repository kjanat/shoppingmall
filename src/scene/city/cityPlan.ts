import { CON_CITY_MARGIN, CON_LOT, CON_PLAZA } from '#/data/conPlan';
import type { Bounds2, Vec2 } from '#/data/spatial';
import { boundsMinusHoles } from '#/data/spatial';
import type { BarrierSpec } from '#/data/world';
import {
	barrierSpec,
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
	MALL_WALL_ENVELOPE,
	MOTORCYCLE_SPEC,
	PARKING_EXIT_RAIL_OUTER,
	PARKING_EXIT_RAMP,
	PARKING_EXIT_TRENCH,
	PARKING_EXIT_WALL_GAP,
	parkingExitRampY,
} from '#/data/world';
import { zoneAt, zoneBit } from '#/data/zones';
import { PLAYER_RADIUS } from '#/player/constants';
import { half, inverseLerpClamped, lerp, midpoint, span } from '#/util/math';
import { at, jitterWith, mulberry32 } from '#/util/rand';
import type { GarageDeck, Rect } from './cityPlaces';
import {
	CITY_KAVELS,
	COLOSSEUM_PLAN,
	FAVELA_PLAN,
	GARAGE_DECKS,
	GARAGE_PLAN,
	garageDeckTop,
	LANE_X,
	LANE_Z,
	PARK_LAWN,
	RIO_MOUNTAIN,
	ROAD_INNER_X,
	ROAD_INNER_Z,
	ROAD_PLAN,
} from './cityPlaces';

/**
 * De maten van de stad buiten de mall, op één plek.
 *
 * De skyline, het theater en de garage tekenden hun eigen coördinaten, en de
 * fysica had er geen. Nu de speler van het dak kan springen en er buiten
 * rondloopt, moeten collision en scene exact hetzelfde blok bedoelen: elke
 * tweede kopie van een getal is een muur die net naast zijn gevel staat.
 */

/**
 * De wereldrand. Collision klemt hierop, de drone ook. De noordrand ligt verder dan
 * de zuidrand omdat het theater in de noordoosthoek zijn backstage en achterbordes
 * achter zich heeft staan; zonder die ruimte klemt collision je de artiesteningang in.
 * East bound follows the fur-con lot so the clamp never cuts the halls short.
 */
/**
 * Walkable outdoor clamp + ground plate size.
 * West room for Montanha/favela/park, south room for the colosseum, east follows the con lot.
 */
const CITY_BOUNDS = {
	minX: -145,
	maxX: CON_LOT.maxX + CON_CITY_MARGIN,
	minZ: Math.min(-115, CON_LOT.minZ - CON_CITY_MARGIN),
	maxZ: Math.max(185, CON_LOT.maxZ + CON_CITY_MARGIN),
} as const;

/** Straatniveau. Buiten de mall ligt hier de vloer, tenzij een citySurface hoger komt. */
const CITY_GROUND_Y = 0;

/** Hoever onder straatniveau er nog buitenwereld is om in te staan. */
const FOOTPRINT_EXEMPT_DROP = 0.5;

/**
 * Mag wat op deze voethoogte staat de voetafdruk van de mall uit?
 *
 * Boven straatniveau wel: daar houden de gevels het tegen en is de dakrand een sprong
 * naar de stad. Eronder niet, want daar ligt alleen de parkeergarage en die heeft geen
 * buitenwereld. De uitrit zelf valt onder de eigen vrijstelling in `resolveCircle`.
 */
function outsideMallFootprint(feetY: number): boolean {
	return feetY > CITY_GROUND_Y - FOOTPRINT_EXEMPT_DROP;
}

/** Binnenrand van de ringweg. Het plein tussen mall en weg loopt tot hier. */
/**
 * De ringweg zelf: één rijbaan van `width` meter, met twee rijstroken naast elkaar.
 *
 * De strookindeling staat hier en niet bij de tekenaar, want het verkeer rijdt erop en
 * de wereldcontrole leest hem na. Welke kant een strook op loopt en aan welke kant van
 * de middenstreep hij ligt is één afspraak; twee kopieën ervan laten de helft van het
 * verkeer tegen de richting in rijden en niemand die het opmerkt.
 */
const ROAD_HALF_WIDTH = half(ROAD_PLAN.width);

/** Middellijnen van de rijbaan. De middenstreep ligt hier, het verkeer ernaast. */
/**
 * Hart van een rijstrook: een kwart rijbaan naast de middellijn, want twee stroken met
 * de middenstreep ertussen delen de rijbaan doormidden.
 */
const LANE_OFFSET = half(ROAD_HALF_WIDTH);

/** Welke lichtfase deze rand groen geeft. 'ns' hoort bij de randen die langs x lopen. */
type RoadPhase = 'ns' | 'ew';

/** Eén rechte rand van een rijstrook: waar hij begint, welke kant hij op loopt, hoe lang. */
type RoadEdge = Readonly<{
	ox: number;
	oz: number;
	dx: number;
	dz: number;
	rotY: number;
	len: number;
	phase: RoadPhase;
}>;

/** Eén rijstrook: vier randen met de boogafstanden erlangs voorgekauwd. */
type RoadRing = Readonly<{
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
const ROAD_RINGS: readonly RoadRing[] = [roadRing(1), roadRing(-1)];

/** Het hart van de binnenste rijstrook langs de westrand: de strook die de mall passeert. */
const RING_INNER_WEST_X = -(LANE_X - LANE_OFFSET);

/** Carrosserie van het stadsverkeer. Botsstraal, remafstand en strookbreedte hangen eraan. */
const TRAFFIC_CAR = { length: 4.2, width: 1.85 } as const;

/**
 * En die van de motorrijders op de ring. Ze rijden dezelfde stroken en hetzelfde
 * remmodel als de auto's; alleen hun eigen maat is kleiner, dus hun volgafstand en
 * hun botsstraal komen er anders uit. Afgeleid van de motor in het wereldmodel, want
 * dezelfde machine staat ook op P1 en in de hal geparkeerd.
 */
const TRAFFIC_RIDER = { length: MOTORCYCLE_SPEC.body.length, width: MOTORCYCLE_SPEC.body.width } as const;

/**
 * Wat een lichaam vrij moet houden van het hart van een rijstrook: een halve auto plus
 * zichzelf. Wie er dichterbij staat, staat in de strook.
 */
const TRAFFIC_LANE_CLEARANCE = half(TRAFFIC_CAR.width) + PLAYER_RADIUS;

/**
 * Eén zebrapad: balken dwars op de rijrichting. `sideInset` is wat er aan beide
 * kanten van de rijbaan onbeschilderd blijft, dus de balk is zoveel korter.
 */
const ZEBRA_PLAN = { bars: 6, pitch: 0.85, barWidth: 0.55, sideInset: 0.3 } as const;

/** Van de eerste tot de laatste balk: zo breed steek je over. */
const ZEBRA_WIDTH = (ZEBRA_PLAN.bars - 1) * ZEBRA_PLAN.pitch + ZEBRA_PLAN.barWidth;

/** Een oversteekplaats op de ringweg: waar hij ligt en hoe de balken erop liggen. */
type RoadCrossing = Readonly<{ id: string; x: number; z: number; rotY: number }>;

/**
 * De vier oversteekplaatsen. De westelijke ligt op de as van de hoofdingang en niet
 * op het midden van zijn rand: de loper liep vanaf de dorpel met een knik naar een
 * zebra vijf meter zuidelijker, en die knik bestond alleen omdat de entree en de
 * oversteek elkaars maat niet kenden. Nu verzet wie de deur verzet ze allebei.
 */
/**
 * Spur from the east ring face to the fur-con plaza.
 * Two-way, keep-right: eastbound on +z of centreline, westbound on −z.
 */
const CON_ACCESS = {
	/** Road centreline (z). Aligned with the east ring crossing and the con doors. */
	z: 0,
	/** Starts at the outer face of the east ring strip. */
	minX: ROAD_INNER_X + ROAD_PLAN.width,
	/** Stops short of the plaza kerb so the apron can meet the square. */
	maxX: CON_PLAZA.minX - 2,
	width: ROAD_PLAN.width,
} as const;

/** Dual-lane centres on the spur (keep right when heading east / west). */
const CON_ACCESS_LANE = {
	east: CON_ACCESS.z + LANE_OFFSET,
	west: CON_ACCESS.z - LANE_OFFSET,
} as const;

const ROAD_CROSSINGS: readonly RoadCrossing[] = [
	{ id: 'north', x: 0, z: -LANE_Z, rotY: 0 },
	{ id: 'south', x: 0, z: LANE_Z, rotY: 0 },
	{ id: 'west', x: -LANE_X, z: ENTRANCE_PORTAL.centerZ, rotY: Math.PI / 2 },
	{ id: 'east', x: LANE_X, z: 0, rotY: Math.PI / 2 },
	// Spur: travel is along x, so bars run along x (rotY 0).
	{ id: 'con-spur-ring', x: CON_ACCESS.minX + half(ZEBRA_WIDTH) + 1, z: CON_ACCESS.z, rotY: 0 },
	{ id: 'con-spur-plaza', x: CON_ACCESS.maxX - half(ZEBRA_WIDTH) - 1, z: CON_ACCESS.z, rotY: 0 },
];

function crossing(id: string): RoadCrossing {
	const found = ROAD_CROSSINGS.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`geen oversteekplaats ${id}`);
	return found;
}

/** De oversteek waar de loper van de hoofdingang op uitkomt. */
const ENTRANCE_CROSSING = crossing('west');

/**
 * De onderbroken middenstreep, in meters: streep plus gat is één tegel, en de streep
 * ligt gecentreerd in de tegel met aan beide uiteinden een half gat. Zo eindigt een
 * rechte strook halverwege een gat en sluit de bocht erachter op hetzelfde ritme aan.
 * De maat staat hier omdat de tekenaar hem in de bocht als kwartcirkel en op het rechte
 * stuk als losse rechthoeken uitzet, en `wegen` naleest dat geen streep een zebra kruist.
 */
const ROAD_DASH = { length: 3.25, gap: 4.75, width: 0.33 } as const;

/** Streep plus gat: de lengte van één tegel van de middenstreep. */
const ROAD_DASH_TILE = ROAD_DASH.length + ROAD_DASH.gap;

/**
 * De beschilderde vlek van een oversteekplaats: de balken vullen `ZEBRA_WIDTH` langs de
 * rijrichting en `ROAD_PLAN.width` min de twee `sideInset` dwars daarop. `rotY` nul legt
 * de rijrichting langs x, dus dan is de langsmaat de x-maat.
 */
function zebraBounds(plek: RoadCrossing): Bounds2 {
	const along = half(ZEBRA_WIDTH);
	const across = half(span(ZEBRA_PLAN.sideInset, ROAD_PLAN.width - ZEBRA_PLAN.sideInset));
	const langsX = plek.rotY === 0;
	return {
		minX: plek.x - (langsX ? along : across),
		maxX: plek.x + (langsX ? along : across),
		minZ: plek.z - (langsX ? across : along),
		maxZ: plek.z + (langsX ? across : along),
	};
}

/**
 * De doorgetrokken kantstreep, in meters: het hart van de streep ligt zoveel van de
 * wegrand af, en zo breed is hij. Twee ervan lopen de strook af, een aan elke rand.
 */
const ROAD_EDGE = { inset: 0.355, width: 0.164 } as const;

/** Eén recht stuk van de ringweg: langs welke as het loopt, op welke middellijn, en hoe ver naar weerskanten. */
type RoadStrip = Readonly<{ axis: 'x' | 'z'; fixed: number; reach: number }>;

const ROAD_STRIPS: readonly RoadStrip[] = [
	{ axis: 'x', fixed: LANE_Z, reach: ROAD_INNER_X },
	{ axis: 'x', fixed: -LANE_Z, reach: ROAD_INNER_X },
	{ axis: 'z', fixed: LANE_X, reach: ROAD_INNER_Z },
	{ axis: 'z', fixed: -LANE_X, reach: ROAD_INNER_Z },
];

/**
 * Een rechthoek op een strook: `along` is het hart langs de strookas met `halfAlong` naar
 * weerskanten, `across` de zijwaartse verschuiving vanaf de middellijn met `halfAcross`.
 */
function stripRect(...[strip, along, halfAlong, across, halfAcross]: [RoadStrip, number, number, number, number]): Bounds2 {
	if (strip.axis === 'x') {
		const z = strip.fixed + across;
		return { minX: along - halfAlong, maxX: along + halfAlong, minZ: z - halfAcross, maxZ: z + halfAcross };
	}
	const x = strip.fixed + across;
	return { minX: x - halfAcross, maxX: x + halfAcross, minZ: along - halfAlong, maxZ: along + halfAlong };
}

/** Wat er op de rijbaan geschilderd staat: de onderbroken middenstreep en de doorgetrokken kantstrepen. */
type RoadPaintKind = 'dash' | 'edge';
type RoadPaintPatch = Readonly<{ kind: RoadPaintKind; rect: Bounds2 }>;

/**
 * Alle wegmarkering op de rechte stukken, elk als eigen rechthoek en met de zebrapaden
 * eruit gesneden, net als de garagebelijning om de kolomvoeten heen. Een streep die een
 * oversteek kruist tekent er anders een doorlopende lijn overheen: de middenstreep een
 * plus door het midden, de kantstreep een balk dwars over de uiteinden van de zebra. Beide
 * verdwenen in de vorige opzet in de doorlopende texture-tegel van de strook.
 *
 * De middenstreep krijgt per strook een heel aantal tegels zodat hij halverwege een gat
 * eindigt en zijn ritme aansluit op de bocht; de streeplengte rekt met de tegel mee. De
 * kantstrepen lopen als één streep de strook af en breken alleen waar een zebra ligt.
 */
function roadPaintPatches(): readonly RoadPaintPatch[] {
	const holes = ROAD_CROSSINGS.map(zebraBounds);
	const patches: RoadPaintPatch[] = [];
	const cut = (kind: RoadPaintKind, rect: Bounds2): void => {
		for (const piece of boundsMinusHoles(rect, holes)) patches.push({ kind, rect: piece });
	};

	const halfDashWidth = half(ROAD_DASH.width);
	const edgeAcross = half(ROAD_PLAN.width) - ROAD_EDGE.inset;
	const halfEdgeWidth = half(ROAD_EDGE.width);
	for (const strip of ROAD_STRIPS) {
		const length = span(-strip.reach, strip.reach);
		const tiles = Math.max(1, Math.round(length / ROAD_DASH_TILE));
		const step = length / tiles;
		const halfDash = half(ROAD_DASH.length * (step / ROAD_DASH_TILE));
		for (let i = 0; i < tiles; i++) {
			const tileStart = -strip.reach + i * step;
			cut('dash', stripRect(strip, midpoint(tileStart, tileStart + step), halfDash, 0, halfDashWidth));
		}
		for (const side of [-1, 1] as const) {
			cut('edge', stripRect(strip, 0, strip.reach, side * edgeAcross, halfEdgeWidth));
		}
	}

	// Fur-con spur: paint only between ring outer face and plaza (not symmetric about origin).
	const spurLen = span(CON_ACCESS.minX, CON_ACCESS.maxX);
	const spurTiles = Math.max(1, Math.round(spurLen / ROAD_DASH_TILE));
	const spurStep = spurLen / spurTiles;
	const spurHalfDash = half(ROAD_DASH.length * (spurStep / ROAD_DASH_TILE));
	for (let i = 0; i < spurTiles; i++) {
		const tileStart = CON_ACCESS.minX + i * spurStep;
		const along = midpoint(tileStart, tileStart + spurStep);
		cut('dash', {
			minX: along - spurHalfDash,
			maxX: along + spurHalfDash,
			minZ: CON_ACCESS.z - halfDashWidth,
			maxZ: CON_ACCESS.z + halfDashWidth,
		});
	}
	for (const side of [-1, 1] as const) {
		const z = CON_ACCESS.z + side * edgeAcross;
		cut('edge', {
			minX: CON_ACCESS.minX,
			maxX: CON_ACCESS.maxX,
			minZ: z - halfEdgeWidth,
			maxZ: z + halfEdgeWidth,
		});
	}
	return patches;
}

/** Asphalt rectangle of the con access road (for scene + apron). */
const CON_ACCESS_ASPHALT: Rect = {
	minX: CON_ACCESS.minX,
	maxX: CON_ACCESS.maxX,
	minZ: CON_ACCESS.z - half(CON_ACCESS.width),
	maxZ: CON_ACCESS.z + half(CON_ACCESS.width),
};

/** Short apron from spur end into the con plaza. */
const CON_ACCESS_APRON: Rect = {
	minX: CON_ACCESS.maxX - 0.5,
	maxX: CON_PLAZA.minX + 4,
	minZ: CON_ACCESS.z - half(CON_ACCESS.width) - 1,
	maxZ: CON_ACCESS.z + half(CON_ACCESS.width) + 1,
};

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
const PLAZA_PLAN = {
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
const PLAZA_OUTER: Rect = { minX: -ROAD_INNER_X, maxX: ROAD_INNER_X, minZ: -ROAD_INNER_Z, maxZ: ROAD_INNER_Z };

/**
 * De mond van de uitritgeul blijft open. Bestrating erover is een plaat dwars over
 * de helling waar je onderdoor omhoog rijdt.
 */
const PLAZA_TRENCH_GAP: Rect = {
	minX: PARKING_EXIT_TRENCH.minX,
	maxX: PARKING_EXIT_TRENCH.coverX,
	minZ: -PARKING_EXIT_WALL_GAP,
	maxZ: PARKING_EXIT_WALL_GAP,
};

/**
 * Het voorplein van de hoofdingang legt zijn eigen bestrating en de loper naar het
 * zebrapad. Daar hoeft geen straatmeubilair bij te komen staan.
 */
const PLAZA_ENTRANCE_GAP: Rect = {
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
const ENTRANCE_CARPET: Rect = {
	minX: PLAZA_OUTER.minX,
	maxX: ENTRANCE_PORTAL.outerX + ENTRANCE_SPEC.carpet.startInset,
	minZ: ENTRANCE_PORTAL.centerZ - half(ENTRANCE_SPEC.carpet.width),
	maxZ: ENTRANCE_PORTAL.centerZ + half(ENTRANCE_SPEC.carpet.width),
};

/** Bovenkant van de bestrating. */
const PLAZA_TOP_Y = CITY_GROUND_Y - PLAZA_PLAN.sink;

/**
 * Het maaiveld van de wereld buiten de mall.
 *
 * Dat was één plaat op y −0,5 terwijl collision je op `CITY_GROUND_Y` laat lopen en
 * alles wat er buiten staat zijn voet op 0 heeft: de torens, het park, het
 * theaterpodium en het maaiveld-dek van de garage stonden allemaal een halve meter
 * boven de grond die ze moesten raken. De plaat ligt nu net onder het loopvlak, en
 * nog een tikje onder de bestrating zodat die twee niet tegen elkaar op flikkeren.
 */
const CITY_GROUND_PLANE_Y = PLAZA_TOP_Y - PLAZA_PLAN.sink;

/**
 * De inrit: het stuk rijbaan tussen de binnenrand van de ringweg en de mond van de
 * uitritgeul. Daartussen lag twee meter bestrating, dus het asfalt hield op x −48 op
 * en de helling begon pas op x −46 — een naad waar niemand overheen kon rijden.
 * Hij ligt op de hoogte van het straateind van de helling, zodat er geen drempel op
 * de naad staat.
 */
const EXIT_APRON: Rect = {
	minX: PLAZA_OUTER.minX,
	maxX: PARKING_EXIT_TRENCH.minX,
	minZ: -PARKING_EXIT_RAIL_OUTER,
	maxZ: PARKING_EXIT_RAIL_OUTER,
};

/** Bovenkant van de inrit: het loopvlak van de helling waar hij tegenaan komt. */
const EXIT_APRON_TOP_Y = parkingExitRampY(EXIT_APRON.maxX);

/** Halve rijstrook op de uitrit: naar binnen rijd je +z, naar buiten −z, en dat is rechts houden. */
const EXIT_LANE_OFFSET = half(half(PARKING_EXIT_RAMP.width));

/** Waar de auto beneden omdraait: tussen twee kolomlijnen in, ruim voor de vakken langs. */
const EXIT_TURN_X = -20;

/** Een knikpunt van de aftakking. `park` is het punt waar de auto beneden stilstaat. */
type RoutePoint = Readonly<{ x: number; y: number; z: number; park?: boolean }>;

/**
 * De aftakking van de ringweg naar P1: van de binnenste rijstrook de inrit op, de
 * geul af, beneden omdraaien en dezelfde weg terug naar dezelfde strook.
 *
 * De heen- en terugbaan liggen elk op hun eigen helft van de geul, dus de auto die
 * naar binnen rijdt en die naar buiten komt passeren elkaar zoals ze dat op de ring
 * ook doen. De hoogtes komen van de helling zelf: een tweede getal ernaast zou de
 * auto een halve meter boven of onder zijn eigen dek zetten.
 */
const EXIT_BRANCH_ROUTE: readonly RoutePoint[] = [
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
 * Aftakking oost-ring → fur-con spur: de buitenste strook (oost, noordwaarts) verlaat
 * de ring, rijdt oost naar de plaza, keert, en komt op dezelfde strook terug.
 * Hart van de oostbaan op de buitenste ring is x = LANE_X + LANE_OFFSET.
 */
const CON_BRANCH_ROUTE: readonly RoutePoint[] = [
	{ x: LANE_X + LANE_OFFSET, y: CITY_GROUND_Y, z: 0 },
	{ x: CON_ACCESS.minX + 4, y: CITY_GROUND_Y, z: CON_ACCESS_LANE.east },
	{ x: CON_ACCESS.maxX - 4, y: CITY_GROUND_Y, z: CON_ACCESS_LANE.east },
	{ x: CON_ACCESS.maxX + 4, y: CITY_GROUND_Y, z: CON_ACCESS_LANE.east, park: true },
	{ x: CON_ACCESS.maxX + 4, y: CITY_GROUND_Y, z: CON_ACCESS_LANE.west },
	{ x: CON_ACCESS.minX + 4, y: CITY_GROUND_Y, z: CON_ACCESS_LANE.west },
	{ x: LANE_X + LANE_OFFSET, y: CITY_GROUND_Y, z: 0 },
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
const CITY_TRAFFIC_ZONES: number = (() => {
	let mask = 0;
	for (const point of EXIT_BRANCH_ROUTE) mask |= zoneBit(zoneAt(point.x, point.y, point.z));
	for (const point of CON_BRANCH_ROUTE) mask |= zoneBit(zoneAt(point.x, point.y, point.z));
	for (const ring of ROAD_RINGS) {
		for (const rand of ring.edges) {
			mask |= zoneBit(zoneAt(rand.ox, CITY_GROUND_Y, rand.oz));
			mask |= zoneBit(zoneAt(rand.ox + rand.dx * rand.len, CITY_GROUND_Y, rand.oz + rand.dz * rand.len));
		}
	}
	return mask;
})();

/**
 * De slagboom op de inrit. Hij staat naast de heenstrook en zijn arm reikt tot de
 * hartlijn van de geul, dus wie naar binnen wil staat ervoor en wie naar buiten
 * komt rijdt er langs.
 *
 * Zijn maten én wie hij doorlaat staan bij de andere bomen in het wereldmodel: de
 * arm is een `automatic-gate` met een toelatingsbeleid, en dat hoort naast de arm
 * te staan en niet in de bestuurder die ervoor remt.
 */
const EXIT_BOOM: BarrierSpec = barrierSpec('parking-exit-boom');

/** Punt van de arm als hij ligt: de hartlijn van de geul. */
const EXIT_BOOM_TIP_Z = EXIT_BOOM.post.z + EXIT_BOOM.armSide * EXIT_BOOM.armLength;

/** Hoeveel de plaat voorbij de wereldrand doorloopt, zodat er geen kant in beeld komt. */
const CITY_GROUND_MARGIN = 25;

/** Groeit een rechthoek met `margin` aan alle kanten. */
function grownRect(rect: Rect, margin: number): Rect {
	return { minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin };
}

/** Waar de maaiveldplaat ligt: de hele wereld, met een rand eromheen. */
const CITY_GROUND_PLAN: Rect = grownRect(CITY_BOUNDS, CITY_GROUND_MARGIN);

function inRect(rect: Rect, x: number, z: number): boolean {
	return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/**
 * Stations op de omtrek van `ring`, om de `spacing` meter, beginnend op de
 * noordwesthoek. Het aantal wordt op een heel getal afgerond zodat de laatste stap
 * even lang is als de eerste en de ring dus rond loopt.
 */
function ringStations(ring: Rect, spacing: number): readonly Vec2[] {
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
function plazaStations(): readonly Vec2[] {
	const rings: Rect[] = [grownRect(MALL_WALL_ENVELOPE, PLAZA_PLAN.facadeOffset), grownRect(PLAZA_OUTER, -PLAZA_PLAN.kerbOffset)];
	const keepOut = [PLAZA_TRENCH_GAP, PLAZA_ENTRANCE_GAP].map((rect) => grownRect(rect, PLAZA_PLAN.keepOut));
	return rings.flatMap((ring) => ringStations(ring, PLAZA_PLAN.spacing).filter((s) => !keepOut.some((r) => inRect(r, s.x, s.z))));
}

type Rand = () => number;

const TOWER_SEED = 0x404;

type TowerSpec = Readonly<{ x: number; z: number; w: number; d: number; h: number; rot: number }>;

/**
 * Kavels van theater, garage en park — daar bouwt de skyline niet overheen.
 * "Building's in the way" was letterlijk waar: torens verzwolgen de marquee. Het
 * theaterkavel reikt nu tot achter de backstage en zijn achterbordes, zodat er geen
 * toren tegen de artiesteningang komt te staan.
 */
/** Ground height of the village: climbs from the ring to the Redeemer, plateau west of him. */
function favelaGroundY(x: number, _z: number): number {
	const { maxX, minX, yLow, yHigh } = FAVELA_PLAN;
	const peakX = RIO_MOUNTAIN.x;
	if (x <= peakX) {
		// West of Jesus: stay near peak height (slight fall toward the west cliff).
		const t = inverseLerpClamped(peakX, minX, x);
		return lerp(yHigh, yHigh * 0.94, t);
	}
	const t = inverseLerpClamped(maxX, peakX, x);
	return lerp(yLow, yHigh, t);
}

/** Contour street X positions (east → west up the hill). */
function favelaContourXs(): readonly number[] {
	const { minX, maxX, contours } = FAVELA_PLAN;
	const xs: number[] = [];
	for (let i = 1; i < contours; i++) {
		xs.push(lerp(maxX, minX, i / contours));
	}
	return xs;
}

/**
 * Free street cells: contour lanes (N–S), switchback ramps between them (E–W at
 * alternating ends), a centre spine, the peak plaza, and the road apron.
 */
function favelaIsStreet(x: number, z: number): boolean {
	const { minX, maxX, minZ, maxZ, alleyHalf, streetHalf, contours, plazaR } = FAVELA_PLAN;
	const zc = midpoint(minZ, maxZ);
	if (x > maxX - 1.5) return true;
	if (Math.hypot(x - RIO_MOUNTAIN.x, z - RIO_MOUNTAIN.z) < plazaR) return true;
	for (const bandX of favelaContourXs()) {
		if (Math.abs(x - bandX) < streetHalf) return true;
	}
	// Switchback ramps: between contour i and i+1, free only on alternating flank.
	for (let i = 0; i < contours; i++) {
		const x0 = lerp(maxX, minX, i / contours);
		const x1 = lerp(maxX, minX, (i + 1) / contours);
		const lo = Math.min(x0, x1) - alleyHalf * 0.25;
		const hi = Math.max(x0, x1) + alleyHalf * 0.25;
		if (x < lo || x > hi) continue;
		const rampZ = i % 2 === 0 ? minZ + alleyHalf * 2.2 : maxZ - alleyHalf * 2.2;
		if (Math.abs(z - rampZ) < alleyHalf) return true;
	}
	// Centre spine up the mountain (main village street).
	if (Math.abs(z - zc) < alleyHalf) return true;
	// Two side spines so the village has three ways up.
	if (Math.abs(z - (zc - 12)) < alleyHalf * 0.9) return true;
	if (Math.abs(z - (zc + 12)) < alleyHalf * 0.9) return true;
	return false;
}

const KAVELS: readonly Rect[] = Object.values(CITY_KAVELS);

function opKavel(x: number, z: number, w: number, d: number): boolean {
	return KAVELS.some((k) => x + half(w) > k.minX && x - half(w) < k.maxX && z + half(d) > k.minZ && z - half(d) < k.maxZ);
}

/**
 * ~30 torens in vier banden om de ringweg: |x| 58..90 of |z| 44..72,
 * netjes binnen de wereldgrens, ook mét halve breedte.
 */
function planTowers(rand: Rand): TowerSpec[] {
	const specs: TowerSpec[] = [];
	const bands: [number, () => [number, number]][] = [
		[9, () => [lerp(-120, 100, rand()), -lerp(48, 95, rand())]], // noord
		[9, () => [lerp(-120, 100, rand()), lerp(48, 95, rand())]], // zuid
		[8, () => [lerp(60, 95, rand()), lerp(-80, 80, rand())]], // oost
		[10, () => [-lerp(60, 130, rand()), lerp(-80, 80, rand())]], // west (extra land)
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
const TOWER_SPECS: readonly TowerSpec[] = planTowers(mulberry32(TOWER_SEED));

/**
 * De parkeergarage op het ZO-kavel. Het maaiveld-dek is open aan alle zijden,
 * dus daar loop je zo tussen de kolommen door naar binnen.
 *
 * De buitenspiraal om de ZO-hoek stond als losse getallen in `buildRamp` en was
 * daarmee decor: de platen hadden geen fysica en je liep er dwars doorheen naar
 * beneden. Ze staan hier omdat de mesh, de collision en de wereldcontrole
 * dezelfde helling moeten bedoelen.
 */
const RAMP = GARAGE_PLAN.ramp;

/** De strook oost van de gevel waarin de oostplaat en beide bordessen liggen. */
const EAST_MIN_X = GARAGE_PLAN.footprint.maxX;
const EAST_MAX_X = EAST_MIN_X + RAMP.east.width;
const EAST_X = midpoint(EAST_MIN_X, EAST_MAX_X);

/** Een schuine plaat van de spiraal: `start` en `end` liggen op zijn loopvlak. */
type GarageRampRun = Readonly<{
	id: string;
	start: Readonly<{ x: number; y: number; z: number }>;
	end: Readonly<{ x: number; y: number; z: number }>;
	width: number;
}>;

/** Een vlak loopvlak van de garage: een bordes van de spiraal of een heel dek. */
/** Een borstweringdoos: hij houdt je tegen zolang je op het dek eronder staat. */
type GarageParapet = Readonly<Rect & { id: string; minY: number; maxY: number }>;

const GARAGE_RAMP_RUNS: readonly GarageRampRun[] = [
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
const GARAGE_RAMP_LANDINGS: readonly GarageDeck[] = [
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
/** Speling voor maten die exact gelijk horen te zijn. */
const PLAN_EPS = 1e-6;

/** Een z-strook, zoals een doorgang of een stuk borstwering die eromheen valt. */
type ZBand = Readonly<{ minZ: number; maxZ: number }>;

/**
 * Waar een bordes van de spiraal op dekhoogte tegen de oostrand van een dek aankomt.
 *
 * Daar hoort de borstwering open te staan. Hij liep ongebroken rond elk dek, ook
 * langs die rand, dus wie de hele spiraal opklom stond voor een muur van een meter
 * en kwam er alleen met een sprong overheen: de helling leverde je nergens af.
 */
function deckDoorways(deck: GarageDeck): readonly ZBand[] {
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

const GARAGE_PARAPETS: readonly GarageParapet[] = [
	...GARAGE_DECK_PARAPETS,
	...GARAGE_RAMP_LANDINGS.flatMap(landingParapets),
];

/**
 * Het loopvlak van de spiraal in de oostelijke strook op `z`: het hoekbordes,
 * de klimmende oostplaat, of het bordes bovenaan. De steunpoten lezen hem, en
 * zo staan ze precies onder wat ze dragen.
 */
function garageEastSpiralY(z: number): number {
	return lerp(garageDeckTop(1), garageDeckTop(2), inverseLerpClamped(RAMP.east.fromZ, RAMP.east.toZ, z));
}

/** Buitenrand van de oostelijke strook, waar de leuning van de oostplaat staat. */
const GARAGE_RAMP_EAST_EDGE_X = EAST_MAX_X;

/** Zuidrand van de zuidplaat, waar zijn leuning staat. */
const GARAGE_RAMP_SOUTH_EDGE_Z = RAMP.south.z + half(RAMP.south.width);

/** Hart van de oostelijke strook, waar de poten staan. */
const GARAGE_RAMP_EAST_X = EAST_X;

/** De voetafdruk van de hele spiraal, voor wie hem alleen als vlak nodig heeft. */
const GARAGE_RAMP_FOOTPRINT: Rect = {
	minX: RAMP.south.fromX,
	maxX: EAST_MAX_X,
	minZ: RAMP.east.toZ - RAMP.landingDepth,
	maxZ: GARAGE_RAMP_SOUTH_EDGE_Z,
};

export {
	CITY_BOUNDS,
	CITY_GROUND_PLAN,
	CITY_GROUND_PLANE_Y,
	CITY_GROUND_Y,
	CITY_KAVELS,
	CITY_TRAFFIC_ZONES,
	COLOSSEUM_PLAN,
	CON_ACCESS,
	CON_ACCESS_APRON,
	CON_ACCESS_ASPHALT,
	CON_ACCESS_LANE,
	CON_BRANCH_ROUTE,
	deckDoorways,
	ENTRANCE_CARPET,
	ENTRANCE_CROSSING,
	EXIT_APRON,
	EXIT_APRON_TOP_Y,
	EXIT_BOOM,
	EXIT_BOOM_TIP_Z,
	EXIT_BRANCH_ROUTE,
	EXIT_LANE_OFFSET,
	FAVELA_PLAN,
	GARAGE_DECKS,
	GARAGE_PARAPETS,
	GARAGE_PLAN,
	GARAGE_RAMP_EAST_EDGE_X,
	GARAGE_RAMP_EAST_X,
	GARAGE_RAMP_FOOTPRINT,
	GARAGE_RAMP_LANDINGS,
	GARAGE_RAMP_RUNS,
	GARAGE_RAMP_SOUTH_EDGE_Z,
	LANE_OFFSET,
	LANE_X,
	LANE_Z,
	PARK_LAWN,
	PLAZA_ENTRANCE_GAP,
	PLAZA_OUTER,
	PLAZA_PLAN,
	PLAZA_TOP_Y,
	PLAZA_TRENCH_GAP,
	RIO_MOUNTAIN,
	RING_INNER_WEST_X,
	ROAD_CROSSINGS,
	ROAD_DASH,
	ROAD_DASH_TILE,
	ROAD_EDGE,
	ROAD_INNER_X,
	ROAD_INNER_Z,
	ROAD_PLAN,
	ROAD_RINGS,
	TOWER_SEED,
	TOWER_SPECS,
	TRAFFIC_CAR,
	TRAFFIC_LANE_CLEARANCE,
	TRAFFIC_RIDER,
	ZEBRA_PLAN,
	ZEBRA_WIDTH,
	outsideMallFootprint,
	garageDeckTop,
	garageEastSpiralY,
	grownRect,
	ringStations,
	plazaStations,
	favelaGroundY,
	favelaContourXs,
	favelaIsStreet,
	planTowers,
	roadPaintPatches,
	zebraBounds,
};
export type {
	GarageDeck,
	GarageParapet,
	GarageRampRun,
	Rand,
	Rect,
	RoadCrossing,
	RoadEdge,
	RoadPaintKind,
	RoadPaintPatch,
	RoadPhase,
	RoadRing,
	RoutePoint,
	TowerSpec,
	ZBand,
};
