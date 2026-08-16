import type { Material, Object3D } from 'three';
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CapsuleGeometry,
	ConeGeometry,
	CylinderGeometry,
	Group,
	LatheGeometry,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	Points,
	PointsMaterial,
	SphereGeometry,
	SpotLight,
	TorusGeometry,
	Vector2,
	Vector3,
} from 'three';
import { CATWALK_DECK, CATWALK_SPEC, catwalkSeatRows } from '#/data/world';
import { lit } from '#/render/material';
import { labelCanvas, labelTexture } from '#/util/label';
import { half } from '#/util/math';
import { at, jitter } from '#/util/rand';

/**
 * Prairie Lakes Fashion Week: a runway in the south-east corner of the ground floor.
 *
 * It stands east of x 31, past the last wayfinding node, so the shopper crowd never
 * tries to path through the show. Every coordinate here comes from `CATWALK_SPEC`,
 * which is where it moved from the west wall when the main entrance took that bay.
 */
const { runwayX: RUNWAY_X, startZ: START_Z, tipZ: TIP_Z, podiumY: PODIUM_Y, halfWidth: HALF_W } = CATWALK_SPEC;
const DECK_LENGTH = CATWALK_DECK.length;
const DECK_CENTER_Z = CATWALK_DECK.centerZ;

const WALK_SPEED = 1.15;
const POSE_TIME = 2.6;

/** The spot never sits still: it drifts across the runway at this rate, this far. */
const SPOT_SWEEP_TEMPO = 0.6;
const SPOT_SWEEP = 0.5;

/**
 * The lighting rig over the runway: two posts, a beam, five lamps and the spot,
 * all on one line. The spot used to hang at 7.4, above the V1 floor plane, and
 * with no shadow map its cone painted a bright pool on the deck upstairs.
 */
const RIG_Z = TIP_Z - 3;
const RIG_BEAM_Y = 4.5;
const RIG_LAMP_Y = 4.34;
const LED_WIDTH = 0.08;
const LED_HEIGHT = 0.06;
const LED_INSET = 0.02;
/** The kerb strip stands this far proud of the deck; flush, its top shared the deck plane and z-fought into grey stripes from above. */
const LED_RISE = 0.02;
/** Shoulders counter the hips, arms counter the legs, both at half the throw. */
const BODY_SWAY_SHARE = 0.5;
const ARM_SWING_SHARE = 0.5;
/** Arms hang this far outside the hips so the sagittal swing runs along the body, not across it toward the midline. */
const ARM_REST_SPLAY = 0.14;
/** Head turns once per two steps, barely. */
const HEAD_TURN_TEMPO = 0.5;
const HEAD_TURN_AMP = 0.12;
/** The pose: a quarter turn out, then a longer turn back over the shoulder. */
const POSE_TURN = 0.5;
const POSE_LOOK_BACK = 1.1;
/** Waar een toeschouwer gaat staan: naast het dek en een eind voor de neus. */
const FRONT_ROW = { side: 3.4, back: 1.5 };
/** Camera flashes pop this far off the runway, either side. */
const FLASH_DIST = 2.1;
const FLASH_DIST_SPREAD = 0.5;

type Phase = 'wait' | 'out' | 'pose' | 'back';

interface Model {
	root: Group;
	body: Group;
	hips: Group;
	legL: Group;
	legR: Group;
	armL: Group;
	armR: Group;
	head: Group;
	hair: Mesh;
	name: string;
	phase: Phase;
	z: number;
	phaseT: number;
	stride: number;
	sway: number;
}

const LOOKS: { gown: number; hair: number; skin: number; name: string }[] = [
	{ gown: 0xd81b60, hair: 0x2b1b12, skin: 0xf0c9a8, name: 'Chantal' },
	{ gown: 0x1e88e5, hair: 0xf3e0a0, skin: 0xe8bd97, name: 'Priscilla' },
	{ gown: 0x111111, hair: 0x1a1a1a, skin: 0x8d5524, name: 'Yasmina' },
	{ gown: 0xffd54f, hair: 0x8d4a2f, skin: 0xd9a377, name: 'Brandi' },
	{ gown: 0x43a047, hair: 0x111111, skin: 0xa9714b, name: 'Shaniqua' },
];

const SPRITZ_COUNT = 90;
const SPRITZ_GRAVITY = 7;

export class Catwalk {
	readonly group = new Group();
	/**
	 * Disco aan = show pauzeert de bubbels; disco uit = de dames sproeien
	 * Aperol Spritz over het publiek tijdens de pose.
	 */
	partyMode = false;
	private spritz!: Points;
	private spritzVel = new Float32Array(SPRITZ_COUNT * 3);
	private spritzLife = new Float32Array(SPRITZ_COUNT);
	private spritzNext = 0;
	private bottle!: Group;
	private handPos = new Vector3();
	private models: Model[] = [];
	private materials: Material[] = [];
	/** The only spotlight in the mall; real, so the disco dimmer needs a handle on it. */
	readonly spot: SpotLight;
	private spotTarget: Object3D = new Group();
	private flashes: { mesh: Mesh; life: number }[] = [];
	private queue = 0;
	private flashCd = 0;
	private onAnnounce: ((name: string) => void) | null = null;

	constructor() {
		this.group.name = 'catwalk';
		this.buildRunway();
		this.buildSeating();
		this.buildBackdrop();

		this.spot = new SpotLight(0xffffff, 90, 26, Math.PI * 0.16, 0.45, 1.4);
		this.spot.position.set(RUNWAY_X, RIG_LAMP_Y, RIG_Z);
		this.spotTarget.position.set(RUNWAY_X, PODIUM_Y, START_Z);
		this.group.add(this.spot, this.spotTarget);
		this.spot.target = this.spotTarget;

		LOOKS.forEach((look, i) => {
			this.models.push(this.buildModel(look, i));
		});
		// First girl walks immediately, the rest wait their turn
		at(this.models, 0).phase = 'out';

		this.buildSpritz();
	}

	/** Aperol spray rig: particle pool + the bottle that appears in her hand. */
	private buildSpritz(): void {
		const positions = new Float32Array(SPRITZ_COUNT * 3);
		for (let i = 0; i < SPRITZ_COUNT; i++) positions[i * 3 + 1] = -100;
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(positions, 3));
		const mat = this.track(
			new PointsMaterial({
				color: 0xff7a2d,
				size: 0.09,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
			}),
		);
		this.spritz = new Points(geo, mat);
		this.spritz.frustumCulled = false;
		this.group.add(this.spritz);

		this.bottle = new Group();
		const glass = new Mesh(new CylinderGeometry(0.035, 0.045, 0.16, 8), this.mat(0xff7a2d, 0.25, 0.1));
		this.bottle.add(glass);
		const neck = new Mesh(new CylinderGeometry(0.014, 0.02, 0.07, 8), this.mat(0x2a5c2a, 0.4));
		neck.position.y = 0.11;
		this.bottle.add(neck);
		this.bottle.visible = false;
		this.group.add(this.bottle);
	}

	setAnnounceCallback(fn: (name: string) => void): void {
		this.onAnnounce = fn;
	}

	/** Who is working the runway right now (dashboard). */
	get nowOnStage(): { name: string; phase: Phase } | null {
		const active = this.models.find((m) => m.phase !== 'wait');
		return active ? { name: active.name, phase: active.phase } : null;
	}

	/** Where a spectator should stand to watch the show: the mall side, not the wall side. */
	getFrontRow(): Vector3 {
		return new Vector3(RUNWAY_X - FRONT_ROW.side, 0, TIP_Z - FRONT_ROW.back);
	}

	update(dt: number, t: number): void {
		for (const m of this.models) this.tickModel(m, dt);

		// Spotlight rides the girl who is currently working
		const active = this.models.find((m) => m.phase !== 'wait');
		if (active) {
			this.spotTarget.position.set(RUNWAY_X + Math.sin(t * SPOT_SWEEP_TEMPO) * SPOT_SWEEP, PODIUM_Y + 0.9, active.z);
		}

		const posing = active?.phase === 'pose';
		this.tickFlashes(dt, posing);
		this.tickSpritz(dt, posing && !this.partyMode ? (active ?? null) : null);
	}

	/** Geen party? Dan Aperol. The posing girl sprays the front row. */
	private tickSpritz(dt: number, sprayer: Model | null): void {
		this.bottle.visible = sprayer !== null;

		if (sprayer) {
			// Parent the bottle INTO the outstretched hand so it follows the arm
			if (this.bottle.parent !== sprayer.armL) {
				sprayer.armL.add(this.bottle);
				this.bottle.position.set(0, -0.58, 0.04);
				this.bottle.rotation.z = -0.5;
			}
			this.bottle.getWorldPosition(this.handPos);

			// A few drops per frame, lobbed toward the audience side
			const pos = this.spritz.geometry.getAttribute('position');
			const arr = pos.array as Float32Array;
			for (let n = 0; n < 3; n++) {
				const i = this.spritzNext;
				this.spritzNext = (this.spritzNext + 1) % SPRITZ_COUNT;
				arr[i * 3] = this.handPos.x;
				arr[i * 3 + 1] = this.handPos.y + 0.12;
				arr[i * 3 + 2] = this.handPos.z;
				// Fan east toward the seats, with fizz
				this.spritzVel[i * 3] = 1.6 + Math.random() * 1.8;
				this.spritzVel[i * 3 + 1] = 2.2 + Math.random() * 1.4;
				this.spritzVel[i * 3 + 2] = jitter(2.4);
				this.spritzLife[i] = 1.4;
			}
		}

		// Integrate the pool (cheap: fixed size, no allocation)
		const pos = this.spritz.geometry.getAttribute('position');
		const arr = pos.array as Float32Array;
		const life = this.spritzLife;
		const vel = this.spritzVel;
		let alive = false;
		for (let i = 0; i < SPRITZ_COUNT; i++) {
			if ((life[i] ?? 0) <= 0) continue;
			life[i] = (life[i] ?? 0) - dt;
			const o = i * 3;
			vel[o + 1] = (vel[o + 1] ?? 0) - SPRITZ_GRAVITY * dt;
			arr[o] = (arr[o] ?? 0) + (vel[o] ?? 0) * dt;
			arr[o + 1] = (arr[o + 1] ?? 0) + (vel[o + 1] ?? 0) * dt;
			arr[o + 2] = (arr[o + 2] ?? 0) + (vel[o + 2] ?? 0) * dt;
			if ((life[i] ?? 0) <= 0 || (arr[o + 1] ?? 0) < 0.05) {
				arr[o + 1] = -100;
				life[i] = 0;
			} else {
				alive = true;
			}
		}
		if (alive || sprayer) pos.needsUpdate = true;
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
	}

	// ── models ─────────────────────────────────────────────

	private tickModel(m: Model, dt: number): void {
		m.phaseT += dt;

		if (m.phase === 'wait') {
			m.root.visible = false;
			// Next in line steps out when the runway is free
			const busy = this.models.some((o) => o !== m && o.phase !== 'wait');
			if (!busy && this.models[this.queue] === m) {
				m.phase = 'out';
				m.phaseT = 0;
				m.z = START_Z;
			}
			return;
		}

		m.root.visible = true;

		if (m.phase === 'out') {
			if (m.phaseT < 0.05) this.onAnnounce?.(m.name);
			m.z += WALK_SPEED * dt;
			this.strut(m, 1);
			m.root.rotation.y = 0; // walking toward +Z (the audience end)
			if (m.z >= TIP_Z) {
				m.z = TIP_Z;
				m.phase = 'pose';
				m.phaseT = 0;
			}
			return;
		}

		if (m.phase === 'pose') {
			this.pose(m, m.phaseT);
			if (m.phaseT >= POSE_TIME) {
				m.phase = 'back';
				m.phaseT = 0;
			}
			return;
		}

		// back
		m.z -= WALK_SPEED * 1.15 * dt;
		this.strut(m, -1);
		m.root.rotation.y = Math.PI;
		if (m.z <= START_Z) {
			m.phase = 'wait';
			m.phaseT = 0;
			m.root.visible = false;
			this.queue = (this.queue + 1) % this.models.length;
		}
	}

	/** Runway walk: long stride, hard hip sway, arms swinging sagittally along the hips. */
	private strut(m: Model, dir: 1 | -1): void {
		const p = m.z * m.stride * dir;
		const swing = Math.sin(p) * 0.55;

		m.legL.rotation.x = swing;
		m.legR.rotation.x = -swing;
		// Feet cross the centre line — that's the walk
		m.legL.position.x = -0.06 + Math.sin(p) * 0.07;
		m.legR.position.x = 0.06 - Math.sin(p) * 0.07;

		m.hips.rotation.z = Math.sin(p) * m.sway;
		m.hips.rotation.y = Math.sin(p) * 0.12;
		m.body.rotation.z = -Math.sin(p) * m.sway * BODY_SWAY_SHARE;
		m.body.position.y = 1.0 + Math.abs(Math.sin(p)) * 0.02;

		m.armL.rotation.x = -swing * ARM_SWING_SHARE;
		m.armR.rotation.x = swing * ARM_SWING_SHARE;
		m.armL.rotation.z = -ARM_REST_SPLAY;
		m.armR.rotation.z = ARM_REST_SPLAY;

		m.head.rotation.y = Math.sin(p * HEAD_TURN_TEMPO) * HEAD_TURN_AMP;
		m.hair.rotation.z = -Math.sin(p) * 0.14;

		m.root.position.set(RUNWAY_X, PODIUM_Y, m.z);
	}

	/** End of the runway: stop, hand on hip, quarter turn, look back. */
	private pose(m: Model, t: number): void {
		const turn = Math.min(1, t / 0.7);
		const back = t > POSE_TIME * 0.6 ? Math.min(1, (t - POSE_TIME * 0.6) / 0.6) : 0;
		m.root.position.set(RUNWAY_X, PODIUM_Y, m.z);
		m.root.rotation.y = turn * POSE_TURN - back * POSE_LOOK_BACK;

		m.legL.rotation.x = 0.08;
		m.legR.rotation.x = -0.12;
		m.legL.position.x = -0.05;
		m.legR.position.x = 0.05;
		m.hips.rotation.z = 0.16 * turn;
		m.hips.rotation.y = 0;
		m.body.rotation.z = -0.1 * turn;
		m.body.position.y = 1.0;

		// Hand on hip, other arm out
		m.armR.rotation.x = -0.15;
		m.armR.rotation.z = -1.15 * turn;
		m.armL.rotation.x = -0.1;
		m.armL.rotation.z = 0.35 + 0.2 * turn;
		m.head.rotation.y = -0.25 * back;
		m.hair.rotation.z = 0;
	}

	private buildModel(look: { gown: number; hair: number; skin: number; name: string }, index: number): Model {
		const skin = this.mat(look.skin, 0.72);
		const gown = this.mat(look.gown, 0.42, 0.15);
		const hairMat = this.mat(look.hair, 0.78);
		const heel = this.mat(0x1a1a1a, 0.3, 0.3);
		const gold = this.mat(0xd4af37, 0.25, 0.9);

		const root = new Group();
		root.position.set(RUNWAY_X, PODIUM_Y, START_Z);
		root.visible = false;

		// Feet on the deck at root y=0; hip pivot 0.9 up; body origin at the waist.
		const hips = new Group();
		hips.position.y = 0.9;
		root.add(hips);

		// Pelvis — the sway needs mass to sell it, but it's a hip, not a balloon
		const pelvis = new Mesh(new SphereGeometry(0.185, 14, 10), gown);
		pelvis.scale.set(1.05, 0.62, 0.92);
		pelvis.position.y = 0.06;
		hips.add(pelvis);

		const makeLeg = (side: -1 | 1): Group => {
			const leg = new Group();
			leg.position.set(side * 0.085, 0, 0);
			// Real thighs, not chopsticks — thick at the top, tapering down
			const thigh = new Mesh(new CapsuleGeometry(0.105, 0.34, 5, 9), skin);
			thigh.position.set(0, -0.22, 0);
			leg.add(thigh);
			const knee = new Mesh(new SphereGeometry(0.07, 8, 6), skin);
			knee.position.y = -0.46;
			leg.add(knee);
			const calf = new Mesh(new CapsuleGeometry(0.068, 0.28, 5, 8), skin);
			calf.position.y = -0.63;
			leg.add(calf);
			// Stiletto
			const shoe = new Mesh(new BoxGeometry(0.1, 0.055, 0.24), heel);
			shoe.position.set(0, -0.83, 0.05);
			leg.add(shoe);
			const spike = new Mesh(new CylinderGeometry(0.013, 0.022, 0.11, 6), heel);
			spike.position.set(0, -0.885, -0.05);
			leg.add(spike);
			hips.add(leg);
			return leg;
		};
		const legL = makeLeg(-1);
		const legR = makeLeg(1);

		const body = new Group();
		body.position.y = 1.0;
		root.add(body);

		// Hourglass torso — one lathed profile IN BODY SPACE: waist at the origin,
		// shoulders at +0.54, hip flare meeting the pelvis at −0.06. (First cut sat
		// a half-metre low, parking the shoulder ring at hip height.)
		// Bottom→top: lathe normals face outward this way round (top→down renders
		// the surface inside-out and you look straight through the gown).
		const profile: Vector2[] = [
			new Vector2(0.001, -0.12),
			new Vector2(0.205, -0.12),
			new Vector2(0.2, -0.06), // hip flare
			new Vector2(0.115, 0.12), // waist
			new Vector2(0.135, 0.28), // underbust
			new Vector2(0.185, 0.4), // bust
			new Vector2(0.155, 0.54), // shoulders
			new Vector2(0.055, 0.62), // neck
			new Vector2(0.001, 0.62),
		];
		const torso = new Mesh(new LatheGeometry(profile, 18), gown);
		torso.castShadow = true;
		body.add(torso);
		// Bust — the lathe is radially symmetric, this pushes it forward. Subtle.
		const bust = new Mesh(new SphereGeometry(0.115, 12, 10), gown);
		bust.scale.set(1.15, 0.68, 0.8);
		bust.position.set(0, 0.4, 0.095);
		body.add(bust);

		// Gown skirt with a high slit: open arc, one thigh shows while she walks
		const skirt = new Mesh(new ConeGeometry(0.34, 0.72, 18, 1, true, Math.PI * 0.14, Math.PI * 1.72), gown);
		skirt.position.y = -0.42;
		body.add(skirt);

		// Necklace + hoops
		const necklace = new Mesh(new TorusGeometry(0.065, 0.009, 6, 14), gold);
		necklace.position.set(0, 0.5, 0.055);
		necklace.rotation.x = 1.25;
		body.add(necklace);

		const makeArm = (side: -1 | 1): Group => {
			const arm = new Group();
			arm.position.set(side * 0.185, 0.52, 0);
			const shoulder = new Mesh(new SphereGeometry(0.062, 8, 6), skin);
			arm.add(shoulder);
			const upper = new Mesh(new CapsuleGeometry(0.052, 0.24, 4, 7), skin);
			upper.position.y = -0.17;
			arm.add(upper);
			const lower = new Mesh(new CapsuleGeometry(0.042, 0.22, 4, 7), skin);
			lower.position.y = -0.43;
			arm.add(lower);
			const hand = new Mesh(new SphereGeometry(0.045, 8, 6), skin);
			hand.scale.set(0.85, 1.15, 0.85);
			hand.position.y = -0.58;
			arm.add(hand);
			// Gold bracelet
			const cuff = new Mesh(new TorusGeometry(0.048, 0.008, 6, 12), gold);
			cuff.rotation.x = Math.PI / 2;
			cuff.position.y = -0.5;
			arm.add(cuff);
			body.add(arm);
			return arm;
		};
		const armL = makeArm(-1);
		const armR = makeArm(1);

		const head = new Group();
		head.position.y = 0.78;
		body.add(head);
		const skull = new Mesh(new SphereGeometry(0.125, 14, 12), skin);
		head.add(skull);
		const neck = new Mesh(new CylinderGeometry(0.045, 0.05, 0.12, 8), skin);
		neck.position.y = -0.14;
		head.add(neck);
		const dark = this.mat(0x141414, 0.3);
		for (const side of [-1, 1] as const) {
			const eye = new Mesh(new SphereGeometry(0.024, 8, 6), dark);
			eye.position.set(side * 0.048, 0.02, 0.112);
			eye.scale.z = 0.5;
			head.add(eye);
			// Brow — makeup, not menace
			const brow = new Mesh(new BoxGeometry(0.045, 0.008, 0.01), dark);
			brow.position.set(side * 0.05, 0.055, 0.115);
			brow.rotation.z = side * -0.18;
			head.add(brow);
			// Gold hoop
			const hoop = new Mesh(new TorusGeometry(0.022, 0.004, 6, 12), this.mat(0xd4af37, 0.25, 0.9));
			hoop.position.set(side * 0.12, -0.045, 0);
			head.add(hoop);
		}
		const lips = new Mesh(new SphereGeometry(0.03, 10, 8), this.mat(0xc2185b, 0.35));
		lips.scale.set(1.4, 0.65, 0.5);
		lips.position.set(0, -0.052, 0.114);
		head.add(lips);

		// Long hair, swings with the walk. Raked back off the nape so the fall lies behind the
		// gown's back instead of poking through it from behind.
		const hair = new Mesh(new CapsuleGeometry(0.09, 0.34, 6, 12), hairMat);
		hair.position.set(0, -0.1, -0.2);
		hair.rotation.x = 0.38;
		head.add(hair);
		const fringe = new Mesh(new SphereGeometry(0.132, 14, 10, Math.PI * 0.22, Math.PI * 1.56, 0, Math.PI * 0.55), hairMat);
		fringe.position.y = 0.02;
		head.add(fringe);

		this.group.add(root);

		return {
			root,
			body,
			hips,
			legL,
			legR,
			armL,
			armR,
			head,
			hair,
			name: at(LOOKS, index).name,
			phase: 'wait',
			z: START_Z,
			phaseT: 0,
			stride: 3.1 + (index % 3) * 0.25,
			sway: 0.14 + (index % 2) * 0.05,
		};
	}

	// ── set dressing ───────────────────────────────────────

	private buildRunway(): void {
		const deck = new Mesh(new BoxGeometry(HALF_W * 2, PODIUM_Y, DECK_LENGTH), this.mat(0xf7f5f2, 0.25, 0.15));
		deck.position.set(RUNWAY_X, half(PODIUM_Y), DECK_CENTER_Z);
		deck.receiveShadow = true;
		this.group.add(deck);

		// LED strips along both edges
		const strip = this.track(new MeshBasicMaterial({ color: 0xff4fa3, toneMapped: false }));
		for (const side of [-1, 1] as const) {
			const led = new Mesh(new BoxGeometry(LED_WIDTH, LED_HEIGHT, DECK_LENGTH), strip);
			led.position.set(RUNWAY_X + side * (HALF_W - LED_INSET), PODIUM_Y - half(LED_HEIGHT) + LED_RISE, DECK_CENTER_Z);
			this.group.add(led);
		}
		// Rounded tip
		const tip = new Mesh(
			new CylinderGeometry(CATWALK_DECK.noseRadius, CATWALK_DECK.noseRadius, PODIUM_Y, 20),
			this.mat(0xf7f5f2, 0.25, 0.15),
		);
		tip.position.set(RUNWAY_X, half(PODIUM_Y), CATWALK_DECK.noseCenterZ);
		this.group.add(tip);
	}

	private buildSeating(): void {
		const seatMat = this.mat(0x2b2b33, 0.8);
		const chrome = this.mat(0xb0b6c0, 0.35, 0.7);
		// One geometry per part, shared by all 14 chairs
		const seatGeo = new BoxGeometry(0.5, 0.08, 0.5);
		const backGeo = new BoxGeometry(0.5, 0.5, 0.07);
		const legGeo = new CylinderGeometry(0.02, 0.02, 0.44, 6);
		const legSpots: [number, number][] = [
			[-0.2, -0.2],
			[0.2, -0.2],
			[-0.2, 0.2],
			[0.2, 0.2],
		];

		const { seating } = CATWALK_SPEC;
		for (const side of [-1, 1] as const) {
			for (let i = 0; i < catwalkSeatRows(); i++) {
				const chair = new Group();
				chair.position.set(RUNWAY_X + side * seating.offsetX, 0, START_Z + seating.firstOffset + i * seating.spacing);
				chair.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;

				const seat = new Mesh(seatGeo, seatMat);
				seat.position.y = 0.44;
				chair.add(seat);
				const back = new Mesh(backGeo, seatMat);
				back.position.set(0, 0.68, -0.22);
				chair.add(back);
				for (const [lx, lz] of legSpots) {
					const leg = new Mesh(legGeo, chrome);
					leg.position.set(lx, 0.22, lz);
					chair.add(leg);
				}
				this.group.add(chair);
			}
		}
	}

	private buildBackdrop(): void {
		const frame = this.mat(0x14141a, 0.7);
		const { backdrop } = CATWALK_SPEC;
		const wall = new Mesh(new BoxGeometry(backdrop.width, backdrop.height, backdrop.thickness), frame);
		wall.position.set(RUNWAY_X, half(backdrop.height), START_Z - backdrop.offset);
		this.group.add(wall);

		// Backdrop banner
		const { canvas, ctx } = labelCanvas(512, 256);
		const grad = ctx.createLinearGradient(0, 0, 512, 256);
		grad.addColorStop(0, '#ff4fa3');
		grad.addColorStop(1, '#7c3aed');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 512, 256);
		ctx.fillStyle = '#fff';
		ctx.textAlign = 'center';
		ctx.font = '800 54px system-ui,sans-serif';
		ctx.fillText('FASHION', 256, 96);
		ctx.fillText('WEEK', 256, 152);
		ctx.font = '600 22px system-ui,sans-serif';
		ctx.fillText('PRAIRIE LAKES · CATWALK', 256, 200);
		const tex = labelTexture(canvas);
		const banner = new Mesh(new PlaneGeometry(5, 3.6), this.track(new MeshBasicMaterial({ map: tex, toneMapped: false })));
		banner.position.set(RUNWAY_X, 2.2, START_Z - 1.48);
		this.group.add(banner);

		// Truss with lamps over the runway
		const truss = this.mat(0x40454f, 0.5, 0.6);
		for (const side of [-1, 1] as const) {
			const post = new Mesh(new CylinderGeometry(0.07, 0.07, 4.6, 8), truss);
			post.position.set(RUNWAY_X + side * 2.6, 2.3, RIG_Z);
			this.group.add(post);
		}
		const beam = new Mesh(new BoxGeometry(5.6, 0.14, 0.14), truss);
		beam.position.set(RUNWAY_X, RIG_BEAM_Y, RIG_Z);
		this.group.add(beam);
		const lampMat = this.track(new MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false }));
		for (let i = 0; i < 5; i++) {
			const lamp = new Mesh(new SphereGeometry(0.13, 8, 6), lampMat);
			lamp.position.set(RUNWAY_X - 2 + i, RIG_LAMP_Y, RIG_Z);
			this.group.add(lamp);
		}
	}

	/** Photographers going off while she poses. */
	private tickFlashes(dt: number, posing: boolean): void {
		this.flashCd -= dt;
		if (posing && this.flashCd <= 0) {
			this.flashCd = 0.08 + Math.random() * 0.16;
			const side = Math.random() < 0.5 ? -1 : 1;
			const mesh = new Mesh(
				new PlaneGeometry(0.5, 0.5),
				this.track(
					new MeshBasicMaterial({
						color: 0xffffff,
						transparent: true,
						opacity: 0.9,
						toneMapped: false,
						depthWrite: false,
					}),
				),
			);
			mesh.position.set(
				RUNWAY_X + side * (FLASH_DIST + Math.random() * FLASH_DIST_SPREAD),
				1.1 + Math.random() * 0.4,
				TIP_Z - 1 + jitter(3),
			);
			mesh.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
			this.group.add(mesh);
			this.flashes.push({ mesh, life: 0.12 });
		}

		for (const f of this.flashes) {
			f.life -= dt;
			const mat = f.mesh.material as MeshBasicMaterial;
			mat.opacity = Math.max(0, f.life * 7);
		}
		const dead = this.flashes.filter((f) => f.life <= 0);
		for (const d of dead) {
			d.mesh.removeFromParent();
			(d.mesh.material as Material).dispose();
			d.mesh.geometry.dispose();
		}
		if (dead.length) this.flashes = this.flashes.filter((f) => f.life > 0);
	}

	private mat(color: number, roughness = 0.8, metalness = 0.05) {
		return this.track(lit({ color, roughness, metalness }));
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
