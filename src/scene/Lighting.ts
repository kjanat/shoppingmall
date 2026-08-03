import * as THREE from 'three';
import type { LightPool } from '@/render/LightPool';

/** Turns the daylight down for the disco and puts it back exactly as it was. */
export type DaylightDimmer = { dimDaylight(on: boolean): void };

/** Warm daylight American mall — no neon club vibes. */
export function setupLighting(scene: THREE.Scene, pool: LightPool): DaylightDimmer {
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

	// Even interior wash (stable — no blinking). These five reach 32–50 m and are
	// what keeps the whole building lit, so they get priority 2: without it the
	// handful of 6 m shop lamps standing right next to you would win every pool
	// slot and the mall behind them would fall dark.
	pool.register({
		color: 0xfff5e6,
		intensity: 25,
		distance: 50,
		decay: 1.5,
		priority: 2,
		position: new THREE.Vector3(0, 12, 0),
	});
	for (const [y, z, intensity, distance] of [
		[5, -12, 12, 35],
		[5, 12, 12, 35],
		[10, -12, 10, 32],
		[10, 12, 10, 32],
	] as const) {
		pool.register({
			color: 0xfff8ee,
			intensity,
			distance,
			decay: 1.8,
			priority: 2,
			position: new THREE.Vector3(0, y, z),
		});
	}

	// De disco dimde vroeger via scene.traverse over álle lampen. Dat werkte
	// alleen zolang die lampen echte scene-lights waren; de puntlichten zitten nu
	// in de pool, dus de vier echte lampen die overblijven worden hier bij naam
	// gedimd en op hun eigen beginwaarde hersteld — geen zoektocht, en geen kans
	// meer om het licht van een andere feature "terug te zetten" op iets anders.
	const base = { ambient: ambient.intensity, hemi: hemi.intensity, sun: sun.intensity, fill: fill.intensity };
	return {
		dimDaylight(on: boolean): void {
			ambient.intensity = on ? base.ambient * 0.12 : base.ambient;
			hemi.intensity = on ? base.hemi * 0.1 : base.hemi;
			sun.intensity = on ? base.sun * 0.08 : base.sun;
			fill.intensity = on ? base.fill * 0.08 : base.fill;
		},
	};
}
