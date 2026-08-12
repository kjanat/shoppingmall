import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'bun:test';
import type { Object3D, PointLight, Scene, SpotLight } from 'three';
import { MALL_SLAB_SPECS } from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { LIGHT_POOL_SLOTS, type LightPool } from '#/render/LightPool';
import { stubAudio, stubDocument } from '$/scripts/stub-dom.ts';

/**
 * Het aantal echte puntlichten in de mall ligt vast.
 *
 * three.js plakt `NUM_POINT_LIGHTS` in elke shader en dat getal zit in de
 * programmacachesleutel. Zolang features hun eigen `THREE.PointLight` bouwden en
 * groepen aan- en uitzetten (disco, alienprobe) relinkte de mall middenin een frame
 * al zijn materialen, en linkte een koude start 105 programma's. Sinds `LightPool`
 * ligt het aantal vast voor de hele sessie en huren de ~85 virtuele lampen daar om
 * de beurt een slot.
 *
 * Geen browser nodig: alle lichtbezittende bouwers draaien kaal met de canvas- en
 * audiostub uit stub-dom.
 */

stubDocument();
stubAudio();

const {
	PerspectiveCamera,
	PointLight: PointLightClass,
	Scene: SceneClass,
	SpotLight: SpotLightClass,
	Vector3,
} = await import('three');
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
	{ LightPool: LightPoolClass },
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
	import('#/render/LightPool'),
]);

/** Elk echt puntlicht dat op dit moment in de scenegraaf hangt. */
function puntlichten(scene: Scene): PointLight[] {
	const gevonden: PointLight[] = [];
	scene.traverse((o) => {
		if (o instanceof PointLightClass) gevonden.push(o);
	});
	return gevonden;
}

function spots(scene: Scene): SpotLight[] {
	const gevonden: SpotLight[] = [];
	scene.traverse((o) => {
		if (o instanceof SpotLightClass) gevonden.push(o);
	});
	return gevonden;
}

let scene: Scene;
let pool: LightPool;
let disco: { setActive(on: boolean): void };
let probe: { group: Object3D };

/**
 * Alles wat licht maakt, gebouwd tegen één pool op één kale scene. De hele App boot
 * hier niet: die wil een canvas, een WebGL-context en een renderer.
 */
beforeAll(() => {
	scene = new SceneClass();
	pool = new LightPoolClass(scene);
	const world = new CollisionWorld();
	const daylight = setupLighting(scene, pool);
	const party = new DiscoParty(pool, daylight);
	party.bindScene(scene);
	disco = party;
	const alien = new AlienProbe(pool);
	probe = alien;

	for (const feature of [
		party,
		alien,
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
});

describe('het aantal echte puntlichten ligt vast', () => {
	test(`de scene houdt er precies ${LIGHT_POOL_SLOTS}`, () => {
		expect(puntlichten(scene), 'bouwt een feature er weer zelf een?').toHaveLength(LIGHT_POOL_SLOTS);
	});

	// De pool hangt zijn lampen recht onder de scene; alles wat een feature zou bouwen zit in de groep van die feature.
	test('ze hangen allemaal in de pool en niet in een feature', () => {
		const elders = puntlichten(scene)
			.filter((lamp) => lamp.parent !== scene)
			.map((lamp) => `${lamp.name || '(naamloos)'} onder ${lamp.parent?.name || 'iets'}`);
		expect(elders, elders.join(' · ')).toBeEmpty();
	});

	// Een onzichtbaar licht telt de renderer niet mee: dan verandert NUM_POINT_LIGHTS alsnog en relinkt de hele mall.
	test('geen enkele poollamp staat op visible=false', () => {
		const onzichtbaar = puntlichten(scene)
			.filter((lamp) => !lamp.visible)
			.map((lamp) => lamp.name);
		expect(onzichtbaar, onzichtbaar.join(' · ')).toBeEmpty();
	});

	test('geen enkele poollamp werpt schaduw', () => {
		const werpen = puntlichten(scene)
			.filter((lamp) => lamp.castShadow)
			.map((lamp) => lamp.name);
		expect(werpen, `${werpen.join(' · ')} — dat is een cubemap-pass per frame`).toBeEmpty();
	});
});

/**
 * De twee features die het aantal vroeger wél veranderden. De disco zette dertien
 * lampen aan en dimde de rest via scene.traverse; de probe liet er één verschijnen op
 * een timer van 40-90 s. Allebei mogen ze nu alleen nog handles animeren.
 */
describe('schakelen verandert het aantal niet', () => {
	const standen: { naam: string; zet: () => void }[] = [
		{ naam: 'in rust', zet: () => {} },
		{ naam: 'disco aan', zet: () => disco.setActive(true) },
		{
			naam: 'disco aan + probe zichtbaar',
			zet: () => {
				disco.setActive(true);
				probe.group.visible = true;
			},
		},
		{
			naam: 'disco uit',
			zet: () => {
				disco.setActive(false);
				probe.group.visible = true;
			},
		},
		{
			naam: 'probe weg',
			zet: () => {
				disco.setActive(false);
				probe.group.visible = false;
			},
		},
	];

	test.each(standen)('$naam', (stand) => {
		stand.zet();
		pool.update(new PerspectiveCamera());
		expect(puntlichten(scene)).toHaveLength(LIGHT_POOL_SLOTS);
	});
});

/**
 * `NUM_SPOT_LIGHTS` zit net als het puntlichtaantal in de programmacachesleutel. De
 * hoogte-eis komt van de modeshow: de spot hing op 7.4, boven het V1-vloervlak, en
 * omdat hij geen schaduw werpt tekende zijn kegel een lichtvlek óp de vloer van de
 * verdieping erboven. Een binnenlamp met 26 m worp haalt ergens altijd dat dek.
 */
describe('de spot', () => {
	test('er is er precies één', () => {
		expect(spots(scene), 'meer dan één verandert NUM_SPOT_LIGHTS en relinkt de mall').toHaveLength(1);
	});

	test('hij hangt onder de onderkant van het V1-dek', () => {
		const spot = spots(scene)[0];
		expect(spot).toBeDefined();
		if (!spot) return;
		scene.updateMatrixWorld(true);
		const onderkantV1 = MALL_SLAB_SPECS.v1.topY - MALL_SLAB_SPECS.v1.thickness;
		expect(
			spot.getWorldPosition(new Vector3()).y,
			`zonder schaduwen licht hij anders de vloer van de verdieping erboven aan (dek op ${onderkantV1})`,
		).toBeLessThan(onderkantV1);
	});
});

/**
 * De tellingen hierboven zien alleen wat deze tests toevallig bouwen. Een nieuwe
 * feature met een eigen lamp zou er niet in zitten, dus wordt hier de bron gelezen:
 * `new THREE.PointLight` hoort alleen in LightPool te staan.
 */
const EIGENAAR = 'src/render/LightPool.ts';
// Ook `new PointLight` na een named import telt: precies die vorm glipte eerder langs een letterlijke `new THREE.PointLight`-greep heen.
const BOUWT = /\bnew\s+(?:\w+\s*\.\s*)?PointLight\b/g;
const IMPORTEERT = /import\s*(?:type\s*)?\{[^}]*\bPointLight\b[^}]*\}\s*from\s*['"]three['"]/;

async function bronnen(): Promise<{ pad: string; tekst: string }[]> {
	const src = resolve(import.meta.dir, '..', 'src');
	const uit: { pad: string; tekst: string }[] = [];
	for await (const naam of new Bun.Glob('**/*.ts').scan({ cwd: src })) {
		uit.push({ pad: `src/${naam}`, tekst: await Bun.file(join(src, naam)).text() });
	}
	return uit;
}

const BRONNEN = await bronnen();

describe('de bron bouwt nergens anders een puntlicht', () => {
	test('alleen de pool bouwt er een', () => {
		const bouwers = BRONNEN.filter(({ pad, tekst }) => pad !== EIGENAAR && (tekst.match(BOUWT)?.length ?? 0) > 0).map(
			({ pad }) => pad,
		);
		expect(bouwers, `${bouwers.join(' · ')} — registreer hem bij de LightPool`).toBeEmpty();
	});

	test('alleen de pool importeert PointLight uit three', () => {
		const importeurs = BRONNEN.filter(({ pad, tekst }) => pad !== EIGENAAR && IMPORTEERT.test(tekst)).map(({ pad }) => pad);
		expect(importeurs, importeurs.join(' · ')).toBeEmpty();
	});

	test('de pool bouwt er zelf nog wel een', () => {
		const eigenaar = BRONNEN.find(({ pad }) => pad === EIGENAAR);
		expect(eigenaar, `${EIGENAAR} bestaat niet meer`).toBeDefined();
		expect(eigenaar?.tekst.match(BOUWT)?.length ?? 0, 'is de pool hernoemd of herschreven?').toBeGreaterThan(0);
	});
});
