import * as THREE from 'three';

/** Warm daylight American mall — no neon club vibes. */
export function setupLighting(scene: THREE.Scene): void {
	scene.background = new THREE.Color(0xc8d4e4);
	scene.fog = new THREE.Fog(0xc8d4e4, 100, 200);

	const ambient = new THREE.AmbientLight(0xfff6e8, 0.95);
	scene.add(ambient);

	const hemi = new THREE.HemisphereLight(0xe8f0ff, 0xd4c4a8, 0.7);
	scene.add(hemi);

	// Soft sun through skylight
	const sun = new THREE.DirectionalLight(0xfff2dd, 1.35);
	sun.position.set(25, 55, 20);
	sun.castShadow = true;
	sun.shadow.mapSize.set(1024, 1024);
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = 140;
	sun.shadow.camera.left = -55;
	sun.shadow.camera.right = 55;
	sun.shadow.camera.top = 45;
	sun.shadow.camera.bottom = -45;
	sun.shadow.bias = -0.0003;
	scene.add(sun);

	// Soft fill
	const fill = new THREE.DirectionalLight(0xdde8ff, 0.4);
	fill.position.set(-20, 30, -15);
	scene.add(fill);

	// Even interior wash (stable — no blinking)
	const atrium = new THREE.PointLight(0xfff5e6, 25, 50, 1.5);
	atrium.position.set(0, 12, 0);
	scene.add(atrium);

	const washN = new THREE.PointLight(0xfff8ee, 12, 35, 1.8);
	washN.position.set(0, 5, -12);
	scene.add(washN);

	const washS = new THREE.PointLight(0xfff8ee, 12, 35, 1.8);
	washS.position.set(0, 5, 12);
	scene.add(washS);

	const washN1 = new THREE.PointLight(0xfff8ee, 10, 32, 1.8);
	washN1.position.set(0, 10, -12);
	scene.add(washN1);

	const washS1 = new THREE.PointLight(0xfff8ee, 10, 32, 1.8);
	washS1.position.set(0, 10, 12);
	scene.add(washS1);
}
