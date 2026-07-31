import * as THREE from 'three';
import { spatial } from '../audio/SpatialAudio';
import type { CollisionWorld } from '../physics/Collision';

type Protester = {
	root: THREE.Group;
	/** local pos relative to group (camp) */
	x: number;
	z: number;
	vx: number;
	vz: number;
	tx: number;
	tz: number;
	speed: number;
	retargetCd: number;
	phase: number;
	sign: THREE.Object3D;
	speech: THREE.Sprite;
	speechTex: THREE.CanvasTexture;
	speechCtx: CanvasRenderingContext2D;
	speechLife: number;
	fist?: THREE.Object3D;
	flag?: THREE.Object3D;
	isMerkel?: boolean;
	lineIdx: number;
	legPhase: number;
};

/** Dumb protest noise — loud, empty, endless */
const CHANTS = [
	'Wir schaffen das!',
	'WIR SCHAFFEN DAS!!!',
	'Refugees welcome 💚',
	'Love is love 🌈',
	'LGBTQIA+ rights!',
	'Climate now!!',
	'No borders no walls',
	'Peace & tofu',
	'Wir. Schaffen. Das.',
	'Solidarity forever',
	'Hope not hate 🌈',
	'Trans rights are human rights',
	// dumber
	'TAX THE RICH (not me)',
	'My therapist said protest more',
	'Late-stage capitalism?? in the mall??',
	'Free Palestine free smoothies',
	'ACAB but like, politely',
	'Defund the food court',
	'Eat the rich (vegan tho)',
	'This sign is recycled!!',
	'I read half a tweet about this',
	'Oat milk is a human right',
	'Silence is violence (also loud is fine)',
	'Check your privilege (and your receipt)',
	'No ethical consumption under capitalism so… Primark',
	'Boooo fossil fuels',
	'Who wants hummus??',
	'I am the main character of this march',
	'Guys is this being filmed?',
	'Wir schaffen das… right??',
	'Mutual aid = group chat',
	'Smash the patriarchy after brunch',
	'My zodiac said to chant today',
	'DECOLONIZE the escalator',
	'This is literally 1984 (mall remix)',
	'UwU no fascism',
	'Be kind or else',
	'I brought a drum and no rhythm',
	'Who has the aux??',
	'Land back / snack back',
	'Protect trans kids protect my WiFi',
	'Guillotine? soft launch',
	'I googled "what is neoliberalism" once',
];

const MERKEL_LINES = [
	'Wir schaffen das!',
	'Wir schaffen das… wirklich.',
	'Zusammen schaffen wir das.',
	'Die Lage ist ernst, aber…',
	'Ich sage nochmals: wir schaffen das!',
	'Mutti is watching 👀',
	'Bundeskanzlerin mode ON',
	'Open borders, open hearts',
	'Bitte nicht rennen — langsam swarm',
	'The science is settled (on tofu)',
	'I have a plan. It is: walk.',
];

const SIGN_LINES: [string, string][] = [
	['WIR SCHAFFEN', 'DAS'],
	['Wir schaffen', 'das!'],
	['REFUGEES', 'WELCOME'],
	['LOVE', 'WINS 🌈'],
	['LGBTQIA+', 'PRIDE'],
	['CLIMATE', 'JUSTICE'],
	['NO HATE', 'ONLY HUGS'],
	['TOFU', 'NOT WAR'],
];

type FlagKind = 'progress' | 'rainbow' | 'trans' | 'bi' | 'lesbian' | 'nb' | 'pan' | 'intersex';

/**
 * Atrium protest — liberal groupies + LGBTQIA+ flags +
 * thick elderly Angela Merkel. Swarm walks the floor like chanting zombies.
 */
export class ProtestGroupies {
	readonly group = new THREE.Group();
	/** East of atrium ground — clear of kiosk / north corridor */
	readonly pos = new THREE.Vector3(8, 0, 4);
	private materials: THREE.Material[] = [];
	private people: Protester[] = [];
	private plantedFlags: THREE.Group[] = [];
	private t = 0;
	private chantCd = 0.6;
	private audioStarted = false;
	private stopAudio: (() => void) | null = null;
	private banner!: THREE.Mesh;
	private merkelIdx = -1;
	private world: CollisionWorld;

	constructor(world: CollisionWorld) {
		this.world = world;
		this.group.name = 'protestGroupies';
		this.group.position.copy(this.pos);
		this.buildBanner();
		this.buildPlantedFlags();
		this.buildMerkel();
		this.buildCrowd(12);
		this.buildMegaphoneStand();
	}

	ensureAudio(): void {
		if (this.audioStarted) return;
		this.audioStarted = true;
		const handle = spatial.startLoopAt(
			{ x: this.pos.x, y: 1.6, z: this.pos.z },
			(ctx, dest) => {
				let alive = true;
				let timer: number | null = null;
				const phrase = () => {
					if (!alive) return;
					const notes = [196, 220, 247, 262, 247, 220, 196, 175];
					const durs = [0.22, 0.22, 0.28, 0.4, 0.22, 0.22, 0.28, 0.45];
					let t0 = ctx.currentTime + 0.02;
					for (let i = 0; i < notes.length; i++) {
						const o = ctx.createOscillator();
						const g = ctx.createGain();
						const f = ctx.createBiquadFilter();
						o.type = 'triangle';
						o.frequency.setValueAtTime(notes[i], t0);
						f.type = 'lowpass';
						f.frequency.value = 1400;
						const o2 = ctx.createOscillator();
						const g2 = ctx.createGain();
						o2.type = 'sawtooth';
						o2.frequency.setValueAtTime(notes[i] * 1.005, t0);
						g.gain.setValueAtTime(0.0001, t0);
						g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.03);
						g.gain.exponentialRampToValueAtTime(0.0001, t0 + durs[i]);
						g2.gain.setValueAtTime(0.0001, t0);
						g2.gain.exponentialRampToValueAtTime(0.035, t0 + 0.03);
						g2.gain.exponentialRampToValueAtTime(0.0001, t0 + durs[i]);
						o.connect(f);
						f.connect(g);
						g.connect(dest);
						o2.connect(g2);
						g2.connect(dest);
						o.start(t0);
						o.stop(t0 + durs[i] + 0.02);
						o2.start(t0);
						o2.stop(t0 + durs[i] + 0.02);
						t0 += durs[i] * 0.95;
					}
					timer = window.setTimeout(phrase, 4200 + Math.random() * 2200);
				};
				phrase();
				return {
					stop: () => {
						alive = false;
						if (timer !== null) clearTimeout(timer);
					},
				};
			},
			{ volume: 0.38, k: 0.05, maxDistance: 26 },
		);
		this.stopAudio = () => handle.stop();
	}

	update(dt: number, playerPos?: THREE.Vector3): void {
		this.t += dt;
		this.chantCd -= dt;
		this.tickSwarm(dt, playerPos);

		// Planted flags flutter (stay at camp)
		for (let i = 0; i < this.plantedFlags.length; i++) {
			const f = this.plantedFlags[i];
			const cloth = f.userData.cloth as THREE.Object3D | undefined;
			if (cloth) {
				cloth.rotation.y = Math.sin(this.t * 2.2 + i) * 0.25;
				cloth.rotation.z = Math.sin(this.t * 1.7 + i * 0.8) * 0.08;
			}
		}

		if (this.banner) {
			this.banner.rotation.z = Math.sin(this.t * 1.3) * 0.04;
		}

		// Dumb overlapping chants — denser swarm noise
		if (this.chantCd <= 0) {
			this.chantCd = 0.7 + Math.random() * 1.1;
			const n = 3 + Math.floor(Math.random() * 4);
			for (let k = 0; k < n; k++) {
				const idx = Math.floor(Math.random() * this.people.length);
				const p = this.people[idx];
				const line = p.isMerkel
					? MERKEL_LINES[Math.floor(Math.random() * MERKEL_LINES.length)]
					: Math.random() < 0.22
					? 'Wir schaffen das!'
					: CHANTS[Math.floor(Math.random() * CHANTS.length)];
				this.showBubble(p, line, !!p.isMerkel);
			}
			// Occasional full swarm echo
			if (Math.random() < 0.28 && this.merkelIdx >= 0) {
				this.showBubble(this.people[this.merkelIdx], 'WIR SCHAFFEN DAS!!!', true);
			}
		}
	}

	/**
	 * Zombie-swarm march: wander targets + cohesion + separation + mild player curiosity.
	 * Camp decorations stay put; bodies roam floor 0.
	 */
	private tickSwarm(dt: number, playerPos?: THREE.Vector3): void {
		// Swarm centroid (local)
		let cx = 0;
		let cz = 0;
		for (const p of this.people) {
			cx += p.x;
			cz += p.z;
		}
		const n = Math.max(1, this.people.length);
		cx /= n;
		cz /= n;
		// Soft pull swarm toward player when nearby (zombie mall brains)
		let attractX = cx;
		let attractZ = cz;
		if (playerPos && playerPos.y < 4.5) {
			const pwx = playerPos.x - this.pos.x;
			const pwz = playerPos.z - this.pos.z;
			const pd = Math.hypot(pwx - cx, pwz - cz);
			if (pd < 22) {
				const w = 0.35 * (1 - pd / 22);
				attractX = cx * (1 - w) + pwx * w;
				attractZ = cz * (1 - w) + pwz * w;
			}
		}

		for (let i = 0; i < this.people.length; i++) {
			const p = this.people[i];
			p.retargetCd -= dt;
			if (p.retargetCd <= 0) {
				p.retargetCd = 2.5 + Math.random() * 4;
				// New wander near attractor / camp with wide mall radius
				const ang = Math.random() * Math.PI * 2;
				const rad = 3 + Math.random() * 14;
				p.tx = attractX + Math.cos(ang) * rad + (Math.random() - 0.5) * 4;
				p.tz = attractZ + Math.sin(ang) * rad + (Math.random() - 0.5) * 4;
				// Clamp roam box (local to camp)
				p.tx = THREE.MathUtils.clamp(p.tx, -26, 28);
				p.tz = THREE.MathUtils.clamp(p.tz, -18, 22);
			}

			// Desired velocity: wander + cohesion
			let dx = p.tx - p.x;
			let dz = p.tz - p.z;
			const toT = Math.hypot(dx, dz) || 1;
			dx = (dx / toT) * p.speed;
			dz = (dz / toT) * p.speed;
			// Cohesion
			dx += (attractX - p.x) * 0.35;
			dz += (attractZ - p.z) * 0.35;
			// Separation (don't stack like tofu)
			for (let j = 0; j < this.people.length; j++) {
				if (j === i) continue;
				const o = this.people[j];
				const sx = p.x - o.x;
				const sz = p.z - o.z;
				const d = Math.hypot(sx, sz);
				const minD = p.isMerkel || o.isMerkel ? 1.4 : 0.95;
				if (d > 0.01 && d < minD) {
					const push = ((minD - d) / minD) * 1.8;
					dx += (sx / d) * push;
					dz += (sz / d) * push;
				}
			}

			// Integrate with drag
			p.vx = THREE.MathUtils.lerp(p.vx, dx, Math.min(1, dt * 2.2));
			p.vz = THREE.MathUtils.lerp(p.vz, dz, Math.min(1, dt * 2.2));
			const sp = Math.hypot(p.vx, p.vz);
			const maxSp = p.speed * (p.isMerkel ? 0.75 : 1.15);
			if (sp > maxSp) {
				p.vx = (p.vx / sp) * maxSp;
				p.vz = (p.vz / sp) * maxSp;
			}

			let nx = p.x + p.vx * dt;
			let nz = p.z + p.vz * dt;
			// World collision
			const wx = this.pos.x + nx;
			const wz = this.pos.z + nz;
			const hitR = p.isMerkel ? 0.55 : 0.35;
			const solved = this.world.resolveCircle(wx, wz, 0.5, hitR, 3, true);
			nx = solved.x - this.pos.x;
			nz = solved.z - this.pos.z;
			p.x = nx;
			p.z = nz;

			// Face move dir (zombie shuffle)
			const face = Math.hypot(p.vx, p.vz);
			if (face > 0.05) {
				const yaw = Math.atan2(p.vx, p.vz);
				let dy = yaw - p.root.rotation.y;
				while (dy > Math.PI) dy -= Math.PI * 2;
				while (dy < -Math.PI) dy += Math.PI * 2;
				p.root.rotation.y += dy * Math.min(1, dt * 4);
			}

			p.legPhase += dt * (4 + face * 3);
			const march = Math.sin(p.legPhase + p.phase);
			const bob = Math.abs(march) * (p.isMerkel ? 0.05 : 0.09);
			p.root.position.set(p.x, bob, p.z);
			p.root.rotation.z = Math.sin(p.legPhase * 0.5) * 0.04;

			// Props
			p.sign.rotation.z = Math.sin(this.t * 2.4 + p.phase) * (p.isMerkel ? 0.1 : 0.22);
			p.sign.rotation.x = Math.sin(this.t * 1.8 + p.phase * 0.5) * 0.1;
			if (p.fist) {
				const baseY = p.isMerkel ? 1.75 : 1.55;
				p.fist.position.y = baseY + Math.max(0, march) * 0.2;
				p.fist.rotation.z = -0.4 - Math.max(0, march) * 0.5;
			}
			if (p.flag) {
				p.flag.rotation.y = Math.sin(this.t * 2.8 + p.phase) * 0.4;
				p.flag.rotation.z = Math.sin(this.t * 3.1 + p.phase * 0.6) * 0.15;
			}

			if (p.speechLife > 0) {
				p.speechLife -= dt;
				if (p.speechLife <= 0) p.speech.visible = false;
			}
		}
	}

	dispose(): void {
		this.stopAudio?.();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildBanner(): void {
		const pole = this.track(
			new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 }),
		);
		const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6), pole);
		pL.position.set(-1.6, 1.3, -1.8);
		const pR = pL.clone();
		pR.position.x = 1.6;
		this.group.add(pL, pR);

		const c = document.createElement('canvas');
		c.width = 768;
		c.height = 192;
		const ctx = c.getContext('2d')!;
		// Progress pride stripe base
		const cols = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
		for (let i = 0; i < 6; i++) {
			ctx.fillStyle = cols[i];
			ctx.fillRect(0, (i * 192) / 6, 768, 192 / 6 + 1);
		}
		// chevron suggestion
		ctx.fillStyle = '#000';
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(120, 96);
		ctx.lineTo(0, 192);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#784F17';
		ctx.beginPath();
		ctx.moveTo(0, 20);
		ctx.lineTo(90, 96);
		ctx.lineTo(0, 172);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = 'rgba(0,0,0,0.5)';
		ctx.fillRect(140, 28, 600, 136);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 48px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('WIR SCHAFFEN DAS', 440, 82);
		ctx.font = 'bold 24px system-ui';
		ctx.fillText('ANGELA + LGBTQIA+ PROTEST GROUPIES', 440, 128);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		this.banner = new THREE.Mesh(
			new THREE.PlaneGeometry(3.4, 0.85),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		this.banner.position.set(0, 2.35, -1.8);
		this.group.add(this.banner);

		const ring = new THREE.Mesh(
			new THREE.RingGeometry(2.6, 2.75, 32),
			this.track(
				new THREE.MeshBasicMaterial({
					color: 0xffeb3b,
					side: THREE.DoubleSide,
					transparent: true,
					opacity: 0.55,
				}),
			),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.03;
		this.group.add(ring);
	}

	/** Tall pride flag poles around the picket */
	private buildPlantedFlags(): void {
		const kinds: FlagKind[] = [
			'progress',
			'rainbow',
			'trans',
			'bi',
			'lesbian',
			'nb',
			'pan',
			'intersex',
			'progress',
			'rainbow',
		];
		for (let i = 0; i < kinds.length; i++) {
			const ang = (i / kinds.length) * Math.PI * 2;
			const r = 2.85;
			const g = this.makeFlagPole(kinds[i], 1.55 + (i % 3) * 0.08);
			g.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
			g.rotation.y = ang + Math.PI;
			this.group.add(g);
			this.plantedFlags.push(g);
		}
	}

	private makeFlagPole(kind: FlagKind, height = 1.6): THREE.Group {
		const g = new THREE.Group();
		const poleMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xb0bec5,
				metalness: 0.55,
				roughness: 0.4,
			}),
		);
		const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, height, 6), poleMat);
		pole.position.y = height / 2;
		g.add(pole);
		const ball = new THREE.Mesh(
			new THREE.SphereGeometry(0.05, 8, 8),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xffd700,
					metalness: 0.8,
					roughness: 0.3,
				}),
			),
		);
		ball.position.y = height + 0.04;
		g.add(ball);

		const tex = this.makePrideFlagTex(kind);
		const cloth = new THREE.Mesh(
			new THREE.PlaneGeometry(0.72, 0.48),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		cloth.position.set(0.38, height - 0.28, 0);
		g.add(cloth);
		g.userData.cloth = cloth;
		return g;
	}

	/** Small handheld pride flag for groupies */
	private makeHandFlag(kind: FlagKind): THREE.Group {
		const g = new THREE.Group();
		const stick = new THREE.Mesh(
			new THREE.CylinderGeometry(0.015, 0.018, 0.7, 5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 })),
		);
		stick.position.y = 0.35;
		g.add(stick);
		const cloth = new THREE.Mesh(
			new THREE.PlaneGeometry(0.38, 0.26),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makePrideFlagTex(kind),
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		cloth.position.set(0.2, 0.62, 0);
		g.add(cloth);
		g.userData.cloth = cloth;
		return g;
	}

	private makePrideFlagTex(kind: FlagKind): THREE.CanvasTexture {
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 160;
		const ctx = c.getContext('2d')!;

		const stripes = (cols: string[]) => {
			const h = 160 / cols.length;
			for (let i = 0; i < cols.length; i++) {
				ctx.fillStyle = cols[i];
				ctx.fillRect(0, i * h, 256, h + 1);
			}
		};

		if (kind === 'rainbow') {
			stripes(['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982']);
		} else if (kind === 'progress') {
			stripes(['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982']);
			// chevrons: black, brown, light blue, pink, white
			const chev = ['#000000', '#784F17', '#5BCEFA', '#F5A9B8', '#FFFFFF'];
			for (let i = 0; i < chev.length; i++) {
				const x = 8 + i * 22;
				ctx.fillStyle = chev[i];
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.lineTo(x + 40, 80);
				ctx.lineTo(0, 160);
				ctx.lineTo(0, 0);
				// only draw the outer edge band by clipping with previous — simple layered triangles
				ctx.closePath();
				ctx.fill();
			}
			// re-draw outer black tip cleanly
			ctx.fillStyle = '#000';
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(28, 80);
			ctx.lineTo(0, 160);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#784F17';
			ctx.beginPath();
			ctx.moveTo(0, 18);
			ctx.lineTo(48, 80);
			ctx.lineTo(0, 142);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#5BCEFA';
			ctx.beginPath();
			ctx.moveTo(0, 36);
			ctx.lineTo(68, 80);
			ctx.lineTo(0, 124);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#F5A9B8';
			ctx.beginPath();
			ctx.moveTo(0, 52);
			ctx.lineTo(88, 80);
			ctx.lineTo(0, 108);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#FFFFFF';
			ctx.beginPath();
			ctx.moveTo(0, 64);
			ctx.lineTo(108, 80);
			ctx.lineTo(0, 96);
			ctx.closePath();
			ctx.fill();
		} else if (kind === 'trans') {
			stripes(['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA']);
		} else if (kind === 'bi') {
			stripes(['#D60270', '#D60270', '#9B4F96', '#0038A8', '#0038A8']);
		} else if (kind === 'lesbian') {
			stripes(['#D52D00', '#EF7627', '#FF9A56', '#FFFFFF', '#D162A4', '#B55690', '#A30262']);
		} else if (kind === 'nb') {
			stripes(['#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C']);
		} else if (kind === 'pan') {
			stripes(['#FF218C', '#FFD800', '#21B1FF']);
		} else {
			// intersex
			ctx.fillStyle = '#FFD800';
			ctx.fillRect(0, 0, 256, 160);
			ctx.strokeStyle = '#7902aa';
			ctx.lineWidth = 14;
			ctx.beginPath();
			ctx.arc(128, 80, 42, 0, Math.PI * 2);
			ctx.stroke();
		}

		// thin border
		ctx.strokeStyle = 'rgba(0,0,0,0.35)';
		ctx.lineWidth = 4;
		ctx.strokeRect(2, 2, 252, 156);

		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}

	/**
	 * Angela Merkel — older, thick Mutti in navy pantsuit,
	 * signature blonde bowl cut, pearls, "Wir schaffen das".
	 */
	private buildMerkel(): void {
		const root = new THREE.Group();
		const base = new THREE.Vector3(0, 0, 1.2); // floor — joins the zombie shuffle
		root.position.copy(base);

		// Soft older skin
		const skin = this.track(
			new THREE.MeshStandardMaterial({ color: 0xe8c4a8, roughness: 0.9 }),
		);
		const suit = this.track(
			new THREE.MeshStandardMaterial({ color: 0x1a237e, roughness: 0.75 }),
		);
		const suitPants = this.track(
			new THREE.MeshStandardMaterial({ color: 0x0d1545, roughness: 0.8 }),
		);
		const blouse = this.track(
			new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 }),
		);
		const hairM = this.track(
			new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.85 }),
		);
		const pearl = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xfff8e7,
				metalness: 0.35,
				roughness: 0.25,
			}),
		);

		// Short thick legs
		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 8), suitPants);
		const legR = legL.clone();
		legL.position.set(-0.16, 0.35, 0.02);
		legR.position.set(0.16, 0.35, 0.02);
		root.add(legL, legR);

		// Wide hips / belly — "net zo oud en dik"
		const hips = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), suitPants);
		hips.scale.set(1.25, 0.7, 0.95);
		hips.position.set(0, 0.72, 0.05);
		root.add(hips);

		const belly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 14), suit);
		belly.scale.set(1.2, 0.95, 1.05);
		belly.position.set(0, 1.15, 0.12);
		root.add(belly);

		// Soft upper bulk
		const chest = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), suit);
		chest.scale.set(1.15, 0.75, 0.9);
		chest.position.set(0, 1.55, 0.06);
		root.add(chest);

		// White blouse peek
		const collar = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), blouse);
		collar.scale.set(1.1, 0.55, 0.8);
		collar.position.set(0, 1.72, 0.14);
		root.add(collar);

		// Head — slightly fuller, older
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skin);
		head.position.set(0, 2.05, 0.04);
		root.add(head);

		// Signature Merkel bowl cut (blonde, short, rounded)
		const bowl = new THREE.Mesh(
			new THREE.SphereGeometry(0.24, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
			hairM,
		);
		bowl.position.set(0, 2.12, -0.01);
		root.add(bowl);
		// Side volume
		const sideL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), hairM);
		sideL.scale.set(0.7, 1.1, 0.9);
		sideL.position.set(-0.2, 2.02, 0.02);
		const sideR = sideL.clone();
		sideR.position.x = 0.2;
		root.add(sideL, sideR);
		// Fringe
		const fringe = new THREE.Mesh(
			new THREE.BoxGeometry(0.32, 0.08, 0.08),
			hairM,
		);
		fringe.position.set(0, 2.12, 0.18);
		root.add(fringe);

		// Simple face
		const eyeM = this.track(new THREE.MeshBasicMaterial({ color: 0x2c1810 }));
		const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeM);
		const eyeR = eyeL.clone();
		eyeL.position.set(-0.07, 2.08, 0.2);
		eyeR.position.set(0.07, 2.08, 0.2);
		root.add(eyeL, eyeR);
		// Soft smile
		const mouth = new THREE.Mesh(
			new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI),
			eyeM,
		);
		mouth.position.set(0, 1.96, 0.2);
		mouth.rotation.x = 0.3;
		root.add(mouth);

		// Pearl necklace
		for (let i = 0; i < 9; i++) {
			const a = -0.7 + (i / 8) * 1.4;
			const bead = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), pearl);
			bead.position.set(Math.sin(a) * 0.2, 1.78 + Math.cos(a) * 0.04, 0.22 + Math.cos(a) * 0.06);
			root.add(bead);
		}

		// Right hand raised (Mutti wave / fist-ish)
		const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 6), suit);
		arm.position.set(0.45, 1.55, 0.1);
		arm.rotation.z = -0.85;
		root.add(arm);
		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), skin);
		hand.position.set(0.62, 1.82, 0.12);
		root.add(hand);

		// Left hand holds progress pride mini-flag
		const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.38, 4, 6), suit);
		armL.position.set(-0.42, 1.4, 0.15);
		armL.rotation.z = 0.5;
		armL.rotation.x = -0.4;
		root.add(armL);
		const flag = this.makeHandFlag('progress');
		flag.position.set(-0.55, 1.15, 0.25);
		flag.rotation.z = 0.2;
		root.add(flag);

		// Sign: WIR SCHAFFEN DAS
		const stick = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.03, 1.0, 5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 })),
		);
		stick.position.set(0.35, 1.55, 0.35);
		root.add(stick);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(0.95, 0.55),
			this.track(
				new THREE.MeshBasicMaterial({
					map: this.makeSignTex(['WIR SCHAFFEN', 'DAS 🇩🇪'], 0),
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		sign.position.set(0.35, 2.2, 0.35);
		root.add(sign);

		// Name plate
		const nameSp = this.makeTextSprite('ANGELA MERKEL · Mutti', '#1a237e', 220, 44);
		nameSp.position.set(0, 2.45, 0.1);
		nameSp.scale.set(1.6, 0.32, 1);
		root.add(nameSp);

		// Speech bubble
		const sc = document.createElement('canvas');
		sc.width = 360;
		sc.height = 90;
		const speechCtx = sc.getContext('2d')!;
		const speechTex = new THREE.CanvasTexture(sc);
		speechTex.colorSpace = THREE.SRGBColorSpace;
		const speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: speechTex,
				transparent: true,
				depthTest: false,
			}),
		);
		speech.scale.set(2.4, 0.6, 1);
		speech.position.set(0, 2.75, 0);
		speech.visible = false;
		root.add(speech);

		// Abandoned crate at camp (Mutti left the stage)
		const crate = new THREE.Mesh(
			new THREE.BoxGeometry(0.9, 0.38, 0.75),
			this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.85 })),
		);
		crate.position.set(0, 0.19, 0.4);
		this.group.add(crate);

		// German flag mini at camp
		const de = this.makeDeFlagPole();
		de.position.set(0.7, 0, 0.5);
		this.group.add(de);
		this.plantedFlags.push(de);

		this.group.add(root);
		this.merkelIdx = this.people.length;
		this.people.push({
			root,
			x: base.x,
			z: base.z,
			vx: 0,
			vz: 0,
			tx: base.x + 2,
			tz: base.z + 2,
			speed: 0.85,
			retargetCd: 1,
			phase: 0.2,
			sign,
			speech,
			speechTex,
			speechCtx,
			speechLife: 0,
			fist: hand,
			flag,
			isMerkel: true,
			lineIdx: -1,
			legPhase: 0,
		});
	}

	private makeDeFlagPole(): THREE.Group {
		const g = new THREE.Group();
		const pole = new THREE.Mesh(
			new THREE.CylinderGeometry(0.025, 0.03, 1.7, 6),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xb0bec5,
					metalness: 0.5,
					roughness: 0.4,
				}),
			),
		);
		pole.position.y = 0.85;
		g.add(pole);
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 160;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, 256, 53);
		ctx.fillStyle = '#DD0000';
		ctx.fillRect(0, 53, 256, 54);
		ctx.fillStyle = '#FFCE00';
		ctx.fillRect(0, 107, 256, 53);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const cloth = new THREE.Mesh(
			new THREE.PlaneGeometry(0.7, 0.44),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		cloth.position.set(0.38, 1.4, 0);
		g.add(cloth);
		g.userData.cloth = cloth;
		return g;
	}

	private buildMegaphoneStand(): void {
		const mega = new THREE.Mesh(
			new THREE.ConeGeometry(0.16, 0.38, 10),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xffeb3b,
					metalness: 0.3,
					roughness: 0.45,
				}),
			),
		);
		mega.rotation.z = Math.PI / 2;
		mega.position.set(0.55, 0.95, 1.55);
		this.group.add(mega);
	}

	private buildCrowd(n: number): void {
		const skins = [0xf5c9a8, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac];
		const tops = [
			0x1565c0,
			0x2e7d32,
			0x6a1b9a,
			0xc62828,
			0xffeb3b,
			0x00897b,
			0xec407a,
			0xffffff,
		];
		const hairs = [0x2c1810, 0xc4a35a, 0x111111, 0xd35400, 0xf5f5f5, 0x4a148c];
		const handFlags: FlagKind[] = [
			'progress',
			'trans',
			'rainbow',
			'bi',
			'lesbian',
			'nb',
			'pan',
			'intersex',
		];

		for (let i = 0; i < n; i++) {
			const ang = (i / n) * Math.PI * 1.7 + 0.15;
			const r = 1.65 + (i % 3) * 0.35;
			const bx = Math.sin(ang) * r;
			const bz = Math.cos(ang) * r * 0.85 - 0.2;
			const root = new THREE.Group();
			root.position.set(bx, 0, bz);

			const skin = this.track(
				new THREE.MeshStandardMaterial({ color: skins[i % skins.length], roughness: 0.85 }),
			);
			const shirt = this.track(
				new THREE.MeshStandardMaterial({ color: tops[i % tops.length], roughness: 0.7 }),
			);
			const pants = this.track(
				new THREE.MeshStandardMaterial({
					color: i % 2 === 0 ? 0x37474f : 0x5d4037,
					roughness: 0.85,
				}),
			);
			const hairM = this.track(
				new THREE.MeshStandardMaterial({
					color: hairs[i % hairs.length],
					roughness: 0.9,
				}),
			);

			const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 3, 6), pants);
			const legR = legL.clone();
			legL.position.set(-0.1, 0.42, 0);
			legR.position.set(0.1, 0.42, 0);
			root.add(legL, legR);

			const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 8), shirt);
			body.position.y = 1.05;
			root.add(body);

			const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), skin);
			head.position.y = 1.65;
			root.add(head);

			if (i % 3 === 0) {
				const bun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), hairM);
				bun.position.set(0, 1.82, -0.05);
				root.add(bun);
			}
			const hair = new THREE.Mesh(
				new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
				hairM,
			);
			hair.position.set(0, 1.72, -0.02);
			root.add(hair);

			// Pride scarf / lanyard rainbow torus
			const scarf = new THREE.Mesh(
				new THREE.TorusGeometry(0.14, 0.035, 6, 12),
				this.track(
					new THREE.MeshStandardMaterial({
						color: [0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x24408e, 0x732982][i % 6],
						roughness: 0.8,
					}),
				),
			);
			scarf.position.set(0, 1.42, 0.05);
			scarf.rotation.x = Math.PI / 2.4;
			root.add(scarf);

			let fist: THREE.Object3D | undefined;
			let flag: THREE.Object3D | undefined;
			if (i % 2 === 0) {
				const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.35, 3, 5), skin);
				arm.position.set(0.28, 1.45, 0.05);
				arm.rotation.z = -0.9;
				root.add(arm);
				const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), skin);
				hand.position.set(0.42, 1.7, 0.08);
				root.add(hand);
				fist = hand;
			} else {
				// Hand flag instead of fist
				const hf = this.makeHandFlag(handFlags[i % handFlags.length]);
				hf.position.set(0.35, 1.15, 0.15);
				root.add(hf);
				flag = hf;
			}

			// Cardboard sign
			const stick = new THREE.Mesh(
				new THREE.CylinderGeometry(0.02, 0.025, 1.1, 5),
				this.track(new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 })),
			);
			stick.position.set(-0.32, 1.35, 0.2);
			root.add(stick);

			const sign = new THREE.Mesh(
				new THREE.PlaneGeometry(0.7, 0.48),
				this.track(
					new THREE.MeshBasicMaterial({
						map: this.makeSignTex(SIGN_LINES[i % SIGN_LINES.length], i),
						side: THREE.DoubleSide,
						toneMapped: false,
					}),
				),
			);
			sign.position.set(-0.32, 2.0, 0.2);
			root.add(sign);

			// Mini pride flag pin on chest
			const pin = new THREE.Mesh(
				new THREE.PlaneGeometry(0.12, 0.08),
				this.track(
					new THREE.MeshBasicMaterial({
						map: this.makePrideFlagTex(handFlags[(i + 2) % handFlags.length]),
						side: THREE.DoubleSide,
						toneMapped: false,
					}),
				),
			);
			pin.position.set(0.12, 1.25, 0.24);
			root.add(pin);

			const sc = document.createElement('canvas');
			sc.width = 320;
			sc.height = 80;
			const speechCtx = sc.getContext('2d')!;
			const speechTex = new THREE.CanvasTexture(sc);
			speechTex.colorSpace = THREE.SRGBColorSpace;
			const speech = new THREE.Sprite(
				new THREE.SpriteMaterial({
					map: speechTex,
					transparent: true,
					depthTest: false,
				}),
			);
			speech.scale.set(1.9, 0.48, 1);
			speech.position.set(0, 2.35, 0);
			speech.visible = false;
			root.add(speech);

			const tag = this.makeNameTag(i);
			tag.position.set(0, 1.95, 0.12);
			root.add(tag);

			this.group.add(root);
			this.people.push({
				root,
				x: bx,
				z: bz,
				vx: 0,
				vz: 0,
				tx: bx + (Math.random() - 0.5) * 6,
				tz: bz + (Math.random() - 0.5) * 6,
				speed: 1.05 + Math.random() * 0.55,
				retargetCd: Math.random() * 2,
				phase: i * 0.9 + 0.5,
				sign,
				speech,
				speechTex,
				speechCtx,
				speechLife: 0,
				fist,
				flag,
				lineIdx: i,
				legPhase: Math.random() * 10,
			});
		}
	}

	private makeSignTex(lines: [string, string], seed: number): THREE.CanvasTexture {
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 176;
		const ctx = c.getContext('2d')!;
		const bgs = ['#ffffff', '#fff59d', '#e3f2fd', '#f3e5f5', '#e8f5e9'];
		ctx.fillStyle = bgs[seed % bgs.length];
		ctx.fillRect(0, 0, 256, 176);
		ctx.strokeStyle = '#212121';
		ctx.lineWidth = 6;
		ctx.strokeRect(4, 4, 248, 168);
		const cols = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
		for (let i = 0; i < 6; i++) {
			ctx.fillStyle = cols[i];
			ctx.fillRect(10 + i * 39, 12, 36, 10);
		}
		ctx.fillStyle = '#111';
		ctx.textAlign = 'center';
		ctx.font = 'bold 30px system-ui';
		ctx.fillText(lines[0], 128, 90);
		ctx.font = 'bold 34px system-ui';
		ctx.fillText(lines[1], 128, 140);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}

	private makeNameTag(i: number): THREE.Sprite {
		const names = ['Greta-fan', 'Lena', 'Jonas', 'Sophie', 'Kai', 'Mila', 'Noah', 'Emma'];
		return this.makeTextSprite(names[i % names.length], 'rgba(30,80,180,0.9)', 160, 40);
	}

	private makeTextSprite(text: string, bg: string, w: number, h: number): THREE.Sprite {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = bg.startsWith('#') || bg.startsWith('rgb') ? bg : bg;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#fff';
		ctx.font = `bold ${Math.floor(h * 0.4)}px system-ui`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sp = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
		);
		sp.scale.set(0.85, 0.22, 1);
		return sp;
	}

	private showBubble(p: Protester, text: string, merkel = false): void {
		const ctx = p.speechCtx;
		const w = merkel ? 360 : 320;
		const h = merkel ? 90 : 80;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = merkel ? 'rgba(26,35,126,0.95)' : 'rgba(255,255,255,0.95)';
		ctx.strokeStyle = merkel ? '#ffd700' : '#1565c0';
		ctx.lineWidth = 4;
		roundRect(ctx, 8, 6, w - 16, h - 20, 12);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(w * 0.45, h - 14);
		ctx.lineTo(w * 0.5, h - 2);
		ctx.lineTo(w * 0.55, h - 14);
		ctx.closePath();
		ctx.fillStyle = merkel ? 'rgba(26,35,126,0.95)' : 'rgba(255,255,255,0.95)';
		ctx.fill();
		ctx.stroke();

		ctx.fillStyle = merkel ? '#ffeb3b' : '#0d47a1';
		ctx.font = merkel ? 'bold 24px system-ui' : 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2 - 6);

		p.speechTex.needsUpdate = true;
		p.speech.visible = true;
		p.speechLife = merkel ? 3.2 : 2.4 + Math.random() * 0.8;
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
