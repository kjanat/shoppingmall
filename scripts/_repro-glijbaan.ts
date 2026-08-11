import { stubDocument } from './stub-dom.ts';

stubDocument();
const noop = (): void => {};
const g = globalThis as unknown as { window: unknown; document: Record<string, unknown> };
g.window = { addEventListener: noop, removeEventListener: noop };
g.document['addEventListener'] = noop;
g.document['removeEventListener'] = noop;
g.document['pointerLockElement'] = null;
g.document['body'] = { addEventListener: noop, removeEventListener: noop };
const [THREE, { CollisionWorld }, { PlayerControls }, levels, zones, roof] = await Promise.all([
	import('three'),
	import('#/physics/Collision'),
	import('#/player/Controls'),
	import('#/data/levels'),
	import('#/data/zones'),
	import('#/scene/RoofIsland'),
]);

const { levelAt } = levels;
const { zoneAt, deckAt } = zones;

console.log('=== FIX-VERIFICATIE #23 (kuip = roof) ===');
const CROUCH_EYE = 0.98;
const poses: [string, number, number, number][] = [
	// naam, x, z, camera-y
	['diep, staand (cam 14.36)', -22.3, 0.9, 12.9 + 1.68 - 0.22],
	['diep, gehurkt (cam 13.66)', -22.3, 0.9, 12.9 + CROUCH_EYE - 0.22],
	['diep, cam net onder drempel', -22.3, 0.9, 13.2],
];
for (const [naam, px, pz, cy] of poses) {
	console.log(`${naam}: zoneAt=${zoneAt(px, cy, pz)} deckAt=${deckAt(px, 12.9, pz)} | rauw levelAt(feet 12.9)=${levelAt(12.9)}`);
}
// Niet-overreiken: een drone op V1-hoogte onder het dak, in de bad-XZ maar veel lager.
console.log(`drone onder dak (V1-hoogte, bad-XZ): zoneAt(-22.3, 8, 0.9)=${zoneAt(-22.3, 8, 0.9)} (moet mall-v1)`);
console.log('');

console.log('DECK_Y', levels.levelY('roof'));
console.log('POOL_WATER_Y', roof.POOL_WATER_Y, 'POOL_FLOOR_Y', roof.POOL_FLOOR_Y);
console.log('roof band lower threshold', levels.levelBand('roof').minY);

const world = new CollisionWorld();
const cam = new THREE.PerspectiveCamera(70, 1.7, 0.1, 1000);
// Boven het diepe van het dakbad, net boven de waterlijn.
cam.position.set(-20, roof.POOL_WATER_Y + 1.6, 2);
cam.lookAt(-30, roof.POOL_WATER_Y, 2);
const player = new PlayerControls(cam, document.body as unknown as HTMLElement, world);

for (let f = 0; f < 240; f++) {
	player.update(1 / 60);
}

console.log('--- direct pool queries ---');
console.log('inPool(-20,2)', roof.inPool(-20, 2), 'poolFloorY(-20,2)', roof.poolFloorY(-20, 2));
console.log('groundHeightAt(-20,2, 13.9)', world.groundHeightAt(-20, 2, 13.9));
console.log('waterDepthAt(-20,2, 12.9)', world.waterDepthAt(-20, 2, 12.9));

const EYE = 1.68;
const WADE_DEEP = 1.15;
const WADE_SINK = 0.22;
console.log('--- classification across pool depth (feet -> reads) ---');
for (const feetY of [13.95, 13.6, 13.45, 13.2, 12.9]) {
	const wade = roof.POOL_WATER_Y - feetY;
	const wadeT = Math.min(1, wade / WADE_DEEP);
	const camY = feetY + EYE - wadeT * WADE_SINK;
	console.log(
		`feet ${feetY.toFixed(2)} camY ${camY.toFixed(3)} | levelAt(feet)=${levelAt(feetY)} levelAt(cam)=${levelAt(camY)} zoneAt(cam)=${zoneAt(-20, camY, 2)} waterline(feet+wade)=${levelAt(feetY + wade)}`,
	);
}

const feet = player.feetHeight;
const camY = cam.position.y;
console.log('--- settled in deep end ---');
console.log('feetY', feet.toFixed(3), 'camera.y', camY.toFixed(3));
console.log('player.level (waterline)', player.level);
console.log('levelAt(feetY)          ', levelAt(feet));
console.log('levelAt(camera.y)       ', levelAt(camY));
console.log('zoneAt(camera)          ', zoneAt(cam.position.x, camY, cam.position.z));
console.log('zoneAt(feet)            ', zoneAt(cam.position.x, feet, cam.position.z));
