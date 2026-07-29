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
	isKid: boolean;
	/** pageant / Miss-style shopper */
	isMiss: boolean;
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
	stuckTime: number;
	bubbleCd: number;
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
const MISS_NAMES = [
	'Miss Dakota',
	'Miss Texas',
	'Miss California',
	'Eva G.',
	'Miss Florida',
];
const MISS_OUTFITS = [0xff69b4, 0xc0a0ff, 0xffd700, 0xff6b9d, 0x87ceeb];
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
const SIM_RADIUS = 0.5;
const SIM_SEPARATE = 1.55;

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
	private bubbles: { mesh: THREE.Points; life: number; vel: Float32Array }[] = [];
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
		this.tickBubbles(dt);
	}

	private tickBubbles(dt: number): void {
		for (let i = this.bubbles.length - 1; i >= 0; i--) {
			const c = this.bubbles[i];
			c.life -= dt;
			const pos = c.mesh.geometry.attributes.position as THREE.BufferAttribute;
			const arr = pos.array as Float32Array;
			for (let j = 0; j < arr.length; j += 3) {
				arr[j] += c.vel[j] * dt;
				arr[j + 1] += c.vel[j + 1] * dt;
				arr[j + 2] += c.vel[j + 2] * dt;
			}
			pos.needsUpdate = true;
			const mat = c.mesh.material as THREE.PointsMaterial;
			mat.opacity = Math.max(0, c.life * 0.5);
			if (c.life <= 0) {
				this.group.remove(c.mesh);
				c.mesh.geometry.dispose();
				mat.dispose();
				this.bubbles.splice(i, 1);
			}
		}
	}

	/** Static walls/stores + hard sim-sim separation (no orgy-stack / loopband of people) */
	private resolveAgents(): void {
		for (let pass = 0; pass < 2; pass++) {
			for (const s of this.sims) {
				s.pos.y = this.world.snapFloorY(s.pos.x, s.pos.z, s.pos.y);
				const r = this.world.resolveCircle(s.pos.x, s.pos.z, s.pos.y, SIM_RADIUS);
				s.pos.x = r.x;
				s.pos.z = r.z;
			}
			for (let i = 0; i < this.sims.length; i++) {
				for (let j = i + 1; j < this.sims.length; j++) {
					const a = this.sims[i];
					const b = this.sims[j];
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
		}
		for (const s of this.sims) {
			s.pos.y = this.world.snapFloorY(s.pos.x, s.pos.z, s.pos.y);
			const r = this.world.resolveCircle(s.pos.x, s.pos.z, s.pos.y, SIM_RADIUS);
			s.pos.x = r.x;
			s.pos.z = r.z;
			s.root.position.set(s.pos.x, s.pos.y, s.pos.z);
		}
	}

	private spawn(id: number): Sim {
		const rng = mulberry32(0xbadc0de + id * 7919);
		const isBrad = id === 0;
		const isKid = !isBrad && id % 5 === 2;
		// A few Miss USA / pageant types (incl. Eva G.)
		const isMiss = !isBrad && !isKid && (id === 1 || id === 3 || id === 7 || id === 11);
		const missIdx = Math.floor(id / 2) % MISS_NAMES.length;
		const thicc = isMiss ? 0.12 : isKid ? 0.15 : isBrad ? 0.9 : 0.3 + rng() * 0.7;
		const moodRoll = rng();
		const mood: SimFactors['mood'] = isBrad
			? 'on_mission'
			: isMiss
			? 'hyped'
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
				: isMiss
				? MISS_NAMES[missIdx]
				: `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`,
			thicc,
			speed: isBrad ? 1.35 : isMiss ? 1.1 : 0.7 + rng() * 1.0,
			stride: isMiss ? 1.05 : 0.85 + rng() * 0.5,
			stomp: isMiss ? 0.35 : 0.6 + rng() * 0.9,
			restless: 0.25 + rng() * 0.7,
			windowShop: isMiss ? 0.8 : rng() * 0.65,
			mood,
			targetShop: '…',
			targetShopId: '',
			moneySpent: Math.floor(rng() * 40),
			unhappiness: isMiss
				? Math.floor(5 + rng() * 25)
				: Math.floor(20 + rng() * 40 + (mood === 'hangry' ? 25 : 0)),
			bag: isBrad ? 'KRUIDVAT' : isMiss ? 'Sash' : rng() > 0.45 ? 'bag' : null,
			shirt: isBrad
				? 0xe30613
				: isMiss
				? MISS_OUTFITS[missIdx]
				: SHIRTS[Math.floor(rng() * SHIRTS.length)],
			pants: isMiss ? MISS_OUTFITS[missIdx] : PANTS[Math.floor(rng() * PANTS.length)],
			skin: isMiss ? 0xf5c9a8 : SKIN[Math.floor(rng() * SKIN.length)],
			hair: isMiss
				? [0xc4a35a, 0x2c1810, 0xd35400, 0x5c4033, 0x1a1a1a][missIdx]
				: HAIR[Math.floor(rng() * HAIR.length)],
			hasCap: false,
			isBrad,
			isKid,
			isMiss,
			fartCd: 3 + rng() * 12,
		};

		const root = new THREE.Group();
		const body = new THREE.Group();
		root.add(body);

		const scale = isKid ? 0.62 : isMiss ? 1.02 : 0.95 + thicc * 0.18;
		const bellyR = isMiss ? 0.26 : isKid ? 0.22 : 0.34 + thicc * 0.36;
		const legLen = isMiss ? 0.72 : isKid ? 0.42 : 0.62;

		const legL = this.makeLeg(f.pants, legLen, -1);
		const legR = this.makeLeg(f.pants, legLen, 1);
		body.add(legL.group, legR.group);

		const torsoY = legLen + 0.08;
		const belly = new THREE.Mesh(
			new THREE.SphereGeometry(bellyR, 12, 10),
			this.mat(f.shirt, 0.9),
		);
		if (isMiss) {
			belly.scale.set(0.85, 1.05, 0.75);
			belly.position.set(0, torsoY + bellyR * 0.55, 0.02);
		} else {
			belly.scale.set(1.2 + thicc * 0.1, 0.9, 1.1);
			belly.position.set(0, torsoY + bellyR * 0.45, 0.08 + thicc * 0.05);
		}
		body.add(belly);

		const chest = new THREE.Mesh(
			new THREE.SphereGeometry(bellyR * (isMiss ? 0.85 : 0.7), 10, 8),
			this.mat(f.shirt, 0.9),
		);
		chest.scale.set(isMiss ? 1.15 : 1.3, isMiss ? 0.75 : 0.65, isMiss ? 0.7 : 0.85);
		chest.position.set(0, torsoY + bellyR * (isMiss ? 1.15 : 1.0), isMiss ? 0.04 : 0);
		body.add(chest);

		const armGeo = new THREE.CapsuleGeometry(0.09, 0.45, 3, 5);
		const armL = new THREE.Mesh(armGeo, this.mat(f.shirt));
		const armR = new THREE.Mesh(armGeo, this.mat(f.shirt));
		armL.position.set(-bellyR * 1.05, torsoY + bellyR * 0.8, 0);
		armR.position.set(bellyR * 1.05, torsoY + bellyR * 0.8, 0);
		body.add(armL, armR);

		const headY = torsoY + bellyR * 1.4 + 0.28;
		// Face lives ON the head sphere (UV), not a floating square plate
		const faceCanvas = document.createElement('canvas');
		faceCanvas.width = 256;
		faceCanvas.height = 256;
		const faceCtx = faceCanvas.getContext('2d')!;
		const faceTex = new THREE.CanvasTexture(faceCanvas);
		faceTex.colorSpace = THREE.SRGBColorSpace;
		const headMat = this.track(
			new THREE.MeshStandardMaterial({
				map: faceTex,
				roughness: 0.85,
				metalness: 0,
			}),
		);
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(isKid ? 0.2 : isMiss ? 0.23 : 0.24, 20, 20),
			headMat,
		);
		head.position.set(0, headY, 0);
		// Face texture faces +Z after this rotate (was showing on the back)
		head.rotation.y = Math.PI;
		body.add(head);
		const faceMesh = head;

		if (f.isMiss) {
			// Pageant hair volume
			const hair = new THREE.Mesh(
				new THREE.SphereGeometry(0.28, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.65),
				this.mat(f.hair),
			);
			hair.position.set(0, headY + 0.06, -0.02);
			body.add(hair);
			// Crown
			const crown = new THREE.Mesh(
				new THREE.TorusGeometry(0.14, 0.025, 6, 12),
				this.track(
					new THREE.MeshStandardMaterial({
						color: 0xffd700,
						metalness: 0.9,
						roughness: 0.25,
					}),
				),
			);
			crown.rotation.x = Math.PI / 2;
			crown.position.set(0, headY + 0.22, 0);
			body.add(crown);
			// Sash
			const sash = new THREE.Mesh(
				new THREE.BoxGeometry(0.12, 0.9, 0.02),
				this.track(
					new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
				),
			);
			sash.position.set(0.18, torsoY + 0.5, 0.2);
			sash.rotation.z = -0.35;
			body.add(sash);
		} else if (f.hasCap) {
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

		if (f.bag && !f.isMiss) {
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
			stuckTime: 0,
			bubbleCd: 1 + rng() * 4,
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
			sim.path = nodes.map((n) => {
				const y = n.y < 3 ? 0 : 6;
				return new THREE.Vector3(n.x, y, n.z);
			});
			// Avoid atrium void on floor 1 mid-path
			sim.path = sim.path.map((p) => {
				if (p.y > 3 && Math.abs(p.x) < 8 && Math.abs(p.z) < 6) {
					return new THREE.Vector3(p.x >= 0 ? 10 : -10, 6, p.z);
				}
				return p;
			});
			sim.path.push(shopEntrance(next));
		} else {
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
		// Climb only on escalator/stairs; otherwise hard floor snap
		if (Math.abs(target.y - sim.pos.y) > 0.5) {
			sim.pos.y = THREE.MathUtils.lerp(sim.pos.y, target.y, Math.min(1, dt * 2.5));
		}

		// Floor snap — feet stay on slab (no through-floor / floating)
		sim.pos.y = this.world.snapFloorY(sim.pos.x, sim.pos.z, target.y);

		const hit = this.world.resolveCircle(sim.pos.x, sim.pos.z, sim.pos.y, SIM_RADIUS);
		sim.pos.x = hit.x;
		sim.pos.z = hit.z;
		sim.pos.y = this.world.snapFloorY(sim.pos.x, sim.pos.z, sim.pos.y);

		const moved = Math.hypot(sim.pos.x - prevX, sim.pos.z - prevZ);
		if (moved < spd * dt * 0.2 && dist > 0.8) {
			sim.stuckTime += dt;
			// Unstick: skip waypoint + random lateral kick so they don't form a meat loopband
			if (sim.stuckTime > 0.45) {
				sim.pathI++;
				const kick = (Math.random() - 0.5) * 2.4;
				const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(kick);
				sim.pos.x += side.x;
				sim.pos.z += side.z;
				sim.stuckTime = 0;
			}
		} else {
			sim.stuckTime = 0;
		}

		// Kids leave soap-bubble trail (NOT weird particles — family mall)
		if (f.isKid) {
			sim.bubbleCd -= dt;
			if (sim.bubbleCd <= 0) {
				this.spawnBubbles(sim.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
				sim.bubbleCd = 0.8 + Math.random() * 1.5;
			}
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

	/**
	 * Normal human face on sphere UV (head.rotation.y = PI so front faces walk dir).
	 * Smile / neutral / sad / cry from unhappiness.
	 */
	private paintFace(sim: Sim): void {
		const u = sim.f.unhappiness / 100;
		const ctx = sim.faceCtx;
		const W = 256;
		const H = 256;
		const skin = `#${sim.f.skin.toString(16).padStart(6, '0')}`;
		const hair = `#${sim.f.hair.toString(16).padStart(6, '0')}`;

		// Soft skin fill (no weird UV seams of pure blocks)
		ctx.fillStyle = skin;
		ctx.fillRect(0, 0, W, H);
		// Hair top + sides
		ctx.fillStyle = hair;
		ctx.beginPath();
		ctx.ellipse(W / 2, H * 0.18, W * 0.48, H * 0.22, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillRect(0, 0, W, H * 0.22);

		// Face oval highlight
		const cx = W * 0.5;
		const cy = H * 0.55;
		const grd = ctx.createRadialGradient(cx, cy, 10, cx, cy, 90);
		grd.addColorStop(0, skin);
		grd.addColorStop(1, 'rgba(0,0,0,0.06)');
		ctx.fillStyle = grd;
		ctx.beginPath();
		ctx.ellipse(cx, cy, 78, 88, 0, 0, Math.PI * 2);
		ctx.fill();

		// Eyes (white + iris + pupil)
		const eyeY = cy - 16 + u * 6;
		const drawEye = (ex: number) => {
			ctx.fillStyle = '#fff';
			ctx.beginPath();
			ctx.ellipse(ex, eyeY, 14, sim.f.isKid ? 12 : 11, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = sim.f.isMiss ? '#4a7c59' : '#3d5a80';
			ctx.beginPath();
			ctx.arc(ex, eyeY + 1, 7, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#111';
			ctx.beginPath();
			ctx.arc(ex, eyeY + 1, 3.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.beginPath();
			ctx.arc(ex + 2, eyeY - 2, 2, 0, Math.PI * 2);
			ctx.fill();
		};
		drawEye(cx - 28);
		drawEye(cx + 28);

		// Brows
		ctx.strokeStyle = hair;
		ctx.lineWidth = 4;
		ctx.lineCap = 'round';
		ctx.beginPath();
		if (u > 0.65) {
			ctx.moveTo(cx - 44, eyeY - 16);
			ctx.lineTo(cx - 14, eyeY - 6);
			ctx.moveTo(cx + 44, eyeY - 16);
			ctx.lineTo(cx + 14, eyeY - 6);
		} else {
			ctx.moveTo(cx - 44, eyeY - 14);
			ctx.quadraticCurveTo(cx - 28, eyeY - 22, cx - 12, eyeY - 12);
			ctx.moveTo(cx + 12, eyeY - 12);
			ctx.quadraticCurveTo(cx + 28, eyeY - 22, cx + 44, eyeY - 14);
		}
		ctx.stroke();

		// Nose hint
		ctx.strokeStyle = 'rgba(0,0,0,0.15)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(cx, cy - 4);
		ctx.lineTo(cx - 3, cy + 14);
		ctx.lineTo(cx + 6, cy + 14);
		ctx.stroke();

		// Mouth
		ctx.strokeStyle = u > 0.7 ? '#8b2942' : '#c45c6a';
		ctx.lineWidth = 5;
		ctx.beginPath();
		if (u < 0.28) {
			ctx.arc(cx, cy + 18, 26, 0.12, Math.PI - 0.12);
			ctx.stroke();
			// teeth hint
			ctx.fillStyle = '#fff';
			ctx.fillRect(cx - 12, cy + 20, 24, 5);
		} else if (u < 0.5) {
			ctx.arc(cx, cy + 22, 20, 0.2, Math.PI - 0.2);
			ctx.stroke();
		} else if (u < 0.7) {
			ctx.moveTo(cx - 20, cy + 30);
			ctx.lineTo(cx + 20, cy + 30);
			ctx.stroke();
		} else if (u < 0.85) {
			ctx.arc(cx, cy + 48, 20, Math.PI + 0.25, -0.25);
			ctx.stroke();
		} else {
			ctx.arc(cx, cy + 50, 22, Math.PI + 0.2, -0.2);
			ctx.stroke();
			ctx.fillStyle = '#5eb8e8';
			ctx.beginPath();
			ctx.ellipse(cx - 30, cy + 6, 4, 12, 0.2, 0, Math.PI * 2);
			ctx.ellipse(cx + 30, cy + 6, 4, 12, -0.2, 0, Math.PI * 2);
			ctx.fill();
		}

		if (u < 0.35 || sim.f.isMiss) {
			ctx.fillStyle = 'rgba(255,140,160,0.35)';
			ctx.beginPath();
			ctx.ellipse(cx - 50, cy + 10, 14, 8, 0, 0, Math.PI * 2);
			ctx.ellipse(cx + 50, cy + 10, 14, 8, 0, 0, Math.PI * 2);
			ctx.fill();
		}

		sim.faceTex.needsUpdate = true;
	}

	/** Player tips nearest sim — muntjes + happiness */
	giveMoneyNear(worldPos: THREE.Vector3, amount = 25): SimFactors | null {
		let best: Sim | null = null;
		let bestD = Infinity;
		for (const s of this.sims) {
			const d = s.pos.distanceTo(worldPos);
			if (d < bestD && d < 6) {
				bestD = d;
				best = s;
			}
		}
		if (!best) return null;
		best.f.moneySpent += amount;
		best.f.unhappiness = Math.max(0, best.f.unhappiness - 20);
		this.spawnCoins(best.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), amount);
		this.sayGibberish(best, true);
		this.paintLabel(best);
		this.paintFace(best);
		return best.f;
	}

	private spawnBubbles(origin: THREE.Vector3): void {
		const count = 14;
		const positions = new Float32Array(count * 3);
		const vel = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.3;
			positions[i * 3 + 1] = origin.y;
			positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.3;
			vel[i * 3] = (Math.random() - 0.5) * 0.4;
			vel[i * 3 + 1] = 0.6 + Math.random() * 1.2;
			vel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const mat = new THREE.PointsMaterial({
			color: 0xa8e6ff,
			size: 0.12,
			transparent: true,
			opacity: 0.7,
			depthWrite: false,
		});
		const mesh = new THREE.Points(geo, mat);
		this.group.add(mesh);
		this.bubbles.push({ mesh, life: 1.5, vel });
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
