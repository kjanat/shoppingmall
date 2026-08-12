import { beforeAll, describe, expect, test } from 'bun:test';
import type { Object3D } from 'three';
import type { LevelId } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { PARKED_MOTORCYCLE_SPOTS, WORLD_ENTITIES } from '#/data/world';
import { stubDocument } from './helpers/stub-dom.ts';

/**
 * Scene props against the world model: nothing a builder places by hand may stand inside
 * a volume that stops bodies.
 *
 * The AL ZUT man stood waist deep in the tiki bar counter and no rule saw it, because
 * validateSpatialWorld works on WORLD_ENTITIES and the cast is scene placed. Standing in
 * your own room is containment and not a fault, so every cast names the entities that
 * belong to it and everything else counts.
 */

type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; who: string };
type Cast = { name: string; level: LevelId; own: readonly string[]; group: Object3D };

function nr(value: number): string {
	return Number(value.toFixed(3)).toString();
}

function boxesOn(level: LevelId): Box[] {
	return WORLD_ENTITIES.filter((entity) => entity.levels.includes(level)).flatMap((entity) =>
		entity.volumes
			.filter((volume) => volume.blocksMovement)
			.map((volume) => ({ ...geometryBounds(volume.geometry), who: `${entity.id}.${volume.id}` })),
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
 * World positions of the directly placed children. The group itself often sits at an
 * offset, so comparing locally puts everything at the origin and finds nothing.
 */
function worldPositions(group: Object3D): { x: number; y: number; z: number }[] {
	group.updateMatrixWorld(true);
	return group.children.map((child) => {
		const p = child.getWorldPosition(new Vector3());
		return { x: p.x, y: p.y, z: p.z };
	});
}

function propsInForeignBoxes(cast: Cast): string[] {
	const boxes = boxesOn(cast.level).filter((box) => !cast.own.some((id) => box.who.startsWith(`${id}.`)));
	const out: string[] = [];
	for (const p of worldPositions(cast.group)) {
		for (const box of boxes) {
			if (p.x <= box.minX || p.x >= box.maxX || p.z <= box.minZ || p.z >= box.maxZ) continue;
			if (p.y < box.minY || p.y > box.maxY) continue;
			out.push(`prop at (${nr(p.x)}, ${nr(p.y)}, ${nr(p.z)}) stands in ${box.who}`);
		}
	}
	return out;
}

const CAST_NAMES = ['PoolPeople', 'TravelAgency', 'DJBartek', 'Motorcycles P1', 'Theatre audience', 'Backstage cast'];

let casts: Cast[] = [];

beforeAll(() => {
	const pool = new LightPool(new Scene());
	const theatre = new CityTheatre(pool);
	casts = [
		{ name: 'PoolPeople', level: 'roof', own: [], group: new PoolPeople().group },
		{ name: 'TravelAgency', level: 'v0', own: ['shop-island_hop'], group: new TravelAgency(pool).group },
		{ name: 'DJBartek', level: 'v0', own: [], group: new DJBartek(pool).group },
		// The bikes stand between the columns on P1, where a fixed placement can be a metre
		// off just as easily as the crew man was.
		{
			name: 'Motorcycles P1',
			level: 'p1',
			own: ['parking-motorcycles'],
			group: new Motorcycles(PARKED_MOTORCYCLE_SPOTS).group,
		},
		// Sitting in your own seat is containment; the foyer wall, the box office and the
		// curtain all stand within arm's reach and do count.
		{ name: 'Theatre audience', level: 'v0', own: ['theatre-seating'], group: theatre.audience },
		{ name: 'Backstage cast', level: 'v0', own: ['theatre-backstage-fixtures'], group: theatre.backstage },
	];
});

describe('scene props stand clear of volumes that stop bodies', () => {
	test.each(CAST_NAMES)('%s', (name) => {
		const cast = casts.find((candidate) => candidate.name === name);
		expect(cast, `${name} is no longer built`).toBeDefined();
		if (!cast) return;
		const stuck = propsInForeignBoxes(cast);
		expect(stuck, `${name}: ${stuck.join(' · ')}`).toBeEmpty();
	});
});
