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
import { readFileSync } from 'node:fs';
import { assertValidVerticalConnectorRegistry } from '#/data/connectors';
import type { GraphNode } from '#/data/graph';
import { NODES } from '#/data/graph';
import { getInventory } from '#/data/inventory';
import { ATRIUM_VOID } from '#/data/layout';
import { assertCanonicalLevelRegistry } from '#/data/levelSchema';
import { LEVELS, levelY } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { STORES, shopStores } from '#/data/stores';
import type { MallWorldEntity } from '#/data/world';
import {
	ATRIUM_OPENING,
	ELEVATOR_SHAFT_WALLS,
	ELEVATOR_SPEC,
	entitiesOnLevel,
	levelsContaining,
	MALL_SLAB_SPECS,
	PARKING_EXIT_RAMP,
	VERTICAL_CONNECTORS,
	WORLD_ENTITIES,
} from '#/data/world';
import { CollisionWorld, WALK_STEP } from '#/physics/Collision';
import { PLAYER_RADIUS } from '#/player/constants';
import { inPool, POOL_CENTER, POOL_FLOOR_Y, POOL_WATER_Y, poolFloorY, rimDistance } from '#/scene/RoofIsland';
import { half, midpoint } from '#/util/math';
import { stubDocument } from './stub-dom.ts';

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
 * met zijn argumenten op het bovenste haakjesniveau.
 */
function aanroepArgumenten(tekst: string, patroon: RegExp): { naam: string; args: string[] }[] {
	const uit: { naam: string; args: string[] }[] = [];
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
		uit.push({ naam, args });
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
		const rampExtentX = half(ramp.maxX - ramp.minX);
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
				`${connector.id} opening width ${nr(connector.opening.size.width)} is smaller than the ramp width (${nr(ramp.maxX - ramp.minX)}): het vakwerk prikt door de plaat`,
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
	stubDocument();
	const { PoolPeople } = await import('#/scene/PoolPeople');
	// In het water hangen is dieper dan alleen onder dekhoogte: de zonaanbidsters
	// liggen ook onder dekhoogte, in hun stoel. Meet dus vanaf de waterlijn.
	const badgasten = new PoolPeople().group.children.filter((o) => o.position.y < POOL_WATER_Y - 0.75);
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
	'catwalk',
	'restrooms',
	'prayer-room',
	'beard-cave',
	'shop-island_hop',
	'parking-deck',
	'atrium-fountain',
	'info-kiosk',
	'food-court',
	'protest',
	'spaceship',
] as const;

function heeftOmvang(entity: MallWorldEntity): boolean {
	return entity.volumes.some((volume) => {
		const b = geometryBounds(volume.geometry);
		return b.maxX - b.minX > EPS && b.maxZ - b.minZ > EPS && b.maxY - b.minY > EPS;
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
const KAMERWANDEN: Record<string, Record<string, string>> = {
	restrooms: { wc_wall_w: 'wall-west', wc_wall_e: 'wall-east', wc_wall_n: 'wall-north', wc_divider: 'divider' },
	'prayer-room': { prayer_back: 'wall-north', prayer_w: 'wall-west', prayer_e: 'wall-east' },
	'beard-cave': { cave_back: 'cave-back-wall', cave_n: 'cave-wall-north', cave_s: 'cave-wall-south' },
};

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
		for (const [label, volumeId] of Object.entries(tabel)) {
			if (!colliders.some((collider) => collider.label === label)) {
				fout('kamerwanden', `${entiteitId} heeft geen collisiondoos '${label}' meer — hernoemd of weggevallen`);
			}
			if (!entity.volumes.some((volume) => volume.id === volumeId)) {
				fout('kamerwanden', `${entiteitId} heeft geen volume '${volumeId}' meer voor collisiondoos '${label}'`);
			}
		}
		for (const collider of colliders) {
			const volumeId = tabel[collider.label];
			if (volumeId === undefined) {
				fout('kamerwanden', `${entiteitId}: collisiondoos '${collider.label}' hoort bij geen enkel volume`);
				continue;
			}
			const volume = entity.volumes.find((candidate) => candidate.id === volumeId);
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
	f0_c: 'opening-atrium-v1',
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

// ── uitvoeren ──────────────────────────────────────────────────────────────

const controles: { naam: string; draai: () => void | Promise<void> }[] = [
	{ naam: 'voorraad', draai: controleVoorraad },
	{ naam: 'lift', draai: controleLift },
	{ naam: 'hellingen', draai: controleHellingen },
	{ naam: 'vloergat', draai: controleVloergat },
	{ naam: 'hellinglijn', draai: controleHellinglijn },
	{ naam: 'parkeeruitrit', draai: controleParkeeruitrit },
	{ naam: 'ladder', draai: controleLadder },
	{ naam: 'glazendak', draai: controleGlazenDak },
	{ naam: 'zwembad', draai: controleZwembad },
	{ naam: 'badgasten', draai: controleBadgasten },
	{ naam: 'platforms', draai: controlePlatforms },
	{ naam: 'winkeldata', draai: controleWinkeldata },
	{ naam: 'features', draai: controleFeatures },
	{ naam: 'kamerwanden', draai: controleKamerwanden },
	{ naam: 'bestemmingen', draai: controleBestemmingen },
	{ naam: 'kioskcoordinaten', draai: controleKioskCoordinaten },
	{ naam: 'kaartdekken', draai: controleKaartdekken },
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
