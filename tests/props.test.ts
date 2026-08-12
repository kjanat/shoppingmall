import { beforeAll, describe, expect, test } from 'bun:test';
import type { Object3D } from 'three';
import type { LevelId } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { PARKED_MOTORCYCLE_SPOTS, WORLD_ENTITIES } from '#/data/world';
import { stubDocument } from '$/scripts/stub-dom.ts';

/**
 * Scene-props tegen het wereldmodel: niets wat een bouwer los neerzet mag in een
 * volume staan dat lichamen tegenhoudt.
 *
 * De AL ZUT-man stond tot zijn middel in de tiki-bar-counter en geen regel zag het,
 * want validateSpatialWorld werkt op WORLD_ENTITIES en de cast is scene-geplaatst.
 * In je eigen kamer staan is containment en geen fout: elke cast noemt daarom de
 * entiteiten die van hem zijn, en alles daarbuiten telt.
 */

type Doos = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; wie: string };
type Cast = { naam: string; level: LevelId; eigen: readonly string[]; group: Object3D };

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
const { Scene, Vector3 } = await import('three');
const [{ LightPool }, { PoolPeople }, { TravelAgency }, { DJBartek }, { Motorcycles }, { CityTheatre }] = await Promise.all([
	import('#/render/LightPool'),
	import('#/scene/PoolPeople'),
	import('#/scene/TravelAgency'),
	import('#/scene/DJBartek'),
	import('#/scene/Motorcycles'),
	import('#/scene/city/CityTheatre'),
]);

/**
 * Wereldposities van de direct geplaatste kinderen. De groep zelf staat vaak op een
 * offset, dus lokaal vergelijken plaatst alles op de oorsprong en vindt niets.
 */
function wereldposities(group: Object3D): { x: number; y: number; z: number }[] {
	group.updateMatrixWorld(true);
	return group.children.map((kind) => {
		const p = kind.getWorldPosition(new Vector3());
		return { x: p.x, y: p.y, z: p.z };
	});
}

function propsInVreemdeDozen(cast: Cast): string[] {
	const dozen = dozenOp(cast.level).filter((doos) => !cast.eigen.some((id) => doos.wie.startsWith(`${id}.`)));
	const uit: string[] = [];
	for (const p of wereldposities(cast.group)) {
		for (const doos of dozen) {
			if (p.x <= doos.minX || p.x >= doos.maxX || p.z <= doos.minZ || p.z >= doos.maxZ) continue;
			if (p.y < doos.minY || p.y > doos.maxY) continue;
			uit.push(`prop op (${nr(p.x)}, ${nr(p.y)}, ${nr(p.z)}) staat in ${doos.wie}`);
		}
	}
	return uit;
}

let casts: Cast[] = [];

beforeAll(() => {
	const pool = new LightPool(new Scene());
	const theater = new CityTheatre(pool);
	casts = [
		{ naam: 'PoolPeople', level: 'roof', eigen: [], group: new PoolPeople().group },
		{ naam: 'TravelAgency', level: 'v0', eigen: ['shop-island_hop'], group: new TravelAgency(pool).group },
		{ naam: 'DJBartek', level: 'v0', eigen: [], group: new DJBartek(pool).group },
		// De motoren staan tussen de kolommen op P1, waar een vaste plaatsing net zo goed
		// een meter mis kan zitten als de crew-man dat deed.
		{
			naam: 'Motorcycles P1',
			level: 'p1',
			eigen: ['parking-motorcycles'],
			group: new Motorcycles(PARKED_MOTORCYCLE_SPOTS).group,
		},
		// In zijn eigen stoel zitten is containment; de foyerwand, de kassa en het doek
		// staan binnen handbereik en tellen wel.
		{ naam: 'Theaterpubliek', level: 'v0', eigen: ['theatre-seating'], group: theater.audience },
		{ naam: 'Backstage-cast', level: 'v0', eigen: ['theatre-backstage-fixtures'], group: theater.backstage },
	];
});

describe('scene-props staan vrij van volumes die lichamen tegenhouden', () => {
	test.each(['PoolPeople', 'TravelAgency', 'DJBartek', 'Motorcycles P1', 'Theaterpubliek', 'Backstage-cast'])('%s', (naam) => {
		const cast = casts.find((kandidaat) => kandidaat.naam === naam);
		expect(cast, `${naam} wordt niet meer gebouwd`).toBeDefined();
		if (!cast) return;
		const staanVast = propsInVreemdeDozen(cast);
		expect(staanVast, `${naam}: ${staanVast.join(' · ')}`).toBeEmpty();
	});
});
