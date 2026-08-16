import type { CanvasTexture, Material, Object3D } from 'three';
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CapsuleGeometry,
	ConeGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	Points,
	PointsMaterial,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	TorusGeometry,
	Vector3,
} from 'three';
import type { NodeId } from '#/data/graph';
import type { LevelId } from '#/data/levels';
import { levelAt, levelY } from '#/data/levels';
import { getOwner } from '#/data/shopOwners';
import type { StoreDef } from '#/data/stores';
import { STORES } from '#/data/stores';
import { Pathfinder } from '#/path/Pathfinder';
import type { AABB, CollisionWorld } from '#/physics/Collision';
import type { LitMaterial } from '#/render/material';
import { lit } from '#/render/material';
import type { OrcaBody, VelocityConstraint } from '#/sim/Orca';
import { agentConstraint, RECIPROCAL_SHARE, solveVelocity, staticConstraint } from '#/sim/Orca';
import type { SimPersona } from '#/sim/SimChat';
import { fetchSimChat } from '#/sim/SimChat';

import { fitText, labelCanvas, labelTexture, roundRect } from '#/util/label';
import { clamp, ease, easeFactor, half, lerp, shortestAngle } from '#/util/math';
import { at, jitter, mulberry32, pick, pickWith, plusMinusWith } from '#/util/rand';
import { isOnViewerLevel, tagLevelCulled } from '#/util/visibility';

export type LifeMeaning = 'love' | 'family' | 'health' | 'joy' | 'provide' | 'belong' | 'create';

export interface SimFactors {
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
}

interface Limb {
	group: Group;
	hip: Group;
	knee: Group;
	foot: Mesh;
}

/** Dashboard row: who, where, and what they're doing right now. */
const LABEL_W = 320;
const LABEL_H = 120;

export interface PersonRow {
	id: number;
	name: string;
	x: number;
	z: number;
	level: LevelId;
	doing: string;
	unhappiness: number;
	moneySpent: number;
	partnerName: string | null;
	isKid: boolean;
	dist: number;
}

const SKULL_OUT = new Vector3(0, 0, 1);

/**
 * Park an object on a head sphere of radius `headR`, local +Z pointing straight
 * out of the surface. `sink` < 1 pushes it slightly into the skull so flattened
 * features sit flush instead of floating.
 */
function placeOnSkull(obj: Object3D, headR: number, yaw: number, pitch: number, sink: number): void {
	const n = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
	obj.position.copy(n).multiplyScalar(headR * sink);
	obj.quaternion.setFromUnitVectors(SKULL_OUT, n);
}

interface Sim {
	f: SimFactors;
	root: Group;
	body: Group;
	legL: Limb;
	legR: Limb;
	armL: Object3D;
	armR: Object3D;
	label: Sprite;
	/**
	 * Houder van plaat én ballon op voethoogte: cullByLevel bezit zijn
	 * `visible`. Eén houder, want beide labels stellen dezelfde dekvraag over
	 * dezelfde sim; twee houders zijn twee antwoorden die uit elkaar kunnen lopen.
	 */
	levelAnchor: Group;
	/** Tekst veranderde terwijl de plaat weggeculld stond */
	plateDirty: boolean;
	speech: Sprite;
	speechTex: CanvasTexture;
	speechCtx: CanvasRenderingContext2D;
	speechLife: number;
	/** Simple face: black sphere eyes + oval mouth */
	eyeL: Mesh;
	eyeR: Mesh;
	mouth: Mesh;
	headY: number;
	/** body.scale scalar — head world Y = headY * bodyScale */
	bodyScale: number;
	blinkT: number;
	talkPhase: number;
	pos: Vector3;
	/** unit direction of travel — THE VECTOR */
	velocity: Vector3;
	/** Visible-body footprint used for walls and last-resort overlap repair. */
	radius: number;
	/** Velocity ORCA cleared for this frame: the goal direction with every conflict already taken out. */
	steer: Vector3;
	path: Vector3[];
	pathI: number;
	/** Route length measured when the path was planned, from where the sim stood. */
	routeLength: number;
	/** Furthest along that route this sim has been; progress is measured against this and never against a single frame. */
	routeBest: number;
	/** Seconds since `routeBest` last moved — the one clock that decides someone is stuck. */
	sinceProgress: number;
	/** Waypoints given up on during this route, because standing on them turned out to be impossible. */
	skippedNodes: number;
	/** Times this route was planned again after a stall. */
	replans: number;
	/** This sim's own lane, sideways off the shared waypoint line. */
	laneOffset: number;
	wait: number;
	phase: number;
	shopId: string;
	labelCanvas: HTMLCanvasElement;
	labelCtx: CanvasRenderingContext2D;
	labelTex: CanvasTexture;
	gibberCd: number;
	bubbleCd: number;
	/** next squeak while speech bubble is open */
	squeakT: number;
	/** side offset when walking as couple (−1 / +1) */
	coupleSide: number;
	/** dt banked while throttled off-level, spent whole on the next real tick */
	lag: number;
	/**
	 * Deze sim zijn eigen stroom voor alles wat hij onderweg trekt: welke winkel
	 * hij kiest, wanneer zijn honger omslaat, hoe lang hij bij de kassa staat.
	 *
	 * Los van de stroom die zijn uiterlijk tekent, zodat een trekking erbij in de
	 * ene de andere niet verschuift, en per sim zodat de volgorde waarin de lus
	 * langs de menigte gaat niet meebepaalt wat er getrokken wordt.
	 */
	roll: () => number;
}

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
const MISS_NAMES = ['Miss Dakota', 'Miss Texas', 'Miss California', 'Eva G.', 'Miss Florida'];
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
const SHOPABLE = STORES.filter((s) => s.id !== 'info' && (!s.utility || s.id === 'foodcourt'));

function shopEntrance(s: StoreDef): Vector3 {
	// stand in corridor in front of store, not inside wall
	const pull = 3.5;
	const x = s.x + Math.sin(s.rotation) * pull;
	const z = s.z + Math.cos(s.rotation) * pull;
	return new Vector3(x, levelY(s.level), z);
}

/**
 * True mall NPCs: shop → shop routes, velocity vector, legs+feet that walk hard,
 * head plates (destination / € spent / unhappiness), occasional farts + noises.
 */
/** How far ahead a walker resolves another walker. Two seconds is about the distance a mall shopper actually reads. */
const SIM_AVOIDANCE_HORIZON = 2;
/** A wall is answered later than a person: steering around it a second early puts everyone in the middle of the corridor. */
const SIM_WALL_HORIZON = 0.9;
/** Personal space on top of the two bodies. A couple walks without it; strangers do not. */
const SIM_COMFORT_MARGIN = 0.35;
/** Neighbours further than this cannot reach the sim inside the horizon, so the grid never hands them over. */
const SIM_NEIGHBOUR_REACH = 4.5;
/** Walls further than this are not in the way yet. */
const SIM_WALL_REACH = 2.5;
/** Height difference above which two sims are on different decks and do not see each other at all. */
const SIM_DECK_BAND = 2.5;
/** Passes of the projection solver over the half-planes. */
const SIM_SOLVER_ROUNDS = 3;
/** A frame shorter than this makes the collision term explode; the solver reads it as this long. */
const SIM_MIN_STEP = 1 / 240;

/** Width of the band of lanes guests spread their shared waypoints over. */
const LANE_SPREAD = 1.8;
/** Own seed, so a lane never shifts the draws that make a sim look like itself. */
const LANE_SEED = 0x1a2e5;

/** Movement that counts as getting somewhere: one stride, not one frame of jitter. */
const PROGRESS_STRIDE = 0.35;
/** No stride in this long and the guest is stuck, not slow. */
const STUCK_SECONDS = 5;
/** Standing this close to an unreachable waypoint is as close as the geometry allows; retire it and walk on. */
const WAYPOINT_GIVE_UP = 3;
/** Replans of one route before the guest gives up on the shop itself. */
const MAX_REPLANS = 2;
/** Skipped waypoints on one route before the same. */
const MAX_SKIPS = 3;
/** Clearance past the body radius for a corner walked around, so the detour is not tangent to the box it dodges. */
const DETOUR_MARGIN = 0.2;
/** Obstacles solved on one leg of the route. Beyond this the gap really is shut and the route itself has to change. */
const MAX_DETOURS = 2;
/** Nearby graph nodes tried as the start of a route before settling for the closest one. */
const START_NODE_CANDIDATES = 6;
/** How hard the follower of a couple is pulled into the lane beside its partner, per second. */
const COUPLE_PULL = 7.2;
/** Where the crowd is drawn from. One number decides who they are and where they walk. */
const CROWD_SEED = 0xbadc0de;
/** Offsets the behaviour stream from the one that draws a sim's looks, so the two never share a draw. */
const BEHAVIOUR_SEED = 0x5eed1;

// ── build ───────────────────────────────────────────────────
/** Step length: pageant girls walk one fixed catwalk stride, everyone else rolls theirs. */
const STRIDE_MISS = 1.05;
const STRIDE_BASE = 0.85;
const STRIDE_SPREAD = 0.5;
/** Belly height above the waist, as a fraction of the belly radius. */
const BELLY_RISE_MISS = 0.5;
const BELLY_RISE = 0.45;
/** Bag hangs this far out (× belly radius) at this height (× torso height). */
const BAG_OUT = 1.25;
const BAG_RISE = 0.5;
/** Leg parts as fractions of legLen: capsule lengths, and drops below their own joint. */
const LEG_THIGH_LEN = 0.42;
const LEG_THIGH_Y = 0.28;
const LEG_KNEE_Y = 0.5;
const LEG_SHIN_LEN = 0.35;
const LEG_SHIN_Y = 0.2;
const LEG_FOOT_Y = 0.42;
const LEG_SOLE_Y = 0.47;

// ── animation ───────────────────────────────────────────────
/** Dance arms: held overhead, swinging this far either side. */
const DANCE_ARM_LIFT = -1.2;
const DANCE_ARM_SWING = 0.5;
/** Standing still still breathes: sway at half the walk phase, barely a centimetre. */
const IDLE_BOB_TEMPO = 0.5;
const IDLE_BOB_AMP = 0.012;
/** Foot roll: toe up in front, toe down behind, the down half scaled by stomp. */
const TOE_HEEL = 0.5;
const TOE_OFF = 0.3;
const TOE_STOMP_BASE = 0.7;
const TOE_STOMP_SPREAD = 0.3;
/** Particle clouds (bubbles, farts) fade this much opacity per second of life left. */
const CLOUD_FADE = 0.5;

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
	readonly group = new Group();
	readonly roster: SimFactors[] = [];
	/** global checkout count → triggers baker thief */
	transactionCount = 0;
	private sims: Sim[] = [];
	private materials: Material[] = [];
	private pathfinder = new Pathfinder();
	private world: CollisionWorld;
	private audio: AudioContext | null = null;
	private fartClouds: { mesh: Points; life: number; vel: Float32Array }[] = [];
	private coinBursts: { mesh: Points; life: number; vel: Float32Array }[] = [];
	private bubbles: { mesh: Points; life: number; vel: Float32Array }[] = [];
	private onTransaction: ((count: number, pos: Vector3, storeId: string) => void) | null = null;
	/** seconds until next OpenRouter gossip attempt */
	private gossipCd = 4;
	private gossipBusy = false;
	/** Don't spam the player with roasts */
	private roastPlayerCd = 5;
	/** Player camera — only gossip / bubbles on this floor nearby */
	private listener: Vector3 | null = null;
	/** Max distance for visible speech bubbles */
	private static readonly SPEECH_RANGE = 16;
	/** Max distance for LLM gossip (same floor only) */
	private static readonly GOSSIP_RANGE = 12;
	/** Sims on a deck the player is not on tick once every N frames */
	private static readonly OFF_LEVEL_EVERY = 4;
	/** Row length of the neighbour grid key; the mall is nowhere near this many cells wide. */
	private static readonly GRID_STRIDE = 1024;
	private frame = 0;
	private readonly neighbourGrid = new Map<number, number[]>();
	private readonly constraints: VelocityConstraint[] = [];
	private readonly blockers: AABB[] = [];
	private readonly desired = new Vector3();

	/**
	 * @param seed Waar de menigte uit getrokken wordt. Vast, want een sim die er
	 * elke sessie anders uitziet en anders loopt is niet te reproduceren: een
	 * controle die hem betrapt kan hem dan niet terugvinden. Wie een andere
	 * menigte wil, vraagt om een ander zaad.
	 *
	 * Het zaad dekt alles wat een sim uit zichzelf doet. Wat de speler uitlokt
	 * (schrikken van een schot, juichen bij de dj, uitgescholden worden, een
	 * gesprek dat om hem heen begint) trekt uit `Math.random`, want dat hangt al
	 * af van waar hij loopt en wanneer, en is dus toch niet te herhalen. Stof,
	 * munten en toonhoogtes ook: die verplaatsen niemand.
	 */
	constructor(
		world: CollisionWorld,
		count = 20,
		private readonly seed = CROWD_SEED,
	) {
		this.world = world;
		this.group.name = 'mallSims';
		for (let i = 0; i < count; i++) {
			const sim = this.spawn(i);
			// snap start out of solid geometry
			this.settle(sim);
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
			if (!(sa && sb)) continue;
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
			sb.pos.copy(sa.pos).add(new Vector3(sa.radius + sb.radius + 0.2, 0, 0));
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

	setTransactionCallback(cb: (count: number, pos: Vector3, storeId: string) => void): void {
		this.onTransaction = cb;
	}

	/** Viewer controls guest unhappiness (RCT style) */
	nudgeAllMood(delta: number): void {
		for (const s of this.sims) {
			s.f.unhappiness = clamp(s.f.unhappiness + delta, 0, 100);
			this.paintLabel(s);
			this.applyFaceMood(s);
		}
	}

	dancing = false;

	/** One dashboard row per shopper — where they are and what they're up to. */
	getPeopleSnapshot(playerPos: Vector3, out: PersonRow[] = []): PersonRow[] {
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
				level: levelAt(s.pos.y),
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
	private beltProvider: ((x: number, y: number, z: number) => { x: number; z: number } | null) | null = null;

	setBeltProvider(fn: (x: number, y: number, z: number) => { x: number; z: number } | null): void {
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

	getSimsNear(worldPos: Vector3, radius: number): SimFactors[] {
		return this.sims.filter((s) => s.pos.distanceTo(worldPos) < radius).map((s) => s.f);
	}

	/** Fat Americans for UFO probe (prefer thicc / hangry) */
	getProbeCandidates(max = 6): { id: number; pos: Vector3 }[] {
		const ranked = [...this.sims]
			.filter((s) => !s.f.isKid)
			.sort((a, b) => b.f.thicc - a.f.thicc || b.f.unhappiness - a.f.unhappiness)
			.slice(0, max);
		// Cluster: pick around a random thicc seed
		if (!ranked.length) return [];
		const seed = pick(ranked.slice(0, 4));
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

	/**
	 * Mall cop open fire — panic nearby shoppers: scream, freeze, then flee path.
	 * @returns names of sims that flinched (for status line)
	 */
	panicFromGunfire(origin: Vector3, radius = 10): { id: number; name: string }[] {
		const hit: { id: number; name: string }[] = [];
		const screams = [
			'AAAAH!!',
			'ACTIVE SHOOTER— wait that IS security',
			"Don't shoot!!",
			"I'm just shopping!!",
			'Hands up… I mean bag up?',
			'Why is this a thing',
			'PRAIRIE LAKES NOOO',
		];
		for (const s of this.sims) {
			if (Math.abs(s.pos.y - origin.y) > 3) continue;
			const d = s.pos.distanceTo(origin);
			if (d > radius) continue;
			s.f.unhappiness = Math.min(100, s.f.unhappiness + 22 + Math.random() * 12);
			s.f.mood = 'lost';
			s.wait = Math.max(s.wait, 1.2 + Math.random());
			// Shove them away from the muzzle
			const away = s.pos.clone().sub(origin);
			away.y = 0;
			if (away.lengthSq() < 1e-4) away.set(jitter(1), 0, jitter(1));
			away.normalize().multiplyScalar(1.4 + Math.random());
			const nx = s.pos.x + away.x;
			const nz = s.pos.z + away.z;
			const fixed = this.world.resolveCircle(nx, nz, s.pos.y, 0.35);
			s.pos.x = fixed.x;
			s.pos.z = fixed.z;
			s.root.position.copy(s.pos);
			// Clear path so they re-route next tick
			s.path = [];
			s.pathI = 0;
			const line = pick(screams);
			const ctx = s.speechCtx;
			ctx.clearRect(0, 0, 280, 72);
			ctx.fillStyle = 'rgba(255,240,240,0.96)';
			ctx.fillRect(6, 6, 268, 60);
			ctx.strokeStyle = '#b91c1c';
			ctx.lineWidth = 3;
			ctx.strokeRect(6, 6, 268, 60);
			ctx.fillStyle = '#7f1d1d';
			ctx.font = '700 16px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(line, 140, 36);
			s.speechTex.needsUpdate = true;
			s.speech.visible = true;
			(s.speech.material as SpriteMaterial).visible = true;
			s.speechLife = 2.4 + Math.random();
			this.paintLabel(s);
			this.applyFaceMood(s);
			hit.push({ id: s.f.id, name: s.f.name });
		}
		return hit;
	}

	/** All sim positions (same floor-ish) for threat scanning */
	collectPositions(out: Vector3[]): void {
		out.length = 0;
		for (const s of this.sims) out.push(s.pos);
	}

	/** Alien lift — override root Y without breaking path pos permanently */
	nudgeSimHeight(id: number, worldY: number): void {
		const s = this.sims.find((x) => x.f.id === id);
		if (!s) return;
		s.root.position.y = worldY;
	}

	/** Crowd at DJ Bartek: speech bubbles + happier + short freeze-dance */
	cheerNear(worldPos: Vector3, radius: number): void {
		const cheers = ['BARTEK! BARTEK!', 'DROP IT!', 'Squeak banger!', 'Thicc & thriving', 'Trap-gat forever', 'Yallah dansen!'];
		for (const s of this.sims) {
			if (Math.abs(s.pos.y - worldPos.y) > 2.5) continue;
			if (s.pos.distanceTo(worldPos) > radius) continue;
			s.f.unhappiness = Math.max(0, s.f.unhappiness - 8);
			s.f.mood = Math.random() > 0.4 ? 'hyped' : s.f.mood;
			s.wait = Math.max(s.wait, 0.8 + Math.random());
			const line = pick(cheers);
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
			(s.speech.material as SpriteMaterial).visible = true;
			s.speechLife = 2.2 + Math.random();
			this.paintLabel(s);
			this.applyFaceMood(s);
		}
	}

	getNearestSimId(worldPos: Vector3): number | null {
		let best: Sim | null = null;
		let bestD = Number.POSITIVE_INFINITY;
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
	getSimEye(id: number): { pos: Vector3; yaw: number } | null {
		const s = this.sims.find((x) => x.f.id === id);
		if (!s) return null;
		// Midpoint of actual eye meshes in world space (respects body scale + bounce)
		const a = new Vector3();
		const b = new Vector3();
		s.eyeL.getWorldPosition(a);
		s.eyeR.getWorldPosition(b);
		const pos = a.add(b).multiplyScalar(0.5);
		// Slightly forward of the face so we don't clip the head mesh if un-hidden
		const yawFace = s.root.rotation.y;
		const forward = new Vector3(Math.sin(yawFace), 0, Math.cos(yawFace));
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

	update(dt: number, playerPos?: Vector3): void {
		if (playerPos) this.listener = playerPos;
		this.frame++;
		if (this.dancing) {
			for (const s of this.sims) {
				this.tickDance(s, dt);
				this.tickFace(s, dt);
				this.cullSpeechVisibility(s);
				if (s.plateDirty) this.paintLabel(s);
				s.lag = 0;
			}
		} else {
			const viewer = this.listener ? levelAt(this.listener.y) : null;
			this.steerCrowd(dt);
			for (const s of this.sims) {
				s.lag += dt;
				// Voor de throttle: een zichtbare plaat moet bijwerken, ook als deze
				// sim deze tick wordt overgeslagen.
				if (s.plateDirty) this.paintLabel(s);
				// Another deck: at best a silhouette across the atrium, so pay for it
				// every 4th frame. Staggered by id so one bucket lands per frame
				// instead of the whole crowd hitching together.
				const throttled =
					viewer !== null && levelAt(s.pos.y) !== viewer && (this.frame + s.f.id) % Americans.OFF_LEVEL_EVERY !== 0;
				if (!throttled) {
					// Full banked dt, never the frame's dt: routes must not run slow.
					const step = s.lag;
					s.lag = 0;
					this.tick(s, step);
					this.tickFace(s, step);
				}
				// Buiten de throttle: dit is de enige schrijver die de ballon weer
				// uitzet, dus hij moet ook draaien voor een sim die niet tikt.
				this.cullSpeechVisibility(s);
			}
			this.resolveAgents();
			this.tickGossip(dt);
		}
		this.tickFarts(dt);
		this.tickCoins(dt);
		this.tickBubbles(dt);
	}

	/** Dichtbij genoeg dat de speler de tekst zou kunnen lezen, puur afstand. */
	private isWithinRange(sim: Sim, range: number): boolean {
		const L = this.listener;
		if (!L) return false;
		const dx = sim.pos.x - L.x;
		const dz = sim.pos.z - L.z;
		return dx * dx + dz * dz <= range * range;
	}

	/**
	 * Same floor + close enough that the player could actually read the bubble.
	 * Het dek komt uit de registry, die het ook voor het tekenen beslist: praten
	 * mag exact zolang de ballon getekend zou worden.
	 */
	private isNearListener(sim: Sim, range = Americans.SPEECH_RANGE): boolean {
		const L = this.listener;
		if (!L) return false;
		return isOnViewerLevel(sim.levelAnchor, levelAt(L.y)) && this.isWithinRange(sim, range);
	}

	/**
	 * Wat er bovenop het dek komt: leeft de ballon nog, en staat de speler dicht
	 * genoeg bij om hem te lezen. Het dek zelf zit een niveau hoger, in
	 * levelAnchor, en is van cullByLevel. Dit is de enige plek die de ballon weer
	 * uitzet; sayLine, cheerNear en panicFromGunfire zetten hem alleen aan.
	 */
	private cullSpeechVisibility(sim: Sim): void {
		const ok = sim.speechLife > 0 && this.isWithinRange(sim, Americans.SPEECH_RANGE);
		sim.speech.visible = ok;
		(sim.speech.material as SpriteMaterial).visible = ok;
	}

	/**
	 * Occasionally yell at the player when they walk too close.
	 * Returns the line if someone roasted you (for HUD).
	 */
	maybeRoastPlayer(playerPos: Vector3, dt: number): string | null {
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
			: ['Oh sorry — of jij was het.', 'Even doorlopen, ja?', 'Yo, bijna botsing.', 'Chill in de gang, oké?'];
		const line = pick(lines);
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
			if (!a) continue;
			if (Math.abs(a.pos.y - L.y) > 2.2) continue;
			const adx = a.pos.x - L.x;
			const adz = a.pos.z - L.z;
			if (adx * adx + adz * adz > range2) continue;
			for (let j = i + 1; j < this.sims.length; j++) {
				const b = this.sims[j];
				if (!b) continue;
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
		const ctx =
			sa.f.partnerId === sb.f.id
				? 'koppel loopt hand in hand'
				: bestD < 1.8
					? 'bijna botsing in de gang'
					: 'passeren in de mall (dicht bij speler)';
		void fetchSimChat(persona(sa), persona(sb), ctx)
			.then((ex) => {
				// Re-check visibility — player may have left the floor mid-request
				if (this.isNearListener(sa, Americans.GOSSIP_RANGE + 4)) {
					this.sayLine(sa, ex.a, false);
				}
				globalThis.setTimeout(() => {
					if (this.isNearListener(sb, Americans.GOSSIP_RANGE + 4)) {
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
				sim.blinkT = 1.8 + sim.roll() * 3.5;
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
		const d = shortestAngle(sim.mouth.rotation.z, want);
		// `dt * 6 || 1` snaps on a zero-length frame, which easeFactor would read as no movement at all.
		sim.mouth.rotation.z += d * Math.min(1, dt * 6 || 1);

		if (sim.speechLife > 0) {
			sim.talkPhase += dt * 14;
			const open = 0.55 + Math.abs(Math.sin(sim.talkPhase)) * 1.5;
			sim.mouth.scale.set(baseX * 0.95, baseY * open, baseZ);
			// One soft chirp now and then — not a bubble machine
			sim.squeakT -= dt;
			if (sim.squeakT <= 0) {
				this.playSqueak(sim);
				sim.squeakT = 0.55 + sim.roll() * 0.7;
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
		sim.armL.rotation.x = DANCE_ARM_LIFT + Math.sin(sim.phase * 2) * DANCE_ARM_SWING;
		sim.armR.rotation.x = DANCE_ARM_LIFT + Math.cos(sim.phase * 2) * DANCE_ARM_SWING;
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
			if (!c) continue;
			c.life -= dt;
			const pos = c.mesh.geometry.getAttribute('position');
			const arr = pos.array as Float32Array;
			const vel = c.vel;
			for (let j = 0; j + 2 < arr.length; j += 3) {
				arr[j] = (arr[j] ?? 0) + (vel[j] ?? 0) * dt;
				arr[j + 1] = (arr[j + 1] ?? 0) + (vel[j + 1] ?? 0) * dt;
				arr[j + 2] = (arr[j + 2] ?? 0) + (vel[j + 2] ?? 0) * dt;
			}
			pos.needsUpdate = true;
			const mat = c.mesh.material as PointsMaterial;
			mat.opacity = Math.max(0, c.life * CLOUD_FADE);
			if (c.life <= 0) {
				this.group.remove(c.mesh);
				c.mesh.geometry.dispose();
				mat.dispose();
				this.bubbles.splice(i, 1);
			}
		}
	}

	/**
	 * De snelheid waar deze sim heen wil: recht op zijn eigen volgende punt af, en
	 * niets als hij staat te kijken of er geen punt meer is.
	 */
	private desiredVelocity(sim: Sim, out: Vector3): void {
		const target = sim.wait > 0 ? undefined : sim.path[sim.pathI];
		if (!target) {
			out.set(0, 0, 0);
			return;
		}
		const dx = target.x - sim.pos.x;
		const dz = target.z - sim.pos.z;
		const dist = Math.hypot(dx, dz);
		if (dist < 1e-4) {
			out.set(0, 0, 0);
			return;
		}
		const speed = this.walkSpeed(sim);
		out.set((dx / dist) * speed, 0, (dz / dist) * speed);
	}

	/** Mood decides the pace; it is asked twice per frame, so it lives in one place. */
	private walkSpeed(sim: Sim): number {
		const mood = sim.f.mood;
		const factor = mood === 'hyped' ? 1.3 : mood === 'hangry' ? 1.2 : mood === 'chill' ? 0.8 : 1;
		return sim.f.speed * factor;
	}

	/**
	 * Elke sim in zijn ruit, zodat een buurvraag over negen ruiten gaat en niet
	 * over de hele mall. Wie verder staat dan `SIM_NEIGHBOUR_REACH` kan hem binnen
	 * de horizon niet raken.
	 */
	private rebuildNeighbourGrid(): void {
		for (const bucket of this.neighbourGrid.values()) bucket.length = 0;
		for (let i = 0; i < this.sims.length; i++) {
			const sim = this.sims[i];
			if (!sim) continue;
			const key = this.cellKey(sim.pos.x, sim.pos.z);
			const bucket = this.neighbourGrid.get(key);
			if (bucket) bucket.push(i);
			else this.neighbourGrid.set(key, [i]);
		}
	}

	private cellKey(x: number, z: number): number {
		return Math.floor(x / SIM_NEIGHBOUR_REACH) + Math.floor(z / SIM_NEIGHBOUR_REACH) * Americans.GRID_STRIDE;
	}

	/**
	 * Wederkerige ontwijking voor de hele menigte, vóór iemand beweegt.
	 *
	 * Elk paar leidt hetzelfde snelheidsobstakel af en neemt er de helft van; een
	 * wand levert hetzelfde soort halfvlak maar dan onwederkerig, want die stapt
	 * niet opzij. Beide komen uit dezelfde oplosser, dus een sim die tussen een
	 * muur en een tegenligger loopt weegt die twee tegen elkaar af in plaats van
	 * eerst de een en na de stap de ander.
	 */
	private steerCrowd(dt: number): void {
		const step = Math.max(dt, SIM_MIN_STEP);
		this.rebuildNeighbourGrid();
		for (const sim of this.sims) {
			this.desiredVelocity(sim, this.desired);
			const body: OrcaBody = { x: sim.pos.x, z: sim.pos.z, vx: sim.velocity.x, vz: sim.velocity.z, radius: sim.radius };
			this.constraints.length = 0;
			this.collectNeighbourConstraints(sim, body, step);
			this.collectWallConstraints(sim, body, step);
			const solved = solveVelocity(this.desired.x, this.desired.z, this.walkSpeed(sim), this.constraints, SIM_SOLVER_ROUNDS);
			sim.steer.set(solved.vx, 0, solved.vz);
		}
	}

	private collectNeighbourConstraints(sim: Sim, body: OrcaBody, step: number): void {
		const cellX = Math.floor(sim.pos.x / SIM_NEIGHBOUR_REACH);
		const cellZ = Math.floor(sim.pos.z / SIM_NEIGHBOUR_REACH);
		for (let ox = -1; ox <= 1; ox++) {
			for (let oz = -1; oz <= 1; oz++) {
				const bucket = this.neighbourGrid.get(cellX + ox + (cellZ + oz) * Americans.GRID_STRIDE);
				if (!bucket) continue;
				for (const index of bucket) {
					const other = this.sims[index];
					if (!other || other === sim) continue;
					if (Math.abs(other.pos.y - sim.pos.y) > SIM_DECK_BAND) continue;
					if (Math.hypot(other.pos.x - sim.pos.x, other.pos.z - sim.pos.z) > SIM_NEIGHBOUR_REACH) continue;
					// Een stel loopt hand in hand: die twee gunnen elkaar geen extra ruimte.
					const couple = sim.f.partnerId === other.f.id;
					const margin = couple ? 0 : SIM_COMFORT_MARGIN;
					const neighbour: OrcaBody = {
						x: other.pos.x,
						z: other.pos.z,
						vx: other.velocity.x,
						vz: other.velocity.z,
						radius: other.radius + margin,
					};
					const constraint = agentConstraint(body, neighbour, SIM_AVOIDANCE_HORIZON, step, RECIPROCAL_SHARE);
					if (constraint) this.constraints.push(constraint);
				}
			}
		}
	}

	private collectWallConstraints(sim: Sim, body: OrcaBody, step: number): void {
		const reach = sim.radius + SIM_WALL_REACH;
		this.world.blockersNear(
			sim.pos.x - reach,
			sim.pos.x + reach,
			sim.pos.z - reach,
			sim.pos.z + reach,
			sim.pos.y,
			true,
			this.blockers,
		);
		for (const box of this.blockers) {
			this.constraints.push(staticConstraint(body, box, SIM_WALL_HORIZON, step));
		}
	}

	/** Physical overlap repair after everyone has moved: walls first, then bodies. */
	private resolveAgents(): void {
		// More passes = less clumping when a crowd packs a corridor
		for (let pass = 0; pass < 4; pass++) {
			for (const s of this.sims) this.settle(s);
			for (let i = 0; i < this.sims.length; i++) {
				for (let j = i + 1; j < this.sims.length; j++) {
					const a = this.sims[i];
					const b = this.sims[j];
					if (!(a && b)) continue;
					if (Math.abs(a.pos.y - b.pos.y) > SIM_DECK_BAND) continue;
					const minD = a.radius + b.radius;
					const sep = this.world.separate(a.pos.x, a.pos.z, b.pos.x, b.pos.z, minD);
					a.pos.x = sep.ax;
					a.pos.z = sep.az;
					b.pos.x = sep.bx;
					b.pos.z = sep.bz;
				}
			}
		}
		for (const s of this.sims) {
			this.settle(s);
			s.root.position.set(s.pos.x, s.pos.y, s.pos.z);
		}
	}

	/**
	 * Op de vloer en uit de muren. `climb` staat aan omdat een sim een voetganger
	 * is: de roltrap, de trap en de lift zijn zijn route en geen wand, en zonder
	 * dat recht stond hij anderhalve meter naast elke knoop die op zo'n doorgang
	 * ligt en kwam hij er nooit.
	 */
	private settle(sim: Sim): void {
		sim.pos.y = this.world.snapFloorY(sim.pos.x, sim.pos.z, sim.pos.y);
		const fixed = this.world.resolveCircle(sim.pos.x, sim.pos.z, sim.pos.y, sim.radius, 3, true);
		sim.pos.x = fixed.x;
		sim.pos.z = fixed.z;
	}

	private spawn(id: number): Sim {
		const rng = mulberry32(this.seed + id * 7919);
		const isBrad = id === 0;
		const isKid = !isBrad && id % 5 === 2;
		// A few Miss USA / pageant types (incl. Eva G.)
		const isMiss = !(isBrad || isKid) && (id === 1 || id === 3 || id === 7 || id === 11);
		const missIdx = Math.floor(id / 2) % MISS_NAMES.length;
		// Americans are HUNGRY — thicc by default (Miss stays slim)
		const thicc = isMiss ? 0.1 + rng() * 0.08 : isKid ? 0.22 + rng() * 0.15 : isBrad ? 0.95 : 0.55 + rng() * 0.42;
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

		const startShop = pickWith(SHOPABLE, rng);
		const meanings: LifeMeaning[] = ['love', 'family', 'health', 'joy', 'provide', 'belong', 'create'];
		const lifeMeaning: LifeMeaning = isBrad ? 'health' : isKid ? 'joy' : isMiss ? 'belong' : pickWith(meanings, rng);
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
			name: isBrad ? 'Brad Miller' : isMiss ? at(MISS_NAMES, missIdx) : `${pickWith(FIRST, rng)} ${pickWith(LAST, rng)}`,
			thicc,
			speed: isBrad ? 1.35 : isMiss ? 1.1 : 0.7 + rng() * 1.0,
			stride: isMiss ? STRIDE_MISS : STRIDE_BASE + rng() * STRIDE_SPREAD,
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
			unhappiness: isMiss ? Math.floor(8 + rng() * 30) : Math.floor(28 + rng() * 45 + (mood === 'hangry' ? 30 : 0) + thicc * 12),
			bag: isBrad ? 'KRUIDVAT' : isMiss ? 'Sash' : rng() > 0.45 ? 'bag' : null,
			shirt: isBrad ? 0xe30613 : isMiss ? at(MISS_OUTFITS, missIdx) : pickWith(SHIRTS, rng),
			pants: isMiss ? at(MISS_OUTFITS, missIdx) : pickWith(PANTS, rng),
			skin: isMiss ? 0xf5c9a8 : pickWith(SKIN, rng),
			hair: isMiss ? at([0xc4a35a, 0x2c1810, 0xd35400, 0x5c4033, 0x1a1a1a], missIdx) : pickWith(HAIR, rng),
			hasCap: false,
			isBrad,
			isKid,
			isMiss,
			fartCd: 3 + rng() * 12,
		};

		const root = new Group();
		const body = new Group();
		root.add(body);

		// Miss = taller, longer legs, hourglass, more glam ("hotter babes")
		const scale = isKid ? 0.62 : isMiss ? 1.08 : 0.95 + thicc * 0.18;
		const bellyR = isMiss ? 0.2 : isKid ? 0.22 : 0.34 + thicc * 0.36;
		const legLen = isMiss ? 0.82 : isKid ? 0.42 : 0.62;
		const torsoRadius = isMiss ? bellyR * 1.45 : bellyR * (1.2 + thicc * 0.1);
		const armRadius = bellyR * 1.05 + 0.09;
		const radius = Math.max(isKid ? 0.28 : 0.38, Math.max(torsoRadius, armRadius) * scale + 0.08);

		const legL = this.makeLeg(f.pants, legLen, -1);
		const legR = this.makeLeg(f.pants, legLen, 1);
		body.add(legL.group, legR.group);

		const torsoY = legLen + 0.08;
		const belly = new Mesh(new SphereGeometry(bellyR, 12, 10), this.mat(f.shirt, 0.9));
		if (isMiss) {
			// tight waist
			belly.scale.set(0.72, 1.0, 0.62);
			belly.position.set(0, torsoY + bellyR * BELLY_RISE_MISS, 0.02);
		} else {
			belly.scale.set(1.2 + thicc * 0.1, 0.9, 1.1);
			belly.position.set(0, torsoY + bellyR * BELLY_RISE, 0.08 + thicc * 0.05);
		}
		body.add(belly);

		const chest = new Mesh(new SphereGeometry(bellyR * (isMiss ? 1.15 : 0.7), 10, 8), this.mat(f.shirt, 0.9));
		// Miss: bigger chest, push forward
		chest.scale.set(isMiss ? 1.55 : 1.3, isMiss ? 1.05 : 0.65, isMiss ? 1.05 : 0.85);
		chest.position.set(0, torsoY + bellyR * (isMiss ? 1.35 : 1.0), isMiss ? 0.12 : 0);
		body.add(chest);

		// Miss: hip flare + heels
		if (isMiss) {
			const hips = new Mesh(new SphereGeometry(0.22, 10, 8), this.mat(f.pants, 0.85));
			hips.scale.set(1.45, 0.55, 0.85);
			hips.position.set(0, torsoY - 0.08, 0.02);
			body.add(hips);
			// stiletto nubs under feet (leg groups already have feet — add glamour shine)
			const heelMat = this.track(
				lit({
					color: 0x1a1a1a,
					metalness: 0.4,
					roughness: 0.35,
				}),
			);
			for (const side of [-1, 1] as const) {
				const heel = new Mesh(new ConeGeometry(0.04, 0.14, 6), heelMat);
				heel.position.set(side * 0.14, 0.02, 0.12);
				heel.rotation.x = Math.PI;
				body.add(heel);
			}
		}

		// Arms pivot AT THE SHOULDER. Rotating the bare mesh spun it around its
		// own middle, so the hand and the elbow swung in opposite directions.
		const armLen = 0.45;
		const armGeo = new CapsuleGeometry(0.09, armLen, 3, 5);
		const makeArm = (side: -1 | 1): Group => {
			const pivot = new Group();
			pivot.position.set(side * bellyR * 1.05, torsoY + bellyR * 1.15, 0);
			const limb = new Mesh(armGeo, this.mat(f.shirt));
			limb.position.y = -(half(armLen) + 0.09);
			pivot.add(limb);
			const hand = new Mesh(new SphereGeometry(0.075, 8, 6), this.mat(f.skin, 0.8));
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
		const head = new Mesh(new SphereGeometry(headR, 16, 16), this.mat(f.skin, 0.85));
		head.position.set(0, headY, 0);
		body.add(head);

		// ── Face ─────────────────────────────────────────────
		// Features sit ON the skull surface and point outward. The old version put
		// flat-Z spheres at 0.8·R, which buried the mouth completely inside the
		// head and left only a sliver of each eye poking out.
		const darkMat = this.track(new MeshBasicMaterial({ color: 0x141414 }));
		const scleraMat = this.track(new MeshBasicMaterial({ color: 0xf7f4f0 }));

		const eyeRad = isKid ? 0.055 : 0.062;
		// Pre-scaled geometry: mesh.scale stays free for blinking (tickFace)
		const scleraGeo = new SphereGeometry(eyeRad, 12, 10);
		scleraGeo.scale(1, 1.1, 0.45);
		const pupilGeo = new SphereGeometry(eyeRad * 0.52, 10, 8);
		pupilGeo.scale(1, 1, 0.6);

		const makeEye = (side: -1 | 1): Mesh => {
			const anchor = new Group();
			placeOnSkull(anchor, headR, side * 0.36, 0.1, 0.93);
			const sclera = new Mesh(scleraGeo, scleraMat);
			const pupil = new Mesh(pupilGeo, darkMat);
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
		const mouthAnchor = new Group();
		placeOnSkull(mouthAnchor, headR, 0, -0.42, 0.95);
		const mouthGeo = new TorusGeometry(headR * 0.3, headR * 0.055, 5, 14, Math.PI);
		const mouth = new Mesh(mouthGeo, darkMat);
		mouthAnchor.add(mouth);
		head.add(mouthAnchor);

		// Brows — cheap, and they carry most of the mood
		const browGeo = new BoxGeometry(headR * 0.34, headR * 0.06, headR * 0.05);
		for (const side of [-1, 1] as const) {
			const brow = new Group();
			placeOnSkull(brow, headR, side * 0.36, 0.34, 0.95);
			const bar = new Mesh(browGeo, darkMat);
			bar.rotation.z = side * -0.12;
			brow.add(bar);
			head.add(brow);
		}

		if (f.isMiss) {
			// Pageant hair volume — open at the front (phi gap) so the wig frames
			// the face instead of engulfing the eyes.
			const hair = new Mesh(
				new SphereGeometry(0.28, 14, 10, Math.PI * 0.22, Math.PI * 1.56, 0, Math.PI * 0.68),
				this.mat(f.hair),
			);
			hair.position.set(0, headY + 0.06, -0.02);
			body.add(hair);
			// Crown
			const crown = new Mesh(
				new TorusGeometry(0.14, 0.025, 6, 12),
				this.track(
					lit({
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
			const sash = new Mesh(new BoxGeometry(0.12, 0.9, 0.02), this.track(lit({ color: 0xffffff, roughness: 0.6 })));
			sash.position.set(0.18, torsoY + 0.5, 0.2);
			sash.rotation.z = -0.35;
			body.add(sash);
		} else if (f.hasCap) {
			const col = f.isBrad ? 0x00a651 : 0x1a5276;
			const cap = new Mesh(new SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(col));
			cap.position.set(0, headY + 0.05, 0);
			body.add(cap);
			const brim = new Mesh(new BoxGeometry(0.28, 0.04, 0.22), this.mat(col));
			brim.position.set(0, headY + 0.02, 0.2);
			body.add(brim);
		} else {
			// Same trick: leave the forehead clear of the hair shell
			const hair = new Mesh(new SphereGeometry(0.25, 12, 8, Math.PI * 0.2, Math.PI * 1.6, 0, Math.PI * 0.58), this.mat(f.hair));
			hair.position.set(0, headY + 0.04, 0);
			body.add(hair);
		}

		if (f.bag && !f.isMiss) {
			const bag = new Mesh(new BoxGeometry(0.28, 0.34, 0.12), this.mat(f.isBrad ? 0xe30613 : 0x333333));
			bag.position.set(bellyR * BAG_OUT, torsoY * BAG_RISE, 0.15);
			body.add(bag);
		}

		body.scale.setScalar(scale);

		// Head info plate (not floating store labels — per-sim status)
		const { canvas: plate, ctx: labelCtx } = labelCanvas(LABEL_W, LABEL_H);
		const labelTex = labelTexture(plate);
		const label = new Sprite(
			this.track(
				new SpriteMaterial({
					map: labelTex,
					transparent: true,
					depthTest: true,
					depthWrite: false,
				}),
			),
		);
		label.scale.set(2.6, 1.0, 1);
		label.position.set(0, headY * scale + 0.85, 0);
		// De plaat hangt twee tot drie meter boven de voeten, dus op de roltrap
		// zit hij al in de band van de volgende verdieping terwijl de sim nog
		// beneden loopt. De houder staat op dekhoogte en beslist over de deck.
		const levelAnchor = new Group();
		levelAnchor.add(label);
		root.add(levelAnchor);
		tagLevelCulled(levelAnchor);

		// Speech bubble for smart gibberish
		const { canvas: speechCanvas, ctx: speechCtx } = labelCanvas(280, 72);
		const speechTex = labelTexture(speechCanvas);
		// depthTest AAN: met false zag je vanaf het dak alle tekstballonnen van
		// twee verdiepingen lager dwars door het beton zweven
		const speech = new Sprite(
			this.track(
				new SpriteMaterial({
					map: speechTex,
					transparent: true,
					depthTest: true,
					depthWrite: false,
					visible: false,
				}),
			),
		);
		speech.scale.set(2.0, 0.55, 1);
		speech.position.set(0, headY * scale + 1.35, 0);
		speech.visible = false;
		// Zelfde houder als de plaat: die zit al op dekhoogte en is al getagd, en
		// het dek van deze sim is voor beide labels hetzelfde feit. `speech.visible`
		// blijft van de levensduur plus de leesafstand, dus geen dubbele eigenaar.
		levelAnchor.add(speech);

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
			levelAnchor,
			plateDirty: false,
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
			velocity: new Vector3(),
			radius,
			steer: new Vector3(),
			path: [],
			pathI: 0,
			routeLength: 0,
			routeBest: 0,
			sinceProgress: 0,
			skippedNodes: 0,
			replans: 0,
			// Eigen trekking, want een strook mag de trekkingen die deze sim zijn
			// uiterlijk geven niet verschuiven.
			laneOffset: plusMinusWith(half(LANE_SPREAD), mulberry32(LANE_SEED + id)),
			roll: mulberry32((this.seed ^ BEHAVIOUR_SEED) + id * 7919),
			wait: rng() * 1.5,
			phase: rng() * Math.PI * 2,
			shopId: startShop.id,
			labelCanvas: plate,
			labelCtx,
			labelTex,
			gibberCd: 2 + rng() * 8,
			bubbleCd: 1 + rng() * 4,
			squeakT: 0,
			coupleSide: 0,
			lag: 0,
		};

		this.assignNextShop(sim);
		this.paintLabel(sim);
		this.applyFaceMood(sim);
		return sim;
	}

	private mat(color: number, rough = 0.85): LitMaterial {
		return this.track(lit({ color, roughness: rough, metalness: 0.05 }));
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	/** Hip → knee → FOOT. Feet must swing hard when walking. */
	private makeLeg(pants: number, legLen: number, side: -1 | 1): Limb {
		const group = new Group();
		group.position.set(side * 0.16, 0, 0);

		const hip = new Group();
		hip.position.set(0, legLen, 0);

		const thigh = new Mesh(new CapsuleGeometry(0.11, legLen * LEG_THIGH_LEN, 3, 6), this.mat(pants));
		thigh.position.y = -legLen * LEG_THIGH_Y;
		hip.add(thigh);

		const knee = new Group();
		knee.position.y = -legLen * LEG_KNEE_Y;

		const shin = new Mesh(new CapsuleGeometry(0.09, legLen * LEG_SHIN_LEN, 3, 6), this.mat(pants));
		shin.position.y = -legLen * LEG_SHIN_Y;
		knee.add(shin);

		// BIG visible foot (pootje)
		const foot = new Mesh(new BoxGeometry(0.16, 0.09, 0.34), this.mat(0xf5f5f5, 0.65));
		foot.position.set(0, -legLen * LEG_FOOT_Y, 0.1);
		knee.add(foot);

		const sole = new Mesh(new BoxGeometry(0.17, 0.04, 0.36), this.mat(0x1a1a1a));
		sole.position.set(0, -legLen * LEG_SOLE_Y, 0.1);
		knee.add(sole);

		hip.add(knee);
		group.add(hip);
		return { group, hip, knee, foot };
	}

	private assignNextShop(sim: Sim): void {
		// Partner follows lead (lower id is lead)
		if (sim.f.partnerId !== null && sim.f.id > sim.f.partnerId) {
			const lead = this.sims.find((s) => s.f.id === sim.f.partnerId);
			if (lead?.f.targetShopId) {
				sim.f.targetShop = lead.f.targetShop;
				sim.f.targetShopId = lead.f.targetShopId;
				sim.path = lead.path.map((p) => p.clone());
				sim.pathI = Math.min(lead.pathI, Math.max(0, lead.path.length - 1));
				sim.shopId = lead.shopId;
				this.measureRoute(sim);
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
		sim.replans = 0;
		sim.skippedNodes = 0;
		this.planRoute(sim, next);
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
				this.measureRoute(partner);
				this.paintLabel(partner);
			}
		}
	}

	/**
	 * Een pad naar `store` vanaf waar de sim nu staat.
	 *
	 * Vanaf zijn eigen plek en niet vanaf de winkel waar hij vandaan kwam, want
	 * opnieuw plannen gebeurt juist als hij ergens halverwege vastzit. Elk punt
	 * gaat door `walkablePoint`: de graaf noemt plekken die de meubels sinds hun
	 * plaatsing bezet houden — `f0_sw` ligt in de aperolbar, `f0_c` drie meter in
	 * de plantenbak — en op zo'n punt gaan staan lukt niet, hoe lang je het ook
	 * probeert.
	 */
	private planRoute(sim: Sim, store: StoreDef): void {
		const here = this.startNode(sim);
		const toNode = store.nodeId === 'spaceship' ? 's_kruidvat' : store.nodeId;
		const nodes = here ? this.pathfinder.findPath(here.id, toNode) : [];
		const points: Vector3[] = [];
		for (const node of nodes) {
			const y = levelY(levelAt(node.y));
			// De vide op V1 is een gat, geen route: een knoop erboven schuift naar de rand.
			const overVoid = levelAt(y) === 'v1' && Math.abs(node.x) < 8 && Math.abs(node.z) < 6;
			const x = overVoid ? (node.x >= 0 ? 10 : -10) : node.x;
			points.push(new Vector3(x, overVoid ? 6 : y, node.z));
		}
		points.push(shopEntrance(store));
		sim.path = this.routeAround(sim, this.laneRoute(sim, points));
		sim.pathI = 0;
		this.measureRoute(sim);
	}

	/**
	 * De knoop waar deze gast zijn route op begint: de dichtste waar hij in een
	 * rechte lijn bij kan.
	 *
	 * De allerdichtste ligt soms achter het meubel waar hij tegenaan staat — bij de
	 * kiosk is dat de knoop die er middenin staat — en een route die daar begint
	 * begint met het stuk dat hem vasthield. Kan hij er geen enkele bereiken, dan
	 * is de dichtste alsnog het antwoord: dan lost `unstickRoute` het verderop op.
	 */
	private startNode(sim: Sim): { id: NodeId } | null {
		const candidates = this.pathfinder.nodesNear(sim.pos.x, sim.pos.y, sim.pos.z, START_NODE_CANDIDATES);
		for (const node of candidates) {
			const y = levelY(levelAt(node.y));
			if (!this.world.blockedBy(sim.pos.x, sim.pos.z, node.x, node.z, y, sim.radius, true)) return node;
		}
		return candidates[0] ?? null;
	}

	/**
	 * Hetzelfde pad, maar om de meubels heen die dwars op een stuk ervan staan.
	 *
	 * Een looproute belooft dat je van punt naar punt rechtdoor kunt en de graaf
	 * hield zich daar bij het tekenen aan, maar de fontein, de kiosk, de aperolbar
	 * en een parkeerpilaar staan sindsdien op veertien van die lijnen. Frontaal op
	 * een wand aflopen is precies wat geen enkele sturing oplost: het halfvlak van
	 * die wand laat alleen langsgaan toe en de gewenste richting wijst er recht
	 * in, dus de sim remt af tot nul en blijft staan. Hier komt de hoek in het pad
	 * te liggen waar hij anders zelf omheen had moeten raden.
	 */
	private routeAround(sim: Sim, points: readonly Vector3[]): Vector3[] {
		const out: Vector3[] = [];
		let fromX = sim.pos.x;
		let fromZ = sim.pos.z;
		for (const point of points) {
			for (let guard = 0; guard < MAX_DETOURS; guard++) {
				const box = this.world.blockedBy(fromX, fromZ, point.x, point.z, point.y, sim.radius, true);
				if (!box) break;
				const detour = this.cornerDetour(sim, fromX, fromZ, point, box);
				if (detour.length === 0) break;
				for (const corner of detour) {
					out.push(corner);
					fromX = corner.x;
					fromZ = corner.z;
				}
			}
			out.push(point);
			fromX = point.x;
			fromZ = point.z;
		}
		return out;
	}

	/**
	 * De goedkoopste kant om deze doos heen, als punten waar de sim ook echt kan
	 * staan. Eén hoek als dat genoeg is, twee als de doos tussen beide einden in
	 * ligt, en niets als geen van de vier kanten begaanbaar is: dan is het gat
	 * werkelijk dicht en moet de route zelf anders.
	 */
	private cornerDetour(sim: Sim, fromX: number, fromZ: number, to: Vector3, box: AABB): Vector3[] {
		const margin = sim.radius + DETOUR_MARGIN;
		const minX = box.minX - margin;
		const maxX = box.maxX + margin;
		const minZ = box.minZ - margin;
		const maxZ = box.maxZ + margin;
		const sides: readonly { ax: number; az: number; bx: number; bz: number }[] = [
			{ ax: minX, az: minZ, bx: minX, bz: maxZ },
			{ ax: maxX, az: minZ, bx: maxX, bz: maxZ },
			{ ax: minX, az: minZ, bx: maxX, bz: minZ },
			{ ax: minX, az: maxZ, bx: maxX, bz: maxZ },
		];
		let best: Vector3[] = [];
		let bestCost = Number.POSITIVE_INFINITY;
		for (const side of sides) {
			const first = this.standablePoint(side.ax, side.az, to.y, sim.radius);
			const second = this.standablePoint(side.bx, side.bz, to.y, sim.radius);
			if (!(first && second)) continue;
			const nearFirst = Math.hypot(first.x - fromX, first.z - fromZ) <= Math.hypot(second.x - fromX, second.z - fromZ);
			const entry = nearFirst ? first : second;
			const exit = nearFirst ? second : first;
			const cost =
				Math.hypot(entry.x - fromX, entry.z - fromZ) +
				Math.hypot(exit.x - entry.x, exit.z - entry.z) +
				Math.hypot(to.x - exit.x, to.z - exit.z);
			if (cost >= bestCost) continue;
			bestCost = cost;
			// Eén hoek is genoeg zodra hij de doos al vrijgeeft; de tweede is er voor
			// het geval de doos tussen beide einden in ligt.
			if (!this.world.blockedBy(fromX, fromZ, exit.x, exit.z, to.y, sim.radius, true)) best = [exit];
			else if (this.world.blockedBy(entry.x, entry.z, to.x, to.z, to.y, sim.radius, true)) best = [entry, exit];
			else best = [entry];
		}
		return best;
	}

	/** Het punt zelf als je er kunt staan, en anders niets: een hoek in een muur is geen hoek om langs te lopen. */
	private standablePoint(x: number, z: number, y: number, radius: number): Vector3 | null {
		const fixed = this.world.resolveCircle(x, z, y, radius, 3, true);
		if (Math.hypot(fixed.x - x, fixed.z - z) > radius) return null;
		return new Vector3(fixed.x, y, fixed.z);
	}

	/**
	 * Hetzelfde pad, maar in de eigen strook van deze gast en op plekken waar hij
	 * ook echt kan staan.
	 *
	 * Zonder de strook lopen twee sims met dezelfde bestemming exact dezelfde lijn
	 * en staan ze de hele route achter elkaar aan te duwen. De verschuiving staat
	 * loodrecht op het stuk waar hij vandaan komt en komt uit zijn id, dus hij is
	 * elke sessie dezelfde.
	 */
	private laneRoute(sim: Sim, points: readonly Vector3[]): Vector3[] {
		const out: Vector3[] = [];
		let fromX = sim.pos.x;
		let fromZ = sim.pos.z;
		for (const point of points) {
			const dx = point.x - fromX;
			const dz = point.z - fromZ;
			const run = Math.hypot(dx, dz);
			const wantX = run > 1e-4 ? point.x + (-dz / run) * sim.laneOffset : point.x;
			const wantZ = run > 1e-4 ? point.z + (dx / run) * sim.laneOffset : point.z;
			const fixed = this.world.resolveCircle(wantX, wantZ, point.y, sim.radius, 3, true);
			out.push(new Vector3(fixed.x, point.y, fixed.z));
			fromX = point.x;
			fromZ = point.z;
		}
		return out;
	}

	/** Hoeveel meter er van hier af nog te lopen is over het pad dat er ligt. */
	private remainingRoute(sim: Sim): number {
		let total = 0;
		let fromX = sim.pos.x;
		let fromZ = sim.pos.z;
		for (let i = sim.pathI; i < sim.path.length; i++) {
			const point = sim.path[i];
			if (!point) continue;
			total += Math.hypot(point.x - fromX, point.z - fromZ);
			fromX = point.x;
			fromZ = point.z;
		}
		return total;
	}

	/** De meetlat waar de voortgang van deze route tegenaan gehouden wordt. */
	private measureRoute(sim: Sim): void {
		sim.routeLength = this.remainingRoute(sim);
		sim.routeBest = 0;
		sim.sinceProgress = 0;
	}

	/**
	 * Wat er gebeurt als een gast al `STUCK_SECONDS` geen stap dichter bij zijn
	 * winkel is gekomen.
	 *
	 * Vlak bij het punt is de geometrie op: daar is dit zo dichtbij als het wordt,
	 * dus het punt gaat eraf. Ergens anders is het pad zelf het probleem en wordt
	 * er een nieuw pad gezocht vanaf waar hij nu staat. Blijft ook dat hangen, dan
	 * ligt het aan de bestemming en kiest hij een andere winkel. `pathI++` als
	 * enige antwoord zette hem dwars door de doos die hem tegenhield naar het
	 * volgende punt, en daar stond hij dan opnieuw vast.
	 */
	private unstickRoute(sim: Sim): void {
		sim.sinceProgress = 0;
		const target = sim.path[sim.pathI];
		const near = target !== undefined && Math.hypot(target.x - sim.pos.x, target.z - sim.pos.z) <= WAYPOINT_GIVE_UP;
		if (near && sim.skippedNodes < MAX_SKIPS) {
			sim.pathI++;
			sim.skippedNodes++;
			this.measureRoute(sim);
			return;
		}
		const store = STORES.find((s) => s.id === sim.f.targetShopId);
		if (store && sim.replans < MAX_REPLANS) {
			sim.replans++;
			this.planRoute(sim, store);
			return;
		}
		this.assignNextShop(sim);
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
		if (sim.f.mood === 'hangry' && sim.roll() < 0.72) {
			return SHOPABLE.find((s) => s.id === 'foodcourt') ?? pickWith(SHOPABLE, sim.roll);
		}
		if (sim.f.isBrad && sim.roll() < 0.55) {
			return SHOPABLE.find((s) => s.id === 'kruidvat') ?? pickWith(SHOPABLE, sim.roll);
		}
		// Extra thicc people also drift toward grease
		if (sim.f.thicc > 0.7 && sim.roll() < 0.35) {
			return SHOPABLE.find((s) => s.id === 'foodcourt') ?? pickWith(SHOPABLE, sim.roll);
		}
		const list = prefer[m];
		if (sim.roll() < 0.72) {
			const id = pickWith(list, sim.roll);
			return SHOPABLE.find((s) => s.id === id) ?? pickWith(SHOPABLE, sim.roll);
		}
		return pickWith(SHOPABLE, sim.roll);
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
		if (!f.isMiss && sim.roll() < dt * 0.08) {
			f.unhappiness = Math.min(100, f.unhappiness + 0.4 + f.thicc * 0.3);
			if (f.unhappiness > 60 && f.mood !== 'hangry' && sim.roll() < 0.15) {
				f.mood = 'hangry';
				f.lifeLine = 'Mag ik al eten? Nu. Nu. NU.';
			}
		}

		// Fart timer
		f.fartCd -= dt;
		if (f.fartCd <= 0) {
			this.doFart(sim);
			f.fartCd = 8 + sim.roll() * 22;
			f.unhappiness = Math.min(100, f.unhappiness + 2);
		}

		// Gibberish chatter — only near the player (no bubbles on other floors)
		sim.gibberCd -= dt;
		if (sim.speechLife > 0) {
			// Alleen de klok: cullSpeechVisibility draait direct na deze tick en
			// leest speechLife opnieuw, dus de vlaggen hier ook zetten zou hetzelfde
			// antwoord een tweede keer opschrijven.
			sim.speechLife -= dt;
		} else if (sim.gibberCd <= 0) {
			sim.gibberCd = 6 + sim.roll() * 16;
			if (this.isNearListener(sim, Americans.SPEECH_RANGE)) {
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

		// Retire every waypoint already reached, in one call. A throttled sim carries
		// several frames of travel per tick, and spending that whole slice on a
		// waypoint hand-off would let it fall behind the sims ticking every frame.
		while (sim.pathI < sim.path.length) {
			const wp = sim.path[sim.pathI];
			if (!wp) break;
			const wx = wp.x - sim.pos.x;
			const wz = wp.z - sim.pos.z;
			if (wx * wx + wz * wz >= 0.16) break;
			sim.pathI++;
			// snap Y when changing floors via escalator/stairs nodes
			const nextNode = sim.path[sim.pathI];
			if (nextNode) sim.pos.y = nextNode.y;
		}

		if (sim.pathI >= sim.path.length) {
			// Arrived at OPEN shop — spend money + coin particles + happier (verkoper!)
			const spend = 8 + Math.floor(sim.roll() * 55);
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
				f.unhappiness = Math.max(0, f.unhappiness + Math.floor(sim.roll() * 8) - 6);
			}

			this.spawnCoins(sim.pos.clone().add(new Vector3(0, 1.2, 0)), spend);
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
		if (!target) {
			sim.path = [];
			sim.pathI = 0;
			return;
		}
		const to = target.clone().sub(sim.pos);
		to.y = 0;
		const dist = to.length();

		// ── THE VECTOR ──────────────────────────────────────
		// Wat ORCA deze frame heeft vrijgegeven: de richting naar het volgende punt
		// met de tegenliggers en de wanden er al uit gerekend.
		const dir = to.normalize();
		sim.velocity.copy(sim.steer);
		const pace = Math.hypot(sim.velocity.x, sim.velocity.z);
		const prevX = sim.pos.x;
		const prevZ = sim.pos.z;
		// Never step past the waypoint. An off-level sim spends up to four frames
		// of dt in one call, and at the 0.05 s dt ceiling that is further than the
		// 0.4 m retire radius: it would stride over the node, turn, stride back.
		const travelTime = pace > 1e-4 ? Math.min(dt, dist / pace) : dt;
		sim.pos.x += sim.velocity.x * travelTime;
		sim.pos.z += sim.velocity.z * travelTime;
		// Climb only on escalator/stairs; otherwise hard floor snap
		if (Math.abs(target.y - sim.pos.y) > 0.5) {
			sim.pos.y = ease(sim.pos.y, target.y, 2.5, dt);
		}

		// Floor snap — feet stay on slab (no through-floor / floating)
		sim.pos.y = this.world.snapFloorY(sim.pos.x, sim.pos.z, sim.pos.y);

		const hit = this.world.resolveCircle(sim.pos.x, sim.pos.z, sim.pos.y, sim.radius, 3, true);
		sim.pos.x = hit.x;
		sim.pos.z = hit.z;
		sim.pos.y = this.world.snapFloorY(sim.pos.x, sim.pos.z, sim.pos.y);

		// Voortgang over de hele route, niet over deze ene frame. Wie tegen een doos
		// aan schuurt gaat de ene frame een millimeter vooruit en de andere weer
		// achteruit, en een klok die daarop reset telt nooit tot vastgelopen: zo
		// liep een sim in vier minuten twee meter zonder dat iets ingreep.
		const travelled = sim.routeLength - this.remainingRoute(sim);
		if (travelled > sim.routeBest + PROGRESS_STRIDE) {
			sim.routeBest = travelled;
			sim.sinceProgress = 0;
		} else {
			sim.sinceProgress += dt;
			if (sim.sinceProgress > STUCK_SECONDS) this.unstickRoute(sim);
		}

		// Kids: rare quiet soap pop (was a constant bubble storm — no more)
		if (f.isKid) {
			sim.bubbleCd -= dt;
			if (sim.bubbleCd <= 0) {
				if (sim.roll() < 0.25) {
					this.spawnBubbles(sim.pos.clone().add(new Vector3(0, 0.9, 0)));
				}
				sim.bubbleCd = 6 + sim.roll() * 10;
			}
		}

		// Couple walks side-by-side (meaning: love / family — not alone)
		if (f.partnerId !== null && sim.coupleSide !== 0) {
			const partner = this.sims.find((s) => s.f.id === f.partnerId);
			if (partner) {
				const spacing = sim.radius + partner.radius + 0.2;
				const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar(sim.coupleSide * spacing);
				// Soft pull toward parallel lane next to partner lead path
				if (f.id > f.partnerId) {
					// Per seconde en niet per frame: als factor stond hier 0.12 per frame,
					// en op de 0.05 s die het spel als stap aftopt trok dat drie keer zo
					// hard als op 60 Hz. Het kind werd dan langs zijn eigen winkel
					// gesleept en geen van beiden rekende ooit af.
					const ideal = partner.pos.clone().add(side);
					sim.pos.x = ease(sim.pos.x, ideal.x, COUPLE_PULL, dt);
					sim.pos.z = ease(sim.pos.z, ideal.z, COUPLE_PULL, dt);
					const fix = this.world.resolveCircle(sim.pos.x, sim.pos.z, sim.pos.y, sim.radius, 3, true);
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
			const dy = shortestAngle(sim.root.rotation.y, face);
			sim.root.rotation.y += dy * easeFactor(8, dt);
		}
		// De werkelijke verplaatsing is de snelheid waarmee de buren volgende frame
		// rekenen. Wie tegen een muur staat en niets aflegt heeft snelheid nul, en
		// niet de snelheid die hij wilde hebben.
		if (dt > 1e-4) sim.velocity.set(mx / dt, 0, mz / dt);

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
			sim.legL.hip.rotation.x = lerp(sim.legL.hip.rotation.x, 0.08, dt * 6);
			sim.legR.hip.rotation.x = lerp(sim.legR.hip.rotation.x, -0.08, dt * 6);
			sim.legL.knee.rotation.x = lerp(sim.legL.knee.rotation.x, 0.1, dt * 6);
			sim.legR.knee.rotation.x = lerp(sim.legR.knee.rotation.x, 0.1, dt * 6);
			sim.legL.foot.rotation.x = lerp(sim.legL.foot.rotation.x, 0, dt * 6);
			sim.legR.foot.rotation.x = lerp(sim.legR.foot.rotation.x, 0, dt * 6);
			sim.armL.rotation.x = lerp(sim.armL.rotation.x, 0, dt * 5);
			sim.armR.rotation.x = lerp(sim.armR.rotation.x, 0, dt * 5);
			sim.body.position.y = Math.sin(sim.phase * IDLE_BOB_TEMPO) * IDLE_BOB_AMP;
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
		const toe = (l: number) => (l < 0 ? l * TOE_HEEL : l * TOE_OFF * (TOE_STOMP_BASE + TOE_STOMP_SPREAD * f.stomp));
		sim.legL.foot.rotation.x = toe(L);
		sim.legR.foot.rotation.x = toe(R);

		// Arms opposite the same-side leg
		sim.armL.rotation.x = -L * 0.7;
		sim.armR.rotation.x = -R * 0.7;

		// Body rises over each planted leg — twice per cycle
		sim.body.position.y = Math.abs(Math.sin(sim.phase)) * 0.035 * f.stomp;
	}

	private paintLabel(sim: Sim): void {
		// Weggeculld: anders vult de hele crowd elke tick een canvas van 320x120
		// voor een plaat die niemand ziet. De vlag haalt het in op het eerste
		// frame dat hij terug op de deck van de speler staat.
		if (!sim.levelAnchor.visible) {
			sim.plateDirty = true;
			return;
		}
		const f = sim.f;
		const ctx = sim.labelCtx;
		const w = LABEL_W;
		const h = LABEL_H;
		ctx.clearRect(0, 0, w, h);

		// soft plate
		ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
		roundRect(ctx, { x: 4, y: 4, width: w - 8, height: h - 8, radius: 12 });
		ctx.fill();
		ctx.strokeStyle = f.unhappiness > 70 ? '#ef4444' : f.unhappiness > 40 ? '#f59e0b' : '#22c55e';
		ctx.lineWidth = 3;
		roundRect(ctx, { x: 4, y: 4, width: w - 8, height: h - 8, radius: 12 });
		ctx.stroke();

		ctx.fillStyle = '#fff';
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'left';
		const name = f.partnerName === null ? f.name.slice(0, 16) : `${f.name.slice(0, 10)} ❤️`;
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
		sim.plateDirty = false;
	}

	/** Player tips nearest sim — muntjes + happiness */
	giveMoneyNear(worldPos: Vector3, amount = 25): SimFactors | null {
		let best: Sim | null = null;
		let bestD = Number.POSITIVE_INFINITY;
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
		this.spawnCoins(best.pos.clone().add(new Vector3(0, 1.3, 0)), amount);
		this.sayGibberish(best, true);
		this.paintLabel(best);
		this.applyFaceMood(best);
		return best.f;
	}

	private spawnBubbles(origin: Vector3): void {
		const count = 14;
		const positions = new Float32Array(count * 3);
		const vel = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = origin.x + jitter(0.3);
			positions[i * 3 + 1] = origin.y;
			positions[i * 3 + 2] = origin.z + jitter(0.3);
			vel[i * 3] = jitter(0.4);
			vel[i * 3 + 1] = 0.6 + Math.random() * 1.2;
			vel[i * 3 + 2] = jitter(0.4);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(positions, 3));
		const mat = new PointsMaterial({
			color: 0xa8e6ff,
			size: 0.12,
			transparent: true,
			opacity: 0.7,
			depthWrite: false,
		});
		const mesh = new Points(geo, mat);
		this.group.add(mesh);
		this.bubbles.push({ mesh, life: 1.5, vel });
	}

	/** Speech bubble with real words (gossip / checkout) — skipped if not visible to player */
	private sayLine(sim: Sim, line: string, checkout = false): void {
		// Never paint / show / squeak for sims the player can't see
		if (!this.isNearListener(sim, Americans.SPEECH_RANGE + (checkout ? 6 : 0))) {
			return;
		}
		const ctx = sim.speechCtx;
		ctx.clearRect(0, 0, 280, 72);
		ctx.fillStyle = 'rgba(255,255,255,0.96)';
		roundRect(ctx, { x: 4, y: 4, width: 272, height: 64, radius: 14 });
		ctx.fill();
		ctx.strokeStyle = checkout ? '#16a34a' : '#7c3aed';
		ctx.lineWidth = 2.5;
		roundRect(ctx, { x: 4, y: 4, width: 272, height: 64, radius: 14 });
		ctx.stroke();
		ctx.fillStyle = '#0f172a';
		ctx.font = '600 14px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		fitText(ctx, line, { x: 12, y: 6, w: 256, h: 54 }, { size: 18 });
		sim.speechTex.needsUpdate = true;
		sim.speech.visible = true;
		(sim.speech.material as SpriteMaterial).visible = true;
		sim.speechLife = 3.2 + sim.roll() * 1.4;
		sim.squeakT = 0.5;
		this.playSqueak(sim, 0);
	}

	private sayGibberish(sim: Sim, checkout = false): void {
		let line: string;
		if (checkout) {
			const owner = getOwner(sim.f.targetShopId || sim.shopId);
			if (owner && owner.lines.length > 0 && sim.roll() < 0.85) {
				line = `${owner.name.split(' ')[0]}: ${pickWith(owner.lines, sim.roll)}`;
			} else if (sim.f.partnerName) {
				line = pickWith(
					[`Voor ${sim.f.partnerName.split(' ')[0] ?? sim.f.partnerName} ❤️`, 'Wij samen, yallah!', 'Pecunia accepta, amore!'],
					sim.roll,
				);
			} else {
				line = pickWith(['Pecunia accepta!', 'Dankjewel, next!', 'Kassa done ✓'], sim.roll);
			}
		} else if (sim.f.partnerName && sim.roll() < 0.35) {
			const p = sim.f.partnerName.split(' ')[0] ?? sim.f.partnerName;
			line = pickWith([`${p}… even wachten ❤️`, 'Handje? Handje.', `Voor ons, ${p}.`, sim.f.lifeLine.slice(0, 26)], sim.roll);
		} else {
			line = pickWith(GIBBER, sim.roll);
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

	private spawnCoins(origin: Vector3, amount: number): void {
		const count = Math.min(40, 8 + Math.floor(amount / 3));
		const positions = new Float32Array(count * 3);
		const vel = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			positions[i * 3] = origin.x;
			positions[i * 3 + 1] = origin.y;
			positions[i * 3 + 2] = origin.z;
			vel[i * 3] = jitter(3);
			vel[i * 3 + 1] = 2 + Math.random() * 4;
			vel[i * 3 + 2] = jitter(3);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(positions, 3));
		const mat = new PointsMaterial({
			color: 0xffd700,
			size: 0.16,
			transparent: true,
			opacity: 0.95,
			depthWrite: false,
		});
		const mesh = new Points(geo, mat);
		this.group.add(mesh);
		this.coinBursts.push({ mesh, life: 1.6, vel });
		this.playCoinSound();
	}

	private tickCoins(dt: number): void {
		for (let i = this.coinBursts.length - 1; i >= 0; i--) {
			const c = this.coinBursts[i];
			if (!c) continue;
			c.life -= dt;
			const pos = c.mesh.geometry.getAttribute('position');
			const arr = pos.array as Float32Array;
			const vel = c.vel;
			for (let j = 0; j + 2 < arr.length; j += 3) {
				arr[j] = (arr[j] ?? 0) + (vel[j] ?? 0) * dt;
				arr[j + 1] = (arr[j + 1] ?? 0) + (vel[j + 1] ?? 0) * dt;
				arr[j + 2] = (arr[j + 2] ?? 0) + (vel[j + 2] ?? 0) * dt;
				vel[j + 1] = (vel[j + 1] ?? 0) - 9 * dt;
			}
			pos.needsUpdate = true;
			const mat = c.mesh.material as PointsMaterial;
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
			vel[i * 3] = jitter(0.8);
			vel[i * 3 + 1] = 0.3 + Math.random() * 0.6;
			vel[i * 3 + 2] = jitter(0.8);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(positions, 3));
		const mat = new PointsMaterial({
			color: 0x88ff44,
			size: 0.18,
			transparent: true,
			opacity: 0.65,
			depthWrite: false,
		});
		const mesh = new Points(geo, mat);
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
			if (!c) continue;
			c.life -= dt;
			const pos = c.mesh.geometry.getAttribute('position');
			const arr = pos.array as Float32Array;
			const vel = c.vel;
			for (let j = 0; j + 2 < arr.length; j += 3) {
				arr[j] = (arr[j] ?? 0) + (vel[j] ?? 0) * dt;
				arr[j + 1] = (arr[j + 1] ?? 0) + (vel[j + 1] ?? 0) * dt;
				arr[j + 2] = (arr[j + 2] ?? 0) + (vel[j + 2] ?? 0) * dt;
				vel[j + 1] = (vel[j + 1] ?? 0) - 0.4 * dt;
			}
			pos.needsUpdate = true;
			const mat = c.mesh.material as PointsMaterial;
			mat.opacity = Math.max(0, c.life * CLOUD_FADE);
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
