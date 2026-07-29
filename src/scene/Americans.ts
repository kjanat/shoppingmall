import * as THREE from 'three';
import { type StoreDef, STORES } from '../data/stores';
import { Pathfinder } from '../path/Pathfinder';

export type SimFactors = {
	id: number;
	name: string;
	thicc: number;
	speed: number;
	stride: number;
	stomp: number;
	restless: number;
	windowShop: number;
	mood: 'chill' | 'hangry' | 'hyped' | 'lost' | 'on_mission';
	/** Current destination shop display name */
	targetShop: string;
	targetShopId: string;
	/** € already blown in the mall */
	moneySpent: number;
	/** 0–100 unhappiness */
	unhappiness: number;
	bag: string | null;
	shirt: number;
	pants: number;
	skin: number;
	hair: number;
	hasCap: boolean;
	isBrad: boolean;
	/** seconds until next possible fart */
	fartCd: number;
};

type Limb = {
	group: THREE.Group;
	hip: THREE.Group;
	knee: THREE.Group;
	foot: THREE.Mesh;
};

type Sim = {
	f: SimFactors;
	root: THREE.Group;
	body: THREE.Group;
	legL: Limb;
	legR: Limb;
	armL: THREE.Object3D;
	armR: THREE.Object3D;
	label: THREE.Sprite;
	pos: THREE.Vector3;
	/** unit direction of travel — THE VECTOR */
	velocity: THREE.Vector3;
	path: THREE.Vector3[];
	pathI: number;
	wait: number;
	phase: number;
	shopId: string;
	labelCanvas: HTMLCanvasElement;
	labelCtx: CanvasRenderingContext2D;
	labelTex: THREE.CanvasTexture;
};

const FIRST = [
	'Brad',
	'Chad',
	'Kyle',
	'Derek',
	'Troy',
	'Brett',
	'Craig',
	'Gary',
	'Linda',
	'Karen',
	'Sharon',
	'Becky',
	'Tammy',
	'Diane',
	'Peggy',
	'Janet',
	'Todd',
	'Randy',
	'Steve',
	'Doug',
	'Nancy',
	'Carol',
	'Wayne',
	'Butch',
];
const LAST = [
	'Miller',
	'Johnson',
	'Smith',
	'Brown',
	'Davis',
	'Wilson',
	'Moore',
	'Taylor',
	'Anderson',
	'Thomas',
	'Jackson',
	'White',
	'Harris',
	'Martin',
];

const SKIN = [0xf5c9a8, 0xe8b896, 0xd4a574, 0xc68642, 0x8d5524, 0xffe0bd];
const SHIRTS = [0x2c5aa0, 0xc0392b, 0x27ae60, 0xf39c12, 0x8e44ad, 0x1abc9c, 0xe74c3c, 0x3498db, 0xffffff, 0x111111];
const PANTS = [0x2c3e50, 0x34495e, 0x5d4e37, 0x1a1a2e, 0x4a5568, 0x1e3a5f];
const HAIR = [0x2c1810, 0x5c4033, 0xc4a35a, 0x888888, 0x1a1a1a, 0xd35400, 0xf5f5f5];

const SHOPABLE = STORES.filter((s) => s.id !== 'info');

function mulberry32(a: number) {
	return function() {
		let t = (a += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shopEntrance(s: StoreDef): THREE.Vector3 {
	// stand in corridor in front of store, not inside wall
	const pull = 3.5;
	const x = s.x + Math.sin(s.rotation) * pull;
	const z = s.z + Math.cos(s.rotation) * pull;
	return new THREE.Vector3(x, s.floor * 6, z);
}

/**
 * True mall NPCs: shop → shop routes, velocity vector, legs+feet that walk hard,
 * head plates (destination / € spent / unhappiness), occasional farts + noises.
 */
export class Americans {
	readonly group = new THREE.Group();
	readonly roster: SimFactors[] = [];
	private sims: Sim[] = [];
	private materials: THREE.Material[] = [];
	private pathfinder = new Pathfinder();
	private audio: AudioContext | null = null;
	private fartClouds: { mesh: THREE.Points; life: number; vel: Float32Array }[] = [];

	constructor(count = 20) {
		this.group.name = 'mallSims';
		for (let i = 0; i < count; i++) {
			const sim = this.spawn(i);
			this.sims.push(sim);
			this.roster.push(sim.f);
			this.group.add(sim.root);
		}
	}

	getSimsNear(worldPos: THREE.Vector3, radius: number): SimFactors[] {
		return this.sims
			.filter((s) => s.pos.distanceTo(worldPos) < radius)
			.map((s) => s.f);
	}

	/** Unlock audio on first user gesture (browser policy) */
	ensureAudio(): void {
		if (!this.audio) {
			this.audio = new AudioContext();
		}
		if (this.audio.state === 'suspended') void this.audio.resume();
	}

	update(dt: number): void {
		for (const s of this.sims) this.tick(s, dt);
		this.tickFarts(dt);
	}

	private spawn(id: number): Sim {
		const rng = mulberry32(0xbadc0de + id * 7919);
		const isBrad = id === 0;
		const thicc = isBrad ? 0.9 : 0.3 + rng() * 0.7;
		const moodRoll = rng();
		const mood: SimFactors['mood'] = isBrad
			? 'on_mission'
			: moodRoll < 0.2
			? 'hangry'
			: moodRoll < 0.4
			? 'lost'
			: moodRoll < 0.55
			? 'hyped'
			: moodRoll < 0.8
			? 'chill'
			: 'on_mission';

		const startShop = SHOPABLE[Math.floor(rng() * SHOPABLE.length)];
		const f: SimFactors = {
			id,
			name: isBrad
				? 'Brad Miller'
				: `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`,
			thicc,
			speed: isBrad ? 1.35 : 0.7 + rng() * 1.0,
			stride: 0.85 + rng() * 0.5,
			stomp: 0.6 + rng() * 0.9,
			restless: 0.25 + rng() * 0.7,
			windowShop: rng() * 0.65,
			mood,
			targetShop: '…',
			targetShopId: '',
			moneySpent: Math.floor(rng() * 40),
			unhappiness: Math.floor(20 + rng() * 40 + (mood === 'hangry' ? 25 : 0)),
			bag: isBrad ? 'KRUIDVAT' : rng() > 0.45 ? 'bag' : null,
			shirt: isBrad ? 0xe30613 : SHIRTS[Math.floor(rng() * SHIRTS.length)],
			pants: PANTS[Math.floor(rng() * PANTS.length)],
			skin: SKIN[Math.floor(rng() * SKIN.length)],
			hair: HAIR[Math.floor(rng() * HAIR.length)],
			hasCap: rng() > 0.5,
			isBrad,
			fartCd: 3 + rng() * 12,
		};

		const root = new THREE.Group();
		const body = new THREE.Group();
		root.add(body);

		const scale = 0.95 + thicc * 0.18;
		const bellyR = 0.34 + thicc * 0.36;
		const legLen = 0.62;

		const legL = this.makeLeg(f.pants, legLen, -1);
		const legR = this.makeLeg(f.pants, legLen, 1);
		body.add(legL.group, legR.group);

		const torsoY = legLen + 0.08;
		const belly = new THREE.Mesh(
			new THREE.SphereGeometry(bellyR, 12, 10),
			this.mat(f.shirt, 0.9),
		);
		belly.scale.set(1.2 + thicc * 0.1, 0.9, 1.1);
		belly.position.set(0, torsoY + bellyR * 0.45, 0.08 + thicc * 0.05);
		body.add(belly);

		const chest = new THREE.Mesh(
			new THREE.SphereGeometry(bellyR * 0.7, 10, 8),
			this.mat(f.shirt, 0.9),
		);
		chest.scale.set(1.3, 0.65, 0.85);
		chest.position.set(0, torsoY + bellyR * 1.0, 0);
		body.add(chest);

		const armGeo = new THREE.CapsuleGeometry(0.09, 0.45, 3, 5);
		const armL = new THREE.Mesh(armGeo, this.mat(f.shirt));
		const armR = new THREE.Mesh(armGeo, this.mat(f.shirt));
		armL.position.set(-bellyR * 1.05, torsoY + bellyR * 0.8, 0);
		armR.position.set(bellyR * 1.05, torsoY + bellyR * 0.8, 0);
		body.add(armL, armR);

		const headY = torsoY + bellyR * 1.4 + 0.28;
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), this.mat(f.skin));
		head.position.set(0, headY, 0);
		body.add(head);

		if (f.hasCap) {
			const col = f.isBrad ? 0x00a651 : 0x1a5276;
			const cap = new THREE.Mesh(
				new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
				this.mat(col),
			);
			cap.position.set(0, headY + 0.05, 0);
			body.add(cap);
			const brim = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.22), this.mat(col));
			brim.position.set(0, headY + 0.02, 0.2);
			body.add(brim);
		} else {
			const hair = new THREE.Mesh(
				new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
				this.mat(f.hair),
			);
			hair.position.set(0, headY + 0.04, 0);
			body.add(hair);
		}

		if (f.bag) {
			const bag = new THREE.Mesh(
				new THREE.BoxGeometry(0.28, 0.34, 0.12),
				this.mat(f.isBrad ? 0xe30613 : 0x333333),
			);
			bag.position.set(bellyR * 1.25, torsoY * 0.5, 0.15);
			body.add(bag);
		}

		body.scale.setScalar(scale);

		// Head info plate (not floating store labels — per-sim status)
		const labelCanvas = document.createElement('canvas');
		labelCanvas.width = 320;
		labelCanvas.height = 120;
		const labelCtx = labelCanvas.getContext('2d')!;
		const labelTex = new THREE.CanvasTexture(labelCanvas);
		labelTex.colorSpace = THREE.SRGBColorSpace;
		const label = new THREE.Sprite(
			this.track(
				new THREE.SpriteMaterial({
					map: labelTex,
					transparent: true,
					depthTest: true,
					depthWrite: false,
				}),
			),
		);
		label.scale.set(2.6, 1.0, 1);
		label.position.set(0, headY * scale + 0.85, 0);
		root.add(label);

		const start = shopEntrance(startShop);
		root.position.copy(start);

		const sim: Sim = {
			f,
			root,
			body,
			legL,
			legR,
			armL,
			armR,
			label,
			pos: start.clone(),
			velocity: new THREE.Vector3(),
			path: [],
			pathI: 0,
			wait: rng() * 1.5,
			phase: rng() * Math.PI * 2,
			shopId: startShop.id,
			labelCanvas,
			labelCtx,
			labelTex,
		};

		this.assignNextShop(sim);
		this.paintLabel(sim);
		return sim;
	}

	private mat(color: number, rough = 0.85): THREE.MeshStandardMaterial {
		return this.track(
			new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 }),
		);
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	/** Hip → knee → FOOT. Feet must swing hard when walking. */
	private makeLeg(pants: number, legLen: number, side: -1 | 1): Limb {
		const group = new THREE.Group();
		group.position.set(side * 0.16, 0, 0);

		const hip = new THREE.Group();
		hip.position.set(0, legLen, 0);

		const thigh = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.11, legLen * 0.42, 3, 6),
			this.mat(pants),
		);
		thigh.position.y = -legLen * 0.28;
		hip.add(thigh);

		const knee = new THREE.Group();
		knee.position.y = -legLen * 0.5;

		const shin = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.09, legLen * 0.35, 3, 6),
			this.mat(pants),
		);
		shin.position.y = -legLen * 0.2;
		knee.add(shin);

		// BIG visible foot (pootje)
		const foot = new THREE.Mesh(
			new THREE.BoxGeometry(0.16, 0.09, 0.34),
			this.mat(0xf5f5f5, 0.65),
		);
		foot.position.set(0, -legLen * 0.42, 0.1);
		knee.add(foot);

		const sole = new THREE.Mesh(
			new THREE.BoxGeometry(0.17, 0.04, 0.36),
			this.mat(0x1a1a1a),
		);
		sole.position.set(0, -legLen * 0.47, 0.1);
		knee.add(sole);

		hip.add(knee);
		group.add(hip);
		return { group, hip, knee, foot };
	}

	private assignNextShop(sim: Sim): void {
		let next = SHOPABLE[Math.floor(Math.random() * SHOPABLE.length)];
		// don't pick same shop
		let guard = 0;
		while (next.id === sim.shopId && guard++ < 12) {
			next = SHOPABLE[Math.floor(Math.random() * SHOPABLE.length)];
		}
		// Brad bias toward Kruidvat
		if (sim.f.isBrad && Math.random() < 0.55) {
			next = SHOPABLE.find((s) => s.id === 'kruidvat') ?? next;
		}

		sim.f.targetShop = next.name.replace('\n', ' ');
		sim.f.targetShopId = next.id;

		const fromNode = STORES.find((s) => s.id === sim.shopId)?.nodeId ?? 'f0_c';
		// Use shop entrance nodes for graph; spaceship for kruidvat is ok
		const toNode = next.nodeId === 'spaceship' ? 's_kruidvat' : next.nodeId;
		const fromStoreNode = fromNode === 'spaceship' ? 's_kruidvat' : fromNode;

		const nodes = this.pathfinder.findPath(fromStoreNode, toNode);
		if (nodes.length >= 2) {
			sim.path = nodes.map((n) => new THREE.Vector3(n.x, n.y < 3 ? 0 : 6, n.z));
			// append precise entrance in front of shop
			sim.path.push(shopEntrance(next));
		} else {
			// fallback straight line corridor-ish
			sim.path = [sim.pos.clone(), shopEntrance(next)];
		}
		sim.pathI = 0;
		sim.shopId = next.id;
	}

	private tick(sim: Sim, dt: number): void {
		const f = sim.f;

		// Fart timer
		f.fartCd -= dt;
		if (f.fartCd <= 0) {
			this.doFart(sim);
			f.fartCd = 8 + Math.random() * 22;
			f.unhappiness = Math.min(100, f.unhappiness + 2);
		}

		if (sim.wait > 0) {
			sim.wait -= dt;
			sim.velocity.set(0, 0, 0);
			this.animateLegs(sim, 0, dt);
			sim.root.position.copy(sim.pos);
			// slowly more unhappy while waiting (mall fatigue)
			f.unhappiness = Math.min(100, f.unhappiness + dt * 0.8);
			this.paintLabel(sim);
			return;
		}

		if (sim.pathI >= sim.path.length) {
			// Arrived at shop — spend money, maybe unhappier/happier, pick next
			const spend = 8 + Math.floor(Math.random() * 55);
			f.moneySpent += spend;
			if (f.mood === 'hangry') f.unhappiness = Math.min(100, f.unhappiness + 8);
			else if (sim.f.targetShopId === 'rituals') f.unhappiness = Math.max(0, f.unhappiness - 15);
			else if (sim.f.targetShopId === 'kruidvat') f.unhappiness = Math.max(0, f.unhappiness - 10);
			else f.unhappiness = Math.min(100, f.unhappiness + Math.floor(Math.random() * 12) - 4);

			sim.wait = 1.2 + f.windowShop * 3.5 + (f.mood === 'lost' ? 2 : 0);
			this.assignNextShop(sim);
			this.paintLabel(sim);
			this.animateLegs(sim, 0, dt);
			sim.root.position.copy(sim.pos);
			return;
		}

		const target = sim.path[sim.pathI];
		const to = target.clone().sub(sim.pos);
		to.y = 0;
		const dist = to.length();

		if (dist < 0.4) {
			sim.pathI++;
			// snap Y when changing floors via escalator/stairs nodes
			if (sim.pathI < sim.path.length) {
				sim.pos.y = sim.path[sim.pathI].y;
			}
			return;
		}

		// ── THE VECTOR ──────────────────────────────────────
		const dir = to.normalize();
		const spd = f.speed
			* (f.mood === 'hyped' ? 1.3 : f.mood === 'hangry' ? 1.2 : f.mood === 'chill' ? 0.8 : 1);

		sim.velocity.copy(dir).multiplyScalar(spd);
		sim.pos.x += sim.velocity.x * dt;
		sim.pos.z += sim.velocity.z * dt;
		// interpolate Y gently on incline segments
		sim.pos.y = THREE.MathUtils.lerp(sim.pos.y, target.y, Math.min(1, dt * 3));

		// Face velocity vector
		const face = Math.atan2(dir.x, dir.z);
		let dy = face - sim.root.rotation.y;
		while (dy > Math.PI) dy -= Math.PI * 2;
		while (dy < -Math.PI) dy += Math.PI * 2;
		sim.root.rotation.y += dy * Math.min(1, dt * 8);

		// Walk phase driven by speed so feet ALWAYS move when moving
		const speedNow = sim.velocity.length();
		sim.phase += dt * speedNow * 6.5 * f.stride;
		this.animateLegs(sim, speedNow, dt);

		sim.root.position.set(sim.pos.x, sim.pos.y, sim.pos.z);
		this.paintLabel(sim);
	}

	/**
	 * POOTJES. Big hip swing, knee bend, foot plant.
	 * speed=0 → idle; speed>0 → full walk cycle.
	 */
	private animateLegs(sim: Sim, speed: number, dt: number): void {
		const f = sim.f;
		if (speed < 0.05) {
			// idle settle
			sim.legL.hip.rotation.x = THREE.MathUtils.lerp(sim.legL.hip.rotation.x, 0.08, dt * 6);
			sim.legR.hip.rotation.x = THREE.MathUtils.lerp(sim.legR.hip.rotation.x, -0.08, dt * 6);
			sim.legL.knee.rotation.x = THREE.MathUtils.lerp(sim.legL.knee.rotation.x, 0.1, dt * 6);
			sim.legR.knee.rotation.x = THREE.MathUtils.lerp(sim.legR.knee.rotation.x, 0.1, dt * 6);
			sim.legL.foot.rotation.x = THREE.MathUtils.lerp(sim.legL.foot.rotation.x, 0, dt * 6);
			sim.legR.foot.rotation.x = THREE.MathUtils.lerp(sim.legR.foot.rotation.x, 0, dt * 6);
			sim.armL.rotation.x = THREE.MathUtils.lerp(sim.armL.rotation.x, 0, dt * 5);
			sim.armR.rotation.x = THREE.MathUtils.lerp(sim.armR.rotation.x, 0, dt * 5);
			sim.body.position.y = Math.sin(sim.phase * 0.5) * 0.012;
			return;
		}

		const amp = 0.75 * f.stride; // BIG swing — must see the feet
		const L = Math.sin(sim.phase) * amp;
		const R = Math.sin(sim.phase + Math.PI) * amp;

		// Hips
		sim.legL.hip.rotation.x = L;
		sim.legR.hip.rotation.x = R;

		// Knees bend on rear swing
		sim.legL.knee.rotation.x = Math.max(0, -L) * 0.9 + 0.15;
		sim.legR.knee.rotation.x = Math.max(0, -R) * 0.9 + 0.15;

		// Feet plant / toe lift
		const plantL = Math.max(0, Math.cos(sim.phase)) * 0.35 * f.stomp;
		const plantR = Math.max(0, Math.cos(sim.phase + Math.PI)) * 0.35 * f.stomp;
		sim.legL.foot.rotation.x = -L * 0.4 + plantL;
		sim.legR.foot.rotation.x = -R * 0.4 + plantR;

		// Arms opposite
		sim.armL.rotation.x = -L * 0.55;
		sim.armR.rotation.x = -R * 0.55;

		// Stomp bob
		sim.body.position.y = Math.abs(Math.sin(sim.phase)) * 0.05 * f.stomp;
	}

	private paintLabel(sim: Sim): void {
		const f = sim.f;
		const ctx = sim.labelCtx;
		const w = sim.labelCanvas.width;
		const h = sim.labelCanvas.height;
		ctx.clearRect(0, 0, w, h);

		// soft plate
		ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
		roundRect(ctx, 4, 4, w - 8, h - 8, 12);
		ctx.fill();
		ctx.strokeStyle = f.unhappiness > 70 ? '#ef4444' : f.unhappiness > 40 ? '#f59e0b' : '#22c55e';
		ctx.lineWidth = 3;
		roundRect(ctx, 4, 4, w - 8, h - 8, 12);
		ctx.stroke();

		ctx.fillStyle = '#fff';
		ctx.font = 'bold 22px system-ui,sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(f.name.slice(0, 18), 16, 32);

		ctx.font = '600 18px system-ui,sans-serif';
		ctx.fillStyle = '#93c5fd';
		ctx.fillText(`→ ${f.targetShop.slice(0, 16)}`, 16, 58);

		ctx.fillStyle = '#fbbf24';
		ctx.fillText(`€${f.moneySpent} uitgegeven`, 16, 82);

		ctx.fillStyle = f.unhappiness > 70 ? '#fca5a5' : '#e2e8f0';
		ctx.fillText(`☹ ${Math.round(f.unhappiness)}% ongelukkig`, 16, 104);

		sim.labelTex.needsUpdate = true;
	}

	private doFart(sim: Sim): void {
		// Green stink cloud
		const count = 40;
		const positions = new Float32Array(count * 3);
		const vel = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = sim.pos.x;
			positions[i * 3 + 1] = sim.pos.y + 0.5;
			positions[i * 3 + 2] = sim.pos.z;
			vel[i * 3] = (Math.random() - 0.5) * 0.8;
			vel[i * 3 + 1] = 0.3 + Math.random() * 0.6;
			vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const mat = new THREE.PointsMaterial({
			color: 0x88ff44,
			size: 0.18,
			transparent: true,
			opacity: 0.65,
			depthWrite: false,
		});
		const mesh = new THREE.Points(geo, mat);
		this.group.add(mesh);
		this.fartClouds.push({ mesh, life: 1.4, vel });

		// Unhappy + rare noise
		sim.f.unhappiness = Math.min(100, sim.f.unhappiness + 5);
		this.playFartSound();
		this.playWeirdNoise();
	}

	private tickFarts(dt: number): void {
		for (let i = this.fartClouds.length - 1; i >= 0; i--) {
			const c = this.fartClouds[i];
			c.life -= dt;
			const pos = c.mesh.geometry.attributes.position as THREE.BufferAttribute;
			const arr = pos.array as Float32Array;
			for (let j = 0; j < arr.length; j += 3) {
				arr[j] += c.vel[j] * dt;
				arr[j + 1] += c.vel[j + 1] * dt;
				arr[j + 2] += c.vel[j + 2] * dt;
				c.vel[j + 1] -= 0.4 * dt;
			}
			pos.needsUpdate = true;
			const mat = c.mesh.material as THREE.PointsMaterial;
			mat.opacity = Math.max(0, c.life * 0.5);
			if (c.life <= 0) {
				this.group.remove(c.mesh);
				c.mesh.geometry.dispose();
				mat.dispose();
				this.fartClouds.splice(i, 1);
			}
		}
	}

	private playFartSound(): void {
		if (!this.audio) return;
		const ctx = this.audio;
		const t0 = ctx.currentTime;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(90 + Math.random() * 40, t0);
		o.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
		// lowpass for "farty" muffling
		const f = ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = 280;
		o.connect(f);
		f.connect(g);
		g.connect(ctx.destination);
		o.start(t0);
		o.stop(t0 + 0.4);
	}

	private playWeirdNoise(): void {
		if (!this.audio || Math.random() > 0.45) return;
		const ctx = this.audio;
		const t0 = ctx.currentTime;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = Math.random() > 0.5 ? 'square' : 'triangle';
		o.frequency.setValueAtTime(200 + Math.random() * 600, t0);
		o.frequency.linearRampToValueAtTime(120 + Math.random() * 200, t0 + 0.15);
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
		o.connect(g);
		g.connect(ctx.destination);
		o.start(t0);
		o.stop(t0 + 0.2);
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
