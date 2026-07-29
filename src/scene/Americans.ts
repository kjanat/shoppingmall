import * as THREE from 'three';
import { type StoreDef, STORES } from '../data/stores';
import { Pathfinder } from '../path/Pathfinder';
import type { CollisionWorld } from '../physics/Collision';

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
	speech: THREE.Sprite;
	speechTex: THREE.CanvasTexture;
	speechCtx: CanvasRenderingContext2D;
	speechLife: number;
	faceMesh: THREE.Mesh;
	faceCanvas: HTMLCanvasElement;
	faceCtx: CanvasRenderingContext2D;
	faceTex: THREE.CanvasTexture;
	headY: number;
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
	gibberCd: number;
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
const SIM_RADIUS = 0.45;
const SIM_SEPARATE = 0.95;

const GIBBER = [
	'blorp-skree navigare!',
	'haplo-muntjes fwoop',
	'kruid-vat-vat-vat',
	'oeh shampoo expand',
	'waar is de loopband',
	'ik koop niks… oke alles',
	'greeuwd mevrouw Kersch',
	'prairie lakes forever',
	'baard? nee, BEARD',
	'sims energy max',
	'ongelukkig maar open',
	'juwelen? wacht even',
	'navigare ad Kruidvatum',
	'mamma rituals go brrr',
];

export class Americans {
	readonly group = new THREE.Group();
	readonly roster: SimFactors[] = [];
	/** global checkout count → triggers baker thief */
	transactionCount = 0;
	private sims: Sim[] = [];
	private materials: THREE.Material[] = [];
	private pathfinder = new Pathfinder();
	private world: CollisionWorld;
	private audio: AudioContext | null = null;
	private fartClouds: { mesh: THREE.Points; life: number; vel: Float32Array }[] = [];
	private coinBursts: { mesh: THREE.Points; life: number; vel: Float32Array }[] = [];
	private onTransaction: ((count: number, pos: THREE.Vector3) => void) | null = null;

	constructor(world: CollisionWorld, count = 20) {
		this.world = world;
		this.group.name = 'mallSims';
		for (let i = 0; i < count; i++) {
			const sim = this.spawn(i);
			// snap start out of solid geometry
			const fixed = this.world.resolveCircle(sim.pos.x, sim.pos.z, sim.pos.y, SIM_RADIUS);
			sim.pos.x = fixed.x;
			sim.pos.z = fixed.z;
			sim.root.position.copy(sim.pos);
			this.sims.push(sim);
			this.roster.push(sim.f);
			this.group.add(sim.root);
		}
	}

	setTransactionCallback(cb: (count: number, pos: THREE.Vector3) => void): void {
		this.onTransaction = cb;
	}

	getSimsNear(worldPos: THREE.Vector3, radius: number): SimFactors[] {
		return this.sims
			.filter((s) => s.pos.distanceTo(worldPos) < radius)
			.map((s) => s.f);
	}

	getNearestSimId(worldPos: THREE.Vector3): number | null {
		let best: Sim | null = null;
		let bestD = Infinity;
		for (const s of this.sims) {
			const d = s.pos.distanceTo(worldPos);
			if (d < bestD) {
				bestD = d;
				best = s;
			}
		}
		return best && bestD < 8 ? best.f.id : null;
	}

	/** Eye pose for RCT-style guest view */
	getSimEye(id: number): { pos: THREE.Vector3; yaw: number } | null {
		const s = this.sims.find((x) => x.f.id === id);
		if (!s) return null;
		const eye = s.pos.clone();
		eye.y += s.headY * (0.95 + s.f.thicc * 0.05) + 0.15;
		return { pos: eye, yaw: s.root.rotation.y };
	}

	setSimVisible(id: number, visible: boolean): void {
		const s = this.sims.find((x) => x.f.id === id);
		if (s) s.root.visible = visible;
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
		this.resolveAgents();
		this.tickFarts(dt);
		this.tickCoins(dt);
	}

	/** Static walls/stores + soft sim-sim separation (no stacking) */
	private resolveAgents(): void {
		// World collision
		for (const s of this.sims) {
			const r = this.world.resolveCircle(s.pos.x, s.pos.z, s.pos.y, SIM_RADIUS);
			s.pos.x = r.x;
			s.pos.z = r.z;
			s.root.position.set(s.pos.x, s.pos.y, s.pos.z);
		}
		// Pair separation (O(n²) fine for ~20)
		for (let i = 0; i < this.sims.length; i++) {
			for (let j = i + 1; j < this.sims.length; j++) {
				const a = this.sims[i];
				const b = this.sims[j];
				// only same floor-ish
				if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
				const sep = this.world.separate(
					a.pos.x,
					a.pos.z,
					b.pos.x,
					b.pos.z,
					SIM_SEPARATE,
				);
				a.pos.x = sep.ax;
				a.pos.z = sep.az;
				b.pos.x = sep.bx;
				b.pos.z = sep.bz;
			}
		}
		// Re-resolve walls after separation so pushes don't shove into walls
		for (const s of this.sims) {
			const r = this.world.resolveCircle(s.pos.x, s.pos.z, s.pos.y, SIM_RADIUS);
			s.pos.x = r.x;
			s.pos.z = r.z;
			s.root.position.set(s.pos.x, s.pos.y, s.pos.z);
		}
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

		// Face plane — expressions from unhappiness
		const faceCanvas = document.createElement('canvas');
		faceCanvas.width = 128;
		faceCanvas.height = 128;
		const faceCtx = faceCanvas.getContext('2d')!;
		const faceTex = new THREE.CanvasTexture(faceCanvas);
		faceTex.colorSpace = THREE.SRGBColorSpace;
		const faceMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.32, 0.32),
			this.track(
				new THREE.MeshBasicMaterial({
					map: faceTex,
					transparent: true,
					toneMapped: false,
				}),
			),
		);
		faceMesh.position.set(0, headY, 0.22);
		body.add(faceMesh);

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

		// Speech bubble for smart gibberish
		const speechCanvas = document.createElement('canvas');
		speechCanvas.width = 280;
		speechCanvas.height = 72;
		const speechCtx = speechCanvas.getContext('2d')!;
		const speechTex = new THREE.CanvasTexture(speechCanvas);
		speechTex.colorSpace = THREE.SRGBColorSpace;
		const speech = new THREE.Sprite(
			this.track(
				new THREE.SpriteMaterial({
					map: speechTex,
					transparent: true,
					depthTest: false,
					visible: false,
				}),
			),
		);
		speech.scale.set(2.0, 0.55, 1);
		speech.position.set(0, headY * scale + 1.35, 0);
		speech.visible = false;
		root.add(speech);

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
			speech,
			speechTex,
			speechCtx,
			speechLife: 0,
			faceMesh,
			faceCanvas,
			faceCtx,
			faceTex,
			headY,
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
			gibberCd: 2 + rng() * 8,
		};

		this.assignNextShop(sim);
		this.paintLabel(sim);
		this.paintFace(sim);
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
			this.paintFace(sim);
		}

		// Gibberish chatter
		sim.gibberCd -= dt;
		if (sim.speechLife > 0) {
			sim.speechLife -= dt;
			if (sim.speechLife <= 0) sim.speech.visible = false;
		} else if (sim.gibberCd <= 0) {
			this.sayGibberish(sim);
			sim.gibberCd = 5 + Math.random() * 14;
		}

		if (sim.wait > 0) {
			sim.wait -= dt;
			sim.velocity.set(0, 0, 0);
			this.animateLegs(sim, 0, dt);
			sim.root.position.copy(sim.pos);
			// slowly more unhappy while waiting (mall fatigue) — less if shops open
			f.unhappiness = Math.min(100, f.unhappiness + dt * 0.35);
			this.paintLabel(sim);
			this.paintFace(sim);
			return;
		}

		if (sim.pathI >= sim.path.length) {
			// Arrived at OPEN shop — spend money + coin particles + happier (verkoper!)
			const spend = 8 + Math.floor(Math.random() * 55);
			f.moneySpent += spend;
			// Open shops: shopping usually helps mood a bit
			if (f.mood === 'hangry') f.unhappiness = Math.min(100, f.unhappiness + 4);
			else if (sim.f.targetShopId === 'rituals') f.unhappiness = Math.max(0, f.unhappiness - 18);
			else if (sim.f.targetShopId === 'kruidvat') f.unhappiness = Math.max(0, f.unhappiness - 12);
			else f.unhappiness = Math.max(0, f.unhappiness + Math.floor(Math.random() * 8) - 6);

			this.spawnCoins(sim.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), spend);
			this.transactionCount++;
			this.onTransaction?.(this.transactionCount, sim.pos.clone());
			this.sayGibberish(sim, true);

			sim.wait = 1.2 + f.windowShop * 3.5 + (f.mood === 'lost' ? 2 : 0);
			this.assignNextShop(sim);
			this.paintLabel(sim);
			this.paintFace(sim);
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
		const prevX = sim.pos.x;
		const prevZ = sim.pos.z;
		sim.pos.x += sim.velocity.x * dt;
		sim.pos.z += sim.velocity.z * dt;
		// interpolate Y gently on incline segments
		sim.pos.y = THREE.MathUtils.lerp(sim.pos.y, target.y, Math.min(1, dt * 3));

		// Immediate static collision (full pass later too)
		const hit = this.world.resolveCircle(sim.pos.x, sim.pos.z, sim.pos.y, SIM_RADIUS);
		sim.pos.x = hit.x;
		sim.pos.z = hit.z;
		// If fully blocked, slide along wall / skip waypoint
		const moved = Math.hypot(sim.pos.x - prevX, sim.pos.z - prevZ);
		if (moved < spd * dt * 0.15 && dist > 1.2) {
			// stuck — skip toward next node so they don't freeze forever
			sim.pathI++;
		}

		// Face actual movement vector (post-collision)
		const mx = sim.pos.x - prevX;
		const mz = sim.pos.z - prevZ;
		const mlen = Math.hypot(mx, mz);
		if (mlen > 1e-4) {
			const face = Math.atan2(mx / mlen, mz / mlen);
			let dy = face - sim.root.rotation.y;
			while (dy > Math.PI) dy -= Math.PI * 2;
			while (dy < -Math.PI) dy += Math.PI * 2;
			sim.root.rotation.y += dy * Math.min(1, dt * 8);
			sim.velocity.set(mx / dt, 0, mz / dt);
		}

		const speedNow = mlen / Math.max(dt, 1e-4);
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

		const face = f.unhappiness > 70 ? '😭' : f.unhappiness > 40 ? '😕' : '😊';
		ctx.fillStyle = f.unhappiness > 70 ? '#fca5a5' : '#e2e8f0';
		ctx.fillText(`${face} ${Math.round(f.unhappiness)}% ongelukkig`, 16, 104);

		sim.labelTex.needsUpdate = true;
		this.paintFace(sim);
	}

	/** Face texture: smile → frown based on unhappiness */
	private paintFace(sim: Sim): void {
		const u = sim.f.unhappiness / 100;
		const ctx = sim.faceCtx;
		const skin = '#f5d0b0';
		ctx.fillStyle = skin;
		ctx.fillRect(0, 0, 128, 128);
		// eyes
		ctx.fillStyle = '#1a1a1a';
		const eyeY = 48 + u * 6;
		ctx.beginPath();
		ctx.arc(42, eyeY, 7, 0, Math.PI * 2);
		ctx.arc(86, eyeY, 7, 0, Math.PI * 2);
		ctx.fill();
		// brows (angry when unhappy)
		ctx.strokeStyle = '#1a1a1a';
		ctx.lineWidth = 4;
		ctx.beginPath();
		if (u > 0.55) {
			ctx.moveTo(28, 32);
			ctx.lineTo(52, 40);
			ctx.moveTo(100, 32);
			ctx.lineTo(76, 40);
		} else {
			ctx.moveTo(28, 36);
			ctx.lineTo(52, 34);
			ctx.moveTo(100, 36);
			ctx.lineTo(76, 34);
		}
		ctx.stroke();
		// mouth
		ctx.lineWidth = 5;
		ctx.beginPath();
		if (u < 0.35) {
			// smile
			ctx.arc(64, 72, 22, 0.15, Math.PI - 0.15);
		} else if (u < 0.65) {
			// flat
			ctx.moveTo(40, 88);
			ctx.lineTo(88, 88);
		} else {
			// frown
			ctx.arc(64, 102, 20, Math.PI + 0.2, -0.2);
		}
		ctx.stroke();
		// blush when happy
		if (u < 0.3) {
			ctx.fillStyle = 'rgba(255,120,140,0.35)';
			ctx.beginPath();
			ctx.ellipse(30, 70, 10, 6, 0, 0, Math.PI * 2);
			ctx.ellipse(98, 70, 10, 6, 0, 0, Math.PI * 2);
			ctx.fill();
		}
		sim.faceTex.needsUpdate = true;
	}

	private sayGibberish(sim: Sim, checkout = false): void {
		const line = checkout
			? GIBBER[Math.floor(Math.random() * 3) + 2]
			: GIBBER[Math.floor(Math.random() * GIBBER.length)];
		const ctx = sim.speechCtx;
		ctx.clearRect(0, 0, 280, 72);
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		roundRect(ctx, 4, 4, 272, 64, 14);
		ctx.fill();
		ctx.strokeStyle = '#334155';
		ctx.lineWidth = 2;
		roundRect(ctx, 4, 4, 272, 64, 14);
		ctx.stroke();
		ctx.fillStyle = '#0f172a';
		ctx.font = '600 18px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(line, 140, 36);
		sim.speechTex.needsUpdate = true;
		sim.speech.visible = true;
		(sim.speech.material as THREE.SpriteMaterial).visible = true;
		sim.speechLife = 2.8;
		this.playTalkBlip();
	}

	private spawnCoins(origin: THREE.Vector3, amount: number): void {
		const count = Math.min(40, 8 + Math.floor(amount / 3));
		const positions = new Float32Array(count * 3);
		const vel = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = origin.x;
			positions[i * 3 + 1] = origin.y;
			positions[i * 3 + 2] = origin.z;
			vel[i * 3] = (Math.random() - 0.5) * 3;
			vel[i * 3 + 1] = 2 + Math.random() * 4;
			vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const mat = new THREE.PointsMaterial({
			color: 0xffd700,
			size: 0.16,
			transparent: true,
			opacity: 0.95,
			depthWrite: false,
		});
		const mesh = new THREE.Points(geo, mat);
		this.group.add(mesh);
		this.coinBursts.push({ mesh, life: 1.6, vel });
		this.playCoinSound();
	}

	private tickCoins(dt: number): void {
		for (let i = this.coinBursts.length - 1; i >= 0; i--) {
			const c = this.coinBursts[i];
			c.life -= dt;
			const pos = c.mesh.geometry.attributes.position as THREE.BufferAttribute;
			const arr = pos.array as Float32Array;
			for (let j = 0; j < arr.length; j += 3) {
				arr[j] += c.vel[j] * dt;
				arr[j + 1] += c.vel[j + 1] * dt;
				arr[j + 2] += c.vel[j + 2] * dt;
				c.vel[j + 1] -= 9 * dt;
			}
			pos.needsUpdate = true;
			const mat = c.mesh.material as THREE.PointsMaterial;
			mat.opacity = Math.max(0, c.life * 0.7);
			if (c.life <= 0) {
				this.group.remove(c.mesh);
				c.mesh.geometry.dispose();
				mat.dispose();
				this.coinBursts.splice(i, 1);
			}
		}
	}

	private playTalkBlip(): void {
		if (!this.audio) return;
		const ctx = this.audio;
		const t0 = ctx.currentTime;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'triangle';
		o.frequency.setValueAtTime(280 + Math.random() * 220, t0);
		o.frequency.linearRampToValueAtTime(180 + Math.random() * 100, t0 + 0.08);
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
		o.connect(g);
		g.connect(ctx.destination);
		o.start(t0);
		o.stop(t0 + 0.14);
	}

	private playCoinSound(): void {
		if (!this.audio) return;
		const ctx = this.audio;
		const t0 = ctx.currentTime;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(880, t0);
		o.frequency.exponentialRampToValueAtTime(1320, t0 + 0.08);
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
		o.connect(g);
		g.connect(ctx.destination);
		o.start(t0);
		o.stop(t0 + 0.16);
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
