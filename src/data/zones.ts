/**
 * De zonegraaf: welke stukken wereld er tegelijk toe doen.
 *
 * Vanaf de stoep werd het hele interieur getekend én gesimuleerd. Frustumculling
 * kan dat niet oplossen, want het interieur zit vanaf de straat werkelijk in de
 * kegel: de camera staat op 17 m van een gebouw van 100 m. Wat ontbrak is het
 * onderscheid tussen "in beeld" en "te zien": een vloer met een dak erop is pas
 * zichtbaar door een opening, en dat is precies wat het wereldmodel al opschrijft.
 *
 * Een zone is een dek binnen de voetafdruk, plus de stad eromheen. Een portaal is
 * geen tweede lijst maar een afgeleide: elke entiteit met een `opening-clearance`
 * of `connector-clearance` volume verklaart al vrije ruimte waar je doorheen komt,
 * en elk `GLASS_TAG`-volume verklaart geometrie waar je doorheen kijkt. De zones
 * die zo'n volume aanraakt zijn de zones die het aan elkaar knoopt.
 *
 * Wie de zonegraaf leest hoort ook `visibleZones` te lezen en niet zelf twee
 * dekken te vergelijken: de dekregel alleen laat de lichtkoepel en de hoofdingang
 * weg, en dat zijn nu juist de gaten waar dit over gaat.
 */

import { CON_ENVELOPE, CON_FOOTPRINT, CON_ZONE_VOLUME } from '#/data/conPlan';
import { conOpeningWithin } from '#/data/conWorld';
import { MALL_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, LEVELS_BOTTOM_UP, levelAt, levelBand, levelElevationIndex, levelY } from '#/data/levels';
import { poolFloorY } from '#/data/pool';
import type { Bounds2, Bounds3, CardinalSide, SpatialVolume, WorldEntity } from '#/data/spatial';
import { GLASS_TAG, geometryBounds, NOT_A_PORTAL_TAG } from '#/data/spatial';
import type { FacadePanel } from '#/data/world';
import {
	facadeOpeningWithin,
	MALL_WALL_ENVELOPE,
	slabOpeningWithin,
	THEATRE_ENVELOPE,
	THEATRE_WALL_ENVELOPE,
	THEATRE_ZONE_VOLUME,
	theatreOpeningWithin,
	WORLD_ENTITIES,
} from '#/data/world';
import { half, span } from '#/util/math';

const ZONES = ['stad', 'p1', 'mall-v0', 'mall-v1', 'roof', 'theatre', 'con'] as const;

type ZoneId = (typeof ZONES)[number];

/**
 * Welk dek in welke zone ligt. Buiten de voetafdruk is er geen dek en is alles
 * `stad`, ook boven het dak: wie erover heen vliegt is de stad in.
 */
const ZONE_BY_LEVEL: Readonly<Record<LevelId, ZoneId>> = {
	p1: 'p1',
	v0: 'mall-v0',
	v1: 'mall-v1',
	roof: 'roof',
};

const ZONE_INDEX: ReadonlyMap<ZoneId, number> = new Map(ZONES.map((zone, index) => [zone, index]));

function zoneIndex(zone: ZoneId): number {
	const index = ZONE_INDEX.get(zone);
	if (index === undefined) throw new Error(`no zone ${zone}`);
	return index;
}

/** Zones reizen als bitmasker: een batch of een portaal raakt er meestal meer dan één. */
function zoneBit(zone: ZoneId): number {
	return 1 << zoneIndex(zone);
}

const ALL_ZONES_MASK = ZONES.reduce((mask, zone) => mask | zoneBit(zone), 0);

function zonesOfMask(mask: number): readonly ZoneId[] {
	return ZONES.filter((zone) => (mask & zoneBit(zone)) !== 0);
}

function zoneOfLevel(level: LevelId): ZoneId {
	return ZONE_BY_LEVEL[level];
}

/** Zonebit per dek, op hoogtevolgorde, zodat een doos over dekken heen één lus is. */
const ZONE_BIT_BY_ELEVATION: readonly number[] = LEVELS_BOTTOM_UP.map((entry) => zoneBit(zoneOfLevel(entry.id)));

type Band = Readonly<{ minY: number; maxY: number }>;

/**
 * Eén gebouw met een binnenkant.
 *
 * De zonegraaf ging over de mall alleen: buiten de voetafdruk was alles stad, en
 * het theater was dan ook een massief blok waar niets in zat. Nu er twee gebouwen
 * staan is de vraag "in welk gebouw sta ik" een lus geworden in plaats van een
 * vergelijking met één voetafdruk, en de rest van dit bestand stelt hem één keer.
 *
 * `plan` is de hartlijn van de schil — voor de mall precies `MALL_FOOTPRINT` —
 * want daar hoort het buitenvlak van de gevel een halve wanddikte buiten te liggen
 * en is een dorpel die dat vlak doorsnijdt herkenbaar als doorsnijding.
 */
type Enclosure = Readonly<{
	id: 'mall' | 'theatre' | 'con';
	plan: Bounds2;
	/** De omhullende van zijn wandkasten: de huid waar de gevelcontrole tegen meet. */
	envelope: Bounds2;
	band: Band;
	/** De zones erin, van onder naar boven. */
	zones: readonly ZoneId[];
	zoneOfY: (y: number) => ZoneId;
	/** Elke zone die de hoogteband `minY..maxY` erin aanraakt. */
	zonesOfY: (minY: number, maxY: number) => number;
	openingWithin: (side: CardinalSide, face: FacadePanel) => FacadePanel | null;
}>;

const UNBOUNDED: Band = { minY: Number.NEGATIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };

/**
 * Elke zone waarvan de luchtruimband — van zijn eigen dek tot het dek erboven —
 * de hoogteband `minY..maxY` overlapt: inclusief op het eigen dekvlak, strikt onder
 * het plafond.
 *
 * Inclusief onderaan omdat een dekplaat op de grens ligt: zijn bovenkant is de vloer
 * van de zone erboven, zijn onderkant het plafond van de zone eronder, en hij hoort
 * dus bij allebei. `levelAt` telde `DECK_SLACK` bij de ondergrens op en tilde een
 * plaat die een paar centimeter onder een dek hangt volledig in de zone erboven: de
 * dakplaat las alleen `roof` en verdween vanaf V1 zodra geen portaalkegel de
 * roof-zone dekte, terwijl je er van onderaf recht tegenaan keek. Strikt bovenaan
 * omdat iets dat met zijn onderkant op een dek rúst er niet doorheen breekt: het
 * atrium staat op de V0-plaat en mag daarom p1 niet claimen.
 */
function mallZonesOfSpan(minY: number, maxY: number): number {
	// ExtrudeGeometry bewaart zijn posities als Float32. Een plaat met topY 6
	// komt daardoor na de wereldtransformatie uit op 5.999999988 en miste zonder
	// speling het dek waarvan hij de vloer is. Richting een portaal bleef zo'n
	// fout gemaskeerd; richting een dichte wand verdween de hele vloerbatch.
	const boundarySlack = 1e-5;
	let mask = 0;
	for (let index = 0; index < LEVELS_BOTTOM_UP.length; index++) {
		const entry = LEVELS_BOTTOM_UP[index];
		if (!entry) continue;
		const lo = LEVELS_BOTTOM_UP[index - 1] ? entry.y : Number.NEGATIVE_INFINITY;
		const hi = LEVELS_BOTTOM_UP[index + 1]?.y ?? Number.POSITIVE_INFINITY;
		if (maxY >= lo - boundarySlack && minY < hi) mask |= ZONE_BIT_BY_ELEVATION[index] ?? 0;
	}
	return mask;
}

const MALL_PLAN: Bounds2 = {
	minX: -half(MALL_FOOTPRINT.width),
	maxX: half(MALL_FOOTPRINT.width),
	minZ: -half(MALL_FOOTPRINT.depth),
	maxZ: half(MALL_FOOTPRINT.depth),
};

const THEATRE_BAND: Band = { minY: THEATRE_ZONE_VOLUME.minY, maxY: THEATRE_ZONE_VOLUME.maxY };

const ENCLOSURES: readonly Enclosure[] = [
	{
		id: 'mall',
		plan: MALL_PLAN,
		envelope: MALL_WALL_ENVELOPE,
		band: UNBOUNDED,
		zones: LEVELS_BOTTOM_UP.map((entry) => zoneOfLevel(entry.id)),
		zoneOfY: (y) => zoneOfLevel(levelAt(y)),
		zonesOfY: mallZonesOfSpan,
		openingWithin: facadeOpeningWithin,
	},
	{
		id: 'theatre',
		plan: THEATRE_ENVELOPE,
		envelope: THEATRE_WALL_ENVELOPE,
		band: THEATRE_BAND,
		zones: ['theatre'],
		zoneOfY: () => 'theatre',
		zonesOfY: (minY, maxY) => (maxY > THEATRE_BAND.minY && minY < THEATRE_BAND.maxY ? zoneBit('theatre') : 0),
		openingWithin: theatreOpeningWithin,
	},
	{
		id: 'con',
		plan: CON_ENVELOPE,
		envelope: CON_FOOTPRINT,
		band: { minY: CON_ZONE_VOLUME.minY, maxY: CON_ZONE_VOLUME.maxY },
		zones: ['con'],
		zoneOfY: () => 'con',
		zonesOfY: (minY, maxY) => (maxY > CON_ZONE_VOLUME.minY && minY < CON_ZONE_VOLUME.maxY ? zoneBit('con') : 0),
		openingWithin: conOpeningWithin,
	},
];

const ENCLOSURE_BY_ZONE: ReadonlyMap<ZoneId, Enclosure> = new Map(
	ENCLOSURES.flatMap((enclosure) => enclosure.zones.map((zone) => [zone, enclosure] as const)),
);

/**
 * De gebouwen zoals de rest van de wereld ze mag lezen: hun naam en hun schil.
 *
 * De gevelcontrole meet elk volume tegen de omhullende van het gebouw waar het in
 * staat. Zonder deze lijst kende ze er maar één en stak het hele theater honderd
 * meter voorbij de oostgevel van de mall uit.
 */
const ZONE_ENCLOSURES: readonly Readonly<{
	id: 'mall' | 'theatre' | 'con';
	plan: Bounds2;
	envelope: Bounds2;
	band: Band;
}>[] = ENCLOSURES.map((enclosure) => ({
	id: enclosure.id,
	plan: enclosure.plan,
	envelope: enclosure.envelope,
	band: enclosure.band,
}));

/**
 * Staat deze grondkolom onder een gebouw, met `margin` extra rondom?
 *
 * Afgeleid uit dezelfde schillen als de zonegraaf: wie wil weten of het hier droog is
 * leest de gebouwen die er staan, niet een tweede rechthoek naast de eerste. De marge
 * dekt de dakrand die een halve winkel voorbij de gevel uitsteekt.
 */
function coversColumn(x: number, z: number, margin = 0): boolean {
	return ZONE_ENCLOSURES.some(
		({ plan }) => x >= plan.minX - margin && x <= plan.maxX + margin && z >= plan.minZ - margin && z <= plan.maxZ + margin,
	);
}

function planOverlaps(plan: Bounds2, bounds: Bounds3): boolean {
	return bounds.minX <= plan.maxX && bounds.maxX >= plan.minX && bounds.minZ <= plan.maxZ && bounds.maxZ >= plan.minZ;
}

function planHolds(plan: Bounds2, bounds: Bounds3): boolean {
	return bounds.minX >= plan.minX && bounds.maxX <= plan.maxX && bounds.minZ >= plan.minZ && bounds.maxZ <= plan.maxZ;
}

/** Het gebouw waar dit punt in staat, of null als het buiten staat. */
function enclosureAt(x: number, y: number, z: number): Enclosure | null {
	for (const enclosure of ENCLOSURES) {
		const { plan, band } = enclosure;
		if (x < plan.minX || x > plan.maxX || z < plan.minZ || z > plan.maxZ) continue;
		if (y < band.minY || y > band.maxY) continue;
		return enclosure;
	}
	return null;
}

const ROOF_DECK_Y = levelY('roof');

/**
 * Staat dit punt in de kuip van het dakzwembad?
 *
 * De badbodem ligt tot 1,05 m onder het dek en dus onder de dakdrempel van `levelAt`:
 * wie in het diepe zwemt of daar hurkt zakt met zijn camera onder die drempel en leest
 * dan V1 terwijl hij op het dak staat, waarna de zonecull het interieur eronder tekent
 * en je dwars door het gebouw kijkt. De kuip is afgeleid uit haar eigen waterlijn
 * (`poolFloorY` geeft alleen binnen de waterlijn een bodem), geen ingetikte doos: waar
 * die een bodem teruggeeft hoort de kolom tot het dek erboven.
 */
function inRoofBasin(x: number, y: number, z: number): boolean {
	const floor = poolFloorY(x, z);
	if (floor === null) return false;
	return y >= floor && y < ROOF_DECK_Y;
}

/** Binnen een gebouw telt zijn eigen dek, erbuiten is er geen gebouw en dus alleen stad. */
function zoneAt(x: number, y: number, z: number): ZoneId {
	if (inRoofBasin(x, y, z)) return 'roof';
	return enclosureAt(x, y, z)?.zoneOfY(y) ?? 'stad';
}

/**
 * Welk dek een lichaam op deze plek toebehoort, de zwembadkuip meegerekend.
 *
 * `levelAt` kent alleen hoogte en legt een zwemmer in het diepe een verdieping te laag;
 * de HUD en de zonekeuze horen hem op het dak te tellen, waar hij ook zwemt.
 */
function deckAt(x: number, y: number, z: number): LevelId {
	if (inRoofBasin(x, y, z)) return 'roof';
	return levelAt(y);
}

/**
 * Elke zone die een doos aanraakt.
 *
 * Een muur van de voet tot de kroonlijst staat in vier zones tegelijk, en een
 * batch die hem bevat mag daarom nooit wegvallen. De doos is met opzet ruim: te
 * veel zones tekent te veel, te weinig laat geometrie verdwijnen die er staat.
 *
 * Stad komt erbij zodra de doos niet volledig in één gebouw past. Dat is de reden
 * dat de gebouwen elkaar niet mogen raken: paste een doos in de vereniging van
 * twee schillen zonder in één ervan te passen, dan zou ze hier ten onrechte de
 * stad claimen. `controleTheater` leest die afstand na.
 */
function zoneMaskOfBounds(bounds: Bounds3): number {
	let mask = 0;
	let housed = false;
	for (const enclosure of ENCLOSURES) {
		if (!planOverlaps(enclosure.plan, bounds)) continue;
		mask |= enclosure.zonesOfY(bounds.minY, bounds.maxY);
		if (planHolds(enclosure.plan, bounds) && bounds.minY >= enclosure.band.minY && bounds.maxY <= enclosure.band.maxY) {
			housed = true;
		}
	}
	if (!housed) mask |= zoneBit('stad');
	return mask;
}

/** De bol om een object heen als doos, want een zone is een doos en een bol niet. */
function zoneMaskAround(x: number, y: number, z: number, radius: number): number {
	return zoneMaskOfBounds({
		minX: x - radius,
		maxX: x + radius,
		minY: y - radius,
		maxY: y + radius,
		minZ: z - radius,
		maxZ: z + radius,
	});
}

/**
 * Eén gerichte doorkijk: wat je vanuit `from` van `to` te zien krijgt.
 *
 * Gericht, want de opening zit aan de rand van de zone waar je in staat. Vanaf het
 * dak kijk je door het gat in de dakplaat de begane grond op; vanaf de begane grond
 * kijk je door het gat in de V1-plaat het dak op. Twee verschillende gaten, en de
 * kegel die je erdoorheen kunt trekken is dan ook een andere.
 *
 * Ongericht was hij eerder de hele vrije ruimte van de entiteit, en dat is voor een
 * uitrit een tunnel van zestien meter en voor de lift een koker van tweeëntwintig:
 * van dichtbij dekt zo'n kegel het halve beeld en cullt hij niets.
 */
type ZonePortalFace = Readonly<{
	/** De entiteit die hem verklaart; de zonegraafcontrole meldt hem onder deze naam. */
	id: string;
	from: ZoneId;
	to: ZoneId;
	/** De opening in wereldcoördinaten, plat op het grensvlak tussen de twee zones. */
	aperture: Bounds3;
}>;

type ZonePortal = Readonly<{
	/** De entiteit die hem verklaart; de zonegraafcontrole meldt hem onder deze naam. */
	id: string;
	label: string;
	/** De zones die hij aan elkaar knoopt. Meer dan twee mag: het atrium knoopt er drie. */
	mask: number;
	/** Alles wat de entiteit aan doorkijk verklaart, samen. */
	bounds: Bounds3;
	faces: readonly ZonePortalFace[];
}>;

/** Vrije ruimte die je passeert, of glas dat je erdoorheen laat kijken. */
function seesThrough(volume: SpatialVolume): boolean {
	if (volume.tags.includes(GLASS_TAG)) return true;
	return volume.role === 'opening-clearance' || volume.role === 'connector-clearance';
}

function unionBounds(a: Bounds3, b: Bounds3): Bounds3 {
	return {
		minX: Math.min(a.minX, b.minX),
		maxX: Math.max(a.maxX, b.maxX),
		minY: Math.min(a.minY, b.minY),
		maxY: Math.max(a.maxY, b.maxY),
		minZ: Math.min(a.minZ, b.minZ),
		maxZ: Math.max(a.maxZ, b.maxZ),
	};
}

/**
 * Wat een entiteit aan doorkijk verklaart, of null als ze niets verklaart.
 *
 * De puistrook van een winkel valt hier buiten: `storefront-clearance` houdt de
 * vloer vóór de etalage vrij en verbindt geen twee dekken.
 */
function portalOfEntity(entity: WorldEntity): ZonePortal | null {
	let bounds: Bounds3 | null = null;
	for (const volume of entity.volumes) {
		if (!seesThrough(volume)) continue;
		const volumeBounds = geometryBounds(volume.geometry);
		bounds = bounds === null ? volumeBounds : unionBounds(bounds, volumeBounds);
	}
	if (bounds === null) return null;
	const mask = zoneMaskOfBounds(bounds);
	const faces: ZonePortalFace[] = [];
	for (const from of zonesOfMask(mask)) {
		for (const to of zonesOfMask(mask)) {
			if (from === to) continue;
			const aperture = interfaceAperture(bounds, from, to);
			if (aperture) faces.push({ id: entity.id, from, to, aperture });
		}
	}
	return { id: entity.id, label: entity.label, mask, bounds, faces };
}

/** Halve dikte van een grensvlak. Dun genoeg om een kegel strak te houden, dik genoeg om te bestaan. */
const INTERFACE_THICKNESS = 0.05;

/**
 * De hoogteband van een zone.
 *
 * Precies de band waarin `levelAt` dat dek antwoordt, want dat is de functie die
 * `zoneAt` en `zoneMaskOfBounds` gebruiken. Een eigen afleiding uit de dekhoogte
 * kwam een halve meter hoger uit en legde de dikte van elke vloerplaat buiten de
 * zone waar diezelfde plaat volgens de rest van dit bestand in ligt.
 */
function zoneBand(zone: ZoneId): Band {
	const level = levelOfZone(zone);
	if (level) return levelBand(level.id);
	return ENCLOSURE_BY_ZONE.get(zone)?.band ?? UNBOUNDED;
}

function levelOfZone(zone: ZoneId): (typeof LEVELS)[number] | undefined {
	if (zone === 'stad') return undefined;
	return LEVELS.find((entry) => zoneOfLevel(entry.id) === zone);
}

/**
 * Van dek tot dek: het stuk gevel dat bij deze zone hoort.
 *
 * Níét de band van `levelAt`, die `DECK_SLACK` lager begint. Dat halve metertje
 * valt onder de voet van de gevelschil, en daar is er geen schil meer om een gat in
 * te missen: de uitritgeul kreeg er een reepje raam van twintig centimeter door, in
 * een muur die op dat dek gewoon dicht is. Onder het onderste dek en boven het
 * bovenste houdt de gevel niet op, dus daar houdt deze band ook niet op.
 */
function deckSpan(zone: ZoneId): Band {
	const level = levelOfZone(zone);
	if (!level) return ENCLOSURE_BY_ZONE.get(zone)?.band ?? UNBOUNDED;
	const index = levelElevationIndex(level.id);
	const below = LEVELS_BOTTOM_UP[index - 1];
	const above = LEVELS_BOTTOM_UP[index + 1];
	return {
		minY: below ? level.y : Number.NEGATIVE_INFINITY,
		maxY: above ? above.y : Number.POSITIVE_INFINITY,
	};
}

/**
 * Hoeveel lucht er boven het bovenste dek nog bij die zone hoort.
 *
 * Op het dak staat geen plafond, dus die band eindigt nergens uit zichzelf. Wat er
 * wél staat — het eiland, de palmen, de liftopbouw — reikt niet hoger dan het
 * gebouw waar het op staat, dus dat is de maat. Ruim genoeg dat er niets buiten
 * valt, en nog altijd een band en niet het hele beeld.
 */
const SKY_HEADROOM = span(LEVELS_BOTTOM_UP[0]?.y ?? 0, LEVELS_BOTTOM_UP[LEVELS_BOTTOM_UP.length - 1]?.y ?? 0);

/**
 * De doos waar een zone zelf in ligt, of null als hij nergens ophoudt.
 *
 * Een dek is de voetafdruk maal zijn hoogteband; de stad is alles daarbuiten en
 * heeft dus geen doos. Dit is wat "is er iets van die zone in beeld" beantwoordt:
 * een kegel zegt dat er een doorkijk bestaat, niet dat er iets achter ligt. Vanaf
 * de stoep is dat het verschil tussen het dak wegcullen en het hele gebouw tekenen.
 */
function zoneVolume(zone: ZoneId): Bounds3 | null {
	const enclosure = ENCLOSURE_BY_ZONE.get(zone);
	if (!enclosure) return null;
	const band = zoneBand(zone);
	return {
		...enclosure.plan,
		minY: band.minY,
		maxY: isOpenToSky(zone) ? band.minY + SKY_HEADROOM : band.maxY,
	};
}

function clipBounds(bounds: Bounds3, band: Band): Bounds3 | null {
	const minY = Math.max(bounds.minY, band.minY);
	const maxY = Math.min(bounds.maxY, band.maxY);
	if (maxY - minY <= 0) return null;
	return { ...bounds, minY, maxY };
}

/**
 * Waar twee zones elkaar raken, gesneden op de doos van het portaal.
 *
 * Tussen twee dekken is dat het vlak van de plaat aan de rand van `from`, en
 * alleen als die plaat daar ook echt open is. Tussen een dek en de stad is het de
 * gevellijn, op de hoogteband van het dek: de pui van de hoofdingang op V0 en het
 * glas erboven op V1 zijn twee verschillende gaten in dezelfde muur.
 */
function interfaceAperture(bounds: Bounds3, from: ZoneId, to: ZoneId): Bounds3 | null {
	if (from === 'stad' || to === 'stad') {
		const deck = from === 'stad' ? to : from;
		const enclosure = ENCLOSURE_BY_ZONE.get(deck);
		if (!enclosure) return null;
		const clipped = clipBounds(bounds, deckSpan(deck));
		return clipped === null ? null : facadeFaceOf(enclosure, clipped);
	}
	// Twee gebouwen delen geen wand, dus er is geen vlak waarop ze elkaar raken.
	if (ENCLOSURE_BY_ZONE.get(from) !== ENCLOSURE_BY_ZONE.get(to)) return null;
	return deckFaceOf(bounds, from, to);
}

/**
 * Het stuk gevel dat het portaal doorsnijdt, plat op de voetafdruklijn.
 *
 * Alleen waar de gevel daar ook werkelijk open is. Zonder die vraag maakte elk
 * volume dat de lijn kruist een raam: de vrije ruimte van de parkeeruitrit is één
 * doos van x −46 tot −30 en gaf V0 een gat van dertien vierkante meter in de
 * westgevel, precies waar `wall_w_above_exit` staat. De dekkant vroeg het al
 * (`slabOpeningWithin`); de stadkant vroeg niets.
 */
function facadeFaceOf(enclosure: Enclosure, bounds: Bounds3): Bounds3 | null {
	const plan = enclosure.plan;
	const side = facadeSideOf(plan, bounds);
	if (side === null) return null;
	const alongZ = side === 'west' || side === 'east';
	const opening = enclosure.openingWithin(side, {
		minU: alongZ ? bounds.minZ : bounds.minX,
		maxU: alongZ ? bounds.maxZ : bounds.maxX,
		minY: bounds.minY,
		maxY: bounds.maxY,
	});
	if (opening === null) return null;
	const face = { minY: opening.minY, maxY: opening.maxY };
	if (side === 'west') {
		return { ...face, minX: plan.minX - INTERFACE_THICKNESS, maxX: plan.minX, minZ: opening.minU, maxZ: opening.maxU };
	}
	if (side === 'east') {
		return { ...face, minX: plan.maxX, maxX: plan.maxX + INTERFACE_THICKNESS, minZ: opening.minU, maxZ: opening.maxU };
	}
	if (side === 'north') {
		return { ...face, minZ: plan.minZ - INTERFACE_THICKNESS, maxZ: plan.minZ, minX: opening.minU, maxX: opening.maxU };
	}
	return { ...face, minZ: plan.maxZ, maxZ: plan.maxZ + INTERFACE_THICKNESS, minX: opening.minU, maxX: opening.maxU };
}

/** Welke gevel het portaal doorsnijdt, of null als het binnen de schil blijft. */
function facadeSideOf(plan: Bounds2, bounds: Bounds3): CardinalSide | null {
	if (bounds.minX < plan.minX) return 'west';
	if (bounds.maxX > plan.maxX) return 'east';
	if (bounds.minZ < plan.minZ) return 'north';
	if (bounds.maxZ > plan.maxZ) return 'south';
	return null;
}

/**
 * Het gat in de plaat aan de rand van `from` waardoor je richting `to` kijkt.
 *
 * De plaat moet daar open zijn. De hoofdingang beslaat twee verdiepingen glas en
 * raakt dus V0 én V1, maar de vloer ertussen ligt er gewoon: zonder deze vraag zou
 * hij een doorkijk melden waar een dek zit.
 */
function deckFaceOf(bounds: Bounds3, from: ZoneId, to: ZoneId): Bounds3 | null {
	const fromLevel = LEVELS.find((entry) => zoneOfLevel(entry.id) === from);
	const toLevel = LEVELS.find((entry) => zoneOfLevel(entry.id) === to);
	if (!(fromLevel && toLevel)) return null;
	const upward = levelElevationIndex(toLevel.id) > levelElevationIndex(fromLevel.id);
	const boundary = upward ? LEVELS_BOTTOM_UP[levelElevationIndex(fromLevel.id) + 1] : fromLevel;
	if (!boundary) return null;
	if (bounds.minY > boundary.y || bounds.maxY < boundary.y) return null;
	const opening = slabOpeningWithin(boundary.id, bounds);
	if (!opening) return null;
	return { ...opening, minY: boundary.y - INTERFACE_THICKNESS, maxY: boundary.y + INTERFACE_THICKNESS };
}

/** Elke entiteit die doorkijk verklaart, of ze nu twee zones raakt of één. */
const PORTAL_CANDIDATES: readonly ZonePortal[] = WORLD_ENTITIES.map(portalOfEntity).filter(
	(candidate): candidate is ZonePortal => candidate !== null,
);

function portalZoneCount(portal: ZonePortal): number {
	return zonesOfMask(portal.mask).length;
}

const ZONE_PORTALS: readonly ZonePortal[] = PORTAL_CANDIDATES.filter((portal) => portalZoneCount(portal) > 1);

/** De entiteiten die doorkijk verklaren en tóch niets verbinden, met hun vrijstelling erbij. */
function declaredNonPortals(): readonly Readonly<{ id: string; exempt: boolean }>[] {
	const singles = new Set(PORTAL_CANDIDATES.filter((portal) => portalZoneCount(portal) === 1).map((portal) => portal.id));
	return WORLD_ENTITIES.filter((entity) => singles.has(entity.id) || entity.tags.includes(NOT_A_PORTAL_TAG)).map((entity) => ({
		id: entity.id,
		exempt: entity.tags.includes(NOT_A_PORTAL_TAG),
	}));
}

/**
 * Zones met niets erboven. Afgeleid uit de dekvolgorde en niet opgeschreven: het
 * dak is het bovenste dek en de stad heeft per definitie geen plafond, dus die
 * twee zien elkaar over de dakrand heen zonder dat daar een opening voor nodig is.
 */
function openToSky(zone: ZoneId): boolean {
	if (zone === 'stad') return true;
	const level = LEVELS.find((entry) => zoneOfLevel(entry.id) === zone);
	if (!level) return false;
	return levelElevationIndex(level.id) === LEVELS.length - 1;
}

const SKY_ZONES_MASK = ZONES.reduce((mask, zone) => (openToSky(zone) ? mask | zoneBit(zone) : mask), 0);

function isOpenToSky(zone: ZoneId): boolean {
	return (SKY_ZONES_MASK & zoneBit(zone)) !== 0;
}

function computeVisibleZones(zone: ZoneId): number {
	let mask = zoneBit(zone);
	for (const portal of ZONE_PORTALS) {
		if ((portal.mask & zoneBit(zone)) === 0) continue;
		mask |= portal.mask;
	}
	if (isOpenToSky(zone)) mask |= SKY_ZONES_MASK;
	return mask;
}

const VISIBLE_ZONES: ReadonlyMap<ZoneId, number> = new Map(ZONES.map((zone) => [zone, computeVisibleZones(zone)]));

/**
 * De zone zelf plus alles wat er vanuit te zien is: door zijn portalen, en over de
 * dakrand voor de twee zones die onder de open lucht liggen.
 */
function visibleZonesMask(zone: ZoneId): number {
	return VISIBLE_ZONES.get(zone) ?? ALL_ZONES_MASK;
}

function visibleZones(zone: ZoneId): readonly ZoneId[] {
	return zonesOfMask(visibleZonesMask(zone));
}

function seesZone(from: ZoneId, target: ZoneId): boolean {
	return (visibleZonesMask(from) & zoneBit(target)) !== 0;
}

const FACES_FROM: ReadonlyMap<ZoneId, readonly ZonePortalFace[]> = new Map(
	ZONES.map((zone) => [zone, ZONE_PORTALS.flatMap((portal) => portal.faces.filter((face) => face.from === zone))]),
);

/** De doorkijken die vanuit deze zone ergens anders heen gaan. */
function portalsFrom(zone: ZoneId): readonly ZonePortalFace[] {
	return FACES_FROM.get(zone) ?? [];
}

/** Elke zone die je vanaf `zone` via portalen kunt bereiken, hoe ver ook. */
function reachableZones(zone: ZoneId): readonly ZoneId[] {
	let mask = zoneBit(zone);
	for (;;) {
		let grown = mask;
		for (const portal of ZONE_PORTALS) {
			if ((portal.mask & mask) !== 0) grown |= portal.mask;
		}
		if (grown === mask) return zonesOfMask(mask);
		mask = grown;
	}
}

export { ZONES, zoneIndex, zoneBit, ALL_ZONES_MASK, zonesOfMask, zoneOfLevel, ZONE_ENCLOSURES, coversColumn, zoneAt, deckAt, zoneMaskOfBounds, zoneMaskAround, portalOfEntity, zoneVolume, PORTAL_CANDIDATES, ZONE_PORTALS, declaredNonPortals, SKY_ZONES_MASK, isOpenToSky, visibleZonesMask, visibleZones, seesZone, portalsFrom, reachableZones };
export type { ZoneId, ZonePortalFace, ZonePortal };
