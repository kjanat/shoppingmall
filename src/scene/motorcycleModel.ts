import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { LitMaterial } from '#/render/material';
import { lit } from '#/render/material';

/**
 * Het Blender-model van de motor (assets/motorcycle.blend, geëxporteerd naar
 * public/models/motorcycle.glb). Eén keer geladen vóór App construeert, want de
 * SceneBatcher bakt in de constructor en een mesh die daarna nog omruilt blijft
 * als oude kopie in de batch staan. Headless (tests, probes) laadt niemand dit
 * en valt elke bouwer terug op de procedurele motor uit dezelfde spec.
 */

const MODEL_URL = '/models/motorcycle.glb';

let template: THREE.Group | null = null;

/** Waar de export zijn wielonderdelen aan herkent; de spin draait ze per frame om hun as. */
const WHEEL_PREFIXES = ['wiel_voor', 'wiel_achter'] as const;

/** Het geverfde deel: elke kloon krijgt hiervan zijn eigen getinte exemplaar. */
const PAINT_NAME = 'paint';

function convertMaterial(source: THREE.Material, cache: Map<string, LitMaterial>): LitMaterial {
	const cached = cache.get(source.uuid);
	if (cached) return cached;
	const standard = source instanceof THREE.MeshStandardMaterial ? source : null;
	const converted = lit({
		name: source.name,
		color: standard?.color ?? new THREE.Color(0xffffff),
		roughness: standard?.roughness ?? 0.8,
		metalness: standard?.metalness ?? 0,
		emissive: standard?.emissive ?? new THREE.Color(0x000000),
		emissiveIntensity: standard?.emissiveIntensity ?? 1,
	});
	cache.set(source.uuid, converted);
	return converted;
}

/**
 * Laad en converteer het model. De materialen gaan door `lit()` zodat de
 * Glans-stand ook hier beslist, en de wielonderdelen krijgen dezelfde
 * `isWheel`-markering die de procedurele bouwer zet.
 */
export async function preloadMotorcycleModel(): Promise<void> {
	if (template) return;
	const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
	const cache = new Map<string, LitMaterial>();
	gltf.scene.traverse((object) => {
		if (WHEEL_PREFIXES.some((prefix) => object.name.startsWith(prefix))) object.userData['isWheel'] = true;
		if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) {
			object.material = convertMaterial(object.material, cache);
		}
	});
	template = gltf.scene;
}

/**
 * Een kloon van het geladen model in deze kleur, of null zolang er niets geladen
 * is. Geometrie en de niet-geverfde materialen blijven gedeeld; alleen het
 * lakwerk wordt per motor gekloond en getint.
 */
export function motorcycleModelClone(color: number, track: <T extends THREE.Material>(material: T) => T): THREE.Group | null {
	if (!template) return null;
	const bike = template.clone(true);
	const tinted = new Map<string, THREE.Material>();
	bike.traverse((object) => {
		if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.Material)) return;
		if (object.material.name !== PAINT_NAME) return;
		let paint = tinted.get(object.material.uuid);
		if (!paint) {
			paint = object.material.clone();
			if ('color' in paint && paint.color instanceof THREE.Color) paint.color.set(color);
			tinted.set(object.material.uuid, paint);
			track(paint);
		}
		object.material = paint;
	});
	return bike;
}
