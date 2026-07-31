import * as THREE from 'three';

/**
 * Prairie Lakes Fashion Week: a runway in front of Douglas on the ground floor.
 *
 * Sits at x=-28, z=-4…12 — deliberately clear of every wayfinding edge, so the
 * shopper crowd never tries to path through the show.
 */
const RUNWAY_X = -28;
const START_Z = -3.5;
// Tip circle reaches TIP_Z + 2.55; the WC back wall starts at z 12.35 — keep clear
const TIP_Z = 9.5;
const DECK_Y = 0.34;
const HALF_W = 1.35;

const WALK_SPEED = 1.15;
const POSE_TIME = 2.6;

type Phase = 'wait' | 'out' | 'pose' | 'back';

type Model = {
	root: THREE.Group;
	body: THREE.Group;
	hips: THREE.Group;
	legL: THREE.Group;
	legR: THREE.Group;
	armL: THREE.Group;
	armR: THREE.Group;
	head: THREE.Group;
	hair: THREE.Mesh;
	name: string;
	phase: Phase;
	z: number;
	phaseT: number;
	stride: number;
	sway: number;
};

const LOOKS: { gown: number; hair: number; skin: number; name: string }[] = [
	{ gown: 0xd81b60, hair: 0x2b1b12, skin: 0xf0c9a8, name: 'Chantal' },
	{ gown: 0x1e88e5, hair: 0xf3e0a0, skin: 0xe8bd97, name: 'Priscilla' },
	{ gown: 0x111111, hair: 0x1a1a1a, skin: 0x8d5524, name: 'Yasmina' },
	{ gown: 0xffd54f, hair: 0x8d4a2f, skin: 0xd9a377, name: 'Brandi' },
	{ gown: 0x43a047, hair: 0x111111, skin: 0xa9714b, name: 'Shaniqua' },
];

export class Catwalk {
	readonly group = new THREE.Group();
	private models: Model[] = [];
	private materials: THREE.Material[] = [];
	private spot: THREE.SpotLight;
	private spotTarget = new THREE.Object3D();
	private flashes: { mesh: THREE.Mesh; life: number }[] = [];
	private queue = 0;
	private flashCd = 0;
	private onAnnounce: ((name: string) => void) | null = null;

	constructor() {
		this.group.name = 'catwalk';
		this.buildRunway();
		this.buildSeating();
		this.buildBackdrop();

		this.spot = new THREE.SpotLight(0xffffff, 90, 26, Math.PI * 0.16, 0.45, 1.4);
		this.spot.position.set(RUNWAY_X, 7.4, TIP_Z - 4);
		this.spotTarget.position.set(RUNWAY_X, DECK_Y, START_Z);
		this.group.add(this.spot, this.spotTarget);
		this.spot.target = this.spotTarget;

		LOOKS.forEach((look, i) => this.models.push(this.buildModel(look, i)));
		// First girl walks immediately, the rest wait their turn
		this.models[0].phase = 'out';
	}

	setAnnounceCallback(fn: (name: string) => void): void {
		this.onAnnounce = fn;
	}

	/** Where a spectator should stand to watch the show. */
	getFrontRow(): THREE.Vector3 {
		return new THREE.Vector3(RUNWAY_X + 3.4, 0, TIP_Z - 1.5);
	}

	update(dt: number, t: number): void {
		for (const m of this.models) this.tickModel(m, dt);

		// Spotlight rides the girl who is currently working
		const active = this.models.find((m) => m.phase !== 'wait');
		if (active) {
			this.spotTarget.position.set(
				RUNWAY_X + Math.sin(t * 0.6) * 0.5,
				DECK_Y + 0.9,
				active.z,
			);
		}

		this.tickFlashes(dt, active?.phase === 'pose');
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

	/** Runway walk: long stride, hard hip sway, arms swinging across the body. */
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
		m.body.rotation.z = -Math.sin(p) * m.sway * 0.5;
		m.body.position.y = 0.9 + Math.abs(Math.sin(p)) * 0.02;

		m.armL.rotation.x = -swing * 0.5;
		m.armR.rotation.x = swing * 0.5;
		m.armL.rotation.z = 0.22 + Math.sin(p) * 0.1;
		m.armR.rotation.z = -0.22 + Math.sin(p) * 0.1;

		m.head.rotation.y = Math.sin(p * 0.5) * 0.12;
		m.hair.rotation.z = -Math.sin(p) * 0.14;

		m.root.position.set(RUNWAY_X, DECK_Y, m.z);
	}

	/** End of the runway: stop, hand on hip, quarter turn, look back. */
	private pose(m: Model, t: number): void {
		const turn = Math.min(1, t / 0.7);
		const back = t > POSE_TIME * 0.6 ? Math.min(1, (t - POSE_TIME * 0.6) / 0.6) : 0;
		m.root.position.set(RUNWAY_X, DECK_Y, m.z);
		m.root.rotation.y = turn * 0.5 - back * 1.1;

		m.legL.rotation.x = 0.08;
		m.legR.rotation.x = -0.12;
		m.legL.position.x = -0.05;
		m.legR.position.x = 0.05;
		m.hips.rotation.z = 0.16 * turn;
		m.hips.rotation.y = 0;
		m.body.rotation.z = -0.1 * turn;
		m.body.position.y = 0.9;

		// Hand on hip, other arm out
		m.armR.rotation.x = -0.15;
		m.armR.rotation.z = -1.15 * turn;
		m.armL.rotation.x = -0.1;
		m.armL.rotation.z = 0.35 + 0.2 * turn;
		m.head.rotation.y = -0.25 * back;
		m.hair.rotation.z = 0;
	}

	private buildModel(
		look: { gown: number; hair: number; skin: number; name: string },
		index: number,
	): Model {
		const skin = this.mat(look.skin, 0.72);
		const gown = this.mat(look.gown, 0.42, 0.15);
		const hairMat = this.mat(look.hair, 0.78);
		const heel = this.mat(0x1a1a1a, 0.3, 0.3);
		const gold = this.mat(0xd4af37, 0.25, 0.9);

		const root = new THREE.Group();
		root.position.set(RUNWAY_X, DECK_Y, START_Z);
		root.visible = false;

		const hips = new THREE.Group();
		hips.position.y = 0.86;
		root.add(hips);

		// Pelvis — the sway needs mass to sell it
		const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 10), gown);
		pelvis.scale.set(1.2, 0.72, 1.0);
		pelvis.position.y = 0.02;
		hips.add(pelvis);

		const makeLeg = (side: -1 | 1): THREE.Group => {
			const leg = new THREE.Group();
			leg.position.set(side * 0.085, 0, 0);
			// Real thighs, not chopsticks — thick at the top, tapering down
			const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.34, 5, 9), skin);
			thigh.position.set(0, -0.22, 0);
			leg.add(thigh);
			const knee = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skin);
			knee.position.y = -0.46;
			leg.add(knee);
			const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.28, 5, 8), skin);
			calf.position.y = -0.63;
			leg.add(calf);
			// Stiletto
			const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.24), heel);
			shoe.position.set(0, -0.83, 0.05);
			leg.add(shoe);
			const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.022, 0.11, 6), heel);
			spike.position.set(0, -0.885, -0.05);
			leg.add(spike);
			hips.add(leg);
			return leg;
		};
		const legL = makeLeg(-1);
		const legR = makeLeg(1);

		const body = new THREE.Group();
		body.position.y = 0.9;
		root.add(body);

		// Hourglass torso — one lathed profile: shoulder → bust → waist → hip
		const profile: THREE.Vector2[] = [
			new THREE.Vector2(0.001, 0.6),
			new THREE.Vector2(0.055, 0.6), // neck
			new THREE.Vector2(0.155, 0.52), // shoulders
			new THREE.Vector2(0.19, 0.38), // bust
			new THREE.Vector2(0.135, 0.24), // underbust
			new THREE.Vector2(0.115, 0.1), // waist
			new THREE.Vector2(0.2, -0.1), // hip flare
			new THREE.Vector2(0.205, -0.16),
			new THREE.Vector2(0.001, -0.16),
		];
		const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), gown);
		torso.position.y = -0.6;
		torso.castShadow = true;
		body.add(torso);
		// Bust — the lathe is radially symmetric, this pushes it forward
		const bust = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), gown);
		bust.scale.set(1.35, 0.75, 0.9);
		bust.position.set(0, -0.2, 0.075);
		body.add(bust);

		// Gown skirt with a high slit: open arc, one thigh shows while she walks
		const skirt = new THREE.Mesh(
			new THREE.ConeGeometry(0.34, 0.72, 18, 1, true, Math.PI * 0.14, Math.PI * 1.72),
			gown,
		);
		skirt.position.y = -0.68;
		body.add(skirt);

		// Necklace + hoops
		const necklace = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.009, 6, 14), gold);
		necklace.position.set(0, 0.02, 0.045);
		necklace.rotation.x = 1.25;
		body.add(necklace);

		const makeArm = (side: -1 | 1): THREE.Group => {
			const arm = new THREE.Group();
			arm.position.set(side * 0.185, 0.0, 0);
			const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), skin);
			arm.add(shoulder);
			const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.24, 4, 7), skin);
			upper.position.y = -0.17;
			arm.add(upper);
			const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.22, 4, 7), skin);
			lower.position.y = -0.43;
			arm.add(lower);
			const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
			hand.scale.set(0.85, 1.15, 0.85);
			hand.position.y = -0.58;
			arm.add(hand);
			// Gold bracelet
			const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.008, 6, 12), gold);
			cuff.rotation.x = Math.PI / 2;
			cuff.position.y = -0.5;
			arm.add(cuff);
			body.add(arm);
			return arm;
		};
		const armL = makeArm(-1);
		const armR = makeArm(1);

		const head = new THREE.Group();
		head.position.y = 0.28;
		body.add(head);
		const skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), skin);
		head.add(skull);
		const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8), skin);
		neck.position.y = -0.14;
		head.add(neck);
		const dark = this.mat(0x141414, 0.3);
		for (const side of [-1, 1] as const) {
			const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), dark);
			eye.position.set(side * 0.048, 0.02, 0.112);
			eye.scale.z = 0.5;
			head.add(eye);
			// Brow — makeup, not menace
			const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.01), dark);
			brow.position.set(side * 0.05, 0.055, 0.115);
			brow.rotation.z = side * -0.18;
			head.add(brow);
			// Gold hoop
			const hoop = new THREE.Mesh(
				new THREE.TorusGeometry(0.022, 0.004, 6, 12),
				this.mat(0xd4af37, 0.25, 0.9),
			);
			hoop.position.set(side * 0.12, -0.045, 0);
			head.add(hoop);
		}
		const lips = new THREE.Mesh(
			new THREE.SphereGeometry(0.03, 10, 8),
			this.mat(0xc2185b, 0.35),
		);
		lips.scale.set(1.4, 0.65, 0.5);
		lips.position.set(0, -0.052, 0.114);
		head.add(lips);

		// Long hair, swings with the walk
		const hair = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.115, 0.34, 6, 12),
			hairMat,
		);
		hair.position.set(0, -0.08, -0.06);
		head.add(hair);
		const fringe = new THREE.Mesh(
			new THREE.SphereGeometry(0.132, 14, 10, Math.PI * 0.22, Math.PI * 1.56, 0, Math.PI * 0.55),
			hairMat,
		);
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
			name: LOOKS[index].name,
			phase: 'wait',
			z: START_Z,
			phaseT: 0,
			stride: 3.1 + (index % 3) * 0.25,
			sway: 0.14 + (index % 2) * 0.05,
		};
	}

	// ── set dressing ───────────────────────────────────────

	private buildRunway(): void {
		const deck = new THREE.Mesh(
			new THREE.BoxGeometry(HALF_W * 2, DECK_Y, TIP_Z - START_Z + 2.4),
			this.mat(0xf7f5f2, 0.25, 0.15),
		);
		deck.position.set(RUNWAY_X, DECK_Y / 2, (START_Z + TIP_Z) / 2);
		deck.receiveShadow = true;
		this.group.add(deck);

		// LED strips along both edges
		const strip = this.track(
			new THREE.MeshBasicMaterial({ color: 0xff4fa3, toneMapped: false }),
		);
		for (const side of [-1, 1] as const) {
			const led = new THREE.Mesh(
				new THREE.BoxGeometry(0.08, 0.06, TIP_Z - START_Z + 2.4),
				strip,
			);
			led.position.set(RUNWAY_X + side * (HALF_W - 0.02), DECK_Y - 0.03, (START_Z + TIP_Z) / 2);
			this.group.add(led);
		}
		// Rounded tip
		const tip = new THREE.Mesh(
			new THREE.CylinderGeometry(HALF_W, HALF_W, DECK_Y, 20),
			this.mat(0xf7f5f2, 0.25, 0.15),
		);
		tip.position.set(RUNWAY_X, DECK_Y / 2, TIP_Z + 1.2);
		this.group.add(tip);
	}

	private buildSeating(): void {
		const seatMat = this.mat(0x2b2b33, 0.8);
		const chrome = this.mat(0xb0b6c0, 0.35, 0.7);
		// One geometry per part, shared by all 14 chairs
		const seatGeo = new THREE.BoxGeometry(0.5, 0.08, 0.5);
		const backGeo = new THREE.BoxGeometry(0.5, 0.5, 0.07);
		const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.44, 6);
		const legSpots: [number, number][] = [
			[-0.2, -0.2],
			[0.2, -0.2],
			[-0.2, 0.2],
			[0.2, 0.2],
		];

		for (const side of [-1, 1] as const) {
			for (let i = 0; i < 7; i++) {
				const chair = new THREE.Group();
				chair.position.set(RUNWAY_X + side * 2.3, 0, START_Z + 1.4 + i * 2);
				chair.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;

				const seat = new THREE.Mesh(seatGeo, seatMat);
				seat.position.y = 0.44;
				chair.add(seat);
				const back = new THREE.Mesh(backGeo, seatMat);
				back.position.set(0, 0.68, -0.22);
				chair.add(back);
				for (const [lx, lz] of legSpots) {
					const leg = new THREE.Mesh(legGeo, chrome);
					leg.position.set(lx, 0.22, lz);
					chair.add(leg);
				}
				this.group.add(chair);
			}
		}
	}

	private buildBackdrop(): void {
		const frame = this.mat(0x14141a, 0.7);
		const wall = new THREE.Mesh(
			new THREE.BoxGeometry(5.4, 4.2, 0.18),
			frame,
		);
		wall.position.set(RUNWAY_X, 2.1, START_Z - 1.6);
		this.group.add(wall);

		// Backdrop banner
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 256;
		const ctx = canvas.getContext('2d')!;
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
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const banner = new THREE.Mesh(
			new THREE.PlaneGeometry(5, 3.6),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		banner.position.set(RUNWAY_X, 2.2, START_Z - 1.48);
		this.group.add(banner);

		// Truss with lamps over the runway
		const truss = this.mat(0x40454f, 0.5, 0.6);
		for (const side of [-1, 1] as const) {
			const post = new THREE.Mesh(
				new THREE.CylinderGeometry(0.07, 0.07, 4.6, 8),
				truss,
			);
			post.position.set(RUNWAY_X + side * 2.6, 2.3, TIP_Z - 3);
			this.group.add(post);
		}
		const beam = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.14, 0.14), truss);
		beam.position.set(RUNWAY_X, 4.5, TIP_Z - 3);
		this.group.add(beam);
		const lampMat = this.track(
			new THREE.MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false }),
		);
		for (let i = 0; i < 5; i++) {
			const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), lampMat);
			lamp.position.set(RUNWAY_X - 2 + i, 4.34, TIP_Z - 3);
			this.group.add(lamp);
		}
	}

	/** Photographers going off while she poses. */
	private tickFlashes(dt: number, posing: boolean): void {
		this.flashCd -= dt;
		if (posing && this.flashCd <= 0) {
			this.flashCd = 0.08 + Math.random() * 0.16;
			const side = Math.random() < 0.5 ? -1 : 1;
			const mesh = new THREE.Mesh(
				new THREE.PlaneGeometry(0.5, 0.5),
				this.track(
					new THREE.MeshBasicMaterial({
						color: 0xffffff,
						transparent: true,
						opacity: 0.9,
						toneMapped: false,
						depthWrite: false,
					}),
				),
			);
			mesh.position.set(
				RUNWAY_X + side * (2.1 + Math.random() * 0.5),
				1.1 + Math.random() * 0.4,
				TIP_Z - 1 + (Math.random() - 0.5) * 3,
			);
			mesh.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
			this.group.add(mesh);
			this.flashes.push({ mesh, life: 0.12 });
		}

		for (const f of this.flashes) {
			f.life -= dt;
			const mat = f.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = Math.max(0, f.life * 7);
		}
		const dead = this.flashes.filter((f) => f.life <= 0);
		for (const d of dead) {
			d.mesh.removeFromParent();
			(d.mesh.material as THREE.Material).dispose();
			d.mesh.geometry.dispose();
		}
		if (dead.length) this.flashes = this.flashes.filter((f) => f.life > 0);
	}

	private mat(color: number, roughness = 0.8, metalness = 0.05) {
		return this.track(
			new THREE.MeshStandardMaterial({ color, roughness, metalness }),
		);
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
