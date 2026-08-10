import * as THREE from 'three';
import { levelY } from '#/data/levels';
import {
	ELEVATOR_SPEC,
	PARKED_CAR_SPEC,
	PARKED_CAR_SPOTS,
	PARKING_BAY_SPEC,
	PARKING_CEILING_SPEC,
	PARKING_DECK_SPEC,
	PARKING_EXIT_RAMP,
	PARKING_SLAB_SPEC,
	PARKING_WALL_PANELS,
	parkingPillarCenters,
	parkingStalls,
} from '#/data/world';
import type { LightPool } from '#/render/LightPool';
import { lit } from '#/render/material';
import { addBoxMesh } from '#/render/meshFactory';
import { addExtrudedXZMesh } from '#/render/xzShape';
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
		addExtrudedXZMesh(this.group, concrete, {
			...PARKING_SLAB_SPEC,
			topY: PARKING_SLAB_SPEC.topY - GARAGE_Y,
			receiveShadow: true,
		});

		// Ceiling slab (underside of mall). Cut like the floor: the glass elevator
		// travels through it, so a solid box put 30 cm of concrete in the cabin.
		const { clearHeight } = PARKING_DECK_SPEC;
		addExtrudedXZMesh(this.group, dark, {
			...PARKING_CEILING_SPEC,
			name: 'parking-ceiling',
			topY: PARKING_CEILING_SPEC.topY - GARAGE_Y,
		});

		// Perimeter walls (open near elevator east + west exit ramp to city)
		for (const panel of PARKING_WALL_PANELS) {
			addBoxMesh(this.group, dark, {
				name: `parking-wall-${panel.id}`,
				width: panel.size.width,
				height: clearHeight,
				depth: panel.size.depth,
				position: { x: panel.center.x, y: half(clearHeight), z: panel.center.z },
			});
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
		const { pillar, clearHeight } = PARKING_DECK_SPEC;
		for (const { x, z } of parkingPillarCenters()) {
			const p = new THREE.Mesh(new THREE.BoxGeometry(pillar.width, clearHeight, pillar.width), mat);
			p.position.set(x, half(clearHeight), z);
			this.group.add(p);
		}
	}

	private buildBays(): void {
		const line = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
		const yellow = this.track(new THREE.MeshBasicMaterial({ color: 0xffc107, toneMapped: false }));
		const { stall, paintY, number, aisle } = PARKING_BAY_SPEC;
		// Rows of parking bays N and S of center drive aisle
		for (const { id, center } of parkingStalls()) {
			const bay = new THREE.Mesh(new THREE.PlaneGeometry(stall.width, stall.depth), line);
			bay.rotation.x = -Math.PI / 2;
			bay.position.set(center.x, paintY, center.z);
			this.group.add(bay);
			const num = this.makeTextPlane(id, number.width, number.height);
			num.rotation.x = -Math.PI / 2;
			num.position.set(center.x, paintY + 0.01, center.z + (center.z < 0 ? number.offsetZ : -number.offsetZ));
			this.group.add(num);
		}
		// Center drive arrows
		for (let i = -aisle.arrows; i <= aisle.arrows; i++) {
			const arrow = new THREE.Mesh(new THREE.PlaneGeometry(aisle.width, aisle.depth), yellow);
			arrow.rotation.x = -Math.PI / 2;
			arrow.position.set(i * aisle.spacing, paintY, 0);
			this.group.add(arrow);
		}
	}

	private buildCars(): void {
		// Decorative parked cars only — player rentals live in DriveableCars
		// (avoid overlapping the E-rent spots at ±15.6/-14, 5.2/-14, etc.)
		const colors = [0x212121, 0xf5f5f5, 0xff8f00, 0x455a64, 0x5d4037];
		PARKED_CAR_SPOTS.forEach(({ x, z, yaw }, i) => {
			const car = this.makeCar(at(colors, i));
			car.position.set(x, PARKED_CAR_SPEC.standY, z);
			car.rotation.y = yaw;
			this.group.add(car);
		});
	}

	private makeCar(color: number): THREE.Group {
		const g = new THREE.Group();
		const { body: bodySpec, cabin: cabinSpec, wheel } = PARKED_CAR_SPEC;
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
		const body = new THREE.Mesh(new THREE.BoxGeometry(bodySpec.width, bodySpec.height, bodySpec.length), bodyM);
		body.position.y = bodySpec.centerY;
		g.add(body);
		const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinSpec.width, cabinSpec.height, cabinSpec.length), glass);
		cabin.position.set(0, cabinSpec.centerY, cabinSpec.offsetZ);
		g.add(cabin);
		// wheels
		for (const [sx, sz] of [
			[-1, 1],
			[1, 1],
			[-1, -1],
			[1, -1],
		] as const) {
			const w = new THREE.Mesh(new THREE.CylinderGeometry(wheel.radius, wheel.radius, wheel.width, 10), dark);
			w.rotation.z = Math.PI / 2;
			w.position.set(sx * wheel.offsetX, wheel.radius, sz * wheel.offsetZ);
			g.add(w);
		}
		return g;
	}

	private buildBooth(): void {
		const spec = PARKING_DECK_SPEC.booth;
		const booth = new THREE.Group();
		booth.position.set(spec.center.x, 0, spec.center.z);
		const wood = this.track(lit({ color: 0xffc107, roughness: 0.7 }));
		const box = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), wood);
		box.position.y = half(spec.height);
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
		exit.position.set(ELEVATOR_SPEC.center.x - 2, 2.4, ELEVATOR_SPEC.center.z);
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
			position: new THREE.Vector3(ELEVATOR_SPEC.center.x, GARAGE_Y + 3.5, ELEVATOR_SPEC.center.z),
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
