import { getInventory, type StockItem, type StockKind } from '@/data/inventory';
import { type StoreDef, STORES } from '@/data/stores';
import { at } from '@/util/rand';
import * as THREE from 'three';

const FLOOR_H = 6;

/**
 * Stock lives in the OPEN room (between door z≈0 and back wall z≈-depth).
 * Never inside solid wall meshes.
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
			if (!inv) continue;
			this.buildStoreStock(store, inv.items, inv.slogan);
		}
	}

	flashSale(storeId: string): void {
		const reg = this.registers.get(storeId);
		if (!reg) return;
		const light = reg.userData['saleLight'] as THREE.PointLight | undefined;
		if (light) {
			light.intensity = 10;
			setTimeout(() => {
				light.intensity = 0.6;
			}, 500);
		}
		const coins = reg.userData['coinMesh'] as THREE.Mesh | undefined;
		if (coins) {
			coins.visible = true;
			setTimeout(() => {
				coins.visible = false;
			}, 800);
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
		const roomDepth = d * 0.92;
		// Open interior: z from ~-0.3 (just inside door) to ~-roomDepth+0.3 (before back wall)
		const backShelfZ = -roomDepth + 0.55;
		const midZ = -roomDepth * 0.35;

		const shelfMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6d5c45, roughness: 0.7 }));
		const chrome = this.track(new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.75, roughness: 0.3 }));

		// Back shelving (IN FRONT of back wall — fully visible)
		const unitW = w * 0.82;
		for (let row = 0; row < 4; row++) {
			const y = 0.5 + row * 0.72;
			const board = new THREE.Mesh(new THREE.BoxGeometry(unitW, 0.08, 0.4), shelfMat);
			board.position.set(0, y, backShelfZ);
			g.add(board);
		}

		let idx = 0;
		for (let row = 0; row < 4; row++) {
			const y = 0.62 + row * 0.72;
			const cols = 6;
			for (let c = 0; c < cols; c++) {
				const item = at(items, idx);
				idx++;
				const t = c / (cols - 1);
				const mesh = this.makeProduct(item);
				mesh.position.set(-unitW * 0.38 + t * unitW * 0.76, y, backShelfZ + 0.12);
				g.add(mesh);
			}
		}

		// Center racks (fashion) / island displays
		const islands = 3;
		for (let r = 0; r < islands; r++) {
			const rx = -w * 0.28 + r * ((w * 0.56) / Math.max(1, islands - 1));
			const rz = midZ;
			const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), chrome);
			const poleR = poleL.clone();
			poleL.position.set(rx - 0.5, 0.85, rz);
			poleR.position.set(rx + 0.5, 0.85, rz);
			g.add(poleL, poleR);
			const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 8), chrome);
			rail.rotation.z = Math.PI / 2;
			rail.position.set(rx, 1.5, rz);
			g.add(rail);
			for (let h = 0; h < 5; h++) {
				const item = at(items, r * 5 + h);
				const mesh = this.makeProduct(item);
				mesh.scale.multiplyScalar(1.2);
				mesh.position.set(rx - 0.38 + h * 0.19, 1.15, rz + 0.05);
				g.add(mesh);
			}
		}

		// Front tables — right at the entrance so you SEE stock from the corridor
		for (let i = 0; i < 4; i++) {
			const tx = -1.2 + i * 0.85;
			const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.55), shelfMat);
			table.position.set(tx, 0.7, -0.85);
			g.add(table);
			const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.07), chrome);
			for (const [lx, lz] of [
				[-0.25, -0.18],
				[0.25, -0.18],
				[-0.25, 0.18],
				[0.25, 0.18],
			] as const) {
				const l = leg.clone();
				l.position.set(tx + lx, 0.35, -0.85 + lz);
				g.add(l);
			}
			const item = at(items, i);
			const p = this.makeProduct(item);
			p.scale.multiplyScalar(1.4);
			p.position.set(tx, 0.9, -0.85);
			g.add(p);
		}

		// Slogan facing out into room
		const sloganMesh = this.makeLabel(slogan, store.accent || '#fff', 2.5, 0.38);
		sloganMesh.position.set(0, 3.0, backShelfZ + 0.25);
		g.add(sloganMesh);

		// Kassa on counter (same place as MallBuilder counter)
		const reg = new THREE.Group();
		reg.position.set(0.7, 0.95, -roomDepth * 0.55);
		const regBody = new THREE.Mesh(
			new THREE.BoxGeometry(0.48, 0.28, 0.36),
			this.track(new THREE.MeshStandardMaterial({ color: 0x1a2332, metalness: 0.5, roughness: 0.4 })),
		);
		reg.add(regBody);
		const screen = new THREE.Mesh(
			new THREE.BoxGeometry(0.36, 0.24, 0.05),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x00ff88,
					emissive: 0x00aa55,
					emissiveIntensity: 0.55,
				}),
			),
		);
		screen.position.set(0, 0.22, 0.05);
		reg.add(screen);
		const saleLight = new THREE.PointLight(0xffd700, 0.6, 5, 2);
		saleLight.position.set(0, 0.4, 0.3);
		reg.add(saleLight);
		reg.userData['saleLight'] = saleLight;
		const coin = new THREE.Mesh(
			new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12),
			this.track(new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.25 })),
		);
		coin.position.set(-0.2, 0.18, 0.2);
		coin.visible = false;
		reg.add(coin);
		reg.userData['coinMesh'] = coin;
		g.add(reg);
		this.registers.set(store.id, reg);

		const fill = new THREE.PointLight(0xfff8ee, 5, 11, 1.8);
		fill.position.set(0, 2.4, midZ);
		g.add(fill);

		this.group.add(g);
	}

	private makeProduct(item: StockItem): THREE.Mesh {
		const s = item.size ?? 1;
		let col = new THREE.Color(item.color);
		if (col.r + col.g + col.b < 0.3) col = new THREE.Color(0x444444);
		const mat = this.track(
			new THREE.MeshStandardMaterial({
				color: col,
				roughness: 0.45,
				metalness: item.kind === 'device' ? 0.5 : 0.1,
				emissive: col,
				emissiveIntensity: 0.08,
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
				return new THREE.BoxGeometry(0.22 * s, 0.3 * s, 0.07 * s);
			case 'sphere':
				return new THREE.SphereGeometry(0.1 * s, 10, 10);
			case 'book':
				return new THREE.BoxGeometry(0.15 * s, 0.2 * s, 0.04 * s);
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
