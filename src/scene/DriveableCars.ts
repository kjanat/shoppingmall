import * as THREE from 'three';
import { level, levelAt } from '@/data/levels';
import type { CollisionWorld } from '@/physics/Collision';
import { lit } from '@/render/material';
import { labelCanvas, labelTexture } from '@/util/label';
import { GARAGE_Y } from './ParkingGarage';
import type { DriveInput } from './ScrubberBuggy';

type CarSlot = {
	mesh: THREE.Group;
	/** world position of parked car */
	park: THREE.Vector3;
	yaw: number;
	color: number;
	name: string;
	/** currently the player car */
	active: boolean;
	wheels: THREE.Object3D[];
	label: THREE.Sprite;
};

const RADIUS = 1.35;
const MAX_SPEED = 18;
const MAX_BOOST = 28;
const ACCEL = 14;
const BRAKE = 22;
const FRICTION = 5;
const TURN_RATE = 1.85;

/** Spots in garage local space (group at y=GARAGE_Y) → world */
const SPOTS: { x: number; z: number; yaw: number; color: number; name: string }[] = [
	{ x: -15.6, z: -14, yaw: 0, color: 0xc62828, name: 'RODE HATCH' },
	{ x: -10.4, z: -14, yaw: 0.05, color: 0x1565c0, name: 'BLAUWE SEDAN' },
	{ x: 5.2, z: -14, yaw: -0.08, color: 0xffc107, name: 'TAXI #88' },
	{ x: 15.6, z: 14, yaw: Math.PI, color: 0x2e7d32, name: 'GROENE SUV' },
	{ x: -5.2, z: 14, yaw: Math.PI + 0.1, color: 0x6a1b9a, name: 'PAARSE COUPE' },
];

/**
 * Player-driveable cars parked in P1. Hop in with E, race the garage,
 * take the west exit ramp into the outdoor city ring.
 */
export class DriveableCars {
	readonly group = new THREE.Group();
	ridden = false;
	private world: CollisionWorld;
	private materials: THREE.Material[] = [];
	private cars: CarSlot[] = [];
	private active: CarSlot | null = null;
	private yaw = 0;
	private speed = 0;
	private pos = new THREE.Vector3();
	private wheels: THREE.Object3D[] = [];

	constructor(world: CollisionWorld) {
		this.world = world;
		this.group.name = 'driveableCars';
		// World-space group (not parented under parking) so we can leave the garage
		for (const s of SPOTS) {
			this.cars.push(this.spawn(s));
		}
	}

	get activeName(): string {
		return this.active?.name ?? '—';
	}

	get heading(): number {
		return this.yaw;
	}

	get speedKmh(): number {
		return Math.abs(this.speed) * 3.6;
	}

	get statusLine(): string {
		if (this.ridden && this.active) {
			const turbo = Math.abs(this.speed) > MAX_SPEED + 1 ? ' · TURBO' : '';
			const where = levelAt(this.pos.y) === 'p1' ? level('p1').code : 'STAD';
			return `${this.active.name} · ${this.speedKmh.toFixed(0)} km/u · ${where}${turbo}`;
		}
		return `${this.cars.length} huurauto's · E = instappen (P1)`;
	}

	/** Nearest free car within range (world pos) */
	nearestCar(player: THREE.Vector3, maxDist = 4.2): CarSlot | null {
		if (this.ridden) return null;
		let best: CarSlot | null = null;
		let bestD = maxDist;
		for (const c of this.cars) {
			if (c.active) continue;
			const d = Math.hypot(player.x - c.park.x, player.z - c.park.z);
			// Must be near basement height or car is outdoors parked
			const dy = Math.abs(player.y - (c.park.y + 1.2));
			if (dy > 3.5) continue;
			if (d < bestD) {
				bestD = d;
				best = c;
			}
		}
		return best;
	}

	distanceToNearest(player: THREE.Vector3): number {
		const c = this.nearestCar(player, 99);
		if (!c) return 999;
		return Math.hypot(player.x - c.park.x, player.z - c.park.z);
	}

	getSeatPosition(): THREE.Vector3 {
		const fx = Math.sin(this.yaw);
		const fz = Math.cos(this.yaw);
		return new THREE.Vector3(this.pos.x - fx * 0.15, this.pos.y + 1.15, this.pos.z - fz * 0.15);
	}

	board(car?: CarSlot): boolean {
		const c = car ?? this.cars.find((x) => !x.active) ?? null;
		if (!c || this.ridden) return false;
		this.active = c;
		c.active = true;
		this.ridden = true;
		this.pos.copy(c.mesh.position);
		this.yaw = c.mesh.rotation.y;
		this.speed = 0;
		this.wheels = c.wheels;
		this.world.boundsMode = 'city';
		this.paintLabel(c, `JIJ · ${c.name}`, '#b71c1c');
		return true;
	}

	/** Exit car, park here; returns world feet spawn */
	release(): THREE.Vector3 {
		const c = this.active;
		this.ridden = false;
		this.speed = 0;
		this.world.boundsMode = 'mall';
		if (c) {
			c.active = false;
			c.park.copy(this.pos);
			c.yaw = this.yaw;
			c.mesh.position.copy(this.pos);
			c.mesh.rotation.y = this.yaw;
			this.paintLabel(c, `${c.name} · E`, '#0d47a1');
		}
		const leftX = Math.cos(this.yaw);
		const leftZ = -Math.sin(this.yaw);
		const exit = new THREE.Vector3(this.pos.x + leftX * 2.2, this.pos.y, this.pos.z + leftZ * 2.2);
		const gY = this.world.groundHeightAt(exit.x, exit.z, this.pos.y + 0.5, 3);
		exit.y = gY;
		const fixed = this.world.resolveCircle(exit.x, exit.z, gY + 1, 0.45, 3, true);
		exit.x = fixed.x;
		exit.z = fixed.z;
		this.active = null;
		this.wheels = [];
		return exit;
	}

	/**
	 * Drive physics. Seat world pos when ridden.
	 */
	update(dt: number, input?: DriveInput): THREE.Vector3 | null {
		if (!this.ridden || !this.active) return null;

		const throttle = input?.throttle ?? 0;
		const steer = input?.steer ?? 0;
		const boost = !!input?.boost;
		const maxSp = boost ? MAX_BOOST : MAX_SPEED;

		if (Math.abs(throttle) > 0.05) {
			const want = throttle * maxSp;
			const rate =
				(Math.sign(throttle) === Math.sign(this.speed) || Math.abs(this.speed) < 0.4 ? ACCEL : BRAKE) * (boost ? 1.2 : 1);
			if (this.speed < want) this.speed = Math.min(want, this.speed + rate * dt);
			else this.speed = Math.max(want, this.speed - rate * dt);
		} else {
			if (this.speed > 0) this.speed = Math.max(0, this.speed - FRICTION * dt);
			else this.speed = Math.min(0, this.speed + FRICTION * dt);
		}

		const steerAuth = Math.max(0.25, Math.min(1, Math.abs(this.speed) / 5));
		if (Math.abs(steer) > 0.05) {
			const dir = this.speed >= -0.2 ? 1 : -1;
			this.yaw += steer * TURN_RATE * steerAuth * dir * dt;
		}

		const fx = Math.sin(this.yaw);
		const fz = Math.cos(this.yaw);
		let nx = this.pos.x + fx * this.speed * dt;
		let nz = this.pos.z + fz * this.speed * dt;

		// Follow terrain: garage floor / ramp / outdoor roads
		let gy = this.world.groundHeightAt(nx, nz, this.pos.y + 0.5, 2.5);
		// Smooth ramp assist: if still in garage column west exit, lerp up
		gy = this.rampAssist(nx, nz, gy);

		const hit = this.world.resolveCircle(nx, nz, gy + 0.6, RADIUS, 4, true);
		const scraped = Math.hypot(hit.x - nx, hit.z - nz) > 0.04;
		if (scraped) this.speed *= 0.55;
		nx = hit.x;
		nz = hit.z;

		this.pos.set(nx, gy, nz);
		const mesh = this.active.mesh;
		mesh.position.copy(this.pos);
		mesh.rotation.y = this.yaw;
		// Slight body roll
		mesh.rotation.z = THREE.MathUtils.clamp(-steer * Math.abs(this.speed) * 0.012, -0.12, 0.12);

		const spin = this.speed * dt * 1.4;
		for (const w of this.wheels) w.rotation.x += spin;

		return this.getSeatPosition();
	}

	/**
	 * West garage exit ramp: world x from -28 → -42, y from -6 → 0.
	 * Also a soft pad so cars don't fall through outdoors.
	 */
	private rampAssist(x: number, z: number, fallback: number): number {
		// Exit corridor west of mall, centered near z=0
		if (x < -26 && x > -48 && Math.abs(z) < 6) {
			// linear ramp
			const t = THREE.MathUtils.clamp((-x - 28) / 14, 0, 1);
			const rampY = GARAGE_Y + t * (0 - GARAGE_Y);
			// Prefer ramp when near it
			if (fallback < 1 || Math.abs(fallback - rampY) < 3) return rampY;
		}
		// Outdoor ground
		if (Math.abs(x) > 37 || Math.abs(z) > 25) {
			if (fallback < -1) return 0;
		}
		return fallback;
	}

	private spawn(s: { x: number; z: number; yaw: number; color: number; name: string }): CarSlot {
		const mesh = this.makeCar(s.color);
		const park = new THREE.Vector3(s.x, GARAGE_Y + 0.12, s.z);
		mesh.position.copy(park);
		mesh.rotation.y = s.yaw;
		const wheels: THREE.Object3D[] = [];
		mesh.traverse((o) => {
			if (o.userData['isWheel']) wheels.push(o);
		});
		const label = this.makeLabel(`${s.name} · E`, '#0d47a1');
		label.position.set(0, 1.85, 0);
		mesh.add(label);
		this.group.add(mesh);
		return {
			mesh,
			park: park.clone(),
			yaw: s.yaw,
			color: s.color,
			name: s.name,
			active: false,
			wheels,
			label,
		};
	}

	private paintLabel(c: CarSlot, text: string, bg: string): void {
		const { canvas, ctx } = labelCanvas(320, 64);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 320, 64);
		ctx.strokeStyle = '#ffc107';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 314, 58);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 160, 32);
		const tex = labelTexture(canvas);
		const mat = c.label.material as THREE.SpriteMaterial;
		mat.map?.dispose();
		mat.map = tex;
		mat.needsUpdate = true;
	}

	private makeLabel(text: string, bg: string): THREE.Sprite {
		const { canvas, ctx } = labelCanvas(320, 64);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 320, 64);
		ctx.strokeStyle = '#ffc107';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 314, 58);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 160, 32);
		const tex = labelTexture(canvas);
		const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
		sp.scale.set(2.4, 0.5, 1);
		return sp;
	}

	private makeCar(color: number): THREE.Group {
		const g = new THREE.Group();
		const bodyM = this.track(lit({ color, roughness: 0.4, metalness: 0.4 }));
		const dark = this.track(lit({ color: 0x111111, roughness: 0.7, metalness: 0.4 }));
		const glass = this.track(
			lit({
				color: 0x90caf9,
				transparent: true,
				opacity: 0.5,
				roughness: 0.15,
			}),
		);
		const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.2), bodyM);
		body.position.y = 0.5;
		g.add(body);
		const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 2.1), glass);
		cabin.position.set(0, 0.95, -0.2);
		g.add(cabin);
		// Bumper stripe "RENTAL"
		const stripe = new THREE.Mesh(
			new THREE.BoxGeometry(1.7, 0.08, 0.05),
			this.track(
				lit({
					color: 0xffc107,
					emissive: 0xaa8800,
					emissiveIntensity: 0.3,
				}),
			),
		);
		stripe.position.set(0, 0.45, 2.1);
		g.add(stripe);
		// Headlights
		const lampM = this.track(new THREE.MeshBasicMaterial({ color: 0xfff59d, toneMapped: false }));
		for (const lz of [-0.55, 0.55]) {
			const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lampM);
			lamp.position.set(lz, 0.5, 2.05);
			g.add(lamp);
		}
		// Wheels
		for (const [wx, wz] of [
			[-0.9, 1.25],
			[0.9, 1.25],
			[-0.9, -1.25],
			[0.9, -1.25],
		] as const) {
			const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12), dark);
			w.rotation.z = Math.PI / 2;
			w.position.set(wx, 0.32, wz);
			w.userData['isWheel'] = true;
			g.add(w);
		}
		return g;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
