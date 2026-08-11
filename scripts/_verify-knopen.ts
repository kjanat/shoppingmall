#!/usr/bin/env bun
/** Scratch: welke knopen liggen in geometrie, met en zonder klimrecht. */
import { NODES } from '#/data/graph';
import { CollisionWorld } from '#/physics/Collision';

const wereld = new CollisionWorld();
const STRAAL = 0.5;

for (const n of NODES) {
	const zonder = wereld.resolveCircle(n.x, n.z, n.y, STRAAL);
	const met = wereld.resolveCircle(n.x, n.z, n.y, STRAAL, 3, true);
	const dz = Math.hypot(zonder.x - n.x, zonder.z - n.z);
	const dm = Math.hypot(met.x - n.x, met.z - n.z);
	if (dz > 0.05 || dm > 0.05) {
		console.log(
			`${n.id.padEnd(16)} zonder klim ${dz.toFixed(2)} m · met klim ${dm.toFixed(2)} m → (${met.x.toFixed(1)}, ${met.z.toFixed(1)})`,
		);
	}
}
