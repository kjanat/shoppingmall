import { CollisionWorld } from '#/physics/Collision';
import { stubDocument } from './stub-dom.ts';

stubDocument();

const [THREE, { LightPool }, { ScrubberBuggy }, { Barriers }, { GlassElevator }] = await Promise.all([
	import('three'),
	import('#/render/LightPool'),
	import('#/scene/ScrubberBuggy'),
	import('#/scene/city/Barriers'),
	import('#/scene/GlassElevator'),
]);

/** Wereld mét de liftschacht-colliders, precies zoals App.ts ze uit GlassElevator haalt. */
function wereldMetLift(): CollisionWorld {
	const world = new CollisionWorld();
	const lift = new GlassElevator(new LightPool(new THREE.Scene()));
	for (const c of lift.getColliders()) {
		world.addBox(c.minX, c.maxX, c.minZ, c.maxZ, {
			minY: c.minY ?? -7.5,
			maxY: c.maxY ?? 16.5,
			label: c.label,
			climbable: c.climbable,
		});
	}
	return world;
}

function rijScrubber(
	label: string,
	world: CollisionWorld,
	start: { x: number; y: number; z: number; yaw: number },
	frames = 180,
): { maxY: number; eind: { x: number; y: number; z: number } } {
	const buggy = new ScrubberBuggy(world, new LightPool(new THREE.Scene()), new Barriers(world));
	buggy.resume({ id: '', x: start.x, y: start.y, z: start.z, yaw: start.yaw, speed: 0 });
	const dt = 1 / 60;
	let maxY = start.y;
	console.log(`\n=== ${label}: start (${start.x}, ${start.y}, ${start.z}) yaw=${start.yaw.toFixed(2)} ===`);
	for (let f = 0; f < frames; f++) {
		buggy.update(dt, { throttle: 1, steer: 0, boost: false });
		if (buggy.pos.y > maxY) maxY = buggy.pos.y;
		if (f % 30 === 0 || f === frames - 1) {
			console.log(
				`  frame ${String(f).padStart(3)}: pos=(${buggy.pos.x.toFixed(2)}, ${buggy.pos.y.toFixed(2)}, ${buggy.pos.z.toFixed(2)})`,
			);
		}
	}
	console.log(`  hoogste y: ${maxY.toFixed(2)}`);
	return { maxY, eind: { x: buggy.pos.x, y: buggy.pos.y, z: buggy.pos.z } };
}

// 1. Geheime trap (x=26, zBottom=14 op v1 y=6). Rij +z de trap op: mag NIET klimmen.
const trap = rijScrubber('geheime trap (mag niet klimmen)', new CollisionWorld(), { x: 26, y: 6, z: 12.5, yaw: Math.PI });
console.log(trap.maxY < 6.5 ? '  ✓ blijft op de vloer' : `  ✗ klom naar ${trap.maxY.toFixed(2)}`);

// 2. Liftschacht (center 16,-8, cabine 2x2, instapzijde z=-7). Rij -z de cabine in: mag WEL passeren.
const lift = rijScrubber('lift instappen (mag wel)', wereldMetLift(), { x: 16, y: 0, z: -5, yaw: 0 }, 120);
console.log(
	lift.eind.z < -7
		? `  ✓ rijdt de schacht in (z=${lift.eind.z.toFixed(2)})`
		: `  ✗ botst op de instapzijde bij z=${lift.eind.z.toFixed(2)}`,
);

// 3. Parkeer-uitritramp (start x=-30 op P1 y=-6, end x=-46 op v0). Rij -x de ramp op: mag WEL klimmen.
const ramp = rijScrubber(
	'uitritramp (mag wel klimmen)',
	new CollisionWorld(),
	{ x: -30.5, y: -5.8, z: 0, yaw: Math.PI / 2 },
	260,
);
console.log(
	ramp.maxY > -0.3 ? `  ✓ klimt de ramp op (y=${ramp.maxY.toFixed(2)})` : `  ✗ bleef steken op y=${ramp.maxY.toFixed(2)}`,
);
