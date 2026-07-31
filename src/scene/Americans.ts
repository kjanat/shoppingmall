import * as THREE from 'three';
import { getOwner } from '../data/shopOwners';
import { type StoreDef, STORES } from '../data/stores';
import { Pathfinder } from '../path/Pathfinder';
import type { CollisionWorld } from '../physics/Collision';
import { fetchSimChat, type SimPersona } from '../sim/SimChat';

export type LifeMeaning =
	| 'love'
	| 'family'
	| 'health'
	| 'joy'
	| 'provide'
	| 'belong'
	| 'create';

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
	/** Why they get out of bed / walk this mall */
	lifeMeaning: LifeMeaning;
	lifeLine: string;
	/** Partner sim id if in a couple */
	partnerId: number | null;
	partnerName: string | null;
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

/** Dashboard row: who, where, and what they're doing right now. */
export type PersonRow = {
	id: number;
	name: string;
	x: number;
	z: number;
	floor: 0 | 1;
	doing: string;
	unhappiness: number;
	moneySpent: number;
	partnerName: string | null;
	isKid: boolean;
	dist: number;
};

const SKULL_OUT = new THREE.Vector3(0, 0, 1);

/**
 * Park an object on a head sphere of radius `headR`, local +Z pointing straight
 * out of the surface. `sink` < 1 pushes it slightly into the skull so flattened
 * features sit flush instead of floating.
 */
function placeOnSkull(
	obj: THREE.Object3D,
	headR: number,
	yaw: number,
	pitch: number,
	sink: number,
): void {
	const n = new THREE.Vector3(
		Math.sin(yaw) * Math.cos(pitch),
		Math.sin(pitch),
		Math.cos(yaw) * Math.cos(pitch),
	);
	obj.position.copy(n).multiplyScalar(headR * sink);
	obj.quaternion.setFromUnitVectors(SKULL_OUT, n);
}

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
	/** Simple face: black sphere eyes + oval mouth */
	eyeL: THREE.Mesh;
	eyeR: THREE.Mesh;
	mouth: THREE.Mesh;
	headY: number;
	/** body.scale scalar — head world Y = headY * bodyScale */
	bodyScale: number;
	blinkT: number;
	talkPhase: number;
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
	/** next squeak while speech bubble is open */
	squeakT: number;
	/** side offset when walking as couple (−1 / +1) */
	coupleSide: number;
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
// Hotter palette — neon pink, cherry, gold, violet, icy blue
const MISS_OUTFITS = [0xff1493, 0xe040fb, 0xffd700, 0xff2d55, 0x00e5ff];
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

// Sims can shop stores + food court (utility places like WC/helipad are out)
const SHOPABLE = STORES.filter(
	(s) => s.id !== 'info' && (!s.utility || s.id === 'foodcourt'),
);

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
const SIM_RADIUS = 0.55;
/** Hard personal space — no walking through each other */
const SIM_SEPARATE = 2.05;

const GIBBER = [
	'Komunicare… humanos!',
	'Komunis… squeak squeak',
	'Ego sum shopperus maximus',
	'Salve, amice mallus',
	'Ubi est Kruidvatum?',
	'Homo bleep bloop shop',
	'Squeak? Squeak! SQUEAK!',
	'Navigare ad food courtum',
	'Pecunia non olet… squeak',
	'Rituals pro mamma',
	'Humanos need coffee',
	'Komunicare via loopband',
	'Beep boop vriendschap',
	'Ave Maria, ave sale',
	'Quid est pretium?!',
	'Squeak ergo sum',
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
	private onTransaction: ((count: number, pos: THREE.Vector3, storeId: string) => void) | null = null;
	/** seconds until next OpenRouter gossip attempt */
	private gossipCd = 4;
	private gossipBusy = false;
	/** Don't spam the player with roasts */
	private roastPlayerCd = 5;
	/** Player camera — only gossip / bubbles on this floor nearby */
	private listener: THREE.Vector3 | null = null;
	/** Max distance for visible speech bubbles */
	private static readonly SPEECH_RANGE = 16;
	/** Max distance for LLM gossip (same floor only) */
	private static readonly GOSSIP_RANGE = 12;

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
		this.formCouples();
	}

	/** Pair shoppers into love/family couples — they walk life together */
	private formCouples(): void {
		// Brad + Miss, thicc power couple, parent+kid — meaning over mall chaos
		// ids: 0=Brad, 1=Miss, kids when id%5===2 (2,7? no 7 is Miss override — kids 2,8,12,17)
		const pairs: [number, number, LifeMeaning, string][] = [
			[0, 1, 'love', 'Samen de vitamines van het leven'],
			[4, 5, 'love', 'Hand in hand door elk pad'],
			[6, 8, 'family', 'Ouder + kind: treat day'],
		];
		for (const [a, b, meaning, line] of pairs) {
			const sa = this.sims.find((s) => s.f.id === a);
			const sb = this.sims.find((s) => s.f.id === b);
			if (!sa || !sb) continue;
			// Don't pair two kids as a romantic couple
			if (sa.f.isKid && sb.f.isKid) continue;
			sa.f.partnerId = b;
			sb.f.partnerId = a;
			sa.f.partnerName = sb.f.name;
			sb.f.partnerName = sa.f.name;
			sa.f.lifeMeaning = meaning;
			sb.f.lifeMeaning = meaning;
			sa.f.lifeLine = line;
			sb.f.lifeLine = line;
			sa.coupleSide = -1;
			sb.coupleSide = 1;
			// Same start shop + shared path
			sb.shopId = sa.shopId;
			sb.pos.copy(sa.pos).add(new THREE.Vector3(0.9, 0, 0));
			sb.root.position.copy(sb.pos);
			this.assignNextShop(sa);
			// copy path to partner
			sb.path = sa.path.map((p) => p.clone());
			sb.pathI = 0;
			sb.f.targetShop = sa.f.targetShop;
			sb.f.targetShopId = sa.f.targetShopId;
			this.paintLabel(sa);
			this.paintLabel(sb);
		}
	}

	setTransactionCallback(
		cb: (count: number, pos: THREE.Vector3, storeId: string) => void,
	): void {
		this.onTransaction = cb;
	}

	/** Viewer controls guest unhappiness (RCT style) */
	nudgeAllMood(delta: number): void {
		for (const s of this.sims) {
			s.f.unhappiness = Math.max(0, Math.min(100, s.f.unhappiness + delta));
			this.paintLabel(s);
			this.applyFaceMood(s);
		}
	}

	dancing = false;

	/** One dashboard row per shopper — where they are and what they're up to. */
	getPeopleSnapshot(
		playerPos: THREE.Vector3,
		out: PersonRow[] = [],
	): PersonRow[] {
		out.length = 0;
		for (const s of this.sims) {
			const f = s.f;
			let doing: string;
			if (this.dancing) doing = '🕺 danst';
			else if (s.speechLife > 0) doing = '💬 kletst';
			else if (s.wait > 0) doing = `🛍 kijkt rond bij ${f.targetShop}`;
			else doing = `🚶 → ${f.targetShop}`;
			out.push({
				id: f.id,
				name: f.name,
				x: s.pos.x,
				z: s.pos.z,
				floor: s.pos.y > 3 ? 1 : 0,
				doing,
				unhappiness: f.unhappiness,
				moneySpent: f.moneySpent,
				partnerName: f.partnerName,
				isKid: !!f.isKid,
				dist: s.pos.distanceTo(playerPos),
			});
		}
		out.sort((a, b) => a.dist - b.dist);
		return out;
	}

	/** Wired from App: world-space belt drift at a position, or null. */
	private beltProvider:
		| ((x: number, y: number, z: number) => { x: number; z: number } | null)
		| null = null;

	setBeltProvider(
		fn: (x: number, y: number, z: number) => { x: number; z: number } | null,
	): void {
		this.beltProvider = fn;
	}

	setDancing(on: boolean): void {
		this.dancing = on;
		if (on) {
			for (const s of this.sims) {
				s.f.unhappiness = Math.max(0, s.f.unhappiness - 10);
				this.applyFaceMood(s);
			}
		}
	}

	getSimsNear(worldPos: THREE.Vector3, radius: number): SimFactors[] {
		return this.sims
			.filter((s) => s.pos.distanceTo(worldPos) < radius)
			.map((s) => s.f);
	}

	/** Fat Americans for UFO probe (prefer thicc / hangry) */
	getProbeCandidates(max = 6): { id: number; pos: THREE.Vector3 }[] {
		const ranked = [...this.sims]
			.filter((s) => !s.f.isKid)
			.sort((a, b) => b.f.thicc - a.f.thicc || b.f.unhappiness - a.f.unhappiness)
			.slice(0, max);
		// Cluster: pick around a random thicc seed
		if (!ranked.length) return [];
		const seed = ranked[Math.floor(Math.random() * Math.min(4, ranked.length))];
		return this.sims
			.filter((s) => s.pos.distanceTo(seed.pos) < 9 && !s.f.isKid)
			.slice(0, max)
			.map((s) => ({ id: s.f.id, pos: s.pos.clone() }));
	}

	/** Probe shock: unhappiness + temporary freeze */
	applyProbeShock(ids: number[]): void {
		for (const id of ids) {
			const s = this.sims.find((x) => x.f.id === id);
			if (!s) continue;
			s.f.unhappiness = Math.min(100, s.f.unhappiness + 18);
			s.f.mood = 'lost';
			s.wait = Math.max(s.wait, 2.5);
			this.paintLabel(s);
			this.applyFaceMood(s);
			this.sayGibberish(s);
		}
	}

	/** Alien lift — override root Y without breaking path pos permanently */
	nudgeSimHeight(id: number, worldY: number): void {
		const s = this.sims.find((x) => x.f.id === id);
		if (!s) return;
		s.root.position.y = worldY;
	}

	/** Crowd at DJ Bartek: speech bubbles + happier + short freeze-dance */
	cheerNear(worldPos: THREE.Vector3, radius: number): void {
		const cheers = [
			'BARTEK! BARTEK!',
			'DROP IT!',
			'Squeak banger!',
			'Thicc & thriving',
			'Trap-gat forever',
			'Yallah dansen!',
		];
		for (const s of this.sims) {
			if (Math.abs(s.pos.y - worldPos.y) > 2.5) continue;
			if (s.pos.distanceTo(worldPos) > radius) continue;
			s.f.unhappiness = Math.max(0, s.f.unhappiness - 8);
			s.f.mood = Math.random() > 0.4 ? 'hyped' : s.f.mood;
			s.wait = Math.max(s.wait, 0.8 + Math.random());
			const line = cheers[Math.floor(Math.random() * cheers.length)];
			const ctx = s.speechCtx;
			ctx.clearRect(0, 0, 280, 72);
			ctx.fillStyle = 'rgba(255,255,255,0.96)';
			ctx.fillRect(6, 6, 268, 60);
			ctx.strokeStyle = '#ec4899';
			ctx.lineWidth = 3;
			ctx.strokeRect(6, 6, 268, 60);
			ctx.fillStyle = '#be185d';
			ctx.font = '700 18px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(line, 140, 36);
			s.speechTex.needsUpdate = true;
			s.speech.visible = true;
			(s.speech.material as THREE.SpriteMaterial).visible = true;
			s.speechLife = 2.2 + Math.random();
			this.paintLabel(s);
			this.applyFaceMood(s);
		}
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

	/**
	 * True first-person eye pose for guest view.
	 * Eyes sit on the face (+Z in body space); camera must look along the
	 * character's facing (Three cameras look down −Z → yaw = root.y + π).
	 */
	getSimEye(id: number): { pos: THREE.Vector3; yaw: number } | null {
		const s = this.sims.find((x) => x.f.id === id);
		if (!s) return null;
		// Midpoint of actual eye meshes in world space (respects body scale + bounce)
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		s.eyeL.getWorldPosition(a);
		s.eyeR.getWorldPosition(b);
		const pos = a.add(b).multiplyScalar(0.5);
		// Slightly forward of the face so we don't clip the head mesh if un-hidden
		const yawFace = s.root.rotation.y;
		const forward = new THREE.Vector3(Math.sin(yawFace), 0, Math.cos(yawFace));
		pos.addScaledVector(forward, 0.12);
		pos.y += 0.04; // brow / pupil height, not chin
		// Camera looks −Z; character faces +Z → add π
		return { pos, yaw: yawFace + Math.PI };
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

	update(dt: number, playerPos?: THREE.Vector3): void {
		if (playerPos) this.listener = playerPos;
		if (this.dancing) {
			for (const s of this.sims) {
				this.tickDance(s, dt);
				this.tickFace(s, dt);
				this.cullSpeechVisibility(s);
			}
		} else {
			for (const s of this.sims) {
				this.tick(s, dt);
				this.tickFace(s, dt);
				this.cullSpeechVisibility(s);
			}
			this.resolveAgents();
			this.tickGossip(dt);
		}
		this.tickFarts(dt);
		this.tickCoins(dt);
		this.tickBubbles(dt);
	}

	/** Same floor + close enough that the player could actually read the bubble */
	private isNearListener(pos: THREE.Vector3, range = Americans.SPEECH_RANGE): boolean {
		const L = this.listener;
		if (!L) return false;
		if (Math.abs(pos.y - L.y) > 2.5) return false; // other floor
		const dx = pos.x - L.x;
		const dz = pos.z - L.z;
		return dx * dx + dz * dz <= range * range;
	}

	/** Kill bubbles the player cannot see — no free floating text on other levels */
	private cullSpeechVisibility(sim: Sim): void {
		if (sim.speechLife <= 0) {
			if (sim.speech.visible) sim.speech.visible = false;
			return;
		}
		const ok = this.isNearListener(sim.pos, Americans.SPEECH_RANGE);
		sim.speech.visible = ok;
		(sim.speech.material as THREE.SpriteMaterial).visible = ok;
		// Don't burn life while culled far away? Still tick down so they don't pile up.
	}

	/**
	 * Occasionally yell at the player when they walk too close.
	 * Returns the line if someone roasted you (for HUD).
	 */
	maybeRoastPlayer(playerPos: THREE.Vector3, dt: number): string | null {
		this.roastPlayerCd -= dt;
		if (this.roastPlayerCd > 0) return null;
		let best: Sim | null = null;
		let bestD = 2.8;
		for (const s of this.sims) {
			if (s.f.isKid) continue;
			if (Math.abs(s.pos.y - playerPos.y) > 2.5) continue;
			const d = s.pos.distanceTo(playerPos);
			if (d < bestD) {
				bestD = d;
				best = s;
			}
		}
		if (!best || Math.random() > 0.45) {
			this.roastPlayerCd = 2.5 + Math.random() * 3;
			return null;
		}
		this.roastPlayerCd = 8 + Math.random() * 10;
		const mean = best.f.unhappiness >= 50;
		const lines = mean
			? [
				'Kijk uit, lul — dit is geen racebaan.',
				'Hé! Loop niet door me heen, basic.',
				'Yo, personal space. Leer het.',
				'Man, jij botst met alles. Typisch.',
				'Schuif op, ik shop hier.',
				'Watch it — ik ben al hangry.',
			]
			: [
				'Oh sorry — of jij was het.',
				'Even doorlopen, ja?',
				'Yo, bijna botsing.',
				'Chill in de gang, oké?',
			];
		const line = lines[Math.floor(Math.random() * lines.length)];
		this.sayLine(best, line, false);
		return `${best.f.name}: ${line}`;
	}

	/**
	 * Nearby sims chat via OpenRouter — ONLY pairs near the player on the same floor.
	 * No LLM tokens for ghosts on other levels you cannot see.
	 */
	private tickGossip(dt: number): void {
		this.gossipCd -= dt;
		if (this.gossipCd > 0 || this.gossipBusy) return;
		const L = this.listener;
		if (!L) {
			this.gossipCd = 3;
			return;
		}

		// Find a close pair near the player (same floor as player)
		let best: [Sim, Sim] | null = null;
		let bestD = 3.2;
		const range = Americans.GOSSIP_RANGE;
		const range2 = range * range;
		for (let i = 0; i < this.sims.length; i++) {
			const a = this.sims[i];
			if (Math.abs(a.pos.y - L.y) > 2.2) continue;
			const adx = a.pos.x - L.x;
			const adz = a.pos.z - L.z;
			if (adx * adx + adz * adz > range2) continue;
			for (let j = i + 1; j < this.sims.length; j++) {
				const b = this.sims[j];
				if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue;
				if (Math.abs(b.pos.y - L.y) > 2.2) continue;
				const bdx = b.pos.x - L.x;
				const bdz = b.pos.z - L.z;
				if (bdx * bdx + bdz * bdz > range2) continue;
				// Don't interrupt if both already mid-speech bubble
				if (a.speechLife > 0.8 && b.speechLife > 0.8) continue;
				const d = a.pos.distanceTo(b.pos);
				if (d < bestD) {
					bestD = d;
					best = [a, b];
				}
			}
		}
		if (!best) {
			this.gossipCd = 3.5;
			return;
		}
		this.gossipCd = 9 + Math.random() * 8;
		const [sa, sb] = best;
		// Brief pause so they "face" the chat
		sa.wait = Math.max(sa.wait, 1.4);
		sb.wait = Math.max(sb.wait, 1.4);
		this.gossipBusy = true;
		const persona = (s: Sim): SimPersona => ({
			name: s.f.name,
			mood: s.f.mood,
			lifeLine: s.f.lifeLine,
			targetShop: s.f.targetShop,
			unhappiness: s.f.unhappiness,
			partnerName: s.f.partnerName,
			isKid: s.f.isKid,
			isBrad: s.f.isBrad,
			isMiss: s.f.isMiss,
		});
		const ctx = sa.f.partnerId === sb.f.id
			? 'koppel loopt hand in hand'
			: bestD < 1.8
			? 'bijna botsing in de gang'
			: 'passeren in de mall (dicht bij speler)';
		void fetchSimChat(persona(sa), persona(sb), ctx)
			.then((ex) => {
				// Re-check visibility — player may have left the floor mid-request
				if (this.isNearListener(sa.pos, Americans.GOSSIP_RANGE + 4)) {
					this.sayLine(sa, ex.a, false);
				}
				window.setTimeout(() => {
					if (this.isNearListener(sb.pos, Americans.GOSSIP_RANGE + 4)) {
						this.sayLine(sb, ex.b, false);
					}
				}, 900);
			})
			.finally(() => {
				this.gossipBusy = false;
			});
	}

	/**
	 * Eyes blink (scale Y) + mouth oval scales while talking.
	 * Mood changes base mouth shape (happy open vs flat vs sad).
	 */
	private tickFace(sim: Sim, dt: number): void {
		// Blink every few seconds
		sim.blinkT -= dt;
		let eyeY = 1;
		if (sim.blinkT < 0.08) {
			eyeY = Math.max(0.08, sim.blinkT / 0.08); // closing
			if (sim.blinkT < 0) {
				sim.blinkT = 1.8 + Math.random() * 3.5;
			}
		} else if (sim.blinkT < 0.12) {
			eyeY = (0.12 - sim.blinkT) / 0.04; // opening
			eyeY = Math.min(1, eyeY);
		}
		sim.eyeL.scale.set(1, eyeY, 1);
		sim.eyeR.scale.set(1, eyeY, 1);

		// Mood shapes the arc: happy curves up (smile), miserable flips to a frown.
		const u = sim.f.unhappiness / 100;
		const baseX = u > 0.65 ? 0.85 : u > 0.4 ? 0.95 : 1.1;
		const baseY = u > 0.65 ? 0.5 : u > 0.4 ? 0.7 : 1;
		const baseZ = 1;
		// Arc opens downward by default (∩) — π turns it into a smile (∪)
		const want = u > 0.55 ? 0 : Math.PI;
		let d = want - sim.mouth.rotation.z;
		while (d > Math.PI) d -= Math.PI * 2;
		while (d < -Math.PI) d += Math.PI * 2;
		sim.mouth.rotation.z += d * Math.min(1, dt * 6 || 1);

		if (sim.speechLife > 0) {
			sim.talkPhase += dt * 14;
			const open = 0.55 + Math.abs(Math.sin(sim.talkPhase)) * 1.5;
			sim.mouth.scale.set(baseX * 0.95, baseY * open, baseZ);
			// One soft chirp now and then — not a bubble machine
			sim.squeakT -= dt;
			if (sim.squeakT <= 0) {
				this.playSqueak(sim);
				sim.squeakT = 0.55 + Math.random() * 0.7;
			}
		} else {
			sim.mouth.scale.set(baseX, baseY, baseZ);
			sim.squeakT = 0;
		}
	}

	private applyFaceMood(sim: Sim): void {
		// Instant mood snap without waiting for next tick
		this.tickFace(sim, 0);
	}

	/** Freeze pathing — everyone boogies in place */
	private tickDance(sim: Sim, dt: number): void {
		sim.phase += dt * 9;
		const bounce = Math.abs(Math.sin(sim.phase * 2)) * 0.18;
		const sway = Math.sin(sim.phase) * 0.35;
		sim.root.position.set(sim.pos.x, sim.pos.y + bounce, sim.pos.z);
		sim.root.rotation.y += dt * 1.8;
		sim.body.rotation.z = sway * 0.25;
		sim.body.rotation.x = Math.sin(sim.phase * 1.5) * 0.12;
		// Arms up dance
		sim.armL.rotation.x = -1.2 + Math.sin(sim.phase * 2) * 0.5;
		sim.armR.rotation.x = -1.2 + Math.cos(sim.phase * 2) * 0.5;
		sim.armL.rotation.z = 0.8 + Math.sin(sim.phase) * 0.3;
		sim.armR.rotation.z = -0.8 - Math.cos(sim.phase) * 0.3;
		// Legs step
		sim.legL.hip.rotation.x = Math.sin(sim.phase * 2) * 0.6;
		sim.legR.hip.rotation.x = Math.sin(sim.phase * 2 + Math.PI) * 0.6;
		sim.legL.knee.rotation.x = 0.4;
		sim.legR.knee.rotation.x = 0.4;
		// Happier faces while dancing
		if (Math.floor(sim.phase) % 8 === 0) {
			sim.f.unhappiness = Math.max(0, sim.f.unhappiness - 0.02);
		}
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

	/** Static walls/stores + hard sim-sim separation (no walking through people) */
	private resolveAgents(): void {
		// More passes = less clumping when a crowd packs a corridor
		for (let pass = 0; pass < 4; pass++) {
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
					const couple = a.f.partnerId === b.f.id || b.f.partnerId === a.f.id;
					// Couples still need space — not merge into one mesh
					const minD = couple ? 1.05 : SIM_SEPARATE;
					const sep = this.world.separate(a.pos.x, a.pos.z, b.pos.x, b.pos.z, minD);
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
		// Americans are HUNGRY — thicc by default (Miss stays slim)
		const thicc = isMiss
			? 0.1 + rng() * 0.08
			: isKid
			? 0.22 + rng() * 0.15
			: isBrad
			? 0.95
			: 0.55 + rng() * 0.42;
		const moodRoll = rng();
		// More hangry energy in the mall
		const mood: SimFactors['mood'] = isBrad
			? 'on_mission'
			: isMiss
			? 'hyped'
			: moodRoll < 0.38
			? 'hangry'
			: moodRoll < 0.55
			? 'lost'
			: moodRoll < 0.68
			? 'hyped'
			: moodRoll < 0.85
			? 'chill'
			: 'on_mission';

		const startShop = SHOPABLE[Math.floor(rng() * SHOPABLE.length)];
		const meanings: LifeMeaning[] = [
			'love',
			'family',
			'health',
			'joy',
			'provide',
			'belong',
			'create',
		];
		const lifeMeaning: LifeMeaning = isBrad
			? 'health'
			: isKid
			? 'joy'
			: isMiss
			? 'belong'
			: meanings[Math.floor(rng() * meanings.length)];
		const lifeLines: Record<LifeMeaning, string> = {
			love: 'Zoekt iets moois voor iemand anders',
			family: 'Houdt het gezin drijvende',
			health: 'Wil gewoon een beetje beter voelen',
			joy: 'Hier om te genieten — full stop',
			provide: 'Brengt de boodschappen thuis',
			belong: 'Wil gezien worden, niet alleen kopen',
			create: 'Haalt inspiratie uit de drukte',
		};

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
			lifeMeaning,
			lifeLine: isBrad
				? 'Vitamines halen — voor zichzelf, eindelijk'
				: mood === 'hangry'
				? 'Mag ik al eten? Nu. Nu. NU.'
				: lifeLines[lifeMeaning],
			partnerId: null,
			partnerName: null,
			targetShop: '…',
			targetShopId: '',
			moneySpent: Math.floor(rng() * 40),
			unhappiness: isMiss
				? Math.floor(8 + rng() * 30)
				: Math.floor(
					28 + rng() * 45 + (mood === 'hangry' ? 30 : 0) + thicc * 12,
				),
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

		// Miss = taller, longer legs, hourglass, more glam ("hotter babes")
		const scale = isKid ? 0.62 : isMiss ? 1.08 : 0.95 + thicc * 0.18;
		const bellyR = isMiss ? 0.2 : isKid ? 0.22 : 0.34 + thicc * 0.36;
		const legLen = isMiss ? 0.82 : isKid ? 0.42 : 0.62;

		const legL = this.makeLeg(f.pants, legLen, -1);
		const legR = this.makeLeg(f.pants, legLen, 1);
		body.add(legL.group, legR.group);

		const torsoY = legLen + 0.08;
		const belly = new THREE.Mesh(
			new THREE.SphereGeometry(bellyR, 12, 10),
			this.mat(f.shirt, 0.9),
		);
		if (isMiss) {
			// tight waist
			belly.scale.set(0.72, 1.0, 0.62);
			belly.position.set(0, torsoY + bellyR * 0.5, 0.02);
		} else {
			belly.scale.set(1.2 + thicc * 0.1, 0.9, 1.1);
			belly.position.set(0, torsoY + bellyR * 0.45, 0.08 + thicc * 0.05);
		}
		body.add(belly);

		const chest = new THREE.Mesh(
			new THREE.SphereGeometry(bellyR * (isMiss ? 1.15 : 0.7), 10, 8),
			this.mat(f.shirt, 0.9),
		);
		// Miss: bigger chest, push forward
		chest.scale.set(isMiss ? 1.55 : 1.3, isMiss ? 1.05 : 0.65, isMiss ? 1.05 : 0.85);
		chest.position.set(0, torsoY + bellyR * (isMiss ? 1.35 : 1.0), isMiss ? 0.12 : 0);
		body.add(chest);

		// Miss: hip flare + heels
		if (isMiss) {
			const hips = new THREE.Mesh(
				new THREE.SphereGeometry(0.22, 10, 8),
				this.mat(f.pants, 0.85),
			);
			hips.scale.set(1.45, 0.55, 0.85);
			hips.position.set(0, torsoY - 0.08, 0.02);
			body.add(hips);
			// stiletto nubs under feet (leg groups already have feet — add glamour shine)
			const heelMat = this.track(
				new THREE.MeshStandardMaterial({
					color: 0x1a1a1a,
					metalness: 0.4,
					roughness: 0.35,
				}),
			);
			for (const side of [-1, 1] as const) {
				const heel = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), heelMat);
				heel.position.set(side * 0.14, 0.02, 0.12);
				heel.rotation.x = Math.PI;
				body.add(heel);
			}
		}

		// Arms pivot AT THE SHOULDER. Rotating the bare mesh spun it around its
		// own middle, so the hand and the elbow swung in opposite directions.
		const armLen = 0.45;
		const armGeo = new THREE.CapsuleGeometry(0.09, armLen, 3, 5);
		const makeArm = (side: -1 | 1): THREE.Group => {
			const pivot = new THREE.Group();
			pivot.position.set(side * bellyR * 1.05, torsoY + bellyR * 1.15, 0);
			const limb = new THREE.Mesh(armGeo, this.mat(f.shirt));
			limb.position.y = -(armLen / 2 + 0.09);
			pivot.add(limb);
			const hand = new THREE.Mesh(
				new THREE.SphereGeometry(0.075, 8, 6),
				this.mat(f.skin, 0.8),
			);
			hand.position.y = -(armLen + 0.13);
			pivot.add(hand);
			return pivot;
		};
		const armL = makeArm(-1);
		const armR = makeArm(1);
		body.add(armL, armR);

		const headY = torsoY + bellyR * 1.4 + 0.28;
		const headR = isKid ? 0.2 : isMiss ? 0.23 : 0.24;
		// Plain skin head — no painted texture face
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(headR, 16, 16),
			this.mat(f.skin, 0.85),
		);
		head.position.set(0, headY, 0);
		body.add(head);

		// ── Face ─────────────────────────────────────────────
		// Features sit ON the skull surface and point outward. The old version put
		// flat-Z spheres at 0.8·R, which buried the mouth completely inside the
		// head and left only a sliver of each eye poking out.
		const darkMat = this.track(new THREE.MeshBasicMaterial({ color: 0x141414 }));
		const scleraMat = this.track(new THREE.MeshBasicMaterial({ color: 0xf7f4f0 }));

		const eyeRad = isKid ? 0.055 : 0.062;
		// Pre-scaled geometry: mesh.scale stays free for blinking (tickFace)
		const scleraGeo = new THREE.SphereGeometry(eyeRad, 12, 10);
		scleraGeo.scale(1, 1.1, 0.45);
		const pupilGeo = new THREE.SphereGeometry(eyeRad * 0.52, 10, 8);
		pupilGeo.scale(1, 1, 0.6);

		const makeEye = (side: -1 | 1): THREE.Mesh => {
			const anchor = new THREE.Group();
			placeOnSkull(anchor, headR, side * 0.36, 0.1, 0.93);
			const sclera = new THREE.Mesh(scleraGeo, scleraMat);
			const pupil = new THREE.Mesh(pupilGeo, darkMat);
			pupil.position.z = eyeRad * 0.36;
			sclera.add(pupil);
			anchor.add(sclera);
			head.add(anchor);
			return sclera;
		};
		const eyeL = makeEye(-1);
		const eyeR = makeEye(1);

		// Mouth = curved arc on the surface: smile, and rotate π for a frown.
		// Kept as a Mesh whose scale/rotation.z belong to tickFace, inside an
		// anchor group that owns the orientation.
		const mouthAnchor = new THREE.Group();
		placeOnSkull(mouthAnchor, headR, 0, -0.42, 0.95);
		const mouthGeo = new THREE.TorusGeometry(
			headR * 0.3,
			headR * 0.055,
			5,
			14,
			Math.PI,
		);
		const mouth = new THREE.Mesh(mouthGeo, darkMat);
		mouthAnchor.add(mouth);
		head.add(mouthAnchor);

		// Brows — cheap, and they carry most of the mood
		const browGeo = new THREE.BoxGeometry(headR * 0.34, headR * 0.06, headR * 0.05);
		for (const side of [-1, 1] as const) {
			const brow = new THREE.Group();
			placeOnSkull(brow, headR, side * 0.36, 0.34, 0.95);
			const bar = new THREE.Mesh(browGeo, darkMat);
			bar.rotation.z = side * -0.12;
			brow.add(bar);
			head.add(brow);
		}

		if (f.isMiss) {
			// Pageant hair volume — open at the front (phi gap) so the wig frames
			// the face instead of engulfing the eyes.
			const hair = new THREE.Mesh(
				new THREE.SphereGeometry(
					0.28,
					14,
					10,
					Math.PI * 0.22,
					Math.PI * 1.56,
					0,
					Math.PI * 0.68,
				),
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
			// Same trick: leave the forehead clear of the hair shell
			const hair = new THREE.Mesh(
				new THREE.SphereGeometry(
					0.25,
					12,
					8,
					Math.PI * 0.2,
					Math.PI * 1.6,
					0,
					Math.PI * 0.58,
				),
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
			eyeL,
			eyeR,
			mouth,
			headY,
			bodyScale: scale,
			blinkT: 1 + rng() * 3,
			talkPhase: 0,
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
			squeakT: 0,
			coupleSide: 0,
		};

		this.assignNextShop(sim);
		this.paintLabel(sim);
		this.applyFaceMood(sim);
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
		// Partner follows lead (lower id is lead)
		if (sim.f.partnerId !== null && sim.f.id > sim.f.partnerId) {
			const lead = this.sims.find((s) => s.f.id === sim.f.partnerId);
			if (lead && lead.f.targetShopId) {
				sim.f.targetShop = lead.f.targetShop;
				sim.f.targetShopId = lead.f.targetShopId;
				sim.path = lead.path.map((p) => p.clone());
				sim.pathI = Math.min(lead.pathI, Math.max(0, lead.path.length - 1));
				sim.shopId = lead.shopId;
				return;
			}
		}

		let next = this.pickShopForMeaning(sim);
		let guard = 0;
		while (next.id === sim.shopId && guard++ < 12) {
			next = this.pickShopForMeaning(sim);
		}

		sim.f.targetShop = next.name.replace('\n', ' ');
		sim.f.targetShopId = next.id;

		const fromNode = STORES.find((s) => s.id === sim.shopId)?.nodeId ?? 'f0_c';
		const toNode = next.nodeId === 'spaceship' ? 's_kruidvat' : next.nodeId;
		const fromStoreNode = fromNode === 'spaceship' ? 's_kruidvat' : fromNode;

		const nodes = this.pathfinder.findPath(fromStoreNode, toNode);
		if (nodes.length >= 2) {
			sim.path = nodes.map((n) => {
				const y = n.y < 3 ? 0 : 6;
				return new THREE.Vector3(n.x, y, n.z);
			});
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

		// Sync partner destination
		if (sim.f.partnerId !== null && sim.f.id < sim.f.partnerId) {
			const partner = this.sims.find((s) => s.f.id === sim.f.partnerId);
			if (partner) {
				partner.f.targetShop = sim.f.targetShop;
				partner.f.targetShopId = sim.f.targetShopId;
				partner.path = sim.path.map((p) => p.clone());
				partner.pathI = 0;
				partner.shopId = sim.shopId;
				this.paintLabel(partner);
			}
		}
	}

	/** Life meaning steers where they shop — not pure random */
	private pickShopForMeaning(sim: Sim): (typeof SHOPABLE)[0] {
		const m = sim.f.lifeMeaning;
		const prefer: Record<LifeMeaning, string[]> = {
			love: ['saucy', 'rituals', 'douglas', 'sephora', 'zara'],
			family: ['foodcourt', 'primark', 'ikea', 'action', 'starbucks'],
			health: ['kruidvat', 'decathlon', 'rituals'],
			joy: ['foodcourt', 'gamesman', 'saucy', 'starbucks', 'nike'],
			provide: ['foodcourt', 'ikea', 'action', 'coolblue', 'kruidvat'],
			belong: ['zara', 'uniqlo', 'sephora', 'hm', 'saucy'],
			create: ['apple', 'mediaworld', 'uniqlo', 'coolblue'],
		};
		// Hangry → food court first, always
		if (sim.f.mood === 'hangry' && Math.random() < 0.72) {
			return SHOPABLE.find((s) => s.id === 'foodcourt') ?? SHOPABLE[0];
		}
		if (sim.f.isBrad && Math.random() < 0.55) {
			return SHOPABLE.find((s) => s.id === 'kruidvat') ?? SHOPABLE[0];
		}
		// Extra thicc people also drift toward grease
		if (sim.f.thicc > 0.7 && Math.random() < 0.35) {
			return SHOPABLE.find((s) => s.id === 'foodcourt') ?? SHOPABLE[0];
		}
		const list = prefer[m];
		if (Math.random() < 0.72) {
			const id = list[Math.floor(Math.random() * list.length)];
			return SHOPABLE.find((s) => s.id === id) ?? SHOPABLE[0];
		}
		return SHOPABLE[Math.floor(Math.random() * SHOPABLE.length)];
	}

	private tick(sim: Sim, dt: number): void {
		const f = sim.f;

		// Loopband conveys the shitties standing on it
		if (this.beltProvider) {
			const belt = this.beltProvider(sim.pos.x, sim.pos.y, sim.pos.z);
			if (belt) {
				sim.pos.x += belt.x * dt;
				sim.pos.z += belt.z * dt;
			}
		}

		// Hunger climbs — hangry cascade
		if (!f.isMiss && Math.random() < dt * 0.08) {
			f.unhappiness = Math.min(100, f.unhappiness + 0.4 + f.thicc * 0.3);
			if (f.unhappiness > 60 && f.mood !== 'hangry' && Math.random() < 0.15) {
				f.mood = 'hangry';
				f.lifeLine = 'Mag ik al eten? Nu. Nu. NU.';
			}
		}

		// Fart timer
		f.fartCd -= dt;
		if (f.fartCd <= 0) {
			this.doFart(sim);
			f.fartCd = 8 + Math.random() * 22;
			f.unhappiness = Math.min(100, f.unhappiness + 2);
		}

		// Gibberish chatter — only near the player (no bubbles on other floors)
		sim.gibberCd -= dt;
		if (sim.speechLife > 0) {
			sim.speechLife -= dt;
			if (sim.speechLife <= 0) {
				sim.speech.visible = false;
				(sim.speech.material as THREE.SpriteMaterial).visible = false;
			}
		} else if (sim.gibberCd <= 0) {
			sim.gibberCd = 6 + Math.random() * 16;
			if (this.isNearListener(sim.pos, Americans.SPEECH_RANGE)) {
				this.sayGibberish(sim);
			}
		}

		if (sim.wait > 0) {
			sim.wait -= dt;
			sim.velocity.set(0, 0, 0);
			this.animateLegs(sim, 0, dt);
			sim.root.position.copy(sim.pos);
			// slowly more unhappy while waiting (mall fatigue) — less if shops open
			f.unhappiness = Math.min(100, f.unhappiness + dt * 0.35);
			this.paintLabel(sim);
			return;
		}

		if (sim.pathI >= sim.path.length) {
			// Arrived at OPEN shop — spend money + coin particles + happier (verkoper!)
			const spend = 8 + Math.floor(Math.random() * 55);
			f.moneySpent += spend;
			// Open shops: shopping usually helps mood a bit
			if (sim.f.targetShopId === 'foodcourt') {
				f.unhappiness = Math.max(0, f.unhappiness - 22);
				if (f.mood === 'hangry') f.mood = 'chill';
				f.lifeLine = 'Buik vol. Even overleven.';
			} else if (f.mood === 'hangry') {
				f.unhappiness = Math.min(100, f.unhappiness + 4);
			} else if (sim.f.targetShopId === 'rituals') {
				f.unhappiness = Math.max(0, f.unhappiness - 18);
			} else if (sim.f.targetShopId === 'kruidvat') {
				f.unhappiness = Math.max(0, f.unhappiness - 12);
			} else {
				f.unhappiness = Math.max(0, f.unhappiness + Math.floor(Math.random() * 8) - 6);
			}

			this.spawnCoins(sim.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), spend);
			this.transactionCount++;
			// Money paid AT this shop → shopkeeper register
			const paidAt = sim.f.targetShopId || sim.shopId;
			this.onTransaction?.(this.transactionCount, sim.pos.clone(), paidAt);
			this.sayGibberish(sim, true);

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

		// Soft push off nearby walkers mid-step (stops body-merge before resolveAgents)
		for (const other of this.sims) {
			if (other === sim) continue;
			if (Math.abs(other.pos.y - sim.pos.y) > 2.5) continue;
			const couple = sim.f.partnerId === other.f.id || other.f.partnerId === sim.f.id;
			const minD = couple ? 1.0 : SIM_SEPARATE * 0.95;
			const dx = sim.pos.x - other.pos.x;
			const dz = sim.pos.z - other.pos.z;
			const d2 = dx * dx + dz * dz;
			if (d2 > minD * minD || d2 < 1e-8) continue;
			const d = Math.sqrt(d2);
			const push = (minD - d) * 0.55;
			sim.pos.x += (dx / d) * push;
			sim.pos.z += (dz / d) * push;
		}

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

		// Kids: rare quiet soap pop (was a constant bubble storm — no more)
		if (f.isKid) {
			sim.bubbleCd -= dt;
			if (sim.bubbleCd <= 0) {
				if (Math.random() < 0.25) {
					this.spawnBubbles(sim.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
				}
				sim.bubbleCd = 6 + Math.random() * 10;
			}
		}

		// Couple walks side-by-side (meaning: love / family — not alone)
		if (f.partnerId !== null && sim.coupleSide !== 0) {
			const partner = this.sims.find((s) => s.f.id === f.partnerId);
			if (partner) {
				const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(
					sim.coupleSide * 0.55,
				);
				// Soft pull toward parallel lane next to partner lead path
				if (f.id > f.partnerId) {
					const ideal = partner.pos.clone().add(side);
					sim.pos.x = THREE.MathUtils.lerp(sim.pos.x, ideal.x, 0.12);
					sim.pos.z = THREE.MathUtils.lerp(sim.pos.z, ideal.z, 0.12);
					const fix = this.world.resolveCircle(
						sim.pos.x,
						sim.pos.z,
						sim.pos.y,
						SIM_RADIUS,
					);
					sim.pos.x = fix.x;
					sim.pos.z = fix.z;
				}
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
		// One half-cycle (π) = one step, so cadence follows actual ground speed
		sim.phase += (dt * Math.PI * speedNow) / this.walkParams(sim).step;
		this.animateLegs(sim, speedNow, dt);

		sim.root.position.set(sim.pos.x, sim.pos.y, sim.pos.z);
		this.paintLabel(sim);
	}

	/**
	 * Swing amplitude and the ground distance one step covers.
	 * `phase` is advanced from this so the feet never slide.
	 */
	private walkParams(sim: Sim): { amp: number; step: number } {
		const legLen = sim.legL.hip.position.y || 0.62;
		const amp = 0.42 * sim.f.stride;
		return { amp, step: Math.max(0.2, 2 * legLen * Math.sin(amp)) };
	}

	/**
	 * POOTJES. Hip swing, knee flex on lift-off, heel-to-toe foot roll.
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

		// Amplitude is tied to the step length that drives `phase` (see walkParams),
		// so the planted foot travels backwards at exactly walking speed instead of
		// skating across the tiles.
		const { amp } = this.walkParams(sim);
		const L = Math.sin(sim.phase) * amp;
		const R = Math.sin(sim.phase + Math.PI) * amp;

		// Hips — positive rotation swings the leg behind the body (+Z is the face)
		sim.legL.hip.rotation.x = L;
		sim.legR.hip.rotation.x = R;

		// Knees flex while the leg is BEHIND and lifting off — bending on the
		// forward swing (the old `max(0, -L)`) read as a backwards moonwalk.
		sim.legL.knee.rotation.x = Math.max(0, L) * 1.15 + 0.1;
		sim.legR.knee.rotation.x = Math.max(0, R) * 1.15 + 0.1;

		// Toe up in front (heel strike), toe down behind (toe-off)
		const toe = (l: number) => (l < 0 ? l * 0.5 : l * 0.3 * (0.7 + 0.3 * f.stomp));
		sim.legL.foot.rotation.x = toe(L);
		sim.legR.foot.rotation.x = toe(R);

		// Arms opposite the same-side leg
		sim.armL.rotation.x = -L * 0.7;
		sim.armR.rotation.x = -R * 0.7;

		// Body rises over each planted leg — twice per cycle
		sim.body.position.y = Math.abs(Math.sin(sim.phase)) * 0.035 * f.stomp;
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
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'left';
		const name = f.partnerName !== null ? `${f.name.slice(0, 10)} ❤️` : f.name.slice(0, 16);
		ctx.fillText(name, 16, 26);

		ctx.font = '600 15px system-ui,sans-serif';
		ctx.fillStyle = '#c4b5fd';
		ctx.fillText(f.lifeLine.slice(0, 28), 16, 48);

		ctx.fillStyle = '#93c5fd';
		ctx.fillText(`→ ${f.targetShop.slice(0, 14)}`, 16, 70);

		ctx.fillStyle = '#fbbf24';
		ctx.fillText(`€${f.moneySpent}`, 16, 92);

		const face = f.unhappiness > 70 ? '😭' : f.unhappiness > 40 ? '😕' : '😊';
		ctx.fillStyle = f.unhappiness > 70 ? '#fca5a5' : '#e2e8f0';
		ctx.fillText(`${face}${Math.round(f.unhappiness)}%`, 100, 92);

		sim.labelTex.needsUpdate = true;
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
		this.applyFaceMood(best);
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

	/** Speech bubble with real words (gossip / checkout) — skipped if not visible to player */
	private sayLine(sim: Sim, line: string, checkout = false): void {
		// Never paint / show / squeak for sims the player can't see
		if (!this.isNearListener(sim.pos, Americans.SPEECH_RANGE + (checkout ? 6 : 0))) {
			return;
		}
		const ctx = sim.speechCtx;
		ctx.clearRect(0, 0, 280, 72);
		ctx.fillStyle = 'rgba(255,255,255,0.96)';
		roundRect(ctx, 4, 4, 272, 64, 14);
		ctx.fill();
		ctx.strokeStyle = checkout ? '#16a34a' : '#7c3aed';
		ctx.lineWidth = 2.5;
		roundRect(ctx, 4, 4, 272, 64, 14);
		ctx.stroke();
		ctx.fillStyle = '#0f172a';
		ctx.font = '600 14px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const words = line.split(' ');
		let l1 = '';
		let l2 = '';
		for (const w of words) {
			const t = (l1 ? `${l1} ` : '') + w;
			if (ctx.measureText(t).width < 250 && !l2) l1 = t;
			else l2 = (l2 ? `${l2} ` : '') + w;
		}
		if (l2) {
			ctx.fillText(l1.slice(0, 36), 140, 28);
			ctx.fillText(l2.slice(0, 36), 140, 48);
		} else {
			ctx.fillText(l1.slice(0, 40), 140, 36);
		}
		sim.speechTex.needsUpdate = true;
		sim.speech.visible = true;
		(sim.speech.material as THREE.SpriteMaterial).visible = true;
		sim.speechLife = 3.2 + Math.random() * 1.4;
		sim.squeakT = 0.5;
		this.playSqueak(sim, 0);
	}

	private sayGibberish(sim: Sim, checkout = false): void {
		let line: string;
		if (checkout) {
			const owner = getOwner(sim.f.targetShopId || sim.shopId);
			if (owner && owner.lines.length > 0 && Math.random() < 0.85) {
				line = `${owner.name.split(' ')[0]}: ${owner.lines[Math.floor(Math.random() * owner.lines.length)]}`;
			} else if (sim.f.partnerName) {
				line = [
					`Voor ${sim.f.partnerName.split(' ')[0]} ❤️`,
					'Wij samen, yallah!',
					'Pecunia accepta, amore!',
				][Math.floor(Math.random() * 3)];
			} else {
				line = ['Pecunia accepta!', 'Dankjewel, next!', 'Kassa done ✓'][
					Math.floor(Math.random() * 3)
				];
			}
		} else if (sim.f.partnerName && Math.random() < 0.35) {
			const p = sim.f.partnerName.split(' ')[0];
			line = [
				`${p}… even wachten ❤️`,
				'Handje? Handje.',
				`Voor ons, ${p}.`,
				sim.f.lifeLine.slice(0, 26),
			][Math.floor(Math.random() * 4)];
		} else {
			line = GIBBER[Math.floor(Math.random() * GIBBER.length)];
		}
		this.sayLine(sim, line, checkout);
	}

	/** Soft short chirp when someone talks — not a soap-bubble machine */
	private playSqueak(sim: Sim, delay = 0): void {
		if (!this.audio) return;
		const ctx = this.audio;
		const t0 = ctx.currentTime + delay;
		// Lower, shorter, quieter — was 480–900 Hz sine spam (= bubbels)
		const base = sim.f.isKid ? 380 : sim.f.isMiss ? 280 : 180;
		const pitch = base + Math.random() * 60 + (sim.f.id % 5) * 12;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		const f = ctx.createBiquadFilter();
		o.type = 'triangle';
		o.frequency.setValueAtTime(pitch, t0);
		o.frequency.exponentialRampToValueAtTime(pitch * 0.85, t0 + 0.06);
		f.type = 'lowpass';
		f.frequency.value = pitch * 2.2;
		f.Q.value = 0.7;
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(0.018, t0 + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
		o.connect(f);
		f.connect(g);
		g.connect(ctx.destination);
		o.start(t0);
		o.stop(t0 + 0.09);
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
