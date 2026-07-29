import * as THREE from 'three';
import type { StoreDef } from '../data/stores';

/**
 * Always-readable floating store labels (sprites) so you know where things are
 * even from the overview camera.
 */
export class StoreLabels {
	readonly group = new THREE.Group();
	private sprites: THREE.Sprite[] = [];

	constructor(stores: StoreDef[]) {
		this.group.name = 'storeLabels';
		for (const store of stores) {
			if (store.id === 'info') continue;
			const sprite = this.makeLabel(store);
			const y = store.floor * 6 + 5.2;
			sprite.position.set(store.x, y, store.z);
			// Pull slightly into the corridor so labels aren't buried in the wall
			const pull = 2.2;
			sprite.position.x += Math.sin(store.rotation) * pull;
			sprite.position.z += Math.cos(store.rotation) * pull;
			this.group.add(sprite);
			this.sprites.push(sprite);
		}

		// Floor markers
		this.group.add(this.makeFloorBadge('BEGANE GROND', 0, 0.5, 0, 0xffffff));
		this.group.add(this.makeFloorBadge('VERDIEPING 1', 0, 6.5, 0, 0x00ffc8));
		this.group.add(this.makeFloorBadge('KIOSK · JE BENT HIER', 0, 3.6, 10, 0xff2d55));
	}

	private makeLabel(store: StoreDef): THREE.Sprite {
		const name = store.name.replace('\n', ' ');
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 128;
		const ctx = canvas.getContext('2d')!;

		// pill background
		const bg = store.hero ? 'rgba(0, 100, 50, 0.92)' : 'rgba(8, 12, 24, 0.88)';
		ctx.fillStyle = bg;
		roundRect(ctx, 8, 16, 496, 96, 20);
		ctx.fill();

		ctx.strokeStyle = store.hero ? '#00ff88' : store.accent;
		ctx.lineWidth = 4;
		roundRect(ctx, 8, 16, 496, 96, 20);
		ctx.stroke();

		ctx.fillStyle = '#ffffff';
		ctx.font = `700 ${store.hero ? 44 : 40}px Outfit, system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(name, 256, 58);

		ctx.fillStyle = store.hero ? '#9dffc8' : 'rgba(255,255,255,0.65)';
		ctx.font = '500 22px Outfit, system-ui, sans-serif';
		ctx.fillText(`V${store.floor}`, 256, 90);

		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const mat = new THREE.SpriteMaterial({
			map: tex,
			transparent: true,
			depthTest: true,
			depthWrite: false,
		});
		const sprite = new THREE.Sprite(mat);
		const scale = store.hero ? 7.5 : 5.5;
		sprite.scale.set(scale, scale * 0.25, 1);
		sprite.userData.storeId = store.id;
		return sprite;
	}

	private makeFloorBadge(
		text: string,
		x: number,
		y: number,
		z: number,
		color: number,
	): THREE.Sprite {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 96;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgba(0,0,0,0.55)';
		roundRect(ctx, 40, 12, 432, 72, 16);
		ctx.fill();
		ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
		ctx.lineWidth = 3;
		roundRect(ctx, 40, 12, 432, 72, 16);
		ctx.stroke();
		ctx.fillStyle = '#ffffff';
		ctx.font = '700 32px Outfit, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 48);

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
		sprite.scale.set(10, 1.9, 1);
		return sprite;
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
