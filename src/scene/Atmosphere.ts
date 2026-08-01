import * as THREE from 'three';
import type { CollisionWorld } from '@/physics/Collision';
import { labelCanvas, labelTexture } from '@/util/label';
import { Americans } from './Americans';

/**
 * Mall ambient: Americans + calm ads. No dust particles, no pulsing emissives.
 */
export class Atmosphere {
	readonly group = new THREE.Group();
	readonly americans: Americans;

	constructor(world: CollisionWorld) {
		this.americans = new Americans(world, 14);
		this.group.add(this.americans.group);
		this.createBillboards();
	}

	update(dt: number, playerPos?: THREE.Vector3): void {
		this.americans.update(dt, playerPos);
	}

	private createBillboards(): void {
		const ads = [
			{ text: 'FOOD COURT\nOpen late', color: '#c45c26', bg: '#fff8f0', x: -34, y: 4, z: -8 },
			{ text: 'PARKING\nLevel B2', color: '#1a5276', bg: '#f0f4f8', x: 34, y: 4, z: 8 },
			{ text: 'TODAY ONLY\n-30% shoes', color: '#922b21', bg: '#fff5f5', x: -34, y: 10, z: 8 },
			{ text: 'KRUIDVAT\nOpen 8–22', color: '#00a651', bg: '#ffffff', x: 34, y: 10, z: -8 },
		];

		for (const ad of ads) {
			const { canvas, ctx } = labelCanvas(512, 256);
			ctx.fillStyle = ad.bg;
			ctx.fillRect(0, 0, 512, 256);
			ctx.strokeStyle = ad.color;
			ctx.lineWidth = 10;
			ctx.strokeRect(12, 12, 488, 232);
			ctx.fillStyle = ad.color;
			ctx.font = '700 48px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const lines = ad.text.split('\n');
			lines.forEach((line, i) => {
				ctx.fillText(line, 256, 128 + (i - (lines.length - 1) / 2) * 56);
			});
			const tex = labelTexture(canvas);
			// MeshBasic — no emissive pulse / bloom flicker
			const mat = new THREE.MeshBasicMaterial({
				map: tex,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), mat);
			mesh.position.set(ad.x, ad.y, ad.z);
			mesh.lookAt(0, ad.y, 0);
			this.group.add(mesh);
		}
	}
}
