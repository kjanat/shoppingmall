import type { PerspectiveCamera } from 'three';
import { levelAt, levelY } from '#/data/levels';
import { CollisionWorld } from '#/physics/Collision';
import { stubDocument } from './stub-dom.ts';

stubDocument();

const [THREE, { LightPool }, { GlassElevator }, { ScrubberBuggy }, { Barriers }] = await Promise.all([
	import('three'),
	import('#/render/LightPool'),
	import('#/scene/GlassElevator'),
	import('#/scene/ScrubberBuggy'),
	import('#/scene/city/Barriers'),
]);

const scene = new THREE.Scene();
const elevator = new GlassElevator(new LightPool(scene));
const world = new CollisionWorld();
const buggy = new ScrubberBuggy(world, new LightPool(scene), new Barriers(world));

const cabineVloer = elevator.cabinFloorY;
console.log(
	`cabine op v0: pos=(${elevator.pos.x}, ${elevator.pos.z}), vloer y=${cabineVloer.toFixed(2)}, currentStop=${elevator.currentStop}, moving=${elevator.isMoving}`,
);

// Zet de kar in de cabine (zoals na inrijden). Camera = zadel, kijkt langs de rijkoers.
function elevatorAction(camera: PerspectiveCamera, feetY: number): { kind: string; level?: string } | null {
	const freeMove = true;
	const flying = false;
	if (!freeMove || flying) return null;
	const hit = elevator.getLookHit(camera, 10);
	const inCab = elevator.contains(camera.position.x, camera.position.z, 0.2);
	const distXZ = Math.hypot(camera.position.x - elevator.pos.x, camera.position.z - elevator.pos.z);
	const here = levelAt(feetY);
	const nearShaft = distXZ < (here === 'roof' ? 14 : 4.5);
	if (hit?.kind === 'hans' || hit?.kind === 'panel' || (inCab && hit?.kind === 'call')) return { kind: 'menu' };
	if (hit?.kind === 'call' || (nearShaft && !inCab))
		return { kind: 'call', level: hit?.kind === 'call' ? (hit.level ?? here) : here };
	return null;
}

for (const yaw of [Math.PI, 0, Math.PI / 2, -Math.PI / 2]) {
	buggy.resume({ id: '', x: elevator.pos.x, y: cabineVloer, z: elevator.pos.z, yaw, speed: 0 });
	buggy.setFloorOverride(cabineVloer);
	buggy.update(1 / 60, { throttle: 0, steer: 0, boost: false });
	const seat = buggy.getSeatPosition();
	const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
	camera.position.copy(seat);
	// Rijkoers is camera-vooruit: -(sin, cos), horizontaal.
	const fx = -Math.sin(yaw);
	const fz = -Math.cos(yaw);
	camera.lookAt(seat.x + fx, seat.y, seat.z + fz);
	const feetY = cabineVloer;
	const hit = elevator.getLookHit(camera, 10);
	const inCab = elevator.contains(seat.x, seat.z, 0.2);
	const action = elevatorAction(camera, feetY);
	const paneelWint = action?.kind === 'menu';
	console.log(
		`\nyaw=${yaw.toFixed(2)} zadel=(${seat.x.toFixed(2)}, ${seat.y.toFixed(2)}, ${seat.z.toFixed(2)}) kijkt=(${fx.toFixed(2)},0,${fz.toFixed(2)})`,
	);
	console.log(`  getLookHit=${JSON.stringify(hit)} inCab=${inCab} action=${JSON.stringify(action)} paneelWint=${paneelWint}`);
	console.log(`  → E-keten: ${paneelWint ? 'MENU opent (goed)' : 'geen menu → exitVehicle (uitstappen)'}`);
}

// Waar staat Hans / het paneel, ter controle van de fallback.
const hans = new THREE.Vector3();
elevator.group.getObjectByName('glassElevator'); // no-op, houdt group levend
console.log(
	`\ncabine y=${levelY('v0')}  (Hans/paneel staan achterin, lokaal z=-0.85 → wereld z=${(elevator.pos.z - 0.85).toFixed(2)})`,
);
void hans;
