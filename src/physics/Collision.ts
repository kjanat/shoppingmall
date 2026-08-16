import { STANDING_PEDESTRIAN } from '#/data/character';
import type { VerticalConnector } from '#/data/connectors';
import { conColliders, conSurfaces } from '#/data/conWorld';
import { ATRIUM_BARRIER, ATRIUM_VOID, MALL_FOOTPRINT } from '#/data/layout';
import { LEVELS, levelY } from '#/data/levels';
import { POOL_FLOOR_Y, POOL_WATER_Y, poolFloorY } from '#/data/pool';
import type { Bounds2, Occlusion, Vec3 } from '#/data/spatial';
import { planBounds, SIGHT_BLOCKING_TAG } from '#/data/spatial';
import { STORES } from '#/data/stores';
import type { ClimbMode } from '#/data/world';
import {
	atriumPlanterTiers,
	BACKSTAGE_LANDING,
	backstageLandingTreadY,
	backstageLandingTreadZ,
	CATWALK_DECK,
	connectorClimbModes,
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
	FOUNTAIN_SPEC,
	KIOSK_SPEC,
	PARKING_EXIT_RAMP,
	PARKING_EXIT_WALL_GAP,
	parkingDeckColliders,
	parkingExitRampY,
	parkingExitTrenchColliders,
	SLAB_SPEC_BY_LEVEL,
	SLIDE_LADDER_CLIMB,
	SLIDE_PLATFORM,
	SLIDE_PLATFORM_TOP_Y,
	shopRoomDepth,
	slabOpeningWithin,
	THEATRE_INTERIOR,
	THEATRE_PLAN,
	THEATRE_STAGE_FRONT_Z,
	THEATRE_STAGE_TOP_Y,
	theatreColliders,
	theatreRowY,
	theatreSurfaces,
	theatreTreadY,
	theatreTreadZ,
	VERTICAL_CONNECTORS,
} from '#/data/world';
import { favelaColliders, favelaFillColliders, favelaSurfaces } from '#/scene/city/CityFavela';
import { rioMountainColliders, rioMountainSurfaces } from '#/scene/city/CityRioMountain';
import {
	CITY_BOUNDS,
	CITY_GROUND_Y,
	GARAGE_DECKS,
	GARAGE_PARAPETS,
	GARAGE_PLAN,
	GARAGE_RAMP_LANDINGS,
	GARAGE_RAMP_RUNS,
	PLAZA_TRENCH_GAP,
	TOWER_SPECS,
} from '#/scene/city/cityPlan';
import { pointInSegmentStrip2, segmentParameter2 } from '#/util/geometry2';
import { clamp, half, inverseLerpClamped, lerp, midpoint, span } from '#/util/math';

export { ESCALATOR_SPEED } from '#/data/world';

export interface AABB {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	/** Optional vertical range — if set, only collide when agent Y is in range */
	minY?: number;
	maxY?: number;
	label?: string;
	/**
	 * Wie deze doorgang doorlóópt in plaats van erin te botsen, per verplaatsingswijze.
	 * Een voetganger neemt de trap en de roltrap (`walking`); een voertuig alleen wat
	 * ook `wheeled` toelaat, zoals de lift. Afwezig is massief voor iedereen.
	 */
	climbable?: readonly ClimbMode[];
	/** Stands outside the mall; only tested for agents that are allowed out there. */
	outdoor?: boolean;
	/**
	 * Zet een gate hierop zodra hij openstaat.
	 *
	 * Een slagboom is dezelfde doos, of hij nu ligt of rechtop staat; wat verandert
	 * is of hij nog in de doorgang hangt. Hem weghalen en teruggooien zou de lijst
	 * elke keer opnieuw indelen, en dat is precies de lus die per frame drie keer
	 * over alle dozen loopt.
	 */
	disabled?: boolean;
	/** What this box is, for queries that care about more than a body hitting it. */
	tags?: readonly string[];
}

interface BoxOptions {
	minY?: number;
	maxY?: number;
	label?: string;
	climbable?: readonly ClimbMode[];
	outdoor?: boolean;
	disabled?: boolean;
	tags?: readonly string[];
}

/**
 * Een doos die ook het zicht tegenhoudt.
 *
 * Niet iedere doos doet dat. Het atriumhek en de roltrapkokers lopen van de vloer
 * tot boven het dak omdat een lopend lichaam er zo omheen gestuurd wordt; wie ze
 * als muur leest legt een muur dwars door het gebouw. Glas houdt wél een lichaam
 * tegen en geen blik, dus de pui en de glazen lift dragen hem evenmin.
 */
function opaque(options: BoxOptions): BoxOptions {
	return { ...options, tags: [...(options.tags ?? []), SIGHT_BLOCKING_TAG] };
}

/** Onder deze loop staan twee kijkers op dezelfde plek en is er geen lijn te trekken. */
const SIGHT_MIN_RUN = 1e-4;

/**
 * Staat dit punt in de doos? Met de hoogte erbij.
 *
 * Zonder y stond wie op een borstwering of een winkelrug klom in elke doos onder
 * zich, en dan gold de vrijstelling hieronder voor het hele segment: één stap op
 * een muur maakte diezelfde muur doorzichtig.
 */
function insideBox(b: AABB, x: number, y: number, z: number): boolean {
	if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
	if (b.minY !== undefined && y < b.minY) return false;
	if (b.maxY !== undefined && y > b.maxY) return false;
	return true;
}

/**
 * Het stukje grondvlak dat het segment beslaat terwijl het tussen twee hoogtes zit.
 *
 * Een kogel legt schuin af; alleen het deel van zijn stap dat werkelijk in de
 * plaatdikte valt zegt iets over waar hij die plaat raakt.
 */
function segmentPlanWithin(from: Vec3, to: Vec3, lowY: number, highY: number): Bounds2 {
	const rise = to.y - from.y;
	const flat = Math.abs(rise) < SIGHT_MIN_RUN;
	const low = flat ? 0 : inverseLerpClamped(from.y, to.y, lowY);
	const high = flat ? 1 : inverseLerpClamped(from.y, to.y, highY);
	const start = Math.min(low, high);
	const end = Math.max(low, high);
	const startX = lerp(from.x, to.x, start);
	const endX = lerp(from.x, to.x, end);
	const startZ = lerp(from.z, to.z, start);
	const endZ = lerp(from.z, to.z, end);
	return {
		minX: Math.min(startX, endX),
		maxX: Math.max(startX, endX),
		minZ: Math.min(startZ, endZ),
		maxZ: Math.max(startZ, endZ),
	};
}

/** De plakjesmethode in XZ: het segment raakt de doos als beide assen elkaar overlappen. */
function segmentCrossesBox(b: AABB, x: number, z: number, dx: number, dz: number): boolean {
	let enter = 0;
	let exit = 1;
	for (const axis of [
		{ origin: x, delta: dx, min: b.minX, max: b.maxX },
		{ origin: z, delta: dz, min: b.minZ, max: b.maxZ },
	]) {
		if (Math.abs(axis.delta) < SIGHT_MIN_RUN) {
			if (axis.origin < axis.min || axis.origin > axis.max) return false;
			continue;
		}
		const first = (axis.min - axis.origin) / axis.delta;
		const second = (axis.max - axis.origin) / axis.delta;
		const near = Math.min(first, second);
		const far = Math.max(first, second);
		if (near > enter) enter = near;
		if (far < exit) exit = far;
		if (enter > exit) return false;
	}
	return enter <= exit;
}

/**
 * Een doos die een kamer zelf aanlevert.
 *
 * Zonder hoogte loopt hij van onder de vloer tot boven een hoofd en houdt hij het
 * zicht tegen, want dat is wat een kamerwand is. Een bank van kniehoogte is dat
 * niet: die zet zijn eigen `maxY` en laat het zicht door.
 */
export type RoomCollider = Readonly<{
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	label: string;
	minY?: number;
	maxY?: number;
	blocksSight?: boolean;
}>;

/** A flat walkable rectangle in the city, above street level. */
export interface CitySurface {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	label: string;
}

/** A walkable incline running along Z (escalator / stairs). */
export interface Ramp {
	minX: number;
	maxX: number;
	zBottom: number;
	zTop: number;
	yBottom: number;
	yTop: number;
	label: string;
	/**
	 * Z span of the hole cut in the floor-1 slab above this flight — must match
	 * the `addRectHole` calls in MallBuilder. Inside it there is no slab, so a
	 * walker either rides the incline or drops onto it.
	 */
	openMinZ: number;
	openMaxZ: number;
	/**
	 * Tredesnelheid langs de helling (m/s) van een helling die zelf beweegt.
	 * Ontbreekt hij, dan is het een gewone trap en vervoert hij niemand.
	 */
	carrySpeed?: number;
	/** Dikte onder het loopvlak wanneer de ruimte onder deze vlucht open is. */
	openUndersideThickness?: number;
}

export type BodyClearance = Readonly<{ feetY: number; height: number }>;

/**
 * Een vlak dakstuk. `disabled` betekent hier hetzelfde als op een AABB: een luik is
 * dezelfde plaat of hij nu dicht ligt of openstaat, en wat verandert is of er vloer
 * boven het gat hangt.
 */
export interface RoofPad {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	label?: string;
	disabled?: boolean;
}

/**
 * A low deck whose top face is the walkable surface. `nose` rounds off the maxZ end:
 * past `centerZ` the deck is that circle, so the box corners beyond it are not floor.
 */
export interface Platform {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	y: number;
	label: string;
	nose?: { centerZ: number; radius: number };
}

type PathRamp = Readonly<{
	start: Readonly<{ x: number; y: number; z: number }>;
	end: Readonly<{ x: number; y: number; z: number }>;
	width: number;
	label: string;
}>;

/**
 * Onder deze loop is een helling geen helling meer en levert hij geen vloer op.
 * `pointInSegmentStrip2` weigert alleen een strip van precies nul lang en
 * `segmentParameter2` deelt door het kwadraat van de loop, dat onder ~1.5e-162 m
 * naar nul onderloopt: dan komt er t = 0 uit en krijgt elk punt in de strip de
 * beginhoogte in plaats van niets.
 */
const MIN_RAMP_RUN = 1e-6;

function pathRampSurface(ramp: PathRamp, x: number, z: number, margin = 0): number | null {
	const { start, end } = ramp;
	if (Math.hypot(end.x - start.x, end.z - start.z) <= MIN_RAMP_RUN) return null;
	if (!pointInSegmentStrip2(x, z, start.x, start.z, end.x, end.z, ramp.width, margin)) return null;
	const t = segmentParameter2(x, z, start.x, start.z, end.x, end.z);
	return start.y + (end.y - start.y) * t;
}

function connectorRamp(connector: VerticalConnector): Ramp {
	return {
		minX: connector.collision.minX,
		maxX: connector.collision.maxX,
		zBottom: connector.zBottom,
		zTop: connector.zTop,
		yBottom: levelY(connector.from),
		yTop: levelY(connector.to),
		label: connector.id,
		openMinZ: connector.collision.openMinZ,
		openMaxZ: connector.collision.openMaxZ,
		...(connector.collision.carrySpeed === undefined ? {} : { carrySpeed: connector.collision.carrySpeed }),
		...(connector.kind === 'stairs' ? { openUndersideThickness: connector.appearance.step.treadThickness } : {}),
	};
}

/** One storey */
const FLOOR_H = levelY('v1') - levelY('v0');
const ROOF_H = levelY('roof');
const BASEMENT_H = levelY('p1');
/**
 * Hoogteverschil waarbinnen een lopende speler een vlak nog als zijn vloer ziet.
 * Controls geeft hem mee aan `groundHeightAt`, `rampCarryAt` rekent met dezelfde
 * waarde: een bewegende helling hoort je precies dan te vervoeren als je er ook
 * echt op staat. Stond hij hier ruimer, dan sleepte de roltrap je onderaan ook
 * mee terwijl je gewoon op de vloerplaat eronder liep.
 */
export const WALK_STEP = 0.5;

/** Hoeveel de kerbdoos onder het loopvlak van een platform stopt, zodat je erop kunt staan. */
const KERB_LIP = 0.04;

/**
 * Hoever een lichaam onder een doos mag staan en er nog tegenaan botst. Een
 * drempel van deze hoogte loop je op; wie hem alleen na de stap toepast en niet
 * bij het bijsturen ervoor, stuurt om een doos heen die hem niet tegenhoudt.
 */
const BOX_FOOT_SLACK = 0.3;

/** Zo ver van zijn eigen twee einden af telt een vlucht als "je staat er middenop". */
export const RAMP_BAND_MARGIN = 0.4;

/**
 * Waar de buitenschil ophoudt. Onder het dakdek houdt hij je binnen, erboven
 * niet: over de dakrand stappen is de sprong naar de stad, en dat is het punt.
 */
const SHELL_TOP_Y = ROOF_H - 0.35;

/** Dikte van een kerbdoos rond een stadsdek. */
const KERB_T = 0.25;

/** Onder deze breedte is een reststrook geen loopvlak meer, maar rekenruis van de knip. */
const ROOF_PAD_MIN = 1e-6;

/**
 * Rechthoekige dekking van `outer` minus de rechthoekige `holes`, met de strip-methode:
 * de x-randen van de gaten knippen `outer` in kolommen, en per kolom knippen de z-randen
 * van de daar kruisende gaten hem in stukken die buiten elk gat vallen.
 */
function coverMinusHoles(outer: Bounds2, holes: readonly Bounds2[]): Bounds2[] {
	const xEdges = new Set<number>([outer.minX, outer.maxX]);
	for (const h of holes) {
		if (h.maxX <= outer.minX || h.minX >= outer.maxX) continue;
		xEdges.add(Math.max(outer.minX, h.minX));
		xEdges.add(Math.min(outer.maxX, h.maxX));
	}
	const xs = [...xEdges].sort((a, b) => a - b);
	const rects: Bounds2[] = [];
	for (let i = 0; i < xs.length - 1; i++) {
		const x0 = xs[i];
		const x1 = xs[i + 1];
		if (x0 === undefined || x1 === undefined || x1 - x0 < ROOF_PAD_MIN) continue;
		const xMid = midpoint(x0, x1);
		const crossing = holes.filter((h) => h.minX < xMid && h.maxX > xMid && h.minZ < outer.maxZ && h.maxZ > outer.minZ);
		const zEdges = new Set<number>([outer.minZ, outer.maxZ]);
		for (const h of crossing) {
			zEdges.add(Math.max(outer.minZ, h.minZ));
			zEdges.add(Math.min(outer.maxZ, h.maxZ));
		}
		const zs = [...zEdges].sort((a, b) => a - b);
		for (let j = 0; j < zs.length - 1; j++) {
			const z0 = zs[j];
			const z1 = zs[j + 1];
			if (z0 === undefined || z1 === undefined || z1 - z0 < ROOF_PAD_MIN) continue;
			const zMid = midpoint(z0, z1);
			if (crossing.some((h) => h.minZ < zMid && h.maxZ > zMid)) continue;
			rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
		}
	}
	return rects;
}

/**
 * De loopbare dakplaat, uit dezelfde plaat-spec die de tekenaar snijdt: de dakslab minus
 * zijn eigen gaten (atrium, het geheime-trapgat en de dakliftschacht). Zo draagt elk punt
 * van het getekende dak op dakhoogte, blijft het atrium open voor de drone door de skylight,
 * en blijft het luik een gat; het geheime-trapgat werd hiervoor met de hand rond geknipt.
 */
const ROOF_DECK_PADS: readonly RoofPad[] = coverMinusHoles(
	planBounds(SLAB_SPEC_BY_LEVEL['roof'].plan),
	SLAB_SPEC_BY_LEVEL['roof'].holes.map(planBounds),
).map((r) => ({ ...r, y: ROOF_H, label: 'roof_deck' }));

/**
 * Tredesnelheid van de roltrap langs de helling (m/s). Staat hier omdat de
 * fysica hem nodig heeft om je te vervoeren en MallBuilder om de treden ermee te
 * tekenen. Twee losse getallen die gelijk moeten blijven glijden vroeg of laat
 * uit elkaar, en dan lopen de treden onder je voeten door.
 */
/**
 * Lightweight horizontal collision world (XZ cylinders vs AABBs).
 * Keeps player + sims out of walls, stores, escalator/stairs volumes.
 */
export class CollisionWorld {
	readonly boxes: AABB[] = [];
	readonly pathRamps: readonly PathRamp[] = [
		{
			start: PARKING_EXIT_RAMP.start,
			end: PARKING_EXIT_RAMP.end,
			width: PARKING_EXIT_RAMP.width,
			label: PARKING_EXIT_RAMP.id,
		},
		// De buitenspiraal van de stadsgarage. Zonder deze twee stond er decor:
		// citySurfaces zijn vlakke rechthoeken, dus een schuine plaat leverde geen
		// vloer op en je liep er dwars doorheen naar het maaiveld.
		...GARAGE_RAMP_RUNS.map((run): PathRamp => ({ start: run.start, end: run.end, width: run.width, label: run.id })),
	];
	/** Inclines the player can actually walk up — mirrors the built geometry. */
	readonly ramps: Ramp[] = [
		...VERTICAL_CONNECTORS.map(connectorRamp),
		// Glijbaan-ladder op het dakeiland: extreem steile "ramp" — loop er
		// noordwaarts tegenaan en je klautert naar het platform (arcade-klimmen)
		{ ...SLIDE_LADDER_CLIMB, yBottom: ROOF_H, yTop: SLIDE_PLATFORM_TOP_Y, label: 'slide_ladder' },
	];
	/** De connector bij zijn collisionlabel; onderdoor rijden vraagt dit in de frameloop. */
	private readonly rampByLabel = new Map(this.ramps.map((ramp) => [ramp.label, ramp]));

	/**
	 * Het loopbare dak, exact de getekende dakplaat: de dakslab minus zijn eigen gaten.
	 * Stopte de dekking eerder vóór de gevel, dan liep je aan de rand over kale slab die
	 * `groundHeightAt` niet droeg en zakte je door het dak het gebouw in. `poolFloorY` gaat
	 * voor deze dekking, dus in het dakbad waad je nog steeds in plaats van erop te staan.
	 */
	readonly roofPads: RoofPad[] = [...ROOF_DECK_PADS];

	/** Low platforms you can hop onto (deck top is the walkable surface). */
	readonly platforms: Platform[] = [
		// Catwalk deck incl. rounded tip — jump on, strut, jump off
		{
			minX: CATWALK_DECK.minX,
			maxX: CATWALK_DECK.maxX,
			minZ: CATWALK_DECK.minZ,
			maxZ: CATWALK_DECK.maxZ,
			y: CATWALK_DECK.topY,
			label: 'catwalk',
			nose: { centerZ: CATWALK_DECK.noseCenterZ, radius: CATWALK_DECK.noseRadius },
		},
		// Glijbaan-platform op het dakeiland (boven de ladder)
		{
			minX: SLIDE_PLATFORM.center.x - half(SLIDE_PLATFORM.size),
			maxX: SLIDE_PLATFORM.center.x + half(SLIDE_PLATFORM.size),
			minZ: SLIDE_PLATFORM.center.z - half(SLIDE_PLATFORM.size),
			maxZ: SLIDE_PLATFORM.center.z + half(SLIDE_PLATFORM.size),
			y: SLIDE_PLATFORM_TOP_Y,
			label: 'slide_platform',
		},
		// Zitrand en bakrand bij de atriumbalustrade: het opstapje naar de vide.
		...atriumPlanterTiers().map((tier) => ({
			minX: tier.standMinX,
			maxX: tier.maxX,
			minZ: tier.minZ,
			maxZ: tier.maxZ,
			y: tier.topY,
			label: `atrium_planter_${tier.id}`,
		})),
	];

	/**
	 * Loopvlakken buiten de mall die hoger liggen dan de straat. Alles wat er
	 * niet in staat is straatniveau; er is buiten geen verdieping om op te vallen.
	 */
	readonly citySurfaces: CitySurface[] = [];

	/** Atrium hole in the floor-1 slab — jump the balustrade and you drop through. */

	constructor() {
		this.buildMall();
		this.buildCity();
	}

	private add(minX: number, maxX: number, minZ: number, maxZ: number, opts?: BoxOptions): AABB {
		const box: AABB = {
			minX,
			maxX,
			minZ,
			maxZ,
			minY: opts?.minY,
			maxY: opts?.maxY,
			label: opts?.label,
			climbable: opts?.climbable,
			outdoor: opts?.outdoor,
			disabled: opts?.disabled,
			tags: opts?.tags,
		};
		this.boxes.push(box);
		this.boxIndex = null;
		return box;
	}

	/**
	 * Ruiten van de dozenindex. Vier meter is ruim een gangbreedte, dus wie in één
	 * ruit staat kijkt met zijn buren mee naar de wanden die hij kan raken.
	 */
	private static readonly INDEX_CELL = 4;
	/**
	 * Een doos die meer ruiten beslaat dan dit komt in de lijst die altijd meedoet.
	 * De gevelpanelen en de vloerplaten lopen over het hele gebouw; die in elke ruit
	 * zetten maakt de index groter dan de lijst die hij moest vervangen.
	 */
	private static readonly INDEX_MAX_CELLS = 24;
	/** Ruitsleutel: de rij past ruim binnen deze stap, want de stad meet geen 2 km. */
	private static readonly INDEX_STRIDE = 1024;

	private boxIndex: Map<number, AABB[]> | null = null;
	private readonly boxIndexOversized: AABB[] = [];

	private indexKey(cellX: number, cellZ: number): number {
		return cellX + cellZ * CollisionWorld.INDEX_STRIDE;
	}

	private buildBoxIndex(): Map<number, AABB[]> {
		const index = new Map<number, AABB[]>();
		this.boxIndexOversized.length = 0;
		for (const box of this.boxes) {
			const minCellX = Math.floor(box.minX / CollisionWorld.INDEX_CELL);
			const maxCellX = Math.floor(box.maxX / CollisionWorld.INDEX_CELL);
			const minCellZ = Math.floor(box.minZ / CollisionWorld.INDEX_CELL);
			const maxCellZ = Math.floor(box.maxZ / CollisionWorld.INDEX_CELL);
			const cells = (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1);
			if (cells > CollisionWorld.INDEX_MAX_CELLS) {
				this.boxIndexOversized.push(box);
				continue;
			}
			for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
				for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
					const key = this.indexKey(cellX, cellZ);
					const bucket = index.get(key);
					if (bucket) bucket.push(box);
					else index.set(key, [box]);
				}
			}
		}
		this.boxIndex = index;
		return index;
	}

	/**
	 * De dozen die een voetganger op hoogte `y` binnen dit vlak kan raken.
	 *
	 * Voor wie vóór de muur wil bijsturen in plaats van er na de stap uit geduwd te
	 * worden. De filters zijn de voetgangersdoorsnede van `resolveCircle`: uit
	 * staat uit, buiten telt niet mee binnen, en wat je met `climb` doorloopt is
	 * voor hem geen wand.
	 */
	blockersNear(minX: number, maxX: number, minZ: number, maxZ: number, y: number, climb: boolean, out: AABB[]): AABB[] {
		out.length = 0;
		const index = this.boxIndex ?? this.buildBoxIndex();
		const minCellX = Math.floor(minX / CollisionWorld.INDEX_CELL);
		const maxCellX = Math.floor(maxX / CollisionWorld.INDEX_CELL);
		const minCellZ = Math.floor(minZ / CollisionWorld.INDEX_CELL);
		const maxCellZ = Math.floor(maxZ / CollisionWorld.INDEX_CELL);
		const keep = (box: AABB): void => {
			if (box.disabled || box.outdoor) return;
			if (climb && box.climbable?.includes('walking')) return;
			if (box.minY !== undefined && y + BOX_FOOT_SLACK < box.minY) return;
			if (box.maxY !== undefined && y > box.maxY) return;
			if (box.maxX < minX || box.minX > maxX || box.maxZ < minZ || box.minZ > maxZ) return;
			if (!out.includes(box)) out.push(box);
		};
		for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
			for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
				const bucket = index.get(this.indexKey(cellX, cellZ));
				if (!bucket) continue;
				for (const box of bucket) keep(box);
			}
		}
		for (const box of this.boxIndexOversized) keep(box);
		return out;
	}

	/** Runtime colliders (WC walls, props added after construct). Returns the box so a gate can toggle its own. */
	addBox(minX: number, maxX: number, minZ: number, maxZ: number, opts?: BoxOptions): AABB {
		return this.add(minX, maxX, minZ, maxZ, opts);
	}

	/** Zelfde afspraak voor een dakstuk: de plaat komt terug, zodat zijn eigenaar hem kan openen. */
	addRoofPad(pad: RoofPad): RoofPad {
		this.roofPads.push(pad);
		return pad;
	}

	private buildMall(): void {
		const mallEdgeX = half(MALL_FOOTPRINT.width);
		const mallEdgeZ = half(MALL_FOOTPRINT.depth);
		const wallT = 0.8;

		// West wall has a basement-height opening for the authored parking ramp.
		// A single floor-agnostic AABB here made the rendered exit impassable.
		const exitExtentZ = PARKING_EXIT_WALL_GAP;
		const wallWestMinX = -mallEdgeX - wallT;
		const wallWestMaxX = -mallEdgeX + 0.2;
		this.add(wallWestMinX, wallWestMaxX, -mallEdgeZ - wallT, -exitExtentZ, opaque({ maxY: SHELL_TOP_Y, label: 'wall_w_north' }));
		this.add(
			wallWestMinX,
			wallWestMaxX,
			ENTRANCE_PORTAL.maxZ,
			mallEdgeZ + wallT,
			opaque({ maxY: SHELL_TOP_Y, label: 'wall_w_south' }),
		);
		this.add(
			wallWestMinX,
			wallWestMaxX,
			-exitExtentZ,
			exitExtentZ,
			opaque({ minY: -0.5, maxY: SHELL_TOP_Y, label: 'wall_w_above_exit' }),
		);

		// De hoofdingang. De twee zijlichten zijn glas voor het oog en wand voor het
		// lichaam, en boven de deuren staat het scherm door tot het dak: zonder die
		// doos loop je op V1 dwars door de pui de straat op. Alleen de deuropening
		// zelf is vrij, over de volle hoogte waar een lopende speler in past.
		for (const [label, minZ, maxZ] of [
			['entrance_sidelight_n', ENTRANCE_PORTAL.minZ, ENTRANCE_PORTAL.doorMinZ],
			['entrance_sidelight_s', ENTRANCE_PORTAL.doorMaxZ, ENTRANCE_PORTAL.maxZ],
		] as const) {
			this.add(wallWestMinX, wallWestMaxX, minZ, maxZ, { maxY: SHELL_TOP_Y, label });
		}
		this.add(wallWestMinX, wallWestMaxX, ENTRANCE_PORTAL.doorMinZ, ENTRANCE_PORTAL.doorMaxZ, {
			minY: ENTRANCE_SPEC.doorHeadY,
			maxY: SHELL_TOP_Y,
			label: 'entrance_screen',
		});
		// De luifelkolommen staan op de stoep, dus alleen wie buiten mag komen botst erop.
		for (const sign of [-1, 1] as const) {
			const z = ENTRANCE_PORTAL.centerZ + sign * ENTRANCE_SPEC.column.offsetZ;
			const r = ENTRANCE_SPEC.column.radius;
			this.add(
				ENTRANCE_PORTAL.columnX - r,
				ENTRANCE_PORTAL.columnX + r,
				z - r,
				z + r,
				opaque({ minY: -0.5, maxY: ENTRANCE_SPEC.canopy.topY, label: 'entrance_column', outdoor: true }),
			);
		}
		this.add(
			mallEdgeX - 0.2,
			mallEdgeX + wallT,
			-mallEdgeZ - wallT,
			mallEdgeZ + wallT,
			opaque({ maxY: SHELL_TOP_Y, label: 'wall_e' }),
		);
		this.add(
			-mallEdgeX - wallT,
			mallEdgeX + wallT,
			-mallEdgeZ - wallT,
			-mallEdgeZ + 0.2,
			opaque({ maxY: SHELL_TOP_Y, label: 'wall_n' }),
		);
		this.add(
			-mallEdgeX - wallT,
			mallEdgeX + wallT,
			mallEdgeZ - 0.2,
			mallEdgeZ + wallT,
			opaque({ maxY: SHELL_TOP_Y, label: 'wall_s' }),
		);

		// Store: thin BACK wall only — open interior for stock + shopkeeper
		for (const s of STORES) {
			if (s.id === 'info' || s.utility) continue;
			const y0 = levelY(s.level);
			const y1 = y0 + 4.5;
			const roomDepth = shopRoomDepth(s);
			const backCx = s.x - Math.sin(s.rotation) * roomDepth;
			const backCz = s.z - Math.cos(s.rotation) * roomDepth;
			// De achterwand draait mee met de winkel. Alleen zijn middelpunt draaien en
			// daarna altijd X als breedte nemen legde bij de oost- en westwinkels een
			// onzichtbare dwarswand over de buitenroute (onder meer bij GAME MANIA,
			// SAUCY en DOUGLAS). `planBounds` leest dezelfde yaw-afspraak als de mesh.
			const backWall = planBounds({
				kind: 'rectangle',
				center: { x: backCx, z: backCz },
				width: s.width * 0.96,
				depth: 0.8,
				yaw: s.rotation,
			});
			this.add(
				backWall.minX,
				backWall.maxX,
				backWall.minZ,
				backWall.maxZ,
				opaque({ minY: y0 - 0.5, maxY: y1, label: `store_back_${s.id}` }),
			);
		}

		for (const connector of VERTICAL_CONNECTORS) {
			this.add(connector.collision.minX, connector.collision.maxX, connector.collision.minZ, connector.collision.maxZ, {
				label: connector.id,
				climbable: connectorClimbModes(connector.id),
			});
		}

		// No barrier boxes at the shaft heads: they sat exactly where a climber is
		// at y≈5.5 and shoved sims off the top of the flight. The openings are
		// handled vertically instead — see `Ramp.openMinZ` / `groundHeightAt`.

		// Atrium fountain / planter (floor 0)
		this.add(
			FOUNTAIN_SPEC.center.x - FOUNTAIN_SPEC.kerbRadius,
			FOUNTAIN_SPEC.center.x + FOUNTAIN_SPEC.kerbRadius,
			FOUNTAIN_SPEC.center.z - FOUNTAIN_SPEC.kerbRadius,
			FOUNTAIN_SPEC.center.z + FOUNTAIN_SPEC.kerbRadius,
			opaque({ minY: -0.5, maxY: FOUNTAIN_SPEC.blockHeight, label: 'fountain' }),
		);

		// Floor-1 VOID (architect: weide/void) — cannot walk over atrium hole
		// Hole is roughly ±8 x ±6 on floor 1 — solid barrier so sims don't hang mid-air
		this.add(-half(ATRIUM_BARRIER.width), half(ATRIUM_BARRIER.width), -half(ATRIUM_BARRIER.depth), half(ATRIUM_BARRIER.depth), {
			minY: 4.5,
			maxY: 12,
			label: 'void_f1',
		});

		// (No UFO pad box any more — the saucer hovers in the atrium void, so the
		//  floor-1 balcony at z≈16 is walkable again.)

		// Catwalk deck (Fashion Week, floor 0 west in front of Douglas).
		// maxY sits just under the deck top: standing ON the deck skips this box,
		// standing on the floor bumps into the kerb — so you hop on, not clip in.
		this.add(CATWALK_DECK.minX, CATWALK_DECK.maxX, CATWALK_DECK.minZ, CATWALK_DECK.maxZ, {
			minY: -0.5,
			maxY: CATWALK_DECK.topY - KERB_LIP,
			label: 'catwalk',
		});

		// De plantenbak bij de vide. Elke trede stopt een kerbdikte onder zijn eigen
		// loopvlak, dus vanaf het dek loop je ertegenaan en erbovenop sta je erop.
		for (const tier of atriumPlanterTiers()) {
			this.add(tier.minX, tier.maxX, tier.minZ, tier.maxZ, {
				minY: levelY('v1') - 0.5,
				maxY: tier.topY - KERB_LIP,
				label: `atrium_planter_${tier.id}`,
			});
		}

		// Aperol bar
		this.add(-16, -12, 9, 11.5, opaque({ minY: -0.5, maxY: 3, label: 'aperol' }));

		// Kiosk base
		this.add(
			KIOSK_SPEC.center.x - KIOSK_SPEC.baseRadius,
			KIOSK_SPEC.center.x + KIOSK_SPEC.baseRadius,
			KIOSK_SPEC.center.z - KIOSK_SPEC.baseRadius,
			KIOSK_SPEC.center.z + KIOSK_SPEC.baseRadius,
			opaque({ minY: -0.5, maxY: KIOSK_SPEC.height, label: 'kiosk' }),
		);

		// De parkeerschil: dezelfde wanden, kolommen en cabine die de plattegrond
		// tekent. P1 had helemaal geen geometrie en je liep dwars door alles heen.
		for (const collider of parkingDeckColliders()) {
			this.add(
				collider.minX,
				collider.maxX,
				collider.minZ,
				collider.maxZ,
				opaque({ minY: collider.minY, maxY: collider.maxY, label: collider.label }),
			);
		}

		// De keermuren van de uitritgeul, waar hij buiten de gevel open ligt. Daar
		// stond niets langs de rijbaan: naast de helling af was zes meter vallen.
		// Ze staan op de stoep, dus alleen wie buiten mag komen botst erop.
		for (const collider of parkingExitTrenchColliders()) {
			this.add(
				collider.minX,
				collider.maxX,
				collider.minZ,
				collider.maxZ,
				opaque({ minY: collider.minY, maxY: collider.maxY, label: collider.label, outdoor: true }),
			);
		}
	}

	/**
	 * De stad buiten de mall. De torens komen uit dezelfde `planTowers` die
	 * CityBuildings tekent, het theater en de garage uit dezelfde plannen die hun
	 * bouwers gebruiken: een tweede lijst coördinaten hier is een blok dat naast
	 * zijn gevel staat.
	 */
	private buildCity(): void {
		TOWER_SPECS.forEach((t, i) => {
			// De draai is klein maar niet nul; de omhullende dekt hem, dus je stapt
			// nooit in een hoek die er wel staat.
			const cos = Math.abs(Math.cos(t.rot));
			const sin = Math.abs(Math.sin(t.rot));
			const ex = half(t.w * cos + t.d * sin);
			const ez = half(t.w * sin + t.d * cos);
			this.add(
				t.x - ex,
				t.x + ex,
				t.z - ez,
				t.z + ez,
				opaque({ minY: -0.5, maxY: t.h, label: `city_tower_${i}`, outdoor: true }),
			);
		});

		// Het theater was één massief blok. Nu het een binnenkant heeft komen zijn
		// wanden, zijn stoelen en zijn loopvlakken uit de entiteiten zelf: één lijst
		// coördinaten voor de tekenaar, de wereldcontrole en dit.
		for (const collider of theatreColliders()) {
			const doos = { minY: collider.minY, maxY: collider.maxY, label: collider.label, outdoor: true };
			this.add(collider.minX, collider.maxX, collider.minZ, collider.maxZ, collider.seeThrough ? doos : opaque(doos));
		}
		for (const surface of theatreSurfaces()) {
			this.citySurfaces.push({ ...surface, label: `theatre_${surface.label}` });
		}

		for (const collider of conColliders()) {
			const doos = { minY: collider.minY, maxY: collider.maxY, label: collider.label, outdoor: true };
			this.add(collider.minX, collider.maxX, collider.minZ, collider.maxZ, collider.seeThrough ? doos : opaque(doos));
		}
		for (const surface of conSurfaces()) {
			this.citySurfaces.push({ ...surface, label: `con_${surface.label}` });
		}
		for (const collider of rioMountainColliders()) {
			this.add(
				collider.minX,
				collider.maxX,
				collider.minZ,
				collider.maxZ,
				opaque({ minY: collider.minY, maxY: collider.maxY, label: collider.label, outdoor: true }),
			);
		}
		for (const surface of rioMountainSurfaces()) {
			this.citySurfaces.push({ ...surface, label: surface.label });
		}
		for (const collider of favelaFillColliders()) {
			this.add(
				collider.minX,
				collider.maxX,
				collider.minZ,
				collider.maxZ,
				opaque({ minY: collider.minY, maxY: collider.maxY, label: collider.label, outdoor: true }),
			);
		}
		for (const collider of favelaColliders()) {
			this.add(
				collider.minX,
				collider.maxX,
				collider.minZ,
				collider.maxZ,
				opaque({ minY: collider.minY, maxY: collider.maxY, label: collider.label, outdoor: true }),
			);
		}
		for (const surface of favelaSurfaces()) {
			this.citySurfaces.push({ ...surface, label: surface.label });
		}

		// De toneelrand: een wand, geen val. Het zaaldek zakt trapsgewijs naar de voorste
		// rij en het toneel staat er ruim een stap boven; het toneel is een loopvlak zonder
		// doos, dus wie van de voorste rij de rand overliep vond geen bereikbare vloer en
		// zakte door naar straatniveau, klem tussen de stoelen. Deze kerb staat op de
		// toneelkant van de rand, zodat een stoel op het voorste dek er niet uit geduwd
		// wordt, en houdt zowel de zaal- als de toneelkant van de sprong tegen.
		this.add(THEATRE_INTERIOR.minX, THEATRE_INTERIOR.maxX, THEATRE_STAGE_FRONT_Z - KERB_T, THEATRE_STAGE_FRONT_Z, {
			minY: theatreRowY(THEATRE_PLAN.seating.rows - 1),
			maxY: THEATRE_STAGE_TOP_Y,
			label: 'theatre_stage_front',
			outdoor: true,
		});

		// Podium en treden zijn loopvlakken; de kerbdozen eromheen dwingen je de
		// trap op in plaats van tegen de zijkant omhoog.
		const dek = THEATRE_PLAN.podium;
		const trap = THEATRE_PLAN.stair;
		const dekTop = THEATRE_PLAN.podiumY - KERB_LIP;
		const trapTop = theatreTreadY(0) - KERB_LIP;
		this.citySurfaces.push({ ...dek, y: THEATRE_PLAN.podiumY, label: 'theatre_podium' });
		this.add(dek.minX, dek.minX + KERB_T, dek.minZ, dek.maxZ, { maxY: dekTop, label: 'theatre_kerb_w', outdoor: true });
		this.add(dek.maxX - KERB_T, dek.maxX, dek.minZ, dek.maxZ, { maxY: dekTop, label: 'theatre_kerb_e', outdoor: true });
		this.add(dek.minX, trap.minX, dek.maxZ - KERB_T, dek.maxZ, { maxY: dekTop, label: 'theatre_kerb_sw', outdoor: true });
		this.add(trap.maxX, dek.maxX, dek.maxZ - KERB_T, dek.maxZ, { maxY: dekTop, label: 'theatre_kerb_se', outdoor: true });

		const trapEindZ = trap.zTop + trap.treads * trap.tread;
		this.add(trap.minX - KERB_T, trap.minX, trap.zTop, trapEindZ, { maxY: trapTop, label: 'theatre_stair_w', outdoor: true });
		this.add(trap.maxX, trap.maxX + KERB_T, trap.zTop, trapEindZ, { maxY: trapTop, label: 'theatre_stair_e', outdoor: true });
		for (let i = 0; i < trap.treads; i++) {
			const { minZ, maxZ } = theatreTreadZ(i);
			this.citySurfaces.push({ minX: trap.minX, maxX: trap.maxX, minZ, maxZ, y: theatreTreadY(i), label: `theatre_tread_${i}` });
		}

		// Het achterbordes bij de artiesteningang, op toneelhoogte, met een trap omlaag.
		const backstageLanding = BACKSTAGE_LANDING;
		this.citySurfaces.push({
			minX: backstageLanding.minX,
			maxX: backstageLanding.maxX,
			minZ: backstageLanding.minZ,
			maxZ: backstageLanding.maxZ,
			y: backstageLanding.y,
			label: 'theatre_backstage_landing',
		});
		for (let i = 0; i < THEATRE_PLAN.backstage.landing.treads; i++) {
			const { minZ, maxZ } = backstageLandingTreadZ(i);
			this.citySurfaces.push({
				minX: backstageLanding.minX,
				maxX: backstageLanding.maxX,
				minZ,
				maxZ,
				y: backstageLandingTreadY(i),
				label: `theatre_backstage_tread_${i}`,
			});
		}

		const zuilen = THEATRE_PLAN.columns;
		for (let i = 0; i < zuilen.count; i++) {
			const x = zuilen.x0 + i * zuilen.pitch;
			this.add(
				x - zuilen.radius,
				x + zuilen.radius,
				zuilen.z - zuilen.radius,
				zuilen.z + zuilen.radius,
				opaque({ minY: zuilen.bottomY - 0.5, maxY: zuilen.topY, label: `city_theatre_column_${i}`, outdoor: true }),
			);
		}

		// De garage staat op poten: het maaiveld-dek is open, dus dat loop je op.
		// Alleen de kolommen houden je tegen.
		const garage = GARAGE_PLAN.footprint;
		this.citySurfaces.push({ ...garage, y: GARAGE_PLAN.groundDeckY, label: 'garage_deck' });
		const kolom = half(GARAGE_PLAN.columnSize);
		for (const x of GARAGE_PLAN.columnX) {
			for (const z of GARAGE_PLAN.columnZ) {
				this.add(
					x - kolom,
					x + kolom,
					z - kolom,
					z + kolom,
					opaque({ minY: -0.5, maxY: GARAGE_PLAN.columnTopY, label: 'city_garage_column', outdoor: true }),
				);
			}
		}

		// De bordessen van de spiraal en de dekken erboven zijn vlak, dus stadsdek;
		// de schuine platen ertussen lopen als pathRamp. De borstwering is de kerb
		// die je op een dek houdt: hij begint op het loopvlak, zodat wie een
		// verdieping lager staat er niet tegenaan botst.
		for (const bordes of [...GARAGE_RAMP_LANDINGS, ...GARAGE_DECKS]) {
			this.citySurfaces.push({
				minX: bordes.minX,
				maxX: bordes.maxX,
				minZ: bordes.minZ,
				maxZ: bordes.maxZ,
				y: bordes.y,
				label: bordes.id,
			});
		}
		for (const p of GARAGE_PARAPETS) {
			this.add(p.minX, p.maxX, p.minZ, p.maxZ, opaque({ minY: p.minY, maxY: p.maxY, label: p.id, outdoor: true }));
		}
	}

	/**
	 * Kan `from` `to` zien?
	 *
	 * Eén helper, want anders krijgt elk systeem zijn eigen antwoord: de bewaker
	 * schoot dwars door de westgevel op iemand op de stoep, en Wei joeg je door een
	 * winkelwand heen. De vraag is horizontaal met een hoogtevenster erbij, precies
	 * zoals de dozen zelf zijn opgeschreven: een balie van een meter hoog staat niet
	 * tussen twee hoofden in, en een gevel van de voet tot de kroonlijst wel.
	 *
	 * De occlusie komt uit het emitterschema, dus wie de vraag stelt schrijft op
	 * waar hij tegenaan kijkt en niet hoe hij dat uitrekent. `mode: 'none'` is altijd
	 * vrij zicht; dozen zonder een van `blockingTags` tellen niet mee.
	 *
	 * `projectile` leest dezelfde dozen als muur in plaats van als uitzicht: een
	 * eindpunt in de doos is dan een treffer en geen vrijstelling. Een kogel legt
	 * een halve meter per frame af en een winkelwand is er zestien centimeter dik,
	 * dus vrijwel elke doorgang eindigt één frame lang ín de wand; met de
	 * kijkersvrijstelling was dat frame vrijgesteld, het volgende ook (want daar
	 * begon het segment erin) en kwam de kogel er aan de andere kant uit.
	 */
	hasLineOfSight(from: Vec3, to: Vec3, occlusion: Occlusion): boolean {
		if (occlusion.mode === 'none') return true;
		const forgiveEnds = occlusion.mode !== 'projectile';
		const minY = Math.min(from.y, to.y);
		const maxY = Math.max(from.y, to.y);
		const dx = to.x - from.x;
		const dz = to.z - from.z;
		// Twee kijkers op dezelfde plek hebben geen lijn te trekken. Een kogel wel: die
		// valt loodrecht en heeft dan nog steeds een doos onder zich.
		if (forgiveEnds && dx * dx + dz * dz < SIGHT_MIN_RUN * SIGHT_MIN_RUN) return true;
		for (const b of this.boxes) {
			const tags = b.tags;
			if (!(tags && occlusion.blockingTags.some((tag) => tags.includes(tag)))) continue;
			if (b.minY !== undefined && maxY < b.minY) continue;
			if (b.maxY !== undefined && minY > b.maxY) continue;
			const ends = insideBox(b, from.x, from.y, from.z) || insideBox(b, to.x, to.y, to.z);
			// Wie er zelf in staat kijkt er niet doorheen: een bewaker die tegen een
			// wand aan geduwd is zou anders nooit meer iets zien.
			if (ends && forgiveEnds) continue;
			if (ends) return false;
			if (segmentCrossesBox(b, from.x, from.z, dx, dz)) return false;
		}
		return true;
	}

	/**
	 * Duikt het segment door een vloerplaat heen?
	 *
	 * Er staat geen collisiondoos onder een dek — een plaat is vloer en geen muur —
	 * dus een kogel van de V1-balustrade viel dwars door de begane grond en stierf
	 * pas onder de fundering. De platen en hun gaten staan al in het wereldmodel; de
	 * vraag leest precies die lijst, zodat het atriumgat een kogel wél doorlaat.
	 */
	crossesSlab(from: Vec3, to: Vec3, radius: number): boolean {
		const lowY = Math.min(from.y, to.y);
		const highY = Math.max(from.y, to.y);
		for (const level of LEVELS) {
			const slab = SLAB_SPEC_BY_LEVEL[level.id];
			const bottom = slab.topY - slab.thickness;
			if (highY <= bottom || lowY >= slab.topY) continue;
			const plan = segmentPlanWithin(from, to, bottom, slab.topY);
			// Met zijn eigen straal eromheen, want een kogel die recht naar beneden valt
			// beslaat anders een vlak van niets en past dan door geen enkel gat.
			const rect = {
				minX: plan.minX - radius,
				maxX: plan.maxX + radius,
				minZ: plan.minZ - radius,
				maxZ: plan.maxZ + radius,
			};
			if (slabOpeningWithin(level.id, rect) === null) return true;
		}
		return false;
	}

	/** Binnen de voetafdruk liggen de mall-platen; erbuiten alleen de stad. */
	insideMallPlan(x: number, z: number): boolean {
		return Math.abs(x) <= half(MALL_FOOTPRINT.width) && Math.abs(z) <= half(MALL_FOOTPRINT.depth);
	}

	/**
	 * Het loopvlak buiten de mall. Straatniveau, tenzij er een stadsdek onder je
	 * voeten ligt waar je ook echt bij kunt: staan op straat naast het theater
	 * tilt je niet ineens anderhalve meter op het podium.
	 */
	/**
	 * Straatniveau, behalve waar de bestrating een gat houdt.
	 *
	 * De mond van de uitritgeul ligt open tot op de helling zes meter lager, en de
	 * grondvraag gaf daar toch maaiveld terug: je liep over het gat heen alsof er een
	 * plaat lag. Onderin ligt het loopvlak van de helling, dus wie erin stapt komt
	 * eronder terecht en rijdt of loopt er via diezelfde helling weer uit.
	 */
	private streetSurfaceAt(x: number, z: number): number {
		const gat = PLAZA_TRENCH_GAP;
		if (x < gat.minX || x > gat.maxX || z < gat.minZ || z > gat.maxZ) return CITY_GROUND_Y;
		return parkingExitRampY(x);
	}

	cityGroundAt(x: number, z: number, currentY: number, step = WALK_STEP): number {
		let best = this.streetSurfaceAt(x, z);
		for (const s of this.citySurfaces) {
			if (s.y <= best) continue;
			if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
			if (currentY >= s.y - step) best = s.y;
		}
		return best;
	}

	/** True where this platform's top face is really floor, rounded nose included. */
	platformCovers(platform: Platform, x: number, z: number): boolean {
		if (x < platform.minX || x > platform.maxX || z < platform.minZ || z > platform.maxZ) return false;
		const nose = platform.nose;
		if (!nose || z <= nose.centerZ) return true;
		return Math.hypot(x - midpoint(platform.minX, platform.maxX), z - nose.centerZ) <= nose.radius;
	}

	/** Sims and players ask the same authored-floor question. */
	snapFloorY(x: number, z: number, y: number): number {
		return this.groundHeightAt(x, z, y, WALK_STEP);
	}

	/**
	 * Walkable surface height at (x,z) for a climber (the player).
	 *
	 * Inside an incline's corridor the incline *is* the floor, but only while it
	 * is within `step` of where your feet already are — that's what keeps you on
	 * the floor-1 slab when you walk over the escalator shaft instead of dropping
	 * through it. Airborne callers pass a bigger `step` so a jump mid-escalator
	 * doesn't snap you to the deck above.
	 */
	groundHeightAt(x: number, z: number, currentY: number, step = 0.7): number {
		for (const ramp of this.pathRamps) {
			const surface = pathRampSurface(ramp, x, z, 0.2);
			if (surface !== null && Math.abs(surface - currentY) <= step + 0.2) return surface;
		}
		// Platforms and flights that reach the roof go first. The pads span whole decks
		// and answer unconditionally up here (`currentY > FLOOR_H + 2`), so anything on
		// one is unreachable if the pad is asked first. Both are gated on already being
		// at that height, so nothing below changes. `snapFloorY` asks ramps before pads
		// for the same reason; the guard is `< ROOF_H` (not `<=`) so the secret stairs,
		// whose top sits at ROOF_H under the hatch lid, is not shadowed by that lid.
		for (const p of this.platforms) {
			if (!this.platformCovers(p, x, z)) continue;
			if (currentY >= p.y - 0.35 && currentY < p.y + 2) return p.y;
		}
		for (const r of this.ramps) {
			if (r.yTop < ROOF_H) continue;
			if (x < r.minX || x > r.maxX) continue;
			const zLo = Math.min(r.zBottom, r.zTop) - 1.2;
			const zHi = Math.max(r.zBottom, r.zTop) + 1.2;
			if (z < zLo || z > zHi) continue;
			const raw = (z - r.zBottom) / (r.zTop - r.zBottom);
			const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
			const h = r.yBottom + (r.yTop - r.yBottom) * t;
			if (Math.abs(h - currentY) <= step) return h;
		}

		// Het zwembad is een gat in het dek: binnen de waterlijn is de bodem de
		// vloer. Staat vóór roofPads, want die plaat loopt dwars over het bad heen.
		if (currentY > FLOOR_H + 2) {
			const pool = poolFloorY(x, z);
			if (pool !== null) return pool;
		}

		// Roof deck when you're up there
		for (const p of this.roofPads) {
			if (p.disabled) continue;
			if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
			if (Math.abs(p.y - currentY) <= step + 0.4 || currentY > FLOOR_H + 2) {
				return p.y;
			}
		}

		// Buiten de voetafdruk houdt de mall op. Geen dakplaat veertig meter naast
		// het gebouw, geen verdiepingsvloer: stap je over de dakrand, dan is er tot
		// de straat niets meer om op te staan. Onder straatniveau geldt dit niet,
		// daar loopt de uitritgeul naar de garage.
		if (currentY > CITY_GROUND_Y - 0.6 && !this.insideMallPlan(x, z)) return this.cityGroundAt(x, z, currentY, step);

		// Over the atrium hole there is no slab at any height below the roof: the
		// balustrade-jump drops through, and the drone can descend back in through
		// the skylight (capped just under ROOF_H so roof walkers aren't affected).
		// Does not punch into the basement garage.
		if (
			currentY < ROOF_H - 0.5 &&
			currentY > 0.3 &&
			Math.abs(x) < half(ATRIUM_VOID.width) &&
			Math.abs(z) < half(ATRIUM_VOID.depth)
		) {
			return 0;
		}

		// Underground parking deck
		if (currentY < -2) return BASEMENT_H;

		const slab = currentY < 3.2 ? 0 : currentY >= 10 ? ROOF_H : FLOOR_H;

		for (const r of this.ramps) {
			if (x < r.minX || x > r.maxX) continue;
			const zLo = Math.min(r.zBottom, r.zTop) - 1.2;
			const zHi = Math.max(r.zBottom, r.zTop) + 1.2;
			if (z < zLo || z > zHi) continue;

			const raw = (z - r.zBottom) / (r.zTop - r.zBottom);
			const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
			const h = r.yBottom + (r.yTop - r.yBottom) * t;
			// Close enough to stand on → ride the incline
			if (Math.abs(h - currentY) <= step) return h;
			// Over the slab cut-out there is no floor: drop onto the flight. Een vlucht
			// die op het dak uitkomt heeft dat gat over zijn hele lengte, dus deze regel
			// draagt ook de geheime trap; een tweede regel met de naam van die trap erin
			// stond hier en koos nooit iets, want een helling draagt zijn `connector.id`.
			if (currentY > h && z >= r.openMinZ && z <= r.openMaxZ) return h;
			// Otherwise this is solid slab (or you're walking underneath the flight)
			return slab;
		}
		return slab;
	}

	/**
	 * Vrije hoogte boven de voeten op (x, z), en oneindig waar er niets boven hangt.
	 *
	 * Alleen materie telt mee, en dat is precies wat `SIGHT_BLOCKING_TAG` op een doos
	 * zegt. Het atriumhek en de roltrapkokers lopen van de vloer tot boven het dak om
	 * een lopend lichaam eromheen te sturen; wie die als plafond leest hangt een
	 * plafond van anderhalve meter over de roltrap en laat de speler daar hurken.
	 *
	 * De dekplaten dragen geen doos — een plaat is vloer en geen muur — dus ze worden
	 * apart gelezen, met dezelfde gatenlijst die `crossesSlab` leest. De straal gaat
	 * mee omdat `slabOpeningWithin` een vlak wil: op een punt is elk gat leeg en staat
	 * er ook boven het atrium beton.
	 *
	 * Het antwoord is een ondergrens. Een doos begint vaak een halve meter onder zijn
	 * eigen dek, dus wie een verdieping lager staat leest die onderkant in plaats van
	 * de plaat en houdt een halve meter over. Te weinig ruimte melden laat je hoogstens
	 * hurken waar dat niet hoefde; te veel melden zet je hoofd in het beton.
	 */
	/**
	 * Het dichtstbijzijnde punt naast de geometrie waar dit lichaam in staat.
	 *
	 * Een herstelde sessie of een teleport zet een lichaam op een punt dat sinds de
	 * vorige wereld dicht kan zitten, en een rit die niet terugkomt laat je in het
	 * voertuig staan: dan loop je geen kant meer op, want elke stap wordt teruggeduwd.
	 * Dezelfde vraag als een stap, alleen zonder stap.
	 */
	unstickBody(
		x: number,
		z: number,
		feetY: number,
		outside: boolean,
		radius = STANDING_PEDESTRIAN.radius,
	): { x: number; z: number } {
		return this.resolveCircle(x, z, feetY, radius, 3, true, false, outside);
	}

	headroomAt(x: number, z: number, feetY: number, radius = STANDING_PEDESTRIAN.radius): number {
		let underside = Number.POSITIVE_INFINITY;
		for (const b of this.boxes) {
			if (b.disabled) continue;
			if (b.minY === undefined || b.minY <= feetY || b.minY >= underside) continue;
			if (!b.tags?.includes(SIGHT_BLOCKING_TAG)) continue;
			if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
			underside = b.minY;
		}
		const head = { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
		for (const level of LEVELS) {
			const slab = SLAB_SPEC_BY_LEVEL[level.id];
			const bottom = slab.topY - slab.thickness;
			if (bottom <= feetY || bottom >= underside) continue;
			// Het dakbad is door de dakplaat uitgegraven en staat open naar de lucht:
			// wie in het diepe waadt heeft water boven zich, geen dak. Zonder deze
			// uitzondering meldt de dakplaat een plafond van 0,6 m boven de badbodem,
			// klemt `fits()` een staand lichaam vast en kom je het bad niet meer uit.
			// Dezelfde special-case als in `groundHeightAt`, waar `poolFloorY` vóór de
			// dakpads gaat.
			if (level.id === 'roof' && poolFloorY(x, z) !== null) continue;
			if (slabOpeningWithin(level.id, head) === null) underside = bottom;
		}
		return span(feetY, underside);
	}

	/**
	 * Hoeveel water er boven je voeten staat in het dakbad, 0 op het droge.
	 * De hoogtecheck eerst: onder het bad ligt gewoon de mall.
	 */
	waterDepthAt(x: number, z: number, feetY: number): number {
		if (feetY > POOL_WATER_Y || feetY < POOL_FLOOR_Y - 0.5) return 0;
		return poolFloorY(x, z) === null ? 0 : POOL_WATER_Y - feetY;
	}

	/**
	 * Drift van een bewegende helling voor wie erop staat, anders null. Zelfde
	 * mechaniek als MovingWalkways.beltVelocityAt, dus de aanroeper verplaatst je
	 * ermee door de collision heen. Alleen de horizontale component: de hoogte
	 * volgt al uit groundHeightAt zodra je meeschuift, en samen zijn ze precies
	 * `carrySpeed` langs de helling. Een trap zonder carrySpeed vervoert niet.
	 */
	rampCarryAt(x: number, z: number, feetY: number): { x: number; z: number } | null {
		for (const r of this.ramps) {
			const speed = r.carrySpeed;
			if (speed === undefined) continue;
			if (x < r.minX || x > r.maxX) continue;
			if (z < Math.min(r.zBottom, r.zTop) || z > Math.max(r.zBottom, r.zTop)) continue;
			const run = r.zTop - r.zBottom;
			const rise = r.yTop - r.yBottom;
			const h = r.yBottom + rise * ((z - r.zBottom) / run);
			if (Math.abs(h - feetY) > WALK_STEP) continue;
			return { x: 0, z: (speed * run) / Math.hypot(run, rise) };
		}
		return null;
	}

	/**
	 * De helling van het loopvlak onder een voertuig, langs zijn eigen koers.
	 *
	 * De hoogte onder de neus en die onder de staart, over de wielbasis. Elk voertuig
	 * reed vlak de garagehelling op omdat het alleen zijn eigen middelpunt aan
	 * `groundHeightAt` vroeg, en één hoogte is geen helling. Dezelfde vraag als daar,
	 * dus dezelfde platen: de uitrit, de garagespiraal en de stadsdekken.
	 *
	 * `wheelbase` is de volle afstand van as tot as; de monsters staan op de assen.
	 * Positief is neus omhoog.
	 */
	surfacePitchAt(x: number, z: number, currentY: number, forwardX: number, forwardZ: number, wheelbase: number): number {
		const reach = half(wheelbase);
		const front = this.groundHeightAt(x + forwardX * reach, z + forwardZ * reach, currentY, WALK_STEP + reach);
		const back = this.groundHeightAt(x - forwardX * reach, z - forwardZ * reach, currentY, WALK_STEP + reach);
		return Math.atan2(front - back, wheelbase);
	}

	/** True while the climber is standing on an incline rather than a slab. */
	onRamp(x: number, z: number, y: number): boolean {
		if (
			this.pathRamps.some(
				(ramp) => pathRampSurface(ramp, x, z, 0.2) !== null && Math.abs((pathRampSurface(ramp, x, z) ?? y) - y) < 0.7,
			)
		) {
			return true;
		}
		// De band is per vlucht: een vaste 0.6..FLOOR_H−0.6 kende alleen V0→V1 en
		// verklaarde de geheime trap (6..13.95) en de glijbaanladder tot vlakke vloer.
		return this.ramps.some(
			(r) =>
				y > Math.min(r.yBottom, r.yTop) + 0.6 &&
				y < Math.max(r.yBottom, r.yTop) - 0.6 &&
				x >= r.minX &&
				x <= r.maxX &&
				z >= Math.min(r.zBottom, r.zTop) - 1.2 &&
				z <= Math.max(r.zBottom, r.zTop) + 1.2,
		);
	}

	/**
	 * 'mall' = clamp to mall footprint (default, sims + walkers).
	 * 'city' = full outdoor world for cars / fly-out.
	 *
	 * Dit veld geldt voor iedereen die de wereld deelt. Voor één agent buiten de
	 * klem zetten is `resolveCircle(..., outside)`.
	 */
	boundsMode: 'mall' | 'city' = 'mall';

	/**
	 * Past een lichaam onder de open onderzijde van deze trapvlucht?
	 *
	 * De gewone connector-AABB beslaat de hele vlucht in XZ en heeft geen hoogte. Dat
	 * is goed voor wie de trap probeert op te rijden, maar maakte ook de metershoge
	 * vrije ruimte onder het bovenste deel massief. De laagste trede boven de volledige
	 * cirkel bepaalt de doorgang; één lage hoek is genoeg om hem te blokkeren.
	 */
	private clearsOpenFlight(label: string | undefined, z: number, radius: number, body: BodyClearance): boolean {
		if (!label) return false;
		const ramp = this.rampByLabel.get(label);
		const thickness = ramp?.openUndersideThickness;
		if (!ramp || thickness === undefined) return false;
		const flightMinZ = Math.min(ramp.zBottom, ramp.zTop);
		const flightMaxZ = Math.max(ramp.zBottom, ramp.zTop);
		const minZ = Math.max(flightMinZ, z - radius);
		const maxZ = Math.min(flightMaxZ, z + radius);
		if (minZ > maxZ) return false;
		const minSurface = ramp.yBottom + (ramp.yTop - ramp.yBottom) * inverseLerpClamped(ramp.zBottom, ramp.zTop, minZ);
		const maxSurface = ramp.yBottom + (ramp.yTop - ramp.yBottom) * inverseLerpClamped(ramp.zBottom, ramp.zTop, maxZ);
		const underside = Math.min(minSurface, maxSurface) - thickness;
		return body.feetY + body.height <= underside;
	}

	/**
	 * De doos die dit stuk vloer dichthoudt voor een lichaam van deze straal, of
	 * niets als er in een rechte lijn langs te lopen valt.
	 *
	 * Een looproute belooft dat je van punt naar punt rechtdoor kunt; meubels die
	 * ná de graaf op zo'n lijn zijn gezet breken die belofte, en dan loopt een sim
	 * er frontaal tegenaan. Ligt er meer dan één in de weg, dan komt de dichtste
	 * bij het vertrekpunt terug: die moet eerst opgelost.
	 */
	blockedBy(fromX: number, fromZ: number, toX: number, toZ: number, y: number, radius: number, climb: boolean): AABB | null {
		const dx = toX - fromX;
		const dz = toZ - fromZ;
		this.blockersNear(
			Math.min(fromX, toX) - radius,
			Math.max(fromX, toX) + radius,
			Math.min(fromZ, toZ) - radius,
			Math.max(fromZ, toZ) + radius,
			y,
			climb,
			this.segmentScratch,
		);
		let nearest: AABB | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const box of this.segmentScratch) {
			const grown = {
				minX: box.minX - radius,
				maxX: box.maxX + radius,
				minZ: box.minZ - radius,
				maxZ: box.maxZ + radius,
			};
			if (!segmentCrossesBox(grown, fromX, fromZ, dx, dz)) continue;
			const distance = Math.hypot(midpoint(box.minX, box.maxX) - fromX, midpoint(box.minZ, box.maxZ) - fromZ);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearest = box;
			}
		}
		return nearest;
	}

	private readonly segmentScratch: AABB[] = [];

	/**
	 * Resolve a circle (radius r) at (x,z) with optional y for floor-filtered boxes.
	 * Returns corrected position. Multi-pass for corners.
	 *
	 * `climb` loopt te voet door een climbable doorgang (trap, roltrap, lift) heen in
	 * plaats van erin; `wheeled` doet dat op wielen en dan alleen door wat ook `wheeled`
	 * toelaat. Zo botst een voertuig op de voetgangerstrap en rijdt het de lift wél in,
	 * afgeleid uit de poorten van elke doorgang in plaats van uit een lijst hier.
	 *
	 * `outside` is de speler-vrijstelling, en staat los van `boundsMode`: die is
	 * een veld op de gedeelde wereld, dus zodra hij op 'city' staat mag élke sim
	 * de mall uitlopen. Wie hem per aanroep meegeeft ruilt alleen de
	 * voetafdruk-klem in voor de wereldrand; de muren houden hem nog steeds
	 * tegen, en het atriumgat schopt hem er nog steeds uit.
	 */
	resolveCircle(
		x: number,
		z: number,
		y: number,
		radius: number,
		iterations = 3,
		climb = false,
		airborne = false,
		outside = false,
		wheeled = false,
		bodyClearance: BodyClearance | null = null,
	): { x: number; z: number } {
		let px = x;
		let pz = z;
		const inGarageExit =
			y < 0.8 &&
			px <= Math.max(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x) + 1.5 &&
			Math.abs(pz - PARKING_EXIT_RAMP.start.z) <= half(PARKING_EXIT_RAMP.width) + 1;
		const city = this.boundsMode === 'city' || inGarageExit;
		const unbounded = city || outside;
		for (let iter = 0; iter < iterations; iter++) {
			for (const b of this.boxes) {
				if (b.disabled) continue;
				if (b.outdoor && !unbounded) continue;
				if (b.climbable && ((climb && b.climbable.includes('walking')) || (wheeled && b.climbable.includes('wheeled')))) {
					continue;
				}
				// Mid-jump the void barrier doesn't exist — that's how you clear
				// the balustrade. Gravity takes it from there.
				if (airborne && (b.label === 'void_f1' || b.label === 'catwalk')) continue;
				// Cars outside: skip interior mall wall boxes that only exist for foot traffic
				if (city && y > -1 && b.label?.startsWith('store')) continue;
				if (b.minY !== undefined && y + BOX_FOOT_SLACK < b.minY) continue;
				if (b.maxY !== undefined && y > b.maxY) continue;

				// Closest point on AABB to circle center
				const cx = clamp(px, b.minX, b.maxX);
				const cz = clamp(pz, b.minZ, b.maxZ);
				const dx = px - cx;
				const dz = pz - cz;
				const d2 = dx * dx + dz * dz;
				if (d2 < radius * radius && bodyClearance && this.clearsOpenFlight(b.label, pz, radius, bodyClearance)) continue;

				// Center inside box → push to nearest face
				if (d2 < 1e-8) {
					const left = px - b.minX;
					const right = b.maxX - px;
					const down = pz - b.minZ;
					const up = b.maxZ - pz;
					const m = Math.min(left, right, down, up);
					if (m === left) px = b.minX - radius;
					else if (m === right) px = b.maxX + radius;
					else if (m === down) pz = b.minZ - radius;
					else pz = b.maxZ + radius;
					continue;
				}

				if (d2 < radius * radius) {
					const d = Math.sqrt(d2);
					const push = (radius - d) / d;
					px += dx * push;
					pz += dz * push;
				}
			}
		}

		if (unbounded) {
			// Full outdoor city world
			px = clamp(px, CITY_BOUNDS.minX, CITY_BOUNDS.maxX);
			pz = clamp(pz, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ);
		} else {
			// Keep inside mall footprint with margin
			const m = 1.2;
			const limitX = half(MALL_FOOTPRINT.width) - m;
			const limitZ = half(MALL_FOOTPRINT.depth) - m;
			px = clamp(px, -limitX, limitX);
			pz = clamp(pz, -limitZ, limitZ);
		}

		// Floor-1 void eject — only when standing/walking (not cars at basement).
		// Mid-jump (airborne) we MUST allow XZ over the hole so you can leap
		// the balustrade and plummet to the fountain plaza.
		//
		// Bovengrens net als in groundHeightAt: boven het gat ligt op dakhoogte
		// gewoon het glazen dak. Zonder die grens werd je daar weggeduwd, terwijl
		// er een vloer onder je voeten zat.
		if (!(airborne || city) && y > 4 && y < ROOF_H - 0.5) {
			const inHole = Math.abs(px) < 8.2 && Math.abs(pz) < 6.2;
			if (inHole) {
				const toEdgeX = 8.4 - Math.abs(px);
				const toEdgeZ = 6.4 - Math.abs(pz);
				if (toEdgeX < toEdgeZ) {
					px = px >= 0 ? 8.5 + radius : -8.5 - radius;
				} else {
					pz = pz >= 0 ? 6.5 + radius : -6.5 - radius;
				}
			}
		}

		return { x: px, z: pz };
	}

	/** Separate two agents (sim-sim / player-sim). */
	separate(ax: number, az: number, bx: number, bz: number, minDist: number): { ax: number; az: number; bx: number; bz: number } {
		let dx = bx - ax;
		let dz = bz - az;
		let d2 = dx * dx + dz * dz;
		if (d2 < 1e-8) {
			dx = 0.01;
			dz = 0;
			d2 = dx * dx;
		}
		const d = Math.sqrt(d2);
		if (d >= minDist) return { ax, az, bx, bz };
		// Full split each side (was 0.5 total → still overlapped under load)
		const push = (minDist - d) * 0.52;
		const nx = dx / d;
		const nz = dz / d;
		return {
			ax: ax - nx * push,
			az: az - nz * push,
			bx: bx + nx * push,
			bz: bz + nz * push,
		};
	}
}
