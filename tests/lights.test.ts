import { beforeAll, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { Object3D, PointLight, Scene, SpotLight } from 'three';
import { MALL_SLAB_SPECS } from '#/data/world';
import { CollisionWorld } from '#/physics/Collision';
import { LIGHT_POOL_SLOTS, type LightPool } from '#/render/LightPool';
import { stubAudio, stubDocument } from './helpers/stub-dom.ts';

/**
 * The number of real point lights in the mall is fixed.
 *
 * three.js pastes `NUM_POINT_LIGHTS` into every shader and that number is part of the
 * program cache key. While features built their own `THREE.PointLight` and switched
 * groups on and off (disco, alien probe) the mall relinked all its materials mid frame,
 * and a cold start linked 105 programs. Since `LightPool` the count is fixed for the
 * whole session and the ~85 virtual lights take turns renting a slot.
 *
 * No browser needed: every light-owning builder runs bare with the canvas and audio
 * stubs from stub-dom.
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

/** Every real point light currently hanging in the scene graph. */
function pointLights(sceneRoot: Scene): PointLight[] {
	const gevonden: PointLight[] = [];
	sceneRoot.traverse((o) => {
		if (o instanceof PointLightClass) gevonden.push(o);
	});
	return gevonden;
}

function spots(sceneRoot: Scene): SpotLight[] {
	const gevonden: SpotLight[] = [];
	sceneRoot.traverse((o) => {
		if (o instanceof SpotLightClass) gevonden.push(o);
	});
	return gevonden;
}

let scene: Scene;
let pool: LightPool;
let disco: { setActive: (on: boolean) => void };
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

describe('the number of real point lights is fixed', () => {
	test(`the scene holds exactly ${LIGHT_POOL_SLOTS}`, () => {
		expect(pointLights(scene), 'is a feature building one of its own again?').toHaveLength(LIGHT_POOL_SLOTS);
	});

	// The pool hangs its lights straight under the scene; anything a feature builds sits
	// inside that feature's group.
	test('they all hang in the pool and not in a feature', () => {
		const elsewhere = pointLights(scene)
			.filter((lamp) => lamp.parent !== scene)
			.map((lamp) => `${lamp.name || '(unnamed)'} under ${lamp.parent?.name || 'something'}`);
		expect(elsewhere, elsewhere.join(' · ')).toBeEmpty();
	});

	// The renderer does not count an invisible light, so hiding one changes
	// NUM_POINT_LIGHTS after all and relinks the whole mall.
	test('no pool light sits at visible=false', () => {
		const invisible = pointLights(scene)
			.filter((lamp) => !lamp.visible)
			.map((lamp) => lamp.name);
		expect(invisible, invisible.join(' · ')).toBeEmpty();
	});

	test('no pool light casts a shadow', () => {
		const casting = pointLights(scene)
			.filter((lamp) => lamp.castShadow)
			.map((lamp) => lamp.name);
		expect(casting, `${casting.join(' · ')} — that is a cubemap pass per frame`).toBeEmpty();
	});
});

/**
 * The two features that used to change the count. The disco switched thirteen lights on
 * and dimmed the rest through scene.traverse; the probe made one appear on a 40-90 s
 * timer. Both may only animate handles now.
 */
describe('switching does not change the count', () => {
	const states: { name: string; set: () => void }[] = [
		{
			name: 'at rest',
			set: () => {
				// Baseline state needs no transition.
			},
		},
		{ name: 'disco on', set: () => disco.setActive(true) },
		{
			name: 'disco on + probe visible',
			set: () => {
				disco.setActive(true);
				probe.group.visible = true;
			},
		},
		{
			name: 'disco off',
			set: () => {
				disco.setActive(false);
				probe.group.visible = true;
			},
		},
		{
			name: 'probe gone',
			set: () => {
				disco.setActive(false);
				probe.group.visible = false;
			},
		},
	];

	test.each(states)('$name', (state) => {
		state.set();
		pool.update(new PerspectiveCamera());
		expect(pointLights(scene)).toHaveLength(LIGHT_POOL_SLOTS);
	});
});

/**
 * `NUM_SPOT_LIGHTS` sits in the program cache key just like the point light count. The
 * height requirement comes from the fashion show: the spot hung at 7.4, above the V1
 * floor plane, and because it casts no shadow its cone painted a bright pool on the deck
 * upstairs. An indoor lamp with 26 m of throw reaches that deck somewhere.
 */
describe('the spot', () => {
	test('there is exactly one', () => {
		expect(spots(scene), 'more than one changes NUM_SPOT_LIGHTS and relinks the mall').toHaveLength(1);
	});

	test('it hangs below the underside of the V1 slab', () => {
		const spot = spots(scene)[0];
		expect(spot).toBeDefined();
		if (!spot) return;
		scene.updateMatrixWorld(true);
		const undersideV1 = MALL_SLAB_SPECS.v1.topY - MALL_SLAB_SPECS.v1.thickness;
		expect(
			spot.getWorldPosition(new Vector3()).y,
			`without shadows it lights the floor of the deck above (slab at ${undersideV1})`,
		).toBeLessThan(undersideV1);
	});
});

/**
 * The counts above only see what these tests happen to build. A new feature with a light
 * of its own would not be in there, so the source itself is read: `new THREE.PointLight`
 * belongs in LightPool alone.
 */
const OWNER = 'src/render/LightPool.ts';
const SPOT_OWNER = 'src/scene/Catwalk.ts';
// Ook `new PointLight` na een named import telt: precies die vorm glipte eerder langs een letterlijke `new THREE.PointLight`-greep heen.
const BUILDS = /\bnew\s+(?:\w+\s*\.\s*)?PointLight\b/g;
const IMPORTS = /import\s*(?:type\s*)?\{[^}]*\bPointLight\b[^}]*\}\s*from\s*['"]three['"]/;
const SPOT_BUILDS = /\bnew\s+(?:\w+\s*\.\s*)?SpotLight\b/g;
const SPOT_IMPORTS = /import\s*(?:type\s*)?\{[^}]*\bSpotLight\b[^}]*\}\s*from\s*['"]three['"]/;

async function sources(): Promise<{ path: string; text: string }[]> {
	const src = resolve(import.meta.dir, '..', 'src');
	const out: { path: string; text: string }[] = [];
	for await (const name of new Bun.Glob('**/*.ts').scan({ cwd: src })) {
		out.push({ path: `src/${name}`, text: await Bun.file(join(src, name)).text() });
	}
	return out;
}

const SOURCES = await sources();

describe('the source builds a point light nowhere else', () => {
	test('only the pool builds one', () => {
		const builders = SOURCES.filter(({ path, text }) => path !== OWNER && (text.match(BUILDS)?.length ?? 0) > 0).map(
			({ path }) => path,
		);
		expect(builders, `${builders.join(' · ')} — register it with the LightPool`).toBeEmpty();
	});

	test('only the pool imports PointLight from three', () => {
		const importers = SOURCES.filter(({ path, text }) => path !== OWNER && IMPORTS.test(text)).map(({ path }) => path);
		expect(importers, importers.join(' · ')).toBeEmpty();
	});

	test('the pool still builds one itself', () => {
		const owner = SOURCES.find(({ path }) => path === OWNER);
		expect(owner, `${OWNER} no longer exists`).toBeDefined();
		expect(owner?.text.match(BUILDS)?.length ?? 0, 'was the pool renamed or rewritten?').toBeGreaterThan(0);
	});
});

describe('the source builds the one spot nowhere else', () => {
	test('only Catwalk builds one', () => {
		const builders = SOURCES.filter(({ path, text }) => path !== SPOT_OWNER && (text.match(SPOT_BUILDS)?.length ?? 0) > 0).map(
			({ path }) => path,
		);
		expect(builders, `${builders.join(' · ')} changes NUM_SPOT_LIGHTS`).toBeEmpty();
	});

	test('only Catwalk imports SpotLight from three', () => {
		const importers = SOURCES.filter(({ path, text }) => path !== SPOT_OWNER && SPOT_IMPORTS.test(text)).map(({ path }) => path);
		expect(importers, importers.join(' · ')).toBeEmpty();
	});

	test('Catwalk still builds exactly one', () => {
		const owner = SOURCES.find(({ path }) => path === SPOT_OWNER);
		expect(owner, `${SPOT_OWNER} no longer exists`).toBeDefined();
		expect(owner?.text.match(SPOT_BUILDS)?.length ?? 0, 'the spot owner no longer builds exactly one').toBe(1);
	});
});
