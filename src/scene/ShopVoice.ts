import * as THREE from 'three';
import { speakLine } from '../audio/ElevenVoice';
import { getOwner, type ShopOwner } from '../data/shopOwners';
import { STORES } from '../data/stores';

type KeeperSpeech = {
	storeId: string;
	group: THREE.Group;
	sprite: THREE.Sprite;
	tex: THREE.CanvasTexture;
	ctx: CanvasRenderingContext2D;
	life: number;
	/** world position cache */
	worldPos: THREE.Vector3;
};

/**
 * Shopkeepers who actually talk (ElevenLabs) + speech bubbles over the counter.
 * Youssef Benali @ Kruidvat is the hero greeter.
 */
export class ShopVoice {
	private keepers = new Map<string, KeeperSpeech>();
	private speaking = false;
	private lastSpeakAt = new Map<string, number>();
	private greeted = new Set<string>();
	private materials: THREE.Material[] = [];

	/** Call after MallBuilder.build() — find keeper_* groups */
	bindFromMall(mallGroup: THREE.Object3D): void {
		mallGroup.traverse((obj) => {
			if (!(obj instanceof THREE.Group)) return;
			if (!obj.name.startsWith('keeper_')) return;
			const storeId = obj.name.replace('keeper_', '');
			this.attachSpeech(storeId, obj);
		});
	}

	private attachSpeech(storeId: string, group: THREE.Group): void {
		const c = document.createElement('canvas');
		c.width = 400;
		c.height = 100;
		const ctx = c.getContext('2d')!;
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const mat = new THREE.SpriteMaterial({
			map: tex,
			transparent: true,
			depthTest: false,
			visible: false,
		});
		this.materials.push(mat);
		const sprite = new THREE.Sprite(mat);
		sprite.scale.set(2.8, 0.7, 1);
		sprite.position.set(0, 2.55, 0.2);
		sprite.visible = false;
		group.add(sprite);
		this.keepers.set(storeId, {
			storeId,
			group,
			sprite,
			tex,
			ctx,
			life: 0,
			worldPos: new THREE.Vector3(),
		});
	}

	update(dt: number): void {
		for (const k of this.keepers.values()) {
			if (k.life > 0) {
				k.life -= dt;
				if (k.life <= 0) {
					k.sprite.visible = false;
					(k.sprite.material as THREE.SpriteMaterial).visible = false;
				}
			}
		}
	}

	/** World position of a store counter (for proximity) */
	getKeeperWorldPos(storeId: string): THREE.Vector3 | null {
		const k = this.keepers.get(storeId);
		if (!k) return null;
		k.group.getWorldPosition(k.worldPos);
		return k.worldPos.clone();
	}

	/** Distance from player to Youssef / any keeper */
	distanceTo(storeId: string, player: THREE.Vector3): number {
		const p = this.getKeeperWorldPos(storeId);
		if (!p) {
			const store = STORES.find((s) => s.id === storeId);
			if (!store) return Infinity;
			return Math.hypot(player.x - store.x, player.z - store.z);
		}
		return Math.hypot(player.x - p.x, player.z - p.z);
	}

	showBubble(storeId: string, text: string, life = 4.5): void {
		const k = this.keepers.get(storeId);
		if (!k) return;
		const ctx = k.ctx;
		const w = 400;
		const h = 100;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = 'rgba(255,255,255,0.97)';
		ctx.beginPath();
		ctx.roundRect?.(8, 8, w - 16, h - 16, 14);
		if (typeof ctx.roundRect === 'function') ctx.fill();
		else ctx.fillRect(8, 8, w - 16, h - 16);
		ctx.strokeStyle = storeId === 'kruidvat' ? '#00a651' : '#334155';
		ctx.lineWidth = 3;
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(8, 8, w - 16, h - 16, 14);
			ctx.stroke();
		} else ctx.strokeRect(8, 8, w - 16, h - 16);

		const owner = getOwner(storeId);
		const label = owner?.name.split(' ')[0] ?? 'Verkoper';
		ctx.fillStyle = storeId === 'kruidvat' ? '#15803d' : '#0f172a';
		ctx.font = '700 14px system-ui,sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(label, 22, 32);

		ctx.fillStyle = '#0f172a';
		ctx.font = '600 16px system-ui,sans-serif';
		ctx.textAlign = 'center';
		// two-line wrap
		const words = text.split(' ');
		let l1 = '';
		let l2 = '';
		for (const word of words) {
			const t = (l1 ? l1 + ' ' : '') + word;
			if (ctx.measureText(t).width < w - 48 && !l2) l1 = t;
			else l2 = (l2 ? l2 + ' ' : '') + word;
		}
		if (l2) {
			ctx.fillText(l1.slice(0, 44), w / 2, 58);
			ctx.fillText(l2.slice(0, 44), w / 2, 80);
		} else {
			ctx.fillText(l1.slice(0, 48), w / 2, 68);
		}
		k.tex.needsUpdate = true;
		k.sprite.visible = true;
		(k.sprite.material as THREE.SpriteMaterial).visible = true;
		k.life = life;
	}

	/**
	 * Speak as shop owner — bubble + ElevenLabs.
	 * Throttled per store so checkouts don't spam the API.
	 */
	async speak(storeId: string, text?: string, opts: { force?: boolean; minGapMs?: number } = {}): Promise<void> {
		const owner = getOwner(storeId);
		if (!owner) return;
		const now = performance.now();
		const gap = opts.minGapMs ?? 6000;
		const last = this.lastSpeakAt.get(storeId) ?? 0;
		if (!opts.force && now - last < gap) return;
		if (this.speaking && !opts.force) return;

		const line = text ?? owner.lines[Math.floor(Math.random() * owner.lines.length)] ?? 'Welkom!';

		this.lastSpeakAt.set(storeId, now);
		this.speaking = true;
		this.showBubble(storeId, line, Math.min(7, 2.5 + line.length * 0.05));

		try {
			await speakLine(line, {
				volume: 0.92,
				voiceId: owner.voiceId,
				lang: owner.lang,
				allowBrowser: false,
			});
		} finally {
			this.speaking = false;
		}
	}

	/** First-time walk-up greeting (once per store visit session) */
	async greetIfNear(storeId: string, player: THREE.Vector3, radius = 5.5): Promise<boolean> {
		if (this.greeted.has(storeId)) return false;
		if (this.distanceTo(storeId, player) > radius) return false;
		// Floor check: kruidvat is floor 1
		const store = STORES.find((s) => s.id === storeId);
		if (store && store.floor === 1 && player.y < 4) return false;
		if (store && store.floor === 0 && player.y > 4) return false;

		this.greeted.add(storeId);
		const owner = getOwner(storeId);
		if (!owner) return false;

		// Youssef: full intro with his own voice + NL language hint
		if (storeId === 'kruidvat') {
			await this.speak(
				storeId,
				'Marhaba! Welkom bij Kruidvat. Ik ben Youssef Benali, filiaalmanager. Wat mag het zijn — vitamines, shampoo, of gewoon een praatje?',
				{ force: true, minGapMs: 0 },
			);
		} else {
			await this.speak(storeId, owner.lines[0], { force: true, minGapMs: 0 });
		}
		return true;
	}

	/** Player pressed E near a shop */
	async talkNear(player: THREE.Vector3, radius = 6): Promise<ShopOwner | null> {
		let best: string | null = null;
		let bestD = radius;
		for (const id of this.keepers.keys()) {
			const d = this.distanceTo(id, player);
			const store = STORES.find((s) => s.id === id);
			if (store?.floor === 1 && player.y < 4) continue;
			if (store?.floor === 0 && player.y > 4.5) continue;
			if (d < bestD) {
				bestD = d;
				best = id;
			}
		}
		if (!best) return null;
		const owner = getOwner(best);
		if (!owner) return null;
		await this.speak(best, undefined, { force: true, minGapMs: 0 });
		return owner;
	}

	/** Checkout at kassa — owner reacts (throttled) */
	async onCheckout(storeId: string): Promise<void> {
		const owner = getOwner(storeId);
		if (!owner) return;
		// Prefer checkout-flavoured lines for Youssef
		if (storeId === 'kruidvat') {
			const lines = [
				'Kassa is open — drie voor de prijs, wallah!',
				'Dankjewel! Yallah, fijne dag nog.',
				'Vitamines in de tas? Perfect. Tot de volgende.',
				'Marhaba nogmaals, en let op de roltrap he.',
			];
			await this.speak(storeId, lines[Math.floor(Math.random() * lines.length)], { minGapMs: 8000 });
		} else {
			await this.speak(storeId, undefined, { minGapMs: 10000 });
		}
	}
}
