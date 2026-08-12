import { describe, expect, test } from 'bun:test';
import { ATRIUM_VOID } from '#/data/layout';
import { levelY } from '#/data/levels';
import type { Bounds3 } from '#/data/spatial';
import {
	ENTRANCE_CANOPY_BAY_ZS,
	ENTRANCE_CANOPY_PARTS,
	ENTRANCE_CANOPY_RIB_PITCH,
	ENTRANCE_CANOPY_RIB_ZS,
	ENTRANCE_CANOPY_WASH_Z,
	ENTRANCE_PORTAL,
	ENTRANCE_SPEC,
	FACADE_RELIEF_SPEC,
	MALL_FACADE_RELIEF,
} from '#/data/world';
import { WALK_STEP } from '#/physics/Collision';
import { ENTRANCE_CARPET, ENTRANCE_CROSSING, PLAZA_OUTER, PLAZA_TRENCH_GAP, ROAD_PLAN, ZEBRA_WIDTH } from '#/scene/city/cityPlan';
import { half, lerp, midpoint, span } from '#/util/math';
import { at } from '#/util/rand';
import { profilePoint } from '$/scripts/perf/routes.ts';
import { trafficConflicts } from './helpers/viewpoints.ts';
import { STREET_X, walkAlongAxis } from './helpers/walk.ts';
import { EPS, nr, world } from './helpers/world.ts';

/**
 * The main entrance is one set of numbers cutting the wall spec, the collision boxes and the
 * entity volumes at once, so it is read three ways: walked through, walked at (from the glass
 * beside it, which must not let anyone through), and looked at from the pavement, because a
 * portal, a canopy and lettering are one line on a plan and the walking probe sees none of
 * what went wrong up there.
 */

const V0 = levelY('v0');
const ATRIUM_X = half(ATRIUM_VOID.width);
/** The only viewpoint outside the facade the project ships; the entrance is judged from it. */
const VIEWPOINT = 'v0-entrance-street';

describe('walking in', () => {
	const walk = walkAlongAxis(ENTRANCE_PORTAL.centerZ, STREET_X, ATRIUM_X);

	test('the walk over the door axis is never obstructed', () => {
		expect(walk.complaint ?? '').toBe('');
	});

	test('it reaches the atrium', () => {
		expect(
			walk.x,
			`the walk strands at x ${nr(walk.x)} and does not reach the atrium (x ${nr(ATRIUM_X)})`,
		).toBeGreaterThanOrEqual(ATRIUM_X);
	});

	test('it ends inside the footprint', () => {
		expect(world.insideMallPlan(walk.x, ENTRANCE_PORTAL.centerZ), `it ends at x ${nr(walk.x)}, outside the footprint`).toBeTrue();
	});
});

/**
 * The two sidelights are glass to the eye and wall to the body. From outside the canopy column
 * stands in front of them, so this walks from the inside out.
 */
describe.each([
	['the northern sidelight', ENTRANCE_PORTAL.minZ + half(ENTRANCE_SPEC.sidelightWidth)],
	['the southern sidelight', ENTRANCE_PORTAL.maxZ - half(ENTRANCE_SPEC.sidelightWidth)],
] as const)('%s', (_what, z) => {
	const walk = walkAlongAxis(z, ENTRANCE_PORTAL.innerX + ENTRANCE_SPEC.hall.depth, STREET_X);

	test('holds a body in', () => {
		expect(walk.complaint ?? '').toBe('');
		expect(walk.x, `the pedestrian walks out to x ${nr(walk.x)} through the glass`).toBeGreaterThanOrEqual(
			ENTRANCE_PORTAL.outerX,
		);
	});
});

/** South of the portal, where the restrooms stand behind the wall, there is no opening at all. */
test('the facade south of the portal has no way in', () => {
	const z = ENTRANCE_PORTAL.maxZ + 0.6;
	const walk = walkAlongAxis(z, STREET_X, ATRIUM_X);
	expect(walk.complaint ?? '').toBe('');
	expect(walk.x, `at z ${nr(z)} the pedestrian walks to x ${nr(walk.x)}, into the mall`).toBeLessThanOrEqual(
		ENTRANCE_PORTAL.outerX,
	);
});

/**
 * The carpet ran from the threshold to the kerb and then kinked to a crossing five metres
 * further south. That kink was the only evidence that the entrance and the crossing did not
 * know each other's measurements: both wrote down their own z.
 */
describe('the carpet and the crossing lie on one axis', () => {
	const axis = midpoint(ENTRANCE_CARPET.minZ, ENTRANCE_CARPET.maxZ);

	test('the carpet lies on the portal axis', () => {
		expect(axis, 'the carpet is off the axis of the portal').toBeCloseTo(ENTRANCE_PORTAL.centerZ, 6);
	});

	test('the crossing lies on the carpet axis', () => {
		expect(ENTRANCE_CROSSING.z, 'you walk diagonally from the carpet to the crossing').toBeCloseTo(axis, 6);
	});

	test('the carpet starts where the crossing ends', () => {
		expect(ENTRANCE_CARPET.minX, 'there is a gap between the crossing and the carpet').toBeCloseTo(
			ENTRANCE_CROSSING.x + half(ROAD_PLAN.width),
			6,
		);
	});

	test('the carpet reaches the threshold', () => {
		expect(ENTRANCE_CARPET.maxX, 'the carpet stops short of the threshold').toBeGreaterThan(ENTRANCE_PORTAL.outerX);
	});

	test('the crossing is at least as wide as the carpet', () => {
		expect(ZEBRA_WIDTH, 'the carpet runs wider than the crossing it feeds').toBeGreaterThanOrEqual(
			span(ENTRANCE_CARPET.minZ, ENTRANCE_CARPET.maxZ) - EPS,
		);
	});
});

/**
 * The canopy edge profile was a band of exactly the slab's size: its front shared both flank
 * faces with the slab and with the two side pieces, and from the forecourt the whole edge
 * flickered. Every piece closes around the slab instead of against it.
 */
describe('the canopy', () => {
	const slab = ENTRANCE_CANOPY_PARTS.find((part) => part.finish === 'slab');

	function boxesOverlap(a: Bounds3, b: Bounds3): boolean {
		return (
			a.minX < b.maxX - EPS &&
			b.minX < a.maxX - EPS &&
			a.minY < b.maxY - EPS &&
			b.minY < a.maxY - EPS &&
			a.minZ < b.maxZ - EPS &&
			b.minZ < a.maxZ - EPS
		);
	}

	function sharedFaces(a: Bounds3, b: Bounds3): string[] {
		const axes: [string, readonly number[], readonly number[]][] = [
			['x', [a.minX, a.maxX], [b.minX, b.maxX]],
			['y', [a.minY, a.maxY], [b.minY, b.maxY]],
			['z', [a.minZ, a.maxZ], [b.minZ, b.maxZ]],
		];
		const out: string[] = [];
		for (const [axis, own, other] of axes) {
			for (const face of own) {
				if (other.some((edge) => Math.abs(edge - face) <= EPS)) out.push(`${axis} face at ${nr(face)}`);
			}
		}
		return out;
	}

	test('has a slab under its edge profile', () => {
		expect(slab, 'the canopy has no slab left, only an edge profile').toBeDefined();
	});

	test.each(ENTRANCE_CANOPY_PARTS.filter((part) => part.finish !== 'slab').map((part) => part.id))(
		'%s touches the slab',
		(id) => {
			const part = ENTRANCE_CANOPY_PARTS.find((candidate) => candidate.id === id);
			if (!part || !slab) return;
			expect(boxesOverlap(part, slab), `${id} does not touch the canopy slab and hangs loose beside it`).toBeTrue();
		},
	);

	test('no two pieces share a face', () => {
		const flickering: string[] = [];
		for (let i = 0; i < ENTRANCE_CANOPY_PARTS.length; i++) {
			for (let k = i + 1; k < ENTRANCE_CANOPY_PARTS.length; k++) {
				const a = at(ENTRANCE_CANOPY_PARTS, i);
				const b = at(ENTRANCE_CANOPY_PARTS, k);
				if (!boxesOverlap(a, b)) continue;
				for (const face of sharedFaces(a, b)) flickering.push(`${a.id} and ${b.id} share their ${face}`);
			}
		}
		expect(flickering, flickering.join('\n')).toBeEmpty();
	});
});

/**
 * How the entrance reads from the pavement. The lettering hung under the sightline over the
 * front lip of the canopy and was 89% hidden behind the roof that was supposed to frame it; a
 * flag mast stood with its foot in the open trench, two metres over the ramp; and the five
 * recessed spots under the canopy sat on a pitch of their own, straight through the ribs.
 */
describe('the entrance as it reads from the street', () => {
	const { pose } = profilePoint(VIEWPOINT);
	const { lettering, canopy, flag } = ENTRANCE_SPEC;
	const letterX = ENTRANCE_PORTAL.outerX - lettering.standoff;
	const sightline = lerp(pose.y, canopy.topY, span(pose.x, letterX) / span(pose.x, ENTRANCE_PORTAL.canopyX));
	const letterBottom = V0 + lettering.centerY - half(lettering.height);
	const letterTop = V0 + lettering.centerY + half(lettering.height);

	test('the viewpoint stands on the paving', () => {
		expect(
			pose.x >= PLAZA_OUTER.minX && pose.x <= PLAZA_OUTER.maxX && pose.z >= PLAZA_OUTER.minZ && pose.z <= PLAZA_OUTER.maxZ,
			`${VIEWPOINT} stands at (${nr(pose.x)}, ${nr(pose.z)}), off the paving`,
		).toBeTrue();
	});

	test('the viewpoint does not stand over the open trench', () => {
		expect(
			pose.x >= PLAZA_TRENCH_GAP.minX &&
				pose.x <= PLAZA_TRENCH_GAP.maxX &&
				pose.z >= PLAZA_TRENCH_GAP.minZ &&
				pose.z <= PLAZA_TRENCH_GAP.maxZ,
			`${VIEWPOINT} stands over the open trench`,
		).toBeFalse();
	});

	test('the viewpoint stands clear of the traffic', () => {
		const conflicts = trafficConflicts(VIEWPOINT, pose.x, pose.z);
		expect(conflicts, conflicts.join('\n')).toBeEmpty();
	});

	test('the lettering sits above the sightline over the canopy', () => {
		expect(
			letterBottom,
			`the lettering starts at ${nr(letterBottom)}, ${nr(span(letterBottom, sightline))} m under the sightline from ${VIEWPOINT}`,
		).toBeGreaterThanOrEqual(sightline);
	});

	test('the lettering stays under the cornice', () => {
		expect(letterTop, `the lettering reaches ${nr(letterTop)} and runs into the cornice`).toBeLessThanOrEqual(
			FACADE_RELIEF_SPEC.cornice.minY,
		);
	});

	test('the lettering stands in front of the relief beside it', () => {
		const letterMinZ = ENTRANCE_PORTAL.centerZ - half(lettering.width);
		const letterMaxZ = ENTRANCE_PORTAL.centerZ + half(lettering.width);
		const swallowed = MALL_FACADE_RELIEF.filter(
			(piece) =>
				piece.side === 'west' &&
				piece.maxY > letterBottom &&
				piece.minY < letterTop &&
				piece.maxZ > letterMinZ &&
				piece.minZ < letterMaxZ &&
				lettering.standoff <= span(piece.minX, ENTRANCE_PORTAL.outerX),
		).map(
			(piece) =>
				`the lettering stands ${nr(lettering.standoff)} m off the facade and disappears into ${piece.id}, which projects ${nr(span(piece.minX, ENTRANCE_PORTAL.outerX))} m`,
		);
		expect(swallowed, swallowed.join('\n')).toBeEmpty();
	});

	test('the flag masts stand in front of the canopy', () => {
		const canopyUnderside = canopy.topY - canopy.thickness;
		const mastFoot = flag.radius * flag.baseFlare;
		if (V0 + flag.height <= canopyUnderside) return;
		expect(
			ENTRANCE_PORTAL.flagX,
			`the mast at x ${nr(ENTRANCE_PORTAL.flagX)} stands under the canopy (to x ${nr(ENTRANCE_PORTAL.canopyX)}) while it reaches ${nr(V0 + flag.height)} and the canopy hangs at ${nr(canopyUnderside)}`,
		).toBeLessThanOrEqual(ENTRANCE_PORTAL.canopyX - mastFoot);
	});

	test.each([-1, 1] as const)('the flag mast on side %d stands on the pavement', (side) => {
		const x = ENTRANCE_PORTAL.flagX;
		const z = ENTRANCE_PORTAL.centerZ + side * ENTRANCE_PORTAL.flagOffsetZ;
		expect(
			world.groundHeightAt(x, z, V0, WALK_STEP),
			`the mast at (${nr(x)}, ${nr(z)}) does not stand on the pavement`,
		).toBeCloseTo(V0, 6);
		expect(
			x >= PLAZA_TRENCH_GAP.minX && x <= PLAZA_TRENCH_GAP.maxX && z >= PLAZA_TRENCH_GAP.minZ && z <= PLAZA_TRENCH_GAP.maxZ,
			`the mast at (${nr(x)}, ${nr(z)}) stands in the open trench`,
		).toBeFalse();
	});

	test('the recessed spots hang below the ribs', () => {
		const ribY = canopy.topY - canopy.thickness - canopy.rib.drop;
		const spotY = ribY - half(canopy.rib.height) - canopy.spot.drop;
		expect(
			spotY,
			`the spots hang at ${nr(spotY)} and sit inside the ribs (down to ${nr(ribY - half(canopy.rib.height))})`,
		).toBeLessThanOrEqual(ribY - half(canopy.rib.height));
	});

	test.each(ENTRANCE_CANOPY_BAY_ZS.map((_z, index) => index))('spot %d sits in a bay between the ribs', (index) => {
		const spotZ = at(ENTRANCE_CANOPY_BAY_ZS, index);
		const clear = canopy.spot.radius + half(canopy.rib.width);
		const fouling = ENTRANCE_CANOPY_RIB_ZS.filter((ribZ) => Math.abs(spotZ - ribZ) < clear).map(
			(ribZ) => `it runs ${nr(clear - Math.abs(spotZ - ribZ))} m into the rib at z ${nr(ribZ)}`,
		);
		expect(fouling, fouling.join('\n')).toBeEmpty();
	});

	/**
	 * On the portal axis an odd number of ribs puts a rib, and that one burns out white at
	 * 0.66 m while its neighbours stay dark at 1.20 m: head-on the canopy reads as a white bar.
	 * In the middle of a bay every rib is equally far away.
	 */
	test('the wash lamp hangs in the middle of a bay', () => {
		const nearestRib = ENTRANCE_CANOPY_RIB_ZS.reduce(
			(shortest, ribZ) => Math.min(shortest, Math.abs(ENTRANCE_CANOPY_WASH_Z - ribZ)),
			Number.POSITIVE_INFINITY,
		);
		expect(
			nearestRib,
			`the wash hangs at z ${nr(ENTRANCE_CANOPY_WASH_Z)}, ${nr(nearestRib)} m from a rib instead of ${nr(half(ENTRANCE_CANOPY_RIB_PITCH))} m`,
		).toBeGreaterThanOrEqual(half(ENTRANCE_CANOPY_RIB_PITCH) - EPS);
	});
});
