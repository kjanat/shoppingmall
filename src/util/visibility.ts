/**
 * Per-deck visibility for the sprites that ignore the depth buffer.
 *
 * Name plates and speech bubbles draw with `depthTest: false`, so the floor-1
 * slab does not hide the ones standing on the begane grond. Nothing else can
 * cull them either, because the deck an object is on is a property of the
 * world, not of the material. So they say so themselves, once, at build time,
 * and the frame loop hides everything that is not on the viewer's deck.
 *
 * A registry instead of `scene.traverse()`: the pass runs every frame over
 * thousands of objects otherwise, and only a couple dozen ever opt in.
 */
import * as THREE from 'three';
import { type LevelId, levelAt } from '@/data/levels';

const culled: THREE.Object3D[] = [];

/** Reused: the pass runs per frame over the whole registry. */
const worldPos = new THREE.Vector3();

/** Opt in: this object is only visible while the player is on its deck. */
export function tagLevelCulled(obj: THREE.Object3D): void {
	culled.push(obj);
}

/** Hide every registered object that is not on the viewer's deck. */
export function cullByLevel(viewer: LevelId): void {
	for (const obj of culled) {
		obj.getWorldPosition(worldPos);
		obj.visible = levelAt(worldPos.y) === viewer;
	}
}

/** Drop every registration, for scene teardown. */
export function clearLevelCulled(): void {
	culled.length = 0;
}
