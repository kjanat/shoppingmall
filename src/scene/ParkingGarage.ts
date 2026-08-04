import * as THREE from 'three';
import { PARKING_FOOTPRINT } from '#/data/layout';
import { levelY } from '#/data/levels';
import { ELEVATOR_OPENING_P1, PARKING_EXIT_RAMP } from '#/data/world';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { addBoxMesh } from '#/render/meshFactory';
import { addXZRectangleHole, xzRectangleShape } from '#/render/xzShape';
import { labelCanvas, labelTexture } from '#/util/label';
import { half, midpoint } from '#/util/math';
import { at } from '#/util/rand';

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
		const floorShape = xzRectangleShape({ center: { x: 0, z: 0 }, size: PARKING_FOOTPRINT });
		addXZRectangleHole(floorShape, ELEVATOR_OPENING_P1);
		const floorGeometry = new THREE.ExtrudeGeometry(floorShape, { depth: 0.25, bevelEnabled: false });
		floorGeometry.rotateX(-Math.PI / 2);
		const floor = new THREE.Mesh(floorGeometry, concrete);
		floor.position.y = -0.25;
		floor.receiveShadow = true;
		this.group.add(floor);

		// Ceiling slab (underside of mall)
		const ceil = new THREE.Mesh(new THREE.BoxGeometry(PARKING_FOOTPRINT.width, 0.3, PARKING_FOOTPRINT.depth), dark);
		ceil.position.y = 4.6;
		this.group.add(ceil);

		// Perimeter walls (open near elevator east + west exit ramp to city)
		const wallH = 4.4;
		for (const wall of [
			{
				name: 'parking-wall-north',
				width: PARKING_FOOTPRINT.width,
				height: wallH,
				depth: 0.35,
				position: { x: 0, y: half(wallH), z: -half(PARKING_FOOTPRINT.depth) + 0.2 },
			},
			{
				name: 'parking-wall-south',
				width: PARKING_FOOTPRINT.width,
				height: wallH,
				depth: 0.35,
				position: { x: 0, y: half(wallH), z: half(PARKING_FOOTPRINT.depth) - 0.2 },
			},
			...[-14, 14].map((z, index) => ({
				name: `parking-wall-west-${index}`,
				width: 0.35,
				height: wallH,
				depth: 14,
				position: { x: -half(PARKING_FOOTPRINT.width) + 0.2, y: half(wallH), z },
			})),
			{
				name: 'parking-wall-east-north',
				width: 0.35,
				height: wallH,
				depth: 14,
				position: { x: half(PARKING_FOOTPRINT.width) - 0.2, y: half(wallH), z: -14 },
			},
			{
				name: 'parking-wall-east-south',
				width: 0.35,
				height: wallH,
				depth: 20,
				position: { x: half(PARKING_FOOTPRINT.width) - 0.2, y: half(wallH), z: 10 },
			},
		]) {
			addBoxMesh(this.group, dark, wall);
		}

		// ── West exit ramp → outdoor city (local y 0 = world GARAGE_Y) ──
		this.buildExitRamp(concrete, dark);
	}

	/** Ramp from P1 deck up to street level, heading west out of the mall */
	private buildExitRamp(concrete: THREE.Material, dark: THREE.Material): void {
		const { start, end, width, thickness, guardHeight } = PARKING_EXIT_RAMP;
		const { x: startX, y: startY } = start;
		const { x: endX, y: endY } = end;
		const localStartY = startY - GARAGE_Y;
		const localEndY = endY - GARAGE_Y;
		const run = Math.abs(endX - startX);
		const rise = localEndY - localStartY;
		const length = Math.hypot(run, rise);
		const angle = -Math.atan2(rise, run);
		const centerX = midpoint(startX, endX);
		const surfaceCenterY = midpoint(localStartY, localEndY);
		const slabNormalOffset = half(thickness);
		const slab = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), concrete);
		slab.position.set(centerX + Math.sin(angle) * slabNormalOffset, surfaceCenterY - Math.cos(angle) * slabNormalOffset, 0);
		slab.rotation.z = angle;
		slab.receiveShadow = true;
		this.group.add(slab);

		const railOffset = half(guardHeight);
		for (const sideZ of [-half(width) - 0.15, half(width) + 0.15]) {
			const rail = new THREE.Mesh(new THREE.BoxGeometry(length, guardHeight, 0.12), dark);
			rail.position.set(centerX - Math.sin(angle) * railOffset, surfaceCenterY + Math.cos(angle) * railOffset, sideZ);
			rail.rotation.z = angle;
			this.group.add(rail);
		}
		// Yellow EXIT arrows on first segments
		const yellow = this.track(new THREE.MeshBasicMaterial({ color: 0xffc107, toneMapped: false }));
		for (let i = 0; i < 4; i++) {
			const t = (i + 0.5) / 8;
			const x = start.x + (end.x - start.x) * t;
			const y = localStartY + rise * t + 0.2;
			const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), yellow);
			arrow.rotation.x = -Math.PI / 2;
			arrow.rotation.z = Math.PI / 2; // point west
			arrow.position.set(x, y, 0);
			this.group.add(arrow);
		}
		// Sign at ramp mouth (inside garage)
		const exitSign = this.makeTextPlane('← EXIT · STAD', 3.2, 0.7, '#b71c1c', '#fff');
		exitSign.position.set(start.x + 2, localStartY + 2.8, 0);
		exitSign.rotation.y = Math.PI / 2;
		this.group.add(exitSign);
		const citySign = this.makeTextPlane('CITY RING →', 2.8, 0.55, '#0d47a1', '#fff');
		citySign.position.set(end.x + 2, localEndY + 1.15, 0);
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
