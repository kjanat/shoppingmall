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

import { MALL_FOOTPRINT } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { LEVELS, LEVELS_BOTTOM_UP, levelAt, levelBand, levelElevationIndex } from '#/data/levels';
import type { Bounds3, CardinalSide, SpatialVolume, WorldEntity } from '#/data/spatial';
import { GLASS_TAG, geometryBounds, NOT_A_PORTAL_TAG } from '#/data/spatial';
import { facadeOpeningWithin, slabOpeningWithin, WORLD_ENTITIES } from '#/data/world';
import { half, span } from '#/util/math';

export const ZONES = ['stad', 'p1', 'mall-v0', 'mall-v1', 'roof'] as const;

export type ZoneId = (typeof ZONES)[number];

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

export function zoneIndex(zone: ZoneId): number {
	const index = ZONE_INDEX.get(zone);
	if (index === undefined) throw new Error(`no zone ${zone}`);
	return index;
}

/** Zones reizen als bitmasker: een batch of een portaal raakt er meestal meer dan één. */
export function zoneBit(zone: ZoneId): number {
	return 1 << zoneIndex(zone);
}

export const ALL_ZONES_MASK = ZONES.reduce((mask, zone) => mask | zoneBit(zone), 0);

export function zonesOfMask(mask: number): readonly ZoneId[] {
	return ZONES.filter((zone) => (mask & zoneBit(zone)) !== 0);
}

export function zoneOfLevel(level: LevelId): ZoneId {
	return ZONE_BY_LEVEL[level];
}

const HALF_FOOTPRINT_X = half(MALL_FOOTPRINT.width);
const HALF_FOOTPRINT_Z = half(MALL_FOOTPRINT.depth);

/** Zonebit per dek, op hoogtevolgorde, zodat een doos over dekken heen één lus is. */
const ZONE_BIT_BY_ELEVATION: readonly number[] = LEVELS_BOTTOM_UP.map((entry) => zoneBit(zoneOfLevel(entry.id)));

/** Binnen de voetafdruk telt het dek, erbuiten is er geen gebouw en dus alleen stad. */
export function zoneAt(x: number, y: number, z: number): ZoneId {
	if (Math.abs(x) > HALF_FOOTPRINT_X || Math.abs(z) > HALF_FOOTPRINT_Z) return 'stad';
	return zoneOfLevel(levelAt(y));
}

/**
 * Elke zone die een doos aanraakt.
 *
 * Een muur van de voet tot de kroonlijst staat in vier zones tegelijk, en een
 * batch die hem bevat mag daarom nooit wegvallen. De doos is met opzet ruim: te
 * veel zones tekent te veel, te weinig laat geometrie verdwijnen die er staat.
 */
export function zoneMaskOfBounds(bounds: Bounds3): number {
	let mask = 0;
	if (bounds.minX < -HALF_FOOTPRINT_X || bounds.maxX > HALF_FOOTPRINT_X) mask |= zoneBit('stad');
	if (bounds.minZ < -HALF_FOOTPRINT_Z || bounds.maxZ > HALF_FOOTPRINT_Z) mask |= zoneBit('stad');
	const insideX = bounds.minX <= HALF_FOOTPRINT_X && bounds.maxX >= -HALF_FOOTPRINT_X;
	const insideZ = bounds.minZ <= HALF_FOOTPRINT_Z && bounds.maxZ >= -HALF_FOOTPRINT_Z;
	if (!insideX || !insideZ) return mask;
	const from = levelElevationIndex(levelAt(bounds.minY));
	const to = levelElevationIndex(levelAt(bounds.maxY));
	for (let index = from; index <= to; index++) mask |= ZONE_BIT_BY_ELEVATION[index] ?? 0;
	return mask;
}

/** De bol om een object heen als doos, want een zone is een doos en een bol niet. */
export function zoneMaskAround(x: number, y: number, z: number, radius: number): number {
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
export type ZonePortalFace = Readonly<{
	/** De entiteit die hem verklaart; de zonegraafcontrole meldt hem onder deze naam. */
	id: string;
	from: ZoneId;
	to: ZoneId;
	/** De opening in wereldcoördinaten, plat op het grensvlak tussen de twee zones. */
	aperture: Bounds3;
}>;

export type ZonePortal = Readonly<{
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
export function portalOfEntity(entity: WorldEntity): ZonePortal | null {
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
function zoneBand(zone: ZoneId): Readonly<{ minY: number; maxY: number }> {
	const level = levelOfZone(zone);
	if (!level) return { minY: Number.NEGATIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };
	return levelBand(level.id);
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
function deckSpan(zone: ZoneId): Readonly<{ minY: number; maxY: number }> {
	const level = levelOfZone(zone);
	if (!level) return { minY: Number.NEGATIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };
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
export function zoneVolume(zone: ZoneId): Bounds3 | null {
	if (zone === 'stad') return null;
	const band = zoneBand(zone);
	return {
		minX: -HALF_FOOTPRINT_X,
		maxX: HALF_FOOTPRINT_X,
		minY: band.minY,
		maxY: isOpenToSky(zone) ? band.minY + SKY_HEADROOM : band.maxY,
		minZ: -HALF_FOOTPRINT_Z,
		maxZ: HALF_FOOTPRINT_Z,
	};
}

function clipBounds(bounds: Bounds3, band: Readonly<{ minY: number; maxY: number }>): Bounds3 | null {
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
		const clipped = clipBounds(bounds, deckSpan(deck));
		return clipped === null ? null : facadeFaceOf(clipped);
	}
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
function facadeFaceOf(bounds: Bounds3): Bounds3 | null {
	const side = facadeSideOf(bounds);
	if (side === null) return null;
	const alongZ = side === 'west' || side === 'east';
	const opening = facadeOpeningWithin(side, {
		minU: alongZ ? bounds.minZ : bounds.minX,
		maxU: alongZ ? bounds.maxZ : bounds.maxX,
		minY: bounds.minY,
		maxY: bounds.maxY,
	});
	if (opening === null) return null;
	const face = { minY: opening.minY, maxY: opening.maxY };
	if (side === 'west') {
		return {
			...face,
			minX: -HALF_FOOTPRINT_X - INTERFACE_THICKNESS,
			maxX: -HALF_FOOTPRINT_X,
			minZ: opening.minU,
			maxZ: opening.maxU,
		};
	}
	if (side === 'east') {
		return {
			...face,
			minX: HALF_FOOTPRINT_X,
			maxX: HALF_FOOTPRINT_X + INTERFACE_THICKNESS,
			minZ: opening.minU,
			maxZ: opening.maxU,
		};
	}
	if (side === 'north') {
		return {
			...face,
			minZ: -HALF_FOOTPRINT_Z - INTERFACE_THICKNESS,
			maxZ: -HALF_FOOTPRINT_Z,
			minX: opening.minU,
			maxX: opening.maxU,
		};
	}
	return {
		...face,
		minZ: HALF_FOOTPRINT_Z,
		maxZ: HALF_FOOTPRINT_Z + INTERFACE_THICKNESS,
		minX: opening.minU,
		maxX: opening.maxU,
	};
}

/** Welke gevel het portaal doorsnijdt, of null als het binnen de voetafdruk blijft. */
function facadeSideOf(bounds: Bounds3): CardinalSide | null {
	if (bounds.minX < -HALF_FOOTPRINT_X) return 'west';
	if (bounds.maxX > HALF_FOOTPRINT_X) return 'east';
	if (bounds.minZ < -HALF_FOOTPRINT_Z) return 'north';
	if (bounds.maxZ > HALF_FOOTPRINT_Z) return 'south';
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
	if (!fromLevel || !toLevel) return null;
	const upward = levelElevationIndex(toLevel.id) > levelElevationIndex(fromLevel.id);
	const boundary = upward ? LEVELS_BOTTOM_UP[levelElevationIndex(fromLevel.id) + 1] : fromLevel;
	if (!boundary) return null;
	if (bounds.minY > boundary.y || bounds.maxY < boundary.y) return null;
	const opening = slabOpeningWithin(boundary.id, bounds);
	if (!opening) return null;
	return { ...opening, minY: boundary.y - INTERFACE_THICKNESS, maxY: boundary.y + INTERFACE_THICKNESS };
}

/** Elke entiteit die doorkijk verklaart, of ze nu twee zones raakt of één. */
export const PORTAL_CANDIDATES: readonly ZonePortal[] = WORLD_ENTITIES.map(portalOfEntity).filter(
	(candidate): candidate is ZonePortal => candidate !== null,
);

function portalZoneCount(portal: ZonePortal): number {
	return zonesOfMask(portal.mask).length;
}

export const ZONE_PORTALS: readonly ZonePortal[] = PORTAL_CANDIDATES.filter((portal) => portalZoneCount(portal) > 1);

/** De entiteiten die doorkijk verklaren en tóch niets verbinden, met hun vrijstelling erbij. */
export function declaredNonPortals(): readonly Readonly<{ id: string; exempt: boolean }>[] {
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

export const SKY_ZONES_MASK = ZONES.reduce((mask, zone) => (openToSky(zone) ? mask | zoneBit(zone) : mask), 0);

export function isOpenToSky(zone: ZoneId): boolean {
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
export function visibleZonesMask(zone: ZoneId): number {
	return VISIBLE_ZONES.get(zone) ?? ALL_ZONES_MASK;
}

export function visibleZones(zone: ZoneId): readonly ZoneId[] {
	return zonesOfMask(visibleZonesMask(zone));
}

export function seesZone(from: ZoneId, target: ZoneId): boolean {
	return (visibleZonesMask(from) & zoneBit(target)) !== 0;
}

const FACES_FROM: ReadonlyMap<ZoneId, readonly ZonePortalFace[]> = new Map(
	ZONES.map((zone) => [zone, ZONE_PORTALS.flatMap((portal) => portal.faces.filter((face) => face.from === zone))]),
);

/** De doorkijken die vanuit deze zone ergens anders heen gaan. */
export function portalsFrom(zone: ZoneId): readonly ZonePortalFace[] {
	return FACES_FROM.get(zone) ?? [];
}

/** Elke zone die je vanaf `zone` via portalen kunt bereiken, hoe ver ook. */
export function reachableZones(zone: ZoneId): readonly ZoneId[] {
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
