import * as THREE from 'three';
import { labelCanvas, labelTexture } from '@/util/label';

/**
 * Mall toilets next to the gebedsruimte (not inside it).
 * - Heren: urinoirs + 1 hokje
 * - Dames: 2 hokjes
 * - Wudu/ablution niche between prayer room and WCs (foot-wash taps)
 */
export class Restrooms {
	readonly group = new THREE.Group();
	/** Center of the WC block (world) */
	/** West wall utility strip — clear of south-store fronts */
	readonly pos = new THREE.Vector3(-30, 0, 12);
	private materials: THREE.Material[] = [];

	constructor() {
		this.group.name = 'restrooms';
		this.group.position.copy(this.pos);
		this.buildShell();
		this.buildMens(-2.0);
		this.buildWomens(2.0);
		this.buildWudu(-0.1);
		this.buildCorridorSigns();
	}

	/** AABBs for CollisionWorld (world-space min/max XZ) */
	getColliders(): { minX: number; maxX: number; minZ: number; maxZ: number; label: string }[] {
		const cx = this.pos.x;
		const cz = this.pos.z;
		return [
			// outer shell walls (approximate solid boxes for corridor sides)
			{ minX: cx - 4.2, maxX: cx - 3.9, minZ: cz - 3.2, maxZ: cz + 3.2, label: 'wc_wall_w' },
			{ minX: cx + 3.9, maxX: cx + 4.2, minZ: cz - 3.2, maxZ: cz + 3.2, label: 'wc_wall_e' },
			{ minX: cx - 4.2, maxX: cx + 4.2, minZ: cz - 3.4, maxZ: cz - 3.1, label: 'wc_wall_n' },
			// divider between men/women
			{ minX: cx - 0.15, maxX: cx + 0.15, minZ: cz - 2.8, maxZ: cz + 2.6, label: 'wc_divider' },
		];
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private tileMat(color: number): THREE.MeshStandardMaterial {
		return this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }));
	}

	private buildShell(): void {
		const floor = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.08, 6.4), this.tileMat(0xd5d0c8));
		floor.position.y = 0.04;
		this.group.add(floor);

		const wall = this.tileMat(0xece8e1);
		// back wall (closed)
		const back = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.0, 0.16), wall);
		back.position.set(0, 1.5, -3.15);
		this.group.add(back);
		// side walls
		for (const sx of [-4.05, 4.05]) {
			const side = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.0, 6.4), wall);
			side.position.set(sx, 1.5, 0);
			this.group.add(side);
		}
		// front open with partial fascia
		const fascia = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.5, 0.12), wall);
		fascia.position.set(0, 2.75, 3.15);
		this.group.add(fascia);

		// ceiling strip lights
		const light = new THREE.PointLight(0xf5f0e6, 8, 12, 1.8);
		light.position.set(0, 2.7, 0);
		this.group.add(light);
	}

	/** Local-X offset for men's room (negative = left) */
	private buildMens(ox: number): void {
		const g = new THREE.Group();
		g.position.x = ox;
		this.group.add(g);

		// floor zone color
		const zone = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 5.6), this.tileMat(0xc5d5e8));
		zone.position.set(0, 0.09, 0);
		g.add(zone);

		// urinal wall + 3 urinals
		const splash = new THREE.Mesh(
			new THREE.BoxGeometry(3.2, 1.4, 0.08),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xb0bec5,
					metalness: 0.35,
					roughness: 0.4,
				}),
			),
		);
		splash.position.set(0, 0.9, -2.6);
		g.add(splash);

		for (let i = 0; i < 3; i++) {
			g.add(this.makeUrinal(-1.1 + i * 1.1, -2.45));
		}

		// dividers between urinals
		const divMat = this.track(new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.2, roughness: 0.5 }));
		for (const dx of [-0.55, 0.55]) {
			const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.45), divMat);
			d.position.set(dx, 0.85, -2.35);
			g.add(d);
		}

		// one sit toilet stall
		g.add(this.makeStall(1.15, 1.1, 0x90caf9));

		// sink
		g.add(this.makeSink(-1.2, 2.2));

		// sign
		g.add(this.makeDoorSign(-0.1, 3.0, 'HEREN', '♂ urinoirs + hokje', '#1565c0'));
	}

	private buildWomens(ox: number): void {
		const g = new THREE.Group();
		g.position.x = ox;
		this.group.add(g);

		const zone = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 5.6), this.tileMat(0xf0d0d8));
		zone.position.set(0, 0.09, 0);
		g.add(zone);

		// two stalls
		g.add(this.makeStall(-1.0, 0.2, 0xf48fb1));
		g.add(this.makeStall(1.0, 0.2, 0xf48fb1));

		// sinks
		g.add(this.makeSink(-1.0, 2.3));
		g.add(this.makeSink(1.0, 2.3));

		// mirror strip
		const mirror = new THREE.Mesh(
			new THREE.BoxGeometry(3.0, 0.9, 0.04),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xcfd8dc,
					metalness: 0.85,
					roughness: 0.15,
				}),
			),
		);
		mirror.position.set(0, 1.6, 2.55);
		g.add(mirror);

		g.add(this.makeDoorSign(0.1, 3.0, 'DAMES', '♀ 2 hokjes', '#ad1457'));
	}

	/** Ablution / wudu taps — between prayer and toilets, not inside prayer mats */
	private buildWudu(ox: number): void {
		const g = new THREE.Group();
		// sits slightly toward corridor front of WC block, center
		g.position.set(ox, 0, 3.6);
		this.group.add(g);

		const bench = new THREE.Mesh(
			new THREE.BoxGeometry(2.4, 0.35, 0.7),
			this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 })),
		);
		bench.position.y = 0.2;
		g.add(bench);

		// low foot-wash basin
		const basin = new THREE.Mesh(
			new THREE.BoxGeometry(2.2, 0.18, 0.55),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x78909c,
					metalness: 0.5,
					roughness: 0.35,
				}),
			),
		);
		basin.position.set(0, 0.42, 0);
		g.add(basin);

		const water = new THREE.Mesh(
			new THREE.BoxGeometry(2.0, 0.04, 0.4),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0x4fc3f7,
					transparent: true,
					opacity: 0.45,
					roughness: 0.1,
				}),
			),
		);
		water.position.set(0, 0.5, 0);
		g.add(water);

		for (const dx of [-0.7, 0, 0.7]) {
			const tap = new THREE.Mesh(
				new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8),
				this.track(
					new THREE.MeshStandardMaterial({
						color: 0xb0bec5,
						metalness: 0.8,
						roughness: 0.25,
					}),
				),
			);
			tap.position.set(dx, 0.72, -0.15);
			g.add(tap);
		}

		const { canvas: c, ctx } = labelCanvas(256, 64);
		ctx.fillStyle = '#0d47a1';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('WUDU / ABLUTIE', 128, 40);
		const tex = labelTexture(c);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(1.6, 0.4),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, 1.35, 0.2);
		g.add(sign);
	}

	private makeUrinal(x: number, z: number): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		const ceramic = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xf5f5f5,
				roughness: 0.25,
				metalness: 0.1,
			}),
		);
		// bowl
		const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), ceramic);
		bowl.scale.set(1, 1.15, 0.75);
		bowl.position.set(0, 0.55, 0.05);
		g.add(bowl);
		// backplate
		const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 0.06), ceramic);
		plate.position.set(0, 0.85, -0.08);
		g.add(plate);
		// drain lip
		const lip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.14), ceramic);
		lip.position.set(0, 0.38, 0.12);
		g.add(lip);
		// flush pipe
		const pipe = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6),
			this.track(new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.7, roughness: 0.3 })),
		);
		pipe.position.set(0, 1.15, -0.05);
		g.add(pipe);
		return g;
	}

	private makeStall(x: number, z: number, doorColor: number): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		const panel = this.track(new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.6 }));
		// three walls of stall
		const back = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.06), panel);
		back.position.set(0, 1.0, -0.7);
		g.add(back);
		for (const sx of [-0.55, 0.55]) {
			const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 1.4), panel);
			side.position.set(sx, 1.0, 0);
			g.add(side);
		}
		// door (ajar a bit)
		const door = new THREE.Mesh(
			new THREE.BoxGeometry(0.9, 1.85, 0.05),
			this.track(new THREE.MeshStandardMaterial({ color: doorColor, roughness: 0.55 })),
		);
		door.position.set(0.15, 0.95, 0.7);
		door.rotation.y = -0.35;
		g.add(door);
		// toilet
		const ceramic = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
		const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.35, 12), ceramic);
		bowl.position.set(0, 0.35, -0.15);
		g.add(bowl);
		const seat = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 16), ceramic);
		seat.rotation.x = Math.PI / 2;
		seat.position.set(0, 0.55, -0.15);
		g.add(seat);
		const tank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.18), ceramic);
		tank.position.set(0, 0.85, -0.45);
		g.add(tank);
		return g;
	}

	private makeSink(x: number, z: number): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		const ceramic = this.track(new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.3 }));
		const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.45), ceramic);
		top.position.y = 0.9;
		g.add(top);
		const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.12, 12), ceramic);
		bowl.position.set(0, 0.82, 0.02);
		g.add(bowl);
		const faucet = new THREE.Mesh(
			new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6),
			this.track(new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.85, roughness: 0.2 })),
		);
		faucet.position.set(0, 1.1, -0.1);
		g.add(faucet);
		return g;
	}

	private makeDoorSign(x: number, z: number, title: string, sub: string, color: string): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(256, 96);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 256, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 128, 40);
		ctx.font = '16px system-ui,sans-serif';
		ctx.fillText(sub, 128, 70);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1.5, 0.55),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		mesh.position.set(x, 2.5, z);
		return mesh;
	}

	private buildCorridorSigns(): void {
		// Big wall-mounted WC bordjes on the facade (gendered, clear, boring mall energy)
		this.group.add(this.wallBoard(-2.0, 3.05, 2.15, '♂ HEREN', 'urinoirs + toilet', '#0d47a1'));
		this.group.add(this.wallBoard(2.0, 3.05, 2.15, '♀ DAMES', 'toiletten', '#880e4f'));
		// Classic square pictogram plates next to doors
		this.group.add(this.pictogram(-2.0, 2.2, 2.95, '♂', '#1565c0'));
		this.group.add(this.pictogram(2.0, 2.2, 2.95, '♀', '#c2185b'));

		// Overhead wayfinding strip
		const { canvas: c, ctx } = labelCanvas(512, 96);
		ctx.fillStyle = '#111827';
		ctx.fillRect(0, 0, 512, 96);
		ctx.fillStyle = '#22c55e';
		ctx.fillRect(0, 0, 8, 96);
		ctx.fillStyle = '#f8fafc';
		ctx.font = 'bold 28px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('TOILETTEN', 256, 40);
		ctx.font = '600 18px system-ui';
		ctx.fillStyle = '#94a3b8';
		ctx.fillText('HEREN  ·  DAMES  ·  gender apart', 256, 72);
		const tex = labelTexture(c);
		const strip = new THREE.Mesh(
			new THREE.PlaneGeometry(3.6, 0.7),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		strip.position.set(0, 2.95, 3.2);
		this.group.add(strip);

		// Extra wall plates on left/right outer walls facing corridor
		this.group.add(this.sideWallPlate(-4.02, 1.8, 0.5, 'WC', '♂', '#0d47a1', 1));
		this.group.add(this.sideWallPlate(4.02, 1.8, 0.5, 'WC', '♀', '#880e4f', -1));
	}

	/** Flat board on the front wall */
	private wallBoard(x: number, y: number, z: number, title: string, sub: string, color: string): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(320, 140);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 320, 140);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 36px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 160, 58);
		ctx.font = '20px system-ui,sans-serif';
		ctx.fillText(sub, 160, 100);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1.7, 0.75),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		mesh.position.set(x, y, z);
		return mesh;
	}

	private pictogram(x: number, y: number, z: number, symbol: string, color: string): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(128, 128);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 128, 128);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 72px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(symbol, 64, 68);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.55, 0.55),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		mesh.position.set(x, y, z);
		return mesh;
	}

	/** Sign flush on outer side wall (face = ±1 for +X / −X) */
	private sideWallPlate(x: number, y: number, z: number, title: string, symbol: string, color: string, face: 1 | -1): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(160, 200);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 160, 200);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 56px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText(symbol, 80, 80);
		ctx.font = 'bold 32px system-ui';
		ctx.fillText(title, 80, 140);
		const tex = labelTexture(c);
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.7, 0.9),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide })),
		);
		mesh.position.set(x, y, z);
		mesh.rotation.y = face > 0 ? -Math.PI / 2 : Math.PI / 2;
		return mesh;
	}
}
