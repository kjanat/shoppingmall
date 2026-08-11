import type * as THREE from 'three';

/** De naam waaronder alles valt dat nergens onder een benoemde groep hangt. */
export const UNOWNED = '(naamloos)';

/**
 * Welke feature dit object gebouwd heeft.
 *
 * De hoogste benoemde voorouder onder de scene, dus `mall` en niet `store_kruidvat`,
 * `city_traffic` en niet de auto erin. Eén regel per feature is wat een cull-telling
 * leesbaar maakt; per onderdeel zijn het duizenden regels en per batch is het één
 * hoop, want een statische batch voegt bronnen van meerdere features samen.
 *
 * De wortel zelf telt niet mee: dat is de scene, en die is van iedereen.
 */
export function ownerName(object: THREE.Object3D): string {
	let owner = '';
	for (let node: THREE.Object3D = object; node.parent; node = node.parent) {
		if (node.name !== '') owner = node.name;
	}
	return owner === '' ? UNOWNED : owner;
}
