import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';

const GRAVITY = 18;
/** seconds of flight the monkey aims for — a proper lob, not a bullet */
const FLIGHT = 1.05;
const THROW_MIN = 5;
const THROW_MAX = 11;
const HIT_RADIUS = 0.55;
const MAX_SPLATS = 14;
const SPLAT_LIFE = 7;

/** Palm-top perches around the atrium. */
const PERCHES: [number, number, number][] = [
	[4.2, 3.15, 0],
	[-4.2, 3.15, 0],
	[0, 3.05, -4.2],
	[0, 3.05, 4.2],
];

type Poop = {
	mesh: THREE.Mesh;
	vel: THREE.Vector3;
	alive: boolean;
	/** aimed at the player rather than a shopper */
	atPlayer: boolean;
};

type Splat = { mesh: THREE.Mesh; life: number };

export type MonkeyHit = { what: 'player' | 'sim' | 'floor'; x: number; y: number; z: number };

/**
 * Atrium monkey. Sits in a palm, judges you, throws its own shit.
 *
 * Targets the player when you're in the atrium, otherwise picks a shopper.
 * Poop is a real ballistic arc with a splat decal on landing.
 */
export class Monkey {
	readonly group = new THREE.Group();
	private world: CollisionWorld;
	private camera: THREE.PerspectiveCamera;

	private body = new THREE.Group();
	private head = new THREE.Group();
	private armR = new THREE.Group();
	private tail = new THREE.Group();
	private faceSplat: THREE.Mesh | null = null;
	private faceFade = 0;

	private materials: THREE.Material[] = [];
	private poops: Poop[] = [];
	private splats: Splat[] = [];
	private poopGeo = new THREE.SphereGeometry(0.11, 8, 6);
	private poopMat: THREE.MeshStandardMaterial;
	private splatGeo = new THREE.CircleGeometry(0.34, 12);
	private splatMat: THREE.MeshStandardMaterial;

	private perch = 0;
	private cooldown = 4;
	private windup = -1;
	private t = 0;
	private simPositions: THREE.Vector3[] = [];
	private onHit: ((hit: MonkeyHit) => void) | null = null;
	private pendingTarget = new THREE.Vector3();
	private pendingAtPlayer = false;
	/** scratch — update() runs 60×/s, it must not allocate */
	private tmp = new THREE.Vector3();

	constructor(world: CollisionWorld, camera: THREE.PerspectiveCamera) {
		this.world = world;
		this.camera = camera;
		this.group.name = 'monkey';

		this.poopMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.95 }),
		);
		this.splatMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x4a2f18,
				roughness: 1,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
			}),
		);

		this.build();
		this.group.add(this.body);
		this.sit(0);
	}

	setHitCallback(fn: (hit: MonkeyHit) => void): void {
		this.onHit = fn;
	}

	/** App feeds shopper positions each frame so the monkey can pick a victim. */
	setSimPositions(list: THREE.Vector3[]): void {
		this.simPositions = list;
	}

	/** Manual provocation (the J key). */
	provoke(): boolean {
		if (this.windup > 0) return false;
		if (!this.pickTarget()) return false;
		this.windup = 0.45;
		this.cooldown = THROW_MIN + Math.random() * (THROW_MAX - THROW_MIN);
		return true;
	}

	update(dt: number): void {
		this.t += dt;

		// Idle life: breathing bob, tail sway, head tracks the nearest victim
		this.body.position.y = Math.sin(this.t * 2.1) * 0.035;
		this.tail.rotation.x = Math.sin(this.t * 1.6) * 0.35 - 0.5;
		this.tail.rotation.z = Math.cos(this.t * 1.1) * 0.2;

		const look = this.nearestVictim();
		if (look) {
			this.body.getWorldPosition(this.tmp);
			const want = Math.atan2(look.x - this.tmp.x, look.z - this.tmp.z);
			this.body.rotation.y = this.approachAngle(this.body.rotation.y, want, dt * 3);
			this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, -0.1, 0.1);
		}

		// Wind up → release
		if (this.windup > 0) {
			this.windup -= dt;
			this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -2.4, 0.25);
			if (this.windup <= 0) {
				this.throwPoop();
				this.windup = -1;
			}
		} else {
			this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -0.15, 0.12);
			this.cooldown -= dt;
			if (this.cooldown <= 0) {
				// Hop to another palm now and then, for the drama
				if (Math.random() < 0.4) this.sit((this.perch + 1 + Math.floor(Math.random() * 3)) % PERCHES.length);
				if (this.pickTarget()) {
					this.windup = 0.45;
					this.cooldown = THROW_MIN + Math.random() * (THROW_MAX - THROW_MIN);
				} else {
					this.cooldown = 2;
				}
			}
		}

		this.tickPoops(dt);
		this.tickSplats(dt);
		this.tickFace(dt);
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		this.poopGeo.dispose();
		this.splatGeo.dispose();
	}

	// ── internals ──────────────────────────────────────────

	private sit(index: number): void {
		this.perch = index % PERCHES.length;
		const [x, y, z] = PERCHES[this.perch];
		this.group.position.set(x, y, z);
	}

	private nearestVictim(): THREE.Vector3 | null {
		const origin = this.group.position;
		const player = this.camera.position;
		let best: THREE.Vector3 | null = null;
		let bestD = Infinity;
		// Player counts double — the monkey has priorities
		const pd = origin.distanceTo(player) * 0.5;
		if (pd < 26) {
			best = player;
			bestD = pd;
		}
		for (const s of this.simPositions) {
			const d = origin.distanceTo(s);
			if (d < bestD && d < 22) {
				best = s;
				bestD = d;
			}
		}
		return best;
	}

	private pickTarget(): boolean {
		const victim = this.nearestVictim();
		if (!victim) return false;
		this.pendingAtPlayer = victim === this.camera.position;
		// Lead the shot a little so it lands where they're heading
		this.pendingTarget.copy(victim);
		if (this.pendingAtPlayer) this.pendingTarget.y = this.camera.position.y - 0.15;
		return true;
	}

	private throwPoop(): void {
		const origin = this.group.position.clone().add(new THREE.Vector3(0, 0.35, 0.25));
		const target = this.pendingTarget.clone();

		// Solve the lob: v = Δ/T + ½gT
		const vel = target.clone().sub(origin).divideScalar(FLIGHT);
		vel.y += 0.5 * GRAVITY * FLIGHT;
		// A monkey is not a sniper
		vel.x += (Math.random() - 0.5) * 0.9;
		vel.z += (Math.random() - 0.5) * 0.9;

		const mesh = new THREE.Mesh(this.poopGeo, this.poopMat);
		mesh.position.copy(origin);
		mesh.castShadow = true;
		this.group.parent?.add(mesh);
		this.poops.push({ mesh, vel, alive: true, atPlayer: this.pendingAtPlayer });
	}

	private tickPoops(dt: number): void {
		for (const p of this.poops) {
			if (!p.alive) continue;
			p.vel.y -= GRAVITY * dt;
			p.mesh.position.addScaledVector(p.vel, dt);
			p.mesh.rotation.x += dt * 6;

			const pos = p.mesh.position;

			// Player hit?
			if (pos.distanceTo(this.camera.position) < HIT_RADIUS + 0.25) {
				this.land(p, 'player', pos);
				continue;
			}
			// Shopper hit? (chest height, so aim at pos + 1.2)
			let hitSim = false;
			for (const s of this.simPositions) {
				const dx = pos.x - s.x;
				const dz = pos.z - s.z;
				const dy = pos.y - (s.y + 1.2);
				if (dx * dx + dz * dz + dy * dy < HIT_RADIUS * HIT_RADIUS * 2) {
					this.land(p, 'sim', pos);
					hitSim = true;
					break;
				}
			}
			if (hitSim) continue;

			// Floor / slab
			const ground = this.world.groundHeightAt(pos.x, pos.z, pos.y, 3);
			if (pos.y <= ground + 0.1) {
				pos.y = ground + 0.02;
				this.land(p, 'floor', pos);
				continue;
			}
			// Fell out of the world
			if (pos.y < -4) this.land(p, 'floor', pos);
		}
		this.poops = this.poops.filter((p) => p.alive);
	}

	private land(p: Poop, what: MonkeyHit['what'], at: THREE.Vector3): void {
		p.alive = false;
		p.mesh.removeFromParent();
		this.addSplat(at, what);
		if (what === 'player') this.splatFace();
		this.onHit?.({ what, x: at.x, y: at.y, z: at.z });
	}

	private addSplat(at: THREE.Vector3, what: MonkeyHit['what']): void {
		// Splats only stick to the floor, not to faces
		if (what === 'player') return;
		const ground = this.world.groundHeightAt(at.x, at.z, at.y, 3);
		const mesh = new THREE.Mesh(this.splatGeo, this.splatMat.clone());
		this.materials.push(mesh.material as THREE.Material);
		mesh.rotation.x = -Math.PI / 2;
		mesh.rotation.z = Math.random() * Math.PI;
		mesh.scale.setScalar(0.7 + Math.random() * 0.6);
		mesh.position.set(at.x, ground + 0.03, at.z);
		this.group.parent?.add(mesh);
		this.splats.push({ mesh, life: SPLAT_LIFE });

		while (this.splats.length > MAX_SPLATS) {
			const old = this.splats.shift();
			old?.mesh.removeFromParent();
		}
	}

	private tickSplats(dt: number): void {
		for (const s of this.splats) {
			s.life -= dt;
			const mat = s.mesh.material as THREE.MeshStandardMaterial;
			mat.opacity = Math.max(0, Math.min(0.85, s.life / 2));
		}
		const dead = this.splats.filter((s) => s.life <= 0);
		for (const d of dead) d.mesh.removeFromParent();
		if (dead.length) this.splats = this.splats.filter((s) => s.life > 0);
	}

	/** Brown smear across the lens when it gets you in the face. */
	private splatFace(): void {
		if (!this.faceSplat) {
			const geo = new THREE.PlaneGeometry(0.42, 0.3);
			const mat = this.track(
				new THREE.MeshBasicMaterial({
					color: 0x4a2f18,
					transparent: true,
					opacity: 0,
					depthTest: false,
					depthWrite: false,
				}),
			);
			this.faceSplat = new THREE.Mesh(geo, mat);
			this.faceSplat.renderOrder = 999;
			this.faceSplat.position.set(0.04, -0.02, -0.32);
			this.camera.add(this.faceSplat);
		}
		this.faceFade = 2.4;
	}

	private tickFace(dt: number): void {
		if (!this.faceSplat) return;
		if (this.faceFade > 0) this.faceFade -= dt;
		const mat = this.faceSplat.material as THREE.MeshBasicMaterial;
		mat.opacity = Math.max(0, Math.min(0.9, this.faceFade));
		this.faceSplat.visible = mat.opacity > 0.01;
	}

	private approachAngle(from: number, to: number, step: number): number {
		let d = to - from;
		while (d > Math.PI) d -= Math.PI * 2;
		while (d < -Math.PI) d += Math.PI * 2;
		return from + THREE.MathUtils.clamp(d, -step, step);
	}

	private build(): void {
		const fur = this.track(
			new THREE.MeshStandardMaterial({ color: 0x6d4c33, roughness: 0.9 }),
		);
		const skin = this.track(
			new THREE.MeshStandardMaterial({ color: 0xc79a7a, roughness: 0.8 }),
		);
		const eye = this.track(new THREE.MeshStandardMaterial({ color: 0x141414 }));

		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.22, 4, 8), fur);
		torso.position.y = 0.3;
		torso.castShadow = true;
		this.body.add(torso);

		this.head.position.set(0, 0.62, 0);
		this.body.add(this.head);
		const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), fur);
		skull.castShadow = true;
		this.head.add(skull);
		const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skin);
		muzzle.scale.set(1, 0.8, 0.85);
		muzzle.position.set(0, -0.04, 0.13);
		this.head.add(muzzle);
		for (const sx of [-1, 1]) {
			const ear = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
			ear.position.set(sx * 0.155, 0.02, 0);
			ear.scale.set(0.5, 1, 1);
			this.head.add(ear);
			const e = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), eye);
			e.position.set(sx * 0.055, 0.035, 0.14);
			this.head.add(e);
		}

		// Left arm rests, right arm throws
		const armGeo = new THREE.CapsuleGeometry(0.045, 0.2, 4, 6);
		const armL = new THREE.Mesh(armGeo, fur);
		armL.position.set(-0.2, 0.36, 0);
		armL.rotation.z = 0.5;
		this.body.add(armL);

		this.armR.position.set(0.2, 0.42, 0);
		this.body.add(this.armR);
		const upper = new THREE.Mesh(armGeo, fur);
		upper.position.y = -0.1;
		this.armR.add(upper);
		const fist = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin);
		fist.position.y = -0.22;
		this.armR.add(fist);

		for (const sx of [-1, 1]) {
			const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 4, 6), fur);
			leg.position.set(sx * 0.1, 0.08, 0.04);
			leg.rotation.x = -0.6;
			this.body.add(leg);
		}

		// Tail: a few segments so the sway reads
		this.tail.position.set(0, 0.22, -0.14);
		this.body.add(this.tail);
		let parent: THREE.Object3D = this.tail;
		for (let i = 0; i < 4; i++) {
			const seg = new THREE.Mesh(
				new THREE.CapsuleGeometry(0.032 - i * 0.004, 0.14, 4, 6),
				fur,
			);
			seg.position.y = -0.1;
			seg.rotation.x = 0.25;
			parent.add(seg);
			parent = seg;
		}
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
