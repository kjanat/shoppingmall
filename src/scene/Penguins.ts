import * as THREE from 'three';
import type { CollisionWorld } from '@/physics/Collision';
import { ctx2d } from '@/util/dom';
import { fitText, labelCanvas, labelTexture } from '@/util/label';
import { pick } from '@/util/rand';
import { tagLevelCulled } from '@/util/visibility';

type Penguin = {
	root: THREE.Group;
	body: THREE.Object3D;
	wingL: THREE.Object3D;
	wingR: THREE.Object3D;
	/** wander target */
	tx: number;
	tz: number;
	yaw: number;
	speed: number;
	waddle: number;
	/** personal phase */
	phase: number;
	name: string;
	speech: THREE.Sprite;
	speechTex: THREE.CanvasTexture;
	speechCtx: CanvasRenderingContext2D;
	speechLife: number;
};

const NAMES = [
	'Chilly',
	'Fishbreath',
	'Glacier',
	'Happy Feet',
	'Kowalski',
	'Opus',
	'Pingu',
	'Private',
	'Rico',
	'Skipper',
	'Tux',
	'Waddles',
];

const CHIRPS = ['Noot noot!', '🐟?', 'Waddle waddle', 'Cold in the mall?', 'Where ice?', 'Honk', '🐧', 'Fish please'];

/**
 * Colony of low-poly penguins waddling the mall floor —
 * atrium ring + food-court drift. Harmless, adorable, slightly lost.
 */
export class Penguins {
	readonly group = new THREE.Group();
	private world: CollisionWorld;
	private birds: Penguin[] = [];
	private materials: THREE.Material[] = [];
	private chirpCd = 2;

	constructor(world: CollisionWorld, count = 10) {
		this.world = world;
		this.group.name = 'penguins';
		for (let i = 0; i < count; i++) {
			this.birds.push(this.spawn(i));
		}
	}

	get count(): number {
		return this.birds.length;
	}

	get roster(): { name: string; x: number; z: number }[] {
		return this.birds.map((b) => ({
			name: b.name,
			x: b.root.position.x,
			z: b.root.position.z,
		}));
	}

	update(dt: number): void {
		this.chirpCd -= dt;

		for (const p of this.birds) {
			const dx = p.tx - p.root.position.x;
			const dz = p.tz - p.root.position.z;
			const dist = Math.hypot(dx, dz);
			if (dist < 0.45) {
				this.pickTarget(p);
			} else {
				const ang = Math.atan2(dx, dz);
				let dy = ang - p.yaw;
				while (dy > Math.PI) dy -= Math.PI * 2;
				while (dy < -Math.PI) dy += Math.PI * 2;
				p.yaw += dy * Math.min(1, dt * 3.2);
				const step = p.speed * dt;
				let nx = p.root.position.x + Math.sin(p.yaw) * step;
				let nz = p.root.position.z + Math.cos(p.yaw) * step;
				const hit = this.world.resolveCircle(nx, nz, 0.4, 0.28, 3, true);
				if (Math.hypot(hit.x - nx, hit.z - nz) > 0.05) {
					// Bumped a wall — new target
					this.pickTarget(p);
				}
				nx = hit.x;
				nz = hit.z;
				const ground = this.world.groundHeightAt(nx, nz, 0.3, 2);
				// Stay on floor 0 mostly
				if (ground > 3.5) {
					this.pickTarget(p);
				} else {
					p.waddle += dt * (8 + p.speed * 2);
					const bob = Math.abs(Math.sin(p.waddle)) * 0.04;
					const lean = Math.sin(p.waddle) * 0.18;
					p.root.position.set(nx, ground + bob, nz);
					p.root.rotation.y = p.yaw;
					p.root.rotation.z = lean;
					// Wing flap
					const flap = Math.sin(p.waddle * 1.4 + p.phase) * 0.45;
					p.wingL.rotation.z = 0.5 + flap;
					p.wingR.rotation.z = -0.5 - flap;
					// Body rock
					p.body.rotation.x = Math.sin(p.waddle * 0.5) * 0.06;
				}
			}

			if (p.speechLife > 0) {
				p.speechLife -= dt;
				if (p.speechLife <= 0) p.speech.visible = false;
			}
		}

		// Occasional chirps
		if (this.chirpCd <= 0) {
			this.chirpCd = 1.8 + Math.random() * 3.5;
			const n = 1 + Math.floor(Math.random() * 3);
			for (let k = 0; k < n; k++) {
				if (!this.birds.length) break;
				this.say(pick(this.birds), pick(CHIRPS));
			}
		}
	}

	private pickTarget(p: Penguin): void {
		// Ring around atrium + food-courtish north strip
		const mode = Math.random();
		if (mode < 0.55) {
			const a = Math.random() * Math.PI * 2;
			const r = 8 + Math.random() * 14;
			p.tx = Math.cos(a) * r;
			p.tz = Math.sin(a) * r;
		} else if (mode < 0.8) {
			// Near food court / north
			p.tx = -8 + Math.random() * 20;
			p.tz = 8 + Math.random() * 10;
		} else {
			// SW utilities wander
			p.tx = -28 + Math.random() * 16;
			p.tz = -16 + Math.random() * 14;
		}
		// Clamp mall-ish
		p.tx = THREE.MathUtils.clamp(p.tx, -32, 32);
		p.tz = THREE.MathUtils.clamp(p.tz, -20, 20);
	}

	private say(p: Penguin, text: string): void {
		const ctx = p.speechCtx;
		const w = 200;
		const h = 56;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = 'rgba(15,23,42,0.92)';
		ctx.strokeStyle = '#38bdf8';
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.roundRect?.(6, 4, w - 12, h - 14, 8);
		if (!ctx.roundRect) ctx.rect(6, 4, w - 12, h - 14);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#e0f2fe';
		fitText(ctx, text, { x: 12, y: 6, w: w - 24, h: h - 24 }, { size: 18 });
		p.speechTex.needsUpdate = true;
		p.speech.visible = true;
		p.speechLife = 2.0 + Math.random();
	}

	private spawn(i: number): Penguin {
		const root = new THREE.Group();
		const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${i}` : '');

		const black = this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.75 }));
		const white = this.track(new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.85 }));
		const orange = this.track(new THREE.MeshStandardMaterial({ color: 0xff8f00, roughness: 0.55 }));
		const beakM = this.track(new THREE.MeshStandardMaterial({ color: 0xff6f00, roughness: 0.5 }));

		const body = new THREE.Group();
		// Torso egg
		const torso = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), black);
		torso.scale.set(0.85, 1.15, 0.9);
		torso.position.y = 0.38;
		body.add(torso);
		// White belly
		const belly = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), white);
		belly.scale.set(0.75, 1.0, 0.55);
		belly.position.set(0, 0.36, 0.1);
		body.add(belly);
		// Head
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), black);
		head.position.y = 0.62;
		body.add(head);
		// Eyes
		const eyeW = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
		const eyeB = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));
		for (const sx of [-1, 1] as const) {
			const ew = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeW);
			ew.position.set(sx * 0.05, 0.64, 0.1);
			body.add(ew);
			const eb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 5), eyeB);
			eb.position.set(sx * 0.05, 0.64, 0.125);
			body.add(eb);
		}
		// Beak
		const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), beakM);
		beak.rotation.x = Math.PI / 2;
		beak.position.set(0, 0.58, 0.16);
		body.add(beak);

		// Wings
		const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.14), black);
		wingL.position.set(-0.2, 0.4, 0);
		wingL.rotation.z = 0.5;
		const wingR = wingL.clone();
		wingR.position.x = 0.2;
		wingR.rotation.z = -0.5;
		body.add(wingL, wingR);

		// Feet
		for (const sx of [-1, 1] as const) {
			const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.14), orange);
			foot.position.set(sx * 0.08, 0.04, 0.04);
			body.add(foot);
		}

		// Tail stub
		const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), black);
		tail.position.set(0, 0.28, -0.16);
		body.add(tail);

		root.add(body);

		// Name
		const plate = this.makePlate(name, '#0c4a6e');
		plate.position.set(0, 0.95, 0);
		plate.scale.set(0.9, 0.22, 1);
		root.add(plate);
		tagLevelCulled(plate);

		// Speech
		const { canvas: sc, ctx: speechCtx } = labelCanvas(200, 56);
		const speechTex = labelTexture(sc);
		const speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: speechTex,
				transparent: true,
				depthTest: true,
			}),
		);
		speech.scale.set(1.1, 0.32, 1);
		speech.visible = false;
		// Two owners of one flag, so they get one each: the cull pass drives the
		// anchor, the chirp timer keeps driving the sprite.
		const speechAnchor = new THREE.Group();
		speechAnchor.position.set(0, 1.15, 0);
		speechAnchor.add(speech);
		root.add(speechAnchor);
		tagLevelCulled(speechAnchor);

		// Start pos around atrium
		const a = (i / 10) * Math.PI * 2 + Math.random();
		const r = 10 + Math.random() * 8;
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		const fixed = this.world.resolveCircle(x, z, 0.4, 0.28, 2, true);
		root.position.set(fixed.x, 0.05, fixed.z);

		this.group.add(root);

		const pen: Penguin = {
			root,
			body,
			wingL,
			wingR,
			tx: fixed.x,
			tz: fixed.z,
			yaw: Math.random() * Math.PI * 2,
			speed: 0.55 + Math.random() * 0.55,
			waddle: Math.random() * 10,
			phase: Math.random() * Math.PI * 2,
			name,
			speech,
			speechTex,
			speechCtx,
			speechLife: 0,
		};
		this.pickTarget(pen);
		return pen;
	}

	private makePlate(text: string, bg: string): THREE.Sprite {
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 64;
		const ctx = ctx2d(c);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 256, 64);
		ctx.strokeStyle = '#7dd3fc';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 250, 58);
		ctx.fillStyle = '#f0f9ff';
		ctx.font = 'bold 22px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 128, 32);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
