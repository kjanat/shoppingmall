#!/usr/bin/env bun
/**
 * Scene-props tegen het wereldmodel: niets wat een bouwer los neerzet mag in
 * een volume staan dat lichamen tegenhoudt.
 *
 * De AL ZUT-man stond tot zijn middel in de tiki-bar-counter en geen regel zag
 * het, want validateSpatialWorld werkt op WORLD_ENTITIES en de cast is scene-
 * geplaatst. De parasol had hetzelfde eerder gedaan met het bord, met de hand
 * verschoven, comment erbij. Dit is de generieke vorm: elke statisch geplaatste
 * figuur van de bouwers hieronder, tegen elk blocksMovement-volume van zijn dek.
 */
import type { LevelId } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { ENTRANCE_MOTORCYCLE_SPOTS, PARKED_MOTORCYCLE_SPOTS, WORLD_ENTITIES } from '#/data/world';
import { stubDocument } from './stub-dom.ts';

type Doos = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; wie: string };

const fouten: string[] = [];

function nr(v: number): string {
	return Number(v.toFixed(3)).toString();
}

function dozenOp(level: LevelId): Doos[] {
	return WORLD_ENTITIES.filter((entity) => entity.levels.includes(level)).flatMap((entity) =>
		entity.volumes
			.filter((volume) => volume.blocksMovement)
			.map((volume) => ({ ...geometryBounds(volume.geometry), wie: `${entity.id}.${volume.id}` })),
	);
}

stubDocument();
const [THREE, { LightPool }, { PoolPeople }, { TravelAgency }, { DJBartek }, { Motorcycles }, { CityTheatre }] =
	await Promise.all([
		import('three'),
		import('#/render/LightPool'),
		import('#/scene/PoolPeople'),
		import('#/scene/TravelAgency'),
		import('#/scene/DJBartek'),
		import('#/scene/Motorcycles'),
		import('#/scene/city/CityTheatre'),
	]);

const pool = new LightPool(new THREE.Scene());

/**
 * Wereldposities van de direct geplaatste kinderen. De groep zelf staat vaak op
 * een offset (BeardCave op zijn ingang), dus lokaal vergelijken plaatst alles
 * op de oorsprong en vindt niets.
 */
function wereldposities(group: { updateMatrixWorld: (force: boolean) => void; children: readonly unknown[] }): {
	x: number;
	y: number;
	z: number;
}[] {
	group.updateMatrixWorld(true);
	const uit: { x: number; y: number; z: number }[] = [];
	for (const kind of group.children) {
		if (!(kind instanceof THREE.Object3D)) continue;
		const p = new THREE.Vector3();
		kind.getWorldPosition(p);
		uit.push({ x: p.x, y: p.y, z: p.z });
	}
	return uit;
}

/**
 * In je eigen kamer staan is containment en geen fout: de reisbureau-agent
 * hoort binnen shop-island_hop. Fout is een vréémd volume, zoals de crew-man
 * in de tiki-bar-counter. Elke bouwer somt daarom op welke entiteiten van hem
 * zijn; alles daarbuiten telt.
 */
const casts: { naam: string; level: LevelId; eigen: readonly string[]; group: InstanceType<typeof THREE.Group> }[] = [
	{ naam: 'PoolPeople', level: 'roof', eigen: [], group: new PoolPeople().group },
	{ naam: 'TravelAgency', level: 'v0', eigen: ['shop-island_hop'], group: new TravelAgency(pool).group },
	{ naam: 'DJBartek', level: 'v0', eigen: [], group: new DJBartek(pool).group },
	// De motoren staan tussen kolommen en in de hal van de hoofdingang: allebei plekken
	// waar een vaste plaatsing net zo goed een meter mis kan zitten als de crew-man dat
	// deed. De volumes die ze zelf in het model hebben tellen niet als vreemd.
	{ naam: 'Motorcycles P1', level: 'p1', eigen: ['parking-motorcycles'], group: new Motorcycles(PARKED_MOTORCYCLE_SPOTS).group },
	{
		naam: 'Motorcycles entree',
		level: 'v0',
		eigen: ['entrance-motorcycles'],
		group: new Motorcycles(ENTRANCE_MOTORCYCLE_SPOTS).group,
	},
	// Het theaterpubliek zit op stoelen die het wereldmodel uitdeelt, dus in zijn eigen
	// stoel zitten is containment. Elke andere doos in de zaal telt wel: de foyerwand,
	// de kassa en het doek staan er allemaal binnen handbereik.
	{ naam: 'Theaterpubliek', level: 'v0', eigen: ['theatre-seating'], group: new CityTheatre(pool).audience },
];

for (const cast of casts) {
	const dozen = dozenOp(cast.level).filter((doos) => !cast.eigen.some((id) => doos.wie.startsWith(`${id}.`)));
	for (const p of wereldposities(cast.group)) {
		for (const doos of dozen) {
			if (p.x <= doos.minX || p.x >= doos.maxX || p.z <= doos.minZ || p.z >= doos.maxZ) continue;
			if (p.y < doos.minY || p.y > doos.maxY) continue;
			fouten.push(`${cast.naam}: prop op (${nr(p.x)}, ${nr(p.y)}, ${nr(p.z)}) staat in ${doos.wie}`);
		}
	}
}

if (fouten.length === 0) {
	console.log('check-props: alle scene-props staan vrij van blocksMovement-volumes');
} else {
	console.error(`check-props: ${fouten.length} ${fouten.length === 1 ? 'prop staat' : 'props staan'} in een volume\n`);
	for (const f of fouten) console.error(`  ✗ ${f}`);
	console.error('');
	process.exitCode = 1;
}
