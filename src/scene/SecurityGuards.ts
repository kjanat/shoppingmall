import * as THREE from 'three';
import { spatial } from '@/audio/SpatialAudio';
import { level, levelAt } from '@/data/levels';
import type { CollisionWorld } from '@/physics/Collision';
import { ctx2d } from '@/util/dom';
import { fitText, labelCanvas, labelTexture } from '@/util/label';
import { at, pick } from '@/util/rand';
import { tagLevelCulled } from '@/util/visibility';

type GuardState = 'patrol' | 'alert' | 'firing';

type Guard = {
	root: THREE.Group;
	name: string;
	/** body yaw */
	yaw: number;
	state: GuardState;
	patrol: THREE.Vector3[];
	patrolI: number;
	/** lerp along patrol segment 0..1 */
	segT: number;
	/** cooldown before next paranoia scan */
	scanCd: number;
	/** cooldown between shots while firing */
	fireCd: number;
	/** how long to stay in alert/firing */
	stateT: number;
	/** current aim point */
	aim: THREE.Vector3;
	speech: THREE.Sprite;
	speechTex: THREE.CanvasTexture;
	speechCtx: CanvasRenderingContext2D;
	speechLife: number;
	muzzle: THREE.PointLight;
	gun: THREE.Group;
	/** arm for recoil */
	armR: THREE.Object3D;
	/** walk phase */
	legPhase: number;
	kills: number;
};

type Bullet = {
	mesh: THREE.Mesh;
	vx: number;
	vy: number;
	vz: number;
	life: number;
	/** who fired — for panic radius */
	origin: THREE.Vector3;
};

type Threat = { x: number; y: number; z: number; kind: string; weight: number };

const YELLS = [
	'2A, BABY!',
	'BACKUP! I NEED BACKUP!',
	'CODE RED — CODE RED!',
	'COMPLY OR DIE!',
	'DROP THE BAG!',
	'FREEZE! MALL SECURITY!',
	'HANDS UP!',
	'HE REACHED FOR HIS POCKET!',
	'HOSTILE SHOPPER!',
	'I FELT THREATENED!',
	'I SAW A THREAT!',
	'NO SUDDEN MOVES!',
	'PRAIRIE LAKES PD… ish!',
	'STOP RESISTING!',
	'SUSPICIOUS ACTIVITY!',
	'THAT LOOKED LIKE A GUN!',
	'THIS IS AMERICA!',
	'YOU LOOKED AT ME WEIRD!',
];

const NAMES = [
	'Agent Randy "Open Carry" Buck',
	'Deputy Chuck Freedom',
	'Officer Brad "Trigger" Kowalski',
	'Sgt. Liberty "Liberty" Jones',
];

/**
 * Typical American mall security — hypersensitive, hair-trigger, opens fire
 * on shadows, croissants, and mildly interesting body language.
 */
export class SecurityGuards {
	readonly group = new THREE.Group();
	private world: CollisionWorld;
	private guards: Guard[] = [];
	private bullets: Bullet[] = [];
	private materials: THREE.Material[] = [];
	private t = 0;
	private onOpenFire: ((msg: string) => void) | null = null;
	private onPlayerHit: ((dmg: number, guardName: string) => void) | null = null;
	private onSimPanic: ((origin: THREE.Vector3, radius: number) => void) | null = null;
	/** reusable */
	private tmp = new THREE.Vector3();
	private threats: Threat[] = [];

	constructor(world: CollisionWorld) {
		this.world = world;
		this.group.name = 'securityGuards';
		// Four posts around the atrium ring — classic mall cop coverage
		const routes: THREE.Vector3[][] = [
			[
				new THREE.Vector3(14, 0.15, 10),
				new THREE.Vector3(22, 0.15, 4),
				new THREE.Vector3(18, 0.15, -10),
				new THREE.Vector3(10, 0.15, -6),
			],
			[
				new THREE.Vector3(-14, 0.15, 10),
				new THREE.Vector3(-22, 0.15, 2),
				new THREE.Vector3(-18, 0.15, -10),
				new THREE.Vector3(-8, 0.15, -4),
			],
			[
				new THREE.Vector3(8, 0.15, -14),
				new THREE.Vector3(-8, 0.15, -16),
				new THREE.Vector3(-4, 0.15, 14),
				new THREE.Vector3(6, 0.15, 16),
			],
			// Floor 1 overwatch near Kruidvat / balcony
			[
				new THREE.Vector3(16, 6.15, 8),
				new THREE.Vector3(20, 6.15, -4),
				new THREE.Vector3(8, 6.15, -12),
				new THREE.Vector3(4, 6.15, 10),
			],
		];
		routes.forEach((route, i) => {
			this.guards.push(this.spawnGuard(NAMES[i] ?? `Officer ${i + 1}`, route));
		});
	}

	setOpenFireCallback(cb: (msg: string) => void): void {
		this.onOpenFire = cb;
	}

	setPlayerHitCallback(cb: (dmg: number, guardName: string) => void): void {
		this.onPlayerHit = cb;
	}

	/** Called when a volley should panic sims (App wires Americans.panicFromGunfire) */
	setSimPanicCallback(cb: (origin: THREE.Vector3, radius: number) => void): void {
		this.onSimPanic = cb;
	}

	get roster(): { name: string; state: string; kills: number; floor: string }[] {
		return this.guards.map((g) => ({
			name: g.name,
			state: g.state === 'firing' ? '🔫 OPENT VUUR' : g.state === 'alert' ? '⚠ hyperalert' : 'patrol',
			kills: g.kills,
			floor: level(levelAt(g.root.position.y)).code,
		}));
	}

	/**
	 * @param playerPos camera
	 * @param extras optional dynamic threats (thief, monkey, protest center…)
	 */
	update(dt: number, playerPos: THREE.Vector3, extras: Threat[] = []): void {
		this.t += dt;
		this.threats.length = 0;
		// Player is always a potential "threat" if they breathe too hard
		this.threats.push({
			x: playerPos.x,
			y: playerPos.y,
			z: playerPos.z,
			kind: 'player',
			weight: 1.4,
		});
		for (const e of extras) this.threats.push(e);

		for (const g of this.guards) {
			this.tickGuard(g, dt, playerPos);
			if (g.speechLife > 0) {
				g.speechLife -= dt;
				if (g.speechLife <= 0) g.speech.visible = false;
			}
		}

		this.tickBullets(dt, playerPos);
	}

	private tickGuard(g: Guard, dt: number, playerPos: THREE.Vector3): void {
		g.scanCd -= dt;
		g.fireCd -= dt;
		g.stateT -= dt;
		g.legPhase += dt * (g.state === 'firing' ? 0 : 8);

		// Hypersensitive scan — almost anything nearby sets them off
		if (g.scanCd <= 0 && g.state === 'patrol') {
			g.scanCd = 0.18 + Math.random() * 0.25;
			const hit = this.nearestThreat(g, 11);
			// Random paranoia: "I sensed hostility"
			const paranoid = Math.random() < 0.012;
			if (hit || paranoid) {
				const t = hit ?? {
					x: g.root.position.x + (Math.random() - 0.5) * 6,
					y: g.root.position.y + 1.4,
					z: g.root.position.z + (Math.random() - 0.5) * 6,
					kind: 'shadow',
					weight: 0.5,
				};
				g.aim.set(t.x, t.y, t.z);
				g.state = 'alert';
				g.stateT = 0.35 + Math.random() * 0.4;
				this.say(g, pick(YELLS));
			}
		}

		if (g.state === 'alert' && g.stateT <= 0) {
			// Half a second of "feeling threatened" → open fire. Always.
			g.state = 'firing';
			g.stateT = 1.6 + Math.random() * 1.4;
			g.fireCd = 0;
			g.kills += 1;
			this.say(g, pick(YELLS));
			this.onOpenFire?.(`🚔 ${shortName(g.name)}: ${pick(YELLS)} — opent vuur!`);
			// Instant crowd panic at muzzle
			this.onSimPanic?.(g.root.position.clone().setY(g.root.position.y + 1.2), 12);
		}

		if (g.state === 'firing') {
			// Re-acquire constantly (still hypersensitive mid-spray)
			const hit = this.nearestThreat(g, 16);
			if (hit) g.aim.set(hit.x, hit.y, hit.z);
			this.faceToward(g, g.aim.x, g.aim.z);
			// Recoil arm
			g.armR.rotation.x = -0.55 + Math.sin(this.t * 40) * 0.12;
			g.muzzle.intensity = 0;
			if (g.fireCd <= 0) {
				g.fireCd = 0.11 + Math.random() * 0.08;
				this.fireBullet(g);
				g.muzzle.intensity = 14;
				// Chance to yell every few shots
				if (Math.random() < 0.22) this.say(g, pick(YELLS));
			} else {
				g.muzzle.intensity = Math.max(0, g.muzzle.intensity - dt * 60);
			}
			if (g.stateT <= 0) {
				g.state = 'patrol';
				g.scanCd = 0.8 + Math.random() * 1.2;
				g.armR.rotation.x = -0.35;
				g.muzzle.intensity = 0;
			}
			return; // don't patrol while spraying
		}

		// Patrol walk
		this.patrolStep(g, dt);
		// Idle holster pose
		g.armR.rotation.x = -0.35 + Math.sin(this.t * 2 + g.legPhase) * 0.05;
		g.muzzle.intensity = 0;

		// Face walk direction already set in patrolStep
		void playerPos;
	}

	private nearestThreat(g: Guard, maxDist: number): Threat | null {
		const px = g.root.position.x;
		const py = g.root.position.y;
		const pz = g.root.position.z;
		let best: Threat | null = null;
		let bestScore = Infinity;
		for (const t of this.threats) {
			// Same-ish floor only
			if (Math.abs(t.y - (py + 1.4)) > 3.5 && Math.abs(t.y - py) > 3.5) continue;
			const d = Math.hypot(t.x - px, t.z - pz);
			if (d > maxDist) continue;
			// Closer + higher weight = more "threatening"
			const score = d / Math.max(0.3, t.weight);
			if (score < bestScore) {
				bestScore = score;
				best = t;
			}
		}
		return best;
	}

	private patrolStep(g: Guard, dt: number): void {
		const a = at(g.patrol, g.patrolI);
		const b = at(g.patrol, g.patrolI + 1);
		const dist = Math.hypot(b.x - a.x, b.z - a.z) || 1;
		const speed = 1.35; // m/s — mall cop power walk
		g.segT += (dt * speed) / dist;
		if (g.segT >= 1) {
			g.segT = 0;
			g.patrolI = (g.patrolI + 1) % g.patrol.length;
		}
		const x = THREE.MathUtils.lerp(a.x, b.x, g.segT);
		const z = THREE.MathUtils.lerp(a.z, b.z, g.segT);
		const y = a.y; // routes stay on one floor
		const fixed = this.world.resolveCircle(x, z, y + 1, 0.4);
		const bob = Math.abs(Math.sin(g.legPhase)) * 0.04;
		g.root.position.set(fixed.x, y + bob, fixed.z);
		this.faceToward(g, b.x, b.z);
	}

	private faceToward(g: Guard, x: number, z: number): void {
		const dx = x - g.root.position.x;
		const dz = z - g.root.position.z;
		if (dx * dx + dz * dz < 1e-4) return;
		const target = Math.atan2(dx, dz);
		let dy = target - g.yaw;
		while (dy > Math.PI) dy -= Math.PI * 2;
		while (dy < -Math.PI) dy += Math.PI * 2;
		g.yaw += dy * 0.22;
		g.root.rotation.y = g.yaw;
	}

	private fireBullet(g: Guard): void {
		const origin = g.root.position.clone();
		origin.y += 1.35;
		// Muzzle offset along facing
		const fx = Math.sin(g.yaw);
		const fz = Math.cos(g.yaw);
		origin.x += fx * 0.55;
		origin.z += fz * 0.55;

		// Binaural muzzle crack — left/right tells you which cop is spraying
		this.playGunshot(origin.x, origin.y, origin.z);

		// Aim with wild spray — "trained" Americans
		this.tmp.copy(g.aim).sub(origin);
		if (this.tmp.lengthSq() < 0.01) this.tmp.set(fx, 0, fz);
		this.tmp.normalize();
		// cone of inaccuracy
		this.tmp.x += (Math.random() - 0.5) * 0.18;
		this.tmp.y += (Math.random() - 0.5) * 0.1;
		this.tmp.z += (Math.random() - 0.5) * 0.18;
		this.tmp.normalize();

		const speed = 28 + Math.random() * 8;
		const mat = this.track(
			new THREE.MeshBasicMaterial({
				color: 0xffeb3b,
				toneMapped: false,
			}),
		);
		const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), mat);
		mesh.position.copy(origin);
		this.group.add(mesh);
		this.bullets.push({
			mesh,
			vx: this.tmp.x * speed,
			vy: this.tmp.y * speed,
			vz: this.tmp.z * speed,
			life: 0.85,
			origin: origin.clone(),
		});

		// Tracer streak (short-lived cylinder)
		const streak = new THREE.Mesh(
			new THREE.CylinderGeometry(0.02, 0.02, 0.45, 4),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0xffc107,
					toneMapped: false,
					transparent: true,
					opacity: 0.85,
				}),
			),
		);
		streak.position.copy(origin);
		streak.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmp.clone().normalize());
		this.group.add(streak);
		// reuse bullet life for streak cleanup via same list entry? separate quick kill:
		window.setTimeout(() => {
			this.group.remove(streak);
			(streak.material as THREE.Material).dispose();
			streak.geometry.dispose();
		}, 80);
	}

	private tickBullets(dt: number, playerPos: THREE.Vector3): void {
		for (let i = this.bullets.length - 1; i >= 0; i--) {
			const b = this.bullets[i];
			if (!b) continue;
			b.life -= dt;
			b.mesh.position.x += b.vx * dt;
			b.mesh.position.y += b.vy * dt;
			b.mesh.position.z += b.vz * dt;
			// gravity-ish drop
			b.vy -= 4 * dt;

			// Player hit (generous capsule)
			const dx = b.mesh.position.x - playerPos.x;
			const dy = b.mesh.position.y - playerPos.y;
			const dz = b.mesh.position.z - playerPos.z;
			if (dx * dx + dz * dz < 0.55 * 0.55 && Math.abs(dy) < 1.4) {
				this.onPlayerHit?.(8, 'Mall Security');
				// small panic ring
				this.onSimPanic?.(b.origin, 8);
				b.life = 0;
			}

			// Floor / ceiling kill
			if (b.mesh.position.y < -1 || b.mesh.position.y > 20) b.life = 0;

			if (b.life <= 0) {
				this.group.remove(b.mesh);
				(b.mesh.material as THREE.Material).dispose();
				b.mesh.geometry.dispose();
				this.bullets.splice(i, 1);
			}
		}
	}

	/** Short noise burst through HRTF panner */
	private playGunshot(x: number, y: number, z: number): void {
		try {
			const ctx = spatial.ensure();
			const dur = 0.09;
			const n = Math.floor(ctx.sampleRate * dur);
			const buf = ctx.createBuffer(1, n, ctx.sampleRate);
			const d = buf.getChannelData(0);
			for (let i = 0; i < n; i++) {
				const t = i / n;
				// Crack → body thump
				const env = Math.exp(-t * 38) * (1 - t * 0.3);
				d[i] = (Math.random() * 2 - 1) * env;
			}
			void spatial.playAt(
				buf,
				{ x, y, z },
				{
					volume: 0.55,
					k: 0.04,
					maxDistance: 40,
					refDistance: 2,
				},
			);
		} catch {
			/* audio locked */
		}
	}

	private say(g: Guard, text: string): void {
		const ctx = g.speechCtx;
		const w = 360;
		const h = 80;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = 'rgba(20,20,20,0.94)';
		ctx.strokeStyle = '#f5c518';
		ctx.lineWidth = 5;
		roundRect(ctx, 8, 4, w - 16, h - 16, 10);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#ff5252';
		fitText(ctx, text, { x: 14, y: 6, w: w - 28, h: h - 26 }, { size: 20 });
		g.speechTex.needsUpdate = true;
		g.speech.visible = true;
		g.speechLife = 2.0 + Math.random() * 0.8;
	}

	private spawnGuard(name: string, patrol: THREE.Vector3[]): Guard {
		const root = new THREE.Group();
		const start = at(patrol, 0).clone();
		root.position.copy(start);

		const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xe0a878, roughness: 0.88 }));
		const navy = this.track(new THREE.MeshStandardMaterial({ color: 0x1a237e, roughness: 0.75 }));
		const vest = this.track(new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.7, metalness: 0.15 }));
		const black = this.track(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, metalness: 0.3 }));
		const gold = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xffd54f,
				metalness: 0.7,
				roughness: 0.35,
			}),
		);

		// Boots
		for (const sx of [-0.12, 0.12]) {
			const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.22), black);
			boot.position.set(sx, 0.08, 0.02);
			root.add(boot);
		}
		// Legs
		for (const sx of [-0.12, 0.12]) {
			const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.4, 3, 6), navy);
			leg.position.set(sx, 0.42, 0);
			root.add(leg);
		}
		// Torso
		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 8), navy);
		body.position.y = 1.05;
		root.add(body);
		// Tactical vest
		const vestM = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.28), vest);
		vestM.position.y = 1.15;
		root.add(vestM);
		// Badge
		const badge = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8), gold);
		badge.position.set(0.16, 1.25, 0.16);
		root.add(badge);
		// "SECURITY" plate. Clear of the torso capsule, which bulges out to
		// z 0.219 at this height: a sprite takes its centre's depth, so at 0.16
		// the depth test let the belly eat the middle of the word.
		const plate = this.makePlate('SECURITY', '#111', '#f5c518');
		plate.position.set(0, 1.35, 0.24);
		plate.scale.set(0.55, 0.14, 1);
		root.add(plate);

		// Head
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
		head.position.y = 1.62;
		root.add(head);
		// Sunglasses
		const shades = new THREE.Mesh(
			new THREE.BoxGeometry(0.22, 0.06, 0.04),
			this.track(new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.2 })),
		);
		shades.position.set(0, 1.64, 0.14);
		root.add(shades);
		// Buzzcut / high-and-tight
		const hair = new THREE.Mesh(
			new THREE.SphereGeometry(0.165, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 })),
		);
		hair.position.set(0, 1.68, 0);
		root.add(hair);
		// Earpiece
		const ear = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), black);
		ear.position.set(0.16, 1.62, 0);
		root.add(ear);

		// Left arm (radio pose)
		const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.35, 3, 6), navy);
		armL.position.set(-0.32, 1.15, 0.05);
		armL.rotation.z = 0.4;
		armL.rotation.x = 0.5;
		root.add(armL);
		// Radio on shoulder
		const radio = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06), black);
		radio.position.set(-0.28, 1.4, 0.05);
		root.add(radio);

		// Right arm + gun group
		const armR = new THREE.Group();
		armR.position.set(0.3, 1.25, 0.08);
		armR.rotation.x = -0.35;
		const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.32, 3, 6), navy);
		upper.position.set(0, -0.1, 0);
		armR.add(upper);
		const gun = new THREE.Group();
		gun.position.set(0.02, -0.35, 0.18);
		// Pistol body
		const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.28), black);
		slide.position.set(0, 0.04, 0.08);
		gun.add(slide);
		const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), black);
		grip.position.set(0, -0.04, 0);
		gun.add(grip);
		const muzzleFlash = new THREE.PointLight(0xffab00, 0, 4, 2);
		muzzleFlash.position.set(0, 0.05, 0.28);
		gun.add(muzzleFlash);
		armR.add(gun);
		root.add(armR);

		// Name plate
		const nameSp = this.makePlate(shortName(name), '#0d47a1', '#fff');
		nameSp.position.set(0, 2.05, 0);
		nameSp.scale.set(1.4, 0.28, 1);
		root.add(nameSp);
		tagLevelCulled(nameSp);

		// Speech bubble
		const { canvas: sc, ctx: speechCtx } = labelCanvas(360, 80);
		const speechTex = labelTexture(sc);
		const speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: speechTex,
				transparent: true,
				depthTest: true,
			}),
		);
		speech.scale.set(2.2, 0.5, 1);
		speech.position.set(0, 2.35, 0);
		speech.visible = false;
		// The deck cull owns the holder's `visible`, so `speechLife` keeps owning the sprite's.
		const speechHolder = new THREE.Group();
		speechHolder.add(speech);
		root.add(speechHolder);
		tagLevelCulled(speechHolder);

		this.group.add(root);

		return {
			root,
			name,
			yaw: 0,
			state: 'patrol',
			patrol,
			patrolI: 0,
			segT: 0,
			scanCd: Math.random() * 1.5,
			fireCd: 0,
			stateT: 0,
			aim: start.clone().add(new THREE.Vector3(0, 1.4, 1)),
			speech,
			speechTex,
			speechCtx,
			speechLife: 0,
			muzzle: muzzleFlash,
			gun,
			armR,
			legPhase: Math.random() * 10,
			kills: 0,
		};
	}

	private makePlate(text: string, bg: string, fg: string): THREE.Sprite {
		const { canvas: c, ctx } = labelCanvas(320, 64);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 320, 64);
		ctx.strokeStyle = '#f5c518';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 314, 58);
		ctx.fillStyle = fg;
		ctx.font = 'bold 22px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 160, 32);
		const tex = labelTexture(c);
		return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}

function shortName(full: string): string {
	// "Officer Brad \"Trigger\" Kowalski" → "Trigger" or first meaningful token
	const nickname = full.match(/"([^"]+)"/)?.[1];
	if (nickname) return nickname;
	const parts = full.split(/\s+/);
	return parts[parts.length - 1] ?? full;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
