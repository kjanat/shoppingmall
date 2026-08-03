import * as THREE from 'three';
import type { LightPool } from '@/render/LightPool';

/** Turns the daylight down for the disco and puts it back exactly as it was. */
export type DaylightDimmer = {
	dimDaylight(on: boolean): void;
	/**
	 * A real light owned elsewhere that must follow the dim. The old traverse
	 * caught every light in the scene; this list is what replaces that reach —
	 * miss one and it blasts at full power through the "deep arcade night"
	 * (the catwalk spot did exactly that).
	 */
	register(light: THREE.Light, factor: number): void;
	/** Scale the everywhere-light. Live, no rebuild: it is only an intensity. */
	setFill(scale: number): void;
};

/**
 * Warm daylight American mall — no neon club vibes.
 *
 * Ambient and hemisphere are deliberately low. They light every surface from
 * every side at once, so they carry no shape at all: with 71 point lights doing
 * the local shading their flatness never showed, but at 8 pooled lights they
 * became most of the picture and the mall read as a photocopy of itself. The
 * sun and the pool do the modelling; these two only lift the shadows.
 */
export function setupLighting(scene: THREE.Scene, pool: LightPool): DaylightDimmer {
	scene.background = new THREE.Color(0xc8d4e4);
	scene.fog = new THREE.Fog(0xc8d4e4, 100, 200);

	const ambient = new THREE.AmbientLight(0xfff6e8, 0.55);
	scene.add(ambient);

	const hemi = new THREE.HemisphereLight(0xe8f0ff, 0xd4c4a8, 0.45);
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

	// The disco used to dim by traversing every light in the scene and restoring
	// from its own snapshot — which could hand a stale intensity back to a light
	// that had since changed owners. The point lights live in the pool now, so
	// the real lights that remain are dimmed here by name and restored to their
	// own captured base value. Lights owned by other files join via register().
	// `fills` marks the two that light everything from every side — the ones the
	// Zaallicht setting scales. The sun and its fill carry direction, so they
	// keep their shape whatever the player picks.
	const entries: { light: THREE.Light; factor: number; base: number; fills?: boolean }[] = [
		{ light: ambient, factor: 0.12, base: ambient.intensity, fills: true },
		{ light: hemi, factor: 0.1, base: hemi.intensity, fills: true },
		{ light: sun, factor: 0.08, base: sun.intensity },
		{ light: fill, factor: 0.08, base: fill.intensity },
	];
	let active = false;
	let fill_ = 1;
	const apply = (): void => {
		for (const e of entries) e.light.intensity = (active ? e.base * e.factor : e.base) * (e.fills ? fill_ : 1);
	};
	return {
		dimDaylight(on: boolean): void {
			active = on;
			apply();
		},
		setFill(scale: number): void {
			fill_ = scale;
			apply();
		},
		register(light: THREE.Light, factor: number): void {
			const entry = { light, factor, base: light.intensity };
			entries.push(entry);
			if (active) light.intensity = entry.base * factor;
		},
	};
}
