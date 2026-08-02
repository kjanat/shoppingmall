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
import { NODES } from '@/data/graph';
import { getInventory } from '@/data/inventory';
import { LEVELS, levelY, SHOP_LEVELS } from '@/data/levels';
import { STORES, shopStores } from '@/data/stores';
import { CollisionWorld, WALK_STEP } from '@/physics/Collision';
import { inPool, POOL_CENTER, POOL_FLOOR_Y, POOL_WATER_Y, poolFloorY, rimDistance } from '@/scene/RoofIsland';

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

/** Eén veld uit een `const NAAM = { … } as const;` blok, als het er staat. */
function losVeld(tekst: string, obj: string, naam: string): number | undefined {
	const blok = new RegExp(`const ${obj} = \\{([\\s\\S]*?)\\n\\} as const;`).exec(tekst)?.[1];
	const ruw = blok === undefined ? undefined : new RegExp(`\\b${naam}:\\s*(-?[\\d.]+)`).exec(blok)?.[1];
	return ruw === undefined ? undefined : Number(ruw);
}

/** Zelfde, maar dit veld hoort er te zijn. */
function veld(tekst: string, obj: string, naam: string): number {
	const waarde = losVeld(tekst, obj, naam);
	if (waarde === undefined) throw new Error(`kon ${obj}.${naam} niet uit de bron lezen — hernoemd of herschreven?`);
	return waarde;
}

function eist(tekst: string, fragment: string, wat: string): void {
	if (!tekst.includes(fragment)) throw new Error(`${wat} staat niet meer in de bron: \`${fragment}\``);
}

/**
 * De straal waarmee de wereld hier belopen wordt. Controls houdt RADIUS
 * module-privé, dus hij komt uit de bron: hier 0.4 overschrijven levert precies
 * de tweede kopie op die dit script hoort te voorkomen.
 */
function spelerR(): number {
	return getal(bron('player/Controls.ts'), /const RADIUS = (-?[\d.]+);/, 'Controls.RADIUS');
}

// ── 1. voorraad ────────────────────────────────────────────────────────────

/**
 * Canvasstub. Onbekende methodes geven de stub zelf terug, zodat ketens als
 * createLinearGradient().addColorStop() niet op undefined stuklopen.
 */
function stubDocument(): void {
	const ctx: Record<string | symbol, unknown> = {
		measureText: (tekst: string) => ({ width: tekst.length * 8 }),
	};
	let stub: unknown;
	stub = new Proxy(ctx, {
		get: (doel, sleutel) => (sleutel in doel ? doel[sleutel] : () => stub),
		set: (doel, sleutel, waarde) => {
			doel[sleutel] = waarde;
			return true;
		},
	});
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? { width: 1, height: 1, getContext: () => stub } : {}),
	};
}

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
	const [{ MallBuilder }, { StockDisplay }] = await Promise.all([import('@/scene/MallBuilder'), import('@/scene/StockDisplay')]);
	const verwacht = new Set(shopStores().map((s) => s.id));
	const mall = new MallBuilder();
	mall.build();
	vergelijkWinkels(new Set(mall.storeMeshes.keys()), verwacht, 'een winkelpod', 'winkelpod');
	vergelijkWinkels(new Set(new StockDisplay().registers.keys()), verwacht, 'winkelschappen', 'schappen');
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
 * Het gat in de vloerplaat komt uit MallBuilder, de helling eronder uit
 * Collision. Dat stond er als comment bij ("must match the addRectHole calls in
 * MallBuilder") en werd door niets afgedwongen.
 */
function controleVloergat(): void {
	const mb = bron('scene/MallBuilder.ts');
	eist(mb, 'addRectHole(ESC.x, ESC.holeCz, ESC.holeHalfW, ESC.holeHalfD);', 'het roltrapgat');
	eist(mb, 'addRectHole(STAIR.x, STAIR.holeCz, STAIR.holeHalfW, STAIR.holeHalfD);', 'het trapgat');

	for (const [obj, label] of [
		['ESC', 'escalator'],
		['STAIR', 'stairs'],
	] as const) {
		const ramp = wereld.ramps.find((r) => r.label === label);
		if (!ramp) {
			fout('vloergat', `geen ramp '${label}' in CollisionWorld, terwijl MallBuilder er een gat voor snijdt`);
			continue;
		}
		const x = veld(mb, obj, 'x');
		const midX = (ramp.minX + ramp.maxX) / 2;
		const halfX = (ramp.maxX - ramp.minX) / 2;
		if (!bijna(x, midX, 1e-3)) fout('vloergat', `${obj}.x ${nr(x)} ligt niet op het midden van ramp '${label}' (${nr(midX)})`);
		for (const [naam, waarde] of [
			['zBottom', ramp.zBottom],
			['zTop', ramp.zTop],
		] as const) {
			const bouw = veld(mb, obj, naam);
			if (!bijna(bouw, waarde, 1e-3)) fout('vloergat', `${obj}.${naam} ${nr(bouw)} wijkt af van ramp '${label}' (${nr(waarde)})`);
		}
		const cz = veld(mb, obj, 'holeCz');
		const halfD = veld(mb, obj, 'holeHalfD');
		const halfW = veld(mb, obj, 'holeHalfW');
		if (!bijna(cz - halfD, ramp.openMinZ, 1e-3) || !bijna(cz + halfD, ramp.openMaxZ, 1e-3)) {
			fout(
				'vloergat',
				`${obj} snijdt z ${nr(cz - halfD)}..${nr(cz + halfD)} maar ramp '${label}' rekent met ${nr(ramp.openMinZ)}..${nr(ramp.openMaxZ)}`,
			);
		}
		if (halfW + 1e-3 < halfX) {
			fout(
				'vloergat',
				`${obj}.holeHalfW ${nr(halfW)} is smaller dan de loopband van '${label}' (${nr(halfX)}): het vakwerk prikt door de plaat`,
			);
		}
		// Een trap heeft geen snelheid; heeft de bouwer er wel een, dan moet de
		// helling met dezelfde rekenen, anders glijden de treden onder je voeten door.
		const snelheid = losVeld(mb, obj, 'speed');
		if (snelheid !== undefined) {
			if (ramp.carrySpeed === undefined) {
				fout('vloergat', `${obj}.speed is ${nr(snelheid)} maar ramp '${label}' heeft geen carrySpeed: de treden lopen, jij niet`);
			} else if (!bijna(snelheid, ramp.carrySpeed)) {
				fout('vloergat', `${obj}.speed ${nr(snelheid)} wijkt af van carrySpeed van '${label}' (${nr(ramp.carrySpeed)})`);
			}
		}
	}

	// Het atriumgat: MallBuilder snijdt het, Collision laat je er doorheen vallen.
	const aw = getal(mb, /const aw = (-?[\d.]+);/, 'de breedte van het atriumgat');
	const ad = getal(mb, /const ad = (-?[\d.]+);/, 'de diepte van het atriumgat');
	eist(mb, 'addRectHole(0, 0, aw / 2, ad / 2);', 'het atriumgat');
	const binnen: [number, number][] = [
		[aw / 2 - 0.1, 0],
		[-(aw / 2 - 0.1), 0],
		[0, ad / 2 - 0.1],
		[0, -(ad / 2 - 0.1)],
	];
	for (const [x, z] of binnen) {
		const grond = wereld.groundHeightAt(x, z, V1, WALK_STEP);
		if (!bijna(grond, V0))
			fout('vloergat', `atriumgat (${nr(x)}, ${nr(z)}): op V1 ligt er vloer op ${nr(grond)} terwijl daar een gat gesneden is`);
	}
	const buiten: [number, number][] = [
		[aw / 2 + 0.5, 0],
		[-(aw / 2 + 0.5), 0],
		[0, ad / 2 + 0.5],
		[0, -(ad / 2 + 0.5)],
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
		const banen = [r.minX + 0.1, (r.minX + r.maxX) / 2, r.maxX - 0.1];
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
				const plat = wereld.platforms.find((p) => dekt(p, x, z) && bijna(p.y, grond, 1e-4));
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

// ── 5. glijbaanladder ──────────────────────────────────────────────────────

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
	const x = (r.minX + r.maxX) / 2;
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
	const mb = bron('scene/MallBuilder.ts');
	const halfW = getal(mb, /const aw = (-?[\d.]+);/, 'de breedte van het atriumgat') / 2;
	const halfD = getal(mb, /const ad = (-?[\d.]+);/, 'de diepte van het atriumgat') / 2;
	const straal = spelerR();
	const stap = 0.4;
	let gaten = 0;
	let duwen = 0;
	let vast = 0;
	for (let x = -halfW + 0.05; x <= halfW; x += stap) {
		for (let z = -halfD + 0.05; z <= halfD; z += stap) {
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
			if (Math.abs(opV1.x) < halfW && Math.abs(opV1.z) < halfD) {
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
	const { PoolPeople } = await import('@/scene/PoolPeople');
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
	const straal = spelerR();
	for (const p of wereld.platforms) {
		for (let x = p.minX + 0.05; x <= p.maxX; x += 0.25) {
			for (let z = p.minZ + 0.05; z <= p.maxZ; z += 0.25) {
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
		if (!SHOP_LEVELS.some((l) => l === s.level)) fout('winkeldata', `${s.id} staat op dek ${s.level}, geen winkeldek`);
	}
	for (const s of shopStores()) {
		if (!getInventory(s.id)) fout('winkeldata', `winkel ${s.id} heeft geen inventaris, dus lege schappen`);
	}
}

// ── uitvoeren ──────────────────────────────────────────────────────────────

const controles: { naam: string; draai: () => void | Promise<void> }[] = [
	{ naam: 'voorraad', draai: controleVoorraad },
	{ naam: 'hellingen', draai: controleHellingen },
	{ naam: 'vloergat', draai: controleVloergat },
	{ naam: 'hellinglijn', draai: controleHellinglijn },
	{ naam: 'ladder', draai: controleLadder },
	{ naam: 'glazendak', draai: controleGlazenDak },
	{ naam: 'zwembad', draai: controleZwembad },
	{ naam: 'badgasten', draai: controleBadgasten },
	{ naam: 'platforms', draai: controlePlatforms },
	{ naam: 'winkeldata', draai: controleWinkeldata },
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
