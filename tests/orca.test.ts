import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OrcaBody } from '#/sim/Orca';
import { agentConstraint, RECIPROCAL_SHARE, solveVelocity, staticConstraint } from '#/sim/Orca';

const DT = 1 / 60;
const HORIZON = 2;

function body({ x, z, vx, vz, radius = 0.4 }: Readonly<{
	x: number;
	z: number;
	vx: number;
	vz: number;
	radius?: number;
}>): OrcaBody {
	return { x, z, vx, vz, radius };
}

/** De snelheid die één paar oplevert: het halfvlak van `other` op de gewenste snelheid van `self`. */
function steer(self: OrcaBody, other: OrcaBody): { vx: number; vz: number } {
	const c = agentConstraint({ self, other, horizon: HORIZON, dt: DT, share: RECIPROCAL_SHARE });
	return solveVelocity({ prefVx: self.vx, prefVz: self.vz, maxSpeed: Math.hypot(self.vx, self.vz), constraints: c ? [c] : [], rounds: 4 });
}

describe('reciprocal velocity obstacles', () => {
	test('two walkers closing head-on pass on opposite sides, mirrored to each other', () => {
		const a = body({ x: -1.5, z: 0, vx: 1, vz: 0 });
		const b = body({ x: 1.5, z: 0, vx: -1, vz: 0 });
		const va = steer(a, b);
		const vb = steer(b, a);

		assert.ok(Math.abs(va.vz) > 0.05, `a wijkt niet uit: vz ${va.vz}`);
		assert.ok(Math.abs(vb.vz) > 0.05, `b wijkt niet uit: vz ${vb.vz}`);
		// Elk de helft van dezelfde correctie: samen lossen ze de botsing één keer op.
		assert.ok(Math.abs(va.vz + vb.vz) < 1e-9, `de correcties zijn niet gelijk en tegengesteld: ${va.vz} / ${vb.vz}`);
		assert.ok(Math.abs(va.vx + vb.vx) < 1e-9, 'de voorwaartse componenten lopen uiteen');
	});

	test('a walker on a converging course leaves its preferred velocity', () => {
		const self = body({ x: 0, z: -1.5, vx: 0, vz: 1 });
		const crossing = body({ x: -1.5, z: 0, vx: 1, vz: 0 });
		const solved = steer(self, crossing);
		assert.ok(Math.hypot(solved.vx - 0, solved.vz - 1) > 0.02, 'de kruisende koers laat de gewenste snelheid onaangeroerd');
	});

	test('walkers moving apart keep their preferred velocity', () => {
		const a = body({ x: -1, z: 0, vx: -1, vz: 0 });
		const b = body({ x: 1, z: 0, vx: 1, vz: 0 });
		const solved = steer(a, b);
		assert.equal(solved.vx, -1);
		assert.equal(solved.vz, 0);
	});

	test('a walker far off the course of another keeps its preferred velocity', () => {
		const a = body({ x: 0, z: 0, vx: 1, vz: 0 });
		const b = body({ x: 0, z: 30, vx: 0, vz: 0 });
		const solved = steer(a, b);
		assert.equal(solved.vx, 1);
		assert.equal(solved.vz, 0);
	});

	test('a walker behind another at walking pace is not braked by it', () => {
		const leader = body({ x: 2, z: 0, vx: 1, vz: 0 });
		const follower = body({ x: 0, z: 0, vx: 1, vz: 0 });
		const solved = steer(follower, leader);
		assert.ok(Math.abs(solved.vx - 1) < 1e-9, `de volger remt op gelijke snelheid: ${solved.vx}`);
	});

	test('overlapping bodies get a constraint that pushes them apart this frame', () => {
		const a = body({ x: 0, z: 0, vx: 0, vz: 0 });
		const b = body({ x: 0.3, z: 0, vx: 0, vz: 0 });
		const c = agentConstraint({ self: a, other: b, horizon: HORIZON, dt: DT, share: RECIPROCAL_SHARE });
		assert.ok(c, 'twee overlappende lichamen leveren geen halfvlak op');
		assert.ok(c.nx < -0.9, `de normaal wijst niet van de ander af: ${c.nx}`);
		const solved = solveVelocity({ prefVx: 0, prefVz: 0, maxSpeed: 2, constraints: [c], rounds: 4 });
		assert.ok(solved.vx < -0.1, `de oplossing duwt niet weg: ${solved.vx}`);
	});
});

describe('static half-planes', () => {
	test('a wall ahead caps the approach speed at the gap over the horizon', () => {
		const self = body({ x: 0, z: 0, vx: 1.4, vz: 0 });
		const wall = { minX: 2, maxX: 3, minZ: -5, maxZ: 5 };
		const solved = solveVelocity({ prefVx: self.vx, prefVz: self.vz, maxSpeed: 1.4, constraints: [staticConstraint({ self, box: wall, horizon: HORIZON, dt: DT })], rounds: 4 });
		// Gat = 2 − 0.4 = 1.6 m over een horizon van 2 s → hoogstens 0.8 m/s op de muur af.
		assert.ok(solved.vx <= 0.8 + 1e-9, `loopt met ${solved.vx} m/s op de muur af`);
	});

	test('walking along a wall is not slowed by it', () => {
		const self = body({ x: 0, z: 0, vx: 0, vz: 1.4 });
		const wall = { minX: 0.5, maxX: 3, minZ: -5, maxZ: 5 };
		const solved = solveVelocity({ prefVx: self.vx, prefVz: self.vz, maxSpeed: 1.4, constraints: [staticConstraint({ self, box: wall, horizon: HORIZON, dt: DT })], rounds: 4 });
		assert.ok(Math.abs(solved.vz - 1.4) < 1e-9, `langs de muur lopen wordt afgeremd tot ${solved.vz}`);
	});

	test('walking away from a wall is not slowed by it', () => {
		const self = body({ x: 0.6, z: 0, vx: -1.4, vz: 0 });
		const wall = { minX: 0.5, maxX: 3, minZ: -5, maxZ: 5 };
		const solved = solveVelocity({ prefVx: self.vx, prefVz: self.vz, maxSpeed: 1.4, constraints: [staticConstraint({ self, box: wall, horizon: HORIZON, dt: DT })], rounds: 4 });
		assert.ok(Math.abs(solved.vx - -1.4) < 1e-9, `weglopen van de muur wordt afgeremd tot ${solved.vx}`);
	});

	test('a body already inside the wall is told to leave within one frame', () => {
		const self = body({ x: 2.5, z: 0, vx: 0, vz: 0 });
		const wall = { minX: 2, maxX: 3, minZ: -5, maxZ: 5 };
		const solved = solveVelocity({ prefVx: 0, prefVz: 0, maxSpeed: 5, constraints: [staticConstraint({ self, box: wall, horizon: HORIZON, dt: DT })], rounds: 4 });
		assert.ok(Math.hypot(solved.vx, solved.vz) > 1, `de uitweg is te traag: ${Math.hypot(solved.vx, solved.vz)}`);
	});
});

describe('the projection solver', () => {
	test('an empty constraint set returns the preferred velocity, capped at max speed', () => {
		assert.deepEqual(solveVelocity({ prefVx: 3, prefVz: 4, maxSpeed: 5, constraints: [], rounds: 4 }), { vx: 3, vz: 4 });
		const capped = solveVelocity({ prefVx: 3, prefVz: 4, maxSpeed: 1, constraints: [], rounds: 4 });
		assert.ok(Math.abs(Math.hypot(capped.vx, capped.vz) - 1) < 1e-9);
	});

	test('conflicting constraints yield a velocity instead of an exception', () => {
		const left = { px: 1, pz: 0, nx: 1, nz: 0 };
		const right = { px: -1, pz: 0, nx: -1, nz: 0 };
		const solved = solveVelocity({ prefVx: 0, prefVz: 1, maxSpeed: 1.5, constraints: [left, right], rounds: 4 });
		assert.ok(Number.isFinite(solved.vx) && Number.isFinite(solved.vz));
	});
});
