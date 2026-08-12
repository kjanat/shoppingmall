import { describe, expect, test } from 'bun:test';
import { LEVELS, levelY } from '#/data/levels';
import { geometryBounds } from '#/data/spatial';
import { ENTRANCE_PORTAL, SLAB_SPEC_BY_LEVEL, VERTICAL_CONNECTORS, WORLD_ENTITIES } from '#/data/world';
import type { ZoneId } from '#/data/zones';
import { ZONES, zoneAt, zoneBit, zoneMaskOfBounds, zoneOfLevel, zoneVolume } from '#/data/zones';
import { half, lerp, midpoint } from '#/util/math';
import { stubDocument } from './helpers/stub-dom.ts';
import { nr } from './helpers/world.ts';

/**
 * The zone cull, run bare.
 *
 * Nothing tested it: the whole scheme — which zone you see, what gets hidden, what may never be
 * hidden — rested on one hand-made draw-call measurement. `seesZone` returned all five zones
 * from every viewpoint, because an opening behind the camera yielded the full camera cone, and
 * with that the entire simulation LOD was dead without anything noticing. The other way round is
 * worse: too tight a cone makes geometry you are looking at disappear.
 */

const V0 = levelY('v0');
const V1 = levelY('v1');
const EYE = 1.6;
/** Steps over the escalator ride: fine enough to hit the cull window under the upper slab. */
const RIDE_STEPS = 24;

stubDocument();
const THREE = await import('three');
const [{ ZoneCuller }, { ZoneVisibility }, { MallBuilder }] = await Promise.all([
	import('#/render/ZoneCuller'),
	import('#/render/ZoneVisibility'),
	import('#/scene/MallBuilder'),
]);

const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
const culler = new ZoneCuller();
const PAVEMENT_Z = ENTRANCE_PORTAL.centerZ;
const OUTSIDE_X = ENTRANCE_PORTAL.outerX - 9;

function look(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, zone: ZoneId): void {
	camera.position.set(from.x, from.y, from.z);
	camera.lookAt(to.x, to.y, to.z);
	camera.updateMatrixWorld(true);
	camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
	camera.updateProjectionMatrix();
	culler.update(camera, zone);
}

describe('on the pavement with the facade behind you', () => {
	const from = { x: OUTSIDE_X, y: V0 + EYE, z: PAVEMENT_Z };
	const to = { x: OUTSIDE_X - 30, y: V0 + EYE, z: PAVEMENT_Z };

	test.each(ZONES.filter((zone) => zone !== 'stad'))('%s is not visible', (zone) => {
		look(from, to, 'stad');
		expect(culler.seesZone(zone), 'it is called visible while the opening to it lies behind the camera').toBeFalse();
	});

	test('a sphere in the middle of V0 is rejected', () => {
		look(from, to, 'stad');
		expect(
			culler.accepts(zoneBit('mall-v0'), new THREE.Sphere(new THREE.Vector3(0, V0 + 2, 0), 2)),
			'it is still accepted',
		).toBeFalse();
	});
});

describe('on the pavement facing the doors', () => {
	const from = { x: OUTSIDE_X, y: V0 + EYE, z: PAVEMENT_Z };
	const to = { x: ENTRANCE_PORTAL.innerX + 10, y: V0 + EYE, z: PAVEMENT_Z };

	test('V0 is visible', () => {
		look(from, to, 'stad');
		expect(culler.seesZone('mall-v0'), 'V0 is called invisible while you look through the doorway').toBeTrue();
	});

	test('what stands just inside the doors is kept', () => {
		look(from, to, 'stad');
		const insideTheDoor = new THREE.Sphere(new THREE.Vector3(ENTRANCE_PORTAL.innerX + 3, V0 + EYE, PAVEMENT_Z), 1);
		expect(culler.accepts(zoneBit('mall-v0'), insideTheDoor), 'it is culled away').toBeTrue();
	});
});

/**
 * The city has no box to test against, so this hangs entirely on an opening behind the camera
 * yielding no cone. If it yielded the full camera cone the answer here would be yes and the
 * whole city block would tick at full speed forever.
 */
describe('deep inside V0 with the entrance behind you', () => {
	const from = { x: 0, y: V0 + EYE, z: 0 };
	const to = { x: 30, y: V0 + EYE, z: 0 };

	test('the city is not visible', () => {
		look(from, to, 'mall-v0');
		expect(culler.seesZone('stad'), 'the city is called visible while the glazing lies behind you').toBeFalse();
	});

	test('something on the pavement behind you is rejected', () => {
		look(from, to, 'mall-v0');
		const onTheStreet = new THREE.Sphere(new THREE.Vector3(ENTRANCE_PORTAL.outerX - 6, V0 + EYE, ENTRANCE_PORTAL.centerZ), 1);
		expect(culler.accepts(zoneBit('stad'), onTheStreet), 'it is still accepted').toBeFalse();
	});
});

describe.each([...ZONES])('standing in %s', (zone) => {
	test('your own zone is never culled', () => {
		look({ x: 0, y: V0 + EYE, z: 0 }, { x: 20, y: V0 + EYE, z: 0 }, zone);
		expect(culler.seesZone(zone), 'your own zone is called invisible').toBeTrue();
		expect(culler.accepts(zoneBit(zone), null), 'something in your own zone is culled away').toBeTrue();
	});
});

/**
 * Everything standing on a deck fits inside the box `seesZone` uses for that deck. Too tight a
 * box leaves the roof ticking at four hertz while you are standing on it.
 */
describe.each([...ZONES])('the zone box of %s', (zone) => {
	const box = zoneVolume(zone);

	test('holds every volume that belongs to it alone', () => {
		if (box === null) return;
		const sticking = WORLD_ENTITIES.flatMap((entity) =>
			entity.volumes
				.map((volume) => ({ volume, bounds: geometryBounds(volume.geometry) }))
				.filter(({ bounds }) => zoneMaskOfBounds(bounds) === zoneBit(zone))
				.filter(
					({ bounds }) =>
						bounds.minX < box.minX ||
						bounds.maxX > box.maxX ||
						bounds.minY < box.minY ||
						bounds.maxY > box.maxY ||
						bounds.minZ < box.minZ ||
						bounds.maxZ > box.maxZ,
				)
				.map(
					({ volume, bounds }) =>
						`${entity.id}.${volume.id} lies outside zone box x ${nr(box.minX)}..${nr(box.maxX)}, y ${nr(box.minY)}..${nr(box.maxY)}, z ${nr(box.minZ)}..${nr(box.maxZ)} with x ${nr(bounds.minX)}..${nr(bounds.maxX)}, y ${nr(bounds.minY)}..${nr(bounds.maxY)}, z ${nr(bounds.minZ)}..${nr(bounds.maxZ)}`,
				),
		);
		expect(sticking, sticking.join('\n')).toBeEmpty();
	});
});

/**
 * A deck slab is the interface between two zones and belongs to both: the floor from above, the
 * ceiling from below. Carrying only its own deck, the ceiling falls away where you look straight
 * at it from underneath and no portal cone covers the zone above — the roof slab read only roof
 * and vanished from V1.
 */
describe.each([SLAB_SPEC_BY_LEVEL.v0, SLAB_SPEC_BY_LEVEL.v1, SLAB_SPEC_BY_LEVEL.roof].map((spec) => spec.id))('%s', (id) => {
	const spec = [SLAB_SPEC_BY_LEVEL.v0, SLAB_SPEC_BY_LEVEL.v1, SLAB_SPEC_BY_LEVEL.roof].find((candidate) => candidate.id === id);
	if (!spec) throw new Error(`no slab ${id}`);
	const below = LEVELS[LEVELS.findIndex((level) => level.id === spec.level) + 1];
	const volume = WORLD_ENTITIES.find((entity) => entity.id === spec.id)?.volumes[0];

	test('exists in the world', () => {
		expect(volume, `the slab ${spec.id} is missing from the world`).toBeDefined();
	});

	test('carries the zone underneath it as well', () => {
		if (!below || !volume) return;
		const mask = zoneMaskOfBounds(geometryBounds(volume.geometry));
		expect(
			mask & zoneBit(zoneOfLevel(below.id)),
			`the ${spec.level} slab does not carry ${zoneOfLevel(below.id)}, so from below the ceiling vanishes`,
		).not.toBe(0);
	});
});

describe('on V1 looking straight up', () => {
	const from = { x: 23.8, y: V1, z: 4.4 };
	const to = { x: 24.5, y: V1 + 3, z: 3.7 };
	const volume = WORLD_ENTITIES.find((entity) => entity.id === SLAB_SPEC_BY_LEVEL.roof.id)?.volumes[0];

	test('no roof portal is in view, so this measures the slab and not a cone', () => {
		look(from, to, 'mall-v1');
		expect(culler.seesZone('roof'), 'the roof is called visible, so the test proves nothing about the slab').toBeFalse();
	});

	test('the roof slab is kept anyway', () => {
		look(from, to, 'mall-v1');
		if (!volume) return;
		const bounds = geometryBounds(volume.geometry);
		const sphere = new THREE.Sphere(new THREE.Vector3(from.x, midpoint(bounds.minY, bounds.maxY), from.z), 2);
		expect(culler.accepts(zoneMaskOfBounds(bounds), sphere), 'it is culled while you look straight at it from below').toBeTrue();
	});
});

describe('on V1 looking down through the atrium', () => {
	const from = { x: 0, y: V1 + EYE, z: 7 };
	const to = { x: 0, y: V0, z: 0 };
	const volume = WORLD_ENTITIES.find((entity) => entity.id === SLAB_SPEC_BY_LEVEL.v0.id)?.volumes[0];

	test('V0 is visible', () => {
		look(from, to, 'mall-v1');
		expect(culler.seesZone('mall-v0'), 'V0 is called invisible while you look down through the atrium').toBeTrue();
	});

	test('the ground floor slab is kept', () => {
		look(from, to, 'mall-v1');
		if (!volume) return;
		const bounds = geometryBounds(volume.geometry);
		const sphere = new THREE.Sphere(new THREE.Vector3(0, midpoint(bounds.minY, bounds.maxY), 0), 2);
		expect(culler.accepts(zoneMaskOfBounds(bounds), sphere), 'the ground floor is culled while you look down on it').toBeTrue();
	});
});

/**
 * The escalator sign stands with its whole box on V0, but it hangs at the mouth of an escalator
 * joining V0 and V1. Riding up, the camera zone flips to V1 at `levelAt`'s boundary, half a metre
 * under the V1 slab, while the camera still looks into the shaft. In that band no V1→V0 portal
 * cone covers the sign at x 22 — the atrium hole lies at x −8..8 and the escalator hole at the
 * slab height above the camera — so the cull removed it while you were looking straight at it.
 */
describe.each(VERTICAL_CONNECTORS.filter((connector) => connector.kind === 'escalator').map((connector) => connector.id))(
	'the sign of %s',
	(id) => {
		const spec = VERTICAL_CONNECTORS.find((candidate) => candidate.id === id);
		if (!spec) throw new Error(`no escalator ${id}`);
		const scene = new THREE.Scene();
		scene.add(new MallBuilder().build());
		scene.updateMatrixWorld(true);
		const visibility = new ZoneVisibility(scene, []);
		const rideCuller = new ZoneCuller();
		const rideCamera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
		const frustum = new THREE.Frustum();
		const viewProjection = new THREE.Matrix4();
		const name = `${spec.id}-sign`;
		const sign = scene.getObjectByName(name);

		test('exists in the scene', () => {
			expect(sign, `the escalator ${spec.id} has no sign ${name} in the scene`).toBeDefined();
		});

		if (!sign) return;

		const box = new THREE.Box3().setFromObject(sign, true);
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const radius = half(Math.hypot(size.x, size.y, size.z));
		const ride = Array.from({ length: RIDE_STEPS + 1 }, (_value, index) => {
			const t = index / RIDE_STEPS;
			const y = levelY(spec.from) + EYE + t * (levelY(spec.to) - levelY(spec.from));
			const z = lerp(spec.zBottom, spec.zTop, t);
			rideCamera.position.set(spec.x, y, z);
			rideCamera.lookAt(center.x, center.y, center.z);
			rideCamera.updateMatrixWorld(true);
			rideCamera.matrixWorldInverse.copy(rideCamera.matrixWorld).invert();
			rideCamera.updateProjectionMatrix();
			viewProjection.multiplyMatrices(rideCamera.projectionMatrix, rideCamera.matrixWorldInverse);
			frustum.setFromProjectionMatrix(viewProjection, rideCamera.coordinateSystem);
			rideCuller.update(rideCamera, zoneAt(spec.x, y, z));
			visibility.apply(rideCuller);
			return {
				y,
				z,
				inView: frustum.intersectsSphere(new THREE.Sphere(center.clone(), radius)),
				drawn: sign.layers.mask !== 0,
			};
		});

		test('comes into view during the ride at all', () => {
			expect(
				ride.filter((step) => step.inView),
				'it never came into view, so this proves nothing',
			).not.toBeEmpty();
		});

		test('stays drawn for the whole ride', () => {
			const gone = ride
				.filter((step) => step.inView && !step.drawn)
				.map((step) => `it disappears at y ${nr(step.y)}, z ${nr(step.z)} (zone ${zoneAt(spec.x, step.y, step.z)})`);
			expect(gone, gone.join('\n')).toBeEmpty();
		});
	},
);
