import { feature } from 'bun:bundle';
import * as THREE from 'three';
import { shineOn } from '@/render/graphicsPrefs';

/**
 * Every lit surface in the mall is built here.
 *
 * The Glans setting decides between MeshStandardMaterial (specular highlights,
 * metalness) and MeshLambertMaterial (a dot product, no highlights). Reading it
 * once at module load and constructing the chosen class directly is the whole
 * point: an earlier version built the Standard material everywhere and then
 * walked the finished scene swapping ~3000 of them for Lambert ones, which
 * allocated the expensive material twice over on exactly the machines that
 * picked the cheap one.
 *
 * Lambert has no `roughness` or `metalness`, so those are dropped when it wins.
 * Everything else in the parameters carries over untouched.
 */
/**
 * `FORCE_LAMBERT` settles it at build time and takes the PBR branch out of the
 * bundle entirely, for a target that will never want it. Without the flag the
 * player decides and both branches ship.
 */
const SHINE = feature('FORCE_LAMBERT') ? false : shineOn();

/** What a caller may ask for. A superset: the PBR fields are dropped without it. */
export type LitParams = THREE.MeshStandardMaterialParameters;

export type LitMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

/**
 * A lit surface. Use this instead of constructing a material class directly, so
 * one switch decides the shading model for the whole mall.
 */
export function lit(params: LitParams): LitMaterial {
	if (SHINE) return new THREE.MeshStandardMaterial(params);
	const { roughness, metalness, roughnessMap, metalnessMap, ...rest } = params;
	// Named so the destructure reads as intent rather than as unused bindings.
	void roughness;
	void metalness;
	void roughnessMap;
	void metalnessMap;
	return new THREE.MeshLambertMaterial(rest);
}

/** True when surfaces carry specular highlights, for code that has to branch. */
export function shineEnabled(): boolean {
	return SHINE;
}
