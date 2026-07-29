import * as THREE from 'three';
import { getInventory, type StockItem, type StockKind } from '../data/inventory';
import { type StoreDef, STORES } from '../data/stores';

const FLOOR_H = 6;

/**
 * Fills every open shop with shelves + customized stock IN the walkable interior
 * (not buried inside the back-wall mesh).
 */
export class StockDisplay {
	readonly group = new THREE.Group();
	readonly registers = new Map<string, THREE.Group>();
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'stock';
		for (const store of STORES) {
			if (store.id === 'info') continue;
			const inv = getInventory(store.id);
			if (!inv) {
				console.warn('[stock] missing inventory for', store.id);
				continue;
			}
			this.buildStoreStock(store, inv.items, inv.slogan);
		}
	}

	flashSale(storeId: string): void {
		const reg = this.registers.get(storeId);
		if (!reg) return;
		const light = reg.userData.saleLight as THREE.PointLight | undefined;
		if (light) {
			light.intensity = 8;
			setTimeout(() => {
				light.intensity = 0.5;
			}, 450);
		}
		const coins = reg.userData.coinMesh as THREE.Mesh | undefined;
		if (coins) {
			coins.visible = true;
			setTimeout(() => {
				coins.visible = false;
			}, 700);
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildStoreStock(store: StoreDef, items: StockItem[], slogan: string): void {
		const g = new THREE.Group();
		g.position.set(store.x, store.floor * FLOOR_H, store.z);
		g.rotation.y = store.rotation;
		g.name = `stock_${store.id}`;

		const w = store.width;
		const d = store.depth;

		// Interior free zone: roughly z from -0.4 to -d*0.55 (in front of solid back)
		const shelfMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0x6d5c45, roughness: 0.7, metalness: 0.08 }),
		);
		const chrome = this.track(
			new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.7, roughness: 0.35 }),
		);

		// ── Back shelves (JUST in front of back wall body) ──
		const backZ = -d * 0.48;
		const unitW = Math.min(w * 0.85, w - 0.8);
		for (let row = 0; row < 4; row++) {
			const y = 0.45 + row * 0.7;
			const board = new THREE.Mesh(new THREE.BoxGeometry(unitW, 0.07, 0.42), shelfMat);
			board.position.set(0, y, backZ);
			g.add(board);
		}
		// uprights
		for (const sx of [-unitW / 2, unitW / 2]) {
			const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.9, 0.07), chrome);
			post.position.set(sx, 1.5, backZ);
			g.add(post);
		}

		// Products on back shelves
		let idx = 0;
		for (let row = 0; row < 4; row++) {
			const y = 0.55 + row * 0.7;
			const cols = Math.min(7, items.length);
			for (let c = 0; c < cols; c++) {
				const item = items[idx % items.length];
				idx++;
				const t = cols === 1 ? 0.5 : c / (cols - 1);
				const mesh = this.makeProduct(item);
				mesh.position.set(-unitW * 0.4 + t * unitW * 0.8, y, backZ + 0.08);
				g.add(mesh);
			}
		}

		// ── Center clothing / product racks (visible from door) ──
		const rackCount = store.category === 'fashion' || store.id === 'zara' || store.id === 'hm' || store.id === 'uniqlo'
				|| store.id === 'primark'
			? 3
			: 2;
		for (let r = 0; r < rackCount; r++) {
			const rx = -w * 0.28 + r * ((w * 0.56) / Math.max(1, rackCount - 1));
			const rz = -d * 0.22;
			// chrome rail
			const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), chrome);
			const poleR = poleL.clone();
			poleL.position.set(rx - 0.55, 0.9, rz);
			poleR.position.set(rx + 0.55, 0.9, rz);
			g.add(poleL, poleR);
			const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.15, 8), chrome);
			rail.rotation.z = Math.PI / 2;
			rail.position.set(rx, 1.55, rz);
			g.add(rail);
			// hang items
			for (let h = 0; h < 5; h++) {
				const item = items[(r * 5 + h) % items.length];
				const mesh = this.makeProduct(item);
				mesh.scale.multiplyScalar(1.15);
				mesh.position.set(rx - 0.4 + h * 0.2, 1.25, rz);
				mesh.rotation.y = 0.15;
				g.add(mesh);
			}
		}

		// ── Side tables with stacks ──
		for (const side of [-1, 1] as const) {
			const table = new THREE.Mesh(
				new THREE.BoxGeometry(1.1, 0.08, 0.7),
				shelfMat,
			);
			table.position.set(side * w * 0.3, 0.75, -d * 0.18);
			g.add(table);
			const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), chrome);
			for (
				const [lx, lz] of [
					[-0.4, -0.25],
					[0.4, -0.25],
					[-0.4, 0.25],
					[0.4, 0.25],
				]
			) {
				const l = leg.clone();
				l.position.set(side * w * 0.3 + lx, 0.375, -d * 0.18 + lz);
				g.add(l);
			}
			for (let i = 0; i < 4; i++) {
				const item = items[i % items.length];
				const mesh = this.makeProduct(item);
				mesh.position.set(
					side * w * 0.3 + (i % 2) * 0.25 - 0.12,
					0.9 + Math.floor(i / 2) * 0.2,
					-d * 0.18,
				);
				g.add(mesh);
			}
		}

		// ── Floor piles near entrance (can't miss from corridor) ──
		for (let i = 0; i < 5; i++) {
			const crate = new THREE.Mesh(
				new THREE.BoxGeometry(0.55, 0.4, 0.45),
				this.track(
					new THREE.MeshStandardMaterial({
						color: new THREE.Color(store.color).offsetHSL(0, 0, 0.15),
						roughness: 0.75,
					}),
				),
			);
			crate.position.set(-1.4 + i * 0.7, 0.22, -0.55);
			g.add(crate);
			const item = items[i % items.length];
			const mesh = this.makeProduct(item);
			mesh.scale.multiplyScalar(1.35);
			mesh.position.set(-1.4 + i * 0.7, 0.55, -0.55);
			g.add(mesh);
		}

		// Slogan board above racks
		const sloganMesh = this.makeLabel(slogan, store.accent || '#fff', 2.6, 0.4);
		sloganMesh.position.set(0, 2.75, backZ + 0.15);
		g.add(sloganMesh);

		// Extra open sign hanging
		const open = this.makeLabel('● OPEN · STOCKED', '#22c55e', 1.6, 0.28);
		open.position.set(0, 3.15, -0.3);
		g.add(open);

		// Cash register
		const reg = new THREE.Group();
		reg.position.set(0.85, 0.95, -d * 0.38);
		const regBody = new THREE.Mesh(
			new THREE.BoxGeometry(0.5, 0.28, 0.38),
			this.track(new THREE.MeshStandardMaterial({ color: 0x263238, metalness: 0.5, roughness: 0.4 })),
		);
		reg.add(regBody);
		const screen = new THREE.Mesh(
			new THREE.BoxGeometry(0.38, 0.24, 0.05),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x00ff88,
					emissive: 0x00aa55,
					emissiveIntensity: 0.5,
				}),
			),
		);
		screen.position.set(0, 0.22, -0.05);
		reg.add(screen);
		const saleLight = new THREE.PointLight(0xffd700, 0.5, 5, 2);
		saleLight.position.set(0, 0.35, 0.2);
		reg.add(saleLight);
		reg.userData.saleLight = saleLight;
		const coin = new THREE.Mesh(
			new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12),
			this.track(
				new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.25 }),
			),
		);
		coin.position.set(-0.22, 0.18, 0.18);
		coin.visible = false;
		reg.add(coin);
		reg.userData.coinMesh = coin;
		const regLabel = this.makeLabel('KASSA', '#ffd700', 0.55, 0.15);
		regLabel.position.set(0, 0.4, 0.12);
		reg.add(regLabel);
		g.add(reg);
		this.registers.set(store.id, reg);

		// Soft fill light so stock is readable (esp. black Zara gear)
		const fill = new THREE.PointLight(0xfff5e6, 3.5, 9, 2);
		fill.position.set(0, 2.2, -d * 0.25);
		g.add(fill);

		this.group.add(g);
	}

	private makeProduct(item: StockItem): THREE.Mesh {
		const s = item.size ?? 1;
		// Lift pure black so Zara stock is visible
		let col = new THREE.Color(item.color);
		if (col.r + col.g + col.b < 0.25) {
			col = new THREE.Color(0x3a3a3a);
		}
		const mat = this.track(
			new THREE.MeshStandardMaterial({
				color: col,
				roughness: 0.5,
				metalness: item.kind === 'device' ? 0.55 : 0.12,
				emissive: col,
				emissiveIntensity: 0.06,
			}),
		);
		return new THREE.Mesh(this.geoFor(item.kind, s), mat);
	}

	private geoFor(kind: StockKind, s: number): THREE.BufferGeometry {
		switch (kind) {
			case 'bottle':
				return new THREE.CylinderGeometry(0.07 * s, 0.08 * s, 0.32 * s, 8);
			case 'can':
				return new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.18 * s, 10);
			case 'bag':
				return new THREE.BoxGeometry(0.18 * s, 0.22 * s, 0.09 * s);
			case 'device':
				return new THREE.BoxGeometry(0.24 * s, 0.16 * s, 0.05 * s);
			case 'shoe':
				return new THREE.BoxGeometry(0.2 * s, 0.09 * s, 0.12 * s);
			case 'garment':
				return new THREE.BoxGeometry(0.22 * s, 0.28 * s, 0.07 * s);
			case 'sphere':
				return new THREE.SphereGeometry(0.1 * s, 10, 10);
			case 'book':
				return new THREE.BoxGeometry(0.15 * s, 0.2 * s, 0.04 * s);
			case 'box':
			default:
				return new THREE.BoxGeometry(0.18 * s, 0.18 * s, 0.14 * s);
		}
	}

	private makeLabel(text: string, color: string, w: number, h: number): THREE.Mesh {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 128;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#111';
		ctx.fillRect(0, 0, 512, 128);
		ctx.fillStyle = color.startsWith('#') ? color : '#ffffff';
		ctx.font = 'bold 34px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text.slice(0, 32), 256, 64);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Mesh(
			new THREE.PlaneGeometry(w, h),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
	}
}
