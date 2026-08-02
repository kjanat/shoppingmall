/**
 * Per-deck visibility for the floating labels: name plates and speech bubbles.
 *
 * They do depth test, so a slab between the viewer and a label already hides
 * it. The atrium is the hole in that argument, literally: over the void, and
 * over every balustrade, there is no slab in between, so a plate two decks
 * down draws exactly as if it stood next to you. Depth cannot settle it
 * either, because the deck an object is on is a property of the world, not of
 * the material. So they say so themselves, once, at build time, and the frame
 * loop hides everything that is not on the viewer's deck.
 *
 * A registry instead of `scene.traverse()`: the pass runs every frame over
 * thousands of objects otherwise, and only the labels ever opt in.
 *
 * Een eis bovenop het dek (een ballon alleen tonen als de speler hem kan lezen)
 * hoort niet in deze pass: die kent de kijker alleen als dek, niet als plek.
 * Hang zoiets aan een kind van het getagde object, en haal het dekdeel hier op
 * via `isOnViewerLevel` in plaats van het een tweede keer uit te rekenen.
 */
import * as THREE from 'three';
import { type LevelId, levelAt } from '@/data/levels';

const culled: THREE.Object3D[] = [];

/** Reused: the pass runs per frame over the whole registry. */
const worldPos = new THREE.Vector3();

/**
 * Opt in: this object is only visible while the player is on its deck.
 *
 * The pass owns `visible` and re-reads the world position every frame, so
 * things that walk between decks are fine. Tag a holder that sits at deck
 * height, not a sprite hanging metres above it, and not one whose `visible`
 * already has an owner of its own.
 */
export function tagLevelCulled(obj: THREE.Object3D): void {
	culled.push(obj);
}

/**
 * Staat dit object op het dek van de kijker?
 *
 * Precies de vraag die de pass hieronder per frame stelt, en daarom het enige
 * antwoord: een tweede uitwerking gaat vroeg of laat van een andere hoogte uit
 * dan de wereldpositie van het object en spreekt de pass dan tegen. Dat is wat
 * een sim halverwege de roltrap laat flikkeren.
 */
export function isOnViewerLevel(obj: THREE.Object3D, viewer: LevelId): boolean {
	obj.getWorldPosition(worldPos);
	return levelAt(worldPos.y) === viewer;
}

/** Hide every registered object that is not on the viewer's deck. */
export function cullByLevel(viewer: LevelId): void {
	for (const obj of culled) obj.visible = isOnViewerLevel(obj, viewer);
}
