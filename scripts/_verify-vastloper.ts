#!/usr/bin/env bun
/** Scratch: waar strandt de eenzame sim? Wordt weer weggegooid. */
import { NODES } from '#/data/graph';
import { levelAt, levelY } from '#/data/levels';
import { STORES } from '#/data/stores';
import { CollisionWorld } from '#/physics/Collision';

const wereld = new CollisionWorld();

const X = -14.0;
const Z = 12.6;
for (const straal of [0.3, 0.4, 0.5, 0.6, 0.7]) {
	const los = wereld.resolveCircle(X, Z, 0.15, straal);
	console.log(`straal ${straal}: (${X}, ${Z}) → (${los.x.toFixed(2)}, ${los.z.toFixed(2)})`);
}

console.log('\ndozen die dit punt binnen 1.5 m raken:');
for (const b of wereld.boxes) {
	if (b.disabled) continue;
	const cx = Math.max(b.minX, Math.min(X, b.maxX));
	const cz = Math.max(b.minZ, Math.min(Z, b.maxZ));
	const d = Math.hypot(X - cx, Z - cz);
	if (d < 1.5) {
		console.log(
			`  ${(b.label ?? '?').padEnd(28)} d=${d.toFixed(2)} x[${b.minX.toFixed(1)},${b.maxX.toFixed(1)}] z[${b.minZ.toFixed(1)},${b.maxZ.toFixed(1)}] y[${b.minY ?? '-'},${b.maxY ?? '-'}] climb=${b.climbable ?? '-'}`,
		);
	}
}

console.log('\nwinkelingangen (shopEntrance = winkel + 3.5 vooruit):');
for (const s of STORES) {
	const x = s.x + Math.sin(s.rotation) * 3.5;
	const z = s.z + Math.cos(s.rotation) * 3.5;
	if (Math.hypot(x - X, z - Z) < 6) {
		const los = wereld.resolveCircle(x, z, levelY(s.level), 0.5);
		const weg = Math.hypot(los.x - x, los.z - z);
		console.log(
			`  ${s.id.padEnd(12)} ingang (${x.toFixed(1)}, ${z.toFixed(1)}) op ${s.level} → verschoven ${weg.toFixed(2)} m naar (${los.x.toFixed(1)}, ${los.z.toFixed(1)})`,
		);
	}
}

console.log('\nelke winkelingang: hoever duwt de wereld hem weg? (straal 0.5)');
for (const s of STORES) {
	const x = s.x + Math.sin(s.rotation) * 3.5;
	const z = s.z + Math.cos(s.rotation) * 3.5;
	const y = levelY(s.level);
	const los = wereld.resolveCircle(x, z, y, 0.5);
	const weg = Math.hypot(los.x - x, los.z - z);
	console.log(`  ${s.id.padEnd(12)} ${s.level} (${x.toFixed(1)}, ${z.toFixed(1)}) verschuiving ${weg.toFixed(3)}`);
}

console.log('\nelke graafknoop: verschuiving en vloerhoogte');
for (const n of NODES) {
	const los = wereld.resolveCircle(n.x, n.z, n.y, 0.5);
	const weg = Math.hypot(los.x - n.x, los.z - n.z);
	const vloer = wereld.snapFloorY(n.x, n.z, n.y);
	const merk = weg > 0.05 || Math.abs(vloer - levelY(levelAt(n.y))) > 0.5 ? ' ✗' : '';
	console.log(`  ${n.id.padEnd(16)} (${n.x}, ${n.y}, ${n.z}) verschuiving ${weg.toFixed(3)} vloer ${vloer.toFixed(2)}${merk}`);
}
