import type * as THREE from 'three';

/** De naam waaronder alles valt dat nergens onder een benoemde groep hangt. */
export const UNOWNED = '(naamloos)';

/**
 * Welke feature dit object gebouwd heeft, en welk onderdeel daarbinnen.
 *
 * De hoogste benoemde voorouder onder de scene plus de benoemde voorouder direct
 * daaronder, dus `mall/store_kruidvat` en niet elk schap apart. De feature blijft
 * het prefix, zodat een telling per feature optelbaar blijft; het tweede niveau
 * zegt wélke winkel of kiosk een cull overleefde. Dieper dan twee niveaus zijn
 * het duizenden regels en per batch is het één hoop, want een statische batch
 * voegt bronnen van meerdere features samen.
 *
 * De wortel zelf telt niet mee: dat is de scene, en die is van iedereen.
 */
export function ownerName(object: THREE.Object3D): string {
	let owner = '';
	let part = '';
	for (let node: THREE.Object3D = object; node.parent; node = node.parent) {
		if (node.name !== '') {
			part = owner;
			owner = node.name;
		}
	}
	if (owner === '') return UNOWNED;
	return part === '' ? owner : `${owner}/${part}`;
}
