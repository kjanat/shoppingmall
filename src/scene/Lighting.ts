import * as THREE from 'three';

export function setupLighting(scene: THREE.Scene): {
	ambient: THREE.AmbientLight;
	key: THREE.DirectionalLight;
	fill: THREE.DirectionalLight;
	atrium: THREE.PointLight;
} {
	scene.background = new THREE.Color(0x05050c);
	scene.fog = new THREE.FogExp2(0x05050c, 0.012);

	const ambient = new THREE.AmbientLight(0x334466, 0.45);
	scene.add(ambient);

	const key = new THREE.DirectionalLight(0xaaccff, 0.9);
	key.position.set(20, 40, 10);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.camera.near = 1;
	key.shadow.camera.far = 120;
	key.shadow.camera.left = -50;
	key.shadow.camera.right = 50;
	key.shadow.camera.top = 40;
	key.shadow.camera.bottom = -40;
	key.shadow.bias = -0.0002;
	scene.add(key);

	const fill = new THREE.DirectionalLight(0xff66aa, 0.25);
	fill.position.set(-15, 20, -10);
	scene.add(fill);

	// Moonlight through skylight
	const atrium = new THREE.PointLight(0x88ccff, 8, 40, 1.5);
	atrium.position.set(0, 14, 0);
	scene.add(atrium);

	// Rim neon accents
	const neonA = new THREE.PointLight(0x00ffc8, 3, 30, 2);
	neonA.position.set(-25, 3, 0);
	scene.add(neonA);

	const neonB = new THREE.PointLight(0xff2d55, 2.5, 28, 2);
	neonB.position.set(25, 3, 0);
	scene.add(neonB);

	const neonC = new THREE.PointLight(0x00a8ff, 2, 25, 2);
	neonC.position.set(0, 8, -20);
	scene.add(neonC);

	// Hemisphere for soft night bounce
	const hemi = new THREE.HemisphereLight(0x1a2040, 0x0a0a12, 0.5);
	scene.add(hemi);

	return { ambient, key, fill, atrium };
}
