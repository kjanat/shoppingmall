import * as THREE from 'three';
import type { MotorcycleSpot } from '#/data/world';
import { MOTORCYCLE_SPEC } from '#/data/world';
import { lit } from '#/render/material';
import { at } from '#/util/rand';

/**
 * De stilstaande motoren: de rijen in de parkeervakken op P1 en de twee showmodellen
 * in de hal van de hoofdingang.
 *
 * Waar ze staan komt uit het wereldmodel, want daar staan hun volumes ook, en
 * `controleParkeerplekken` en check-props rekenen op diezelfde lijst. De motor die de
 * speler wegrijdt wordt door DriveableCars gebouwd, uit dezelfde `MOTORCYCLE_SPEC`.
 */

const PAINT = [0x37474f, 0xb71c1c, 0x1b5e20, 0x37474f, 0x0d47a1, 0x4e342e] as const;

export function motorcycleMesh(color: number, track: <T extends THREE.Material>(material: T) => T): THREE.Group {
	const { body, seat, wheel, bars, headlight } = MOTORCYCLE_SPEC;
	const group = new THREE.Group();

	const paint = track(lit({ color, roughness: 0.4, metalness: 0.5 }));
	const rubber = track(lit({ color: 0x101114, roughness: 0.9 }));
	const chrome = track(lit({ color: 0xb0bec5, roughness: 0.25, metalness: 0.8 }));
	const lamp = track(new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }));

	const tank = new THREE.Mesh(new THREE.BoxGeometry(body.width, body.height, body.length), paint);
	tank.position.y = body.centerY;
	group.add(tank);

	const saddle = new THREE.Mesh(new THREE.BoxGeometry(seat.width, seat.height, seat.length), rubber);
	saddle.position.set(0, seat.centerY, seat.offsetZ);
	group.add(saddle);

	for (const side of [-1, 1] as const) {
		const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheel.radius, wheel.radius, wheel.width, 12), rubber);
		tyre.rotation.z = Math.PI / 2;
		tyre.position.set(0, wheel.radius, side * wheel.offsetZ);
		tyre.userData['isWheel'] = true;
		group.add(tyre);
	}

	const handlebar = new THREE.Mesh(new THREE.BoxGeometry(bars.width, bars.thickness, bars.thickness), chrome);
	handlebar.position.set(0, bars.centerY, bars.offsetZ);
	group.add(handlebar);

	const koplamp = new THREE.Mesh(new THREE.SphereGeometry(headlight.radius, 10, 8), lamp);
	koplamp.position.set(0, headlight.centerY, headlight.offsetZ);
	group.add(koplamp);

	return group;
}

export class Motorcycles {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];

	constructor(spots: readonly MotorcycleSpot[], name = 'motorcycles') {
		this.group.name = name;
		spots.forEach((spot, index) => {
			const bike = motorcycleMesh(at(PAINT, index), (material) => this.track(material));
			bike.position.set(spot.x, spot.y, spot.z);
			bike.rotation.y = spot.yaw;
			this.group.add(bike);
		});
	}

	dispose(): void {
		for (const material of this.materials) material.dispose();
		this.group.clear();
	}

	private track<T extends THREE.Material>(material: T): T {
		this.materials.push(material);
		return material;
	}
}
