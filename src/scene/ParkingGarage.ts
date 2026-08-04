import * as THREE from 'three';
import { levelY } from '@/data/levels';
import type { LightPool } from '@/render/LightPool';
import { lit } from '@/render/material';
import { labelCanvas, labelTexture } from '@/util/label';
import { at } from '@/util/rand';

/** World Y of the parking deck (one storey under V0) */
export const GARAGE_Y = levelY('p1');

/**
 * Underground parking garage — grey concrete, pillars, bays, a few cars.
 * Reachable via the glass elevator (Hans: “P1 / parkeergarage”).
 */
export class ParkingGarage {
	readonly group = new THREE.Group();
	readonly pos = new THREE.Vector3(0, GARAGE_Y, 0);
	private materials: THREE.Material[] = [];
	private pool: LightPool;

	constructor(pool: LightPool) {
		this.pool = pool;
		this.group.name = 'parkingGarage';
		this.group.position.y = GARAGE_Y;
		this.buildShell();
		this.buildPillars();
		this.buildBays();
		this.buildCars();
		this.buildBooth();
		this.buildSigns();
		this.buildLights();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildShell(): void {
		const concrete = this.track(lit({ color: 0x5a5a5a, roughness: 0.95 }));
		const dark = this.track(lit({ color: 0x37474f, roughness: 0.9 }));
		// Deck floor
		const floor = new THREE.Mesh(new THREE.BoxGeometry(64, 0.25, 42), concrete);
		floor.position.y = 0;
		floor.receiveShadow = true;
		this.group.add(floor);

		// Ceiling slab (underside of mall)
		const ceil = new THREE.Mesh(new THREE.BoxGeometry(64, 0.3, 42), dark);
		ceil.position.y = 4.6;
		this.group.add(ceil);

		// Perimeter walls (open near elevator east + west exit ramp to city)
		const wallH = 4.4;
		const walls: [number, number, number, number, number, number][] = [
			// N
			[0, wallH / 2, -20.8, 64, wallH, 0.35],
			// S
			[0, wallH / 2, 20.8, 64, wallH, 0.35],
			// W — gap around z=0 for EXIT RAMP to outdoor city
			[-31.8, wallH / 2, -14, 0.35, wallH, 14],
			[-31.8, wallH / 2, 14, 0.35, wallH, 14],
			// E (gap for elevator shaft around z=-8)
			[31.8, wallH / 2, -14, 0.35, wallH, 14],
			[31.8, wallH / 2, 10, 0.35, wallH, 20],
		];
		for (const [x, y, z, w, h, d] of walls) {
			const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), dark);
			m.position.set(x, y, z);
			this.group.add(m);
		}

		// ── West exit ramp → outdoor city (local y 0 = world GARAGE_Y) ──
		this.buildExitRamp(concrete, dark);
	}

	/** Ramp from P1 deck up to street level, heading west out of the mall */
	private buildExitRamp(concrete: THREE.Material, dark: THREE.Material): void {
		// Long rising slab: local x -30 → -46, y 0 → 6 (world -6 → 0)
		const segs = 10;
		for (let i = 0; i < segs; i++) {
			const t0 = i / segs;
			const t1 = (i + 1) / segs;
			const x0 = -30 - t0 * 16;
			const x1 = -30 - t1 * 16;
			const y0 = t0 * 6.05;
			const y1 = t1 * 6.05;
			const midX = (x0 + x1) / 2;
			const midY = (y0 + y1) / 2;
			const len = Math.hypot(x1 - x0, y1 - y0);
			const ang = Math.atan2(y1 - y0, x0 - x1); // pitch
			const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.28, 5.5), concrete);
			slab.position.set(midX, midY + 0.05, 0);
			slab.rotation.z = ang;
			slab.receiveShadow = true;
			this.group.add(slab);
			// Side rails
			for (const sz of [-2.9, 2.9]) {
				const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.12), dark);
				rail.position.set(midX, midY + 0.4, sz);
				rail.rotation.z = ang;
				this.group.add(rail);
			}
		}
		// Yellow EXIT arrows on first segments
		const yellow = this.track(new THREE.MeshBasicMaterial({ color: 0xffc107, toneMapped: false }));
		for (let i = 0; i < 4; i++) {
			const t = (i + 0.5) / 8;
			const x = -30 - t * 16;
			const y = t * 6.05 + 0.2;
			const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), yellow);
			arrow.rotation.x = -Math.PI / 2;
			arrow.rotation.z = Math.PI / 2; // point west
			arrow.position.set(x, y, 0);
			this.group.add(arrow);
		}
		// Sign at ramp mouth (inside garage)
		const exitSign = this.makeTextPlane('← EXIT · STAD', 3.2, 0.7, '#b71c1c', '#fff');
		exitSign.position.set(-28, 2.8, 0);
		exitSign.rotation.y = Math.PI / 2;
		this.group.add(exitSign);
		const citySign = this.makeTextPlane('CITY RING →', 2.8, 0.55, '#0d47a1', '#fff');
		citySign.position.set(-44, 7.2, 0); // near street level (local y≈6)
		citySign.rotation.y = Math.PI / 2;
		this.group.add(citySign);
	}

	private buildPillars(): void {
		const mat = this.track(
			lit({
				color: 0x78909c,
				roughness: 0.75,
				metalness: 0.1,
			}),
		);
		for (let ix = -3; ix <= 3; ix++) {
			for (let iz = -2; iz <= 2; iz++) {
				// leave free around elevator (16, -8) world → local x=16, z=-8
				const x = ix * 8;
				const z = iz * 8;
				if (Math.abs(x - 16) < 5 && Math.abs(z + 8) < 5) continue;
				const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.4, 0.7), mat);
				p.position.set(x, 2.2, z);
				this.group.add(p);
			}
		}
	}

	private buildBays(): void {
		const line = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
		const yellow = this.track(new THREE.MeshBasicMaterial({ color: 0xffc107, toneMapped: false }));
		// Rows of parking bays N and S of center drive aisle
		for (const rowZ of [-14, 14] as const) {
			for (let i = -5; i <= 5; i++) {
				const x = i * 5.2;
				// bay outline
				const bay = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), line);
				bay.rotation.x = -Math.PI / 2;
				bay.position.set(x, 0.14, rowZ);
				this.group.add(bay);
				// number
				const num = this.makeTextPlane(`${rowZ < 0 ? 'A' : 'B'}${i + 6}`, 0.8, 0.35);
				num.rotation.x = -Math.PI / 2;
				num.position.set(x, 0.15, rowZ + (rowZ < 0 ? 1.8 : -1.8));
				this.group.add(num);
			}
		}
		// Center drive arrows
		for (let i = -4; i <= 4; i++) {
			const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), yellow);
			arrow.rotation.x = -Math.PI / 2;
			arrow.position.set(i * 6, 0.14, 0);
			this.group.add(arrow);
		}
	}

	private buildCars(): void {
		// Decorative parked cars only — player rentals live in DriveableCars
		// (avoid overlapping the E-rent spots at ±15.6/-14, 5.2/-14, etc.)
		const colors = [0x212121, 0xf5f5f5, 0xff8f00, 0x455a64, 0x5d4037];
		const spots: [number, number, number][] = [
			[-5.2, -14, 0.3],
			[0, -14, 0],
			[10.4, -14, 0.15],
			[20.8, -14, 0],
			[10.4, 14, Math.PI],
			[0, 14, Math.PI],
			[-20.8, 14, Math.PI - 0.05],
		];
		spots.forEach(([x, z, rot], i) => {
			const car = this.makeCar(at(colors, i));
			car.position.set(x, 0.12, z);
			car.rotation.y = rot;
			this.group.add(car);
		});
	}

	private makeCar(color: number): THREE.Group {
		const g = new THREE.Group();
		const bodyM = this.track(lit({ color, roughness: 0.45, metalness: 0.35 }));
		const dark = this.track(lit({ color: 0x111111, roughness: 0.7, metalness: 0.4 }));
		const glass = this.track(
			lit({
				color: 0x90caf9,
				transparent: true,
				opacity: 0.55,
				roughness: 0.15,
			}),
		);
		const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 4.0), bodyM);
		body.position.y = 0.45;
		g.add(body);
		const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 2.0), glass);
		cabin.position.set(0, 0.85, -0.15);
		g.add(cabin);
		// wheels
		for (const [wx, wz] of [
			[-0.85, 1.2],
			[0.85, 1.2],
			[-0.85, -1.2],
			[0.85, -1.2],
		] as const) {
			const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 10), dark);
			w.rotation.z = Math.PI / 2;
			w.position.set(wx, 0.28, wz);
			g.add(w);
		}
		return g;
	}

	private buildBooth(): void {
		const booth = new THREE.Group();
		booth.position.set(22, 0, -4);
		const wood = this.track(lit({ color: 0xffc107, roughness: 0.7 }));
		const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.0), wood);
		box.position.y = 1.2;
		booth.add(box);
		const win = new THREE.Mesh(
			new THREE.PlaneGeometry(1.2, 0.8),
			this.track(
				lit({
					color: 0x81d4fa,
					transparent: true,
					opacity: 0.5,
				}),
			),
		);
		win.position.set(0, 1.4, 1.02);
		booth.add(win);
		const sign = this.makeTextPlane('P · TICKETS', 1.6, 0.4);
		sign.position.set(0, 2.55, 0);
		booth.add(sign);
		this.group.add(booth);
	}

	private buildSigns(): void {
		const big = this.makeTextPlane('P1  PARKEERGARAGE', 6, 1.0, '#0d47a1', '#fff');
		big.position.set(0, 3.2, -19.5);
		this.group.add(big);
		const exit = this.makeTextPlane('↑ LIFT · V0', 2.5, 0.55, '#b71c1c', '#fff');
		exit.position.set(14, 2.4, -8);
		exit.rotation.y = -Math.PI / 2;
		this.group.add(exit);
		const no = this.makeTextPlane('MAX 2.1 m', 2.2, 0.4, '#212121', '#ffc107');
		no.position.set(-20, 3.0, 0);
		no.rotation.y = Math.PI / 2;
		this.group.add(no);
	}

	private buildLights(): void {
		// Dim fluorescent rows
		for (let i = -3; i <= 3; i++) {
			this.pool.register({
				color: 0xfff3e0,
				intensity: 2.2,
				distance: 16,
				decay: 2,
				position: new THREE.Vector3(i * 8, GARAGE_Y + 4.0, 0),
			});
			const fixture = new THREE.Mesh(
				new THREE.BoxGeometry(3.5, 0.08, 0.25),
				this.track(
					lit({
						color: 0xfffde7,
						emissive: 0xfff9c4,
						emissiveIntensity: 0.6,
					}),
				),
			);
			fixture.position.set(i * 8, 4.35, 0);
			this.group.add(fixture);
		}
		// Elevator area brighter
		this.pool.register({
			color: 0xe3f2fd,
			intensity: 4,
			distance: 12,
			decay: 2,
			position: new THREE.Vector3(16, GARAGE_Y + 3.5, -8),
		});
	}

	private makeTextPlane(text: string, w: number, h: number, bg = '#1565c0', fg = '#ffffff'): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(512, 128);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 512, 128);
		ctx.fillStyle = fg;
		ctx.font = 'bold 42px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 64);
		const tex = labelTexture(c);
		return new THREE.Mesh(
			new THREE.PlaneGeometry(w, h),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
	}
}
