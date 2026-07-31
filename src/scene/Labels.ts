import * as THREE from 'three';
import type { StoreDef } from '../data/stores';

/** Clean mall directory labels — white pills, no neon pulse. */
export class StoreLabels {
	readonly group = new THREE.Group();

	constructor(stores: StoreDef[]) {
		this.group.name = 'storeLabels';
		for (const store of stores) {
			if (store.id === 'info') continue;
			const sprite = this.makeLabel(store);
			const y = store.floor * 6 + 5.0;
			sprite.position.set(store.x, y, store.z);
			const pull = 2.2;
			sprite.position.x += Math.sin(store.rotation) * pull;
			sprite.position.z += Math.cos(store.rotation) * pull;
			this.group.add(sprite);
		}

		this.group.add(this.makeFloorBadge('GROUND FLOOR', 0, 0.4, 0, '#334155'));
		this.group.add(this.makeFloorBadge('LEVEL 1', 0, 6.4, 0, '#1e40af'));
		this.group.add(this.makeFloorBadge('YOU ARE HERE', 0, 3.5, 10, '#dc2626'));
	}

	private makeLabel(store: StoreDef): THREE.Sprite {
		const name = store.name.replace('\n', ' ');
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 128;
		const ctx = canvas.getContext('2d')!;

		ctx.fillStyle = store.hero ? 'rgba(227, 6, 19, 0.95)' : 'rgba(255, 255, 255, 0.94)';
		roundRect(ctx, 8, 20, 496, 88, 16);
		ctx.fill();

		ctx.strokeStyle = store.hero ? '#00a651' : 'rgba(0,0,0,0.12)';
		ctx.lineWidth = store.hero ? 5 : 2;
		roundRect(ctx, 8, 20, 496, 88, 16);
		ctx.stroke();

		ctx.fillStyle = store.hero ? '#ffffff' : '#1a1a1a';
		ctx.font = `700 ${store.hero ? 42 : 38}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(name, 256, 56);

		ctx.fillStyle = store.hero ? 'rgba(255,255,255,0.85)' : '#64748b';
		ctx.font = '500 20px system-ui, sans-serif';
		ctx.fillText(`Level ${store.floor}`, 256, 88);

		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const mat = new THREE.SpriteMaterial({
			map: tex,
			transparent: true,
			depthTest: true,
			depthWrite: false,
		});
		const sprite = new THREE.Sprite(mat);
		const scale = store.hero ? 7.2 : 5.2;
		sprite.scale.set(scale, scale * 0.25, 1);
		return sprite;
	}

	private makeFloorBadge(text: string, x: number, y: number, z: number, color: string): THREE.Sprite {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 80;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgba(255,255,255,0.9)';
		roundRect(ctx, 40, 10, 432, 60, 12);
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.lineWidth = 3;
		roundRect(ctx, 40, 10, 432, 60, 12);
		ctx.stroke();
		ctx.fillStyle = color;
		ctx.font = '700 28px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 40);

		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const mat = new THREE.SpriteMaterial({
			map: tex,
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});
		const sprite = new THREE.Sprite(mat);
		sprite.position.set(x, y, z);
		sprite.scale.set(9, 1.5, 1);
		return sprite;
	}
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
