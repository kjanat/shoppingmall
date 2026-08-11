#!/usr/bin/env bun
/**
 * Wereldcontrole: alles wat op twee plekken staat en het eens moet blijven.
 *
 * Elke bug die dit script afdekt is ooit met een wegwerpscript gevonden en
 * daarna weer weggegooid, waarna dezelfde soort fout terugkwam op de volgende
 * plek: schappen op de helipad, een vloergat naast zijn helling, zwemmers op
 * de tegels, een dak waar je vanaf werd geduwd. Opgeschreven in een comment is
 * niet afgedwongen. Vandaar dit script, en vandaar dat het aan `build` hangt.
 *
 * Geen browser nodig. CollisionWorld, de datamodules en de pure exports van
 * RoofIsland draaien kaal in Bun. De twee winkelbouwers niet — die bakken hun
 * labels in een canvas — dus die krijgen een canvasstub en worden hier echt
 * gebouwd. Wat ook daarmee niet draait (PoolPeople, en de private maten van
 * MallBuilder) wordt uit de bron gelezen in plaats van hier overgeschreven:
 * een tweede kopie van een getal is nou juist het probleem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { Mesh, Vector3 } from 'three';
import type { PedestrianPosture } from '#/data/character';
import { CROUCHING_PEDESTRIAN, postureHeadroom, STANDING_PEDESTRIAN } from '#/data/character';
import { assertValidVerticalConnectorRegistry } from '#/data/connectors';
import type { GraphNode } from '#/data/graph';
import { NODES } from '#/data/graph';
import { getInventory } from '#/data/inventory';
import { ATRIUM_VOID, MALL_FOOTPRINT, PARKING_FOOTPRINT } from '#/data/layout';
import { assertCanonicalLevelRegistry } from '#/data/levelSchema';
import { LEVELS, levelAt, levelBand, levelY } from '#/data/levels';
import type { Bounds3, CardinalSide, SpatialRole, SpatialVolume, TrafficClass, Vec3 } from '#/data/spatial';
import {
	CARDINAL_OUTWARD,
	geometryBounds,
	LINE_OF_SIGHT,
	NOT_A_PORTAL_TAG,
	PROJECTILE_PATH,
	PROTRUSION_MARGIN,
	planBounds,
	ROOM_SHELL_TAG,
	SIGHT_BLOCKING_TAG,
	TRAFFIC_CLASSES,
	validateSpatialWorld,
} from '#/data/spatial';
import { STORES, shopStores } from '#/data/stores';
import type { BarrierSpec, DriveableHandling, FacadePanel, MallWorldEntity } from '#/data/world';
import {
	ATRIUM_BALUSTRADE_TOP_Y,
	ATRIUM_OPENING,
	ATRIUM_PLANTER_SPEC,
	atriumPlanterTiers,
	BACKSTAGE_CORRIDOR,
	BACKSTAGE_FLOOR_Y,
	BACKSTAGE_INTERIOR,
	BACKSTAGE_LANDING,
	BARRIER_ENTITIES,
	BARRIER_HARDWARE,
	BARRIER_SPECS,
	barrierAdmits,
	barrierApproachBounds,
	barrierGateCollider,
	connectorClimbModes,
	DRIVEABLE_HANDLING,
	DRIVEABLE_SPOTS,
	ELEVATOR_CLIMB_MODES,
	ELEVATOR_SHAFT_WALLS,
	ELEVATOR_SPEC,
	ENTRANCE_CANOPY_BAY_ZS,
	ENTRANCE_CANOPY_PARTS,
	ENTRANCE_CANOPY_RIB_PITCH,
	ENTRANCE_CANOPY_RIB_ZS,
	ENTRANCE_CANOPY_WASH_Z,
	ENTRANCE_ENTITY,
	ENTRANCE_LABEL,
	ENTRANCE_PORTAL,
	ENTRANCE_RIDEABLE_MOTORCYCLES,
	ENTRANCE_SPEC,
	entitiesOnLevel,
	FACADE_RELIEF_SPEC,
	HELIPAD_DECK_TOP_Y,
	HELIPAD_HATCH,
	HELIPAD_HATCH_GATE,
	HELIPAD_HATCH_SPEC,
	levelsContaining,
	MALL_FACADE_RELIEF,
	MALL_FACADE_SIGNS,
	MALL_SLAB_SPECS,
	MALL_WALL_ENVELOPE,
	MALL_WALL_SPECS,
	MOTORCYCLE_SPEC,
	mechanismAdmits,
	mechanismGateBounds,
	mechanismTriggerBounds,
	PARKED_CAR_SPEC,
	PARKED_CAR_SPOTS,
	PARKED_MOTORCYCLE_SPOTS,
	PARKING_CEILING_SPEC,
	PARKING_DECK_ENTITY,
	PARKING_DECK_SPEC,
	PARKING_EXIT_CHEVRONS,
	PARKING_EXIT_HEADROOM,
	PARKING_EXIT_RAIL,
	PARKING_EXIT_RAIL_HEADS,
	PARKING_EXIT_RAIL_OUTER,
	PARKING_EXIT_RAMP,
	PARKING_EXIT_RAMP_ENTITY,
	PARKING_EXIT_TRENCH,
	PARKING_EXIT_TRENCH_ENTITY,
	PARKING_EXIT_TRENCH_GUARDS,
	PARKING_EXIT_TRENCH_WALLS,
	PARKING_EXIT_WALL_GAP,
	PARKING_WALL_PANELS,
	parkingExitRampY,
	parkingPaintPatches,
	parkingPillarCenters,
	parkingPillarFootprints,
	parkingStalls,
	RENTAL_CAR_SPEC,
	RENTAL_CAR_SPOTS,
	RESTROOMS_MIRRORS,
	RESTROOMS_SPEC,
	RIDEABLE_MOTORCYCLE_SPOTS,
	ROOF_SLIDE_ENTITY,
	SECRET_STAIRS_OPENING_BOUNDS,
	SLIDE_LADDER_CLIMB,
	SLIDE_LADDER_X,
	SLIDE_PLATFORM_TOP_Y,
	SLIDE_TOWER_SPEC,
	THEATRE_AISLES,
	THEATRE_ARTIST_PORTAL,
	THEATRE_BACKSTAGE_DOORS_ENTITY,
	THEATRE_ENTRANCE_ENTITY,
	THEATRE_FLOOR_Y,
	THEATRE_FOYER_ENTITY,
	THEATRE_INTERIOR,
	THEATRE_LABEL,
	THEATRE_PLAN,
	THEATRE_PORTAL,
	THEATRE_SEATING_ENTITY,
	THEATRE_STAGE_FRONT_Z,
	THEATRE_STAGE_TOP_Y,
	TIKI_BAR_SPEC,
	theatreOpeningWithin,
	theatreRowBank,
	theatreRowDeck,
	theatreRowY,
	theatreSeatBanks,
	theatreSeatXs,
	VERTICAL_CONNECTORS,
	WORLD_ENTITIES,
} from '#/data/world';
import type { ZoneId } from '#/data/zones';
import {
	coversColumn,
	deckAt,
	portalOfEntity,
	reachableZones,
	ZONE_ENCLOSURES,
	ZONE_PORTALS,
	ZONES,
	zoneAt,
	zoneBit,
	zoneMaskOfBounds,
	zoneOfLevel,
	zonesOfMask,
	zoneVolume,
} from '#/data/zones';
import { CollisionWorld, RAMP_BAND_MARGIN, WALK_STEP } from '#/physics/Collision';
import type { VehicleGroundState } from '#/physics/VehicleGround';
import { stepVehicleGround } from '#/physics/VehicleGround';
import {
	AIR_STEP,
	CROUCH_LEG_TUCK,
	CROUCH_RATE,
	GRAVITY,
	JUMP_RISE,
	JUMP_V,
	PLAYER_RADIUS,
	STANCE_SETTLE,
	STAND_HEADROOM,
	WALK_SPEED,
} from '#/player/constants';
import { PARK_LAWN } from '#/scene/city/CityPark';
import { CitySky } from '#/scene/city/CitySky';
import { TRAFFIC_FLEET, TRAFFIC_PROFILES } from '#/scene/city/CityTraffic';
import type { GarageDeck } from '#/scene/city/cityPlan';
import {
	CITY_BOUNDS,
	CITY_GROUND_PLAN,
	CITY_GROUND_PLANE_Y,
	CITY_GROUND_Y,
	CITY_KAVELS,
	deckDoorways,
	ENTRANCE_CARPET,
	ENTRANCE_CROSSING,
	EXIT_APRON,
	EXIT_APRON_TOP_Y,
	EXIT_BOOM,
	EXIT_BOOM_TIP_Z,
	EXIT_BRANCH_ROUTE,
	EXIT_LANE_OFFSET,
	GARAGE_DECKS,
	GARAGE_PLAN,
	GARAGE_RAMP_FOOTPRINT,
	GARAGE_RAMP_LANDINGS,
	GARAGE_RAMP_RUNS,
	grownRect,
	LANE_OFFSET,
	LANE_X,
	LANE_Z,
	PLAZA_ENTRANCE_GAP,
	PLAZA_OUTER,
	PLAZA_PLAN,
	PLAZA_TOP_Y,
	PLAZA_TRENCH_GAP,
	plazaStations,
	RING_INNER_WEST_X,
	ROAD_CROSSINGS,
	ROAD_PLAN,
	ROAD_RINGS,
	roadPaintPatches,
	TOWER_SPECS,
	TRAFFIC_CAR,
	TRAFFIC_LANE_CLEARANCE,
	ZEBRA_WIDTH,
	zebraBounds,
} from '#/scene/city/cityPlan';
import { inPool, POOL_CENTER, POOL_FLOOR_Y, POOL_WATER_Y, poolFloorY, rimDistance } from '#/scene/RoofIsland';
import { BIG_MAP_MIN_WIDTH, deckLabelPlan, minimapLabelPlan } from '#/ui/KioskOverlay';
import { distanceToSegment2 } from '#/util/geometry2';
import { clamp, ease, half, lerp, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';
import { profilePoint } from './perf/routes.ts';
import { stubDocument, stubTextMeasure } from './stub-dom.ts';

assertCanonicalLevelRegistry();
assertValidVerticalConnectorRegistry(VERTICAL_CONNECTORS);

/** Speling voor waarden die exact gelijk horen te zijn. */
const EPS = 1e-6;
/** Hoever een vloergat voorbij zijn helling mag steken. */
const GAT_MARGE = 0.8;

/*
 * Elke grondvraag hieronder krijgt WALK_STEP mee: dat is wat Controls aan
 * groundHeightAt geeft zolang je op de grond staat. De standaardwaarde van die
 * parameter is ruimer en keurt een helling goed die je lopend niet op komt.
 */
const wereld = new CollisionWorld();
const V0 = levelY('v0');
const V1 = levelY('v1');
const DAK = levelY('roof');

const fouten: string[] = [];

function fout(controle: string, melding: string): void {
	fouten.push(`${controle}: ${melding}`);
}

function nr(v: number): string {
	return Number(v.toFixed(3)).toString();
}

function bijna(a: number, b: number, eps = EPS): boolean {
	return Math.abs(a - b) <= eps;
}

type Vlak = { minX: number; maxX: number; minZ: number; maxZ: number };

function dekt(v: Vlak, x: number, z: number): boolean {
	return x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ;
}

/** Of twee vlakken elkaar echt overlappen; randen die elkaar net raken tellen niet. */
function vlakkenOverlappen(a: Vlak, b: Vlak): boolean {
	return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}

// ── bron lezen ─────────────────────────────────────────────────────────────
// Sommige feiten staan in module-private constanten van bestanden die zonder
// document niet te importeren zijn. Die worden hier uit de tekst gelezen. Vindt
// een patroon niets, dan is dat een fout en geen stilte: een hernoemde constante
// mag deze controle niet uitzetten.

function bron(pad: string): string {
	return readFileSync(new URL(`../src/${pad}`, import.meta.url), 'utf8');
}

// NaN telt als niet gelezen: een straal of marge van NaN vergelijkt overal
// false en zou de controle die hem gebruikt stilletjes uitzetten.
function getal(tekst: string, patroon: RegExp, wat: string): number {
	const waarde = Number(patroon.exec(tekst)?.[1]);
	if (Number.isNaN(waarde)) throw new Error(`kon ${wat} niet uit de bron lezen — hernoemd of herschreven?`);
	return waarde;
}

function eist(tekst: string, fragment: string, wat: string): void {
	if (!tekst.includes(fragment)) throw new Error(`${wat} staat niet meer in de bron: \`${fragment}\``);
}

/** De body van een klassemethode, van zijn openingsaccolade tot de bijbehorende sluiting. */
function methodeBody(tekst: string, naam: string): string {
	const kop = tekst.indexOf(`private ${naam}(`);
	if (kop < 0) throw new Error(`geen methode ${naam} meer in de bron — hernoemd of herschreven?`);
	const open = tekst.indexOf('{', kop);
	if (open < 0) throw new Error(`methode ${naam} heeft geen body`);
	let diepte = 0;
	for (let i = open; i < tekst.length; i++) {
		const teken = tekst[i];
		if (teken === '{') diepte++;
		else if (teken === '}') {
			diepte--;
			if (diepte === 0) return tekst.slice(open + 1, i);
		}
	}
	throw new Error(`de body van ${naam} loopt niet af`);
}

/**
 * Elke aanroep waarvan `patroon` de naam vangt en op de openingshaak eindigt,
 * met zijn argumenten op het bovenste haakjesniveau en de index van de naam.
 */
function aanroepArgumenten(tekst: string, patroon: RegExp): { naam: string; args: string[]; index: number }[] {
	const uit: { naam: string; args: string[]; index: number }[] = [];
	for (const treffer of tekst.matchAll(patroon)) {
		const naam = treffer[1];
		if (naam === undefined) continue;
		const args: string[] = [];
		let arg = '';
		let diepte = 1;
		for (let i = treffer.index + treffer[0].length; i < tekst.length; i++) {
			const teken = tekst[i];
			if (teken === undefined) break;
			if (teken === '(' || teken === '[') diepte++;
			else if (teken === ')' || teken === ']') {
				diepte--;
				if (diepte === 0) break;
			}
			if (diepte === 1 && teken === ',') {
				args.push(arg.trim());
				arg = '';
				continue;
			}
			arg += teken;
		}
		args.push(arg.trim());
		uit.push({ naam, args, index: treffer.index });
	}
	return uit;
}

// ── 1. voorraad ────────────────────────────────────────────────────────────

function vergelijkWinkels(gebouwd: Set<string>, verwacht: Set<string>, meervoud: string, enkelvoud: string): void {
	for (const id of gebouwd) {
		if (!verwacht.has(id)) fout('voorraad', `${id} is een utility-bestemming maar krijgt ${meervoud}`);
	}
	for (const id of verwacht) {
		if (!gebouwd.has(id)) fout('voorraad', `winkel ${id} krijgt geen ${enkelvoud}`);
	}
}

/**
 * Pods en schappen dekken exact `shopStores()`. Een utility-bestemming is een
 * naam op de plattegrond en verder niets: toen alleen MallBuilder daarop
 * filterde en StockDisplay zelf STORES afliep, stond er een rek van tien meter
 * op het landingsdek van de helipad, en nog negen elders. Beide bouwers worden
 * hier echt gebouwd, want de lijst afvinken zegt niets over wie hem gebruikt.
 */
async function controleVoorraad(): Promise<void> {
	stubDocument();
	const [THREE, { MallBuilder }, { StockDisplay }, { LightPool }] = await Promise.all([
		import('three'),
		import('#/scene/MallBuilder'),
		import('#/scene/StockDisplay'),
		import('#/render/LightPool'),
	]);
	const verwacht = new Set(shopStores().map((s) => s.id));
	const mall = new MallBuilder();
	mall.build();
	vergelijkWinkels(new Set(mall.storeMeshes.keys()), verwacht, 'een winkelpod', 'winkelpod');
	// De schappen huren hun kassalampjes bij de lichtpool; hoeveel dat er zijn is
	// hier niet de vraag, dat controleert check-lights.
	const stock = new StockDisplay(new LightPool(new THREE.Scene()));
	vergelijkWinkels(new Set(stock.registers.keys()), verwacht, 'winkelschappen', 'schappen');
}

async function controleLift(): Promise<void> {
	stubDocument();
	const [THREE, { GlassElevator }, { LightPool }] = await Promise.all([
		import('three'),
		import('#/scene/GlassElevator'),
		import('#/render/LightPool'),
	]);
	const lift = new GlassElevator(new LightPool(new THREE.Scene()));
	const collision = new CollisionWorld();
	for (const collider of lift.getColliders()) {
		collision.addBox(collider.minX, collider.maxX, collider.minZ, collider.maxZ, {
			minY: collider.minY,
			maxY: collider.maxY,
			label: collider.label,
			climbable: collider.climbable,
		});
	}
	const y = levelY('v0') + 1;
	for (const wall of ELEVATOR_SHAFT_WALLS) {
		const solved = collision.resolveCircle(wall.center.x, wall.center.z, y, PLAYER_RADIUS, 3, true);
		if (Math.hypot(solved.x - wall.center.x, solved.z - wall.center.z) <= EPS) {
			fout('lift', `speler gaat door de ${wall.id} glazen schachtwand`);
		}
	}
	const cabinCenter = collision.resolveCircle(ELEVATOR_SPEC.center.x, ELEVATOR_SPEC.center.z, y, PLAYER_RADIUS, 3, true);
	if (Math.hypot(cabinCenter.x - ELEVATOR_SPEC.center.x, cabinCenter.z - ELEVATOR_SPEC.center.z) > EPS) {
		fout('lift', 'de speler wordt door de sim-poort uit het midden van de cabine geduwd');
	}
	const simAtDoor = collision.resolveCircle(
		ELEVATOR_SPEC.center.x,
		ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth) - 0.1,
		y,
		PLAYER_RADIUS,
		3,
		false,
	);
	if (
		Math.hypot(
			simAtDoor.x - ELEVATOR_SPEC.center.x,
			simAtDoor.z - (ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth) - 0.1),
		) <= EPS
	) {
		fout('lift', 'een sim loopt via de open zuidzijde de liftschacht in');
	}
	const openExit = lift.resolvePassenger(
		ELEVATOR_SPEC.center.x,
		ELEVATOR_SPEC.center.z + ELEVATOR_SPEC.cabin.depth,
		PLAYER_RADIUS,
	);
	if (!bijna(openExit.z, ELEVATOR_SPEC.center.z + ELEVATOR_SPEC.cabin.depth)) {
		fout('lift', 'de open liftdeur houdt een uitstappende speler binnen');
	}
	lift.update(3);
	if (!lift.isMoving) fout('lift', 'test kon de lege lift niet in beweging zetten');
	const closed = lift.resolvePassenger(ELEVATOR_SPEC.center.x + 10, ELEVATOR_SPEC.center.z + 10, PLAYER_RADIUS);
	if (
		closed.x >= ELEVATOR_SPEC.center.x + half(ELEVATOR_SPEC.cabin.width) ||
		closed.z >= ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth)
	) {
		fout('lift', 'de gesloten bewegende cabine houdt de speler niet achter glas en deuren');
	}
}

// ── 2. hellingen ───────────────────────────────────────────────────────────

/**
 * Elke helling: het vloergat ligt boven de vlucht en de uiteinden staan op een
 * hoogte die echt bestaat — een dek uit levels.ts of een platformdek. De ladder
 * had 13.95 als los getal naast levelY('roof') staan.
 */
function controleHellingen(): void {
	const hoogtes = [...LEVELS.map((l) => l.y), ...wereld.platforms.map((p) => p.y)];
	for (const r of wereld.ramps) {
		const zLo = Math.min(r.zBottom, r.zTop);
		const zHi = Math.max(r.zBottom, r.zTop);
		if (r.minX >= r.maxX) fout('hellingen', `${r.label}: minX ${nr(r.minX)} ligt niet links van maxX ${nr(r.maxX)}`);
		if (bijna(r.zBottom, r.zTop)) fout('hellingen', `${r.label}: vlucht heeft geen lengte in z`);
		if (r.yTop <= r.yBottom) fout('hellingen', `${r.label}: yTop ${nr(r.yTop)} ligt niet boven yBottom ${nr(r.yBottom)}`);
		if (r.openMinZ >= r.openMaxZ)
			fout('hellingen', `${r.label}: openMinZ ${nr(r.openMinZ)} ligt niet vóór openMaxZ ${nr(r.openMaxZ)}`);
		if (r.openMinZ < zLo - GAT_MARGE || r.openMaxZ > zHi + GAT_MARGE) {
			fout(
				'hellingen',
				`${r.label}: gat ${nr(r.openMinZ)}..${nr(r.openMaxZ)} steekt verder dan ${nr(GAT_MARGE)} m buiten de vlucht ${nr(zLo)}..${nr(zHi)}`,
			);
		}
		if (r.openMaxZ <= zLo || r.openMinZ >= zHi) {
			fout('hellingen', `${r.label}: gat ${nr(r.openMinZ)}..${nr(r.openMaxZ)} ligt naast de vlucht ${nr(zLo)}..${nr(zHi)}`);
		}
		for (const [naam, y] of [
			['yBottom', r.yBottom],
			['yTop', r.yTop],
		] as const) {
			if (!hoogtes.some((h) => bijna(h, y))) {
				fout('hellingen', `${r.label}: ${naam} ${nr(y)} is geen dek- of platformhoogte (${hoogtes.map(nr).join(', ')})`);
			}
		}
	}
}

// ── 3. vloergat ────────────────────────────────────────────────────────────

/**
 * De vloerplaat, renderer en helling lezen hetzelfde slabmanifest. Controleer
 * de data zelf; een controle op letterlijke broncode zou een geldige refactor
 * afkeuren zonder iets over het uiteindelijke vloergat te bewijzen.
 */
function controleVloergat(): void {
	const atriumAanwezig = MALL_SLAB_SPECS.v1.holes.some(
		(plan) =>
			plan.kind === 'rectangle' &&
			bijna(plan.center.x, ATRIUM_OPENING.center.x) &&
			bijna(plan.center.z, ATRIUM_OPENING.center.z) &&
			bijna(plan.width, ATRIUM_OPENING.size.width) &&
			bijna(plan.depth, ATRIUM_OPENING.size.depth),
	);
	if (!atriumAanwezig) fout('vloergat', `${ATRIUM_OPENING.id} ontbreekt in het gedeelde V1-slabmanifest`);

	for (const connector of VERTICAL_CONNECTORS) {
		const opening = connector.opening;
		const aanwezig = MALL_SLAB_SPECS[connector.to].holes.some(
			(plan) =>
				plan.kind === 'rectangle' &&
				bijna(plan.center.x, opening.center.x) &&
				bijna(plan.center.z, opening.center.z) &&
				bijna(plan.width, opening.size.width) &&
				bijna(plan.depth, opening.size.depth),
		);
		if (!aanwezig) fout('vloergat', `${opening.id} ontbreekt in het gedeelde ${connector.to}-slabmanifest`);

		const ramp = wereld.ramps.find((candidate) => candidate.label === connector.id);
		if (!ramp) {
			fout('vloergat', `geen ramp '${connector.id}' in CollisionWorld, terwijl het wereldmanifest er een definieert`);
			continue;
		}
		const midX = midpoint(ramp.minX, ramp.maxX);
		const rampExtentX = half(span(ramp.minX, ramp.maxX));
		if (!bijna(connector.x, midX, 1e-3)) {
			fout('vloergat', `${connector.id}.x ${nr(connector.x)} ligt niet op het midden van zijn ramp (${nr(midX)})`);
		}
		for (const [naam, waarde] of [
			['zBottom', ramp.zBottom],
			['zTop', ramp.zTop],
		] as const) {
			const manifest = connector[naam];
			if (!bijna(manifest, waarde, 1e-3)) {
				fout('vloergat', `${connector.id}.${naam} ${nr(manifest)} wijkt af van de ramp (${nr(waarde)})`);
			}
		}
		const cz = connector.opening.center.z;
		const openingExtentZ = half(connector.opening.size.depth);
		const openingExtentX = half(connector.opening.size.width);
		if (!bijna(cz - openingExtentZ, ramp.openMinZ, 1e-3) || !bijna(cz + openingExtentZ, ramp.openMaxZ, 1e-3)) {
			fout(
				'vloergat',
				`${connector.id} snijdt z ${nr(cz - openingExtentZ)}..${nr(cz + openingExtentZ)} maar de ramp rekent met ${nr(ramp.openMinZ)}..${nr(ramp.openMaxZ)}`,
			);
		}
		if (openingExtentX + 1e-3 < rampExtentX) {
			fout(
				'vloergat',
				`${connector.id} opening width ${nr(connector.opening.size.width)} is smaller than the ramp width (${nr(span(ramp.minX, ramp.maxX))}): het vakwerk prikt door de plaat`,
			);
		}
		const snelheid = 'carrySpeed' in connector.collision ? connector.collision.carrySpeed : undefined;
		if (snelheid !== undefined) {
			if (ramp.carrySpeed === undefined) {
				fout(
					'vloergat',
					`${connector.id}.speed is ${nr(snelheid)} maar de ramp heeft geen carrySpeed: de treden lopen, jij niet`,
				);
			} else if (!bijna(snelheid, ramp.carrySpeed)) {
				fout('vloergat', `${connector.id}.speed ${nr(snelheid)} wijkt af van carrySpeed van de ramp (${nr(ramp.carrySpeed)})`);
			}
		}
	}

	// Het atriumgat: het slabmanifest snijdt het, Collision laat je er doorheen vallen.
	const binnen: [number, number][] = [
		[half(ATRIUM_VOID.width) - 0.1, 0],
		[-(half(ATRIUM_VOID.width) - 0.1), 0],
		[0, half(ATRIUM_VOID.depth) - 0.1],
		[0, -(half(ATRIUM_VOID.depth) - 0.1)],
	];
	for (const [x, z] of binnen) {
		const grond = wereld.groundHeightAt(x, z, V1, WALK_STEP);
		if (!bijna(grond, V0))
			fout('vloergat', `atriumgat (${nr(x)}, ${nr(z)}): op V1 ligt er vloer op ${nr(grond)} terwijl daar een gat gesneden is`);
	}
	const buiten: [number, number][] = [
		[half(ATRIUM_VOID.width) + 0.5, 0],
		[-(half(ATRIUM_VOID.width) + 0.5), 0],
		[0, half(ATRIUM_VOID.depth) + 0.5],
		[0, -(half(ATRIUM_VOID.depth) + 0.5)],
	];
	for (const [x, z] of buiten) {
		const grond = wereld.groundHeightAt(x, z, V1, WALK_STEP);
		if (!bijna(grond, V1)) fout('vloergat', `atriumrand (${nr(x)}, ${nr(z)}): geen plaat op V1 maar ${nr(grond)}`);
	}
}

// ── 4. de lijn van de helling ──────────────────────────────────────────────

/**
 * Sta je op een helling, dan geeft groundHeightAt de lijn terug en niet de
 * plaat. Precies op de treden dus, over de hele lengte: de roltraptreden worden
 * op dezelfde lijn getekend, dus een afwijking hier is een trede naast je voet.
 */
/** Op deze hoogtes onder de voet van een vlucht staat een sim er zeker niet meer op. */
const ONDER_DE_VOET: readonly number[] = [RAMP_BAND_MARGIN * 2, 1, 2];

function controleHellinglijn(): void {
	const N = 400;
	for (const r of wereld.ramps) {
		// Ook langs de randen van de loopband, niet alleen over het hart: een
		// helling die maar op zijn middellijn draagt is een helling met een gleuf.
		const banen = [r.minX + 0.1, midpoint(r.minX, r.maxX), r.maxX - 0.1];
		let padVanaf = Number.POSITIVE_INFINITY;
		let padTot = Number.NEGATIVE_INFINITY;
		let padY = 0;
		let gemeld = false;
		for (const x of banen) {
			for (let i = 0; i <= N; i++) {
				const t = i / N;
				const z = r.zBottom + (r.zTop - r.zBottom) * t;
				const lijn = r.yBottom + (r.yTop - r.yBottom) * t;
				const grond = wereld.groundHeightAt(x, z, lijn, WALK_STEP);
				if (bijna(grond, lijn, 1e-4)) continue;
				// Bovenaan een klim mag een platform het overnemen: daar stap je erop.
				const plat = wereld.platforms.find((p) => wereld.platformCovers(p, x, z) && bijna(p.y, grond, 1e-4));
				if (plat && lijn >= plat.y - 0.35) continue;
				const pad = wereld.roofPads.find((p) => dekt(p, x, z) && bijna(p.y, grond, 1e-4));
				if (pad) {
					padVanaf = Math.min(padVanaf, z);
					padTot = Math.max(padTot, z);
					padY = pad.y;
					continue;
				}
				if (!gemeld) {
					fout(
						'hellinglijn',
						`${r.label}: op (${nr(x)}, ${nr(z)}) geeft de wereld ${nr(grond)} terwijl de helling daar op ${nr(lijn)} ligt`,
					);
					gemeld = true;
				}
				break;
			}
		}
		// Fout en geen waarschuwing: een dakplaat over een vlucht legt het trapgat
		// dicht en je loopt er dan overheen. De pads die dat mogen doen zijn al om
		// hun gat heen geknipt, dus een nieuwe overlap is nooit de bedoeling.
		if (padVanaf <= padTot) {
			fout(
				'hellinglijn',
				`${r.label}: een dakplaat (y ${nr(padY)}) ligt over z ${nr(padVanaf)}..${nr(padTot)} van de vlucht, daar loop je over het trapgat heen in plaats van erop`,
			);
		}

		// Waar de speler `groundHeightAt` vraagt, vraagt een sim `snapFloorY`, en die
		// twee horen over dezelfde vlucht hetzelfde te zeggen. Welke vlucht een sim
		// draagt volgde eerder uit twee vaste verdiepingsbanden met de naam van de
		// geheime trap erin, en die naam matchte niets: onder die trap bleef een sim
		// op V0 in de lucht staan en middenop sprong hij naar de dakplaat.
		const hart = midpoint(r.minX, r.maxX);
		// De band is open aan beide kanten: op de grens zelf draagt de plaat je nog.
		const laagsteY = Math.min(r.yBottom, r.yTop) + RAMP_BAND_MARGIN;
		const hoogsteY = Math.max(r.yBottom, r.yTop) - RAMP_BAND_MARGIN;
		for (let i = 1; i < N; i++) {
			const y = lerp(laagsteY, hoogsteY, i / N);
			const z = lerp(r.zBottom, r.zTop, (y - r.yBottom) / (r.yTop - r.yBottom));
			const gezakt = wereld.snapFloorY(hart, z, y);
			if (bijna(gezakt, y, 1e-6)) continue;
			fout(
				'hellinglijn',
				`${r.label}: halverwege op (${nr(hart)}, ${nr(z)}) zet snapFloorY een sim op ${nr(gezakt)} in plaats van op de vlucht (${nr(y)})`,
			);
			break;
		}

		// En onder de voet van die vlucht draagt hij niets: daar ligt de plaat.
		const voetY = Math.min(r.yBottom, r.yTop);
		const voetZ = r.yBottom < r.yTop ? r.zBottom : r.zTop;
		for (const onder of ONDER_DE_VOET) {
			const y = voetY - onder;
			const gezakt = wereld.snapFloorY(hart, voetZ, y);
			if (!bijna(gezakt, y, 1e-6)) continue;
			fout('hellinglijn', `${r.label}: ${nr(onder)} m onder zijn voet houdt snapFloorY een sim op y ${nr(y)} in de lucht`);
			break;
		}
	}
}

// ── 5. parkeeruitrit ───────────────────────────────────────────────────────

/**
 * De uitrit ligt diagonaal in X/Y en viel daarom buiten de oude Z-only
 * hellingcontrole. Loop hem in kleine spelerstappen op en terug af, en vraag
 * collision op de westmuur expliciet of die de doorgang weer dichtduwt.
 */
function controleParkeeruitrit(): void {
	const ramp = PARKING_EXIT_RAMP;
	const stappen = 320;
	for (const richting of [1, -1]) {
		let currentY = richting === 1 ? ramp.start.y : ramp.end.y;
		for (let i = 0; i <= stappen; i++) {
			const t = richting === 1 ? i / stappen : 1 - i / stappen;
			const x = ramp.start.x + (ramp.end.x - ramp.start.x) * t;
			const z = ramp.start.z + (ramp.end.z - ramp.start.z) * t;
			const expected = ramp.start.y + (ramp.end.y - ramp.start.y) * t;
			const ground = wereld.groundHeightAt(x, z, currentY, WALK_STEP);
			if (!bijna(ground, expected, 1e-4)) {
				fout(
					'parkeeruitrit',
					`${richting === 1 ? 'omhoog' : 'omlaag'} op (${nr(x)}, ${nr(z)}): collision geeft ${nr(ground)} in plaats van ${nr(expected)}`,
				);
				break;
			}
			const resolved = wereld.resolveCircle(x, z, ground, 0.32, 3, true, false);
			if (Math.hypot(resolved.x - x, resolved.z - z) > 1e-4) {
				fout(
					'parkeeruitrit',
					`doorgang blokkeert op (${nr(x)}, ${nr(z)}): collision duwt naar (${nr(resolved.x)}, ${nr(resolved.z)})`,
				);
				break;
			}
			currentY = ground;
		}
	}
	controleUitritleuning();
}

/**
 * De leuning langs de uitrit staat onder een hoek, en een gedraaide doos beslaat
 * horizontaal zijn lengte maal de cosinus plus een halve hoogte maal de sinus. Bij de
 * mond komt hij boven maaiveld uit, dus alles wat daar voorbij de helling reikt staat
 * als een mes op het plein. En het kopvlak dat daar overblijft hoort afgedekt te zijn.
 *
 * Alleen de mondzijde wordt begrensd. Aan de dekzijde loopt de leuning met opzet een
 * eindje het parkeerdek op: daar komt de helling op de vloer uit, en een leuning die
 * precies op die naad stopt laat er een gat.
 */
const UITRIT_MARGE = 1e-4;

function controleUitritleuning(): void {
	const rail = PARKING_EXIT_RAIL;
	const halfSpanX = half(rail.length) * Math.abs(Math.cos(rail.angle)) + half(rail.height) * Math.abs(Math.sin(rail.angle));
	const minX = rail.centerX - halfSpanX;
	const mond = PARKING_EXIT_RAMP.end.x;
	const dek = PARKING_EXIT_RAMP.start.x;
	if (minX < mond - UITRIT_MARGE) {
		fout(
			'parkeeruitrit',
			`de leuning begint op ${nr(minX)} en komt daarmee ${nr(span(minX, mond))} m voorbij de mond (${nr(mond)}) het plein op`,
		);
	}
	for (const kant of [-1, 1] as const) {
		const midZ = kant * rail.offsetZ;
		const kop = PARKING_EXIT_RAIL_HEADS.find(
			(head) => midZ >= head.minZ - UITRIT_MARGE && midZ <= head.maxZ + UITRIT_MARGE && head.minX <= mond + UITRIT_MARGE,
		);
		if (!kop) {
			fout('parkeeruitrit', `de leuning op z ${nr(midZ)} eindigt bij de mond zonder kop; dat kopvlak staat open op het plein`);
			continue;
		}
		if (kop.minX < mond - UITRIT_MARGE || kop.maxX > dek + UITRIT_MARGE) {
			fout('parkeeruitrit', `de kop op z ${nr(midZ)} loopt van ${nr(kop.minX)} tot ${nr(kop.maxX)} en steekt voorbij de mond`);
		}
		if (kop.maxY < PARKING_EXIT_RAMP.end.y + rail.height - UITRIT_MARGE) {
			fout(
				'parkeeruitrit',
				`de kop op z ${nr(midZ)} reikt tot ${nr(kop.maxY)} en dekt de leuning tot ${nr(PARKING_EXIT_RAMP.end.y + rail.height)} niet af`,
			);
		}
	}
}

/**
 * Bij de noordrand van de open uitritgeul staat een zichtbaar hek dat ook een
 * springende speler tegenhoudt. Op de gemelde pose hield eerst alleen een vrijwel
 * maaiveldhoge keermuur de wandelaar tegen; tijdens een sprong verdween die collision
 * en viel je zonder zichtbare waarschuwing de geul in.
 */
function controleUitrithek(): void {
	const pose = { x: -37.2, z: -3.6, richting: 181 } as const;
	const guard = PARKING_EXIT_TRENCH_GUARDS.find(
		(candidate) => candidate.centerZ < 0 && pose.x >= candidate.minX && pose.x <= candidate.maxX,
	);
	if (!guard) {
		fout('uitrithek', `op de gemelde pose (${nr(pose.x)}, ${nr(pose.z)}) staat geen noordelijk hek langs de geul`);
		return;
	}
	if (guard.maxY < V0 + JUMP_RISE) {
		fout(
			'uitrithek',
			`het hek reikt tot ${nr(guard.maxY)} en een gewone sprong tot ${nr(V0 + JUMP_RISE)}; je springt eroverheen`,
		);
	}
	const yaw = (pose.richting * Math.PI) / 180;
	for (const feetY of [V0, V0 + JUMP_RISE]) {
		let x: number = pose.x;
		let z: number = pose.z;
		for (let i = 0; i < 20; i++) {
			const solved = wereld.resolveCircle(
				x - Math.sin(yaw) * POLYLIJN_STAP,
				z - Math.cos(yaw) * POLYLIJN_STAP,
				feetY,
				PLAYER_RADIUS,
				3,
				true,
				feetY > V0,
				true,
			);
			x = solved.x;
			z = solved.z;
		}
		if (z > guard.centerZ) {
			fout('uitrithek', `${feetY > V0 ? 'springend' : 'lopend'} steek je op (${nr(x)}, ${nr(z)}) door het noordelijke hek`);
		}
	}
	eist(bron('scene/ParkingGarage.ts'), 'PARKING_EXIT_TRENCH_GUARDS', 'de zichtbare hekken boven de open uitritgeul');
	eist(bron('scene/ParkingGarage.ts'), "'← PARKING'", 'de PARKING-zijde van het CITY RING-bord');
}

// ── 5a. de schil om P1 en de geul waar de uitrit in ligt ───────────────────

/**
 * Vanuit P1 keek je de wereld uit, op twee plekken tegelijk.
 *
 * De wanden stopten 5 cm onder het plafond, en die naad liep rondom: je zag de
 * stad op straatniveau en de beige onderkant van de begane-grondplaat waar die
 * over de parkeerdoos heen steekt. De oostwand had bovendien twee panelen met
 * zeven meter niets ertussen. En buiten de gevel staat er onder maaiveld geen
 * enkele wand, dus door de mond van de geul zweefden auto's en torens op de
 * achtergrondkleur: het grondvlak van de stad is één plaat die je van onderaf
 * niet ziet.
 *
 * Deze controle prikt de schil af op hoogte, langs alle vier de gevels en langs
 * de hele geul, en houdt precies één opening over: de uitritmond, met een latei
 * erboven die de doorrijhoogte respecteert.
 */
const SCHIL_STAP = 0.25;
/** Speling onder het plafond en boven het dek waarop de schil nog massief hoort te zijn. */
const SCHIL_MARGE = 0.05;

function inMassief(entiteiten: readonly MallWorldEntity[], x: number, y: number, z: number): boolean {
	return entiteiten.some((entity) =>
		entity.volumes.some((volume) => {
			if (!volume.blocksMovement) return false;
			const b = geometryBounds(volume.geometry);
			return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
		}),
	);
}

function controleParkeerschil(): void {
	const schil = [PARKING_DECK_ENTITY, PARKING_EXIT_TRENCH_ENTITY];
	const dekY = levelY('p1');
	const plafondOnder = dekY + PARKING_DECK_SPEC.ceiling.height - half(PARKING_DECK_SPEC.ceiling.thickness);
	const wandTop = dekY + PARKING_DECK_SPEC.clearHeight;
	if (!bijna(wandTop, plafondOnder)) {
		fout(
			'parkeerschil',
			`de wanden stoppen op ${nr(wandTop)} terwijl het plafond op ${nr(plafondOnder)} begint — die naad is een kier rondom`,
		);
	}

	const latei = PARKING_WALL_PANELS.find((panel) => panel.id === 'west-head');
	if (!latei) {
		fout('parkeerschil', 'de westwand heeft geen latei boven de uitritmond meer, dus de mond loopt door tot het plafond');
		return;
	}
	const gevraagd = parkingExitRampY(PARKING_EXIT_TRENCH.maxX) + PARKING_EXIT_HEADROOM;
	if (latei.base < gevraagd - EPS) {
		fout('parkeerschil', `de latei begint op ${nr(latei.base)} en laat ${nr(gevraagd - latei.base)} m te weinig doorrijhoogte`);
	}
	if (!bijna(span(-PARKING_EXIT_WALL_GAP, PARKING_EXIT_WALL_GAP), latei.size.depth)) {
		fout(
			'parkeerschil',
			`de latei is ${nr(latei.size.depth)} m breed en dekt de mond van ${nr(PARKING_EXIT_WALL_GAP * 2)} m niet`,
		);
	}

	const wandX = half(PARKING_FOOTPRINT.width) - PARKING_DECK_SPEC.wall.inset;
	const wandZ = half(PARKING_FOOTPRINT.depth) - PARKING_DECK_SPEC.wall.inset;
	const hoogtes = [dekY + SCHIL_MARGE, midpoint(dekY, plafondOnder), plafondOnder - SCHIL_MARGE];
	const zijden = [
		{ naam: 'noord', langsX: true, vast: -wandZ, van: -half(PARKING_FOOTPRINT.width), tot: half(PARKING_FOOTPRINT.width) },
		{ naam: 'zuid', langsX: true, vast: wandZ, van: -half(PARKING_FOOTPRINT.width), tot: half(PARKING_FOOTPRINT.width) },
		{ naam: 'oost', langsX: false, vast: wandX, van: -half(PARKING_FOOTPRINT.depth), tot: half(PARKING_FOOTPRINT.depth) },
		{ naam: 'west', langsX: false, vast: -wandX, van: -half(PARKING_FOOTPRINT.depth), tot: half(PARKING_FOOTPRINT.depth) },
	];
	// Eén melding per gevel: een weggevallen paneel is één fout, geen honderd.
	for (const zijde of zijden) {
		let gemeld = false;
		for (let s = zijde.van; s <= zijde.tot && !gemeld; s += SCHIL_STAP) {
			const x = zijde.langsX ? s : zijde.vast;
			const z = zijde.langsX ? zijde.vast : s;
			for (const y of hoogtes) {
				const mond = zijde.naam === 'west' && Math.abs(z) <= PARKING_EXIT_WALL_GAP && y < latei.base;
				if (mond || inMassief(schil, x, y, z)) continue;
				fout('parkeerschil', `de ${zijde.naam}gevel van P1 heeft een gat op (${nr(x)}, ${nr(z)}) op hoogte ${nr(y)}`);
				gemeld = true;
				break;
			}
		}
	}

	// De geul, over zijn hele lengte: aan weerszijden van de rijbaan moet er van de
	// parkeervloer tot boven staan wat er boven is — de stoep buiten de gevel, de
	// onderkant van de begane-grondplaat eronderdoor.
	const bandZ = midpoint(PARKING_EXIT_RAIL_OUTER, PARKING_EXIT_WALL_GAP);
	let geulGemeld = false;
	for (let x = PARKING_EXIT_TRENCH.minX; x <= PARKING_EXIT_TRENCH.maxX && !geulGemeld; x += SCHIL_STAP) {
		const top = x < PARKING_EXIT_TRENCH.coverX ? PARKING_EXIT_TRENCH.skyTopY : PARKING_EXIT_TRENCH.coveredTopY;
		for (const z of [-bandZ, bandZ]) {
			for (const y of [PARKING_EXIT_TRENCH.baseY + SCHIL_MARGE, parkingExitRampY(x), top - SCHIL_MARGE]) {
				if (inMassief(schil, x, y, z)) continue;
				fout('parkeerschil', `de geul is open op (${nr(x)}, ${nr(z)}) op hoogte ${nr(y)} — daar kijk je onder de wereld door`);
				geulGemeld = true;
				break;
			}
		}
	}

	// En de spouw erboven. Het parkeerdak ligt bijna een meter onder de
	// begane-grondplaat, dus tussen die twee loopt een holle laag over de hele
	// voetafdruk. Zonder een kop over het overdekte deel van de geul kijk je daar
	// vanaf de helling de mall in, tweeënzeventig meter onder de vloer door.
	const spouwZ = [-PARKING_EXIT_RAIL_OUTER + SCHIL_MARGE, 0, PARKING_EXIT_RAIL_OUTER - SCHIL_MARGE];
	const spouwHoogtes = [
		PARKING_CEILING_SPEC.topY + SCHIL_MARGE,
		midpoint(PARKING_CEILING_SPEC.topY, PARKING_EXIT_TRENCH.coveredTopY),
		PARKING_EXIT_TRENCH.coveredTopY - SCHIL_MARGE,
	];
	let spouwGemeld = false;
	for (let x = PARKING_EXIT_TRENCH.coverX; x <= PARKING_EXIT_TRENCH.maxX && !spouwGemeld; x += SCHIL_STAP) {
		for (const z of spouwZ) {
			for (const y of spouwHoogtes) {
				if (inMassief(schil, x, y, z)) continue;
				fout(
					'parkeerschil',
					`de spouw boven de geul is open op (${nr(x)}, ${nr(z)}) op hoogte ${nr(y)} — daar kijk je onder de begane grond de mall in`,
				);
				spouwGemeld = true;
				break;
			}
			if (spouwGemeld) break;
		}
	}

	// En je loopt er niet naast: op de rand van de rijbaan duwt de keermuur terug.
	for (const z of [-PARKING_EXIT_RAIL_OUTER, PARKING_EXIT_RAIL_OUTER]) {
		const x = midpoint(PARKING_EXIT_TRENCH.minX, PARKING_EXIT_TRENCH.coverX);
		const los = wereld.resolveCircle(x, z, parkingExitRampY(x), PLAYER_RADIUS, 3, true, false, true);
		if (Math.abs(los.z) >= Math.abs(z)) {
			fout(
				'parkeerschil',
				`op de rand van de uitrit (${nr(x)}, ${nr(z)}) houdt niets je tegen; naast de helling af is zes meter vallen`,
			);
		}
	}
}

// ── 5b. de hoofdingang ─────────────────────────────────────────────────────

/** Waar de voetganger vandaan komt: ruim buiten de gevel, op de stoep. */
const INGANG_STRAAT_X = -50;
/** Eén stap van de wandelprobe, ongeveer een frame lopen. */
const INGANG_STAP = 0.05;
/**
 * Hoeveel van die stap er minimaal overblijft na collision. Zakt het daaronder,
 * dan staat er iets in de doorgang: precies wat een dichtgeslibde ingang doet.
 */
const INGANG_VOORTGANG = 0.5;
/** Hoever de probe opzij geduwd mag worden voordat hij niet meer rechtdoor loopt. */
const INGANG_ZIJWAARTS = 0.05;

type Wandeling = { x: number; klacht: string | null };

/**
 * Wie er loopt: in welke wereld, en in welke houding.
 *
 * De houding hoort erbij omdat een lopende voetganger twee dingen tegen kan komen.
 * Zijn lichaam botst tegen de dozen, en zijn hoofd komt een balk tegen die zijn
 * voeten nergens raakt. Gehurkt geldt dezelfde route met een lagere eis.
 */
type Wandelaar = Readonly<{ wereld: CollisionWorld; houding: PedestrianPosture }>;

const RECHTOP: Wandelaar = { wereld, houding: 'standing' };

/**
 * Eén voetganger die op z-lijn `z` van `van` naar `naar` loopt, stap voor stap.
 *
 * Dezelfde vorm als de parkeeruitrit-probe hierboven: `groundHeightAt` voor de
 * vloer onder je voeten, `headroomAt` voor wat er boven je hoofd hangt en
 * `resolveCircle` voor wat je tegenhoudt, met de buitenvlag aan, want die heeft de
 * speler op straatniveau ook. Hij geeft terug hoever hij kwam; of dat ver genoeg of
 * juist te ver is, weet de aanroeper.
 */
function loopLangsDeAs(z: number, van: number, naar: number, wie: Wandelaar = RECHTOP): Wandeling {
	const richting = Math.sign(naar - van);
	const nodig = postureHeadroom(wie.houding);
	let x = van;
	let y = V0;
	// Eén stap ruimte extra: de laatste voert over het doel heen, niet ernaartoe.
	const stappen = Math.ceil(span(0, Math.abs(naar - van)) / INGANG_STAP) + 1;
	for (let i = 0; i < stappen && (naar - x) * richting > 0; i++) {
		const wens = x + richting * INGANG_STAP;
		const grond = wie.wereld.groundHeightAt(wens, z, y, WALK_STEP);
		if (!bijna(grond, V0, 1e-6)) {
			return { x, klacht: `op x ${nr(wens)} (z ${nr(z)}) ligt de vloer op ${nr(grond)} in plaats van op dekhoogte ${nr(V0)}` };
		}
		const los = wie.wereld.resolveCircle(wens, z, grond, PLAYER_RADIUS, 3, true, false, true);
		if ((los.x - x) * richting < INGANG_STAP * INGANG_VOORTGANG) return { x, klacht: null };
		if (wie.wereld.headroomAt(los.x, z, grond) < nodig) return { x, klacht: null };
		if (Math.abs(los.z - z) > INGANG_ZIJWAARTS) {
			return { x: los.x, klacht: `op x ${nr(wens)} wordt de voetganger opzij geduwd naar z ${nr(los.z)}` };
		}
		x = los.x;
		y = grond;
	}
	return { x, klacht: null };
}

/**
 * De hoofdingang, gelopen zoals de speler hem loopt.
 *
 * De ingang bestaat uit maten die op drie plekken tegelijk moeten kloppen: het gat
 * in de wandspec, de dozen in Collision en de volumes in het wereldmodel. Dit is de
 * enige controle die vraagt of je er ook echt doorheen komt. De helft eronder vraagt
 * het omgekeerde: door het glas ernaast komt niemand, en zonder die helft zou een
 * westgevel die overal openstaat deze controle net zo goed halen.
 */
function controleIngang(): void {
	const doel = half(ATRIUM_VOID.width);
	const binnen = loopLangsDeAs(ENTRANCE_PORTAL.centerZ, INGANG_STRAAT_X, doel);
	if (binnen.klacht !== null) {
		fout('ingang', binnen.klacht);
		return;
	}
	if (binnen.x < doel) {
		fout(
			'ingang',
			`de wandeling over de deuras (z ${nr(ENTRANCE_PORTAL.centerZ)}) strandt op x ${nr(binnen.x)} en haalt het atrium (x ${nr(doel)}) niet`,
		);
		return;
	}
	if (!wereld.insideMallPlan(binnen.x, ENTRANCE_PORTAL.centerZ)) {
		fout('ingang', `de wandeling eindigt op (${nr(binnen.x)}, ${nr(ENTRANCE_PORTAL.centerZ)}), buiten de voetafdruk`);
	}

	// De twee zijlichten zijn glas voor het oog en wand voor het lichaam. Van
	// buitenaf staat de luifelkolom ervoor, dus dit loopt van binnen naar buiten:
	// door de pui naast de deuren hoort niemand de straat op te wandelen.
	for (const [wat, zGlas] of [
		['het noordelijke zijlicht', ENTRANCE_PORTAL.minZ + half(ENTRANCE_SPEC.sidelightWidth)],
		['het zuidelijke zijlicht', ENTRANCE_PORTAL.maxZ - half(ENTRANCE_SPEC.sidelightWidth)],
	] as const) {
		const naarBuiten = loopLangsDeAs(zGlas, ENTRANCE_PORTAL.innerX + ENTRANCE_SPEC.hall.depth, INGANG_STRAAT_X);
		if (naarBuiten.klacht !== null) {
			fout('ingang', naarBuiten.klacht);
			continue;
		}
		if (naarBuiten.x < ENTRANCE_PORTAL.outerX) {
			fout('ingang', `door ${wat} (z ${nr(zGlas)}) loopt de voetganger tot x ${nr(naarBuiten.x)} de straat op`);
		}
	}

	// En de gevel zuid van het portaal, waar de toiletten achter staan: daar is
	// helemaal geen opening. (Noord ervan ligt de geul van de parkeeruitrit, die
	// zijn eigen controle heeft.)
	const zuid = ENTRANCE_PORTAL.maxZ + 0.6;
	const langsDeGevel = loopLangsDeAs(zuid, INGANG_STRAAT_X, doel);
	if (langsDeGevel.klacht !== null) fout('ingang', langsDeGevel.klacht);
	else if (langsDeGevel.x > ENTRANCE_PORTAL.outerX) {
		fout('ingang', `zuid van het portaal (z ${nr(zuid)}) loopt de voetganger tot x ${nr(langsDeGevel.x)} de mall in`);
	}

	controleIngangZicht();
	controleParkZicht();
	controleIngangLoper();
	controleLuifel();
}

/**
 * De loper en de oversteek liggen op één as.
 *
 * De loper liep vanaf de dorpel recht naar de stoeprand en dan met een knik naar een
 * zebrapad vijf meter zuidelijker. Die knik was het enige bewijs dat de entree en de
 * oversteek elkaars maat niet kenden: allebei schreven ze hun eigen z op. Nu leest de
 * oversteek de as van het portaal en de loper ook, en dit is wat dat vasthoudt.
 */
function controleIngangLoper(): void {
	const as = midpoint(ENTRANCE_CARPET.minZ, ENTRANCE_CARPET.maxZ);
	if (!bijna(as, ENTRANCE_PORTAL.centerZ)) {
		fout('ingang', `de loper ligt op z ${nr(as)} en niet op de as van het portaal (${nr(ENTRANCE_PORTAL.centerZ)})`);
	}
	if (!bijna(ENTRANCE_CROSSING.z, as)) {
		fout(
			'ingang',
			`het zebrapad ligt op z ${nr(ENTRANCE_CROSSING.z)} en de loper op z ${nr(as)}, dus je loopt er schuin naartoe`,
		);
	}
	const stoeprand = ENTRANCE_CROSSING.x + half(ROAD_PLAN.width);
	if (!bijna(ENTRANCE_CARPET.minX, stoeprand)) {
		fout('ingang', `de loper stopt op x ${nr(ENTRANCE_CARPET.minX)} terwijl de oversteek op x ${nr(stoeprand)} begint`);
	}
	if (ENTRANCE_CARPET.maxX <= ENTRANCE_PORTAL.outerX) {
		fout('ingang', `de loper begint op x ${nr(ENTRANCE_CARPET.maxX)} en haalt de dorpel op ${nr(ENTRANCE_PORTAL.outerX)} niet`);
	}
	const breedte = span(ENTRANCE_CARPET.minZ, ENTRANCE_CARPET.maxZ);
	if (ZEBRA_WIDTH + EPS < breedte) {
		fout('ingang', `de oversteek is ${nr(ZEBRA_WIDTH)} m breed en de loper ${nr(breedte)} m, dus de loper loopt er naast`);
	}
}

/** Of twee dozen elkaar op alle drie de assen overlappen, en dus tegelijk in beeld zijn. */
function overlapt(a: Bounds3, b: Bounds3): boolean {
	return (
		a.minX < b.maxX - EPS &&
		b.minX < a.maxX - EPS &&
		a.minY < b.maxY - EPS &&
		b.minY < a.maxY - EPS &&
		a.minZ < b.maxZ - EPS &&
		b.minZ < a.maxZ - EPS
	);
}

/** Welke grensvlakken twee dozen op precies dezelfde plek hebben. */
function gedeeldeVlakken(a: Bounds3, b: Bounds3): string[] {
	const assen: [string, readonly number[], readonly number[]][] = [
		['x', [a.minX, a.maxX], [b.minX, b.maxX]],
		['y', [a.minY, a.maxY], [b.minY, b.maxY]],
		['z', [a.minZ, a.maxZ], [b.minZ, b.maxZ]],
	];
	const uit: string[] = [];
	for (const [as, eigen, ander] of assen) {
		for (const vlak of eigen) {
			if (ander.some((rand) => bijna(rand, vlak))) uit.push(`${as}-vlak op ${nr(vlak)}`);
		}
	}
	return uit;
}

/**
 * De luifel: een plaat met een bronzen randprofiel eromheen, en geen twee vlakken op
 * hetzelfde vlak.
 *
 * Het profiel was een band van precies de maat van de plaat: de voorkant deelde zijn
 * beide flankvlakken met de plaat én met de twee zijstukken, en vanaf het voorplein
 * flikkerde de rand van de luifel over zijn hele lengte. Elk stuk sluit nu om de plaat
 * heen in plaats van ertegenaan.
 */
function controleLuifel(): void {
	const plaat = ENTRANCE_CANOPY_PARTS.find((deel) => deel.finish === 'slab');
	if (!plaat) {
		fout('ingang', 'de luifel heeft geen plaat meer, alleen randprofiel');
		return;
	}
	for (const deel of ENTRANCE_CANOPY_PARTS) {
		if (deel.finish === 'slab') continue;
		if (!overlapt(deel, plaat)) fout('ingang', `${deel.id} raakt de luifelplaat niet en hangt er dus los naast`);
	}
	for (let i = 0; i < ENTRANCE_CANOPY_PARTS.length; i++) {
		for (let k = i + 1; k < ENTRANCE_CANOPY_PARTS.length; k++) {
			const a = at(ENTRANCE_CANOPY_PARTS, i);
			const b = at(ENTRANCE_CANOPY_PARTS, k);
			if (!overlapt(a, b)) continue;
			for (const vlak of gedeeldeVlakken(a, b)) {
				fout('ingang', `${a.id} en ${b.id} delen hun ${vlak} en flikkeren daar tegen elkaar op`);
			}
		}
	}
}

/** Het enige standpunt buiten de gevel dat het project levert; hier wordt de entree aan getoetst. */
const INGANG_STANDPUNT = 'v0-entrance-street';

/**
 * Staat dit meetstandpunt buiten elke rijstrook en buiten de aftakking naar de garage?
 *
 * Het ingangsstandpunt stond op vijf centimeter van het hart van de buitenste strook,
 * dus een passerende auto van 4,2 meter dekte het onderste halve beeld af: precies de
 * meting die zo'n standpunt moet dragen en precies de grond die er beoordeeld wordt.
 * Elk standpunt buiten de gevel loopt hier langs.
 */
function controleerVrijVanVerkeer(controle: string, standpunt: string, x: number, z: number): void {
	for (const ring of ROAD_RINGS) {
		for (const rand of ring.edges) {
			const afstand = distanceToSegment2(x, z, rand.ox, rand.oz, rand.ox + rand.dx * rand.len, rand.oz + rand.dz * rand.len);
			if (afstand < TRAFFIC_LANE_CLEARANCE) {
				fout(
					controle,
					`${standpunt} staat ${nr(afstand)} m van een rijstrook, minder dan de ${nr(TRAFFIC_LANE_CLEARANCE)} m die een auto er zelf inneemt`,
				);
			}
		}
	}
	for (let i = 0; i + 1 < EXIT_BRANCH_ROUTE.length; i++) {
		const van = at(EXIT_BRANCH_ROUTE, i);
		const naar = at(EXIT_BRANCH_ROUTE, i + 1);
		const afstand = distanceToSegment2(x, z, van.x, van.z, naar.x, naar.z);
		if (afstand < TRAFFIC_LANE_CLEARANCE) {
			fout(controle, `${standpunt} staat ${nr(afstand)} m van de aftakking naar de garage`);
		}
	}
}

/**
 * De entree zoals hij van de stoep af leest.
 *
 * Een portaal, een luifel en een gevelbelettering zijn op een plattegrond samen één
 * streep, dus de wandelprobe hierboven ziet niets van wat er misging. De belettering
 * hing onder de zichtlijn over de voorrand van de luifel en was voor 89% verstopt
 * achter het dak dat haar moest omlijsten. Een vlaggenmast stond met zijn voet in het
 * open gat van de uitritgeul, twee meter boven de helling. En de vijf verzonken spots
 * onder de luifel lagen op een eigen steek dwars door de ribben heen, waar ze als
 * streepjes tegenaan flikkerden.
 */
function controleIngangZicht(): void {
	const { lettering, canopy, flag } = ENTRANCE_SPEC;
	const { pose } = profilePoint(INGANG_STANDPUNT);

	// Het standpunt zelf staat op de bestrating en niet op de rijbaan.
	if (!dekt(PLAZA_OUTER, pose.x, pose.z)) {
		fout('ingang', `${INGANG_STANDPUNT} staat op (${nr(pose.x)}, ${nr(pose.z)}) en dus buiten de bestrating`);
	}
	if (dekt(PLAZA_TRENCH_GAP, pose.x, pose.z)) {
		fout('ingang', `${INGANG_STANDPUNT} staat op (${nr(pose.x)}, ${nr(pose.z)}) boven het open gat van de uitritgeul`);
	}
	controleerVrijVanVerkeer('ingang', INGANG_STANDPUNT, pose.x, pose.z);

	// De zichtlijn over de voorrand van de luifel, doorgetrokken tot het vlak van de
	// letters. Alles op de gevel eronder is van dit standpunt niet te zien.
	const letterX = ENTRANCE_PORTAL.outerX - lettering.standoff;
	const t = span(pose.x, letterX) / span(pose.x, ENTRANCE_PORTAL.canopyX);
	const zichtlijn = lerp(pose.y, canopy.topY, t);
	const onder = V0 + lettering.centerY - half(lettering.height);
	const boven = V0 + lettering.centerY + half(lettering.height);
	if (onder < zichtlijn) {
		fout(
			'ingang',
			`de belettering begint op ${nr(onder)} en ligt ${nr(span(onder, zichtlijn))} m onder de zichtlijn over de luifel vanaf ${INGANG_STANDPUNT}`,
		);
	}
	if (boven > FACADE_RELIEF_SPEC.cornice.minY) {
		fout(
			'ingang',
			`de belettering reikt tot ${nr(boven)} en loopt daarmee de kroonlijst (${nr(FACADE_RELIEF_SPEC.cornice.minY)}) in`,
		);
	}

	// En hij staat vóór het reliëf dat er op die hoogte langs loopt, niet erin.
	const letterMinZ = ENTRANCE_PORTAL.centerZ - half(lettering.width);
	const letterMaxZ = ENTRANCE_PORTAL.centerZ + half(lettering.width);
	for (const stuk of MALL_FACADE_RELIEF) {
		if (stuk.side !== 'west' || stuk.maxY <= onder || stuk.minY >= boven) continue;
		if (stuk.maxZ <= letterMinZ || stuk.minZ >= letterMaxZ) continue;
		const uitkraging = span(stuk.minX, ENTRANCE_PORTAL.outerX);
		if (lettering.standoff <= uitkraging) {
			fout(
				'ingang',
				`de belettering staat ${nr(lettering.standoff)} m voor de gevel en verdwijnt daarmee in ${stuk.id}, die ${nr(uitkraging)} m uitkraagt`,
			);
		}
	}

	// De masten: vóór de luifel, want ze zijn hoger dan de onderkant ervan, en met hun
	// voet op de stoep in plaats van boven de open uitritgeul.
	const luifelOnder = canopy.topY - canopy.thickness;
	const mastVoet = flag.radius * flag.baseFlare;
	if (V0 + flag.height > luifelOnder && ENTRANCE_PORTAL.flagX > ENTRANCE_PORTAL.canopyX - mastVoet) {
		fout(
			'ingang',
			`de vlaggenmast staat op x ${nr(ENTRANCE_PORTAL.flagX)} en dus onder de luifel (tot x ${nr(ENTRANCE_PORTAL.canopyX)}), terwijl hij tot ${nr(V0 + flag.height)} reikt en de luifel op ${nr(luifelOnder)} hangt`,
		);
	}
	for (const kant of [-1, 1] as const) {
		const x = ENTRANCE_PORTAL.flagX;
		const z = ENTRANCE_PORTAL.centerZ + kant * ENTRANCE_PORTAL.flagOffsetZ;
		const grond = wereld.groundHeightAt(x, z, V0, WALK_STEP);
		if (!bijna(grond, V0, 1e-6)) {
			fout('ingang', `de vlaggenmast op (${nr(x)}, ${nr(z)}) staat op ${nr(grond)} in plaats van op de stoep (${nr(V0)})`);
		}
		if (dekt(PLAZA_TRENCH_GAP, x, z)) {
			fout('ingang', `de vlaggenmast op (${nr(x)}, ${nr(z)}) staat in het open gat van de uitritgeul`);
		}
	}

	// De spots onder de luifel liggen in de vakken tússen de ribben, en eronder.
	const { rib, spot } = canopy;
	const ribY = canopy.topY - canopy.thickness - rib.drop;
	const spotY = ribY - half(rib.height) - spot.drop;
	if (spotY > ribY - half(rib.height)) {
		fout('ingang', `de spots hangen op ${nr(spotY)} en zitten daarmee in de ribben (tot ${nr(ribY - half(rib.height))})`);
	}
	const vrij = spot.radius + half(rib.width);
	for (const [i, spotZ] of ENTRANCE_CANOPY_BAY_ZS.entries()) {
		for (const ribZ of ENTRANCE_CANOPY_RIB_ZS) {
			const speling = Math.abs(spotZ - ribZ) - vrij;
			if (speling < 0) {
				fout('ingang', `spot ${i} op z ${nr(spotZ)} loopt ${nr(-speling)} m de rib op z ${nr(ribZ)} in`);
			}
		}
	}

	// En de waslamp onder de luifel hangt in een vak, net als de spots. Op de portaalas
	// staat bij een oneven aantal ribben een rib, en die brandt van 0,66 m wit uit
	// terwijl zijn buren op 1,20 m donker blijven: kop-op leest de luifel als een
	// witte balk. Midden in een vak is elke rib even ver weg.
	const halveSteek = half(ENTRANCE_CANOPY_RIB_PITCH);
	const dichtsteRib = ENTRANCE_CANOPY_RIB_ZS.reduce(
		(kortste, ribZ) => Math.min(kortste, Math.abs(ENTRANCE_CANOPY_WASH_Z - ribZ)),
		Number.POSITIVE_INFINITY,
	);
	if (dichtsteRib < halveSteek - EPS) {
		fout(
			'ingang',
			`de waslamp hangt op z ${nr(ENTRANCE_CANOPY_WASH_Z)} en daarmee ${nr(dichtsteRib)} m van een rib, in plaats van midden in een vak op ${nr(halveSteek)} m`,
		);
	}
}

/** Het paar standpunten in het park: één op de mall, één met de mall in de rug. */
const PARK_NAAR_MALL = 'park-buiten-mall';
const PARK_WEG_VAN_MALL = 'park-buiten-weg';

/**
 * Het paar meetstandpunten in het stadspark.
 *
 * Ze bestaan om de zonecull van buitenaf af te lezen, en dat werkt alleen als ze
 * allebei écht buiten staan, allebei op dezelfde plek, en de tweede het gebouw
 * werkelijk in de rug heeft. Elk van die drie is een getal in een pose en geen van
 * drieën is aan de coördinaten af te lezen: het kavel dat het park draagt loopt tot
 * tússen de twee rijstroken, dus wie zich op het kavel richt staat op de rijbaan.
 */
function controleParkZicht(): void {
	// Het gras hoort binnen het kavel dat het park draagt. Het stond hier als vier
	// losse getallen naast dat kavel, dezelfde hartlijn maar een rechthoek van acht
	// meter kleiner, en niets vergeleek die twee.
	if (
		PARK_LAWN.minX < CITY_KAVELS.park.minX ||
		PARK_LAWN.maxX > CITY_KAVELS.park.maxX ||
		PARK_LAWN.minZ < CITY_KAVELS.park.minZ ||
		PARK_LAWN.maxZ > CITY_KAVELS.park.maxZ
	) {
		fout(
			'park',
			`het gras loopt van (${nr(PARK_LAWN.minX)}, ${nr(PARK_LAWN.minZ)}) tot (${nr(PARK_LAWN.maxX)}, ${nr(PARK_LAWN.maxZ)}) en steekt daarmee buiten het parkkavel (${nr(CITY_KAVELS.park.minX)}, ${nr(CITY_KAVELS.park.minZ)})..(${nr(CITY_KAVELS.park.maxX)}, ${nr(CITY_KAVELS.park.maxZ)})`,
		);
	}
	if (span(PARK_LAWN.minX, PARK_LAWN.maxX) <= 0 || span(PARK_LAWN.minZ, PARK_LAWN.maxZ) <= 0) {
		fout('park', 'de berm eet het hele grasveld op; dan staat er een park zonder gras');
	}

	const naar = profilePoint(PARK_NAAR_MALL);
	const weg = profilePoint(PARK_WEG_VAN_MALL);
	if (naar.pose.x !== weg.pose.x || naar.pose.y !== weg.pose.y || naar.pose.z !== weg.pose.z) {
		fout(
			'park',
			`${PARK_NAAR_MALL} staat op (${nr(naar.pose.x)}, ${nr(naar.pose.z)}) en ${PARK_WEG_VAN_MALL} op (${nr(weg.pose.x)}, ${nr(weg.pose.z)}); dan meten ze twee standpunten in plaats van twee richtingen`,
		);
	}
	for (const { name, pose } of [naar, weg]) {
		if (!dekt(CITY_KAVELS.park, pose.x, pose.z)) {
			fout('park', `${name} staat op (${nr(pose.x)}, ${nr(pose.z)}) en dus buiten het parkkavel`);
		}
		controleerVrijVanVerkeer('park', name, pose.x, pose.z);
		const grond = wereld.groundHeightAt(pose.x, pose.z, CITY_GROUND_Y, WALK_STEP);
		if (!bijna(grond, CITY_GROUND_Y)) {
			fout('park', `${name} staat op ${nr(grond)} in plaats van op straatniveau (${nr(CITY_GROUND_Y)})`);
		}
		const zone = zoneAt(pose.x, pose.y, pose.z);
		if (zone !== 'stad') {
			fout('park', `${name} staat in zone ${zone} en meet daarmee geen standpunt buiten het gebouw`);
		}
	}
	// De vier hoeken van de gevelomtrek, elk vóór of achter de kijkrichting. Alle vier
	// vóór is "de mall in beeld", alle vier achter is "de mall in de rug"; per hoek en
	// niet per middelpunt, want een gebouw van 73 bij 48 meter ligt op negentig meter
	// nog altijd dertig graden breed.
	const hoeken = [
		[MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.minZ],
		[MALL_WALL_ENVELOPE.minX, MALL_WALL_ENVELOPE.maxZ],
		[MALL_WALL_ENVELOPE.maxX, MALL_WALL_ENVELOPE.minZ],
		[MALL_WALL_ENVELOPE.maxX, MALL_WALL_ENVELOPE.maxZ],
	] as const;
	for (const [standpunt, inBeeld] of [
		[naar, true],
		[weg, false],
	] as const) {
		const { pose } = standpunt;
		const kijkX = span(pose.x, pose.lookX);
		const kijkZ = span(pose.z, pose.lookZ);
		for (const [hoekX, hoekZ] of hoeken) {
			const voor = kijkX * span(pose.x, hoekX) + kijkZ * span(pose.z, hoekZ) > 0;
			if (voor === inBeeld) continue;
			fout(
				'park',
				`${standpunt.name} heeft gevelhoek (${nr(hoekX)}, ${nr(hoekZ)}) ${voor ? 'vóór' : 'achter'} zich, en hoort de mall ${inBeeld ? 'volledig in beeld' : 'volledig in de rug'} te hebben`,
			);
		}
	}
}

// ── 5b2. hurken onder een lage balk ────────────────────────────────────────

/** Dikte van de proefbalk langs x. Ruim boven de stap van de probe, zodat niemand erdoorheen tunnelt. */
const KRUIP_BALKDIEPTE = 1;

/** Breedte langs z: aan weerszijden meer dan een lichaam, zodat er niet omheen te lopen valt. */
const KRUIP_BALKBREEDTE = PLAYER_RADIUS * 8;

/** Hoogte van de balk zelf; alleen zijn onderkant doet ertoe, maar een balk van niets bestaat niet. */
const KRUIP_BALKHOOGTE = 0.4;

/** Hoever vóór de balk een rechtop lopende voetganger mag stranden: één stap, en niet eerder. */
const KRUIP_STOPMARGE = INGANG_STAP * 2;

/** Hoeveel monsters er over een vlucht lopen als de vrije hoogte erlangs gemeten wordt. */
const KRUIP_VLUCHTMONSTERS = 40;

/**
 * Hurken, gelopen zoals de speler het loopt.
 *
 * De balk hangt op precies de vrije hoogte die de gehurkte houding vraagt, en dat
 * getal komt uit `CROUCHING_PEDESTRIAN`. Trek dat profiel gelijk aan het staande, dan
 * stuit de gehurkte voetganger op zijn eigen balk en valt deze controle om: dit is de
 * plek waar het profiel iets doet dat je kunt aflopen.
 *
 * De balk staat in een eigen wereld. Hij hoort niet in het gebouw en elke controle na
 * deze zou hem daar tegenkomen.
 *
 * De tweede helft kijkt de andere kant op. De vrije hoogte is nu een eis om ergens te
 * mogen lopen, dus elke vlucht die er al was moet er staand doorheen passen; deed hij
 * dat niet, dan zou de speler op de roltrap door de knieën gaan.
 */
function controleHurken(): void {
	const staand = STANDING_PEDESTRIAN;
	const gehurkt = CROUCHING_PEDESTRIAN;
	if (gehurkt.bodyHeight >= staand.bodyHeight || gehurkt.eyeHeight >= staand.eyeHeight) {
		fout(
			'hurken',
			`gehurkt is ${nr(gehurkt.bodyHeight)} m hoog en staand ${nr(staand.bodyHeight)} m, dus hurken levert niets op`,
		);
	}
	if (gehurkt.eyeHeight >= gehurkt.bodyHeight) {
		fout('hurken', `het gehurkte oog zit op ${nr(gehurkt.eyeHeight)} m en de kruin op ${nr(gehurkt.bodyHeight)} m`);
	}
	if (gehurkt.requiredHeadroom <= gehurkt.bodyHeight) {
		fout(
			'hurken',
			`gehurkt vraagt ${nr(gehurkt.requiredHeadroom)} m vrije hoogte voor een lichaam van ${nr(gehurkt.bodyHeight)} m`,
		);
	}
	if (gehurkt.requiredHeadroom >= staand.requiredHeadroom) {
		fout(
			'hurken',
			`gehurkt vraagt ${nr(gehurkt.requiredHeadroom)} m en staand ${nr(staand.requiredHeadroom)} m, dus geen enkele doorgang is alleen gehurkt te nemen`,
		);
	}
	if (gehurkt.radius !== staand.radius) {
		fout(
			'hurken',
			`gehurkt meet een straal van ${nr(gehurkt.radius)} m en staand ${nr(staand.radius)} m; schouders worden niet smaller`,
		);
	}

	const z = ENTRANCE_PORTAL.centerZ;
	const balkX = ENTRANCE_PORTAL.innerX + half(ENTRANCE_SPEC.hall.depth);
	const voorkant = balkX - half(KRUIP_BALKDIEPTE);
	const onderkant = V0 + postureHeadroom('crouching');
	const kruipwereld = new CollisionWorld();
	kruipwereld.addBox(voorkant, balkX + half(KRUIP_BALKDIEPTE), z - half(KRUIP_BALKBREEDTE), z + half(KRUIP_BALKBREEDTE), {
		minY: onderkant,
		maxY: onderkant + KRUIP_BALKHOOGTE,
		label: 'kruipbalk',
		tags: [SIGHT_BLOCKING_TAG],
	});

	const onder = kruipwereld.headroomAt(balkX, z, V0);
	if (!bijna(onder, postureHeadroom('crouching'))) {
		fout(
			'hurken',
			`onder de balk meet de vrije hoogte ${nr(onder)} m in plaats van de gehurkte ${nr(postureHeadroom('crouching'))} m`,
		);
	}

	const doel = half(ATRIUM_VOID.width);
	const rechtop = loopLangsDeAs(z, INGANG_STRAAT_X, doel, { wereld: kruipwereld, houding: 'standing' });
	if (rechtop.klacht !== null) {
		fout('hurken', rechtop.klacht);
	} else if (rechtop.x >= voorkant) {
		fout('hurken', `rechtop loopt de voetganger tot x ${nr(rechtop.x)} en dus onder de balk op x ${nr(voorkant)} door`);
	} else if (voorkant - rechtop.x > KRUIP_STOPMARGE) {
		fout('hurken', `rechtop strandt de voetganger al op x ${nr(rechtop.x)}, ruim voor de balk op x ${nr(voorkant)}`);
	}

	const gehurktLangs = loopLangsDeAs(z, INGANG_STRAAT_X, doel, { wereld: kruipwereld, houding: 'crouching' });
	if (gehurktLangs.klacht !== null) {
		fout('hurken', gehurktLangs.klacht);
	} else if (gehurktLangs.x < doel) {
		fout('hurken', `gehurkt strandt de wandeling op x ${nr(gehurktLangs.x)} en haalt het atrium (x ${nr(doel)}) niet`);
	}

	// De hal zelf: zonder balk hoort de onderkant van de V1-plaat het antwoord te zijn.
	// Een `headroomAt` die overal oneindig meldt haalt elke eis hierboven leeg.
	const inDeHal = wereld.headroomAt(balkX, z, V0);
	const onderkantV1 = MALL_SLAB_SPECS.v1.topY - MALL_SLAB_SPECS.v1.thickness;
	if (!bijna(inDeHal, span(V0, onderkantV1))) {
		fout('hurken', `in de entreehal meet de vrije hoogte ${nr(inDeHal)} m en de V1-plaat begint op ${nr(onderkantV1)}`);
	}

	for (const connector of VERTICAL_CONNECTORS) {
		for (let i = 0; i <= KRUIP_VLUCHTMONSTERS; i++) {
			const t = i / KRUIP_VLUCHTMONSTERS;
			const treeZ = lerp(connector.zBottom, connector.zTop, t);
			const treeY = lerp(levelY(connector.from), levelY(connector.to), t);
			const vrij = wereld.headroomAt(connector.x, treeZ, treeY);
			if (vrij >= postureHeadroom('standing')) continue;
			fout(
				'hurken',
				`op ${connector.id} (z ${nr(treeZ)}, y ${nr(treeY)}) is er ${nr(vrij)} m vrije hoogte en staand vraagt ${nr(postureHeadroom('standing'))} m`,
			);
			break;
		}
	}

	let laagsteOpDeUitrit = Number.POSITIVE_INFINITY;
	let laagsteX: number = PARKING_EXIT_RAMP.start.x;
	for (let i = 0; i <= KRUIP_VLUCHTMONSTERS; i++) {
		const x = lerp(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x, i / KRUIP_VLUCHTMONSTERS);
		const vrij = wereld.headroomAt(x, PARKING_EXIT_RAMP.start.z, parkingExitRampY(x));
		if (vrij >= laagsteOpDeUitrit) continue;
		laagsteOpDeUitrit = vrij;
		laagsteX = x;
	}
	if (laagsteOpDeUitrit < postureHeadroom('standing')) {
		fout(
			'hurken',
			`op de parkeeruitrit (x ${nr(laagsteX)}) is er ${nr(laagsteOpDeUitrit)} m vrije hoogte en staand vraagt ${nr(postureHeadroom('standing'))} m`,
		);
	}
}

// ── 5c. de lus terug naar binnen ───────────────────────────────────────────

/** Hoever voorbij de dakrand de probe kijkt: één stap buiten de voetafdruk. */
const DAKLUS_STAP = 1;

/**
 * Van het dak af en weer naar binnen.
 *
 * Van het dak springen kon al; wat ontbrak was het bewijs dat de lus daarna sluit.
 * Er stond een comment dat de parkeeruitrit de enige weg terug naar binnen was, en dat
 * hield op waar te zijn zodra de hoofdingang er stond, maar geen enkele controle liep
 * hem: dat de speler op het dak niet vast komt te zitten rustte op niemands bewijs.
 * Deze loopt de hele keten in één stuk — dakrand, straat, voorplein, atrium.
 */
function controleDaklus(): void {
	const z = ENTRANCE_PORTAL.centerZ;
	const rand = -half(MALL_FOOTPRINT.width);
	const opDak = wereld.groundHeightAt(rand + DAKLUS_STAP, z, DAK, WALK_STEP);
	if (!bijna(opDak, DAK)) {
		fout('daklus', `op de westelijke dakrand (z ${nr(z)}) is de vloer ${nr(opDak)} in plaats van het dak (${nr(DAK)})`);
		return;
	}

	// Over de rand: buiten de voetafdruk hoort er straat te liggen en hoort niets je
	// op dakhoogte terug te duwen, anders is de sprong er helemaal niet.
	const buiten = ENTRANCE_PORTAL.canopyX - DAKLUS_STAP;
	const geklemd = wereld.resolveCircle(buiten, z, DAK, PLAYER_RADIUS, 3, true, true, true);
	if (Math.hypot(geklemd.x - buiten, geklemd.z - z) > EPS) {
		fout('daklus', `op dakhoogte duwt de schil je bij (${nr(buiten)}, ${nr(z)}) terug het dak op: er is geen sprong`);
	}
	const straat = wereld.groundHeightAt(buiten, z, CITY_GROUND_Y, WALK_STEP);
	if (!bijna(straat, CITY_GROUND_Y)) {
		fout('daklus', `waar je landt (${nr(buiten)}, ${nr(z)}) ligt de vloer op ${nr(straat)} in plaats van op straatniveau`);
	}

	// En vanaf die landingsplek loop je de hoofdingang weer in.
	const terug = loopLangsDeAs(z, buiten, half(ATRIUM_VOID.width));
	if (terug.klacht !== null) {
		fout('daklus', terug.klacht);
		return;
	}
	if (!wereld.insideMallPlan(terug.x, z)) {
		fout('daklus', `vanaf de landingsplek strandt de wandeling op x ${nr(terug.x)} en komt het gebouw niet meer in`);
	}
}

// ── 5d. de dakplaat draagt overal ───────────────────────────────────────────

/** Rasterstap waarmee de dakplaat wordt afgelopen (m). */
const DAKDEK_STAP = 0.5;

/**
 * De getekende dakplaat draagt overal een dakloper, en net erbuiten niets.
 *
 * De dekking is de dakslab minus zijn eigen gaten. Liep hij vóór de gevel af, dan stond je
 * aan de oostrand op kale slab die groundHeightAt niet droeg en zakte je door het dak naar
 * V1 in het gebouw. Elk massief plaatpunt hoort op dakhoogte te dragen; het dakbad valt
 * eruit, want daar geeft poolFloorY de badbodem. Net buiten de plaat draagt niets op
 * dakhoogte: over de rand ligt de straat en dat is de daksprong, die daklus bewaakt.
 */
function controleDakdek(): void {
	const dakGaten = MALL_SLAB_SPECS.roof.holes.map((h) => planBounds(h));
	const randX = half(MALL_FOOTPRINT.width);
	const randZ = half(MALL_FOOTPRINT.depth);
	const massief = (x: number, z: number): boolean => !dakGaten.some((h) => x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ);
	for (let x = -randX; x <= randX; x += DAKDEK_STAP) {
		for (let z = -randZ; z <= randZ; z += DAKDEK_STAP) {
			if (!massief(x, z) || inPool(x, z)) continue;
			const grond = wereld.groundHeightAt(x, z, DAK, WALK_STEP);
			if (bijna(grond, DAK)) continue;
			fout('dakdek', `op de dakplaat (${nr(x)}, ${nr(z)}) draagt de vloer ${nr(grond)} in plaats van het dak (${nr(DAK)})`);
			return;
		}
	}
	for (const [x, z] of [
		[randX + DAKDEK_STAP, 0],
		[-randX - DAKDEK_STAP, 0],
		[0, randZ + DAKDEK_STAP],
		[0, -randZ - DAKDEK_STAP],
	] as const) {
		const grond = wereld.groundHeightAt(x, z, DAK, WALK_STEP);
		if (bijna(grond, DAK)) {
			fout('dakdek', `net buiten de dakrand (${nr(x)}, ${nr(z)}) draagt de vloer alsnog op dakhoogte (${nr(grond)})`);
		}
	}

	// De gerapporteerde val: aan de rand rukt de grond je omlaag en de sub-dakhoge muur
	// duwt je binnen; net onder dakhoogte moet de dakplaat je dan nog dragen in plaats van
	// je op V1 te zetten. De marge is een lichaam binnen de gevel, precies waar de muur je
	// heen duwt, en de hoogte de dip waar de val eerder op V1 uitkwam.
	const binnen = PLAYER_RADIUS + DAKDEK_STAP;
	const dipY = V1 + 3;
	for (const [x, z] of [
		[randX - binnen, 6.7],
		[randX - binnen, -12],
		[-randX + binnen, 15],
		[0, randZ - binnen],
		[0, -randZ + binnen],
	] as const) {
		const grond = wereld.groundHeightAt(x, z, dipY, WALK_STEP);
		if (!bijna(grond, DAK)) {
			fout(
				'dakdek',
				`binnen de dakrand (${nr(x)}, ${nr(z)}) op dip-hoogte ${nr(dipY)} draagt de vloer ${nr(grond)}: je zakt door het dak naar binnen in plaats van op het dak te blijven`,
			);
		}
	}
}

// ── 6. glijbaanladder ──────────────────────────────────────────────────────

/**
 * De ladder naar het glijbaanplatform, stap voor stap beklommen zoals de speler
 * dat doet. Die is één keer stilletjes gebroken: halverwege gaf de wereld het
 * dak terug in plaats van de sport, en dan klim je niet meer.
 */
function controleLadder(): void {
	const r = wereld.ramps.find((ramp) => ramp.label === 'slide_ladder');
	if (!r) {
		fout('ladder', "geen ramp 'slide_ladder' meer in CollisionWorld");
		return;
	}
	const x = midpoint(r.minX, r.maxX);
	const dz = 0.05; // ongeveer één frame lopen
	const stappen = Math.max(1, Math.ceil(Math.abs(r.zTop - r.zBottom) / dz));
	let y = r.yBottom;
	for (let i = 0; i <= stappen; i++) {
		const z = r.zBottom + ((r.zTop - r.zBottom) * i) / stappen;
		const grond = wereld.groundHeightAt(x, z, y, WALK_STEP);
		if (grond + 1e-6 < y) {
			fout('ladder', `op z ${nr(z)} zakt de klimmer van ${nr(y)} naar ${nr(grond)}`);
			return;
		}
		y = grond;
	}
	if (!bijna(y, r.yTop, 1e-3)) fout('ladder', `de klim eindigt op ${nr(y)} in plaats van op het platform (${nr(r.yTop)})`);
}

// ── 6. het glazen dak ──────────────────────────────────────────────────────

/**
 * Boven het atrium ligt het glazen dak: daar loop je overheen. Op V1 is
 * hetzelfde gat wél een gat en hoor je eruit geschopt te worden. De void-eject
 * had geen bovengrens en duwde je van het dak af.
 */
function controleGlazenDak(): void {
	const minX = -half(ATRIUM_VOID.width);
	const maxX = half(ATRIUM_VOID.width);
	const minZ = -half(ATRIUM_VOID.depth);
	const maxZ = half(ATRIUM_VOID.depth);
	const straal = PLAYER_RADIUS;
	const stap = 0.4;
	let gaten = 0;
	let duwen = 0;
	let vast = 0;
	for (let x = minX + 0.05; x <= maxX; x += stap) {
		for (let z = minZ + 0.05; z <= maxZ; z += stap) {
			const grond = wereld.groundHeightAt(x, z, DAK, WALK_STEP);
			if (!bijna(grond, DAK)) {
				gaten++;
				if (gaten === 1) fout('glazendak', `op (${nr(x)}, ${nr(z)}) geeft het dak ${nr(grond)} in plaats van ${nr(DAK)}`);
			}
			const opDak = wereld.resolveCircle(x, z, DAK, straal, 3, true, false);
			if (Math.hypot(opDak.x - x, opDak.z - z) > EPS) {
				duwen++;
				if (duwen === 1)
					fout('glazendak', `op (${nr(x)}, ${nr(z)}) word je van het glazen dak geduwd naar (${nr(opDak.x)}, ${nr(opDak.z)})`);
			}
			const opV1 = wereld.resolveCircle(x, z, V1, straal, 3, true, false);
			if (opV1.x > minX && opV1.x < maxX && opV1.z > minZ && opV1.z < maxZ) {
				vast++;
				if (vast === 1)
					fout('glazendak', `op V1 blijf je op (${nr(x)}, ${nr(z)}) boven het gat hangen in plaats van eruit geduwd te worden`);
			}
		}
	}
	if (gaten > 1) fout('glazendak', `${gaten} rasterpunten op dakhoogte hebben geen vloer`);
	if (duwen > 1) fout('glazendak', `${duwen} rasterpunten op dakhoogte duwen je weg`);
	if (vast > 1) fout('glazendak', `${vast} rasterpunten op V1 laten je boven het gat staan`);
}

// ── 7. het zwembad ─────────────────────────────────────────────────────────

type Zitplaats = { x: number; z: number; marge: number; wat: string };

/**
 * De gekozen plekken van de badgasten. `waterSeat` is niet geëxporteerd en de
 * cast staat in een methode, dus de plekken komen uit de bron en worden langs
 * de echte waterlijn gelegd. Waar ze uiteindelijk terechtkomen, controleert
 * `controleBadgasten` op de gebouwde scene.
 */
function poolZitplaatsen(): Zitplaats[] {
	const pp = bron('scene/PoolPeople.ts');
	const teken = (s: string): number => (s === '-' ? -1 : 1);
	const swimClear = getal(pp, /const SWIM_CLEAR = (-?[\d.]+);/, 'SWIM_CLEAR');
	const ringClear = getal(pp, /const SWIM_CLEAR_RING = (-?[\d.]+);/, 'SWIM_CLEAR_RING');
	const rimClear = getal(pp, /const RIM_CLEAR = (-?[\d.]+);/, 'RIM_CLEAR');
	const zitplaatsen: Zitplaats[] = [];

	// De hele garantie hangt aan die ene aanroep: zonder waterSeat zijn het weer
	// losse coördinaten en lag de helft van de cast op de tegels.
	eist(pp, 'waterSeat(c.x, c.z, c.ring ? SWIM_CLEAR_RING : SWIM_CLEAR)', 'de zwemmers via waterSeat neerzetten');

	const zwemmer = /\{ x: POOL_X ([+-]) ([\d.]+), z: POOL_Z ([+-]) ([\d.]+),[^}]*?ring: (true|false) \}/g;
	for (const m of pp.matchAll(zwemmer)) {
		const [, sx, dx, sz, dz, ring] = m;
		if (!sx || !dx || !sz || !dz || !ring) continue;
		zitplaatsen.push({
			x: POOL_CENTER.x + teken(sx) * Number(dx),
			z: POOL_CENTER.z + teken(sz) * Number(dz),
			marge: ring === 'true' ? ringClear : swimClear,
			wat: `zwemmer ${zitplaatsen.length + 1}`,
		});
	}
	if (zitplaatsen.length < 4)
		throw new Error(`maar ${zitplaatsen.length} zwemmers gevonden in PoolPeople — is de cast herschreven?`);

	const rand = /waterSeat\(POOL_X ([+-]) ([\d.]+), POOL_Z ([+-]) ([\d.]+)\)/g;
	let randdames = 0;
	for (const m of pp.matchAll(rand)) {
		const [, sx, dx, sz, dz] = m;
		if (!sx || !dx || !sz || !dz) continue;
		randdames++;
		zitplaatsen.push({
			x: POOL_CENTER.x + teken(sx) * Number(dx),
			z: POOL_CENTER.z + teken(sz) * Number(dz),
			marge: rimClear,
			wat: `randdame ${randdames}`,
		});
	}
	if (randdames < 2) throw new Error(`maar ${randdames} randdames gevonden in PoolPeople — is buildLoungers herschreven?`);

	// De waterlijn moet uit RoofIsland komen en niet nog eens los in PoolPeople
	// staan. Op de waarde toetsen kan niet zonder de module te bouwen, dus toets
	// op de afleiding zelf: een eigen getal is precies hoe die twee 30 cm uit
	// elkaar zijn gaan lopen.
	if (/const WATER_Y = -?[\d.]+;/.test(pp)) {
		fout('zwembad', 'PoolPeople heeft een eigen WATER_Y als los getal — leid hem af van POOL_WATER_Y');
	}
	return zitplaatsen;
}

function controleZwembad(): void {
	const zitplaatsen = poolZitplaatsen();
	const grootste = Math.max(...zitplaatsen.map((z) => z.marge));
	const middenRuimte = rimDistance(POOL_CENTER.x, POOL_CENTER.z);

	// waterSeat trekt naar POOL_CENTER. Ligt dat punt zelf te krap, dan heeft de
	// hele helper geen geldig doel meer om naartoe te trekken.
	if (!inPool(POOL_CENTER.x, POOL_CENTER.z))
		fout('zwembad', 'POOL_CENTER ligt niet in het water — waterSeat trekt de badgasten de tegels op');
	if (middenRuimte < grootste) {
		fout('zwembad', `POOL_CENTER heeft ${nr(middenRuimte)} m tot de rand, minder dan de grootste marge ${nr(grootste)}`);
	}

	// waterSeat schuift in stappen naar het midden en stopt bij het eerste
	// geldige punt. Dat lukt gegarandeerd zolang de laatste 10% van dat pad
	// aaneengesloten geldig is, welke stapgrootte de helper ook gebruikt.
	const N = 400;
	for (const zit of zitplaatsen) {
		const geldig = (t: number): boolean => {
			const x = zit.x + (POOL_CENTER.x - zit.x) * t;
			const z = zit.z + (POOL_CENTER.z - zit.z) * t;
			return inPool(x, z) && rimDistance(x, z) >= zit.marge;
		};
		let staart = 0;
		for (let i = N; i >= 0; i--) {
			if (!geldig(i / N)) {
				staart = (i + 1) / N;
				break;
			}
		}
		const plek = `${zit.wat} op (${nr(zit.x)}, ${nr(zit.z)})`;
		if (staart > 1) {
			fout('zwembad', `${plek} komt nergens op de weg naar het midden in water met ${nr(zit.marge)} m marge`);
		} else if (staart > 0.9) {
			fout(
				'zwembad',
				`${plek} vindt pas op ${nr(staart * 100)}% van de weg naar het midden water met ${nr(zit.marge)} m marge — te diep in de aanloop van waterSeat`,
			);
		}
	}

	// De bodem is het gat in het dek: binnen de waterlijn is dát de vloer.
	const grond = wereld.groundHeightAt(POOL_CENTER.x, POOL_CENTER.z, DAK, WALK_STEP);
	const bodem = poolFloorY(POOL_CENTER.x, POOL_CENTER.z);
	if (bodem === null) fout('zwembad', 'poolFloorY geeft geen bodem in het midden van het bad');
	else if (!bijna(grond, bodem, 1e-3))
		fout('zwembad', `in het bad geeft de wereld ${nr(grond)} in plaats van de badbodem ${nr(bodem)}`);
	if (POOL_FLOOR_Y >= POOL_WATER_Y)
		fout('zwembad', `de bodem (${nr(POOL_FLOOR_Y)}) ligt niet onder de waterspiegel (${nr(POOL_WATER_Y)})`);
	const diepte = wereld.waterDepthAt(POOL_CENTER.x, POOL_CENTER.z, POOL_FLOOR_Y);
	if (diepte <= 0) fout('zwembad', 'waterDepthAt geeft geen water op de bodem van het bad');
	if (wereld.waterDepthAt(POOL_CENTER.x, POOL_CENTER.z, DAK + 5) !== 0)
		fout('zwembad', 'waterDepthAt geeft water ver boven het bad');
}

// ── 8. de badgasten zelf ───────────────────────────────────────────────────

/**
 * En dan waar ze écht staan. Met de canvasstub bouwt PoolPeople gewoon, dus dit
 * hoeft niet op de constanten te vertrouwen: alles wat onder dekhoogte hangt
 * zit in het bad en hoort dus binnen de waterlijn te liggen. Zo lagen de helft
 * van de zwemmers en beide randdames ooit op de tegels.
 */
async function controleBadgasten(): Promise<void> {
	const pp = bron('scene/PoolPeople.ts');

	const rimClear = getal(pp, /const RIM_CLEAR = (-?[\d.]+);/, 'RIM_CLEAR');
	const crewClear = getal(pp, /const CREW_CLEAR = (-?[\d.]+);/, 'CREW_CLEAR');
	stubDocument();
	const { PoolPeople } = await import('#/scene/PoolPeople');
	const cast = new PoolPeople().group.children;

	// Niemand van de cast staat in het barmeubel. Man één van de AL ZUT-crew
	// stond op een los ingetikte -12,9 tot zijn middel in de counter, en de
	// parasol heeft volgens zijn eigen comment hetzelfde eerder gedaan met het
	// bord. De hele cast tegen de hele counter, dan maakt de volgende aanwas
	// niet uit waar hij vandaan komt.
	const counterVolume = ENTITEIT_PER_ID.get('tiki-bar')?.volumes.find((volume) => volume.id === 'counter');
	if (!counterVolume) {
		fout('badgasten', 'tiki-bar heeft geen counter-volume meer — hernoemd of weggevallen');
		return;
	}
	const counter = geometryBounds(counterVolume.geometry);
	for (const lid of cast) {
		const { x, z } = lid.position;
		if (
			x > counter.minX - crewClear &&
			x < counter.maxX + crewClear &&
			z > counter.minZ - crewClear &&
			z < counter.maxZ + crewClear
		) {
			fout('badgasten', `castlid op (${nr(x)}, ${nr(z)}) staat in of tegen de tiki-bar-counter`);
		}
	}

	// Het tiki-bar-bord leest van de badkant. De parasolkap hing tussen het bad en
	// het bord in, op dezelfde hoogte, en dekte de rechterhelft af: er stond nog
	// "TIKI BA" en de rest zat achter riet. De kap staat west van het bord, dus wie
	// van het bad kijkt kijkt er langs alleen als hij voorbij de rand van het bord valt.
	const { PARASOL_CANOPY_RADIUS, PARASOL_POSITION } = await import('#/scene/PoolPeople');
	const bordZ = TIKI_BAR_SPEC.center.z;
	const bordRand = half(TIKI_BAR_SPEC.sign.width);
	const bordX = TIKI_BAR_SPEC.center.x + TIKI_BAR_SPEC.sign.offsetX;
	const overlap = bordRand + PARASOL_CANOPY_RADIUS - Math.abs(PARASOL_POSITION.z - bordZ);
	if (PARASOL_POSITION.x < bordX && overlap > 0) {
		fout(
			'badgasten',
			`de parasolkap op z ${nr(PARASOL_POSITION.z)} staat voor het bord (z ${nr(bordZ - bordRand)}..${nr(bordZ + bordRand)}) en dekt er ${nr(overlap)} m van af`,
		);
	}

	// In het water hangen is dieper dan alleen onder dekhoogte: de zonaanbidsters
	// liggen ook onder dekhoogte, in hun stoel. Meet dus vanaf de waterlijn.
	const badgasten = cast.filter((o) => o.position.y < POOL_WATER_Y - 0.75);
	// Vier zwemmers en twee randdames. Vindt hij er minder, dan zit de cast in
	// een subgroep en controleert dit niets meer.
	if (badgasten.length < 6) {
		fout('badgasten', `${badgasten.length} badgasten onder dekhoogte gevonden in plaats van 6 — is PoolPeople anders opgebouwd?`);
	}
	for (const gast of badgasten) {
		const { x, y, z } = gast.position;
		const plek = `badgast op (${nr(x)}, ${nr(z)}) op ${nr(y)}`;
		if (!inPool(x, z)) fout('badgasten', `${plek} ligt buiten de waterlijn, op de tegels`);
		else if (rimDistance(x, z) < rimClear) {
			fout(
				'badgasten',
				`${plek} heeft ${nr(rimDistance(x, z))} m tot de rand, minder dan ${nr(rimClear)}: hij hangt half over de tegels`,
			);
		}
	}
}

// ── 9. platforms ───────────────────────────────────────────────────────────

/** Sta je op een platformdek, dan is dat dek de vloer en duwt niets je eraf. */
function controlePlatforms(): void {
	const straal = PLAYER_RADIUS;
	for (const p of wereld.platforms) {
		for (let x = p.minX + 0.05; x <= p.maxX; x += 0.25) {
			for (let z = p.minZ + 0.05; z <= p.maxZ; z += 0.25) {
				if (!wereld.platformCovers(p, x, z)) continue;
				const grond = wereld.groundHeightAt(x, z, p.y, WALK_STEP);
				if (!bijna(grond, p.y)) {
					fout('platforms', `${p.label}: op (${nr(x)}, ${nr(z)}) is de vloer ${nr(grond)} in plaats van het dek ${nr(p.y)}`);
					return;
				}
				const los = wereld.resolveCircle(x, z, p.y, straal, 3, true, false);
				if (Math.hypot(los.x - x, los.z - z) > EPS) {
					fout('platforms', `${p.label}: op (${nr(x)}, ${nr(z)}) word je van je eigen dek geduwd`);
					return;
				}
			}
		}
	}
}

// ── 9b. de balustradesprong ────────────────────────────────────────────────

/**
 * De sprong over de atriumbalustrade naar de fontein, nagerekend met de
 * constanten waar Controls zelf mee integreert.
 *
 * Die sprong hing aan een afzet van 4,75 m/s, een boog van 1,15 m waar geen mens
 * bij komt. Met een menselijke 0,46 m kom je van het dek niet meer over een
 * balustrade van 1,1 m, en daar staat de plantenbak voor. Vier dingen moeten
 * daarvoor tegelijk waar blijven en ze staan in vier bestanden: elke optrede past
 * binnen één sprong, vanaf de bakrand kom je boven de handrail uit, elke sprong
 * landt ook echt op de trede waar hij voor bedoeld is, en de laatste eindigt op de
 * begane grond.
 */
function controleBalustradesprong(): void {
	const bak = atriumPlanterTiers().find((tier) => tier.id === 'planter');
	const bank = atriumPlanterTiers().find((tier) => tier.id === 'bench');
	if (!bak || !bank) {
		fout('balustradesprong', 'de plantenbak bij de vide heeft geen bak- of zitrand meer');
		return;
	}

	for (const [van, naar] of [
		[V1, bank.topY],
		[bank.topY, bak.topY],
	] as const) {
		const opstap = span(van, naar);
		if (opstap > JUMP_RISE + EPS) {
			fout(
				'balustradesprong',
				`de opstap van ${nr(van)} naar ${nr(naar)} is ${nr(opstap)} m en een sprong haalt ${nr(JUMP_RISE)} m`,
			);
		}
	}

	const top = bak.topY + JUMP_RISE;
	if (top < ATRIUM_BALUSTRADE_TOP_Y) {
		fout(
			'balustradesprong',
			`vanaf de bakrand kom je tot ${nr(top)} en de handrail ligt op ${nr(ATRIUM_BALUSTRADE_TOP_Y)}: je springt er dwars doorheen`,
		);
	}

	// De hele klim, trede voor trede, met de integrator van Controls. Elke sprong
	// begint waar de vorige trede je neerzet.
	const z = ATRIUM_PLANTER_SPEC.centerZ;
	for (const klim of [
		{ vanX: bank.maxX + PLAYER_RADIUS, vanY: V1, naarY: bank.topY },
		{ vanX: bank.standMinX, vanY: bank.topY, naarY: bak.topY },
	]) {
		const landing = sprongNaarDeVide(klim.vanX, z, klim.vanY);
		if (!bijna(landing.y, klim.naarY, 1e-3)) {
			fout(
				'balustradesprong',
				`vanaf x ${nr(klim.vanX)} op ${nr(klim.vanY)} kom je lopend op ${nr(landing.y)} terecht in plaats van op de trede van ${nr(klim.naarY)}`,
			);
			return;
		}
	}

	// Boven het gat is de vloer de begane grond en ernaast de plaat van V1, dus de
	// landingshoogte zegt in één getal of je erdoor of ernaast bent gekomen.
	const landing = sprongNaarDeVide(bak.standMinX, z, bak.topY);
	if (!bijna(landing.y, V0, 1e-3)) {
		fout(
			'balustradesprong',
			`de sprong strandt op x ${nr(landing.x)} op hoogte ${nr(landing.y)} in plaats van door het gat op de begane grond (${nr(V0)})`,
		);
	}
}

/**
 * Eén sprong richting de vide, per frame geïntegreerd zoals Controls dat doet:
 * horizontaal eerst en door de collision heen, dan de grond opvragen op de
 * hoogte van vóór de val, dan vallen.
 *
 * Lopend en zonder de afzetduw, want dat is het traagste dat een speler op gang
 * kan hebben. Haalt die het, dan halen rennen en springen het ook.
 */
function sprongNaarDeVide(startX: number, z: number, startY: number): { x: number; y: number } {
	const dt = 1 / 60;
	const stappen = 600;
	let x = startX;
	let feetY = startY;
	let vy = JUMP_V;
	for (let stap = 0; stap < stappen; stap++) {
		const los = wereld.resolveCircle(x - WALK_SPEED * dt, z, feetY, PLAYER_RADIUS, 3, true, true, false);
		x = los.x;
		const grond = wereld.groundHeightAt(x, z, feetY, AIR_STEP);
		vy -= GRAVITY * dt;
		feetY += vy * dt;
		if (feetY <= grond) return { x, y: grond };
	}
	return { x, y: feetY };
}

// ── 9c. de crouch-jump ──────────────────────────────────────────────────────

/** Halve zijde van de proefrichel; ruim een lichaam breed zodat de aanloop er niet omheen valt. */
const CROUCH_RICHEL_HALF = 1.6;

/** Kerbdikte onder het loopvlak, zoals de catwalk en de plantenbak die aanhouden. */
const CROUCH_RICHEL_KERB_LIP = 0.04;

/**
 * Tussenhoogte (m boven V0) waarop de proefrichel staat: boven wat een staande sprong
 * haalt en onder wat een gehurkte haalt. Trek CROUCH_LEG_TUCK naar nul en de gehurkte
 * grens zakt op de staande, waarna de tweede eis hieronder omvalt: dit is waar het
 * verschil tussen de twee profielen iets doet dat je kunt aflopen.
 */
const CROUCH_RICHEL_HOOGTE = 0.75;

/**
 * Eén sprong voorwaarts naar een richel, per frame geïntegreerd zoals Controls: horizontaal
 * met de airborne resolveCircle, dan de grond, dan de val. `crouchInAir` trekt na de afzet de
 * benen in (stance loopt met `ease` naar 1), zodat de onderkant van het lichaam
 * CROUCH_LEG_TUCK hoger meetelt en over een kerb komt die staand net te hoog is.
 */
function sprongOpRichel(kruipwereld: CollisionWorld, startX: number, z: number, crouchInAir: boolean): number {
	const dt = 1 / 60;
	let x = startX;
	let feetY = V0;
	let vy = JUMP_V;
	let stance = 0;
	for (let stap = 0; stap < 600; stap++) {
		const doel = crouchInAir ? 1 : 0;
		const eased = ease(stance, doel, CROUCH_RATE, dt);
		stance = Math.abs(doel - eased) < STANCE_SETTLE ? doel : eased;
		const lift = stance * CROUCH_LEG_TUCK;
		const los = kruipwereld.resolveCircle(x + WALK_SPEED * dt, z, feetY + lift, PLAYER_RADIUS, 3, true, true, false);
		x = los.x;
		const grond = kruipwereld.groundHeightAt(x, z, feetY + lift, AIR_STEP);
		vy -= GRAVITY * dt;
		feetY += vy * dt;
		if (feetY <= grond) return grond;
	}
	return feetY;
}

/**
 * De crouch-jump, gelopen zoals de speler het loopt.
 *
 * Een richel op tussenhoogte haal je gehurkt-springend wel en staand-springend niet, en
 * dat verschil is precies CROUCH_LEG_TUCK: het stuk lichaam dat op gebogen knieën wegvalt.
 * De richel staat in een eigen wereld, buiten het gebouw, zodat geen controle erna hem
 * tegenkomt.
 */
function controleCrouchsprong(): void {
	const kruipwereld = new CollisionWorld();
	// Schone V0-cel: vlakke dekhoogte en geen doos die de aanloop of de landing wegduwt.
	let plek: { x: number; z: number } | null = null;
	for (let z = -18; z <= 18 && plek === null; z += 2) {
		for (let x = -22; x <= 22; x += 2) {
			if (!bijna(kruipwereld.groundHeightAt(x, z, V0, WALK_STEP), V0)) continue;
			const aanloop = kruipwereld.resolveCircle(x, z, V0, PLAYER_RADIUS, 3, true, false, false);
			if (Math.hypot(aanloop.x - x, aanloop.z - z) > 1e-4) continue;
			if (!bijna(kruipwereld.groundHeightAt(x + 2, z, V0, WALK_STEP), V0)) continue;
			const landing = kruipwereld.resolveCircle(x + 2, z, V0, PLAYER_RADIUS, 3, true, false, false);
			if (Math.hypot(landing.x - (x + 2), landing.z - z) > 1e-4) continue;
			plek = { x, z };
			break;
		}
	}
	if (plek === null) {
		fout('crouchsprong', 'geen schone V0-cel gevonden om de proefrichel op te zetten');
		return;
	}

	const cx = plek.x + 2.4;
	const richelY = V0 + CROUCH_RICHEL_HOOGTE;
	const richel = {
		minX: cx - CROUCH_RICHEL_HALF,
		maxX: cx + CROUCH_RICHEL_HALF,
		minZ: plek.z - CROUCH_RICHEL_HALF,
		maxZ: plek.z + CROUCH_RICHEL_HALF,
		y: richelY,
		label: 'crouchrichel',
	};
	kruipwereld.platforms.push(richel);
	kruipwereld.addBox(richel.minX, richel.maxX, richel.minZ, richel.maxZ, {
		minY: V0 - 0.5,
		maxY: richelY - CROUCH_RICHEL_KERB_LIP,
		label: 'crouchkerb',
	});

	const startX = richel.minX - PLAYER_RADIUS - 0.02;
	const staand = sprongOpRichel(kruipwereld, startX, plek.z, false);
	if (bijna(staand, richelY, 1e-2)) {
		fout(
			'crouchsprong',
			`een staande sprong haalt de richel op ${nr(CROUCH_RICHEL_HOOGTE)} m al (landt op ${nr(staand)}), dus gehurkt bewijst niets`,
		);
	}
	const gehurkt = sprongOpRichel(kruipwereld, startX, plek.z, true);
	if (!bijna(gehurkt, richelY, 1e-2)) {
		fout(
			'crouchsprong',
			`een gehurkte sprong landt op ${nr(gehurkt)} in plaats van bovenop de richel van ${nr(CROUCH_RICHEL_HOOGTE)} m`,
		);
	}
}

// ── 10. winkeldata ─────────────────────────────────────────────────────────

/** De directory tegen de rest: elke winkel heeft een node, een dek en waar. */
function controleWinkeldata(): void {
	const nodes = new Set(NODES.map((n) => n.id));
	const gezien = new Set<string>();
	for (const s of STORES) {
		if (gezien.has(s.id)) fout('winkeldata', `${s.id} staat twee keer in STORES`);
		gezien.add(s.id);
		if (!nodes.has(s.nodeId)) fout('winkeldata', `${s.id} wijst naar node ${s.nodeId}, die niet in de graaf staat`);
	}
	for (const s of shopStores()) {
		if (!getInventory(s.id)) fout('winkeldata', `winkel ${s.id} heeft geen inventaris, dus lege schappen`);
		const levelEntities = entitiesOnLevel(s.level);
		if (!levelEntities.some((entity) => entity.id === `shop-${s.id}` && entity.category === 'shop')) {
			fout('winkeldata', `winkel ${s.id} staat in de directory maar niet als fixture op dek ${s.level}`);
		}
		if (
			!levelEntities.some((entity) => entity.tags.includes('slab') && entity.volumes.some((volume) => volume.role === 'support'))
		) {
			fout('winkeldata', `winkel ${s.id} staat op dek ${s.level}, maar dat dek heeft geen dragende vloer`);
		}
	}
	const afgeleid = levelsContaining('shop');
	if (afgeleid.length === 0) fout('winkeldata', 'het wereldmodel bevat geen enkel dek met shop-fixtures');
}

// ── 11. de geschreven features ─────────────────────────────────────────────

const ENTITEIT_PER_ID = new Map(WORLD_ENTITIES.map((entity) => [entity.id, entity]));

/**
 * Catwalk, toiletten, gebedsruimte, grot, reisbureau en de parkeerschil hebben
 * elk een tijd lang alleen als tekst bestaan: een emoji op een los coördinaat in
 * KioskOverlay en verder niets in het wereldmodel. Nu hebben ze een footprint,
 * en dat mag niet stilletjes terug. Een entiteit zonder volume met omvang, of
 * met `map.visible = false`, tekent net zo min als geen entiteit.
 */
const GESCHREVEN_FEATURES = [
	'main-entrance',
	'catwalk',
	'restrooms',
	'wudu-niche',
	'prayer-room',
	'beard-cave',
	'shop-island_hop',
	'parking-deck',
	'parking-booth',
	'parking-bays',
	'parking-cars',
	'atrium-fountain',
	'info-kiosk',
	'food-court',
	'protest',
	'spaceship',
	'roof-terrace',
	'tiki-bar',
	'roof-furniture',
	'roof-slide',
] as const;

function heeftOmvang(entity: MallWorldEntity): boolean {
	return entity.volumes.some((volume) => {
		const b = geometryBounds(volume.geometry);
		return span(b.minX, b.maxX) > EPS && span(b.minZ, b.maxZ) > EPS && span(b.minY, b.maxY) > EPS;
	});
}

function controleFeatures(): void {
	for (const id of GESCHREVEN_FEATURES) {
		const entity = ENTITEIT_PER_ID.get(id);
		if (!entity) {
			fout('features', `${id} staat niet meer in WORLD_ENTITIES — terug naar een zwevend label`);
			continue;
		}
		if (!heeftOmvang(entity)) fout('features', `${id} heeft geen enkel volume met omvang in x, z én y`);
		if (!entity.map.visible) fout('features', `${id} staat op map.visible = false en valt dus van de plattegrond`);
		if (entity.map.label === undefined || entity.map.label.trim() === '') {
			fout('features', `${id} heeft geen kaartlabel, dus niets om mee te tekenen`);
		}
	}
}

// ── 11b. de wanden waar je tegenaan loopt ──────────────────────────────────

/** Welke collisiondoos van een kamerbouwer bij welk volume van zijn entiteit hoort. */
/**
 * Welke collisiondoos bij welk volume hoort. `entiteit:volume` als het volume bij
 * een andere entiteit staat: de wudu-nis is een eigen entiteit maar wordt door de
 * toiletten gebouwd, en zonder deze regel had die bank helemaal geen doos gehad.
 */
const KAMERWANDEN: Record<string, Record<string, string>> = {
	restrooms: {
		wc_wall_w: 'wall-west',
		wc_wall_e: 'wall-east',
		wc_wall_s: 'wall-south',
		wc_divider: 'divider',
		wc_wudu_bench: 'wudu-niche:bench',
	},
	'prayer-room': { prayer_back: 'wall-north', prayer_w: 'wall-west', prayer_e: 'wall-east' },
	'beard-cave': { cave_back: 'cave-back-wall', cave_n: 'cave-wall-north', cave_s: 'cave-wall-south' },
};

/** De entiteit en het volume achter zo'n verwijzing, met de kamer zelf als standaard. */
function kamerwandVolume(kamerId: string, verwijzing: string): SpatialVolume | null {
	const scheiding = verwijzing.indexOf(':');
	const entiteitId = scheiding < 0 ? kamerId : verwijzing.slice(0, scheiding);
	const volumeId = scheiding < 0 ? verwijzing : verwijzing.slice(scheiding + 1);
	const entity = ENTITEIT_PER_ID.get(entiteitId);
	return entity?.volumes.find((candidate) => candidate.id === volumeId) ?? null;
}

/**
 * De plattegrond tekent de wanden uit het wereldmodel; de speler botst tegen de
 * dozen uit getColliders(). Die twee stonden tot 30 cm uit elkaar, en de
 * scheidingswand van de toiletten bestond alleen als collisiondoos: een
 * onzichtbare muur van vijf meter dwars door één getekende ruimte.
 */
async function controleKamerwanden(): Promise<void> {
	stubDocument();
	const [THREE, { LightPool }, { Restrooms }, { PrayerRoom }, { BeardCave }] = await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/Restrooms'),
		import('#/scene/PrayerRoom'),
		import('#/scene/BeardCave'),
	]);
	const pool = new LightPool(new THREE.Scene());
	const kamers: [string, { minX: number; maxX: number; minZ: number; maxZ: number; label: string }[]][] = [
		['restrooms', new Restrooms(pool).getColliders()],
		['prayer-room', new PrayerRoom(pool).getColliders()],
		['beard-cave', new BeardCave(pool).getColliders()],
	];

	for (const [entiteitId, colliders] of kamers) {
		const entity = ENTITEIT_PER_ID.get(entiteitId);
		const tabel = KAMERWANDEN[entiteitId];
		if (!entity || !tabel) {
			fout('kamerwanden', `${entiteitId} staat niet meer in WORLD_ENTITIES of in de wandtabel`);
			continue;
		}
		for (const [label, verwijzing] of Object.entries(tabel)) {
			if (!colliders.some((collider) => collider.label === label)) {
				fout('kamerwanden', `${entiteitId} heeft geen collisiondoos '${label}' meer — hernoemd of weggevallen`);
			}
			if (!kamerwandVolume(entiteitId, verwijzing)) {
				fout('kamerwanden', `${entiteitId} heeft geen volume '${verwijzing}' meer voor collisiondoos '${label}'`);
			}
		}
		for (const collider of colliders) {
			const verwijzing = tabel[collider.label];
			if (verwijzing === undefined) {
				fout('kamerwanden', `${entiteitId}: collisiondoos '${collider.label}' hoort bij geen enkel volume`);
				continue;
			}
			const volumeId = verwijzing;
			const volume = kamerwandVolume(entiteitId, verwijzing);
			if (!volume) continue;
			const b = geometryBounds(volume.geometry);
			for (const [naam, doos, model] of [
				['minX', collider.minX, b.minX],
				['maxX', collider.maxX, b.maxX],
				['minZ', collider.minZ, b.minZ],
				['maxZ', collider.maxZ, b.maxZ],
			] as const) {
				if (!bijna(doos, model, 1e-6)) {
					fout(
						'kamerwanden',
						`${entiteitId}.${volumeId}: de collisiondoos ${naam} ${nr(doos)} wijkt af van de getekende wand (${nr(model)})`,
					);
				}
			}
		}
	}
}

// ── 12. elke bestemming heeft geometrie ────────────────────────────────────

/** Waar een directorynaam zijn geometrie vandaan haalt als het geen `shop-${id}` is. */
const STORE_ENTITEIT: Record<string, string> = {
	toilets: 'restrooms',
	prayer: 'prayer-room',
	beard_cave: 'beard-cave',
	helipad: 'helipad-deck',
	secret_stairs: 'secret-stairs',
	elevator: 'glass-elevator',
	parking: 'parking-deck',
	info: 'info-kiosk',
	foodcourt: 'food-court',
	protest: 'protest',
};

/** En waar een knooppuntlabel de zijne vandaan haalt, als geen winkel op dat knooppunt wijst. */
const NODE_ENTITEIT: Record<string, string> = {
	entrance_street: 'main-entrance',
	entrance_hall: 'main-entrance',
	f0_c: 'opening-atrium',
	e0: 'east-escalator',
	e1: 'east-escalator',
	st0: 'west-stairs',
	st1: 'west-stairs',
	elev_fb: 'glass-elevator',
	elev_f1: 'glass-elevator',
	elev_f2: 'glass-elevator',
	sec_mid: 'secret-stairs',
	s_kruidvat: 'shop-kruidvat',
};

const STORE_ZONDER_ENTITEIT: Record<string, string> = {};

const NODE_ZONDER_ENTITEIT: Record<string, string> = {
	f0_ww: 'gangpunt in de westelijke strook, geen bestemming',
	roof_mid: 'padpunt tussen lift en helipad, geen bestemming',
};

/**
 * De invariant die brak. De directory en de graaf noemen plekken; het
 * wereldmodel bouwt ze. Zolang niets die twee tegen elkaar hield konden vijf
 * bestemmingen als naam blijven bestaan zonder dat er ooit iets stond. Een
 * bestemming zonder geometrie mag daarom alleen nog met een reden erbij, en die
 * reden moet weg zodra de geometrie er wél is.
 */
function controleBestemmingen(): void {
	const winkelIds = new Set(STORES.map((s) => s.id));
	const knoopIds = new Set<string>(NODES.map((n) => n.id));
	const knopen: readonly GraphNode[] = NODES;

	for (const [id, doel] of Object.entries(STORE_ENTITEIT)) {
		if (!winkelIds.has(id)) fout('bestemmingen', `STORE_ENTITEIT noemt winkel ${id}, die niet in STORES staat`);
		if (!ENTITEIT_PER_ID.has(doel))
			fout('bestemmingen', `STORE_ENTITEIT wijst ${id} naar ${doel}, die niet in WORLD_ENTITIES staat`);
	}
	for (const [id, doel] of Object.entries(NODE_ENTITEIT)) {
		if (!knoopIds.has(id)) fout('bestemmingen', `NODE_ENTITEIT noemt knooppunt ${id}, dat niet in de graaf staat`);
		if (!ENTITEIT_PER_ID.has(doel))
			fout('bestemmingen', `NODE_ENTITEIT wijst ${id} naar ${doel}, die niet in WORLD_ENTITIES staat`);
	}
	for (const id of Object.keys(STORE_ZONDER_ENTITEIT)) {
		if (!winkelIds.has(id)) fout('bestemmingen', `vrijstelling voor winkel ${id}, die niet in STORES staat`);
	}
	for (const id of Object.keys(NODE_ZONDER_ENTITEIT)) {
		if (!knoopIds.has(id)) fout('bestemmingen', `vrijstelling voor knooppunt ${id}, dat niet in de graaf staat`);
	}

	for (const s of STORES) {
		const doel = STORE_ENTITEIT[s.id] ?? `shop-${s.id}`;
		const bestaat = ENTITEIT_PER_ID.has(doel);
		const reden = STORE_ZONDER_ENTITEIT[s.id];
		if (reden === undefined) {
			if (!bestaat) {
				fout('bestemmingen', `${s.id} staat in de directory maar heeft geen entiteit ${doel}: hij bestaat alleen als tekst`);
			}
		} else if (bestaat) {
			fout('bestemmingen', `${s.id} is vrijgesteld ("${reden}") maar heeft nu ${doel} — haal de vrijstelling weg`);
		}
	}

	const winkelPerKnoop = new Map(STORES.map((s) => [String(s.nodeId), s.id]));
	for (const knoop of knopen) {
		if (knoop.label === undefined) continue;
		const viaWinkel = winkelPerKnoop.get(knoop.id);
		const doel = NODE_ENTITEIT[knoop.id];
		const reden = NODE_ZONDER_ENTITEIT[knoop.id];
		const plek = `knooppunt ${knoop.id} ("${knoop.label}")`;
		if ([viaWinkel, doel, reden].filter((waarde) => waarde !== undefined).length > 1) {
			fout('bestemmingen', `${plek} staat in meer dan één tabel; laat één bron zijn geometrie aanwijzen`);
			continue;
		}
		if (viaWinkel !== undefined || doel !== undefined || reden !== undefined) continue;
		fout('bestemmingen', `${plek} noemt een plek zonder entiteit: geef hem geometrie of zet hem in NODE_ZONDER_ENTITEIT`);
	}
}

// ── 13. de kiosk tekent geen eigen wereld ──────────────────────────────────

/** Canvasaanroepen waarvan de eerste twee argumenten in de wereldtekenaars meters zijn. */
const CANVAS_PLAATSING = /\bctx\.(fillRect|strokeRect|rect|arc|ellipse|moveTo|lineTo|translate)\(/g;
/** De wereld→scherm-helpers van de grote plattegrond: hun argument is een meter. */
const SCHERMPROJECTIE = /\b(sx|sy)\(/g;
/** Een kaartmarkering op een handgeschreven coördinaat: `{ x: …, z: …, level: … }`. */
const MARKERING = /\{[^{}]*\bx:\s*(-?\d+(?:\.\d+)?)\s*,\s*z:\s*(-?\d+(?:\.\d+)?)\s*,\s*level:/g;
const LOS_GETAL = /^-?\d+(?:\.\d+)?$/;

/**
 * Zoals check-lights `new PointLight` uit de bron weert. Een los getal in een
 * canvasaanroep binnen de wereldtekenaars is een coördinaat in meters, en dus
 * een tweede kopie van een maat die al ergens in `data/` staat. Zo tekende de
 * kiosk vijf features op posities die niemand met de scene meebewoog.
 *
 * De controle kijkt alleen naar de argumenten die een plek aanwijzen. Straal,
 * breedte, hoek en lijndikte staan er los van: `arc(t.x, t.z, 2.4, …)` mag,
 * `arc(0, 10, 1.1, …)` niet. Buiten `paintWorld` en `paintRoofLayer` rekent het
 * canvas in schermpixels en wordt er niets getoetst.
 */
function controleKioskCoordinaten(): void {
	const tekst = bron('ui/KioskOverlay.ts');

	for (const naam of ['paintWorld', 'paintRoofLayer']) {
		const body = methodeBody(tekst, naam);
		for (const aanroep of aanroepArgumenten(body, CANVAS_PLAATSING)) {
			const plaats = aanroep.args.slice(0, 2).filter((arg) => LOS_GETAL.test(arg));
			if (plaats.length === 0) continue;
			fout(
				'kioskcoordinaten',
				`${naam}: ctx.${aanroep.naam}(${aanroep.args.join(', ')}) plaatst op losse meters ${plaats.join(', ')} — lees ze uit data/`,
			);
		}
	}

	for (const aanroep of aanroepArgumenten(tekst, SCHERMPROJECTIE)) {
		const arg = aanroep.args[0];
		if (arg === undefined || !LOS_GETAL.test(arg)) continue;
		fout('kioskcoordinaten', `${aanroep.naam}(${arg}) projecteert een los coördinaat naar het scherm — lees het uit data/`);
	}

	for (const treffer of tekst.matchAll(MARKERING)) {
		fout('kioskcoordinaten', `kaartmarkering op losse coördinaat (${treffer[1]}, ${treffer[2]}) — leid hem af uit zijn entiteit`);
	}
}

// ── 13b. niets steekt door de buitengevel ──────────────────────────────────

/**
 * In de wanddikte zitten mag: een grot die in de westmuur is uitgehold hoort daar,
 * en zo'n volume verklaart zijn diepte met `penetration`. Erbuiten uitkomen mag
 * niet, en dat is wat hier gemeten wordt: de buitenste omhullende van de
 * wall-entiteiten, en elk blokkerend volume dat er per zijde uit steekt. De vorige
 * versie mat de overlap met de wand zelf en keurde daarmee juist het toegestane af.
 *
 * Sommige dingen horen er wél buiten te staan: de kolommen onder de luifel van de
 * hoofdingang staan op de stoep, en de parkeeruitrit loopt met zijn geul tien meter
 * de stad in. Die verklaren dat met `protrusion`, het spiegelbeeld van `penetration`,
 * en dan is de vraag niet meer óf een volume buiten de gevel komt maar of het verder
 * komt dan het zelf heeft opgegeven. Een verklaring die nergens meer uitsteekt is zelf
 * een fout, net als een ongebruikte rij in de uitzonderingstabellen verderop: anders
 * blijft er een vergunning liggen voor geometrie die allang terug naar binnen is
 * geschoven.
 *
 * Er is geen entiteit meer die de meting overslaat. De uitrit had een blanco
 * vrijstelling op zijn tag, zonder diepte, dus reikten de keermuren negen en een halve
 * meter voorbij de gevel met `protrusion` op null en niets dat het opmat.
 *
 * Gemeten wordt élk gebouwd volume en niet alleen elk blokkerend volume. Wat je
 * ziet is wat over de erfgrens komt, en of er een lichaam op stuit is een andere
 * vraag: de luifel van de hoofdingang steekt vier meter de stoep op met
 * `blocksMovement` uit, en op de oude regel telde die niet mee. Vrijloop en
 * aanwezigheidsvlakken blijven erbuiten — die horen juist voorbij hun geometrie te
 * reiken, dat is waar ze voor zijn.
 */
const GEVEL_MARGE = PROTRUSION_MARGIN;
/** Rollen die staand materiaal zijn. Al het andere is vrijloop, trigger of verf. */
const GEVEL_GEBOUWD: readonly SpatialRole[] = ['solid', 'walkable', 'support'];

/** De vier zijden zoals de melding ze noemt, naast de naam die een volume opgeeft. */
const GEVELZIJDEN = [
	{ kant: 'west', naam: 'west' },
	{ kant: 'east', naam: 'oost' },
	{ kant: 'north', naam: 'noord' },
	{ kant: 'south', naam: 'zuid' },
] as const satisfies readonly { kant: CardinalSide; naam: string }[];

/** Raakt deze doos het grondvlak van dit gebouw? */
function opGebouw(plan: Vlak, b: Vlak): boolean {
	return b.minX <= plan.maxX && b.maxX >= plan.minX && b.minZ <= plan.maxZ && b.maxZ >= plan.minZ;
}

/**
 * Het gebouw waar deze entiteit bij hoort.
 *
 * Er stond er één, dus was de vraag nooit gesteld en mat de controle alles tegen
 * de omhullende van de mall. Met het theater erbij is dat een gevel op vijftig
 * meter afstand: elke zaalwand stak er per definitie voorbij. Wie geen enkel
 * grondvlak raakt houdt de mall, want dat is wat de uitritgeul en de luifel
 * altijd al deden.
 */
function gebouwVan(entity: (typeof WORLD_ENTITIES)[number]): (typeof ZONE_ENCLOSURES)[number] {
	const mall = at(ZONE_ENCLOSURES, 0);
	const geraakt = ZONE_ENCLOSURES.filter((gebouw) =>
		entity.volumes.some((volume) => opGebouw(gebouw.plan, geometryBounds(volume.geometry))),
	);
	if (geraakt.length > 1) {
		fout(
			'gevel',
			`${entity.id} staat in ${geraakt.map((gebouw) => gebouw.id).join(' en ')} tegelijk; twee gebouwen delen geen vloer`,
		);
	}
	return geraakt[0] ?? mall;
}

function controleGevel(): void {
	const wanden = WORLD_ENTITIES.filter((entity) => entity.category === 'wall');
	if (wanden.length === 0) {
		fout('gevel', 'geen enkele wall-entiteit in WORLD_ENTITIES — waar is de perimeter?');
		return;
	}
	// Elk gebouw heeft zijn eigen huid, en die huid hoort door zijn eigen
	// wall-entiteiten opgetrokken te worden. De omhullende die de zonegraaf uitdeelt
	// wordt daarom hier nagemeten in plaats van geloofd: staat er een wandkast buiten,
	// dan meet de rest van deze controle tegen een gevel die er niet is.
	const gevels = new Map<string, Vlak>();
	for (const gebouw of ZONE_ENCLOSURES) {
		const eigen = wanden.filter((wand) => gebouwVan(wand).id === gebouw.id);
		if (eigen.length === 0) {
			fout('gevel', `${gebouw.id} heeft geen enkele wall-entiteit, dus dat gebouw heeft geen huid om aan te toetsen`);
			continue;
		}
		const gemeten: Vlak = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
		for (const wand of eigen) {
			for (const volume of wand.volumes) {
				const b = geometryBounds(volume.geometry);
				gemeten.minX = Math.min(gemeten.minX, b.minX);
				gemeten.maxX = Math.max(gemeten.maxX, b.maxX);
				gemeten.minZ = Math.min(gemeten.minZ, b.minZ);
				gemeten.maxZ = Math.max(gemeten.maxZ, b.maxZ);
			}
		}
		if (!Number.isFinite(gemeten.minX) || !Number.isFinite(gemeten.minZ)) {
			fout('gevel', `de wall-entiteiten van ${gebouw.id} hebben geen enkel volume met omvang`);
			continue;
		}
		for (const [as, opgegeven, gebouwd] of [
			['minX', gebouw.envelope.minX, gemeten.minX],
			['maxX', gebouw.envelope.maxX, gemeten.maxX],
			['minZ', gebouw.envelope.minZ, gemeten.minZ],
			['maxZ', gebouw.envelope.maxZ, gemeten.maxZ],
		] as [string, number, number][]) {
			if (bijna(opgegeven, gebouwd, GEVEL_MARGE)) continue;
			fout('gevel', `${gebouw.id} geeft ${as} ${nr(opgegeven)} op terwijl zijn wandkasten op ${nr(gebouwd)} staan`);
		}
		gevels.set(gebouw.id, gemeten);
	}

	const vergunningGebruikt = new Set<string>();
	for (const entity of WORLD_ENTITIES) {
		if (entity.category === 'wall') continue;
		const gevel = gevels.get(gebouwVan(entity).id);
		if (!gevel) continue;
		for (const volume of entity.volumes) {
			if (!volume.blocksMovement && !GEVEL_GEBOUWD.includes(volume.role)) continue;
			const b = geometryBounds(volume.geometry);
			const uitsteek: Record<CardinalSide, number> = {
				west: gevel.minX - b.minX,
				east: b.maxX - gevel.maxX,
				north: gevel.minZ - b.minZ,
				south: b.maxZ - gevel.maxZ,
			};
			for (const { kant, naam } of GEVELZIJDEN) {
				const uit = uitsteek[kant];
				if (uit <= GEVEL_MARGE) continue;
				const vergunning = volume.protrusion;
				if (vergunning?.sides.includes(kant) && uit <= vergunning.depth + GEVEL_MARGE) {
					vergunningGebruikt.add(`${entity.id}.${volume.id}|${kant}`);
					continue;
				}
				const verklaard = vergunning?.sides.includes(kant)
					? `, en verklaart er maar ${nr(vergunning.depth)} m`
					: ' zonder dat aan die zijde te verklaren';
				fout('gevel', `${entity.id}.${volume.id} steekt ${nr(uit)} m voorbij de ${naam}gevel naar buiten${verklaard}`);
			}
		}
	}

	for (const entity of WORLD_ENTITIES) {
		for (const volume of entity.volumes) {
			const vergunning = volume.protrusion;
			if (!vergunning) continue;
			for (const kant of vergunning.sides) {
				if (vergunningGebruikt.has(`${entity.id}.${volume.id}|${kant}`)) continue;
				fout(
					'gevel',
					`${entity.id}.${volume.id} verklaart ${nr(vergunning.depth)} m voorbij de ${kant}gevel maar steekt daar nergens uit; haal de verklaring weg`,
				);
			}
		}
	}
}

// ── 13bb. het buitenwerk: gevelreliëf, daklijstborden en het plein ─────────

/**
 * `controleGevel` meet tegen de omhullende van de vier wandkasten, en die ligt in x
 * dertig centimeter buiten de west- en oostgevel omdat de noord- en zuidkap eroverheen
 * lopen. Een band die daar drie decimeter uitkraagt komt dus nooit voorbij de
 * omhullende en wordt daar niet gezien. Hier wordt gemeten tegen het wandvlak zelf,
 * en tegen de dingen die verder geen enkele andere regel kent: dat elke gevel zijn
 * maatverdeling houdt, dat er niets dwars door de entreetravee loopt, en dat de twee
 * borden op de kroonlijst staan waar ze horen.
 *
 * En het plein: bestrating op de hoogte waar je loopt, met een gat waar de uitritgeul
 * open ligt, en straatmeubilair dat niet in die geul of op het voorplein van de entree
 * belandt.
 */
const BUITENWERK_MARGE = 1e-6;

/** Hoeveel het getekende maaiveld onder het loopvlak mag liggen zonder dat je het ziet. */
const MAAIVELD_SPELING = 0.1;
/** Stap waarmee de grondvraag over het gat in de bestrating wordt afgeprikt. */
const MAAIVELD_STAP = 0.25;

/** De buitenvlakken van de wandstukken per gevel: daar hoort het reliëf tegenaan te staan. */
function wandvlakken(kant: CardinalSide): readonly number[] {
	const uit = CARDINAL_OUTWARD[kant];
	return MALL_WALL_SPECS.filter((wall) => wall.side === kant).map((wall) =>
		uit.x !== 0 ? wall.position.x + uit.x * half(wall.size.width) : wall.position.z + uit.z * half(wall.size.depth),
	);
}

function controleBuitenwerk(): void {
	for (const { kant, naam } of GEVELZIJDEN) {
		const stukken = MALL_FACADE_RELIEF.filter((piece) => piece.side === kant);
		if (!stukken.some((piece) => piece.kind !== 'seam')) {
			fout('buitenwerk', `de ${naam}gevel draagt geen enkele band, dus daar leest hij weer als een kale plaat`);
		}
		if (!stukken.some((piece) => piece.kind === 'seam')) {
			fout('buitenwerk', `de ${naam}gevel draagt geen enkele naad, dus daar heeft hij geen maatverdeling`);
		}
	}

	for (const stuk of [...MALL_FACADE_RELIEF, ...MALL_FACADE_SIGNS]) {
		const uit = CARDINAL_OUTWARD[stuk.side];
		const langsX = uit.x !== 0;
		const binnen = langsX ? (uit.x < 0 ? stuk.maxX : stuk.minX) : uit.z < 0 ? stuk.maxZ : stuk.minZ;
		const diepte = langsX ? span(stuk.minX, stuk.maxX) : span(stuk.minZ, stuk.maxZ);
		const naam = GEVELZIJDEN.find((zijde) => zijde.kant === stuk.side)?.naam ?? stuk.side;
		if (!wandvlakken(stuk.side).some((vlak) => bijna(vlak, binnen, BUITENWERK_MARGE))) {
			fout(
				'buitenwerk',
				`${stuk.id} staat met zijn achterkant op ${nr(binnen)} en dus niet tegen een wandstuk van de ${naam}gevel`,
			);
		}
		if (diepte > FACADE_RELIEF_SPEC.reachBudget + BUITENWERK_MARGE) {
			fout(
				'buitenwerk',
				`${stuk.id} kraagt ${nr(diepte)} m uit voor de ${naam}gevel, meer dan het budget van ${nr(FACADE_RELIEF_SPEC.reachBudget)} m`,
			);
		}
		if (!bijna(diepte, stuk.reach, BUITENWERK_MARGE)) {
			fout('buitenwerk', `${stuk.id} meet ${nr(diepte)} m diep terwijl hij ${nr(stuk.reach)} m opgeeft`);
		}
	}

	// De travee van de hoofdingang is uit de westgevel gesneden; er hoort onder het
	// glas niets dwars doorheen te lopen.
	const glasTop = V0 + ENTRANCE_SPEC.glassTopY;
	for (const stuk of MALL_FACADE_RELIEF) {
		if (stuk.side !== 'west' || stuk.minY >= glasTop - BUITENWERK_MARGE) continue;
		if (stuk.maxZ <= ENTRANCE_PORTAL.minZ + BUITENWERK_MARGE || stuk.minZ >= ENTRANCE_PORTAL.maxZ - BUITENWERK_MARGE) continue;
		fout(
			'buitenwerk',
			`${stuk.id} loopt op hoogte ${nr(stuk.minY)} dwars door de entreetravee (z ${nr(ENTRANCE_PORTAL.minZ)}..${nr(ENTRANCE_PORTAL.maxZ)})`,
		);
	}

	for (const bord of MALL_FACADE_SIGNS) {
		if (!bijna(bord.minY, FACADE_RELIEF_SPEC.cornice.maxY, BUITENWERK_MARGE)) {
			fout(
				'buitenwerk',
				`${bord.id} begint op ${nr(bord.minY)} in plaats van op de kroonlijst (${nr(FACADE_RELIEF_SPEC.cornice.maxY)}); dan hangt hij los van de daklijst`,
			);
		}
		const langsX = CARDINAL_OUTWARD[bord.side].x === 0;
		const bordMin = langsX ? bord.minX : bord.minZ;
		const bordMax = langsX ? bord.maxX : bord.maxZ;
		const stukken = MALL_WALL_SPECS.filter((wall) => wall.side === bord.side);
		const gevelMin = Math.min(
			...stukken.map((wall) => (langsX ? wall.position.x - half(wall.size.width) : wall.position.z - half(wall.size.depth))),
		);
		const gevelMax = Math.max(
			...stukken.map((wall) => (langsX ? wall.position.x + half(wall.size.width) : wall.position.z + half(wall.size.depth))),
		);
		if (bordMin < gevelMin - BUITENWERK_MARGE || bordMax > gevelMax + BUITENWERK_MARGE) {
			fout('buitenwerk', `${bord.id} loopt van ${nr(bordMin)} tot ${nr(bordMax)} en steekt daarmee voorbij zijn eigen gevel`);
		}
	}

	if (PLAZA_TOP_Y >= CITY_GROUND_Y - BUITENWERK_MARGE) {
		fout(
			'buitenwerk',
			`de bestrating ligt op ${nr(PLAZA_TOP_Y)}, gelijk met het loopvlak — dan flikkert hij tegen het voorplein van de entree op`,
		);
	}
	// Het gat in de bestrating moet de hele open geul dekken, anders ligt er een plaat
	// dwars over de helling waar je onderdoor omhoog rijdt.
	for (const muur of PARKING_EXIT_TRENCH_WALLS) {
		if (!muur.openToSky) continue;
		if (
			muur.minX < PLAZA_TRENCH_GAP.minX - BUITENWERK_MARGE ||
			muur.maxX > PLAZA_TRENCH_GAP.maxX + BUITENWERK_MARGE ||
			muur.minZ < PLAZA_TRENCH_GAP.minZ - BUITENWERK_MARGE ||
			muur.maxZ > PLAZA_TRENCH_GAP.maxZ + BUITENWERK_MARGE
		) {
			fout('buitenwerk', `${muur.id} ligt buiten het gat in de bestrating, dus daar is de geul dichtgelegd`);
		}
	}

	const meubilair = plazaStations();
	if (meubilair.length === 0)
		fout('buitenwerk', 'het plein heeft geen enkel stuk straatmeubilair, dus blijft het een hectare grijs');
	const geul = grownRect(PLAZA_TRENCH_GAP, PLAZA_PLAN.keepOut);
	const voorplein = grownRect(PLAZA_ENTRANCE_GAP, PLAZA_PLAN.keepOut);
	for (const plek of meubilair) {
		if (!dekt(PLAZA_OUTER, plek.x, plek.z)) {
			fout('buitenwerk', `straatmeubilair op (${nr(plek.x)}, ${nr(plek.z)}) staat buiten de bestrating, op de ringweg`);
		}
		if (dekt(MALL_WALL_ENVELOPE, plek.x, plek.z)) {
			fout('buitenwerk', `straatmeubilair op (${nr(plek.x)}, ${nr(plek.z)}) staat in het gebouw`);
		}
		if (dekt(geul, plek.x, plek.z)) {
			fout('buitenwerk', `straatmeubilair op (${nr(plek.x)}, ${nr(plek.z)}) staat in de uitritgeul`);
		}
		if (dekt(voorplein, plek.x, plek.z)) {
			fout('buitenwerk', `straatmeubilair op (${nr(plek.x)}, ${nr(plek.z)}) staat op het voorplein van de hoofdingang`);
		}
	}

	controleMaaiveld();
}

/**
 * Het maaiveld buiten de ringweg.
 *
 * De bestrating dekt alleen de ring tussen gevel en weg; daarbuiten lag nog steeds de
 * ene plaat van de mall-bouwer op y −0,5, terwijl collision je op `CITY_GROUND_Y` laat
 * lopen en elke toren, het park, het theaterpodium en het maaiveld-dek van de garage
 * hun voet op 0 hebben. Alles daar stond met een halve meter lucht eronder. Gemeten
 * wordt daarom de hele wereldrand, niet alleen het plein, en of de bouwer zijn eigen
 * plaat nog terugzet.
 */
function controleMaaiveld(): void {
	if (CITY_GROUND_Y - CITY_GROUND_PLANE_Y > MAAIVELD_SPELING) {
		fout(
			'buitenwerk',
			`de maaiveldplaat ligt op ${nr(CITY_GROUND_PLANE_Y)} en dus ${nr(CITY_GROUND_Y - CITY_GROUND_PLANE_Y)} m onder het loopvlak (${nr(CITY_GROUND_Y)}); alles wat erop staat zweeft`,
		);
	}
	if (CITY_GROUND_PLANE_Y >= PLAZA_TOP_Y - BUITENWERK_MARGE) {
		fout(
			'buitenwerk',
			`de maaiveldplaat ligt op ${nr(CITY_GROUND_PLANE_Y)} en komt daarmee tot aan de bestrating (${nr(PLAZA_TOP_Y)}) — die twee flikkeren tegen elkaar op`,
		);
	}
	for (const hoek of [
		[CITY_BOUNDS.minX, CITY_BOUNDS.minZ],
		[CITY_BOUNDS.maxX, CITY_BOUNDS.minZ],
		[CITY_BOUNDS.minX, CITY_BOUNDS.maxZ],
		[CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ],
	] as [number, number][]) {
		if (!dekt(CITY_GROUND_PLAN, hoek[0], hoek[1])) {
			fout(
				'buitenwerk',
				`de maaiveldplaat dekt de wereldhoek (${nr(hoek[0])}, ${nr(hoek[1])}) niet, dus daar kijk je onder de wereld door`,
			);
		}
	}

	// Het gat in de bestrating is ook een gat voor je voeten. De grondvraag buiten de
	// mall gaf overal straatniveau terug, dus liep je over de open geul heen alsof er
	// een plaat lag: zes meter lucht onder je schoenen en de helling die eronderdoor
	// omhoog komt zag je niet. Onderin ligt het loopvlak van de helling, en daar loop
	// je via diezelfde helling weer uit.
	for (let x = PLAZA_TRENCH_GAP.minX + MAAIVELD_STAP; x < PLAZA_TRENCH_GAP.maxX; x += MAAIVELD_STAP) {
		for (const z of [-EXIT_LANE_OFFSET, 0, EXIT_LANE_OFFSET]) {
			const grond = wereld.groundHeightAt(x, z, CITY_GROUND_Y, WALK_STEP);
			const helling = parkingExitRampY(x);
			if (bijna(grond, helling, MAAIVELD_SPELING)) continue;
			fout(
				'buitenwerk',
				`boven de open geul geeft de grond op (${nr(x)}, ${nr(z)}) ${nr(grond)} terwijl de helling daar op ${nr(helling)} ligt; daar loop je over het gat heen`,
			);
			return;
		}
	}

	// En de mall-bouwer legt er geen tweede, lager, overheen. Die plaat was er, was
	// 200 bij 200 en had geen gat voor het gebouw of voor de uitritgeul.
	const bouwer = bron('scene/MallBuilder.ts');
	if (/new THREE\.PlaneGeometry\(\s*\d{3}/.test(bouwer)) {
		fout('buitenwerk', 'MallBuilder legt weer een eigen grondvlak neer; het maaiveld komt uit CityPlaza');
	}
}

// ── 13c. elke winkel houdt zijn pui vrij ───────────────────────────────────

/**
 * De puiregel in `validateSpatialWorld` werkt alleen als er een puiprisma ís, en
 * dat prisma ontstond op één plek: `shopEntity`. ISLAND HOP wordt via
 * `roomEntity` gebouwd en had er daarom als enige van de negentien geen, dus
 * mocht er ongemerkt van alles vóór zijn balie komen te staan.
 */
function controlePuien(): void {
	const winkels = WORLD_ENTITIES.filter((entity) => entity.category === 'shop');
	if (winkels.length === 0) {
		fout('puien', 'geen enkele shop-entiteit in WORLD_ENTITIES');
		return;
	}
	for (const winkel of winkels) {
		if (!winkel.volumes.some((volume) => volume.role === 'storefront-clearance')) {
			fout('puien', `${winkel.id} heeft geen storefront-clearance-volume, dus zijn pui wordt door niets bewaakt`);
		}
		// Dezelfde vorm als hierboven, voor de achterkant: `detached-backing` meet
		// alleen wat de tag draagt, dus een winkel zonder tag stond ongemerkt los van
		// de wand erachter.
		if (!winkel.volumes.some((volume) => volume.tags.includes(ROOM_SHELL_TAG))) {
			fout('puien', `${winkel.id} heeft geen ${ROOM_SHELL_TAG}-volume, dus niets meet na of zijn achterwand de gevel raakt`);
		}
	}
}

/**
 * De buitenroute langs de oost- en westgevel blijft vrij bij winkelachterwanden.
 *
 * De achterwand-collider draaide alleen zijn middelpunt mee en hield zijn breedte
 * altijd op X. Voor de kwartslagwinkels werd dat een onzichtbare dwarswand op Z.
 * Deze drie gemelde poses lopen één meter recht vooruit langs de gevel; elke stap
 * moet zijn gewenste positie houden.
 */
function controleWinkelachterwanden(): void {
	const poses = [
		{ naam: 'GAME MANIA', x: 37.5, z: -0.8, richting: 182 },
		{ naam: 'SAUCY', x: 37.2, z: -10.8, richting: 184 },
		{ naam: 'DOUGLAS', x: -37.2, z: -8.8, richting: 169 },
	] as const;
	for (const pose of poses) {
		const yaw = (pose.richting * Math.PI) / 180;
		const verslag = volgPolylijn(
			[
				[pose.x, pose.z],
				[pose.x - Math.sin(yaw), pose.z - Math.cos(yaw)],
			],
			V0,
		);
		if (verslag.klacht !== null) {
			fout(
				'winkelachterwanden',
				`${pose.naam}: vanaf (${nr(pose.x)}, ${nr(pose.z)}) richting ${pose.richting} graden kun je niet vooruit: ${verslag.klacht}`,
			);
		}
	}
}

// ── 13d. geen auto in een betonnen kolom ───────────────────────────────────

/**
 * De vakken staan om de acht meter een kolom in de weg, en een auto is
 * zichtbare geometrie zonder collider: `blocksMovement` staat op beide uit, dus
 * zag geen enkele plaatsingsregel dat er twee decor-auto's en twee huurauto's
 * 0,35 m in het beton stonden.
 */
function autoVlak(spot: { x: number; z: number; yaw: number }, body: { width: number; length: number }): Vlak {
	return planBounds({
		kind: 'rectangle',
		center: { x: spot.x, z: spot.z },
		width: body.width,
		depth: body.length,
		yaw: spot.yaw,
	});
}

function controleParkeerplekken(): void {
	const autos: [string, Vlak][] = [
		...PARKED_CAR_SPOTS.map((spot, index): [string, Vlak] => [`decorauto ${index + 1}`, autoVlak(spot, PARKED_CAR_SPEC.body)]),
		...RENTAL_CAR_SPOTS.map((spot): [string, Vlak] => [spot.name, autoVlak(spot, RENTAL_CAR_SPEC.body)]),
		// De motoren staan in dezelfde vakkenrij en lopen dus tegen dezelfde kolommen op.
		...PARKED_MOTORCYCLE_SPOTS.map((spot, index): [string, Vlak] => [`motor ${index + 1}`, autoVlak(spot, MOTORCYCLE_SPEC.body)]),
		...RIDEABLE_MOTORCYCLE_SPOTS.map((spot): [string, Vlak] => [spot.name, autoVlak(spot, MOTORCYCLE_SPEC.body)]),
	];
	for (const [naam, vlak] of autos) {
		for (const [index, kolom] of parkingPillarCenters().entries()) {
			const kolomVlak: Vlak = planBounds({
				kind: 'rectangle',
				center: kolom,
				width: PARKING_DECK_SPEC.pillar.width,
				depth: PARKING_DECK_SPEC.pillar.width,
				yaw: 0,
			});
			if (!opKavel(vlak, kolomVlak)) continue;
			fout('parkeerplekken', `${naam} staat in kolom ${index} op (${nr(kolom.x)}, ${nr(kolom.z)})`);
		}
	}
}

// ── 13e. verf loopt om de constructie heen, niet erdoorheen ────────────────

/** Speling voor verf die precies tegen een kolomvoet of tegen het loopvlak aan hoort te liggen. */
const VERF_MARGE = 1e-4;

/**
 * De vakken lopen in stappen van 5,2 m, de pijlen op het middenpad in stappen van
 * 6 m en de kolommen in stappen van 8 m, dus zes vakken en drie pijlen liepen dwars
 * door een kolom heen en verdwenen half in het beton. Geen enkele plaatsingsregel
 * zag het: verf heeft geen collider, en een bedekking mag een constructie bedekken.
 * `parkingPaintPatches` knipt hem om elke kolomvoet heen; hier wordt nagerekend dat
 * er niets doorheen blijft lopen en dat er van elk vak belijning overblijft, want
 * een kolom wegknippen door het vak weg te knippen is dezelfde fout andersom.
 */
function controleParkeerverf(): void {
	const vlakken = parkingPaintPatches();
	if (vlakken.length === 0) {
		fout('parkeerverf', 'er ligt geen streep op het dek; parkingPaintPatches levert niets op');
		return;
	}
	const voeten = parkingPillarFootprints();
	for (const vlak of vlakken) {
		const verf = planBounds({ kind: 'rectangle', center: vlak.center, width: vlak.width, depth: vlak.depth, yaw: 0 });
		for (const voet of voeten) {
			if (span(Math.max(verf.minX, voet.minX), Math.min(verf.maxX, voet.maxX)) <= EPS) continue;
			if (span(Math.max(verf.minZ, voet.minZ), Math.min(verf.maxZ, voet.maxZ)) <= EPS) continue;
			fout(
				'parkeerverf',
				`${vlak.id} loopt door de kolomvoet op (${nr(midpoint(voet.minX, voet.maxX))}, ${nr(midpoint(voet.minZ, voet.maxZ))})`,
			);
		}
	}
	for (const vak of parkingStalls()) {
		if (vlakken.some((vlak) => vlak.id.startsWith(`stall-${vak.id}-`))) continue;
		fout('parkeerverf', `vak ${vak.id} houdt geen belijning over; daar is het vak weggeknipt in plaats van de kolom`);
	}
	if (!vlakken.some((vlak) => vlak.kind === 'lane')) {
		fout('parkeerverf', 'er ligt geen enkele pijl meer op het middenpad, dus wijst niets de weg naar de uitrit');
	}
	controleUitritverf();
}

/**
 * Het pijlvak op de uitrit.
 *
 * Daar lagen vier losse latten twintig centimeter boven een helling die onder ze
 * wegzakte: horizontaal terwijl de helling kantelt, en dwars op de rijrichting. Een
 * vlak dat écht in het hellingvlak ligt heeft op alle vier zijn hoeken dezelfde
 * afstand tot het loopvlak, en dat is `lift` gedeeld door de cosinus van de helling,
 * want die afstand wordt langs de normaal gemeten en verticaal nagerekend.
 */
function controleUitritverf(): void {
	const vak = PARKING_EXIT_CHEVRONS;
	const cos = Math.cos(vak.angle);
	const verwacht = vak.lift / cos;
	for (const langs of [-half(vak.length), half(vak.length)]) {
		for (const dwars of [-half(vak.width), half(vak.width)]) {
			const x = vak.center.x + langs * cos;
			const y = vak.center.y + langs * Math.sin(vak.angle);
			const z = vak.center.z + dwars;
			const gat = y - parkingExitRampY(x);
			if (!bijna(gat, verwacht, VERF_MARGE)) {
				fout(
					'parkeerverf',
					`de hoek van het pijlvak op (${nr(x)}, ${nr(z)}) ligt ${nr(gat)} m boven het loopvlak in plaats van ${nr(verwacht)}; zo hangt hij scheef boven de helling`,
				);
			}
			if (x < PARKING_EXIT_RAMP.end.x - VERF_MARGE || x > PARKING_EXIT_RAMP.start.x + VERF_MARGE) {
				fout(
					'parkeerverf',
					`het pijlvak reikt tot x ${nr(x)} en komt daarmee voorbij de helling (${nr(PARKING_EXIT_RAMP.end.x)}..${nr(PARKING_EXIT_RAMP.start.x)})`,
				);
			}
			if (Math.abs(z) > half(PARKING_EXIT_RAMP.width) + VERF_MARGE) {
				fout('parkeerverf', `het pijlvak reikt tot z ${nr(z)} en ligt daarmee naast de helling`);
			}
		}
	}

	// De mond van de geul blijft open. De twee stadsplaten houden er hun gat voor
	// (zie `buitenwerk`); het voorplein van de hoofdingang legt zijn eigen plaat en
	// hoort daar naast te blijven, anders kijk je op beton in plaats van de helling in.
	if (ENTRANCE_SPEC.forecourt.north < PARKING_EXIT_RAIL_OUTER - VERF_MARGE) {
		fout(
			'parkeerverf',
			`de bestrating van het voorplein begint op z ${nr(ENTRANCE_SPEC.forecourt.north)} en ligt daarmee over de open uitrit (tot z ${nr(PARKING_EXIT_RAIL_OUTER)})`,
		);
	}

	const bouwer = bron('scene/ParkingGarage.ts');
	eist(bouwer, 'PARKING_EXIT_CHEVRONS', 'het pijlvak dat de bouwer op de uitrit legt');
	eist(bouwer, 'parkingPaintPatches(', 'de geknipte belijning die de bouwer op het dek legt');
}

// ── 14. elk dek staat op de plattegrond ────────────────────────────────────

/**
 * P1 bestaat in LEVELS, in de graaf, in de lift en als parkeerdek, maar de
 * grote plattegrond had drie handgeschreven tabbladen en dat was er één te
 * weinig. Een dek dat je kunt belopen en niet kunt opzoeken bestaat voor de
 * speler niet, dus de tabbladen horen uit LEVELS te komen en niet uit een
 * tweede lijst ernaast. Een tabblad met een geschreven dek-id erin is precies
 * die tweede lijst, en dus zelf de fout.
 */
function controleKaartdekken(): void {
	const tekst = bron('ui/KioskOverlay.ts');
	const dekIds = new Set<string>(LEVELS.map((l) => l.id));

	eist(tekst, 'LEVELS_BOTTOM_UP', 'de bron van de tabbladen op de grote plattegrond');
	if (!/for \(const \w+ of LEVELS_BOTTOM_UP\)/.test(tekst)) {
		fout('kaartdekken', 'KioskOverlay loopt niet meer over LEVELS_BOTTOM_UP heen; een nieuw dek krijgt dan geen tabblad');
	}
	for (const treffer of tekst.matchAll(/data-level="([^"]+)"/g)) {
		fout('kaartdekken', `tabblad data-level="${treffer[1]}" is met de hand geschreven; leid het af uit LEVELS`);
	}

	for (const treffer of tekst.matchAll(/\[\s*'[a-z0-9_]+'(?:\s*,\s*'[a-z0-9_]+')*\s*\]/g)) {
		const leden = [...treffer[0].matchAll(/'([a-z0-9_]+)'/g)].map((lid) => lid[1]);
		if (!leden.every((lid) => lid !== undefined && dekIds.has(lid))) continue;
		fout(
			'kaartdekken',
			`KioskOverlay houdt een eigen deklijst bij (${leden.join(', ')}); leid de tabbladen af uit LEVELS zodat er geen dek buiten valt`,
		);
	}
}

// ── 15. de stad buiten de mall ─────────────────────────────────────────────

function opKavel(r: Vlak, k: Vlak): boolean {
	return r.maxX > k.minX && r.minX < k.maxX && r.maxZ > k.minZ && r.minZ < k.maxZ;
}

/** Hoeveel stoep de spiraalprobe neemt voordat hij de onderste plaat op stapt. */
const GARAGE_AANLOOP = 2;

/** Hoe ver het dek op de probe loopt nadat hij door de opening is. */
const GARAGE_DEKSTAP = 1;

/**
 * Van een bordes van de spiraal het dek op waar hij tegenaan ligt.
 *
 * De borstwering liep als een ongebroken ring om elk dek, ook langs de naad waar de
 * spiraal aankomt, dus wie hem helemaal opklom stond voor een muur van een meter en
 * kwam er alleen met een sprong overheen. De controle die er stond prikte de
 * borstwering halverwege een rand af en legde daarmee juist de afsluiting vast.
 */
function controleBordesNaarDek(bordes: GarageDeck): void {
	const dek = GARAGE_DECKS.find((kandidaat) => bijna(kandidaat.y, bordes.y) && bijna(kandidaat.maxX, bordes.minX));
	if (!dek) return;
	const openingen = deckDoorways(dek);
	if (openingen.length === 0) {
		fout('stad', `${bordes.id} ligt tegen ${dek.id} aan zonder opening in de borstwering: alleen een sprong brengt je erop`);
		return;
	}
	for (const opening of openingen) {
		const z = midpoint(opening.minZ, opening.maxZ);
		const bereikt = loopLangsPolylijn(
			'stad',
			`${bordes.id} naar ${dek.id}`,
			[
				[midpoint(bordes.minX, bordes.maxX), z],
				[dek.maxX - GARAGE_DEKSTAP, z],
			],
			bordes.y,
		);
		if (!bijna(bereikt, dek.y, 1e-6)) {
			fout('stad', `vanaf ${bordes.id} kom je op ${nr(bereikt)} uit in plaats van op ${dek.id} (${nr(dek.y)})`);
		}
	}
}

type Punt = readonly [number, number];

/**
 * Eén wandeling langs een polylijn, in dezelfde vorm als de uitrit-probe
 * hieronder: `groundHeightAt` voor de vloer onder je voeten, `resolveCircle`
 * voor wat je tegenhoudt, en geen stap groter dan WALK_STEP. Hij geeft de
 * hoogte terug waar hij aankomt, zodat de aanroeper kan toetsen of dat het dek
 * is dat hij bedoelde.
 */
/**
 * Waar de wandeling bleef, en waarom.
 *
 * `klacht` is null zolang hij doorliep. De ene helft van de wereld wil dat een
 * route lóópt en de andere helft wil dat hij vastloopt — de dichte gevel naast een
 * deur is net zo goed een eis — en die twee kunnen niet allebei op een melding
 * uitkomen. Wie de route wil zien lopen geeft de klacht door aan `fout`; wie hem
 * juist wil zien stranden leest waar hij bleef.
 */
type Wandelverslag = Readonly<{ x: number; z: number; y: number; klacht: string | null }>;

const POLYLIJN_STAP = 0.05;

function volgPolylijn(punten: readonly Punt[], startY: number): Wandelverslag {
	let y = startY;
	const eerste = punten[0];
	let x = eerste ? eerste[0] : 0;
	let z = eerste ? eerste[1] : 0;
	for (let i = 1; i < punten.length; i++) {
		const van = punten[i - 1];
		const naar = punten[i];
		if (!van || !naar) continue;
		const stappen = Math.max(1, Math.ceil(Math.hypot(naar[0] - van[0], naar[1] - van[1]) / POLYLIJN_STAP));
		for (let k = 1; k <= stappen; k++) {
			const t = k / stappen;
			const wensX = lerp(van[0], naar[0], t);
			const wensZ = lerp(van[1], naar[1], t);
			const grond = wereld.groundHeightAt(wensX, wensZ, y, WALK_STEP);
			if (Math.abs(grond - y) > WALK_STEP) {
				return { x, z, y, klacht: `op (${nr(wensX)}, ${nr(wensZ)}) springt de vloer van ${nr(y)} naar ${nr(grond)}` };
			}
			const los = wereld.resolveCircle(wensX, wensZ, grond, PLAYER_RADIUS, 3, true, false, true);
			if (Math.hypot(los.x - wensX, los.z - wensZ) > 1e-4) {
				return {
					x,
					z,
					y,
					klacht: `op (${nr(wensX)}, ${nr(wensZ)}) duwt collision je naar (${nr(los.x)}, ${nr(los.z)})`,
				};
			}
			x = wensX;
			z = wensZ;
			y = grond;
		}
	}
	return { x, z, y, klacht: null };
}

function loopLangsPolylijn(controle: string, wat: string, punten: readonly Punt[], startY: number): number {
	const verslag = volgPolylijn(punten, startY);
	if (verslag.klacht !== null) fout(controle, `${wat}: ${verslag.klacht}`);
	return verslag.y;
}

/**
 * Van het dak de stad in, over de theatertrap, en via de uitrit weer naar de
 * garage. Elke stap hier heeft een blokkade gehad: de voetafdruk-klem hield je
 * op het dak, `groundHeightAt` gaf veertig meter naast het gebouw nog steeds
 * DAK terug, en de buitenschil liep door tot boven het dek. De stad had
 * bovendien helemaal geen collision: torens, theater en garage waren decor.
 */
function controleStad(): void {
	const straal = PLAYER_RADIUS;
	const randX = half(MALL_FOOTPRINT.width);
	const randZ = half(MALL_FOOTPRINT.depth);

	// De skyline hoort uit dezelfde plattegrond te komen als de collision;
	// een eigen generator ernaast zet de torens naast hun doos.
	// Een eigen mulberry32 ernaast zet de torens naast hun doos; die kopie wordt
	// nu voor de hele boom afgevangen door de kopieëngreep verderop.
	const skyline = bron('scene/city/CityBuildings.ts');
	eist(skyline, 'planTowers(rand)', 'de skyline uit de gedeelde stadsplattegrond');

	// Binnen de voetafdruk ligt op dakhoogte een plaat, erbuiten niets.
	for (const [x, z] of [
		[randX - 0.5, 0],
		[-(randX - 0.5), 0],
		[0, randZ - 0.5],
		[0, -(randZ - 0.5)],
	] as [number, number][]) {
		const grond = wereld.groundHeightAt(x, z, DAK, WALK_STEP);
		if (!bijna(grond, DAK)) fout('stad', `dakrand (${nr(x)}, ${nr(z)}): de vloer is ${nr(grond)} in plaats van ${nr(DAK)}`);
	}
	// Naast het dak is er geen schil meer: over de dakrand stappen is de sprong naar
	// de stad, en dat is het punt. Dit geldt ook pal west, boven de mond van de geul.
	const naastHetDak: [number, number][] = [
		[randX + 1.5, 0],
		[-(randX + 1.5), 0],
		[0, randZ + 1.5],
		[0, -(randZ + 1.5)],
	];
	for (const [x, z] of naastHetDak) {
		const los = wereld.resolveCircle(x, z, DAK, straal, 3, true, true, true);
		if (Math.hypot(los.x - x, los.z - z) > EPS) {
			fout('stad', `de buitenschil duwt je op dakhoogte terug bij (${nr(x)}, ${nr(z)}): over de dakrand stappen kan niet`);
		}
	}
	// Wat er onder je ligt is een tweede vraag, en pal west ligt daar de mond van de
	// uitritgeul: de bestrating is daar open tot op de helling zes meter lager, en dat
	// is geen straat om naast het dak te vinden. `controleMaaiveld` toetst dat gat
	// zelf; alleen déze vraag wijkt eromheen, de duwvraag hierboven niet.
	for (const [x, z] of naastHetDak.map(([x, z]): [number, number] =>
		x < 0 && z === 0 ? [x, PLAZA_TRENCH_GAP.maxZ + 1.5] : [x, z],
	)) {
		const grond = wereld.groundHeightAt(x, z, DAK, WALK_STEP);
		if (!bijna(grond, CITY_GROUND_Y)) {
			fout(
				'stad',
				`naast het dak (${nr(x)}, ${nr(z)}): de wereld geeft ${nr(grond)} in plaats van straatniveau — je loopt op lucht`,
			);
		}
	}

	// Elke toren staat er als collision, en geen enkele op een gereserveerd kavel.
	TOWER_SPECS.forEach((t, i) => {
		const los = wereld.resolveCircle(t.x, t.z, CITY_GROUND_Y + 1, straal, 3, true, false, true);
		if (Math.hypot(los.x - t.x, los.z - t.z) <= EPS) {
			fout('stad', `toren ${i} op (${nr(t.x)}, ${nr(t.z)}) heeft geen collision — je loopt er dwars doorheen`);
		}
		const vlak: Vlak = planBounds({ kind: 'rectangle', center: { x: t.x, z: t.z }, width: t.w, depth: t.d, yaw: 0 });
		for (const [naam, kavel] of Object.entries(CITY_KAVELS)) {
			if (opKavel(vlak, kavel)) fout('stad', `toren ${i} staat op het ${naam}-kavel`);
		}
	});

	// De gebouwen blijven binnen hun kavel; anders bouwt de skyline er alsnog overheen.
	for (const [wat, vlak, naam] of [
		['het zaalblok', THEATRE_PLAN.hall, 'theatre'],
		['het theaterpodium', THEATRE_PLAN.podium, 'theatre'],
		['de parkeergarage', GARAGE_PLAN.footprint, 'garage'],
		['de buitenspiraal van de garage', GARAGE_RAMP_FOOTPRINT, 'garage'],
	] as [string, Vlak, keyof typeof CITY_KAVELS][]) {
		const kavel = CITY_KAVELS[naam];
		if (vlak.minX < kavel.minX || vlak.maxX > kavel.maxX || vlak.minZ < kavel.minZ || vlak.maxZ > kavel.maxZ) {
			fout('stad', `${wat} ligt buiten het ${naam}-kavel`);
		}
	}

	// Geen stadsdek binnen de mall: dat zou dwars door een verdiepingsvloer liggen.
	for (const s of wereld.citySurfaces) {
		for (const [x, z] of [
			[s.minX, s.minZ],
			[s.maxX, s.maxZ],
		] as [number, number][]) {
			if (wereld.insideMallPlan(x, z)) fout('stad', `stadsdek ${s.label} steekt met (${nr(x)}, ${nr(z)}) de mall in`);
		}
	}

	// De theatertrap, tree voor tree zoals je hem oploopt.
	const trap = THEATRE_PLAN.stair;
	const trapX = midpoint(trap.minX, trap.maxX);
	const zVanaf = trap.zTop + trap.treads * trap.tread + 0.5;
	const zTot = THEATRE_PLAN.podium.maxZ - 1;
	let trapY = CITY_GROUND_Y;
	for (let z = zVanaf; z >= zTot; z -= 0.05) {
		const grond = wereld.groundHeightAt(trapX, z, trapY, WALK_STEP);
		if (grond - trapY > WALK_STEP) {
			fout('stad', `theatertrap: op z ${nr(z)} is de volgende tree ${nr(grond - trapY)} m hoog, meer dan één stap`);
			break;
		}
		const los = wereld.resolveCircle(trapX, z, grond, straal, 3, true, false, true);
		if (Math.hypot(los.x - trapX, los.z - z) > 1e-4) {
			fout('stad', `theatertrap: op z ${nr(z)} duwt collision je naar (${nr(los.x)}, ${nr(los.z)})`);
			break;
		}
		trapY = grond;
	}
	if (!bijna(trapY, THEATRE_PLAN.podiumY, 1e-6)) {
		fout('stad', `de theatertrap eindigt op ${nr(trapY)} in plaats van op het podium (${nr(THEATRE_PLAN.podiumY)})`);
	}

	// Het maaiveld-dek van de garage is open aan alle zijden: daar loop je zo op.
	for (const [x, z] of [
		[66, 51],
		[76, 59],
	] as [number, number][]) {
		const grond = wereld.groundHeightAt(x, z, CITY_GROUND_Y, WALK_STEP);
		if (!bijna(grond, GARAGE_PLAN.groundDeckY)) {
			fout('stad', `garagedek (${nr(x)}, ${nr(z)}): de vloer is ${nr(grond)} in plaats van ${nr(GARAGE_PLAN.groundDeckY)}`);
		}
		const los = wereld.resolveCircle(x, z, grond, straal, 3, true, false, true);
		if (Math.hypot(los.x - x, los.z - z) > EPS) fout('stad', `garagedek (${nr(x)}, ${nr(z)}): collision duwt je van het dek`);
	}

	// De buitenspiraal om de ZO-hoek: van de stoep bij de zuidplaat, over het
	// hoekbordes en de oostplaat omhoog, tot het bordes op dek 2. De platen waren
	// decor — vlakke citySurfaces kunnen geen helling zijn, dus je liep er dwars
	// doorheen naar het maaiveld.
	const zuidplaat = GARAGE_RAMP_RUNS[0];
	const oostplaat = GARAGE_RAMP_RUNS[1];
	const bovenbordes = GARAGE_RAMP_LANDINGS[1];
	if (!zuidplaat || !oostplaat || !bovenbordes) {
		fout('stad', 'de garagespiraal heeft geen twee schuine platen en twee bordessen meer');
	} else {
		const spiraalY = loopLangsPolylijn(
			'stad',
			'garagespiraal',
			[
				[zuidplaat.start.x - GARAGE_AANLOOP, zuidplaat.start.z],
				[zuidplaat.end.x, zuidplaat.end.z],
				[oostplaat.start.x, zuidplaat.end.z],
				[oostplaat.start.x, midpoint(bovenbordes.minZ, bovenbordes.maxZ)],
			],
			CITY_GROUND_Y,
		);
		if (!bijna(spiraalY, bovenbordes.y, 1e-6)) {
			fout('stad', `de garagespiraal eindigt op ${nr(spiraalY)} in plaats van op het bordes van dek 2 (${nr(bovenbordes.y)})`);
		}
	}

	for (const bordes of GARAGE_RAMP_LANDINGS) controleBordesNaarDek(bordes);

	// Elk parkeerdek is loopvlak zodra je erop staat, en de borstwering eromheen
	// duwt je terug het dek op in plaats van eraf.
	for (const dek of GARAGE_DECKS) {
		const x = midpoint(dek.minX, dek.maxX);
		const grond = wereld.groundHeightAt(x, midpoint(dek.minZ, dek.maxZ), dek.y, WALK_STEP);
		if (!bijna(grond, dek.y)) fout('stad', `${dek.id}: de vloer is ${nr(grond)} in plaats van ${nr(dek.y)}`);
		const rand = dek.maxZ - half(GARAGE_PLAN.parapet.thickness);
		const los = wereld.resolveCircle(x, rand, dek.y, straal, 3, true, false, true);
		if (los.z >= rand) fout('stad', `${dek.id}: de borstwering op z ${nr(dek.maxZ)} houdt je niet tegen`);
	}

	// Vanaf de stoep de uitrit in. Geen stap groter dan WALK_STEP, en niets dat de
	// doorgang dichtduwt. Dit was de enige weg terug naar binnen; sinds de hoofdingang
	// er staat is het de tweede, en `controleDaklus` loopt die.
	let uitritY = CITY_GROUND_Y;
	const uitritZ = PARKING_EXIT_RAMP.start.z;
	for (let x = -52; x <= PARKING_EXIT_RAMP.start.x; x += 0.05) {
		const grond = wereld.groundHeightAt(x, uitritZ, uitritY, WALK_STEP);
		if (Math.abs(grond - uitritY) > WALK_STEP) {
			fout('stad', `uitrit vanaf de straat: op x ${nr(x)} springt de vloer van ${nr(uitritY)} naar ${nr(grond)}`);
			break;
		}
		const los = wereld.resolveCircle(x, uitritZ, grond, straal, 3, true, false, true);
		if (Math.hypot(los.x - x, los.z - uitritZ) > 1e-4) {
			fout('stad', `uitrit vanaf de straat: op x ${nr(x)} duwt collision je naar (${nr(los.x)}, ${nr(los.z)})`);
			break;
		}
		uitritY = grond;
	}
	if (!bijna(uitritY, PARKING_EXIT_RAMP.start.y, 1e-3)) {
		fout('stad', `de uitrit eindigt op ${nr(uitritY)} in plaats van op de parkeervloer (${nr(PARKING_EXIT_RAMP.start.y)})`);
	}

	// De vrijstelling is per aanroep. Zonder hem staat de sim nog steeds binnen
	// de voetafdruk; ging hij via `boundsMode`, dan liep de hele mall naar buiten.
	const sim = wereld.resolveCircle(51.5, 0, 0.5, 0.35, 3, false, false, false);
	if (Math.abs(sim.x) > randX || Math.abs(sim.z) > randZ) {
		fout('stad', `een sim zonder de outside-vlag komt tot (${nr(sim.x)}, ${nr(sim.z)}), buiten de voetafdruk`);
	}
	const speler = wereld.resolveCircle(51.5, 0, 0.5, straal, 3, true, false, true);
	if (Math.hypot(speler.x - 51.5, speler.z) > EPS) {
		fout('stad', `de speler wordt mét de outside-vlag alsnog naar (${nr(speler.x)}, ${nr(speler.z)}) geklemd`);
	}
}

// ── 15b. de ringweg ────────────────────────────────────────────────────────

/**
 * Twee rijstroken, tegen elkaar in, allebei rechts houdend, met een eigen hoektegel.
 *
 * Het tweerichtingsverkeer, de strookverspringing en de hoektegels zijn met
 * wegwerpscripts nagelopen en die scripts zijn daarna weggegooid, dus stond er niets
 * meer achter dan het lezen van de code. Rechts houden is hier één som: het hart van
 * een strook ligt aan de rechterkant van de rijrichting, gemeten vanaf de middellijn
 * van de rijbaan. Bij een omgeklapt teken rijdt een halve stad tegen de richting in,
 * en van bovenaf zie je dat niet.
 */
function controleWegen(): void {
	if (ROAD_RINGS.length !== 2) {
		fout('wegen', `de ringweg heeft ${ROAD_RINGS.length} rijstroken in plaats van twee, dus er is geen tegenrichting`);
		return;
	}
	if (new Set(ROAD_RINGS.map((strook) => strook.turn)).size !== ROAD_RINGS.length) {
		fout('wegen', 'beide rijstroken draaien dezelfde kant op, dus het is eenrichtingsverkeer over twee banen');
	}
	if (!bijna(LANE_OFFSET * 4, ROAD_PLAN.width)) {
		fout(
			'wegen',
			`de strookverspringing is ${nr(LANE_OFFSET)} m en past niet vier keer in de rijbaan van ${nr(ROAD_PLAN.width)} m`,
		);
	}

	for (const strook of ROAD_RINGS) {
		if (strook.edges.length !== 4) {
			fout('wegen', `de strook met draaiing ${strook.turn} heeft ${strook.edges.length} randen in plaats van vier`);
			continue;
		}
		for (const [index, rand] of strook.edges.entries()) {
			const langsX = rand.dz === 0;
			const hart = langsX ? rand.oz : rand.ox;
			const middellijn = Math.sign(hart) * (langsX ? LANE_Z : LANE_X);
			const opzij = hart - middellijn;
			// Rechts van de rijrichting is (−dz, dx). De strook hoort daar te liggen.
			const rechts = langsX ? opzij * rand.dx : opzij * -rand.dz;
			if (rechts <= 0) {
				fout(
					'wegen',
					`strook ${strook.turn}, rand ${index} rijdt richting (${nr(rand.dx)}, ${nr(rand.dz)}) en ligt ${nr(Math.abs(opzij))} m links van de middellijn: die rijdt tegen de richting in`,
				);
			}
			if (!bijna(Math.abs(opzij), LANE_OFFSET, 1e-9)) {
				fout(
					'wegen',
					`strook ${strook.turn}, rand ${index} ligt ${nr(Math.abs(opzij))} m naast de middellijn in plaats van ${nr(LANE_OFFSET)}`,
				);
			}
			if (!bijna(Math.cos(rand.rotY), rand.dx, 1e-9) || !bijna(Math.sin(rand.rotY), -rand.dz, 1e-9)) {
				fout(
					'wegen',
					`strook ${strook.turn}, rand ${index} draait de neus naar ${nr(rand.rotY)} rad, wat niet de rijrichting is`,
				);
			}
			if (rand.phase !== (langsX ? 'ns' : 'ew')) {
				fout(
					'wegen',
					`strook ${strook.turn}, rand ${index} luistert naar fase '${rand.phase}' terwijl hij langs ${langsX ? 'x' : 'z'} loopt`,
				);
			}
		}
	}

	// De hoeken zijn een eigen tegel omdat de middenstreep er een kwartslag meedraait,
	// en de rechte stroken houden bij die tegels op.
	const asfalt = bron('scene/city/CityRoads.ts');
	eist(asfalt, 'this.makeCornerTexture()', 'de eigen hoektegel van de ringweg');
	eist(asfalt, 'const EW_LEN = 2 * ROAD_INNER_X', 'oost-weststroken die bij de hoektegels ophouden');
	eist(asfalt, 'const NS_LEN = 2 * ROAD_INNER_Z', 'noord-zuidstroken die bij de hoektegels ophouden');
	eist(asfalt, 'roadPaintPatches()', 'alle wegmarkering als losse rechthoeken uit het wegenplan');

	// Alle wegmarkering staat als losse rechthoekjes met de zebrapaden eruit gesneden, net als
	// de garagebelijning om de kolomvoeten. Een streep die een oversteek kruist tekent een
	// doorlopende lijn over de zebra: de middenstreep een plus door het midden, de kantstreep
	// een balk dwars over de balkeinden. Dit bijt over élke markering tegen élke oversteek.
	const zebras = ROAD_CROSSINGS.map(zebraBounds);
	for (const { kind, rect } of roadPaintPatches()) {
		for (const zebra of zebras) {
			if (vlakkenOverlappen(rect, zebra)) {
				const soort = kind === 'dash' ? 'middenstreep' : 'kantstreep';
				fout(
					'wegen',
					`een streep van de ${soort} bij (${nr(midpoint(rect.minX, rect.maxX))}, ${nr(midpoint(rect.minZ, rect.maxZ))}) loopt door een zebrapad heen`,
				);
			}
		}
	}

	controleRijders();
	controleAftakking();
}

/**
 * De motorrijders op de ring.
 *
 * De volgafstanden en de botsstraal van het stadsverkeer waren drie losse getallen
 * met de lengte van een auto erin verwerkt, dus een smaller voertuig kon er alleen bij
 * door ze te kopiëren, en een kopie die niet meeschuift is precies hoe een motor met
 * de volgafstand van een auto op de ring belandt. Ze worden nu per carrosserie
 * gerekend en hier tegen de rijbaan en tegen elkaar nagelopen: dat elk profiel binnen
 * zijn eigen strook past, dat een stilstaande rij niet in zichzelf schuift, dat de
 * motor werkelijk korter volgt dan de auto en niet andersom, en dat er in beide
 * richtingen een rijdt. Alle vier zijn ze onzichtbaar van bovenaf.
 */
function controleRijders(): void {
	const profielen = Object.entries(TRAFFIC_PROFILES);
	for (const [soort, profiel] of profielen) {
		if (half(profiel.width) > LANE_OFFSET + EPS) {
			fout(
				'wegen',
				`een ${soort} is ${nr(profiel.width)} m breed en hangt daarmee over de middenstreep: een strookhart ligt ${nr(LANE_OFFSET)} m naast de middellijn`,
			);
		}
		if (profiel.holdGap <= profiel.length) {
			fout(
				'wegen',
				`een ${soort} houdt ${nr(profiel.holdGap)} m hart-op-hart aan terwijl hij zelf ${nr(profiel.length)} m lang is, dus een stilstaande rij schuift in zichzelf`,
			);
		}
		if (profiel.brakeGap <= profiel.holdGap) {
			fout(
				'wegen',
				`een ${soort} gaat pas op ${nr(profiel.brakeGap)} m van zijn gas terwijl hij op ${nr(profiel.holdGap)} m stilstaat, dus hij remt niet maar botst`,
			);
		}
		if (profiel.hit <= 0 || profiel.hit > half(profiel.length)) {
			fout(
				'wegen',
				`de botsstraal van een ${soort} is ${nr(profiel.hit)} m en past niet binnen zijn eigen neus (${nr(half(profiel.length))} m)`,
			);
		}
	}

	const auto = TRAFFIC_PROFILES.car;
	const rijder = TRAFFIC_PROFILES.rider;
	if (rijder.length >= auto.length || rijder.width >= auto.width) {
		fout(
			'wegen',
			`een motor meet ${nr(rijder.length)} bij ${nr(rijder.width)} m en is daarmee niet smaller dan de auto (${nr(auto.length)} bij ${nr(auto.width)} m)`,
		);
	}
	if (rijder.holdGap >= auto.holdGap || rijder.brakeGap >= auto.brakeGap) {
		fout(
			'wegen',
			`een motor volgt op ${nr(rijder.holdGap)} m en remt op ${nr(rijder.brakeGap)} m, en dat is geen krapper profiel dan de auto (${nr(auto.holdGap)} en ${nr(auto.brakeGap)} m)`,
		);
	}

	const perRichting = ROAD_RINGS.map(
		(_strook, ring) => TRAFFIC_FLEET.filter((soort, slot) => soort === 'rider' && slot % ROAD_RINGS.length === ring).length,
	);
	for (const [ring, aantal] of perRichting.entries()) {
		if (aantal > 0) continue;
		fout('wegen', `richting ${ring} van de ringweg rijdt geen enkele motor, dus daar is het weer alleen blik`);
	}
}

/** Op welke rijstrook een punt precies op het hart ligt, en welke kant die strook daar op rijdt. */
function opStrook(x: number, z: number): { ring: number; dx: number; dz: number } | null {
	for (const [index, strook] of ROAD_RINGS.entries()) {
		for (const rand of strook.edges) {
			const u = (x - rand.ox) * rand.dx + (z - rand.oz) * rand.dz;
			if (u < -EPS || u > rand.len + EPS) continue;
			if (!bijna(Math.abs((x - rand.ox) * -rand.dz + (z - rand.oz) * rand.dx), 0)) continue;
			return { ring: index, dx: rand.dx, dz: rand.dz };
		}
	}
	return null;
}

/**
 * De aftakking van de ringweg naar P1.
 *
 * De geul lag los van de weg: het asfalt hield op de stoeprand op, de helling begon
 * twee meter verderop en daartussen lag bestrating. Er kon dus wel een auto naar
 * beneden rijden, maar niet over iets waar hij op paste. Deze controle vraagt of de
 * inrit de naad echt dicht legt en of de route erdoorheen op de helling ligt, tussen
 * de keermuren blijft en rechts houdt.
 */
function controleAftakking(): void {
	const mond = PARKING_EXIT_TRENCH.minX;
	if (EXIT_APRON.minX > PLAZA_OUTER.minX + EPS) {
		fout('wegen', `de inrit begint op x ${nr(EXIT_APRON.minX)} en raakt de rijbaan (tot x ${nr(PLAZA_OUTER.minX)}) niet`);
	}
	if (EXIT_APRON.maxX < mond - EPS) {
		fout('wegen', `de inrit stopt op x ${nr(EXIT_APRON.maxX)} en de mond van de geul begint pas op x ${nr(mond)}`);
	}
	if (!bijna(EXIT_APRON_TOP_Y, parkingExitRampY(mond))) {
		fout('wegen', `de inrit ligt op ${nr(EXIT_APRON_TOP_Y)} en de mond van de helling op ${nr(parkingExitRampY(mond))}`);
	}
	const halveAuto = half(TRAFFIC_CAR.width);
	if (EXIT_APRON.maxZ < EXIT_LANE_OFFSET + halveAuto || EXIT_APRON.minZ > -(EXIT_LANE_OFFSET + halveAuto)) {
		fout('wegen', `de inrit is ${nr(span(EXIT_APRON.minZ, EXIT_APRON.maxZ))} m breed en draagt de twee rijstroken niet`);
	}

	// De helling van de uitrit zelf: steiler dan dat mag geen enkel stuk van de route zijn.
	const maxHelling =
		span(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) / span(PARKING_EXIT_RAMP.end.x, PARKING_EXIT_RAMP.start.x);
	for (let i = 0; i + 1 < EXIT_BRANCH_ROUTE.length; i++) {
		const van = at(EXIT_BRANCH_ROUTE, i);
		const naar = at(EXIT_BRANCH_ROUTE, i + 1);
		const dx = naar.x - van.x;
		const dz = naar.z - van.z;
		const loop = Math.hypot(dx, dz);
		if (loop < EPS) {
			fout('wegen', `stuk ${i} van de aftakking heeft geen lengte`);
			continue;
		}
		if (Math.abs(dx) > EPS && Math.abs(dz) > EPS) {
			fout('wegen', `stuk ${i} van de aftakking loopt schuin (${nr(dx)}, ${nr(dz)}) in plaats van langs één as`);
		}
		if (Math.abs(naar.y - van.y) / loop > maxHelling + EPS) {
			fout(
				'wegen',
				`stuk ${i} van de aftakking klimt ${nr(Math.abs(naar.y - van.y) / loop)} per meter, steiler dan de uitrit zelf (${nr(maxHelling)})`,
			);
		}
		// Rechts houden: rechts van rijrichting (dx, dz) is (−dz, dx), dus een stuk
		// langs x hoort aan de kant van de as waar zijn eigen richting naartoe wijst.
		if (Math.abs(dx) > EPS && Math.sign(van.z) !== Math.sign(dx)) {
			fout('wegen', `stuk ${i} rijdt richting x ${nr(Math.sign(dx))} op z ${nr(van.z)} en houdt daarmee links`);
		}
	}

	for (const punt of EXIT_BRANCH_ROUTE) {
		if (punt.x < mond - EPS) continue;
		if (!bijna(punt.y, parkingExitRampY(punt.x))) {
			fout(
				'wegen',
				`de aftakking ligt op (${nr(punt.x)}, ${nr(punt.y)}) terwijl de helling daar op ${nr(parkingExitRampY(punt.x))} ligt`,
			);
		}
		if (punt.x <= PARKING_EXIT_RAMP.start.x && Math.abs(punt.z) + halveAuto > PARKING_EXIT_RAIL_OUTER + EPS) {
			fout('wegen', `de aftakking loopt op x ${nr(punt.x)} met z ${nr(punt.z)} tegen de keermuur van de geul aan`);
		}
	}

	// Hij verlaat de ring en komt er verderop op dezelfde strook weer op.
	const eerste = EXIT_BRANCH_ROUTE[0];
	const laatste = EXIT_BRANCH_ROUTE[EXIT_BRANCH_ROUTE.length - 1];
	const uit = eerste ? opStrook(eerste.x, eerste.z) : null;
	const in_ = laatste ? opStrook(laatste.x, laatste.z) : null;
	if (!eerste || !laatste || uit === null || in_ === null) {
		fout('wegen', 'de aftakking begint of eindigt niet op het hart van een rijstrook');
	} else {
		if (uit.ring !== in_.ring) fout('wegen', `de aftakking verlaat strook ${uit.ring} en voegt in op strook ${in_.ring}`);
		if ((laatste.x - eerste.x) * uit.dx + (laatste.z - eerste.z) * uit.dz <= 0) {
			fout('wegen', 'de aftakking voegt stroomopwaarts weer in, dus tegen zijn eigen strook in');
		}
		if (!bijna(eerste.x, RING_INNER_WEST_X)) {
			fout('wegen', `de aftakking begint op x ${nr(eerste.x)} en niet op de binnenste strook (${nr(RING_INNER_WEST_X)})`);
		}
	}

	// De slagboom staat op de inrit, naast de heenstrook, en zijn arm sluit alleen die af.
	if (EXIT_BOOM.post.x < EXIT_APRON.minX || EXIT_BOOM.post.x > EXIT_APRON.maxX) {
		fout('wegen', `de slagboom staat op x ${nr(EXIT_BOOM.post.x)} en dus niet op de inrit`);
	}
	if (EXIT_BOOM.post.z < EXIT_LANE_OFFSET + halveAuto) {
		fout('wegen', `de paal van de slagboom staat op z ${nr(EXIT_BOOM.post.z)}, binnen de rijstrook naar binnen`);
	}
	if (!bijna(EXIT_BOOM.post.y, EXIT_APRON_TOP_Y)) {
		fout('wegen', `de slagboom staat op y ${nr(EXIT_BOOM.post.y)} en de inrit waar hij op staat op ${nr(EXIT_APRON_TOP_Y)}`);
	}
	const tip = EXIT_BOOM_TIP_Z;
	if (tip > EXIT_LANE_OFFSET) fout('wegen', `de arm reikt tot z ${nr(tip)} en sluit de strook naar binnen niet af`);
	if (tip < -EXIT_LANE_OFFSET + halveAuto) {
		fout('wegen', `de arm reikt tot z ${nr(tip)} en staat daarmee in de strook naar buiten`);
	}
}

// ── 15b2. de slagbomen en wie er langs mogen ───────────────────────────────

/** Simulatiestap van de rijproeven hieronder. Zestig hertz, zoals een frame. */
const RIT_DT = 1 / 60;
/** Snelheid waarmee de proefrit op een boom af rijdt (m/s): stapvoets, dus de arm heeft alle tijd. */
const RIT_SNELHEID = 3;
/** Zoveel meter voorbij de arm telt als "erlangs". */
const RIT_DOORGANG = 0.2;
/** Hoogte waarop een voertuig zijn botsingsvraag stelt, boven het wegdek. */
const RIT_ROMPHOOGTE = 0.6;
/** Boven dit loopvlak hoort geen enkel voertuig; de proefritten rijden geen daken. */
const RIT_PLAFOND = 10;

/**
 * Rijd één voertuig van deze klasse op deze boom af en geef terug hoe ver het komt.
 *
 * Precies wat App doet: de armen lopen eerst op wat ze vorige frame zagen, dan meldt
 * het voertuig zich, dan lost de wereld de botsing op. Het antwoord is de x die het
 * haalt; voorbij de paal betekent erlangs.
 */
async function rijdNaarBoom(spec: BarrierSpec, klasse: TrafficClass): Promise<number> {
	const { Barriers } = await import('#/scene/city/Barriers');
	const stad = new CollisionWorld();
	const bomen = new Barriers(stad);
	const strook = barrierApproachBounds(spec);
	const z = midpoint(strook.minZ, strook.maxZ);
	const straal = half(TRAFFIC_CAR.width);
	const richting = -spec.approachSide;
	const doel = spec.post.x + richting * (half(BARRIER_HARDWARE.arm.thickness) + RIT_DOORGANG);
	let x = spec.post.x - richting * spec.sight;
	for (let stap = 0; stap < Math.ceil(spec.sight / (RIT_SNELHEID * RIT_DT)) + 1; stap++) {
		bomen.update(RIT_DT);
		bomen.approach(x, z, klasse);
		const opgelost = stad.resolveCircle(
			x + richting * RIT_SNELHEID * RIT_DT,
			z,
			spec.post.y + RIT_ROMPHOOGTE,
			straal,
			4,
			true,
			false,
			true,
		);
		x = opgelost.x;
		if ((doel - x) * richting <= 0) break;
	}
	return x;
}

/** Om de hoeveel meter een route bemonsterd wordt bij het zoeken naar een aanloopstrook. */
const ROUTE_STAP = 0.5;

/**
 * Elke klasse die de broncode ooit bij een boom meldt.
 *
 * Een boom die een klasse toelaat die niemand aanbiedt leest precies zoals een boom
 * die werkt: hij staat er, hij heeft beleid, en hij gaat nooit open. De stad-garageboom
 * liet `npc-traffic` toe en er rijdt daar geen enkele sim.
 */
function gemeldeVerkeersklassen(): Set<TrafficClass> {
	const gemeld = new Set<TrafficClass>();
	for (const pad of rekenBestanden('src')) {
		const code = readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8');
		for (const treffer of code.matchAll(/\.approach\s*\([^)]*?'([a-z-]+)'\s*\)/g)) {
			const klasse = TRAFFIC_CLASSES.find((kandidaat) => kandidaat === treffer[1]);
			if (klasse) gemeld.add(klasse);
		}
	}
	return gemeld;
}

/** Elk punt waar het stadsverkeer langskomt: de twee ringstroken en de aftakking. */
function verkeerspunten(): [number, number][] {
	const punten: [number, number][] = [];
	for (const ring of ROAD_RINGS) {
		for (const rand of ring.edges) {
			for (let afstand = 0; afstand <= rand.len; afstand += ROUTE_STAP) {
				punten.push([rand.ox + rand.dx * afstand, rand.oz + rand.dz * afstand]);
			}
		}
	}
	for (let i = 1; i < EXIT_BRANCH_ROUTE.length; i++) {
		const van = at(EXIT_BRANCH_ROUTE, i - 1);
		const naar = at(EXIT_BRANCH_ROUTE, i);
		const lengte = Math.hypot(naar.x - van.x, naar.z - van.z);
		for (let afstand = 0; afstand <= lengte; afstand += ROUTE_STAP) {
			const t = lengte === 0 ? 0 : afstand / lengte;
			punten.push([lerp(van.x, naar.x, t), lerp(van.z, naar.z, t)]);
		}
	}
	return punten;
}

/**
 * Komt er iets van deze klasse ooit in de aanloopstrook van deze boom?
 *
 * Het stadsverkeer rijdt geschreven routes, dus daar is het antwoord te meten. De
 * speler rijdt waar hij wil zolang er iets is om in te stappen, en te voet meldt
 * niemand zich bij een boom.
 */
function komtLangsDeBoom(spec: BarrierSpec, klasse: TrafficClass): boolean {
	if (klasse === 'player-vehicle') return DRIVEABLE_SPOTS.length > 0;
	if (klasse !== 'npc-traffic') return false;
	const strook = barrierApproachBounds(spec);
	return verkeerspunten().some(([x, z]) => x >= strook.minX && x <= strook.maxX && z >= strook.minZ && z <= strook.maxZ);
}

/**
 * De slagbomen: wie erlangs mag staat op de boom en niet in het voertuig.
 *
 * Ze hielden allebei niets tegen — je reed er in een huurauto dwars doorheen — en de
 * ene hing aan het ringverkeer terwijl de andere op een sinus op en neer ging. Nu is
 * de liggende arm een collider en zegt het toelatingsbeleid van de boom of hij omhoog
 * gaat. Deze controle rijdt daarom hetzelfde stuk drie keer, één keer per klasse, en
 * verwacht per klasse het antwoord dat op de boom staat.
 */
async function controleSlagbomen(): Promise<void> {
	for (const probleem of validateSpatialWorld(BARRIER_ENTITIES)) {
		fout('slagbomen', `${probleem.code}: ${probleem.message}`);
	}
	if (BARRIER_SPECS.length === 0) {
		fout('slagbomen', 'er staat geen enkele slagboom in het wereldmodel');
		return;
	}
	stubDocument();
	const gemeld = gemeldeVerkeersklassen();

	for (const spec of BARRIER_SPECS) {
		const poort = barrierGateCollider(spec);
		if (poort.minY > spec.post.y + EPS) {
			fout('slagbomen', `de doorgang van ${spec.id} begint op y ${nr(poort.minY)} en niet op zijn eigen loopvlak`);
		}
		if (poort.maxY <= spec.post.y + BARRIER_HARDWARE.pivotY) {
			fout('slagbomen', `de doorgang van ${spec.id} houdt op ${nr(poort.maxY)} op, onder het scharnier van zijn eigen arm`);
		}
		const strook = barrierApproachBounds(spec);
		if (strook.minX > spec.post.x - spec.sight + EPS && strook.maxX < spec.post.x + spec.sight - EPS) {
			fout('slagbomen', `de aanloopstrook van ${spec.id} is korter dan de ${nr(spec.sight)} m waarop hij hoort te zien`);
		}

		for (const klasse of TRAFFIC_CLASSES) {
			const toegelaten = barrierAdmits(spec, klasse);
			// Een vergunning die niemand kan tonen is geen vergunning. Dezelfde regel
			// als bij een `penetration` die nergens in snijdt en een vrijstellingsregel
			// die niets meer raakt: hij staat er, hij doet niets, en hij leest als beleid.
			if (toegelaten && !gemeld.has(klasse)) {
				fout('slagbomen', `${spec.id} laat ${klasse} toe, maar nergens in src/ meldt iets zich als ${klasse} bij een boom`);
			} else if (toegelaten && !komtLangsDeBoom(spec, klasse)) {
				fout('slagbomen', `${spec.id} laat ${klasse} toe, maar geen enkele ${klasse} komt ooit in zijn aanloopstrook`);
			}
			const bereikt = await rijdNaarBoom(spec, klasse);
			const erlangs = (bereikt - spec.post.x) * -spec.approachSide > 0;
			if (toegelaten && !erlangs) {
				fout(
					'slagbomen',
					`${spec.id} laat ${klasse} toe, maar die komt niet verder dan x ${nr(bereikt)} (paal op ${nr(spec.post.x)})`,
				);
			}
			if (!toegelaten && erlangs) {
				fout('slagbomen', `${spec.id} laat ${klasse} niet toe en die rijdt er tot x ${nr(bereikt)} toch doorheen`);
			}
		}
	}
}

// ── 15b3. wat een voertuig van het wegdek merkt ────────────────────────────

/**
 * Hellinghouding en vrije val van de voertuigen.
 *
 * Op de garagehelling kantelde er niets: elk voertuig vroeg alleen de hoogte onder
 * zijn eigen hart, en één hoogte is geen helling, dus je zweefde vlak omhoog met het
 * dek zichtbaar schuin onder je door. En van een rand af sprong de hoogte in één
 * frame naar het vlak beneden, want die hoogte werd elk frame overgenomen zonder
 * verticale snelheid ertussen.
 */
async function controleVoertuigen(): Promise<void> {
	const helling =
		span(PARKING_EXIT_RAMP.start.y, PARKING_EXIT_RAMP.end.y) / span(PARKING_EXIT_RAMP.end.x, PARKING_EXIT_RAMP.start.x);
	const middenX = midpoint(PARKING_EXIT_RAMP.start.x, PARKING_EXIT_RAMP.end.x);
	const z = PARKING_EXIT_RAMP.start.z;
	const y = parkingExitRampY(middenX);

	// Elke soort die de speler wegrijdt heeft zijn eigen asafstand, en elk van die
	// asafstanden moet dezelfde helling opleveren: de auto meet over 2,5 m en de motor
	// over anderhalve, en een helling die van de meetlat afhangt is geen helling.
	for (const [soort, rijgedrag] of Object.entries(DRIVEABLE_HANDLING)) {
		const asafstand = rijgedrag.wheelbase;
		if (asafstand <= 0) {
			fout('voertuigen', `de ${soort} meet zijn helling over ${nr(asafstand)} m, en dan is er niets om over te meten`);
			continue;
		}
		// Naar het westen loopt de uitrit omhoog, dus daar gaat de neus omhoog en de
		// andere kant op omlaag. Op een rechte helling maakt de asafstand niet uit.
		const omhoog = wereld.surfacePitchAt(middenX, z, y, -1, 0, asafstand);
		const omlaag = wereld.surfacePitchAt(middenX, z, y, 1, 0, asafstand);
		if (!bijna(omhoog, Math.atan(helling), 1e-3)) {
			fout('voertuigen', `de uitrit klimt ${nr(Math.atan(helling))} rad en een ${soort} erop kantelt ${nr(omhoog)} rad`);
		}
		if (!bijna(omlaag, -omhoog, 1e-3)) {
			fout('voertuigen', `dezelfde helling levert een ${soort} ${nr(omhoog)} rad omhoog en ${nr(omlaag)} rad omlaag op`);
		}
		if (!bijna(wereld.surfacePitchAt(0, 0, levelY('p1'), 1, 0, asafstand), 0, 1e-6)) {
			fout('voertuigen', `op de vlakke parkeervloer staat een ${soort} niet vlak`);
		}
	}

	// Van de rand van het bovenste bordes van de garagespiraal af: een boog met
	// dezelfde zwaartekracht als de speler, niet één frame waarin de hoogte naar het
	// maaiveld beneden springt.
	const bordes = GARAGE_RAMP_LANDINGS[GARAGE_RAMP_LANDINGS.length - 1];
	if (!bordes) {
		fout('voertuigen', 'de garagespiraal heeft geen bordes om vanaf te rijden');
		return;
	}
	const randX = bordes.maxX + 1;
	const randZ = midpoint(bordes.minZ, bordes.maxZ);
	const start = bordes.y;
	const bodem = CITY_GROUND_Y;
	const toestand: VehicleGroundState = { y: start, vy: 0, grounded: true };
	const hoogtes: number[] = [start];
	let frames = 0;
	const maxFrames = Math.ceil(10 / RIT_DT);
	while (frames < maxFrames) {
		stepVehicleGround(wereld, toestand, randX, randZ, RIT_DT, { floorOverride: null, ceiling: RIT_PLAFOND });
		hoogtes.push(toestand.y);
		frames++;
		if (toestand.grounded && frames > 1) break;
	}
	if (toestand.grounded && frames <= 1) {
		fout('voertuigen', `van de rand op y ${nr(start)} af blijft een voertuig staan; daar ligt de vloer op ${nr(bodem)}`);
	}
	if (!toestand.grounded) {
		fout('voertuigen', `een voertuig valt na ${nr(frames * RIT_DT)} s nog steeds en landt niet op ${nr(bodem)}`);
	} else if (!bijna(toestand.y, bodem, 1e-3)) {
		fout('voertuigen', `een voertuig landt op y ${nr(toestand.y)} in plaats van op de vloer ${nr(bodem)}`);
	}
	// Elke stap groter dan de vorige: dat is versnellen, en niet één sprong.
	let vorige = 0;
	for (let i = 2; i < hoogtes.length - 1; i++) {
		const zak = span(at(hoogtes, i), at(hoogtes, i - 1));
		if (zak <= vorige) {
			fout('voertuigen', `de val zakt bij frame ${i} ${nr(zak)} m na ${nr(vorige)} m, dus hij versnelt niet`);
			break;
		}
		vorige = zak;
	}
	// En de valtijd is die van een vrije val over dezelfde hoogte, op één frame na.
	const vrijeVal = Math.sqrt((2 * span(bodem, start)) / GRAVITY);
	if (Math.abs(frames * RIT_DT - vrijeVal) > RIT_DT * 2) {
		fout(
			'voertuigen',
			`de val duurt ${nr(frames * RIT_DT)} s waar vrije val over ${nr(span(bodem, start))} m ${nr(vrijeVal)} s duurt`,
		);
	}

	await controleUitstappen();
}

/** Waar de proef uitstapt: midden op de zuidstoep, ver van de vrijstelling rond de uitritgeul. */
const UITSTAP_BUITEN = { x: midpoint(PLAZA_OUTER.minX, PLAZA_OUTER.maxX), y: CITY_GROUND_Y, z: PLAZA_OUTER.maxZ - 2 };

// ── 15b3c. wie klem staat komt er weer uit ─────────────────────────────────

/**
 * Uit de geometrie komen waar je in staat.
 *
 * Een herstelde sessie zet je terug op een punt uit de vorige wereld, en een rit die
 * daarbij niet terugkomt laat je te voet in het voertuig staan waar je op zat. Daar
 * loop je niet meer uit: elke stap wordt teruggeduwd naar waar je al klem stond, en
 * dat is wat `unstickBody` na een herstel en na een teleport wegneemt. Elke massieve
 * doos waar een lichaam middenin past hoort hem er langs de dichtstbijzijnde kant uit
 * te zetten, en in de open ruimte hoort hij niemand te verzetten.
 */
function controleKlemvrij(): void {
	const straal = STANDING_PEDESTRIAN.radius;
	let gemeten = 0;
	for (const doos of wereld.boxes) {
		if (doos.disabled || doos.climbable || doos.outdoor) continue;
		// Alleen dozen waar een lichaam echt middenin past; in een dunne plaat staat de
		// rand er al buiten en meet de proef niets.
		if (span(doos.minX, doos.maxX) < straal * 2 || span(doos.minZ, doos.maxZ) < straal * 2) continue;
		gemeten++;
		const x = midpoint(doos.minX, doos.maxX);
		const z = midpoint(doos.minZ, doos.maxZ);
		const los = wereld.unstickBody(x, z, doos.minY ?? CITY_GROUND_Y, false, straal);
		const nogBinnen =
			los.x > doos.minX - straal + EPS &&
			los.x < doos.maxX + straal - EPS &&
			los.z > doos.minZ - straal + EPS &&
			los.z < doos.maxZ + straal - EPS;
		if (nogBinnen) {
			fout(
				'klemvrij',
				`midden in ${doos.label ?? 'een naamloze doos'} op (${nr(x)}, ${nr(z)}) blijf je klem staan op (${nr(los.x)}, ${nr(los.z)})`,
			);
		}
	}
	if (gemeten === 0) {
		fout('klemvrij', 'er is geen enkele massieve doos waar een lichaam middenin past, dus deze controle meet niets');
	}

	// En wie vrij staat wordt niet verzet: een losmaakstap die iedereen verplaatst is
	// een teleport en geen redding.
	const vrij = profilePoint(INGANG_STANDPUNT).pose;
	const stil = wereld.unstickBody(vrij.x, vrij.z, CITY_GROUND_Y, true, straal);
	if (!bijna(stil.x, vrij.x, 1e-9) || !bijna(stil.z, vrij.z, 1e-9)) {
		fout(
			'klemvrij',
			`op de vrije stoep bij ${INGANG_STANDPUNT} word je van (${nr(vrij.x)}, ${nr(vrij.z)}) naar (${nr(stil.x)}, ${nr(stil.z)}) verzet`,
		);
	}
}

/**
 * Waar je uit een voertuig stapt, stap je uit.
 *
 * `board` zet de wereld op 'city' zodat een auto de stad in mag, en `release` zette
 * hem terug op 'mall' en trok het uitstappunt daarna door dezelfde voetafdrukklem.
 * Buiten op de motor uitstappen zette je elf meter verderop tegen de zuidrand van de
 * footprint, binnen het gebouw. Het uitstappunt krijgt nu dezelfde vrijstelling als de
 * speler te voet, en die vrijstelling hangt aan de hoogte en niet aan de gedeelde klem.
 */
async function controleUitstappen(): Promise<void> {
	stubDocument();
	const [{ Barriers }, { DriveableCars }] = await Promise.all([import('#/scene/city/Barriers'), import('#/scene/DriveableCars')]);
	const motor = RIDEABLE_MOTORCYCLE_SPOTS[0];
	if (!motor) {
		fout('voertuigen', 'er staat geen motor die de speler wegrijdt');
		return;
	}
	const staanplaatsen = [
		{ waar: 'op de stoep', zone: 'stad', rit: { ...UITSTAP_BUITEN, yaw: 0 } },
		{ waar: 'in de garage', zone: zoneOfLevel('p1'), rit: { x: motor.x, y: motor.y, z: motor.z, yaw: motor.yaw } },
	] as const;
	const stappen: number[] = [];
	for (const plaats of staanplaatsen) {
		const stad = new CollisionWorld();
		const voertuigen = new DriveableCars(stad, new Barriers(stad));
		if (!voertuigen.resume({ id: motor.name, ...plaats.rit, speed: 0 })) {
			fout('voertuigen', `${motor.name} is ${plaats.waar} niet terug te zetten om uit te stappen`);
			return;
		}
		const uit = voertuigen.release();
		const beland = zoneAt(uit.x, uit.y, uit.z);
		if (beland !== plaats.zone) {
			fout(
				'voertuigen',
				`wie ${plaats.waar} uitstapt op (${nr(plaats.rit.x)}, ${nr(plaats.rit.z)}) belandt op (${nr(uit.x)}, ${nr(uit.z)}) in ${beland} in plaats van in ${plaats.zone}`,
			);
		}
		if (stad.boundsMode !== 'mall') {
			fout(
				'voertuigen',
				`na uitstappen ${plaats.waar} staat de gedeelde wereld op '${stad.boundsMode}', dus mag elke sim de mall uit`,
			);
		}
		stappen.push(Math.hypot(uit.x - plaats.rit.x, uit.z - plaats.rit.z));
	}
	// Even ver opzij, waar je ook uitstapt: verschilt het, dan heeft de klem aan één
	// van de twee getrokken.
	const [buiten, binnen] = stappen;
	if (buiten === undefined || binnen === undefined || !bijna(buiten, binnen, 1e-6)) {
		fout('voertuigen', `uitstappen zet je buiten ${nr(buiten ?? 0)} m opzij en in de garage ${nr(binnen ?? 0)} m`);
	}

	// En de vloer waarop je uitstapt is de vloer waar het voertuig op staat. De buggy
	// rijdt de lift in, dus die vloer is de cabinevloer; wie hem uit een vaste
	// zoekhoogte haalt vindt altijd de begane grond en zet je van V1 af naar beneden.
	const [THREE, { LightPool }, { ScrubberBuggy }] = await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/ScrubberBuggy'),
	]);
	const dek = new CollisionWorld();
	const buggy = new ScrubberBuggy(dek, new LightPool(new THREE.Scene()), new Barriers(dek));
	const cabine = levelY('v1');
	buggy.board();
	buggy.setFloorOverride(cabine);
	buggy.update(RIT_DT, { throttle: 0, steer: 0, boost: false });
	const uitCabine = buggy.release();
	if (!bijna(uitCabine.y, cabine, 1e-6)) {
		fout(
			'voertuigen',
			`uit de liftcabine op ${nr(cabine)} stap je op ${nr(uitCabine.y)}, dus niet op de vloer waar de buggy staat`,
		);
	}
}

// ── 15b3a. wat een voertuig wel en niet op mag klimmen ─────────────────────

/** Zoveel meter boven zijn startdek mag een geblokkeerd voertuig niet uitkomen. */
const KARKLIM_SPELING = 0.35;
/** Vooruitgang vanaf de gemelde pose die bewijst dat de hoge trap geen zijwand is. */
const KARKLIM_ONDERDOOR = 0.5;

/**
 * Een voertuig klimt alleen wat zijn verkeersklasse toelaat.
 *
 * De schoonmaakkar reed als een voetganger de geheime trap op en de verticale solver
 * parkeerde hem halverwege de vlucht in de lucht. Een voertuig is geen voetganger:
 * de trap en de roltrap laten alleen `walking` toe, de lift en de uitritramp ook
 * `wheeled`. Dat verschil staat op de poorten van elke doorgang, dus de proef leest
 * het daar en rijdt het na: tegen de trap blijft hij op de vloer, de lift rijdt hij
 * in, en de uitritramp klimt hij wél.
 */
async function controleKarklim(): Promise<void> {
	// Het wereldmodel eerst: de geheime trap mag geen wielen toelaten en de lift wel.
	// Zo kan de klasse-scheiding niet stilletjes de verkeerde kant op wijzen.
	const trapModi = connectorClimbModes('secret-stairs');
	if (trapModi.includes('wheeled')) {
		fout('karklim', `de geheime trap laat wielen toe (${trapModi.join(', ')}); een voetgangerstrap hoort dat niet te doen`);
	}
	if (!ELEVATOR_CLIMB_MODES.includes('wheeled')) {
		fout('karklim', `de lift laat geen wielen toe (${ELEVATOR_CLIMB_MODES.join(', ')}); de schoonmaakkar hoort erin te kunnen`);
	}

	const [THREE, { LightPool }, { ScrubberBuggy }, { GlassElevator }, { Barriers }, { CleaningCart }] = await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/ScrubberBuggy'),
		import('#/scene/GlassElevator'),
		import('#/scene/city/Barriers'),
		import('#/scene/CleaningCart'),
	]);

	function rijKar(
		dek: CollisionWorld,
		start: { x: number; y: number; z: number; yaw: number },
		frames: number,
		throttle = 1,
	): { maxY: number; eind: { x: number; y: number; z: number } } {
		const kar = new ScrubberBuggy(dek, new LightPool(new THREE.Scene()), new Barriers(dek));
		kar.resume({ id: '', x: start.x, y: start.y, z: start.z, yaw: start.yaw, speed: 0 });
		let maxY = start.y;
		for (let f = 0; f < frames; f++) {
			kar.update(RIT_DT, { throttle, steer: 0, boost: false });
			if (kar.pos.y > maxY) maxY = kar.pos.y;
		}
		return { maxY, eind: { x: kar.pos.x, y: kar.pos.y, z: kar.pos.z } };
	}

	// Geheime trap: x=26, voet op V1. Rij +z de trap op — hij hoort te botsen en op de
	// vloer te blijven, niet als een voetganger de treden te nemen.
	const trapVoetY = levelY('v1');
	const trap = rijKar(new CollisionWorld(), { x: 26, y: trapVoetY, z: 12.5, yaw: Math.PI }, 180);
	if (trap.maxY > trapVoetY + KARKLIM_SPELING) {
		fout('karklim', `de kar klimt de geheime trap tot y ${nr(trap.maxY)}, terwijl zijn voet op ${nr(trapVoetY)} ligt`);
	}

	// Westtrap, exact de gemelde pose: op z=-11 hangt de vlucht bijna vijf meter
	// boven V0. De connector-AABB maakte die vrije ruimte vroeger tot een oneindig
	// hoge wand en schrapte elke oostelijke component uit de beweging op x=-24,4.
	const onderStart = { x: -24.4, y: levelY('v0'), z: -11, yaw: (-119 * Math.PI) / 180 } as const;
	const onderTrap = rijKar(new CollisionWorld(), onderStart, 30);
	if (onderTrap.eind.x < onderStart.x + KARKLIM_ONDERDOOR) {
		fout(
			'karklim',
			`onder de hoge westtrap komt de kar vanaf (${nr(onderStart.x)}, ${nr(onderStart.z)}) maar tot x ${nr(onderTrap.eind.x)}`,
		);
	}

	// En een kar die tóch halverwege de trap in de lucht hangt (een oude save-toestand
	// van vóór de klasse-scheiding) hoort terug te zakken naar de vloer, niet de laatst
	// geaccepteerde hoogte vast te houden: de verticale solver liet hem anders op ~7,99 m
	// staan omdat de dakplaat boven het plafond antwoordde en hij die hoogte vasthield.
	const zweefY = trapVoetY + 1.55;
	const zweef = rijKar(new CollisionWorld(), { x: 25.91, y: zweefY, z: 15, yaw: Math.PI }, 180, 0);
	if (Math.abs(zweef.eind.y - trapVoetY) > KARKLIM_SPELING) {
		fout(
			'karklim',
			`een kar die op y ${nr(zweefY)} halverwege de trap hangt blijft op y ${nr(zweef.eind.y)} in plaats van terug te zakken naar ${nr(trapVoetY)}`,
		);
	}

	// Uitritramp: van P1 naar V0. Die laat wielen toe, dus hier hoort hij wél te klimmen.
	const rampBodemY = midpoint(PARKING_EXIT_RAMP.start.y, parkingExitRampY(-30.5));
	const rampTopY = levelY('v0');
	const ramp = rijKar(new CollisionWorld(), { x: -30.5, y: rampBodemY, z: PARKING_EXIT_RAMP.start.z, yaw: Math.PI / 2 }, 260);
	if (ramp.maxY < rampTopY - KARKLIM_SPELING) {
		fout('karklim', `de kar komt de uitritramp niet op: hij blijft steken op y ${nr(ramp.maxY)}, de top ligt op ${nr(rampTopY)}`);
	}

	// Lift: de schacht-colliders komen uit GlassElevator, net als in App. De instapzijde
	// is climbable voor wielen, dus de kar hoort de cabine in te rijden en niet te botsen.
	const liftDek = new CollisionWorld();
	const lift = new GlassElevator(new LightPool(new THREE.Scene()));
	for (const c of lift.getColliders()) {
		liftDek.addBox(c.minX, c.maxX, c.minZ, c.maxZ, {
			minY: c.minY ?? -7.5,
			maxY: c.maxY ?? 16.5,
			label: c.label,
			climbable: c.climbable,
		});
	}
	const instapZ = ELEVATOR_SPEC.center.z + half(ELEVATOR_SPEC.cabin.depth);
	const inLift = rijKar(liftDek, { x: ELEVATOR_SPEC.center.x, y: levelY('v0'), z: instapZ + 2, yaw: 0 }, 120);
	if (inLift.eind.z > instapZ) {
		fout(
			'karklim',
			`de kar komt de lift niet in: hij botst op de instapzijde bij z ${nr(inLift.eind.z)}, de mond ligt op ${nr(instapZ)}`,
		);
	}

	// Wei's NPC-kar botst op álles wat climbable is: een route-waypoint ligt in de
	// east-escalator en zijn pad kruist de liftschacht, en met climb=true reed hij daar
	// dwars doorheen. Hij gebruikt de lift nooit, dus anders dan de spelerskar (wheeled)
	// hoort ook de glazen schacht hem tegen te houden. Getest tegen liftDek, dus elke
	// climbable box inclusief de lift: Wei (geen klim) wordt eruit geduwd, de spelerskar
	// (wheeled) alleen uit de voetganger-only boxen, en een voetganger loopt overal door.
	const weiRadius = new CleaningCart(liftDek).radius;
	const binnen = (box: { minX: number; maxX: number; minZ: number; maxZ: number }, p: { x: number; z: number }): boolean =>
		p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
	for (const box of liftDek.boxes) {
		const modi = box.climbable;
		if (!modi) continue;
		const cx = midpoint(box.minX, box.maxX);
		const cz = midpoint(box.minZ, box.maxZ);
		const label = box.label ?? 'een climbable box';

		const wei = liftDek.resolveCircle(cx, cz, 0.5, weiRadius, 4, false);
		if (binnen(box, wei)) {
			fout('karklim', `${label} houdt Wei's NPC-kar niet tegen; die hoort door geen enkele climbable geometrie te rijden`);
		}

		const speler = liftDek.resolveCircle(cx, cz, 0.5, weiRadius, 4, false, false, false, true);
		if (modi.includes('wheeled') && !binnen(box, speler)) {
			fout('karklim', `${label} laat wielen toe, maar duwt de spelerskar eruit`);
		} else if (!modi.includes('wheeled') && binnen(box, speler)) {
			fout('karklim', `${label} is voetganger-only, maar laat de spelerskar er middenin staan`);
		}

		const teVoet = liftDek.resolveCircle(cx, cz, 0.5, weiRadius, 4, true);
		if (!binnen(box, teVoet)) {
			fout('karklim', `${label} duwt een voetganger eruit terwijl die er juist doorheen loopt`);
		}
	}
}

// ── 15b3b. de motor die de speler wegrijdt ─────────────────────────────────

/** Zo lang duurt de proefrit op de motor, in seconden. */
const MOTORRIT_DUUR = 1;
/** Zoveel van de afstand die zijn eigen optrekvermogen belooft moet hij halen. */
const MOTORRIT_RENDEMENT = 0.9;
/** Speling op de koers: verder dan dit naast zijn eigen voorwaartse as en het is niet vooruit. */
const MOTORRIT_KOERS = 1e-3;
/** Hoever het zadel na een herbouw van de motor zelf mag liggen: de stoel staat achter het hart. */
const MOTORRIT_ZADEL = 1;
/** Deelgas voor de balansproef: genoeg vaart voor een echte bocht, en de balanshoek blijft ruim onder de klem. */
const MOTORRIT_LEUN_GAS = 0.1;
/** Kruipgas voor de stapvoetsproef: bijna geen zijversnelling, dus bijna geen leun. */
const MOTORRIT_KRUIP_GAS = 0.03;
/** Zoveel frames rijdt elke leunproef tot vaart, koers en leun stil staan. */
const MOTORRIT_LEUN_STAPPEN = 90;
/** Zoveel frames de bocht in op volle snelheid, kort genoeg voor de schrapende bocht de vaart weghaalt. */
const MOTORRIT_INZET = 4;
/** Speling tussen de gemeten leun en de balanshoek die de proef narekent. */
const MOTORRIT_LEUN_EPS = 0.02;
/** Onder deze hoek heet de motor bij stapvoets sturen zo goed als recht. */
const MOTORRIT_KRUIP_LEUN = 0.06;

/**
 * Waarin de motor de huurauto voorbij hoort te gaan, elk cijfer op zijn eigen regel.
 *
 * Twee regels met drie voorwaarden erin drukten altijd hetzelfde paar getallen af.
 * Een `boostSpeed` die terugliep meldde zich dan met een zin over `accel` en
 * `maxSpeed`, dus elke eigenschap staat los, met haar eigen getal en eenheid. De leun
 * staat er als `maxLean`: hoever de motor de bocht in mag hangen, waar de auto op zijn
 * veren rolt. Hoe hij daar naartoe leunt (balanshoek, niet stuur maal vaart) toetst de
 * leunproef verderop.
 */
const SCHERPER_DAN_DE_AUTO: readonly {
	wat: string;
	eenheid: string;
	lees: (rijgedrag: DriveableHandling) => number;
}[] = [
	{ wat: 'trekt op met', eenheid: 'm/s²', lees: (r) => r.accel },
	{ wat: 'loopt', eenheid: 'm/s', lees: (r) => r.maxSpeed },
	{ wat: 'sprint tot', eenheid: 'm/s', lees: (r) => r.boostSpeed },
	{ wat: 'hangt in de bocht tot', eenheid: 'rad', lees: (r) => r.maxLean },
];

/**
 * Instappen, gas geven, en waar hij dan heen gaat.
 *
 * De rijrichting is camera-vooruit, `−(sin, cos)`, en de carrosserie staat er een halve
 * slag op: met `+(sin, cos)` reed de huurauto achteruit terwijl je uit de achterruit
 * keek, en dat was aan de camera niet te zien omdat die meedraaide. Een tweede soort
 * op dezelfde machinerie erbij is precies waar zo'n omgeklapt teken opnieuw in sluipt,
 * dus de proefrit rijdt hem: W is vooruit, hij haalt wat zijn eigen optrekvermogen
 * belooft, hij hangt de bocht in waar de auto zich alleen op zijn veren zet, en hij
 * komt niet verder dan de hoek die op hem staat.
 */
async function controleMotorrit(): Promise<void> {
	const plek = RIDEABLE_MOTORCYCLE_SPOTS[0];
	if (!plek) {
		fout('motorrit', 'er staat geen motor die de speler wegrijdt');
		return;
	}
	const auto = DRIVEABLE_HANDLING.car;
	const motor = DRIVEABLE_HANDLING.motorcycle;
	for (const eigenschap of SCHERPER_DAN_DE_AUTO) {
		const opMotor = eigenschap.lees(motor);
		const opAuto = eigenschap.lees(auto);
		if (opMotor > opAuto) continue;
		fout(
			'motorrit',
			`de motor ${eigenschap.wat} ${nr(opMotor)} ${eigenschap.eenheid} waar de huurauto ${nr(opAuto)} ${eigenschap.eenheid} haalt, en is daarin dus niet scherper`,
		);
	}

	stubDocument();
	const [THREE, { Barriers }, { DriveableCars }] = await Promise.all([
		import('three'),
		import('#/scene/city/Barriers'),
		import('#/scene/DriveableCars'),
	]);
	const stad = new CollisionWorld();
	const voertuigen = new DriveableCars(stad, new Barriers(stad));
	const slot = voertuigen.nearestCar(new THREE.Vector3(plek.x, plek.y + 1, plek.z), 1);
	if (!slot || slot.name !== plek.name) {
		fout('motorrit', `bij de motor op (${nr(plek.x)}, ${nr(plek.z)}) staat ${slot ? slot.name : 'niets'} om in te stappen`);
		return;
	}
	if (!voertuigen.board(slot) || voertuigen.activeKind !== 'motorcycle') {
		fout('motorrit', `instappen bij ${plek.name} levert ${voertuigen.activeKind ?? 'niets'} op`);
		return;
	}

	// Zoals de mesh staat: de neus is lokaal +z, dus de carrosserie draait π op de rijkoers.
	const koers = voertuigen.heading;
	const meshDraai = Math.atan2(Math.sin(slot.mesh.rotation.y - koers), Math.cos(slot.mesh.rotation.y - koers));
	if (!bijna(Math.abs(meshDraai), Math.PI, 1e-9)) {
		fout('motorrit', `de carrosserie staat ${nr(meshDraai)} rad op de rijkoers in plaats van een halve slag`);
	}

	const vanaf = voertuigen.ride;
	if (!vanaf) {
		fout('motorrit', 'de motor meldt geen rit terwijl er wel iemand op zit');
		return;
	}
	const stappen = Math.round(MOTORRIT_DUUR / RIT_DT);
	for (let stap = 0; stap < stappen; stap++) voertuigen.update(RIT_DT, { throttle: 1, steer: 0, boost: false });
	const naar = voertuigen.ride;
	if (!naar) {
		fout('motorrit', 'de rit is halverwege de proef opgehouden te bestaan');
		return;
	}

	// W is vooruit: de verplaatsing ligt op de voorwaartse as van de rijkoers, en niet
	// een halve slag ertegenin.
	const vooruitX = -Math.sin(koers);
	const vooruitZ = -Math.cos(koers);
	const dx = naar.x - vanaf.x;
	const dz = naar.z - vanaf.z;
	const langs = dx * vooruitX + dz * vooruitZ;
	const dwars = Math.abs(dx * -vooruitZ + dz * vooruitX);
	if (langs <= 0) {
		fout('motorrit', `met W erop komt de motor ${nr(-langs)} m achteruit; de rijrichting staat omgekeerd`);
	}
	if (dwars > MOTORRIT_KOERS) {
		fout('motorrit', `zonder stuur wijkt de motor ${nr(dwars)} m zijwaarts af van zijn eigen koers`);
	}
	const belooft = half(motor.accel * MOTORRIT_DUUR * MOTORRIT_DUUR);
	if (langs < belooft * MOTORRIT_RENDEMENT) {
		fout(
			'motorrit',
			`de motor legt in ${nr(MOTORRIT_DUUR)} s ${nr(langs)} m af terwijl zijn optrekvermogen ${nr(belooft)} m belooft`,
		);
	}

	// En hangen: de leun komt uit de zijwaartse versnelling, niet uit de stuuruitslag. Elke
	// eigenschap apart, want een || over drie voorwaarden drukt bij een terugval het verkeerde
	// getal af.
	const rijLeun = (gas: number): { v: number; omega: number; helling: number } => {
		const wereld = new CollisionWorld();
		const rit = new DriveableCars(wereld, new Barriers(wereld));
		const zadel = rit.nearestCar(new THREE.Vector3(plek.x, plek.y + 1, plek.z), 1);
		if (!zadel || !rit.board(zadel)) {
			fout('motorrit', `de leunproef kan bij ${plek.name} niet instappen`);
			return { v: 0, omega: 0, helling: 0 };
		}
		let yawVoor = rit.heading;
		for (let stap = 0; stap < MOTORRIT_LEUN_STAPPEN; stap++) {
			yawVoor = rit.heading;
			rit.update(RIT_DT, { throttle: gas, steer: 1, boost: false });
		}
		return { v: rit.speedKmh / 3.6, omega: (rit.heading - yawVoor) / RIT_DT, helling: zadel.mesh.rotation.z };
	};

	// Gestage bocht op deelgas, ruim onder de klemhoek: de motor hangt op de balanshoek
	// atan(v·ω/g). Een steer-maal-vaart-model haalde hier 0.06 rad waar de balans 0.32 vroeg.
	const bocht = rijLeun(MOTORRIT_LEUN_GAS);
	const balans = clamp(Math.atan2(bocht.v * bocht.omega, GRAVITY), -motor.maxLean, motor.maxLean);
	if (bocht.helling <= 0) {
		fout('motorrit', `in de bocht hangt de motor ${nr(bocht.helling)} rad, dus de andere kant op of niet`);
	}
	if (balans >= motor.maxLean) {
		fout(
			'motorrit',
			`de balansproef zit bij ${nr(bocht.v)} m/s met ${nr(balans)} rad al tegen de klemhoek ${nr(motor.maxLean)} rad en toetst zo de klem in plaats van de formule`,
		);
	}
	if (Math.abs(bocht.helling - balans) > MOTORRIT_LEUN_EPS) {
		fout(
			'motorrit',
			`de motor hangt ${nr(bocht.helling)} rad waar de balanshoek atan(v·ω/g) ${nr(balans)} rad vraagt bij ${nr(bocht.v)} m/s en ${nr(bocht.omega)} rad/s`,
		);
	}

	// Stapvoets vol sturen: de zijversnelling is verwaarloosbaar, dus de motor staat bijna recht.
	const kruip = rijLeun(MOTORRIT_KRUIP_GAS);
	if (Math.abs(kruip.helling) > MOTORRIT_KRUIP_LEUN) {
		fout(
			'motorrit',
			`bij stapvoets (${nr(kruip.v)} m/s) vol sturen hangt de motor ${nr(kruip.helling)} rad, meer dan de ${nr(MOTORRIT_KRUIP_LEUN)} rad die zo goed als recht toestaat`,
		);
	}

	// Nooit voorbij zijn eigen hoek, ook niet vol op snelheid: hij rijdt hier al zijn topsnelheid
	// recht, dan een paar frames de bocht in, waar de balanshoek ver boven de klem uitkomt en de
	// klem hem moet vangen.
	for (let stap = 0; stap < MOTORRIT_INZET; stap++) voertuigen.update(RIT_DT, { throttle: 1, steer: 1, boost: false });
	const volHelling = slot.mesh.rotation.z;
	if (volHelling <= 0) {
		fout('motorrit', `met vol stuur op snelheid hangt de motor ${nr(volHelling)} rad, dus de andere kant op of niet`);
	}
	if (Math.abs(volHelling) > motor.maxLean + EPS) {
		fout(
			'motorrit',
			`vol op snelheid hangt de motor ${nr(volHelling)} rad, voorbij de ${nr(motor.maxLean)} rad die op hem staat`,
		);
	}

	// Een edit tijdens het rijden bouwt de wereld en elk voertuig erin opnieuw op, en
	// de rit hoort dat te overleven: hij komt terug via de rit-soort van de auto's,
	// want de motor is een slot van dezelfde bouwer. Komt hij niet terug, dan sta je
	// te voet in de motor waar je op zat en loop je daar niet meer uit.
	const onderweg = voertuigen.ride;
	if (!onderweg) {
		fout('motorrit', 'de rit is voor de herbouwproef opgehouden te bestaan');
		return;
	}
	const herbouwd = new CollisionWorld();
	const opnieuw = new DriveableCars(herbouwd, new Barriers(herbouwd));
	if (!opnieuw.resume(onderweg)) {
		fout('motorrit', `na een herbouw is ${onderweg.id} niet terug te vinden om weer op te stappen`);
		return;
	}
	if (opnieuw.activeKind !== 'motorcycle') {
		fout('motorrit', `na een herbouw stap je op ${opnieuw.activeKind ?? 'niets'} in plaats van op de motor`);
	}
	const zadel = opnieuw.getSeatPosition();
	if (!bijna(Math.hypot(zadel.x - onderweg.x, zadel.z - onderweg.z), 0, MOTORRIT_ZADEL)) {
		fout(
			'motorrit',
			`na een herbouw zit je op (${nr(zadel.x)}, ${nr(zadel.z)}) terwijl de motor op (${nr(onderweg.x)}, ${nr(onderweg.z)}) staat`,
		);
	}

	// Uitgestapt is `ride` leeg, dus de actieve-ritroute kan de geparkeerde motor
	// niet herstellen. De aparte parkeerstand moet hetzelfde slot op dezelfde plek
	// terugzetten en de speler te voet laten, waarna E hem daar weer vindt.
	const refreshWereld = new CollisionWorld();
	const naRefresh = new DriveableCars(refreshWereld, new Barriers(refreshWereld));
	if (!naRefresh.restoreParked(onderweg)) {
		fout('motorrit', `na uitstappen en refresh is ${onderweg.id} niet terug te zetten`);
	} else {
		if (naRefresh.activeKind !== null)
			fout('motorrit', 'de geparkeerde motor zet de speler na refresh vanzelf weer in de rijstand');
		const teruggevonden = naRefresh.nearestCar(new THREE.Vector3(onderweg.x, onderweg.y + 1, onderweg.z), 1);
		if (!teruggevonden || teruggevonden.name !== onderweg.id) {
			fout('motorrit', `na uitstappen en refresh staat ${onderweg.id} niet meer op zijn parkeerplek`);
		}
	}
}

// ── 15b3b. beide motoren op het rode tapijt zijn te bestijgen ───────────────

/**
 * De motoren bij de hoofdingang waren decor van `Motorcycles`, zonder gekoppeld slot,
 * dus `nearestCar` vond daar niets en E deed niets. Ze zijn nu allebei een slot van
 * DriveableCars op V0; wie ernaast staat moet elk met E kunnen bestijgen. Er staan er
 * twee, want de melding was meervoud en één rijdbare naast één dood exemplaar levert
 * dezelfde verwarring nog een keer op.
 */
async function controleIngangMotor(): Promise<void> {
	if (ENTRANCE_RIDEABLE_MOTORCYCLES.length < 2) {
		fout('ingangmotor', `er staan ${ENTRANCE_RIDEABLE_MOTORCYCLES.length} rijdbare motoren bij de ingang in plaats van twee`);
	}
	stubDocument();
	const [THREE, { Barriers }, { DriveableCars }] = await Promise.all([
		import('three'),
		import('#/scene/city/Barriers'),
		import('#/scene/DriveableCars'),
	]);
	for (const motor of ENTRANCE_RIDEABLE_MOTORCYCLES) {
		if (levelAt(motor.y) !== 'v0') {
			fout('ingangmotor', `${motor.name} staat op ${levelAt(motor.y)} in plaats van op V0`);
		}
		const stad = new CollisionWorld();
		const voertuigen = new DriveableCars(stad, new Barriers(stad));
		const slot = voertuigen.nearestCar(new THREE.Vector3(motor.x, motor.y + 1, motor.z), 1);
		if (!slot || slot.name !== motor.name) {
			fout('ingangmotor', `op het rode tapijt staat ${slot ? slot.name : 'niets'} in plaats van ${motor.name} om in te stappen`);
			continue;
		}
		if (!voertuigen.board(slot) || voertuigen.activeKind !== 'motorcycle') {
			fout('ingangmotor', `E op ${motor.name} levert ${voertuigen.activeKind ?? 'niets'} op`);
			continue;
		}
		// De motor wijst de deuren op: op W rijdt hij de straat op (−x), niet het atrium in.
		if (-Math.sin(voertuigen.heading) >= 0) {
			fout('ingangmotor', `${motor.name} rijdt op W naar +x het atrium in in plaats van de deuren uit`);
		}
	}
}

// ── 15b4. het geulverkeer en de speler ─────────────────────────────────────

/** Zo lang draait de verkeersproef, in seconden. Ruim boven de klok tussen twee inritten. */
const GEUL_DUUR = 120;
/** Stap van de verkeersproef. Grover dan een frame, want er wordt twee minuten mee gedraaid. */
const GEUL_DT = 1 / 30;
/** Zo lang staat elke lichtfase in de proef. */
const GEUL_FASE = 10;
/** Waar de proefvoetganger op de inrit staat. */
const GEUL_VOETGANGER_X = -40;
/** Zoveel meter voorbij hem telt als "erdoorheen gereden". */
const GEUL_MARGE = 1;

/** Hoe diep de geul in het verkeer komt, met of zonder iemand op de helling. */
async function diepsteAuto(voetganger: { x: number; y: number; z: number } | null): Promise<number> {
	const [{ Barriers }, { CityTraffic }] = await Promise.all([
		import('#/scene/city/Barriers'),
		import('#/scene/city/CityTraffic'),
	]);
	const stad = new CollisionWorld();
	const bomen = new Barriers(stad);
	let klok = 0;
	const verkeer = new CityTraffic(() => (Math.floor(klok / GEUL_FASE) % 2 === 0 ? 'ns' : 'ew'), bomen);
	verkeer.setObstacleProvider(() => voetganger);
	let diepste = Number.NEGATIVE_INFINITY;
	for (let stap = 0; stap < Math.ceil(GEUL_DUUR / GEUL_DT); stap++) {
		klok = stap * GEUL_DT;
		bomen.update(GEUL_DT);
		verkeer.update(GEUL_DT, klok);
		for (const auto of verkeer.group.children) {
			if (auto.position.y > -0.5) continue;
			diepste = Math.max(diepste, auto.position.x);
		}
	}
	verkeer.dispose();
	return diepste;
}

/**
 * Een auto op de aftakking remt voor de speler zoals hij voor een voorligger remt.
 *
 * Op de ring deed hij dat al; op de inrit keek hij naar niets en reed hij je van de
 * helling. Deze controle rijdt dezelfde twee minuten twee keer: één keer met een
 * lege helling, zodat er echt een auto de geul in gaat, en één keer met iemand erop.
 */
async function controleGeulverkeer(): Promise<void> {
	stubDocument();
	const leeg = await diepsteAuto(null);
	if (leeg < PARKING_EXIT_RAMP.start.x) {
		fout(
			'geulverkeer',
			`in ${GEUL_DUUR} s komt er geen auto voorbij x ${nr(PARKING_EXIT_RAMP.start.x)}, dus de proef toetst niets`,
		);
		return;
	}
	const bezet = await diepsteAuto({
		x: GEUL_VOETGANGER_X,
		y: parkingExitRampY(GEUL_VOETGANGER_X),
		z: EXIT_LANE_OFFSET,
	});
	if (bezet > GEUL_VOETGANGER_X - GEUL_MARGE) {
		fout(
			'geulverkeer',
			`met iemand op de helling op x ${nr(GEUL_VOETGANGER_X)} rijdt een auto tot x ${nr(bezet)} en dus door hem heen`,
		);
	}
}

// ── 15c. de kaart noemt wat ze tekent ──────────────────────────────────────

/**
 * Elk kaartlabel wordt ook echt getekend.
 *
 * `controleFeatures` toetst dat er een labeltekst ís, en dat is groen gebleven terwijl
 * de kaart niets tekende: P · TICKETS werd op alle vijf de plekken tegen de 2,2 m van
 * het loket zelf gemeten en viel stil weg. Op de schotel gebeurde hetzelfde met de
 * hoofdingang, waarvan het ankerpunt vanaf de stoep ervóór een halve pixel buiten de
 * cirkel viel.
 *
 * Gemeten wordt met de stub-tekstmeter, die ruimer meet dan een echte monospace op de
 * maten die de kaart gebruikt. Wat hier past, past in de browser dus ook.
 */
function controleKaartlabels(): void {
	const meter = stubTextMeasure();
	for (const dek of LEVELS) {
		for (const naam of deckLabelPlan(meter, dek.id, BIG_MAP_MIN_WIDTH).unfittable) {
			fout('kaartlabels', `op de plattegrond van ${dek.code} past "${naam}" nergens, dus tekent de kaart hem niet`);
		}
	}

	// En de schotel noemt de hoofdingang voluit vanaf het enige standpunt buiten de
	// gevel dat het project levert. Daar stond zijn vak leeg naast een wél gelabelde
	// uitrit, omdat het ankerpunt van de ingang een halve pixel buiten de cirkel viel
	// en wat er dan nog overbleef in een afkapping paste en niet in een naam.
	const { pose } = profilePoint(INGANG_STANDPUNT);
	const view = {
		x: pose.x,
		z: pose.z,
		yaw: Math.atan2(-span(pose.x, pose.lookX), -span(pose.z, pose.lookZ)),
		level: levelAt(pose.y),
	};
	const genoemd = minimapLabelPlan(meter, view).plan;
	const ingang = genoemd.find((label) => label.text === ENTRANCE_LABEL);
	if (!ingang) {
		fout(
			'kaartlabels',
			`vanaf ${INGANG_STANDPUNT} noemt de schotel de hoofdingang niet; ze tekent er ${genoemd.length === 0 ? 'niets' : genoemd.map((label) => label.text).join(', ')}`,
		);
	} else if (!ingang.label.whole) {
		fout(
			'kaartlabels',
			`vanaf ${INGANG_STANDPUNT} tekent de schotel de hoofdingang als "${ingang.label.lines.join(' ')}" in plaats van voluit`,
		);
	}
}

// ── 16. de gedeelde rekenhulpen ────────────────────────────────────────────
// Een tweede kopie van een maat is waar dit script om begonnen is, en een
// tweede kopie van `half` heet `x / 2`. Die groeit even hard terug. util/math
// en util/geometry2 stonden er al terwijl het halve project er nog langsrekende:
// zelf door twee delen, klemmen met een geneste Math.max/Math.min, of
// THREE.MathUtils aanroepen naast de eigen clamp en lerp. Vandaar deze greep
// door de bron, in dezelfde vorm als de PointLight-greep in check-lights.
//
// Delen door twee wordt overal afgekeurd, want dat is altijd halveren. Alleen
// `Math.PI / 2` blijft staan, want dat is een kwartslag, en dat is de enige
// vorm die deze controle om zijn bouw vrijstelt. Vermenigvuldigen met 0.5 krijgt
// die vrijstelling niet: `Math.PI * 0.5` is door de hele boom omgeschreven naar
// `Math.PI / 2`, dus elke `* 0.5` in code is een treffer.
//
// De maatnamen-heuristiek die hier stond keek naar de linkerkant en meldde
// alleen een halvering van w, len, breedte of straal. Die 0.5 is door de hele
// scene juist een sterkte (demping, amplitude, spreiding, mengfactor), en dat
// is precies wat de linkerkant nooit verraadt, dus liep het merendeel er langs.
// Ze staan nu als benoemde constanten bovenin hun eigen bestand.
//
// Commentaar, string-, template- en regexliterals worden geblankt voor het
// zoeken, zodat proza over π/2 en de meldingen hieronder zelf niet meetellen. De
// expressies in `${...}` blijven wél staan, want dat is code.
//
// Regexliterals horen erbij sinds check-world zichzelf tegenkwam. Hier stond
// dat er geen regex in de boom staat die de scanner raakt; twintig regels boven
// die zin zoekt `controleKaartdekken` met `/data-level="([^"]+)"/`, en die drie
// aanhalingstekens openden een string die pas veel later sloot. Alles erna stond
// een quote uit de pas: code werd stringinhoud en stringinhoud werd code.

const REKEN_EIGENAAR = 'src/util/math.ts';

/** Bestanden die geen enkele hulpfunctie kúnnen importeren. */
const REKEN_VRIJE_BESTANDEN: { pad: string; reden: string }[] = [
	{
		pad: 'scripts/perf/probe.ts',
		reden:
			'installProbe wordt gestringificeerd en met addScriptToEvaluateOnNewDocument in de pagina gezet, waar geen import bestaat',
	},
];

/**
 * Plekken waar de vorm klopt maar de betekenis niet. Elke regel hier is één
 * beoordeling van één plek. Staat het fragment niet meer in zijn bestand, dan
 * meldt de controle dat de uitzondering weg kan.
 */
const REKEN_UITZONDERINGEN: { pad: string; fragment: string; reden: string }[] = [
	{ pad: 'src/scene/Americans.ts', fragment: 'Math.floor(id / 2)', reden: 'koppelt een id aan een index, geen maat' },
	{
		pad: 'src/scene/Americans.ts',
		fragment: 'Math.min(lead.pathI, Math.max(0, lead.path.length - 1))',
		reden: 'de binnenste max rekent de bovengrens uit, hij klemt de waarde niet',
	},
	{
		pad: 'src/audio/DJPlayer.ts',
		fragment: 'Math.min(seekTo, Math.max(0, this.audio.duration - 0.5))',
		reden: 'de binnenste max vloert de duur, de buitenste min begrenst een andere waarde',
	},
	{ pad: 'src/scene/PoolPeople.ts', fragment: 'RECLINE / 2', reden: 'halveert een hoek; half() gaat over een maat' },
	{ pad: 'src/scene/PrayerRoom.ts', fragment: '(phrase - 6) / 2', reden: 'schaalt een venster van twee tellen naar 0..1' },
	{ pad: 'src/scene/PrayerRoom.ts', fragment: '(phrase - 14) / 2', reden: 'hetzelfde venster, tweede zin' },
	{ pad: 'src/scene/RoofIsland.ts', fragment: 'Math.abs(sum) / 2', reden: 'de constante van de schoenveterformule zelf' },
	{
		pad: 'src/scene/Walkways.ts',
		fragment: 'tex.repeat.set(1, len / 2)',
		reden: 'een tegelaantal over een tegel van twee meter',
	},
];

/** Delen door twee is altijd halveren; alleen `Math.PI / 2` is een kwartslag en geen maat. */
const DEEL_DOOR_TWEE = /(?<!\\)\/\s*2(?![\w.])/g;
const KWARTSLAG = /Math\s*\.\s*PI\s*$/;
/** Elke losse 0.5 als factor, wat er ook links van staat. */
const MAAL_HALF = /\*\s*0\.5(?![\w.])/g;
const MATHUTILS = /\bMathUtils\s*\./g;
const KLEM_AANROEP = /\b(Math\s*\.\s*(?:max|min))\s*\(/g;
const KLEM_BINNEN_MIN = /^Math\s*\.\s*min\s*\(/;
const KLEM_BINNEN_MAX = /^Math\s*\.\s*max\s*\(/;

type Rekentreffer = { index: number; melding: string };

/** Elk .ts-bestand onder `map`, als pad vanaf de repowortel. */
function rekenBestanden(map: string): string[] {
	const uit: string[] = [];
	for (const item of readdirSync(new URL(`../${map}/`, import.meta.url), { withFileTypes: true })) {
		const pad = `${map}/${item.name}`;
		if (item.isDirectory()) uit.push(...rekenBestanden(pad));
		else if (item.name.endsWith('.ts')) uit.push(pad);
	}
	return uit;
}

/**
 * Een literal vanaf zijn openingsquote blanken; geeft de index ná de sluitquote
 * terug. Een `${` in een template springt terug naar code, want daar staat de
 * rekenkunde die deze controle juist moet zien.
 */
function blankLiteral(tekst: string, uit: string[], start: number, quote: string): number {
	uit[start] = ' ';
	let i = start + 1;
	while (i < tekst.length) {
		const teken = tekst[i];
		if (teken === '\\') {
			blankBereik(tekst, uit, i, i + 2);
			i += 2;
			continue;
		}
		if (teken === quote) {
			uit[i] = ' ';
			return i + 1;
		}
		if (quote === '`' && tekst.startsWith('${', i)) {
			blankBereik(tekst, uit, i, i + 2);
			i = codeInTemplate(tekst, uit, i + 2);
			continue;
		}
		blankBereik(tekst, uit, i, i + 1);
		i++;
	}
	return i;
}

function blankBereik(tekst: string, uit: string[], van: number, tot: number): void {
	for (let i = van; i < tot && i < uit.length; i++) {
		if (tekst[i] !== '\n') uit[i] = ' ';
	}
}

/** Na deze tekens opent een `/` een patroon; na een naam, een getal of een sluithaakje deelt hij. */
const PATROON_MAG_NA_TEKEN = new Set([
	'(',
	',',
	'=',
	':',
	'[',
	'!',
	'&',
	'|',
	'?',
	'{',
	'}',
	';',
	'+',
	'-',
	'*',
	'%',
	'^',
	'~',
	'<',
	'>',
]);
const PATROON_MAG_NA_WOORD = /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|instanceof|do|else|void|yield|await)$/;

/** De laatste tekens code zonder witruimte: genoeg om te zien wat een `/` betekent. */
function onthoudCode(staart: string, teken: string): string {
	if (teken === ' ' || teken === '\t' || teken === '\n' || teken === '\r') return staart;
	return (staart + teken).slice(-12);
}

function opentPatroon(staart: string): boolean {
	if (staart === '') return true;
	return PATROON_MAG_NA_TEKEN.has(staart.slice(-1)) || PATROON_MAG_NA_WOORD.test(staart);
}

/**
 * Een regexliteral vanaf zijn opening-slash blanken; geeft de index ná de vlaggen
 * terug. Loopt de slash tegen een regeleinde aan, dan was het een deling en komt
 * de index vlak achter de slash terug zonder dat er iets geblankt is.
 */
function blankPatroon(tekst: string, uit: string[], start: number): number {
	let i = start + 1;
	let inKlasse = false;
	let gesloten = false;
	while (i < tekst.length) {
		const teken = tekst[i];
		if (teken === '\n') break;
		if (teken === '\\') {
			i += 2;
			continue;
		}
		if (teken === '[') inKlasse = true;
		else if (teken === ']') inKlasse = false;
		else if (teken === '/' && !inKlasse) {
			i++;
			gesloten = true;
			break;
		}
		i++;
	}
	if (!gesloten) return start + 1;
	while (i < tekst.length && PATROON_VLAG.test(tekst[i] ?? '')) i++;
	blankBereik(tekst, uit, start, i);
	return i;
}

const PATROON_VLAG = /^[dgimsuvy]$/;

/** De expressie in `${...}` intact laten en de sluitaccolade teruggeven. */
function codeInTemplate(tekst: string, uit: string[], start: number): number {
	let diepte = 1;
	let i = start;
	let staart = '';
	while (i < tekst.length) {
		const teken = tekst[i];
		if (teken === "'" || teken === '"' || teken === '`') {
			i = blankLiteral(tekst, uit, i, teken);
			staart = onthoudCode(staart, 'x');
			continue;
		}
		if (teken === '/' && opentPatroon(staart)) {
			const na = blankPatroon(tekst, uit, i);
			if (na > i + 1) {
				i = na;
				staart = onthoudCode(staart, 'x');
				continue;
			}
		}
		if (teken === '{') diepte++;
		else if (teken === '}') {
			diepte--;
			if (diepte === 0) {
				uit[i] = ' ';
				return i + 1;
			}
		}
		if (teken !== undefined) staart = onthoudCode(staart, teken);
		i++;
	}
	return i;
}

/** Dezelfde tekst, even lang en met dezelfde regelovergangen, maar zonder commentaar en literals. */
function zonderTekst(tekst: string): string {
	// split('') en niet [...tekst]: de spread telt codepoints, en één emoji in een
	// string verschuift dan elke index erna ten opzichte van de regexpositie.
	const uit = tekst.split('');
	let i = 0;
	let staart = '';
	while (i < tekst.length) {
		if (tekst.startsWith('//', i)) {
			const eind = tekst.indexOf('\n', i);
			const tot = eind < 0 ? tekst.length : eind;
			blankBereik(tekst, uit, i, tot);
			i = tot;
			continue;
		}
		if (tekst.startsWith('/*', i)) {
			const eind = tekst.indexOf('*/', i + 2);
			const tot = eind < 0 ? tekst.length : eind + 2;
			blankBereik(tekst, uit, i, tot);
			i = tot;
			continue;
		}
		const teken = tekst[i];
		if (teken === "'" || teken === '"' || teken === '`') {
			i = blankLiteral(tekst, uit, i, teken);
			staart = onthoudCode(staart, 'x');
			continue;
		}
		if (teken === '/' && opentPatroon(staart)) {
			const na = blankPatroon(tekst, uit, i);
			if (na > i + 1) {
				i = na;
				staart = onthoudCode(staart, 'x');
				continue;
			}
		}
		if (teken !== undefined) staart = onthoudCode(staart, teken);
		i++;
	}
	return uit.join('');
}

/** Of het hele argument één aanroep is, en niet een aanroep binnen een som of een deling. */
function isHeleAanroep(arg: string): boolean {
	const open = arg.indexOf('(');
	if (open < 0) return false;
	let diepte = 0;
	for (let i = open; i < arg.length; i++) {
		if (arg[i] === '(') diepte++;
		else if (arg[i] === ')') {
			diepte--;
			if (diepte === 0) return i === arg.length - 1;
		}
	}
	return false;
}

function rekentreffers(code: string): Rekentreffer[] {
	const uit: Rekentreffer[] = [];

	for (const treffer of code.matchAll(DEEL_DOOR_TWEE)) {
		if (KWARTSLAG.test(code.slice(0, treffer.index))) continue;
		uit.push({ index: treffer.index, melding: 'deelt zelf door twee. Gebruik half() uit util/math' });
	}

	for (const treffer of code.matchAll(MAAL_HALF)) {
		uit.push({
			index: treffer.index,
			melding:
				'vermenigvuldigt met een losse 0.5. Een kwartslag schrijf je `Math.PI / 2`, een maat halveer je met half() uit util/math, en een afstelfactor wordt een benoemde constante bovenin het bestand',
		});
	}

	for (const treffer of code.matchAll(MATHUTILS)) {
		uit.push({
			index: treffer.index,
			melding:
				'roept MathUtils aan. clamp en lerp staan in util/math met dezelfde argumentvolgorde; heb je damp of mapLinear nodig, zet die er dan bij of vraag een uitzondering aan in REKEN_UITZONDERINGEN',
		});
	}

	for (const aanroep of aanroepArgumenten(code, KLEM_AANROEP)) {
		if (aanroep.args.length !== 2) continue;
		const binnen = aanroep.naam.includes('max') ? KLEM_BINNEN_MIN : KLEM_BINNEN_MAX;
		if (!aanroep.args.some((arg) => binnen.test(arg) && isHeleAanroep(arg))) continue;
		uit.push({
			index: aanroep.index,
			melding: 'klemt met een geneste Math.max/Math.min. Gebruik clamp() of clamp01() uit util/math',
		});
	}

	return uit;
}

type Vrijstelling = { pad: string; fragment: string; reden: string };

type Greep = {
	naam: string;
	bestanden: readonly string[];
	vrij: readonly { pad: string; reden: string }[];
	uitzonderingen: readonly Vrijstelling[];
	treffers: (code: string, pad: string) => Rekentreffer[];
};

/**
 * Eén greep door de bron met de tabellen eromheen: een vrijgesteld bestand moet
 * bestaan, een uitzondering moet iets raken, en een melding draagt regelnummer
 * en de regel zelf mee. Beide grepen hieronder delen deze lus, want twee kopieën
 * ervan zouden precies de fout zijn die ze samen bewaken.
 */
function greepDoorBron(greep: Greep): void {
	const gebruikt = new Set<string>();

	for (const vrij of greep.vrij) {
		if (!greep.bestanden.includes(vrij.pad)) fout(greep.naam, `vrijgesteld bestand ${vrij.pad} bestaat niet meer`);
	}

	for (const pad of greep.bestanden) {
		if (greep.vrij.some((v) => v.pad === pad)) continue;
		const code = zonderTekst(readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8'));
		const regels = code.split('\n');
		// Eén definitie past soms op twee vormen tegelijk — `function roundRect(…) {`
		// is ook de methodevorm. Dezelfde melding op dezelfde regel is dan één klacht.
		const gemeld = new Set<string>();
		for (const treffer of greep.treffers(code, pad)) {
			const regelnr = code.slice(0, treffer.index).split('\n').length;
			const regel = regels[regelnr - 1] ?? '';
			const vrijstelling = greep.uitzonderingen.find((u) => u.pad === pad && regel.includes(u.fragment));
			if (vrijstelling) {
				gebruikt.add(`${vrijstelling.pad}|${vrijstelling.fragment}`);
				continue;
			}
			const klacht = `${regelnr}|${treffer.melding}`;
			if (gemeld.has(klacht)) continue;
			gemeld.add(klacht);
			fout(greep.naam, `${pad}:${regelnr} ${treffer.melding} — \`${regel.trim()}\``);
		}
	}

	for (const uitzondering of greep.uitzonderingen) {
		if (!gebruikt.has(`${uitzondering.pad}|${uitzondering.fragment}`)) {
			fout(greep.naam, `de uitzondering voor \`${uitzondering.fragment}\` in ${uitzondering.pad} raakt niets meer en kan weg`);
		}
	}
}

/** Elk .ts-bestand van de twee partities die langs de hulpen heen rekenden. */
function bronBestanden(): string[] {
	return [...rekenBestanden('src'), ...rekenBestanden('scripts')];
}

/**
 * De greep zelf. Draait over src/ én scripts/, want beide partities rekenden
 * langs dezelfde hulpen heen.
 */
function controleRekenhulpen(): void {
	let bijEigenaar = 0;

	greepDoorBron({
		naam: 'rekenhulpen',
		bestanden: bronBestanden(),
		vrij: REKEN_VRIJE_BESTANDEN,
		uitzonderingen: REKEN_UITZONDERINGEN,
		treffers: (code, pad) => {
			const treffers = rekentreffers(code);
			if (pad !== REKEN_EIGENAAR) return treffers;
			bijEigenaar = treffers.length;
			return [];
		},
	});

	if (bijEigenaar === 0) {
		fout('rekenhulpen', `${REKEN_EIGENAAR} bevat geen enkele halvering of klem meer. Zijn de hulpen hernoemd of verhuisd?`);
	}
}

// ── 16b. een tikklok vraagt naar zijn eigen actoren ────────────────────────
// Elke `sees(...)` in de frameloop had zijn dek een tweede keer opgeschreven:
// de dief, het protest, de rat, Wei, de pinguïns en de catwalk stonden alle zes
// hard op 'mall-v0' en het stadsblok op 'stad'. Niets hield dat tegen de plek
// waar die dingen werkelijk staan, dus Wei die de roltrap op loopt en een auto
// die de geul in rijdt bleven tikken op een dek waar ze niet meer waren. Alleen
// de aap leidde zijn zone af, en de comment daar liet zien dat het verschil
// bekend was.
//
// `zonderTekst` blankt een literal inclusief zijn quotes, dus een zichtvraag
// waarvan het hele argument tekst was blijft over als een leeg haakjespaar. Dat
// is precies de vorm die verboden is.

const ZONEKLOK_PATROON = /\bsees[A-Za-z]*\s*\(\s*\)/g;

/** Bestanden die de zichtvraag zelf uitdelen in plaats van hem te stellen. */
const ZONEKLOK_VRIJE_BESTANDEN: { pad: string; reden: string }[] = [];

const ZONEKLOK_UITZONDERINGEN: Vrijstelling[] = [];

function controleZoneklokken(): void {
	greepDoorBron({
		naam: 'zoneklokken',
		bestanden: rekenBestanden('src'),
		vrij: ZONEKLOK_VRIJE_BESTANDEN,
		uitzonderingen: ZONEKLOK_UITZONDERINGEN,
		treffers: (code) =>
			[...code.matchAll(ZONEKLOK_PATROON)].map((treffer) => ({
				index: treffer.index,
				melding: 'vraagt de zichtbaarheid van een opgeschreven zone. Leid hem af uit waar het systeem staat',
			})),
	});
}

// ── 16c. geen gespiegelde tekst ────────────────────────────────────────────
// `side: THREE.DoubleSide` op een materiaal met een textuur laat je van achteren
// diezelfde textuur zien, en die staat dan gespiegeld. Het taxidak las IXAT, het
// vaandel van de AL ZUT-crew TUZ LA, het TIKI BAR-bord spiegelde vanaf de bar en de
// WET FLOOR-plaat op de schrobber deed hetzelfde. Twee vlakken rug aan rug lezen
// allebei van links naar rechts: `backToBackLabel` in util/label.
//
// Gemeten wordt élk materiaal met zowel een `map` als DoubleSide, want of er tekst
// in die textuur zit is niet te grepen. Wat er geen tekst in heeft — vlaggen,
// gezichten, bladeren, water — staat in de tabel hieronder met de reden erbij, en
// een rij die niets meer raakt is zelf een bouwfout.

const SPIEGEL_VRIJE_BESTANDEN: { pad: string; reden: string }[] = [];

const SPIEGEL_UITZONDERINGEN: Vrijstelling[] = [
	{
		pad: 'src/scene/ProtestGroupies.ts',
		fragment: 'map: tex,',
		reden: 'de Duitse vlag is drie kleurbanen; gespiegeld staat er nog steeds zwart-rood-goud',
	},
	{
		pad: 'src/scene/ProtestGroupies.ts',
		fragment: 'map: this.makePrideFlagTex(kind),',
		reden: 'een regenboogvlag is gestreept en leest van beide kanten hetzelfde',
	},
	{
		pad: 'src/scene/ProtestGroupies.ts',
		fragment: 'map,',
		reden:
			'de gezichtsatlas hangt aan één InstancedMesh met een eigen tegel-shader; twee vlakken rug aan rug zijn daar geen vlakken maar tweemaal de zwerm',
	},
];

/** Het omvattende objectliteral van `index`: de eerste `{` links die nog niet gesloten is. */
function omvattendLiteral(code: string, index: number): { van: number; tot: number } | null {
	let diepte = 0;
	let van = -1;
	for (let i = index; i >= 0; i--) {
		const teken = code[i];
		if (teken === '}') diepte++;
		else if (teken === '{') {
			if (diepte === 0) {
				van = i;
				break;
			}
			diepte--;
		}
	}
	if (van < 0) return null;
	diepte = 0;
	for (let i = van; i < code.length; i++) {
		const teken = code[i];
		if (teken === '{') diepte++;
		else if (teken === '}') {
			diepte--;
			if (diepte === 0) return { van, tot: i };
		}
	}
	return null;
}

const DUBBELZIJDIG = /\bTHREE\s*\.\s*DoubleSide\b/g;
/** `map: tex` en de verkorte vorm `map,` zijn dezelfde eigenschap. */
const TEXTUUR_EIGENSCHAP = /\bmap\s*[:,}]/;

const SPIEGEL_MELDING =
	'is een textuur op een dubbelzijdig vlak; van achteren leest hij gespiegeld. Zet twee vlakken rug aan rug';

/** `naam.map = ` en `naam.side = THREE.DoubleSide`: dezelfde twee eigenschappen, los toegekend. */
const TEXTUUR_TOEKENNING = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.map\s*=[^=]/g;
const ZIJDE_TOEKENNING = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.side\s*=\s*THREE\s*\.\s*DoubleSide\b/g;

/** De declaratie van deze naam, tot aan de puntkomma die haar afsluit. */
function declaratieVan(code: string, naam: string): string | null {
	const patroon = new RegExp(String.raw`\b(?:const|let|var)\s+${naam.replaceAll('.', String.raw`\.`)}\b[^;]*`);
	return patroon.exec(code)?.[0] ?? null;
}

/**
 * Een textuur op een vlak dat van twee kanten te zien is.
 *
 * Twee eigenschappen op één materiaal, en ze hoeven niet in hetzelfde literal te
 * staan: `mat.map = tex` een paar regels verderop is dezelfde textuur, en
 * `mat.side = THREE.DoubleSide` dezelfde dubbele zijde. De greep las alleen het
 * omvattende literal en zag zo'n toekenning dus niet, terwijl de regel die hij
 * handhaaft breder is dan die vorm.
 */
function spiegeltreffers(code: string): Rekentreffer[] {
	const treffers: Rekentreffer[] = [];
	const dubbelzijdigeNamen = new Set<string>();
	for (const zijde of code.matchAll(ZIJDE_TOEKENNING)) {
		const naam = zijde[1];
		if (naam !== undefined) dubbelzijdigeNamen.add(naam);
	}
	for (const dubbel of code.matchAll(DUBBELZIJDIG)) {
		const literal = omvattendLiteral(code, dubbel.index);
		if (!literal) continue;
		const inhoud = code.slice(literal.van, literal.tot + 1);
		const textuur = TEXTUUR_EIGENSCHAP.exec(inhoud);
		if (textuur) {
			treffers.push({ index: literal.van + textuur.index, melding: SPIEGEL_MELDING });
			continue;
		}
		// Geen textuur in dit literal, maar de naam waar het aan hangt kan er later
		// alsnog een krijgen. Zonder dit blijft de greep aan de vorm hangen in plaats
		// van aan de regel.
		const declaratie = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;]*$/.exec(code.slice(0, literal.van));
		const naam = declaratie?.[1];
		if (naam !== undefined) dubbelzijdigeNamen.add(naam);
	}
	for (const textuur of code.matchAll(TEXTUUR_TOEKENNING)) {
		const naam = textuur[1];
		if (naam === undefined) continue;
		const declaratie = declaratieVan(code, naam);
		const dubbelzijdig = dubbelzijdigeNamen.has(naam) || (declaratie !== null && DUBBELZIJDIG.test(declaratie));
		DUBBELZIJDIG.lastIndex = 0;
		if (!dubbelzijdig) continue;
		treffers.push({ index: textuur.index, melding: SPIEGEL_MELDING });
	}
	return treffers;
}

function controleSpiegeltekst(): void {
	greepDoorBron({
		naam: 'spiegeltekst',
		bestanden: rekenBestanden('src'),
		vrij: SPIEGEL_VRIJE_BESTANDEN,
		uitzonderingen: SPIEGEL_UITZONDERINGEN,
		treffers: (code) => spiegeltreffers(code),
	});
}

// ── 16d. de wc-spiegels hangen op een dichte wand, niet op de opening ──────
// De damesspiegel hing op z −2.55, de open noordzijde van het blok: een muur die
// niet bestaat. Hij hoort boven de wastafels tegen een dichte wand uit de schil.
// Elke spiegel noemt die wand; deze arm leest het wandvolume uit RESTROOMS_ENTITY
// en eist dat de rug op het binnenvlak ligt en de spiegel binnen dat vlak past.

const SPIEGEL_WAND_VOLUME: Record<string, string> = {
	south: 'wall-south',
	east: 'wall-east',
	west: 'wall-west',
};

function controleSpiegelwand(): void {
	const entity = ENTITEIT_PER_ID.get('restrooms');
	if (!entity) {
		fout('spiegelwand', 'restrooms staat niet meer in WORLD_ENTITIES');
		return;
	}
	const binnenVlak = (id: string, min: number, max: number, wandMin: number, wandMax: number, as: string): void => {
		if (min < wandMin - EPS || max > wandMax + EPS) {
			fout(
				'spiegelwand',
				`${id}: reikt in ${as} van ${nr(min)} tot ${nr(max)}, buiten de wand (${nr(wandMin)} tot ${nr(wandMax)})`,
			);
		}
	};
	for (const m of RESTROOMS_MIRRORS) {
		const wandId = SPIEGEL_WAND_VOLUME[m.wall];
		if (wandId === undefined) {
			fout('spiegelwand', `${m.id} hangt op '${m.wall}', geen dichte wand van de schil maar de opening`);
			continue;
		}
		const wand = entity.volumes.find((v) => v.id === wandId);
		if (!wand) {
			fout('spiegelwand', `${m.id} verwijst naar wand '${wandId}', die niet meer bestaat`);
			continue;
		}
		if (!wand.blocksMovement || wand.role !== 'solid') {
			fout(
				'spiegelwand',
				`${m.id} hangt op '${wandId}', geen dichte wand (role ${wand.role}, blocksMovement ${wand.blocksMovement})`,
			);
			continue;
		}
		const b = geometryBounds(wand.geometry);
		const wx = RESTROOMS_SPEC.center.x + m.x;
		const wz = RESTROOMS_SPEC.center.z + m.z;
		const halfDik = half(m.thickness);
		const halfBr = half(m.width);
		if (m.wall === 'south') {
			if (!bijna(wz + halfDik, b.minZ)) {
				fout('spiegelwand', `${m.id}: de rug ligt op z ${nr(wz + halfDik)}, niet tegen ${wandId} op ${nr(b.minZ)}`);
			}
			binnenVlak(m.id, wx - halfBr, wx + halfBr, b.minX, b.maxX, 'x');
		} else {
			const binnen = m.wall === 'east' ? b.minX : b.maxX;
			const rug = m.wall === 'east' ? wx + halfDik : wx - halfDik;
			if (!bijna(rug, binnen)) {
				fout('spiegelwand', `${m.id}: de rug ligt op x ${nr(rug)}, niet tegen ${wandId} op ${nr(binnen)}`);
			}
			binnenVlak(m.id, wz - halfBr, wz + halfBr, b.minZ, b.maxZ, 'z');
		}
		binnenVlak(m.id, V0 + m.y - half(m.height), V0 + m.y + half(m.height), b.minY, b.maxY, 'y');
	}
}

// ── 17. geen tweede kopie van een gedeelde hulp ────────────────────────────
// De rekenhulpen hierboven bewaken het uitrékenen; dit bewaakt het opnieuw
// opschrijven. roundRect stond zeven keer woord voor woord in de boom,
// mulberry32 vier keer en isTypingTarget twee keer, en de enige regel die
// ernaar keek greep één bestand af op één naam — een kopie in het bestand
// ernaast liep er dus langs.
//
// De namen komen uit src/util zelf en niet uit een lijst hier, zodat een hulp
// die morgen bijkomt zichzelf vanaf zijn eerste regel bewaakt. Naast de namen
// staan de vormen die een hulp bezit maar die geen naam dragen zodra je ze
// uitschrijft: de sprong rond nul van jitter, de spiegeling van plusMinus en de
// easefactor van easeFactor.
//
// Alleen definities tellen, geen aanroepen. Een naam telt als opnieuw
// gedefinieerd bij `function naam`, bij `naam(...) {` als methode, en bij een
// toewijzing van een pijl- of functie-expressie aan die naam.

const KOPIE_HULPMAP = 'src/util';

/** Bestanden die geen enkele hulp kúnnen importeren, of die er juist over gaan. */
const KOPIE_VRIJE_BESTANDEN: { pad: string; reden: string }[] = [
	{
		pad: 'scripts/perf/probe.ts',
		reden:
			'installProbe wordt gestringificeerd en met addScriptToEvaluateOnNewDocument in de pagina gezet, waar geen import bestaat',
	},
	{
		pad: 'scripts/math.test.ts',
		reden: 'de test schrijft de expressies uit die de hulpen bezitten; dat uitschrijven ís waar hij ze mee bewijst',
	},
];

/**
 * Plekken waar de vorm klopt maar de betekenis niet. Zelfde afspraak als bij de
 * rekenhulpen: één regel is één beoordeling van één plek, en een regel die niets
 * meer raakt is zelf een fout.
 */
const KOPIE_UITZONDERINGEN: Vrijstelling[] = [
	{
		pad: 'src/scene/MallBuilder.ts',
		fragment: 'const x = (t - 0.5) * span',
		reden: 't loopt in gelijke stappen van 0 naar 1 over de bemanning; er wordt niets getrokken om rond nul te spreiden',
	},
	{
		pad: 'src/scene/Americans.ts',
		fragment: 'Math.min(1, dt * 6 || 1)',
		reden: 'de `|| 1` maakt er een andere som van: bij dt 0 geeft easeFactor 0 en deze 1, en de mond klapt dan dicht',
	},
];

/** Vormen die een hulp bezit maar die geen naam dragen zodra je ze uitschrijft. */
const KOPIE_VORMEN: { hulp: string; patroon: RegExp; melding: string }[] = [
	{
		hulp: 'jitterWith',
		patroon: /-\s*0\.5\s*\)\s*\*/g,
		melding: 'schrijft de sprong rond nul zelf uit. Gebruik jitter() of jitterWith() uit util/rand',
	},
	{
		hulp: 'plusMinusWith',
		patroon: /\*\s*2\s*-\s*1\s*\)\s*\*/g,
		melding: 'schrijft de spiegeling rond nul zelf uit. Gebruik plusMinus() of plusMinusWith() uit util/rand',
	},
];

/** De aanroep waar een easefactor zich in verstopt, en de vermenigvuldiging die hem verraadt. */
const KLEM_OP_EEN = /\b(Math\s*\.\s*min)\s*\(/g;
const MAAL_STAP = /\bdt\s*\*|\*\s*dt\b/;

/**
 * De drie vormen waarin een naam opnieuw gedefinieerd wordt: als functie, als
 * methode, en als toewijzing van een pijl- of functie-expressie. Een aanroep
 * hoort er niet bij, en de pijl moet meteen achter het isgelijkteken staan:
 * `const pick = voices.find((v) => …)` wijst een uitkomst toe en definieert niets.
 */
function definitiepatronen(naam: string): RegExp[] {
	const pijl = '(?:<[^<>]*>)?\\s*(?:\\([^()]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=>{;]*)?=>';
	return [
		new RegExp(`\\bfunction\\s+${naam}\\b`, 'g'),
		new RegExp(`\\b${naam}\\s*(?:<[^<>]*>)?\\s*\\([^()]*\\)\\s*(?::[^{;=]+)?\\{`, 'g'),
		new RegExp(`\\b${naam}\\s*(?::[^=\\n]*)?=\\s*(?:async\\s+)?(?:function\\b|${pijl})`, 'g'),
	];
}

/** Naam → het bestand in util dat hem uitdeelt. Uit de bron, dus nooit verouderd. */
function gedeeldeHulpen(bestanden: readonly string[]): Map<string, string> {
	const uit = new Map<string, string>();
	for (const pad of bestanden) {
		if (!pad.startsWith(`${KOPIE_HULPMAP}/`)) continue;
		const code = zonderTekst(readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8'));
		for (const treffer of code.matchAll(/\bexport\s+function\s+([A-Za-z_$][\w$]*)/g)) {
			const naam = treffer[1];
			if (naam !== undefined) uit.set(naam, pad);
		}
	}
	return uit;
}

function kopietreffers(code: string, pad: string, hulpen: Map<string, string>): Rekentreffer[] {
	const uit: Rekentreffer[] = [];

	for (const [naam, eigenaar] of hulpen) {
		if (pad === eigenaar) continue;
		for (const patroon of definitiepatronen(naam)) {
			for (const treffer of code.matchAll(patroon)) {
				uit.push({ index: treffer.index, melding: `definieert ${naam} opnieuw; die staat in ${eigenaar}` });
			}
		}
	}

	for (const vorm of KOPIE_VORMEN) {
		if (hulpen.get(vorm.hulp) === pad) continue;
		for (const treffer of code.matchAll(vorm.patroon)) {
			uit.push({ index: treffer.index, melding: vorm.melding });
		}
	}

	if (hulpen.get('easeFactor') !== pad) {
		for (const aanroep of aanroepArgumenten(code, KLEM_OP_EEN)) {
			const staat = aanroep.args[1];
			if (aanroep.args.length !== 2 || aanroep.args[0] !== '1' || staat === undefined || !MAAL_STAP.test(staat)) continue;
			uit.push({
				index: aanroep.index,
				melding: 'klemt een eigen easefactor op 1. Gebruik easeFactor() uit util/math, of ease() als de hele stap erin past',
			});
		}
	}

	return uit;
}

/**
 * De greep naar tweede kopieën. Draait over dezelfde twee partities als de
 * rekenhulpen, want mulberry32 stond zowel in src/scene als in scripts/perf.
 */
function controleKopieen(): void {
	const bestanden = bronBestanden();
	const hulpen = gedeeldeHulpen(bestanden);

	for (const naam of [...KOPIE_VORMEN.map((v) => v.hulp), 'easeFactor']) {
		if (!hulpen.has(naam))
			fout('kopieen', `${KOPIE_HULPMAP} deelt ${naam} niet meer uit, dus de vorm die hij bezit heeft geen eigenaar`);
	}

	greepDoorBron({
		naam: 'kopieen',
		bestanden,
		vrij: KOPIE_VRIJE_BESTANDEN,
		uitzonderingen: KOPIE_UITZONDERINGEN,
		treffers: (code, pad) => kopietreffers(code, pad, hulpen),
	});
}

/**
 * De zonegraaf: elke zone bereikbaar, en elke verklaarde doorkijk verantwoord.
 *
 * De graaf wordt afgeleid uit de vrije-ruimte- en glasvolumes van het wereldmodel,
 * dus een zone raakt afgesloten door geometrie te verzetten en niet door een lijst
 * te vergeten bij te werken. Dat is precies waarom het gecontroleerd moet worden:
 * een dek dat niemand meer kan zien wordt door de render-cull ook niet meer
 * getekend, en dan is een verdieping stilletjes weg.
 */
function controleZonegraaf(): void {
	for (const zone of ZONES) {
		const bereikbaar = reachableZones(zone);
		for (const doel of ZONES) {
			if (bereikbaar.includes(doel)) continue;
			fout('zonegraaf', `vanuit ${zone} is ${doel} door geen enkel portaal te bereiken`);
		}
	}

	for (const portaal of ZONE_PORTALS) {
		if (portaal.faces.length > 0) continue;
		fout(
			'zonegraaf',
			`${portaal.id} raakt ${zonesOfMask(portaal.mask).join(' en ')} maar heeft geen enkel grensvlak, dus er is niets doorheen te zien`,
		);
	}

	// Een entiteit die vrije ruimte of glas verklaart is een portaal, tenzij ze
	// opschrijft dat ze niets verbindt. Een vrijstelling die wél verbindt is
	// dezelfde fout als een ongebruikte vergunning bij de gevel.
	for (const entiteit of WORLD_ENTITIES) {
		const kandidaat = portalOfEntity(entiteit);
		const vrijgesteld = entiteit.tags.includes(NOT_A_PORTAL_TAG);
		const zones = kandidaat ? zonesOfMask(kandidaat.mask) : [];
		if (kandidaat && zones.length > 1 && vrijgesteld) {
			fout('zonegraaf', `${entiteit.id} draagt ${NOT_A_PORTAL_TAG} maar verbindt ${zones.join(' en ')}`);
		}
		if (kandidaat && zones.length <= 1 && !vrijgesteld) {
			fout(
				'zonegraaf',
				`${entiteit.id} verklaart doorkijk in ${zones.join(' en ') || 'geen enkele zone'} en verbindt dus niets; zet er ${NOT_A_PORTAL_TAG} op of geef hem een tweede zone`,
			);
		}
		if (!kandidaat && vrijgesteld) {
			fout('zonegraaf', `${entiteit.id} draagt ${NOT_A_PORTAL_TAG} maar verklaart helemaal geen doorkijk`);
		}
	}

	// De hoofdingang is glas van de vloer tot boven de V1-dekregel, dus hij hoort de
	// straat aan béide winkeldekken te knopen. En hij hoort V0 níét aan V1 te knopen:
	// daar ligt gewoon een vloer tussen.
	const ingang = ZONE_PORTALS.find((portaal) => portaal.id === ENTRANCE_ENTITY.id);
	if (!ingang) {
		fout('zonegraaf', `${ENTRANCE_ENTITY.id} is geen portaal, terwijl het de enige deur in de gevel is`);
	} else {
		for (const dek of ['mall-v0', 'mall-v1'] as const) {
			if (!ingang.faces.some((vlak) => vlak.from === 'stad' && vlak.to === dek)) {
				fout('zonegraaf', `vanaf de stoep kijkt de hoofdingang niet ${dek} in`);
			}
		}
		if (ingang.faces.some((vlak) => vlak.from === 'mall-v0' && vlak.to === 'mall-v1')) {
			fout('zonegraaf', 'de hoofdingang meldt een doorkijk van V0 naar V1, terwijl de vloerplaat daar dicht is');
		}
	}

	// En het atrium is één koker van de begane grond tot de lichtkoepel.
	const atrium = ZONE_PORTALS.find((portaal) => portaal.id === `opening-${ATRIUM_OPENING.id}`);
	if (!atrium) {
		fout('zonegraaf', `opening-${ATRIUM_OPENING.id} is geen portaal`);
	} else {
		// Beide kanten op: `connects` en de gebouwde koker horen precies dezelfde
		// dekken te noemen. Eén kant vergelijken laat de andere stil verlopen.
		const verklaard = ATRIUM_OPENING.connects.map(zoneOfLevel).toSorted().join(', ');
		const gebouwd = zonesOfMask(atrium.mask).toSorted().join(', ');
		if (verklaard !== gebouwd) {
			fout('zonegraaf', `het atrium verklaart ${verklaard} en verbindt ${gebouwd || 'niets'}`);
		}
		if (!atrium.faces.some((vlak) => vlak.from === 'roof' && vlak.to === 'mall-v0')) {
			fout('zonegraaf', 'vanaf het dak kijkt het atrium de begane grond niet op');
		}
	}

	// En de uitritgeul knoopt de straat aan de garage en niet aan de winkelvloer: de
	// vrije ruimte van de helling is één grove doos die dwars door de westgevel
	// steekt, en op V0-hoogte staat daar `wall_w_above_exit`. Zonder deze bite meldde
	// de graaf daar een raam van dertien vierkante meter en tekende de cull vanaf de
	// stoep het halve interieur mee.
	const geul = ZONE_PORTALS.find((portaal) => portaal.id === PARKING_EXIT_RAMP_ENTITY.id);
	if (!geul) {
		fout('zonegraaf', `${PARKING_EXIT_RAMP_ENTITY.id} is geen portaal, terwijl hij de garage aan de stad knoopt`);
	} else {
		if (!geul.faces.some((vlak) => vlak.from === 'stad' && vlak.to === 'p1')) {
			fout('zonegraaf', 'vanaf de stoep kijkt de uitritgeul de garage niet in');
		}
		for (const vlak of geul.faces) {
			if (vlak.from !== 'stad' || vlak.to === 'p1') continue;
			fout('zonegraaf', `de uitritgeul meldt een doorkijk van de stoep naar ${vlak.to}, terwijl de westgevel daar dicht is`);
		}
	}
}

// ── het theater: naar binnen lopen, en de zaal die alleen door zijn deuren te zien is ──

/** Hoever voor de deuren de wandeling begint: op het podium, ruim voor de dorpel. */
const THEATER_START_Z = midpoint(THEATRE_PLAN.podium.minZ, THEATRE_PLAN.podium.maxZ);
/** En hoever hij binnen moet komen: tot de voorste rij, onderaan het gangpad. */
const THEATER_DOEL_Z = midpoint(
	theatreRowDeck(THEATRE_PLAN.seating.rows - 1).minZ,
	theatreRowBank(THEATRE_PLAN.seating.rows - 1).minZ,
);

/** Tussen de zuilenrij en de gevel: daar begint een wandeling die de gevel zelf moet toetsen. */
const THEATER_PUI_Z = THEATRE_PLAN.columns.z - THEATRE_PLAN.columns.radius - PLAYER_RADIUS - 0.1;

/** Hoever uit de hoek de dichte gevel beproefd wordt: naast de buitenste zuil. */
const THEATER_GEVEL_INZET = 1.5;

/** De speelruimte waarin twee gebouwen elkaar nog niet raken. Onder deze afstand deelt een doos ze. */
const GEBOUWEN_VRIJE_RUIMTE = 1;

/**
 * Het theater, gelopen zoals de speler het loopt.
 *
 * Het blok was een gevel met deuren erop geschilderd. Wat het nu is staat op vier
 * plekken tegelijk: de travee in de gevelspec, de dozen in Collision, de volumes in
 * het wereldmodel en de zone erachter. Dit is de enige controle die vraagt of je er
 * ook echt in komt, en de tegenhanger ervan — naast de deuren komt niemand naar
 * binnen — want zonder die helft haalt een theater zonder muren deze controle net
 * zo goed.
 *
 * De rest gaat over wat de zaal een zaal maakt: de gangpaden blijven leeg, de zone
 * is alleen door zijn eigen deuren te zien, en het gebouw staat vrij van de mall.
 */
async function controleTheater(): Promise<void> {
	const zaalX = THEATRE_PORTAL.centerX;
	const gangpad = at(THEATRE_AISLES, 0);
	const gangX = midpoint(gangpad.minX, gangpad.maxX);
	const foyerZ = midpoint(THEATRE_INTERIOR.maxZ - THEATRE_PLAN.foyer.depth, THEATRE_INTERIOR.maxZ);

	// 1. Van het podium door de travee, de foyer door, de doorgang in de foyerwand
	// door en het gangpad af tot de voorste rij.
	const binnen = volgPolylijn(
		[
			[zaalX, THEATER_START_Z],
			[zaalX, foyerZ],
			[gangX, foyerZ],
			[gangX, THEATER_DOEL_Z],
		],
		THEATRE_FLOOR_Y,
	);
	if (binnen.klacht !== null) {
		fout('theater', `de wandeling naar binnen strandt: ${binnen.klacht}`);
	} else if (zoneAt(binnen.x, binnen.y, binnen.z) !== 'theatre') {
		fout(
			'theater',
			`de wandeling eindigt op (${nr(binnen.x)}, ${nr(binnen.z)}), en dat ligt in ${zoneAt(binnen.x, binnen.y, binnen.z)}`,
		);
	}

	// 1b. De rand tussen de voorste rij en het toneel is een wand, geen val. Het zaaldek
	// zakt trapsgewijs naar de voorste rij en het toneel staat er ruim een stap boven;
	// het toneel is een loopvlak zonder collisiondoos, dus wie de rand overliep vond geen
	// bereikbare vloer en zakte door naar straatniveau, klem tussen de stoelen op
	// (64, −64) en (64.5, −65.2). Loop het gangpad van de voorste rij naar het toneel:
	// collision hoort je op de rand te stoppen, en de vloer mag niet onder de voorste rij
	// wegzakken zonder dat een wand je tegenhoudt.
	const voorsteRijY = theatreRowY(THEATRE_PLAN.seating.rows - 1);
	let toneelX = gangX;
	let toneelZ = THEATER_DOEL_Z;
	let toneelY = voorsteRijY;
	let doorgezakt: Readonly<{ x: number; z: number; y: number }> | null = null;
	const toneelDoelZ = midpoint(THEATRE_INTERIOR.minZ, THEATRE_STAGE_FRONT_Z);
	const toneelStappen = Math.max(1, Math.ceil(Math.abs(toneelDoelZ - THEATER_DOEL_Z) / POLYLIJN_STAP));
	for (let k = 1; k <= toneelStappen; k++) {
		const wensZ = lerp(THEATER_DOEL_Z, toneelDoelZ, k / toneelStappen);
		const grond = wereld.groundHeightAt(gangX, wensZ, toneelY, WALK_STEP);
		const los = wereld.resolveCircle(gangX, wensZ, grond, PLAYER_RADIUS, 3, true, false, true);
		if (Math.hypot(los.x - gangX, los.z - wensZ) > 1e-4) break; // de wand houdt je tegen, precies zoals het hoort
		if (grond < voorsteRijY - WALK_STEP) {
			doorgezakt = { x: gangX, z: wensZ, y: grond };
			break;
		}
		toneelX = gangX;
		toneelZ = wensZ;
		toneelY = grond;
	}
	if (doorgezakt) {
		fout(
			'theater',
			`de rand tussen de voorste rij en het toneel is een val: op (${nr(doorgezakt.x)}, ${nr(doorgezakt.z)}) zakt de vloer naar ${nr(doorgezakt.y)} in plaats van je tegen te houden`,
		);
	}
	if (!doorgezakt && !bijna(toneelY, voorsteRijY, WALK_STEP) && !bijna(toneelY, THEATRE_STAGE_TOP_Y, WALK_STEP)) {
		fout(
			'theater',
			`van de voorste rij naar het toneel eindig je op ${nr(toneelY)} bij (${nr(toneelX)}, ${nr(toneelZ)}), noch de rij noch het toneel`,
		);
	}

	// 2. En naast de travee komt niemand binnen: niet door het zijlicht, dat glas is
	// voor het oog en wand voor het lichaam, en niet door de dichte gevel ernaast.
	//
	// Vanaf `THEATER_PUI_Z` en niet vanaf het podium: de zuilenrij staat ervoor, en
	// vanaf de trap loopt elke van deze drie al op een zuil stuk. Dan bewijst de
	// controle dat de portico in de weg staat en niet dat de gevel dicht is.
	for (const [wat, x] of [
		['het westelijke zijlicht', midpoint(THEATRE_PORTAL.minX, THEATRE_PORTAL.doorMinX)],
		['het oostelijke zijlicht', midpoint(THEATRE_PORTAL.doorMaxX, THEATRE_PORTAL.maxX)],
		['de dichte zuidgevel', THEATRE_PLAN.hall.minX + THEATER_GEVEL_INZET],
	] as [string, number][]) {
		const dwars = volgPolylijn(
			[
				[x, THEATER_PUI_Z],
				[x, foyerZ],
			],
			THEATRE_FLOOR_Y,
		);
		if (zoneAt(x, dwars.y, dwars.z) === 'theatre') {
			fout('theater', `door ${wat} (x ${nr(x)}) loopt de voetganger tot z ${nr(dwars.z)} de zaal in`);
		}
	}

	// 2b. En de schil is verder overal dicht. De wandelingen hierboven lopen elk op
	// één lijn en zien een gat van drie meter twee meter ernaast niet; de opening die
	// de zonegraaf uit de gevel afleest is de hele gevel tegelijk. Precies één gat, en
	// dat is de travee.
	const overDeHeleGevel = (minU: number, maxU: number): FacadePanel => ({
		minU,
		maxU,
		minY: THEATRE_PLAN.baseY,
		maxY: THEATRE_PLAN.hallHeight,
	});
	// De noord- en zuidkap lopen over de volle breedte en dekken dus de vier hoeken;
	// de zij-wanden zijn alleen verantwoordelijk voor wat daartussen overblijft. De
	// zijgevels lopen nu de volle diepte van de zaal én de backstage, dus over die
	// hele lengte gemeten laten west en oost niets vallen; noord laat alleen de
	// artiesteningang vallen en zuid alleen de travee.
	const gevelNoordZ = THEATRE_PLAN.hall.minZ - THEATRE_PLAN.backstage.depth;
	const dichteZijden: readonly CardinalSide[] = ['west', 'east'];
	for (const kant of dichteZijden) {
		const opening = theatreOpeningWithin(
			kant,
			overDeHeleGevel(gevelNoordZ + THEATRE_PLAN.wallThickness, THEATRE_PLAN.hall.maxZ - THEATRE_PLAN.wallThickness),
		);
		if (opening === null) continue;
		fout('theater', `de ${kant}gevel van het theater staat open van ${nr(opening.minU)} tot ${nr(opening.maxU)}`);
	}
	const travee = theatreOpeningWithin('south', overDeHeleGevel(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX));
	if (travee === null) {
		fout('theater', 'de zuidgevel van het theater is dicht, dus er is helemaal geen travee');
	} else if (
		!bijna(travee.minU, THEATRE_PORTAL.minX) ||
		!bijna(travee.maxU, THEATRE_PORTAL.maxX) ||
		!bijna(travee.maxY, THEATRE_FLOOR_Y + THEATRE_PLAN.doors.headY)
	) {
		fout(
			'theater',
			`de travee meet x ${nr(travee.minU)}..${nr(travee.maxU)} tot y ${nr(travee.maxY)} in plaats van ${nr(THEATRE_PORTAL.minX)}..${nr(THEATRE_PORTAL.maxX)} tot ${nr(THEATRE_FLOOR_Y + THEATRE_PLAN.doors.headY)}`,
		);
	}
	// De achtergevel laat precies één gat vallen: de artiesteningang, over de as van
	// de backstage-gang en op toneelhoogte.
	const artiesten = theatreOpeningWithin('north', overDeHeleGevel(THEATRE_PLAN.hall.minX, THEATRE_PLAN.hall.maxX));
	const artiestenTop = BACKSTAGE_FLOOR_Y + THEATRE_PLAN.backstage.door.headY;
	if (artiesten === null) {
		fout('theater', 'de noordgevel van het theater is dicht, dus er is geen artiesteningang');
	} else if (
		!bijna(artiesten.minU, THEATRE_ARTIST_PORTAL.minX) ||
		!bijna(artiesten.maxU, THEATRE_ARTIST_PORTAL.maxX) ||
		!bijna(artiesten.maxY, artiestenTop)
	) {
		fout(
			'theater',
			`de artiesteningang meet x ${nr(artiesten.minU)}..${nr(artiesten.maxU)} tot y ${nr(artiesten.maxY)} in plaats van ${nr(THEATRE_ARTIST_PORTAL.minX)}..${nr(THEATRE_ARTIST_PORTAL.maxX)} tot ${nr(artiestenTop)}`,
		);
	}

	// 3. Geen stoel in een gangpad. De vakken worden door de gangpaden uit de rij
	// gesneden, dus dit hoort per definitie te kloppen — en dat is precies waarom het
	// gemeten wordt: één vak dat zijn eigen breedte opschrijft haalt de zaal leeg.
	const gangpaden = THEATRE_FOYER_ENTITY.volumes.filter((volume) => volume.role === 'aisle-clearance');
	if (gangpaden.length === 0) {
		fout('theater', 'de zaal heeft geen enkel gangpad-volume, dus er wordt geen vloer vrijgehouden');
	}
	for (const bank of THEATRE_SEATING_ENTITY.volumes) {
		const stoelen = geometryBounds(bank.geometry);
		for (const volume of gangpaden) {
			const vrij = geometryBounds(volume.geometry);
			if (!overlapt(stoelen, vrij)) continue;
			fout('theater', `${THEATRE_SEATING_ENTITY.id}.${bank.id} staat in het gangpad ${THEATRE_FOYER_ENTITY.id}.${volume.id}`);
		}
	}

	// 4. Elke stoel staat op de vloer van zijn eigen rij, en niet naast of erboven.
	for (const bank of theatreSeatBanks()) {
		const vloer = theatreRowY(bank.row);
		const strook = theatreRowBank(bank.row);
		for (const x of theatreSeatXs(bank)) {
			if (x < bank.minX || x > bank.maxX) {
				fout(
					'theater',
					`een stoel van ${bank.id} staat op x ${nr(x)}, buiten zijn eigen vak (${nr(bank.minX)}..${nr(bank.maxX)})`,
				);
			}
			const grond = wereld.groundHeightAt(x, midpoint(strook.minZ, strook.maxZ), vloer, WALK_STEP);
			if (!bijna(grond, vloer, 1e-6)) {
				fout(
					'theater',
					`een stoel van ${bank.id} op x ${nr(x)} staat op ${nr(vloer)} terwijl de vloer daar op ${nr(grond)} ligt`,
				);
			}
		}
	}

	// 4b. En wat in de zaal staat hoort ook alleen in de zaal te staan. `accepts` krijgt
	// van de tekenaar het masker dat `zoneMaskOfBounds` van de doos maakt, dus een zaal
	// die er stad bij claimt komt nergens meer onderuit: hij wordt vanaf de overkant
	// van de straat gewoon getekend, met alle stoelen erin.
	const stoelDoos = geometryBounds(at(THEATRE_SEATING_ENTITY.volumes, 0).geometry);
	const stoelMasker = zoneMaskOfBounds(stoelDoos);
	if (stoelMasker !== zoneBit('theatre')) {
		fout('theater', `een stoelenblok staat in ${zonesOfMask(stoelMasker).join(' en ')} in plaats van alleen in theatre`);
	}

	// 5. De zonegraaf: het theater is een eigen zone, en precies twee openingen knopen
	// hem aan de stad — de travee vooraan en de artiesteningang achter. De deur vanaf
	// het toneel ligt binnen de zone en is dus geen portaal. Geen handmatige lijst.
	const portalen = ZONE_PORTALS.filter((portaal) => zonesOfMask(portaal.mask).includes('theatre'));
	const gevonden = new Set(portalen.map((portaal) => portaal.id));
	const verwachtePortalen = [THEATRE_ENTRANCE_ENTITY.id, THEATRE_BACKSTAGE_DOORS_ENTITY.id];
	if (portalen.length !== verwachtePortalen.length || verwachtePortalen.some((id) => !gevonden.has(id))) {
		fout(
			'theater',
			`de zaal hangt aan ${portalen.length === 0 ? 'geen enkel portaal' : portalen.map((portaal) => portaal.id).join(' en ')} in plaats van aan ${verwachtePortalen.join(' en ')}`,
		);
	}
	for (const id of verwachtePortalen) {
		const portaal = portalen.find((kandidaat) => kandidaat.id === id);
		if (!portaal) continue;
		for (const [van, naar] of [
			['stad', 'theatre'],
			['theatre', 'stad'],
		] as [ZoneId, ZoneId][]) {
			if (portaal.faces.some((vlak) => vlak.from === van && vlak.to === naar)) continue;
			fout('theater', `${id} levert geen doorkijk van ${van} naar ${naar}`);
		}
	}
	if (!reachableZones('theatre').includes('mall-v0')) {
		fout('theater', 'vanuit de zaal is de winkelvloer door geen enkel portaal te bereiken');
	}

	// 6. De twee gebouwen raken elkaar niet. `zoneMaskOfBounds` leest stad af uit
	// "past niet in één gebouw", en dat antwoord klopt alleen zolang geen doos in de
	// vereniging van twee schillen past zonder in één ervan te passen.
	for (let i = 0; i < ZONE_ENCLOSURES.length; i++) {
		for (let j = i + 1; j < ZONE_ENCLOSURES.length; j++) {
			const a = at(ZONE_ENCLOSURES, i);
			const b = at(ZONE_ENCLOSURES, j);
			const gat = Math.max(
				a.plan.minX - b.plan.maxX,
				b.plan.minX - a.plan.maxX,
				a.plan.minZ - b.plan.maxZ,
				b.plan.minZ - a.plan.maxZ,
			);
			if (gat >= GEBOUWEN_VRIJE_RUIMTE) continue;
			fout('theater', `${a.id} en ${b.id} staan ${nr(gat)} m uit elkaar; onder ${nr(GEBOUWEN_VRIJE_RUIMTE)} m deelt één doos ze`);
		}
	}

	// 7. De artiesteningang: van het achterbordes in 5 cm-stappen door de deur, de
	// backstage-gang in en een kleedkamer in. De backstage doet mee in de zaalzone,
	// dus dat is waar de wandeling hoort te eindigen.
	const bordesZ = midpoint(BACKSTAGE_LANDING.minZ, BACKSTAGE_LANDING.maxZ);
	const gangZ = midpoint(BACKSTAGE_INTERIOR.minZ, BACKSTAGE_INTERIOR.maxZ);
	const kleedkamerX = midpoint(BACKSTAGE_INTERIOR.minX, BACKSTAGE_CORRIDOR.minX);
	const artiestenIn = volgPolylijn(
		[
			[THEATRE_ARTIST_PORTAL.centerX, bordesZ],
			[THEATRE_ARTIST_PORTAL.centerX, gangZ],
			[kleedkamerX, gangZ],
		],
		BACKSTAGE_FLOOR_Y,
	);
	if (artiestenIn.klacht !== null) {
		fout('theater', `de artiestenwandeling strandt: ${artiestenIn.klacht}`);
	} else if (zoneAt(artiestenIn.x, artiestenIn.y, artiestenIn.z) !== 'theatre') {
		fout(
			'theater',
			`de artiestenwandeling eindigt op (${nr(artiestenIn.x)}, ${nr(artiestenIn.z)}) in ${zoneAt(artiestenIn.x, artiestenIn.y, artiestenIn.z)}`,
		);
	}

	// En naast de deur komt niemand door de dichte achtergevel. Vlak naast de opening
	// staat de noordwand massief; een voetganger die daar naar binnen loopt hoort erop
	// stuk te lopen in plaats van de backstage in te glippen.
	const dichteWandX = THEATRE_ARTIST_PORTAL.minX - PLAYER_RADIUS - 0.1;
	const dichteWand = volgPolylijn(
		[
			[dichteWandX, bordesZ],
			[dichteWandX, gangZ],
		],
		BACKSTAGE_FLOOR_Y,
	);
	if (zoneAt(dichteWand.x, dichteWand.y, dichteWand.z) === 'theatre') {
		fout(
			'theater',
			`door de dichte achtergevel (x ${nr(dichteWandX)}) komt de voetganger tot z ${nr(dichteWand.z)} de backstage in`,
		);
	}

	// 7c. En uit elke kleedkamer rechtstreeks de coulisse op. De gang leidt via de
	// centrale toneeldeur naar het midden van het toneel, maar een artiest hoort ook
	// door de zijwand het toneel op te kunnen, langs de vleugel naast het doek. Die
	// doorgang lag in de strook naast het toneeldoek — even breed als de doekmarge en
	// vrij van de kaptafel die middenin de kamer staat — en ontbrak: de tussenwand
	// stond daar massief, dus wie niet de gang terug nam kwam het toneel niet op.
	const vleugelBreedte = THEATRE_PLAN.stage.set.margin;
	const coulisseZ = midpoint(THEATRE_INTERIOR.minZ, THEATRE_STAGE_FRONT_Z);
	const kamerZ = BACKSTAGE_INTERIOR.maxZ - vleugelBreedte;
	for (const [naam, deurX] of [
		['de westkleedkamer', THEATRE_INTERIOR.minX + half(vleugelBreedte)],
		['de oostkleedkamer', THEATRE_INTERIOR.maxX - half(vleugelBreedte)],
	] as [string, number][]) {
		const naarToneel = volgPolylijn(
			[
				[deurX, kamerZ],
				[deurX, coulisseZ],
			],
			BACKSTAGE_FLOOR_Y,
		);
		if (naarToneel.klacht !== null) {
			fout('theater', `vanuit ${naam} strandt de wandeling naar het toneel: ${naarToneel.klacht}`);
		} else if (
			zoneAt(naarToneel.x, naarToneel.y, naarToneel.z) !== 'theatre' ||
			!bijna(naarToneel.y, THEATRE_STAGE_TOP_Y, WALK_STEP)
		) {
			fout(
				'theater',
				`vanuit ${naam} eindigt de wandeling op (${nr(naarToneel.x)}, ${nr(naarToneel.z)}) y ${nr(naarToneel.y)}, niet op het toneel`,
			);
		}
	}

	// De collisionvloer tussen backstage en toneel bestond al, maar de tekenaar sloeg
	// de twee dorpels over. Daardoor liep je bij de toneeldeur over een zichtbaar gat.
	stubDocument();
	const [THREE, { LightPool }, { CityTheatre }] = await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/city/CityTheatre'),
	]);
	const getekend = new CityTheatre(new LightPool(new THREE.Scene()));
	for (const id of ['stage-door-sill', 'wing-door-sill-west', 'wing-door-sill-east', 'artist-door-sill'] as const) {
		if (getekend.group.getObjectByName(`theatre_${id}`)) continue;
		fout('theater', `collision kent ${id}, maar de theaterbouwer tekent dat loopvlak niet`);
	}
	getekend.dispose();

	await controleZaalcull(stoelMasker);
	controleZaallabel();
}

/**
 * De stresstest van het zonestelsel: het interieur is er alleen door de travee.
 *
 * De vier mall-zones liggen boven elkaar in één voetafdruk en delen hun gaten met
 * de stad. Het theater is het eerste gebouw dat er náást staat, en dat is precies
 * het geval waarin een te ruime kegel niets meer cullt: van de overkant van de
 * straat staat de hele zaal in beeld, en er hoort niets van getekend te worden
 * zolang je niet door de deuren kijkt.
 */
async function controleZaalcull(stoelMasker: number): Promise<void> {
	const THREE = await import('three');
	const { ZoneCuller } = await import('#/render/ZoneCuller');
	const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
	const culler = new ZoneCuller();
	const oog = THEATRE_FLOOR_Y + 1.6;
	const voorDeDeur = { x: THEATRE_PORTAL.centerX, z: THEATRE_PLAN.stair.zTop + THEATER_KIJKAFSTAND };

	const kijk = (van: Vec3, naar: Vec3, zone: ZoneId): void => {
		camera.position.set(van.x, van.y, van.z);
		camera.lookAt(naar.x, naar.y, naar.z);
		camera.updateMatrixWorld(true);
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
		camera.updateProjectionMatrix();
		culler.update(camera, zone);
	};

	// Recht op de travee: de zaal is er, en wat vlak achter de deuren staat blijft.
	kijk({ x: voorDeDeur.x, y: oog, z: voorDeDeur.z }, { x: voorDeDeur.x, y: oog, z: THEATRE_INTERIOR.minZ }, 'stad');
	if (!culler.seesZone('theatre'))
		fout('theater', 'recht op de travee heet de zaal onzichtbaar, terwijl je er zo doorheen kijkt');
	const inDeFoyer = new THREE.Sphere(
		new THREE.Vector3(THEATRE_PORTAL.centerX, oog, THEATRE_INTERIOR.maxZ - THEATER_KIJKAFSTAND),
		1,
	);
	if (!culler.accepts(stoelMasker, inDeFoyer)) {
		fout('theater', 'recht op de travee wordt de foyer achter de deuren weggecullt');
	}

	// En met de rug ernaartoe is er niets van te zien. Dit is de beet: zonder de
	// zonedoos gaf een opening áchter de camera de volle camerakegel terug en cullde
	// de zaal nergens.
	kijk({ x: voorDeDeur.x, y: oog, z: voorDeDeur.z }, { x: voorDeDeur.x, y: oog, z: voorDeDeur.z + THEATER_KIJKVER }, 'stad');
	if (culler.seesZone('theatre')) fout('theater', 'met de rug naar de travee heet de zaal nog steeds zichtbaar');
	const opDeRij = new THREE.Sphere(new THREE.Vector3(THEATRE_PORTAL.centerX, THEATRE_FLOOR_Y, THEATER_DOEL_Z), 1);
	if (culler.accepts(stoelMasker, opDeRij)) {
		fout('theater', 'met de rug naar de travee wordt een stoel in de zaal nog steeds geaccepteerd');
	}

	// En vanuit de mall bestaat de zaal helemaal niet, welke kant je ook op kijkt: de
	// twee gebouwen delen geen enkel portaal. Dat is wat het hele stelsel hier
	// oplevert — binnen in de winkels wordt er geen stoel van dit theater getekend.
	for (const naar of [THEATRE_INTERIOR.minZ, -THEATRE_INTERIOR.minZ]) {
		kijk({ x: 0, y: V0 + 1.6, z: 0 }, { x: THEATRE_PORTAL.centerX, y: V0 + 1.6, z: naar }, 'mall-v0');
		if (culler.seesZone('theatre'))
			fout('theater', 'vanaf de winkelvloer heet de zaal zichtbaar, terwijl er geen portaal heen loopt');
		if (culler.accepts(stoelMasker, null)) {
			fout('theater', 'vanaf de winkelvloer wordt geometrie uit de zaal nog steeds geaccepteerd');
		}
	}
}

/** Hoever voor het gebouw de camera staat, en hoe ver hij van de zaal af kijkt. */
const THEATER_KIJKAFSTAND = 4;
const THEATER_KIJKVER = 40;

/**
 * En de schotel noemt het theater als je ervoor staat.
 *
 * De dekplattegrond doet dat met opzet niet: die gaat over de mall, en een tweede
 * gebouw vijftig meter verderop erbij krimpt het gebouw waar hij over gaat. De
 * schotel staat om de speler heen en heeft die grens niet.
 */
function controleZaallabel(): void {
	const meter = stubTextMeasure();
	const oog = { x: THEATRE_PORTAL.centerX, z: THEATRE_PLAN.stair.zTop + THEATER_KIJKAFSTAND };
	const genoemd = minimapLabelPlan(meter, { x: oog.x, z: oog.z, yaw: 0, level: levelAt(THEATRE_FLOOR_Y) }).plan;
	if (!genoemd.some((label) => label.text === THEATRE_LABEL)) {
		fout(
			'theater',
			`voor de trap noemt de schotel het theater niet; ze tekent er ${genoemd.length === 0 ? 'niets' : genoemd.map((label) => label.text).join(', ')}`,
		);
	}
}

/** Eén standpunt voor de zonecull: waar de camera staat, waar hij heen kijkt en in welke zone hij dan staat. */
type Standpunt = Readonly<{ naam: string; van: Vec3; naar: Vec3; zone: ZoneId }>;

/**
 * De zonecull, kaal gedraaid.
 *
 * Er stond geen enkele controle op: het hele stelsel — welke zone je ziet, wat er
 * verborgen wordt, wat er nooit verborgen mag worden — rustte op één handmatige
 * draw-call-meting. `seesZone` gaf op elk standpunt alle vijf de zones terug, want
 * een opening áchter de camera leverde de volle camerakegel op, en daarmee was de
 * hele simulatie-LOD dood zonder dat iets dat merkte. En de andere kant op is
 * erger: een kegel die te krap is laat geometrie verdwijnen die je gewoon ziet.
 *
 * De drie beten zijn dus: hij zégt nee als er niets te zien is, hij zegt ja door
 * de opening waar wél iets doorheen te zien is, en wat in je eigen zone staat komt
 * er nooit onderuit.
 */
async function controleZonecull(): Promise<void> {
	const THREE = await import('three');
	const { ZoneCuller } = await import('#/render/ZoneCuller');
	const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
	const culler = new ZoneCuller();
	const stoepZ = ENTRANCE_PORTAL.centerZ;
	const buitenX = ENTRANCE_PORTAL.outerX - 9;

	const kijk = (standpunt: Standpunt): void => {
		camera.position.set(standpunt.van.x, standpunt.van.y, standpunt.van.z);
		camera.lookAt(standpunt.naar.x, standpunt.naar.y, standpunt.naar.z);
		camera.updateMatrixWorld(true);
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
		camera.updateProjectionMatrix();
		culler.update(camera, standpunt.zone);
	};

	// 1. Met het gebouw in de rug is er van geen enkel dek iets te zien.
	const weg: Standpunt = {
		naam: 'stoep, met de rug naar de gevel',
		van: { x: buitenX, y: V0 + 1.6, z: stoepZ },
		naar: { x: buitenX - 30, y: V0 + 1.6, z: stoepZ },
		zone: 'stad',
	};
	kijk(weg);
	for (const zone of ZONES) {
		if (zone === 'stad') continue;
		if (culler.seesZone(zone))
			fout('zonecull', `${weg.naam}: ${zone} heet zichtbaar terwijl de opening erheen achter de camera ligt`);
	}
	const achter = new THREE.Sphere(new THREE.Vector3(0, V0 + 2, 0), 2);
	if (culler.accepts(zoneBit('mall-v0'), achter)) {
		fout('zonecull', `${weg.naam}: een bol midden in V0 wordt nog steeds geaccepteerd`);
	}

	// 2. En recht op de deur is V0 er wél, want daar kijk je zo naar binnen.
	const naarBinnen: Standpunt = {
		naam: 'stoep, recht op de hoofdingang',
		van: { x: buitenX, y: V0 + 1.6, z: stoepZ },
		naar: { x: ENTRANCE_PORTAL.innerX + 10, y: V0 + 1.6, z: stoepZ },
		zone: 'stad',
	};
	kijk(naarBinnen);
	if (!culler.seesZone('mall-v0'))
		fout('zonecull', `${naarBinnen.naam}: V0 heet onzichtbaar terwijl je door de deuropening kijkt`);
	const inDeDeur = new THREE.Sphere(new THREE.Vector3(ENTRANCE_PORTAL.innerX + 3, V0 + 1.6, stoepZ), 1);
	if (!culler.accepts(zoneBit('mall-v0'), inDeDeur)) {
		fout('zonecull', `${naarBinnen.naam}: wat vlak achter de deur staat wordt weggecullt`);
	}

	// 3. En diep binnen met de deur in je rug is de stad er niet. De stad heeft geen
	// doos om tegenaan te testen, dus dit hangt er volledig aan dat een opening
	// áchter de camera géén kegel oplevert. Leverde ze de volle camerakegel op, dan
	// stond hier ja en tikte het hele stadsblok altijd op vol tempo.
	const naarBinnenKijkend: Standpunt = {
		naam: 'midden op V0, met de hoofdingang in de rug',
		van: { x: 0, y: V0 + 1.6, z: 0 },
		naar: { x: 30, y: V0 + 1.6, z: 0 },
		zone: 'mall-v0',
	};
	kijk(naarBinnenKijkend);
	if (culler.seesZone('stad'))
		fout('zonecull', `${naarBinnenKijkend.naam}: de stad heet zichtbaar terwijl de pui achter je ligt`);
	const opStraat = new THREE.Sphere(new THREE.Vector3(ENTRANCE_PORTAL.outerX - 6, V0 + 1.6, ENTRANCE_PORTAL.centerZ), 1);
	if (culler.accepts(zoneBit('stad'), opStraat)) {
		fout('zonecull', `${naarBinnenKijkend.naam}: iets op de stoep achter je wordt nog steeds geaccepteerd`);
	}

	// 4. Wat in je eigen zone staat komt er nooit onderuit, welke kant je ook op kijkt.
	for (const zone of ZONES) {
		kijk({
			naam: `midden in ${zone}`,
			van: { x: 0, y: V0 + 1.6, z: 0 },
			naar: { x: 20, y: V0 + 1.6, z: 0 },
			zone,
		});
		if (!culler.seesZone(zone)) fout('zonecull', `je eigen zone ${zone} heet onzichtbaar`);
		if (!culler.accepts(zoneBit(zone), null)) fout('zonecull', `iets in je eigen zone ${zone} wordt weggecullt`);
	}

	// 5. Alles wat op een dek staat past in de doos die `seesZone` van dat dek gebruikt.
	// Een te krappe doos laat het dak op vier hertz tikken terwijl je erop staat.
	for (const zone of ZONES) {
		const doos = zoneVolume(zone);
		if (doos === null) continue;
		for (const entiteit of WORLD_ENTITIES) {
			for (const volume of entiteit.volumes) {
				const b = geometryBounds(volume.geometry);
				if (zoneMaskOfBounds(b) !== zoneBit(zone)) continue;
				if (b.minY >= doos.minY && b.maxY <= doos.maxY) continue;
				fout(
					'zonecull',
					`${entiteit.id}.${volume.id} staat alleen in ${zone} maar reikt van ${nr(b.minY)} tot ${nr(b.maxY)}, buiten de zonedoos (${nr(doos.minY)} tot ${nr(doos.maxY)})`,
				);
			}
		}
	}

	// 6. Een dekplaat is het grensvlak tussen twee zones en hoort bij allebei: van
	// bovenaf de vloer, van onderaf het plafond. Draagt hij alleen zijn eigen dek, dan
	// valt het plafond weg waar je van onderaf recht tegenaan kijkt en geen portaalkegel
	// de zone erboven dekt — de dakplaat las alleen roof en verdween vanaf V1.
	for (const spec of [MALL_SLAB_SPECS.v0, MALL_SLAB_SPECS.v1, MALL_SLAB_SPECS.roof] as const) {
		const dekIndex = LEVELS.findIndex((l) => l.id === spec.level);
		const onder = LEVELS[dekIndex + 1];
		if (!onder) continue;
		const plaat = WORLD_ENTITIES.find((e) => e.id === spec.id);
		const volume = plaat?.volumes[0];
		if (!volume) {
			fout('zonecull', `de dekplaat ${spec.id} ontbreekt in de wereld`);
			continue;
		}
		const masker = zoneMaskOfBounds(geometryBounds(volume.geometry));
		if ((masker & zoneBit(zoneOfLevel(onder.id))) === 0) {
			fout(
				'zonecull',
				`de ${spec.level}-plaat draagt ${zoneOfLevel(onder.id)} niet, dus van onderaf verdwijnt het plafond zodra geen portaal de zone erboven dekt`,
			);
		}
	}

	// En vanaf V1 recht omhoog, zonder enige dak-portaalkegel in beeld, blijft de
	// dakplaat staan — niet via een kegel maar omdat hij óók bij V1 hoort.
	const omhoog: Standpunt = {
		naam: 'op V1, recht omhoog kijkend',
		van: { x: 23.8, y: V1, z: 4.4 },
		naar: { x: 24.5, y: V1 + 3, z: 3.7 },
		zone: 'mall-v1',
	};
	kijk(omhoog);
	if (culler.seesZone('roof')) {
		fout('zonecull', `${omhoog.naam}: de test veronderstelt geen dak-portaal in beeld, maar roof heet zichtbaar`);
	}
	const roofVolume = WORLD_ENTITIES.find((e) => e.id === MALL_SLAB_SPECS.roof.id)?.volumes[0];
	if (roofVolume) {
		const dakDoos = geometryBounds(roofVolume.geometry);
		const dakBol = new THREE.Sphere(new THREE.Vector3(omhoog.van.x, midpoint(dakDoos.minY, dakDoos.maxY), omhoog.van.z), 2);
		if (!culler.accepts(zoneMaskOfBounds(dakDoos), dakBol)) {
			fout('zonecull', `${omhoog.naam}: de dakplaat wordt weggecullt terwijl je er van onderaf recht tegenaan kijkt`);
		}
	}

	// De spiegel: vanaf V1 door het atriumgat omlaag blijft de begane grond staan. De
	// V0-plaat draagt mall-v0 (mallZonesOfSpan), dus de portaalkegel door het gat houdt
	// hem — anders verdween de vloer naar beneden zodra je eroverheen leunde.
	const omlaag: Standpunt = {
		naam: 'op V1, door het atriumgat omlaag kijkend',
		van: { x: 0, y: V1 + 1.6, z: 7 },
		naar: { x: 0, y: V0, z: 0 },
		zone: 'mall-v1',
	};
	kijk(omlaag);
	if (!culler.seesZone('mall-v0')) {
		fout('zonecull', `${omlaag.naam}: V0 heet onzichtbaar terwijl je door het atriumgat naar beneden kijkt`);
	}
	const v0Volume = WORLD_ENTITIES.find((e) => e.id === MALL_SLAB_SPECS.v0.id)?.volumes[0];
	if (v0Volume) {
		const v0Doos = geometryBounds(v0Volume.geometry);
		const v0Bol = new THREE.Sphere(new THREE.Vector3(0, midpoint(v0Doos.minY, v0Doos.maxY), 0), 2);
		if (!culler.accepts(zoneMaskOfBounds(v0Doos), v0Bol)) {
			fout('zonecull', `${omlaag.naam}: de begane grond wordt weggecullt terwijl je er door het gat op neerkijkt`);
		}
	}
}

/** Stappen over de rit: fijn genoeg om het cull-venster onder de bovenplaat te raken. */
const RITSTAPPEN = 24;
/** Ooghoogte op de trap, zoals de rest van de zonecull-controle rekent. */
const RITOOG = 1.6;

/**
 * Het roltrapbord blijft de hele rit te zien.
 *
 * Het bord staat met zijn hele doos op V0, maar het hangt aan de mond van een
 * roltrap die V0 en V1 verbindt. Rijd je omhoog, dan klapt de camerazone naar V1
 * op `levelAt`'s grens, een halve meter onder de V1-plaat, terwijl de camera nog de
 * schacht in kijkt. In die band dekt geen enkele V1→V0-portaalkegel het bord op x 22
 * — het atriumgat ligt op x −8..8 en het roltrapgat op de plaathoogte bóven de
 * camera — dus de zonecull haalde het weg terwijl je er recht naar keek. `tagZoneSpan`
 * geeft het de zones van zijn eigen connector; deze controle rijdt de trap op en eist
 * dat het bord getekend blijft zolang het in beeld staat.
 */
async function controleRoltrapbord(): Promise<void> {
	stubDocument();
	const [THREE, { MallBuilder }, { ZoneCuller }, { ZoneVisibility }] = await Promise.all([
		import('three'),
		import('#/scene/MallBuilder'),
		import('#/render/ZoneCuller'),
		import('#/render/ZoneVisibility'),
	]);
	const scene = new THREE.Scene();
	scene.add(new MallBuilder().build());
	scene.updateMatrixWorld(true);

	const culler = new ZoneCuller();
	const visibility = new ZoneVisibility(scene, []);
	const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
	const frustum = new THREE.Frustum();
	const viewProjection = new THREE.Matrix4();
	const box = new THREE.Box3();
	const center = new THREE.Vector3();
	const size = new THREE.Vector3();

	for (const spec of VERTICAL_CONNECTORS) {
		if (spec.kind !== 'escalator') continue;
		const naam = `${spec.id}-sign`;
		let bord: import('three').Object3D | null = null;
		scene.traverse((obj) => {
			if (obj.name === naam) bord = obj;
		});
		if (bord === null) {
			fout('roltrapbord', `de roltrap ${spec.id} heeft geen bord ${naam} in de scene`);
			continue;
		}
		const sign: import('three').Object3D = bord;
		box.setFromObject(sign, true);
		box.getCenter(center);
		box.getSize(size);
		const straal = half(Math.hypot(size.x, size.y, size.z));

		let inBeeld = 0;
		for (let i = 0; i <= RITSTAPPEN; i++) {
			const t = i / RITSTAPPEN;
			const y = levelY(spec.from) + RITOOG + t * (levelY(spec.to) - levelY(spec.from));
			const z = lerp(spec.zBottom, spec.zTop, t);
			camera.position.set(spec.x, y, z);
			camera.lookAt(center.x, center.y, center.z);
			camera.updateMatrixWorld(true);
			camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
			camera.updateProjectionMatrix();
			viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem);
			culler.update(camera, zoneAt(spec.x, y, z));
			visibility.apply(culler);
			if (!frustum.intersectsSphere(new THREE.Sphere(center.clone(), straal))) continue;
			inBeeld++;
			if (sign.layers.mask === 0) {
				fout(
					'roltrapbord',
					`${naam} verdwijnt op y ${nr(y)}, z ${nr(z)} (zone ${zoneAt(spec.x, y, z)}) terwijl het in beeld staat`,
				);
			}
		}
		if (inBeeld === 0) fout('roltrapbord', `${naam} kwam de hele rit niet in beeld; de controle test niets`);
	}
}

/**
 * De zichtlijn: wat een bewaker ziet en waar zijn kogel op stukloopt.
 *
 * Afstand alleen maakte van elke gevel een raam. De eerste drie beten zijn wat er
 * mis was en wat er niet mis mag gaan: door de dichte westgevel niet, door de
 * deuropening in diezelfde gevel wel, en over het atrium heen wel — want het hek
 * daar is een doos voor lopende lichamen en geen muur.
 *
 * Alle drie lopen ze van open punt naar open punt, en dat is precies waar de
 * kogelbug zat: die stap eindigde ín de muur en zag daardoor geen enkele doos. De
 * vierde en de vijfde lopen daarom niet langs de wand maar erin, en de zesde valt
 * door een dek.
 */
/** Een traag frame: de langste stap die een kogel in één keer aflegt, en dus de zwaarste. */
const SCHIETFRAMES = 30;
/** Genoeg beginposities om elke fase van die stap ten opzichte van de wand te raken. */
const KOGELMONSTERS = 400;
/** Op borsthoogte langs de westgevel, waar de bewakers ook echt spuiten. */
const KOGELHOOGTE = 1.35;

async function controleZichtlijn(): Promise<void> {
	stubDocument();
	const { BULLET_RADIUS, BULLET_SPEED } = await import('#/scene/SecurityGuards');
	const ooghoogte = 1.6;
	const binnen = { x: -30, y: ooghoogte, z: 12 };
	const buiten = { x: -45, y: ooghoogte, z: 12 };
	if (wereld.hasLineOfSight(binnen, buiten, LINE_OF_SIGHT)) {
		fout(
			'zichtlijn',
			`van (${nr(binnen.x)}, ${nr(binnen.z)}) naar (${nr(buiten.x)}, ${nr(buiten.z)}) kijk je dwars door de westgevel`,
		);
	}

	const doorDeur = { x: -30, y: ooghoogte, z: ENTRANCE_PORTAL.centerZ };
	const opDeStoep = { x: -45, y: ooghoogte, z: ENTRANCE_PORTAL.centerZ };
	if (!wereld.hasLineOfSight(doorDeur, opDeStoep, LINE_OF_SIGHT)) {
		fout(
			'zichtlijn',
			`de hoofdingang op z ${nr(ENTRANCE_PORTAL.centerZ)} laat geen zichtlijn door, terwijl er een deuropening zit`,
		);
	}

	// Het atriumhek loopt van 4,5 tot 12 m hoog en is er voor lopende lichamen. Zou
	// het ook het zicht tegenhouden, dan stond er een muur dwars door het gebouw.
	const balkonWest = { x: -12, y: V1 + ooghoogte, z: 0 };
	const balkonOost = { x: 12, y: V1 + ooghoogte, z: 0 };
	if (!wereld.hasLineOfSight(balkonWest, balkonOost, LINE_OF_SIGHT)) {
		fout('zichtlijn', 'over het atrium heen is er geen zichtlijn, dus een collisiondoos wordt daar als muur gelezen');
	}

	// Een kogel legt per frame een halve meter af en de westgevel is één meter dik,
	// dus zijn stap eindigt ín het steen. Voor een blik is dat een vrijstelling (een
	// bewaker tegen een wand geduwd kijkt eruit), voor een kogel is het een treffer.
	// Zonder dat onderscheid was de doos op dat frame vrijgesteld, op het volgende
	// ook — want toen begon het segment erin — en kwam de kogel er aan de overkant uit.
	const kogelStap = (BULLET_SPEED.min + BULLET_SPEED.spread) / SCHIETFRAMES;
	let door = 0;
	for (let n = 0; n < KOGELMONSTERS; n++) {
		let x = -30 - (n / KOGELMONSTERS) * kogelStap;
		let leeft = true;
		for (let i = 0; i < 200 && x > -50; i++) {
			const van = { x, y: KOGELHOOGTE, z: 12 };
			x -= kogelStap;
			const naar = { x, y: KOGELHOOGTE, z: 12 };
			if (!wereld.hasLineOfSight(van, naar, PROJECTILE_PATH)) {
				leeft = false;
				break;
			}
		}
		if (leeft) door++;
	}
	if (door > 0) {
		fout(
			'zichtlijn',
			`${door} van de ${KOGELMONSTERS} kogels komt in stappen van ${nr(kogelStap)} m dwars door de westgevel heen`,
		);
	}

	// Een oog dat wél in een doos staat kijkt er nog steeds uit, want anders ziet een
	// bewaker die tegen een wand aan geduwd is nooit meer iets.
	const inDeMuur = { x: -36.3, y: ooghoogte, z: 12 };
	const naastDeMuur = { x: -34, y: ooghoogte, z: 12 };
	if (!wereld.hasLineOfSight(inDeMuur, naastDeMuur, LINE_OF_SIGHT)) {
		fout('zichtlijn', 'wie met zijn rug in de westgevel staat ziet niets meer, terwijl hij er juist uit hoort te kijken');
	}

	// En er ligt geen collisiondoos onder een dek, dus een kogel van de V1-balustrade
	// viel dwars door de begane grond heen. Buiten het atriumgat hoort hij op de
	// plaat te blijven; erin hoort hij er wél doorheen te vallen.
	const opDeVloer = { x: 10, y: V1 - 1, z: 3 };
	const bovenDeVloer = { x: 10, y: V1 + 1, z: 3 };
	if (!wereld.crossesSlab(bovenDeVloer, opDeVloer, BULLET_RADIUS)) {
		fout('zichtlijn', `een kogel valt bij (${nr(opDeVloer.x)}, ${nr(opDeVloer.z)}) dwars door de V1-plaat heen`);
	}
	const inHetGat = { x: 0, y: V1 - 1, z: 0 };
	const bovenHetGat = { x: 0, y: V1 + 1, z: 0 };
	if (wereld.crossesSlab(bovenHetGat, inHetGat, BULLET_RADIUS)) {
		fout('zichtlijn', 'een kogel loopt stuk op het atriumgat, waar juist geen plaat ligt');
	}

	// Elke doos die het zicht tegenhoudt hoort ook geometrie te zijn die je ziet.
	// Een onzichtbare zichtmuur is precies de bug die de vorige regel uitsluit.
	for (const doos of wereld.boxes) {
		if (!doos.tags?.includes(SIGHT_BLOCKING_TAG)) continue;
		if (doos.climbable) fout('zichtlijn', `${doos.label ?? 'naamloze doos'} is beklimbaar en houdt toch het zicht tegen`);
	}
}

// ── 18. het dakluik boven de geheime trap ──────────────────────────────────

/** Eén frame lopen, zoals de speler hem krijgt. */
const LUIK_DT = 1 / 60;
/** Waar de wandelaar begint: buiten de aanwezigheidszone van het luik. */
const LUIK_AANLOOP = 2;
/** Hoever de blikken vanaf de rand van het trapgat naar binnen staan, zodat het openstaande blad niet meetelt. */
const LUIK_BLIKRAND = 0.1;
/** Aantal blikken per as over het trapgat. */
const LUIK_BLIKKEN = 5;

/**
 * Het luik boven de geheime trap gaat open voor wie eraan komt.
 *
 * Het trapgat lag altijd open: er zat een kozijn omheen en verder niets, dus de
 * enige trap naar het dak was een gat in het dek. Nu ligt er een blad in dat het
 * dek afmaakt zolang er niemand staat, en dat is precies het geval dat
 * `validateSpatialWorld` alleen doorlaat als er een mechanisme aan hangt. Deze
 * controle loopt het na zoals de speler het loopt: dicht is vloer, wie erheen
 * loopt krijgt het binnen de openingstijd van het mechanisme open, wie eronder
 * staat ook, en zodra iedereen weg is valt het weer dicht.
 */
async function controleLuik(): Promise<void> {
	const poorten = HELIPAD_HATCH.volumes.filter((volume) => volume.clearance.kind === 'automatic-gate');
	if (poorten.length === 0) {
		fout('luik', `${HELIPAD_HATCH.id} heeft geen enkel blad dat automatisch opengaat`);
		return;
	}
	for (const poort of poorten) {
		if (poort.clearance.kind !== 'automatic-gate') continue;
		const mechanismeId = poort.clearance.mechanismId;
		const mechanisme = HELIPAD_HATCH.mechanisms.find((kandidaat) => kandidaat.id === mechanismeId);
		if (!mechanisme) {
			fout('luik', `${poort.id} hangt aan mechanisme '${mechanismeId}', dat niet op ${HELIPAD_HATCH.id} staat`);
			return;
		}
		if (!mechanismAdmits(HELIPAD_HATCH, mechanismeId, 'pedestrian')) {
			fout('luik', `${mechanismeId} laat geen voetganger toe, dus de trap naar het dak is voor niemand`);
		}
	}

	// Het blad moet het hele trapgat dekken; een blad dat de helft afdekt laat je
	// er langs de rand nog steeds in vallen.
	const blad = mechanismGateBounds(HELIPAD_HATCH, HELIPAD_HATCH_GATE.id);
	const gat = SECRET_STAIRS_OPENING_BOUNDS;
	if (blad.minX > gat.minX + EPS || blad.maxX < gat.maxX - EPS || blad.minZ > gat.minZ + EPS || blad.maxZ < gat.maxZ - EPS) {
		fout(
			'luik',
			`het blad dekt ${nr(span(blad.minX, blad.maxX))}×${nr(span(blad.minZ, blad.maxZ))} m van een trapgat van ${nr(span(gat.minX, gat.maxX))}×${nr(span(gat.minZ, gat.maxZ))} m`,
		);
	}

	stubDocument();
	const [THREE, { LightPool }, { Helipad }] = await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/Helipad'),
	]);
	const dak = new CollisionWorld();
	const luik = new Helipad(new LightPool(new THREE.Scene()), dak);
	const midX = midpoint(gat.minX, gat.maxX);
	const midZ = midpoint(gat.minZ, gat.maxZ);
	const oog = DAK + STANDING_PEDESTRIAN.eyeHeight;
	const zone = mechanismTriggerBounds(HELIPAD_HATCH, HELIPAD_HATCH_GATE.id);
	const wandelaar = new THREE.Vector3();
	const verweg = new THREE.Vector3(zone.maxX + LUIK_AANLOOP, oog, midZ);
	const dicht = (): boolean => bijna(dak.groundHeightAt(midX, midZ, DAK, WALK_STEP), DAK, 1e-3);

	luik.update(LUIK_DT, verweg);
	if (!dicht()) {
		fout(
			'luik',
			`zonder iemand in de buurt geeft de wereld op het trapgat ${nr(dak.groundHeightAt(midX, midZ, DAK, WALK_STEP))} in plaats van het dek ${nr(DAK)}`,
		);
	}

	// Erheen lopen, en bij de rand van het gat blijven staan tot het opengaat.
	const aanloop = Math.ceil(span(gat.maxX, verweg.x) / (WALK_SPEED * LUIK_DT));
	const wachten = Math.ceil(HELIPAD_HATCH_SPEC.openSeconds / LUIK_DT) + 2;
	let x = verweg.x;
	let inZone = 0;
	let opengegaan = -1;
	for (let stap = 0; stap < aanloop + wachten && opengegaan < 0; stap++) {
		luik.update(LUIK_DT, wandelaar.set(x, oog, midZ));
		if (!dicht()) opengegaan = inZone;
		if (x > zone.minX && x < zone.maxX) inZone += LUIK_DT;
		x = Math.max(gat.maxX, x - WALK_SPEED * LUIK_DT);
	}
	if (opengegaan < 0) {
		fout('luik', 'wie naar het luik toe loopt krijgt het niet open: het trapgat blijft dicht');
	} else if (opengegaan > HELIPAD_HATCH_SPEC.openSeconds + LUIK_DT) {
		fout(
			'luik',
			`het luik staat pas na ${nr(opengegaan)} s in de zone open, terwijl zijn mechanisme ${nr(HELIPAD_HATCH_SPEC.openSeconds)} s opgeeft`,
		);
	}

	// En weer dicht zodra er niemand meer staat, anders is het gat gewoon open.
	for (let stap = 0; stap < wachten; stap++) luik.update(LUIK_DT, verweg);
	if (!dicht()) fout('luik', 'het luik blijft openstaan nadat iedereen is weggelopen');

	// Wat er boven het trapgat ligt, ligt in de weg. Het plateau van de helipad lag
	// eroverheen: het blad ging open, de vloerplaat ging eraf, en je keek nog steeds
	// op massief dek. Deze blikken kijken van ooghoogte recht omlaag door het gat.
	const platen: Mesh[] = [];
	luik.group.traverse((deel) => {
		if (deel instanceof THREE.Mesh) platen.push(deel);
	});
	const omlaag = new THREE.Vector3(0, -1, 0);
	const straal = new THREE.Raycaster(new THREE.Vector3(), omlaag);
	const blik = new THREE.Vector3();
	const bovenop = (x: number, z: number) => {
		luik.group.updateMatrixWorld(true);
		straal.set(blik.set(x, oog, z), omlaag);
		return straal.intersectObjects(platen, false).find((raak) => raak.point.y > HELIPAD_DECK_TOP_Y + EPS) ?? null;
	};
	// Buiten de rand, want het openstaande blad staat rechtop op de scharnierkant van het gat.
	const blikken: { x: number; z: number }[] = [];
	for (let i = 0; i < LUIK_BLIKKEN; i++) {
		for (let j = 0; j < LUIK_BLIKKEN; j++) {
			blikken.push({
				x: lerp(gat.minX + LUIK_BLIKRAND, gat.maxX - LUIK_BLIKRAND, i / (LUIK_BLIKKEN - 1)),
				z: lerp(gat.minZ + LUIK_BLIKRAND, gat.maxZ - LUIK_BLIKRAND, j / (LUIK_BLIKKEN - 1)),
			});
		}
	}

	// Dicht is het blad zelf het bovenste vlak; ligt er iets anders overheen, dan ligt
	// het blad begraven en zie je het nooit opengaan.
	const bladTop = HELIPAD_DECK_TOP_Y + HELIPAD_HATCH_SPEC.lidThickness;
	for (const punt of blikken) {
		const boven = bovenop(punt.x, punt.z);
		if (!boven) {
			fout('luik', `boven het dichte trapgat op (${nr(punt.x)}, ${nr(punt.z)}) ligt niets: daar is het dek een gat`);
			break;
		}
		if (!bijna(boven.point.y, bladTop, 1e-3)) {
			fout(
				'luik',
				`op (${nr(punt.x)}, ${nr(punt.z)}) ligt ${boven.object.name || boven.object.type} op ${nr(boven.point.y)} over het luikblad op ${nr(bladTop)}`,
			);
			break;
		}
	}

	// Van onderaf: wie de trap op klimt staat onder het dek en hoort er ook uit te komen.
	const klimmer = new THREE.Vector3(midX, midpoint(zone.minY, DAK), midZ);
	for (let stap = 0; stap < wachten; stap++) luik.update(LUIK_DT, klimmer);
	if (dicht()) fout('luik', 'wie van de trap omhoog komt loopt tegen een dicht luik: het gaat alleen van bovenaf open');

	// En met het blad weg hoort er helemaal niets meer boven het gat te liggen.
	for (const punt of blikken) {
		const boven = bovenop(punt.x, punt.z);
		if (boven) {
			fout(
				'luik',
				`met het luik open ligt ${boven.object.name || boven.object.type} nog op ${nr(boven.point.y)} boven het trapgat op (${nr(punt.x)}, ${nr(punt.z)})`,
			);
			break;
		}
	}
}

/**
 * `onRamp` kent elke vlucht over zijn hele hoogte, ongeacht welke kant hij op klimt.
 *
 * Een vaste band 0.6..FLOOR_H−0.6 kende alleen een V0→V1-vlucht en verklaarde de geheime
 * trap (6..13.95) en de glijbaanladder tot vlakke vloer; de band is nu per vlucht uit
 * min/max van zijn eigen twee einden. Deze arm loopt elke vlucht: midden op de trede is
 * `onRamp` waar, onder de voet en boven de kop niet. De twee steile vluchten (geheime trap,
 * glijbaanladder) klimmen met zBottom < zTop, de twee andere met zBottom > zTop, dus beide
 * richtingen komen langs.
 */
function controleHellingband(): void {
	for (const r of wereld.ramps) {
		const hart = midpoint(r.minX, r.maxX);
		const midY = midpoint(r.yBottom, r.yTop);
		const midZ = lerp(r.zBottom, r.zTop, (midY - r.yBottom) / (r.yTop - r.yBottom));
		if (!wereld.onRamp(hart, midZ, midY)) {
			fout(
				'hellingband',
				`${r.label}: midden op de vlucht (${nr(hart)}, ${nr(midZ)}, y ${nr(midY)}) zegt onRamp dat je op vlakke vloer staat`,
			);
		}
		const voetY = Math.min(r.yBottom, r.yTop);
		const voetZ = r.yBottom < r.yTop ? r.zBottom : r.zTop;
		if (wereld.onRamp(hart, voetZ, voetY - 1)) {
			fout('hellingband', `${r.label}: een meter onder de voet (y ${nr(voetY - 1)}) telt onRamp je nog op de vlucht`);
		}
		const kopY = Math.max(r.yBottom, r.yTop);
		const kopZ = r.yBottom < r.yTop ? r.zTop : r.zBottom;
		if (wereld.onRamp(hart, kopZ, kopY + 1)) {
			fout('hellingband', `${r.label}: een meter boven de kop (y ${nr(kopY + 1)}) telt onRamp je nog op de vlucht`);
		}
	}
}

/**
 * De vlucht op- en aflopen raakt nooit airborne, en mid-kanaal is de grond nooit het dak.
 *
 * Controls laat de speler los zodra de vloer onder zijn voeten meer dan WALK_STEP
 * wegzakt: dat is de schone dakrandval van #22. Op een trap mag dat nooit gebeuren,
 * en op de geheime trap gebeurde het: het luik boven het trapgat is een dakplaat die
 * met zijn stand mee aan- en uitgaat, en die plaat overschaduwde de vlucht in
 * `groundHeightAt`. Sta je klimmend onder een dicht luik, dan gaf de wereld het dek
 * (13.95) in plaats van de trede eronder — een stap omhoog op het dek — en zodra het luik
 * openging zakte de vloer terug naar de vlucht en liet de klifcheck je los: de snap-loop.
 * `snapFloorY` (de sim) vroeg de vlucht al vóór de plaat; deze arm eist dat `groundHeightAt`
 * (de speler) hetzelfde doet, mét het luik open én dicht, in beide looprichtingen.
 */
type Loopvlucht = Readonly<{
	minX: number;
	maxX: number;
	zBottom: number;
	zTop: number;
	yBottom: number;
	yTop: number;
	label: string;
}>;

function loopVluchtLos(
	world: CollisionWorld,
	r: Loopvlucht,
	richting: 'op' | 'af',
	drijfLuik: ((oog: Vector3) => void) | null,
	oog: Vector3,
): string | null {
	const stap = WALK_SPEED * LUIK_DT;
	const eye = STANDING_PEDESTRIAN.eyeHeight;
	const hart = midpoint(r.minX, r.maxX);
	const zLaag = r.yBottom < r.yTop ? r.zBottom : r.zTop;
	const zHoog = r.yBottom < r.yTop ? r.zTop : r.zBottom;
	const startZ = richting === 'op' ? zLaag : zHoog;
	const eindZ = richting === 'op' ? zHoog : zLaag;
	const teken = Math.sign(eindZ - startZ);
	let z = startZ;
	let feetY = richting === 'op' ? Math.min(r.yBottom, r.yTop) : Math.max(r.yBottom, r.yTop);
	// Extra frames boven de looplengte zodat het luik middenin de klim kan wisselen.
	const frames = Math.ceil(Math.abs(eindZ - startZ) / stap) + Math.ceil(HELIPAD_HATCH_SPEC.openSeconds / LUIK_DT) + 4;
	for (let f = 0; f < frames; f++) {
		if (drijfLuik) drijfLuik(oog.set(hart, feetY + eye, z));
		z += teken * stap;
		if (teken > 0 ? z > eindZ : z < eindZ) z = eindZ;
		const grond = world.groundHeightAt(hart, z, feetY, WALK_STEP);
		if (feetY - grond > WALK_STEP) {
			return `${r.label} ${richting}: op (${nr(hart)}, ${nr(z)}) zakt de vloer van ${nr(feetY)} naar ${nr(grond)}, ${nr(feetY - grond)} m in één stap terwijl WALK_STEP ${nr(WALK_STEP)} is, en de klifcheck laat je los van de trap`;
		}
		// Mid-kanaal mag de grond nooit het dak zijn zolang de vlucht eronder loopt: springt hij
		// een hele stap omhoog, dan overschaduwt het luik of de dakplaat de trede en plakt hij je
		// op het dek in plaats van je op de trap te dragen.
		if (grond - feetY > WALK_STEP) {
			return `${r.label} ${richting}: op (${nr(hart)}, ${nr(z)}) springt de vloer van ${nr(feetY)} naar ${nr(grond)}, ${nr(grond - feetY)} m omhoog terwijl WALK_STEP ${nr(WALK_STEP)} is, en de plaat plakt je van de trap op het dak`;
		}
		feetY = grond;
	}
	return null;
}

async function controleTrapklim(): Promise<void> {
	stubDocument();
	const [THREE, { LightPool }, { Helipad }] = await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/Helipad'),
	]);
	const oog = new THREE.Vector3();

	// Elke wandeltrap op de kale wereld, op en af. De glijbaanladder is een
	// arcade-klim en geen wandeltrap; die dekken controleLadder en controleGlijbaan.
	for (const r of wereld.ramps) {
		if (r.label === 'slide_ladder') continue;
		for (const richting of ['op', 'af'] as const) {
			const klacht = loopVluchtLos(wereld, r, richting, null, oog);
			if (klacht) {
				fout('trapklim', klacht);
				break;
			}
		}
	}

	// De geheime trap mét luik, gedreven door aanwezigheid: een verse Helipad per
	// richting zodat het luik dicht begint en pas tijdens de wandeling opengaat.
	for (const richting of ['op', 'af'] as const) {
		const dak = new CollisionWorld();
		const luik = new Helipad(new LightPool(new THREE.Scene()), dak);
		const trap = dak.ramps.find((r) => r.label === 'secret-stairs');
		if (!trap) {
			fout('trapklim', 'geen geheime trap in de wereld om te belopen');
			return;
		}
		const klacht = loopVluchtLos(dak, trap, richting, (p) => luik.update(LUIK_DT, p), oog);
		if (klacht) fout('trapklim', `met luik — ${klacht}`);
	}
}

// ── 19. de glijbaan draagt je het bad in ───────────────────────────────────

/** Eén frame glijden. */
const GLIJ_DT = 1 / 60;
/** Hoever boven de waterspiegel de rit je nog mag loslaten. */
const GLIJ_LOSLAAT = 0.5;

/**
 * De glijbaan is een rit en geen decor.
 *
 * De buis was geometrie zonder betekenis: je viel er dwars doorheen op het dek en
 * alleen een losse cameratruc bracht je in het water. Nu draagt elk buisdeel je met
 * zijn eigen conveyor-stroming, en het instappunt ligt op de plaat waar de ladder op
 * uitkomt. Deze controle stapt er headless in en kijkt waar de rit hem loslaat.
 */
async function controleGlijbaan(): Promise<void> {
	const oppervlakken = ROOF_SLIDE_ENTITY.volumes.filter(
		(volume) => volume.tags.includes('travel-surface') && volume.geometry.kind === 'ramp',
	);
	if (oppervlakken.length === 0) {
		fout('glijbaan', 'de glijbaan heeft geen enkel loopvlak meer: de buis is weer decor');
		return;
	}
	const stromingen = ROOF_SLIDE_ENTITY.emitters.filter((emitter) => emitter.channel === 'conveyor');
	if (stromingen.length !== oppervlakken.length) {
		fout('glijbaan', `${oppervlakken.length} buisdelen tegen ${stromingen.length} stromingen: niet elk deel neemt je mee`);
	}
	for (const stroming of stromingen) {
		const bron = ROOF_SLIDE_ENTITY.volumes.find((volume) => volume.id === stroming.sourceVolumeId);
		if (!bron) {
			fout('glijbaan', `${stroming.id} stroomt over volume '${stroming.sourceVolumeId}', dat er niet is`);
			continue;
		}
		if (stroming.field.kind !== 'surface') {
			fout('glijbaan', `${stroming.id} is een ${stroming.field.kind}-veld en geen loopvlakstroming`);
			continue;
		}
		const vaart = Math.hypot(stroming.field.vector.x, stroming.field.vector.y, stroming.field.vector.z);
		if (!bijna(vaart, SLIDE_TOWER_SPEC.tube.speed, 1e-9)) {
			fout(
				'glijbaan',
				`${stroming.id} draagt met ${nr(vaart)} m/s terwijl de buis ${nr(SLIDE_TOWER_SPEC.tube.speed)} m/s opgeeft`,
			);
		}
	}

	const [THREE, { SlideRide }] = await Promise.all([import('three'), import('#/scene/SlideRide')]);
	const rit = new SlideRide();

	// Instappen kan alleen op de plaat: bovenaan de ladder sta je nog niet in de mond.
	const instap = ROOF_SLIDE_ENTITY.volumes.find((volume) => volume.tags.includes('slide-entry'));
	if (!instap) {
		fout('glijbaan', 'de glijbaan heeft geen instappunt');
		return;
	}
	const mond = geometryBounds(instap.geometry);
	const voeten = SLIDE_PLATFORM_TOP_Y;
	if (!rit.accepts(midpoint(mond.minX, mond.maxX), voeten, midpoint(mond.minZ, mond.maxZ))) {
		fout('glijbaan', 'wie op de plaat in de mond van de buis staat wordt niet meegenomen');
	}
	if (rit.accepts(SLIDE_LADDER_X, voeten, SLIDE_LADDER_CLIMB.zTop)) {
		fout('glijbaan', 'bovenaan de ladder sta je al in de mond: je glijdt weg voor je de plaat op bent');
	}

	// De rit zelf, in spelerframes, van de mond tot waar hij je loslaat.
	const punt = new THREE.Vector3();
	let afstand = 0;
	const frames = Math.ceil(rit.length / (rit.speed * GLIJ_DT)) + 2;
	let stappen = 0;
	while (afstand < rit.length && stappen < frames) {
		afstand += rit.speed * GLIJ_DT;
		stappen++;
		rit.pointAt(afstand, punt);
		if (punt.y > SLIDE_PLATFORM_TOP_Y + EPS) {
			fout('glijbaan', `de rit klimt op ${nr(afstand)} m naar ${nr(punt.y)}, boven de plaat waar hij begint`);
			break;
		}
	}
	if (afstand < rit.length) {
		fout('glijbaan', `de rit staat na ${nr(stappen)} frames stil op ${nr(afstand)} van de ${nr(rit.length)} m`);
		return;
	}
	rit.pointAt(rit.length, punt);
	if (!inPool(punt.x, punt.z)) {
		fout('glijbaan', `de glijbaan laat je los op (${nr(punt.x)}, ${nr(punt.z)}), buiten de waterlijn`);
	}
	if (punt.y > POOL_WATER_Y + GLIJ_LOSLAAT) {
		fout(
			'glijbaan',
			`de glijbaan laat je los op ${nr(punt.y)}, meer dan ${nr(GLIJ_LOSLAAT)} m boven de waterspiegel ${nr(POOL_WATER_Y)}`,
		);
	}
	const bodem = poolFloorY(punt.x, punt.z);
	if (bodem === null) {
		fout('glijbaan', 'waar de rit eindigt heeft het bad geen bodem: je landt op de tegels');
		return;
	}

	// Wie in het diepe belandt zwemt op het dak, ook al hangen zijn voeten onder de
	// dakdrempel. De badbodem ligt onder die drempel (`levelBand('roof').minY`), dus
	// `levelAt` las daar V1 en de zonecull tekende het interieur eronder: je keek dwars
	// door het gebouw. `deckAt`/`zoneAt` horen de hele badkolom als dak te tellen, van de
	// bodem tot het dek. Een gehurkte zwemmer zakt met zijn camera het diepst; die pose is
	// de scherprechter, want staand blijft hij toch al boven de drempel.
	const dakDrempel = levelBand('roof').minY;
	if (levelAt(bodem) === 'roof') {
		fout('glijbaan', `badbodem ${nr(bodem)} ligt boven de dakdrempel: deze controle bewijst dan niets meer`);
	}
	if (deckAt(punt.x, bodem, punt.z) !== 'roof') {
		fout('glijbaan', `HUD leest ${deckAt(punt.x, bodem, punt.z)} op de badbodem ${nr(bodem)} in plaats van het dak`);
	}
	// Camera van een gehurkte zwemmer: onder de dakdrempel maar in de kuip.
	const gehurkteOogH = midpoint(bodem, dakDrempel);
	if (gehurkteOogH >= dakDrempel) {
		fout('glijbaan', 'de gehurkte-oogtest ligt niet onder de dakdrempel: hij bewijst het lek niet');
	}
	if (zoneAt(punt.x, gehurkteOogH, punt.z) !== 'roof') {
		fout(
			'glijbaan',
			`een gehurkte zwemmer op ${nr(gehurkteOogH)} leest zone ${zoneAt(punt.x, gehurkteOogH, punt.z)}: doorkijk-limbo`,
		);
	}
	// Geen overreiken: recht onder het bad, op verdiepingshoogte, hoort gewoon V1.
	const onderBad = levelY('v1') + 2;
	if (zoneAt(punt.x, onderBad, punt.z) !== 'mall-v1') {
		fout('glijbaan', `onder het bad op ${nr(onderBad)} claimt de kuip ten onrechte ${zoneAt(punt.x, onderBad, punt.z)}`);
	}
}

/**
 * Uit het dakbad kom je er weer uit.
 *
 * Het bad is een kuil in de dakplaat en staat open naar de lucht. `groundHeightAt`
 * weet dat (`poolFloorY` gaat vóór de dakpads), maar `headroomAt` las de dakplaat als
 * een plafond van 0,6 m boven de badbodem. `fits()` eist staande vrije hoogte, dus op
 * de hele diepe bodem kon je geen stap zetten en zat je muurvast. Overal waar je in het
 * bad kunt staan hoort een staand lichaam te passen.
 */
function controleUitzwembad(): void {
	const STAP = 0.75;
	let diepste = Number.POSITIVE_INFINITY;
	let gemeten = 0;
	let klem: string | null = null;
	for (let x = POOL_CENTER.x - 8; x <= POOL_CENTER.x + 8; x += STAP) {
		for (let z = POOL_CENTER.z - 5; z <= POOL_CENTER.z + 5; z += STAP) {
			const bodem = poolFloorY(x, z);
			if (bodem === null) continue;
			gemeten++;
			if (bodem < diepste) diepste = bodem;
			const vrij = wereld.headroomAt(x, z, bodem);
			if (vrij < STAND_HEADROOM && klem === null) {
				klem = `(${nr(x)}, ${nr(z)}) op badbodem ${nr(bodem)} heeft ${nr(vrij)} m vrije hoogte, minder dan de ${nr(STAND_HEADROOM)} m die staand nodig is`;
			}
		}
	}
	if (gemeten === 0) {
		fout('uitzwembad', 'geen enkel punt binnen de waterlijn bemonsterd: de controle raakt het bad niet');
		return;
	}
	if (Math.abs(diepste - POOL_FLOOR_Y) > STAP) {
		fout(
			'uitzwembad',
			`het diepste bemonsterde punt is ${nr(diepste)}, niet de badbodem ${nr(POOL_FLOOR_Y)}: het diepe wordt niet geraakt`,
		);
	}
	if (klem) fout('uitzwembad', `je komt het bad niet uit: ${klem}`);
}

/**
 * De speler- en de sim-vloerlezer zijn het overal eens.
 *
 * `groundHeightAt` (speler) en `snapFloorY` (sims) horen dezelfde vloer te geven. Ze
 * liepen uiteen waar de dakplaat een eigen kennis miste: in het dakbad beloofde
 * `snapFloorY` het dek (13.95) waar de bodem op ~12.9 ligt, en boven een dak-reikend
 * trapgat beloofde het het dek waar de vlucht eronder de vloer is. Zo liep een sim op
 * het water of zweefde hij boven het gat. `poolFloorY` uit de datalaag is nu de ene
 * bron; deze controle eist dat beide lezers hem — en de vlucht onder een gat — gelijk
 * lezen, en dat de sweep zowel een bad- als een gatpunt raakt zodat ze iets bewijst.
 */
function controleLezers(): void {
	const hw = half(MALL_FOOTPRINT.width);
	const hd = half(MALL_FOOTPRINT.depth);
	const oog = DAK + RAMP_BAND_MARGIN;
	let bad = 0;
	let gat = 0;
	let oneens: string | null = null;
	for (let x = -hw; x <= hw; x += 1) {
		for (let z = -hd; z <= hd; z += 1) {
			const grond = wereld.groundHeightAt(x, z, oog, WALK_STEP);
			const sim = wereld.snapFloorY(x, z, oog);
			// Alleen waar de vloer óp of ónder het dek ligt: dáár beloofde snapFloorY het
			// dek (13.95) terwijl de bodem lager zat en zette hij een sim op het luchtledige.
			// Een dak-reikende helling (glijbaanladder) ligt bóven het dek en heeft een eigen
			// mid-helling-semantiek; die valt hier buiten.
			if (grond > DAK + EPS) continue;
			if (poolFloorY(x, z) !== null) bad++;
			else if (grond > V1 && grond < DAK) gat++;
			if (Math.abs(grond - sim) > EPS && oneens === null) {
				oneens = `(${nr(x)}, ${nr(z)}): groundHeightAt=${nr(grond)} maar snapFloorY=${nr(sim)}`;
			}
		}
	}
	if (bad === 0) fout('lezers', 'geen bad-punt op dakhoogte bemonsterd: de bad-consistentie wordt niet geraakt');
	if (gat === 0) fout('lezers', 'geen dak-reikend gat bemonsterd: de gat-consistentie wordt niet geraakt');
	if (oneens) fout('lezers', `speler- en sim-vloer zijn het oneens: ${oneens}`);
}

/**
 * Geen batch verliest het dek van een van zijn bronnen.
 *
 * De batcher voegt gelijkgekleurde vlakken per cel samen, en de cel-sleutel leest de
 * mesh-translatie-y — niet de vertex-y — dus twee platen op verschillende dekken met
 * gebakken vertices op de oorsprong delen een cel en dus een batch. Statische batches
 * slaan `update()` over, dus een fout in het opbouwmasker is definitief. Zo verdween
 * Kajs vloerbatch: het masker miste het tweede dek en geen kegel dekte hem. Deze
 * controle bouwt zo'n grensgeval — een bord dat V1 verklaart bovenop zijn V0-doos, naast
 * een gewoon vlak — en eist dat het batchmasker (en de bol) alle bron-dekken dekt.
 */
async function controleBatchbron(): Promise<void> {
	stubDocument();
	const winkel = new Map<string, string>();
	(globalThis as unknown as { localStorage: unknown }).localStorage = {
		getItem: (k: string) => winkel.get(k) ?? null,
		setItem: (k: string, v: string) => winkel.set(k, v),
		removeItem: (k: string) => winkel.delete(k),
	};
	const [THREE, { SceneBatcher }, { tagZoneSpan, zoneSpanOf }] = await Promise.all([
		import('three'),
		import('#/render/SceneBatcher'),
		import('#/render/ZoneVisibility'),
	]);
	// De echte plaat eindigt door de Float32-posities van ExtrudeGeometry een
	// fractie onder y=6. Toch is haar bovenvlak de V1-vloer en moet haar masker
	// dus V1 dragen. Anders verdwijnt ze op Kajs positie zodra hij van het atrium
	// naar de dichte zuidwand draait en geen V1→V0-portaalkegel haar meer redt.
	const v1Bovenvlak = levelY('v1') - 1.2e-8;
	const v1PlaatMasker = zoneMaskOfBounds({
		minX: -half(MALL_FOOTPRINT.width),
		maxX: half(MALL_FOOTPRINT.width),
		minY: v1Bovenvlak - MALL_SLAB_SPECS.v1.thickness,
		maxY: v1Bovenvlak,
		minZ: -half(MALL_FOOTPRINT.depth),
		maxZ: half(MALL_FOOTPRINT.depth),
	});
	if ((v1PlaatMasker & zoneBit('mall-v1')) === 0) {
		fout('batchbron', 'de gerenderde V1-plaat verliest V1 door Float32-afronding aan de dekgrens');
	}
	const scene = new THREE.Scene();
	const mat = new THREE.MeshLambertMaterial({ color: 0x808080 });
	const geo = new THREE.BoxGeometry(4, 0.2, 4);
	const vloer = new THREE.Mesh(geo, mat);
	vloer.position.set(0, 0, 0.5);
	scene.add(vloer);
	const bord = new THREE.Mesh(geo, mat);
	bord.position.set(0, 0, -0.5);
	// Grensobject: verklaart V1 bovenop zijn V0-doos, zoals het roltrapbord.
	tagZoneSpan(bord, zoneBit('mall-v1'));
	scene.add(bord);

	const batcher = new SceneBatcher(scene);
	const doos = new THREE.Box3();
	const hoek = new THREE.Vector3();
	let bordGedekt = false;
	for (const batch of batcher.auditBatches()) {
		for (const bron of batch.sources) {
			const span = zoneSpanOf(bron);
			if ((batch.zoneMask & span) !== span) {
				fout(
					'batchbron',
					`een batch mist de verklaarde span ${zonesOfMask(span)} van een bron (masker ${zonesOfMask(batch.zoneMask)})`,
				);
			}
			doos.setFromObject(bron);
			const boxMasker = doos.isEmpty()
				? 0
				: zoneMaskOfBounds({
						minX: doos.min.x,
						maxX: doos.max.x,
						minY: doos.min.y,
						maxY: doos.max.y,
						minZ: doos.min.z,
						maxZ: doos.max.z,
					});
			if ((batch.zoneMask & boxMasker) !== boxMasker) {
				fout(
					'batchbron',
					`een batch mist het dek ${zonesOfMask(boxMasker)} van een bron-doos (masker ${zonesOfMask(batch.zoneMask)})`,
				);
			}
			if (batch.sphere) {
				for (const bx of [doos.min.x, doos.max.x]) {
					for (const by of [doos.min.y, doos.max.y]) {
						for (const bz of [doos.min.z, doos.max.z]) {
							if (!batch.sphere.containsPoint(hoek.set(bx, by, bz))) {
								fout('batchbron', 'de batch-bol dekt de doos van een bron niet');
							}
						}
					}
				}
			}
			if (bron === bord && (batch.zoneMask & zoneBit('mall-v1')) !== 0) bordGedekt = true;
		}
	}
	if (!bordGedekt) {
		fout('batchbron', 'het grensbord landde niet in een batch met zijn verklaarde V1: deze controle bewijst niets');
	}
}

/**
 * Het weer valt buiten, niet binnen. Het onweersfront strooit regen en bliksem over de
 * stad; onder een dak hoort het droog te blijven. De uitsluiting komt uit de
 * gebouwschillen (`coversColumn`) en niet uit een tweede voetafdruk, dus een nieuw
 * gebouw doet vanzelf mee. Zonder dat regende het binnen in het verse theater.
 */
function controleNeerslag(): void {
	const lucht = new CitySky();
	let binnen = 0;
	let voorbeeld: Readonly<{ x: number; z: number }> | null = null;
	for (const kolom of lucht.precipitationColumns()) {
		if (!coversColumn(kolom.x, kolom.z)) continue;
		binnen++;
		voorbeeld ??= kolom;
	}
	if (voorbeeld) {
		fout('neerslag', `${binnen} druppel(s) vallen onder een dak, o.a. op (${nr(voorbeeld.x)}, ${nr(voorbeeld.z)})`);
	}
	// De uitsluiting mag niet leeg zijn: elk gebouwhart hoort overdekt te heten, anders
	// zou een druppel-check die niets vindt ook slagen op een schil die niemand dekt.
	for (const gebouw of ZONE_ENCLOSURES) {
		const hartX = midpoint(gebouw.plan.minX, gebouw.plan.maxX);
		const hartZ = midpoint(gebouw.plan.minZ, gebouw.plan.maxZ);
		if (!coversColumn(hartX, hartZ)) {
			fout('neerslag', `het hart van ${gebouw.id} (${nr(hartX)}, ${nr(hartZ)}) heet niet overdekt`);
		}
	}
}

// ── uitvoeren ──────────────────────────────────────────────────────────────

const controles: { naam: string; draai: () => void | Promise<void> }[] = [
	{ naam: 'voorraad', draai: controleVoorraad },
	{ naam: 'lift', draai: controleLift },
	{ naam: 'hellingen', draai: controleHellingen },
	{ naam: 'vloergat', draai: controleVloergat },
	{ naam: 'hellinglijn', draai: controleHellinglijn },
	{ naam: 'parkeeruitrit', draai: controleParkeeruitrit },
	{ naam: 'uitrithek', draai: controleUitrithek },
	{ naam: 'parkeerschil', draai: controleParkeerschil },
	{ naam: 'ingang', draai: controleIngang },
	{ naam: 'hurken', draai: controleHurken },
	{ naam: 'daklus', draai: controleDaklus },
	{ naam: 'dakdek', draai: controleDakdek },
	{ naam: 'ladder', draai: controleLadder },
	{ naam: 'luik', draai: controleLuik },
	{ naam: 'hellingband', draai: controleHellingband },
	{ naam: 'trapklim', draai: controleTrapklim },
	{ naam: 'glijbaan', draai: controleGlijbaan },
	{ naam: 'glazendak', draai: controleGlazenDak },
	{ naam: 'zwembad', draai: controleZwembad },
	{ naam: 'uitzwembad', draai: controleUitzwembad },
	{ naam: 'lezers', draai: controleLezers },
	{ naam: 'batchbron', draai: controleBatchbron },
	{ naam: 'badgasten', draai: controleBadgasten },
	{ naam: 'platforms', draai: controlePlatforms },
	{ naam: 'balustradesprong', draai: controleBalustradesprong },
	{ naam: 'crouchsprong', draai: controleCrouchsprong },
	{ naam: 'winkeldata', draai: controleWinkeldata },
	{ naam: 'features', draai: controleFeatures },
	{ naam: 'kamerwanden', draai: controleKamerwanden },
	{ naam: 'bestemmingen', draai: controleBestemmingen },
	{ naam: 'gevel', draai: controleGevel },
	{ naam: 'buitenwerk', draai: controleBuitenwerk },
	{ naam: 'puien', draai: controlePuien },
	{ naam: 'winkelachterwanden', draai: controleWinkelachterwanden },
	{ naam: 'parkeerplekken', draai: controleParkeerplekken },
	{ naam: 'parkeerverf', draai: controleParkeerverf },
	{ naam: 'kioskcoordinaten', draai: controleKioskCoordinaten },
	{ naam: 'kaartdekken', draai: controleKaartdekken },
	{ naam: 'stad', draai: controleStad },
	{ naam: 'wegen', draai: controleWegen },
	{ naam: 'slagbomen', draai: controleSlagbomen },
	{ naam: 'voertuigen', draai: controleVoertuigen },
	{ naam: 'karklim', draai: controleKarklim },
	{ naam: 'klemvrij', draai: controleKlemvrij },
	{ naam: 'motorrit', draai: controleMotorrit },
	{ naam: 'ingangmotor', draai: controleIngangMotor },
	{ naam: 'geulverkeer', draai: controleGeulverkeer },
	{ naam: 'kaartlabels', draai: controleKaartlabels },
	{ naam: 'theater', draai: controleTheater },
	{ naam: 'neerslag', draai: controleNeerslag },
	{ naam: 'zonegraaf', draai: controleZonegraaf },
	{ naam: 'zonecull', draai: controleZonecull },
	{ naam: 'roltrapbord', draai: controleRoltrapbord },
	{ naam: 'zichtlijn', draai: controleZichtlijn },
	{ naam: 'rekenhulpen', draai: controleRekenhulpen },
	{ naam: 'zoneklokken', draai: controleZoneklokken },
	{ naam: 'spiegeltekst', draai: controleSpiegeltekst },
	{ naam: 'spiegelwand', draai: controleSpiegelwand },
	{ naam: 'kopieen', draai: controleKopieen },
];

for (const c of controles) {
	try {
		await c.draai();
	} catch (e) {
		fout(c.naam, `controle kon niet draaien: ${e instanceof Error ? e.message : String(e)}`);
	}
}

if (fouten.length === 0) {
	console.log(`check-world: ${controles.length} controles geslaagd`);
} else {
	console.error(`check-world: ${fouten.length} ${fouten.length === 1 ? 'probleem' : 'problemen'} in de wereld\n`);
	for (const f of fouten) console.error(`  ✗ ${f}`);
	console.error('');
	process.exitCode = 1;
}
