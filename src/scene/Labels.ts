import { Group, Sprite, SpriteMaterial } from 'three';
import { level, levelY } from '#/data/levels';
import type { StoreDef } from '#/data/stores';
import { labelCanvas, labelTexture, roundRect } from '#/util/label';
import { tagLevelCulled } from '#/util/visibility';

/** Clean mall directory labels — white pills, no neon pulse. */
export class StoreLabels {
	readonly group = new Group();

	constructor(stores: StoreDef[]) {
		this.group.name = 'storeLabels';
		for (const store of stores) {
			if (store.id === 'info') continue;
			const sprite = this.makeLabel(store);
			const y = levelY(store.level) + 5.0;
			sprite.position.set(store.x, y, store.z);
			const pull = 2.2;
			sprite.position.x += Math.sin(store.rotation) * pull;
			sprite.position.z += Math.cos(store.rotation) * pull;
			this.group.add(sprite);
			tagLevelCulled(sprite);
		}

		const ground = this.makeFloorBadge({ text: 'GROUND FLOOR', x: 0, y: 0.4, z: 0, color: '#334155' });
		const first = this.makeFloorBadge({ text: 'LEVEL 1', x: 0, y: 6.4, z: 0, color: '#1e40af' });
		this.group.add(ground, first);
		tagLevelCulled(ground);
		tagLevelCulled(first);
		// Hangs in the atrium void between two decks, so it belongs to neither.
		this.group.add(this.makeFloorBadge({ text: 'YOU ARE HERE', x: 0, y: 3.5, z: 10, color: '#dc2626' }));
	}

	private makeLabel(store: StoreDef): Sprite {
		const name = store.name.replace('\n', ' ');
		const { canvas, ctx } = labelCanvas(512, 128);

		ctx.fillStyle = store.hero ? 'rgba(227, 6, 19, 0.95)' : 'rgba(255, 255, 255, 0.94)';
		roundRect(ctx, { x: 8, y: 20, width: 496, height: 88, radius: 16 });
		ctx.fill();

		ctx.strokeStyle = store.hero ? '#00a651' : 'rgba(0,0,0,0.12)';
		ctx.lineWidth = store.hero ? 5 : 2;
		roundRect(ctx, { x: 8, y: 20, width: 496, height: 88, radius: 16 });
		ctx.stroke();

		ctx.fillStyle = store.hero ? '#ffffff' : '#1a1a1a';
		ctx.font = `700 ${store.hero ? 42 : 38}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(name, 256, 56);

		ctx.fillStyle = store.hero ? 'rgba(255,255,255,0.85)' : '#64748b';
		ctx.font = '500 20px system-ui, sans-serif';
		ctx.fillText(level(store.level).code, 256, 88);

		const tex = labelTexture(canvas);
		const mat = new SpriteMaterial({
			map: tex,
			transparent: true,
			depthTest: true,
			depthWrite: false,
		});
		const sprite = new Sprite(mat);
		const scale = store.hero ? 7.2 : 5.2;
		sprite.scale.set(scale, scale * 0.25, 1);
		return sprite;
	}

	private makeFloorBadge({ text, x, y, z, color }: { text: string; x: number; y: number; z: number; color: string }): Sprite {
		const { canvas, ctx } = labelCanvas(512, 80);
		ctx.fillStyle = 'rgba(255,255,255,0.9)';
		roundRect(ctx, { x: 40, y: 10, width: 432, height: 60, radius: 12 });
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.lineWidth = 3;
		roundRect(ctx, { x: 40, y: 10, width: 432, height: 60, radius: 12 });
		ctx.stroke();
		ctx.fillStyle = color;
		ctx.font = '700 28px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 40);

		const tex = labelTexture(canvas);
		const mat = new SpriteMaterial({
			map: tex,
			transparent: true,
			depthTest: true,
			depthWrite: false,
		});
		const sprite = new Sprite(mat);
		sprite.position.set(x, y, z);
		sprite.scale.set(9, 1.5, 1);
		return sprite;
	}
}
