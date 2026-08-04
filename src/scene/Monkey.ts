import * as THREE from 'three';
import { levelAt } from '#/data/levels';
import type { CollisionWorld } from '#/physics/Collision';
import { type LitMaterial, lit } from '#/render/material';
import { ctx2d } from '#/util/dom';
import { labelCanvas, labelTexture } from '#/util/label';
import { at, pick } from '#/util/rand';

const GRAVITY = 18;
/** seconds of flight the monkey aims for — a proper lob, not a bullet */
const FLIGHT = 1.05;
const THROW_MIN = 5;
const THROW_MAX = 11;
const HIT_RADIUS = 0.55;
const MAX_SPLATS = 18;
const SPLAT_LIFE = 9;
/** Closer than this → monkey aims at you. Farther → gebedsruimte gets it. */
const PLAYER_RANGE = 13;

/** Gebedsruimte (see PrayerRoom.pos) — default target when you're a coward */
const PRAYER_POS = new THREE.Vector3(-31.5, 1.35, -19.5);

/** Palm-top perches around the atrium. */
const PERCHES: [number, number, number][] = [
	[4.2, 3.15, 0],
	[-4.2, 3.15, 0],
	[0, 3.05, -4.2],
	[0, 3.05, 4.2],
];

const FACE_YELLS = [
	'AU!!',
	'AUW M’N OGEN',
	'BAH 💩',
	'DIT IS NIET GOED!',
	'HELP DE KAK',
	'NIET COOL AAP',
	'STINK STINK',
	'STINKT HIER!!',
];

type Poop = {
	mesh: THREE.Object3D;
	vel: THREE.Vector3;
	alive: boolean;
	atPlayer: boolean;
	atPrayer: boolean;
	spin: number;
};

type Splat = { mesh: THREE.Mesh; life: number };

export type MonkeyHit = {
	what: 'player' | 'sim' | 'floor' | 'prayer';
	x: number;
	y: number;
	z: number;
	/** Shown on-screen when the player is hit */
	yell?: string;
};

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
	private faceYell: THREE.Sprite | null = null;
	private faceFade = 0;
	private yellFade = 0;
	private faceTex: THREE.CanvasTexture | null = null;
	private yellTex: THREE.CanvasTexture | null = null;

	private materials: THREE.Material[] = [];
	private poops: Poop[] = [];
	private splats: Splat[] = [];
	private poopMats: LitMaterial[] = [];

	private perch = 0;
	private cooldown = 4;
	private windup = -1;
	private t = 0;
	private simPositions: THREE.Vector3[] = [];
	private onHit: ((hit: MonkeyHit) => void) | null = null;
	private pendingTarget = new THREE.Vector3();
	private pendingAtPlayer = false;
	private pendingAtPrayer = false;
	/** scratch — update() runs 60×/s, it must not allocate */
	private tmp = new THREE.Vector3();

	constructor(world: CollisionWorld, camera: THREE.PerspectiveCamera) {
		this.world = world;
		this.camera = camera;
		this.group.name = 'monkey';

		// Soft, wet-looking dung palette (not a flat brown ball)
		this.poopMats = [
			this.track(
				lit({
					color: 0x3e2723,
					roughness: 0.92,
					metalness: 0.02,
				}),
			),
			this.track(
				lit({
					color: 0x5d4037,
					roughness: 0.88,
					metalness: 0.04,
				}),
			),
			this.track(
				lit({
					color: 0x4e342e,
					roughness: 0.95,
					metalness: 0,
				}),
			),
		];

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
	}

	// ── internals ──────────────────────────────────────────

	private sit(index: number): void {
		this.perch = index % PERCHES.length;
		const [x, y, z] = at(PERCHES, this.perch);
		this.group.position.set(x, y, z);
	}

	/** Look-at target for head tracking */
	private nearestVictim(): THREE.Vector3 | null {
		const origin = this.group.position;
		const player = this.camera.position;
		const pd = origin.distanceTo(player);
		if (pd < PLAYER_RANGE && levelAt(player.y) === 'v0') return player;
		// Far: stare at the prayer room while plotting
		return PRAYER_POS;
	}

	/**
	 * Close enough → you. Too far → bombard the gebedsruimte.
	 * Always returns true (the monkey always has a plan).
	 */
	private pickTarget(): boolean {
		const origin = this.group.position;
		const player = this.camera.position;
		const pd = origin.distanceTo(player);
		const playerInRange = pd < PLAYER_RANGE && levelAt(player.y) === 'v0';

		this.pendingAtPlayer = false;
		this.pendingAtPrayer = false;

		if (playerInRange) {
			this.pendingAtPlayer = true;
			this.pendingTarget.copy(player);
			this.pendingTarget.y = player.y - 0.1;
			return true;
		}

		// Maybe still hit a nearby sim, else prayer
		let bestSim: THREE.Vector3 | null = null;
		let bestD = 16;
		for (const s of this.simPositions) {
			const d = origin.distanceTo(s);
			if (d < bestD) {
				bestSim = s;
				bestD = d;
			}
		}
		if (bestSim && Math.random() < 0.35) {
			this.pendingTarget.copy(bestSim);
			this.pendingTarget.y += 1.2;
			return true;
		}

		// Default: fling dung at the gebedsruimte
		this.pendingAtPrayer = true;
		this.pendingTarget.copy(PRAYER_POS);
		this.pendingTarget.x += (Math.random() - 0.5) * 2.4;
		this.pendingTarget.z += (Math.random() - 0.5) * 1.8;
		this.pendingTarget.y = 0.9 + Math.random() * 1.4;
		return true;
	}

	/** Soft-serve style dung: stacked blobs, not a sad brown ball. */
	private makePoopMesh(): THREE.Group {
		const g = new THREE.Group();
		const layers = [
			{ y: 0.0, r: 0.13, s: 1.15 },
			{ y: 0.09, r: 0.11, s: 1.05 },
			{ y: 0.17, r: 0.085, s: 0.95 },
			{ y: 0.24, r: 0.055, s: 0.85 },
		];
		layers.forEach((L, i) => {
			const mat = at(this.poopMats, i);
			const blob = new THREE.Mesh(new THREE.SphereGeometry(L.r, 10, 8), mat);
			blob.position.y = L.y;
			blob.scale.set(L.s, 0.75 + Math.random() * 0.15, L.s * 0.95);
			blob.rotation.y = Math.random() * Math.PI;
			blob.castShadow = true;
			g.add(blob);
		});
		// Pointy tip curl
		const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 6), this.poopMats[0]);
		tip.position.set(0.02, 0.3, 0);
		tip.rotation.z = -0.4;
		g.add(tip);
		g.scale.setScalar(0.95 + Math.random() * 0.25);
		return g;
	}

	private throwPoop(): void {
		const origin = this.group.position.clone().add(new THREE.Vector3(0, 0.35, 0.25));
		const target = this.pendingTarget.clone();

		// Solve the lob: v = Δ/T + ½gT
		const flight = this.pendingAtPrayer ? 1.35 : FLIGHT;
		const vel = target.clone().sub(origin).divideScalar(flight);
		vel.y += 0.5 * GRAVITY * flight;
		// A monkey is not a sniper
		vel.x += (Math.random() - 0.5) * 0.9;
		vel.z += (Math.random() - 0.5) * 0.9;

		const mesh = this.makePoopMesh();
		mesh.position.copy(origin);
		this.group.parent?.add(mesh);
		this.poops.push({
			mesh,
			vel,
			alive: true,
			atPlayer: this.pendingAtPlayer,
			atPrayer: this.pendingAtPrayer,
			spin: 4 + Math.random() * 5,
		});
	}

	private tickPoops(dt: number): void {
		for (const p of this.poops) {
			if (!p.alive) continue;
			p.vel.y -= GRAVITY * dt;
			p.mesh.position.addScaledVector(p.vel, dt);
			p.mesh.rotation.x += dt * p.spin;
			p.mesh.rotation.z += dt * p.spin * 0.6;

			const pos = p.mesh.position;

			// Player hit (only if this turd was meant for you, or you're unlucky mid-air)
			if (pos.distanceTo(this.camera.position) < HIT_RADIUS + 0.35) {
				this.land(p, 'player', pos);
				continue;
			}
			// Prayer-room vicinity landing
			if (p.atPrayer) {
				const dx = pos.x - PRAYER_POS.x;
				const dz = pos.z - PRAYER_POS.z;
				if (dx * dx + dz * dz < 9 && levelAt(pos.y) === 'v0') {
					this.land(p, 'prayer', pos);
					continue;
				}
			}
			// Shopper hit
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

			const ground = this.world.groundHeightAt(pos.x, pos.z, pos.y, 3);
			if (pos.y <= ground + 0.1) {
				pos.y = ground + 0.02;
				this.land(p, p.atPrayer ? 'prayer' : 'floor', pos);
				continue;
			}
			if (pos.y < -4) this.land(p, 'floor', pos);
		}
		this.poops = this.poops.filter((p) => p.alive);
	}

	private land(p: Poop, what: MonkeyHit['what'], at: THREE.Vector3): void {
		p.alive = false;
		p.mesh.removeFromParent();
		this.addSplat(at, what);
		let yell: string | undefined;
		if (what === 'player') {
			yell = pick(FACE_YELLS);
			this.splatFace(yell);
		}
		this.onHit?.({ what, x: at.x, y: at.y, z: at.z, yell });
	}

	private makeSplatTexture(): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(128, 128);
		ctx.clearRect(0, 0, 128, 128);
		// Irregular dung puddle — several overlapping blobs
		const blobs = 7 + Math.floor(Math.random() * 5);
		for (let i = 0; i < blobs; i++) {
			const x = 40 + Math.random() * 48;
			const y = 40 + Math.random() * 48;
			const r = 14 + Math.random() * 28;
			const g = ctx.createRadialGradient(x, y, 2, x, y, r);
			g.addColorStop(0, 'rgba(62,39,35,0.95)');
			g.addColorStop(0.45, 'rgba(78,52,46,0.75)');
			g.addColorStop(1, 'rgba(62,39,35,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.ellipse(x, y, r, r * (0.55 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
			ctx.fill();
		}
		// Speckles
		ctx.fillStyle = 'rgba(30,20,15,0.5)';
		for (let i = 0; i < 20; i++) {
			ctx.beginPath();
			ctx.arc(30 + Math.random() * 70, 30 + Math.random() * 70, 1 + Math.random() * 2.5, 0, Math.PI * 2);
			ctx.fill();
		}
		const tex = labelTexture(c);
		return tex;
	}

	private addSplat(at: THREE.Vector3, what: MonkeyHit['what']): void {
		if (what === 'player') return;
		const ground = this.world.groundHeightAt(at.x, at.z, at.y, 3);
		const tex = this.makeSplatTexture();
		const mat = this.track(
			new THREE.MeshBasicMaterial({
				map: tex,
				transparent: true,
				opacity: 0.92,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.rotation.z = Math.random() * Math.PI;
		mesh.scale.setScalar(0.85 + Math.random() * 0.7);
		// Prayer hits leave a bigger insult
		if (what === 'prayer') mesh.scale.multiplyScalar(1.35);
		mesh.position.set(at.x, ground + 0.035, at.z);
		this.group.parent?.add(mesh);
		this.splats.push({ mesh, life: SPLAT_LIFE + (what === 'prayer' ? 3 : 0) });

		while (this.splats.length > MAX_SPLATS) {
			const old = this.splats.shift();
			old?.mesh.removeFromParent();
		}
	}

	private tickSplats(dt: number): void {
		for (const s of this.splats) {
			s.life -= dt;
			const mat = s.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = Math.max(0, Math.min(0.92, s.life / 2.5));
		}
		const dead = this.splats.filter((s) => s.life <= 0);
		for (const d of dead) d.mesh.removeFromParent();
		if (dead.length) this.splats = this.splats.filter((s) => s.life > 0);
	}

	/** Gooey face smear + floating AU / STINK text on the lens. */
	private splatFace(yell: string): void {
		if (!this.faceSplat) {
			const { canvas: c, ctx } = labelCanvas(256, 192);
			this.paintFaceGoo(ctx, 256, 192);
			this.faceTex = labelTexture(c);
			const mat = this.track(
				new THREE.MeshBasicMaterial({
					map: this.faceTex,
					transparent: true,
					opacity: 0,
					depthTest: false,
					depthWrite: false,
					toneMapped: false,
				}),
			);
			this.faceSplat = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), mat);
			this.faceSplat.renderOrder = 999;
			this.faceSplat.position.set(0.02, -0.04, -0.28);
			this.camera.add(this.faceSplat);
		} else if (this.faceTex) {
			const ctx = ctx2d(this.faceTex.image as HTMLCanvasElement);
			this.paintFaceGoo(ctx, 256, 192);
			this.faceTex.needsUpdate = true;
		}

		// Yell sprite
		if (!this.faceYell) {
			const { canvas: c } = labelCanvas(512, 128);
			this.yellTex = labelTexture(c);
			this.faceYell = new THREE.Sprite(
				this.track(
					new THREE.SpriteMaterial({
						map: this.yellTex,
						transparent: true,
						depthTest: false,
						depthWrite: false,
						toneMapped: false,
					}),
				),
			);
			this.faceYell.scale.set(0.9, 0.22, 1);
			this.faceYell.position.set(0, 0.12, -0.35);
			this.faceYell.renderOrder = 1000;
			this.camera.add(this.faceYell);
		}
		if (this.yellTex) {
			const c = this.yellTex.image as HTMLCanvasElement;
			const ctx = ctx2d(c);
			ctx.clearRect(0, 0, 512, 128);
			ctx.fillStyle = 'rgba(0,0,0,0.55)';
			ctx.beginPath();
			ctx.roundRect?.(40, 24, 432, 80, 16);
			if (!ctx.roundRect) ctx.fillRect(40, 24, 432, 80);
			else ctx.fill();
			ctx.fillStyle = '#ffeb3b';
			ctx.strokeStyle = '#b71c1c';
			ctx.lineWidth = 4;
			ctx.font = 'bold 48px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.strokeText(yell, 256, 64);
			ctx.fillText(yell, 256, 64);
			this.yellTex.needsUpdate = true;
		}

		this.faceFade = 3.2;
		this.yellFade = 2.6;
	}

	private paintFaceGoo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
		ctx.clearRect(0, 0, w, h);
		// Drips + globs — looks like actual face-dung, not a brown rectangle
		for (let i = 0; i < 12; i++) {
			const x = 30 + Math.random() * (w - 60);
			const y = 20 + Math.random() * (h * 0.55);
			const r = 18 + Math.random() * 40;
			const g = ctx.createRadialGradient(x, y, 2, x, y, r);
			g.addColorStop(0, 'rgba(78,52,46,0.95)');
			g.addColorStop(0.5, 'rgba(62,39,35,0.7)');
			g.addColorStop(1, 'rgba(40,25,20,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random(), 0, Math.PI * 2);
			ctx.fill();
		}
		// Vertical drips
		for (let i = 0; i < 6; i++) {
			const x = 40 + Math.random() * (w - 80);
			const y0 = 40 + Math.random() * 40;
			const len = 40 + Math.random() * 70;
			const g = ctx.createLinearGradient(x, y0, x, y0 + len);
			g.addColorStop(0, 'rgba(62,39,35,0.85)');
			g.addColorStop(1, 'rgba(62,39,35,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.ellipse(x, y0 + len * 0.4, 8 + Math.random() * 10, len * 0.5, 0, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private tickFace(dt: number): void {
		if (this.faceFade > 0) this.faceFade -= dt;
		if (this.yellFade > 0) this.yellFade -= dt;
		if (this.faceSplat) {
			const mat = this.faceSplat.material as THREE.MeshBasicMaterial;
			mat.opacity = Math.max(0, Math.min(0.95, this.faceFade * 0.45));
			this.faceSplat.visible = mat.opacity > 0.02;
			// Slight drip drift
			this.faceSplat.position.y = -0.04 - (3.2 - Math.max(0, this.faceFade)) * 0.015;
		}
		if (this.faceYell) {
			const mat = this.faceYell.material as THREE.SpriteMaterial;
			mat.opacity = Math.max(0, Math.min(1, this.yellFade));
			this.faceYell.visible = mat.opacity > 0.05;
			this.faceYell.position.y = 0.12 + Math.sin(performance.now() * 0.01) * 0.02;
		}
	}

	private approachAngle(from: number, to: number, step: number): number {
		let d = to - from;
		while (d > Math.PI) d -= Math.PI * 2;
		while (d < -Math.PI) d += Math.PI * 2;
		return from + THREE.MathUtils.clamp(d, -step, step);
	}

	private build(): void {
		const fur = this.track(lit({ color: 0x6d4c33, roughness: 0.9 }));
		const skin = this.track(lit({ color: 0xc79a7a, roughness: 0.8 }));
		const eye = this.track(lit({ color: 0x141414 }));

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
			const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.032 - i * 0.004, 0.14, 4, 6), fur);
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
