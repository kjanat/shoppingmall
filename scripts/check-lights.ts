#!/usr/bin/env bun
/**
 * Lichtcontrole: het aantal echte puntlichten in de mall ligt vast.
 *
 * three.js plakt `NUM_POINT_LIGHTS` in elke shader en dat getal zit in de
 * programmacachesleutel. Zolang features hun eigen `THREE.PointLight` bouwden en
 * groepen aan- en uitzetten (disco, alienprobe) relinkte de mall middenin een
 * frame al zijn materialen, en linkte een koude start 105 programma's. Sinds
 * `LightPool` ligt het aantal vast voor de hele sessie (LIGHT_POOL_SLOTS) en
 * huren de ~85 virtuele lampen daar om de beurt een slot.
 *
 * Dat is precies het soort afspraak dat in een comment niet standhoudt: één
 * `new THREE.PointLight` ergens in een nieuwe feature en de hele winst is weg,
 * zonder dat iets stukgaat dat je ziet. Vandaar dit script, en vandaar dat het
 * aan `check` hangt.
 *
 * Geen browser nodig. Alle lichtbezittende bouwers draaien kaal in Bun met de
 * canvas- en audiostub uit stub-dom.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MALL_SLAB_SPECS } from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { LIGHT_POOL_SLOTS, LightPool } from '#/render/LightPool';
import { stubAudio, stubDocument } from './stub-dom.ts';

const fouten: string[] = [];

function fout(controle: string, melding: string): void {
	fouten.push(`${controle}: ${melding}`);
}

/** Elk echt puntlicht dat op dit moment in de scenegraaf hangt. */
function puntlichten(scene: THREE.Scene): THREE.PointLight[] {
	const gevonden: THREE.PointLight[] = [];
	scene.traverse((o) => {
		if (o instanceof THREE.PointLight) gevonden.push(o);
	});
	return gevonden;
}

// ── de wereld één keer opbouwen ────────────────────────────────────────────

/**
 * Alles wat licht maakt, gebouwd tegen één pool op één kale scene.
 *
 * De hele App booten lukt hier niet, want die wil een canvas, een WebGL-context
 * en een renderer. Dit doet daarom wat check-world met de winkelbouwers doet: de
 * features zelf bouwen, zoals App ze bouwt, en op het resultaat toetsen.
 */
async function bouwWereld(): Promise<{
	scene: THREE.Scene;
	pool: LightPool;
	disco: { bindScene(s: THREE.Scene): void; setActive(on: boolean): void };
	probe: { group: THREE.Object3D };
}> {
	stubDocument();
	stubAudio();
	const scene = new THREE.Scene();
	const pool = new LightPool(scene);
	const world = new CollisionWorld();

	const [
		{ Catwalk },
		{ setupLighting },
		{ DiscoParty },
		{ AlienProbe },
		{ StockDisplay },
		{ SecurityGuards },
		{ GlassElevator },
		{ ParkingGarage },
		{ FoodCourt },
		{ BeardCave },
		{ DJBartek },
		{ PrayerRoom },
		{ Helipad },
		{ Spaceship },
		{ TravelAgency },
		{ ScrubberBuggy },
		{ Restrooms },
		{ Entrance },
		{ Barriers },
	] = await Promise.all([
		import('#/scene/Catwalk'),
		import('#/scene/Lighting'),
		import('#/scene/Disco'),
		import('#/scene/AlienProbe'),
		import('#/scene/StockDisplay'),
		import('#/scene/SecurityGuards'),
		import('#/scene/GlassElevator'),
		import('#/scene/ParkingGarage'),
		import('#/scene/FoodCourt'),
		import('#/scene/BeardCave'),
		import('#/scene/DJBartek'),
		import('#/scene/PrayerRoom'),
		import('#/scene/Helipad'),
		import('#/scene/Spaceship'),
		import('#/scene/TravelAgency'),
		import('#/scene/ScrubberBuggy'),
		import('#/scene/Restrooms'),
		import('#/scene/Entrance'),
		import('#/scene/city/Barriers'),
	]);

	const daylight = setupLighting(scene, pool);
	const disco = new DiscoParty(pool, daylight);
	disco.bindScene(scene);
	const probe = new AlienProbe(pool);

	for (const feature of [
		disco,
		probe,
		new Catwalk(),
		new StockDisplay(pool),
		new SecurityGuards(world, pool),
		new GlassElevator(pool),
		new ParkingGarage(pool),
		new FoodCourt(pool),
		new BeardCave(pool),
		new DJBartek(pool),
		new PrayerRoom(pool),
		new Helipad(pool, world),
		new Spaceship(pool),
		new TravelAgency(pool),
		new ScrubberBuggy(world, pool, new Barriers(world)),
		new Restrooms(pool),
		new Entrance(pool),
	]) {
		scene.add(feature.group);
	}

	return { scene, pool, disco, probe };
}

// ── 1. het aantal ──────────────────────────────────────────────────────────

/**
 * Precies LIGHT_POOL_SLOTS, en allemaal van de pool. Dat getal wordt
 * geïmporteerd en niet overgeschreven: een tweede kopie van dat getal is precies wat check-world
 * elders al probeert te voorkomen.
 */
function controleAantal(scene: THREE.Scene): void {
	const lampen = puntlichten(scene);
	if (lampen.length !== LIGHT_POOL_SLOTS) {
		fout(
			'aantal',
			`${lampen.length} echte puntlichten in de scene in plaats van ${LIGHT_POOL_SLOTS}. Bouwt een feature er weer zelf een?`,
		);
	}
	// De pool hangt zijn lampen recht onder de scene; alles wat een feature zou
	// bouwen zit in de groep van die feature.
	for (const l of lampen) {
		if (l.parent !== scene) {
			fout('aantal', `puntlicht '${l.name || '(naamloos)'}' hangt onder ${l.parent?.name || 'iets'} en dus niet in de pool`);
		}
		if (!l.visible) {
			// Een onzichtbaar licht telt de renderer niet mee: dan verandert
			// NUM_POINT_LIGHTS alsnog en relinkt de hele mall.
			fout('aantal', `poollamp '${l.name}' staat op visible=false, en dat verandert NUM_POINT_LIGHTS`);
		}
		if (l.castShadow) fout('aantal', `poollamp '${l.name}' werpt schaduw: dat is een cubemap-pass per frame`);
	}
}

// ── 2. schakelen ───────────────────────────────────────────────────────────

/**
 * De twee features die het aantal vroeger wél veranderden. De disco zette
 * dertien lampen aan en dimde de rest via scene.traverse; de probe liet er één
 * verschijnen op een timer van 40-90 s, midden in een sessie die net rustig was.
 * Allebei mogen ze nu alleen nog handles animeren.
 */
function controleSchakelen(
	scene: THREE.Scene,
	pool: LightPool,
	disco: { setActive(on: boolean): void },
	probe: { group: THREE.Object3D },
): void {
	const camera = new THREE.PerspectiveCamera();
	const meet = (wat: string): void => {
		pool.update(camera);
		const n = puntlichten(scene).length;
		if (n !== LIGHT_POOL_SLOTS) fout('schakelen', `${wat}: ${n} echte puntlichten in plaats van ${LIGHT_POOL_SLOTS}`);
	};

	meet('in rust');
	disco.setActive(true);
	meet('disco aan');
	probe.group.visible = true;
	meet('disco aan + probe zichtbaar');
	disco.setActive(false);
	meet('disco uit');
	probe.group.visible = false;
	meet('probe weg');
}

// ── 3. de spot ─────────────────────────────────────────────────────────────

/**
 * Precies één SpotLight, en die hangt onder de onderkant van het V1-dek.
 *
 * `NUM_SPOT_LIGHTS` zit net als het puntlichtaantal in de programmacachesleutel,
 * en tot nu toe dwong niets af dat het er één blijft. De hoogte-eis komt van de
 * modeshow: de spot hing op 7.4, boven het V1-vloervlak, en omdat hij geen
 * schaduw werpt tekende zijn kegel een lichtvlek óp de vloer van de verdieping
 * erboven. Een binnenlamp met 26 m worp haalt ergens altijd dat dek, dus de
 * bron zelf moet eronder blijven.
 */
function controleSpot(scene: THREE.Scene): void {
	const spots: THREE.SpotLight[] = [];
	scene.traverse((o) => {
		if (o instanceof THREE.SpotLight) spots.push(o);
	});
	if (spots.length !== 1) {
		fout('spot', `${spots.length} SpotLights in de scene in plaats van 1: dat verandert NUM_SPOT_LIGHTS en relinkt de mall`);
		return;
	}
	const spot = spots[0];
	if (!spot) return;
	scene.updateMatrixWorld(true);
	const bronY = spot.getWorldPosition(new THREE.Vector3()).y;
	const onderkantV1 = MALL_SLAB_SPECS.v1.topY - MALL_SLAB_SPECS.v1.thickness;
	if (bronY >= onderkantV1) {
		fout(
			'spot',
			`de spot hangt op y ${bronY.toFixed(2)}, op of boven de onderkant van het V1-dek (${onderkantV1.toFixed(2)}): zonder schaduwen licht hij de vloer van de verdieping erboven aan`,
		);
	}
}

// ── 4. de bron ─────────────────────────────────────────────────────────────

/** Elk .ts-bestand onder src/, als pad relatief aan src/. */
function bronBestanden(map = ''): string[] {
	const wortel = new URL(`../src/${map}`, import.meta.url);
	const uit: string[] = [];
	for (const item of readdirSync(wortel, { withFileTypes: true })) {
		const pad = map ? `${map}/${item.name}` : item.name;
		if (item.isDirectory()) uit.push(...bronBestanden(pad));
		else if (item.name.endsWith('.ts')) uit.push(pad);
	}
	return uit;
}

/**
 * En dan de regel zelf, want de telling hierboven ziet alleen wat deze controle
 * toevallig bouwt. Een nieuwe feature met een eigen lamp zou er niet in zitten,
 * dus wordt hier de bron gelezen: `new THREE.PointLight` hoort alleen in
 * LightPool te staan.
 */
function controleBron(): void {
	const eigenaar = 'render/LightPool.ts';
	let gezien = 0;
	for (const pad of bronBestanden()) {
		const tekst = readFileSync(new URL(`../src/${pad}`, import.meta.url), 'utf8');
		// Ook `new PointLight` na een named import telt: precies die vorm glipte
		// eerder langs een letterlijke `new THREE.PointLight`-greep heen.
		const treffers = tekst.match(/\bnew\s+(?:\w+\s*\.\s*)?PointLight\b/g)?.length ?? 0;
		const importeert = /import\s*(?:type\s*)?\{[^}]*\bPointLight\b[^}]*\}\s*from\s*['"]three['"]/.test(tekst);
		if (treffers === 0 && !importeert) continue;
		if (pad === eigenaar) gezien = treffers;
		else if (treffers > 0) {
			fout('bron', `src/${pad} bouwt ${treffers}× een eigen PointLight. Registreer hem bij de LightPool`);
		} else {
			fout('bron', `src/${pad} importeert PointLight uit three. Alleen de LightPool hoort dat te doen`);
		}
	}
	if (gezien === 0) {
		fout('bron', `src/${eigenaar} bouwt geen enkele PointLight meer. Is de pool hernoemd of herschreven?`);
	}
}

// ── uitvoeren ──────────────────────────────────────────────────────────────

const controles: { naam: string; draai: () => void | Promise<void> }[] = [];

try {
	const { scene, pool, disco, probe } = await bouwWereld();
	controles.push(
		{ naam: 'aantal', draai: () => controleAantal(scene) },
		{ naam: 'schakelen', draai: () => controleSchakelen(scene, pool, disco, probe) },
		{ naam: 'spot', draai: () => controleSpot(scene) },
		{ naam: 'bron', draai: controleBron },
	);
} catch (e) {
	fout('opbouw', `de lichtbouwers draaiden niet: ${e instanceof Error ? e.message : String(e)}`);
}

for (const c of controles) {
	try {
		await c.draai();
	} catch (e) {
		fout(c.naam, `controle kon niet draaien: ${e instanceof Error ? e.message : String(e)}`);
	}
}

if (fouten.length === 0) {
	console.log(`check-lights: ${controles.length} controles geslaagd, ${LIGHT_POOL_SLOTS} echte puntlichten`);
} else {
	console.error(`check-lights: ${fouten.length} ${fouten.length === 1 ? 'probleem' : 'problemen'} met het licht\n`);
	for (const f of fouten) console.error(`  ✗ ${f}`);
	console.error('');
	process.exitCode = 1;
}
