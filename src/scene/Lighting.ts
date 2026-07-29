import * as THREE from 'three';

/**
 * Bright, readable night-mall lighting.
 * Fog is mild linear so zooming out never eats the whole building.
 */
export function setupLighting(scene: THREE.Scene): void {
	scene.background = new THREE.Color(0x0b1020);
	// Linear fog: only far distance, mall stays readable
	scene.fog = new THREE.Fog(0x0b1020, 90, 180);

	// Base fill — scene must be readable without relying on neon alone
	const ambient = new THREE.AmbientLight(0xb0c4e8, 1.15);
	scene.add(ambient);

	const hemi = new THREE.HemisphereLight(0xdde8ff, 0x3a3048, 0.85);
	scene.add(hemi);

	// Main key from above-front
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(18, 50, 28);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.camera.near = 1;
	key.shadow.camera.far = 140;
	key.shadow.camera.left = -55;
	key.shadow.camera.right = 55;
	key.shadow.camera.top = 45;
	key.shadow.camera.bottom = -45;
	key.shadow.bias = -0.00025;
	scene.add(key);

	// Soft fill opposite
	const fill = new THREE.DirectionalLight(0xaaccff, 0.55);
	fill.position.set(-25, 30, -15);
	scene.add(fill);

	// Atrium downlight
	const atrium = new THREE.PointLight(0xcce6ff, 40, 55, 1.4);
	atrium.position.set(0, 16, 0);
	scene.add(atrium);

	// Corridor washes so walls/stores read
	const washN = new THREE.PointLight(0xfff0dd, 18, 40, 1.6);
	washN.position.set(0, 5, -14);
	scene.add(washN);

	const washS = new THREE.PointLight(0xfff0dd, 18, 40, 1.6);
	washS.position.set(0, 5, 14);
	scene.add(washS);

	const washN1 = new THREE.PointLight(0xfff0dd, 14, 36, 1.6);
	washN1.position.set(0, 11, -14);
	scene.add(washN1);

	const washS1 = new THREE.PointLight(0xfff0dd, 14, 36, 1.6);
	washS1.position.set(0, 11, 14);
	scene.add(washS1);

	// Accent neons (subtle — not the only light)
	const neonA = new THREE.PointLight(0x00ffc8, 8, 28, 2);
	neonA.position.set(-22, 4, 0);
	scene.add(neonA);

	const neonB = new THREE.PointLight(0xff4d6d, 6, 26, 2);
	neonB.position.set(22, 4, 0);
	scene.add(neonB);
}
