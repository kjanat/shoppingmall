import * as THREE from 'three';
import { spatial } from '../audio/SpatialAudio';

/** Chant lines shown above everyone in the room */
const CHANTS = [
	'Allahu Akbar!',
	'Allahu Akbar!!',
	'الله أكبر',
	'Allahu Trapbar!',
	'ALLAHU AKBAR',
];

/** Allahu Trapbar clean instrumental (same track family as YT XoX5cxsN5-U) */
const TRAPBAR_URL = '/prayer-music/allahu_trapbar.mp3';

/**
 * Gebedsruimte — Allahu Trapbar loop + full-room chants + sacrificial goat mascot.
 * Spatial falloff so the rest of the mall only hears a soft murmur.
 */
export class PrayerRoom {
	readonly group = new THREE.Group();
	readonly pos = new THREE.Vector3(-31.5, 0, -19.5);
	private materials: THREE.Material[] = [];
	private audioStarted = false;
	private stopAudio: (() => void) | null = null;
	private ayatollahs: THREE.Group[] = [];
	private goat: THREE.Group | null = null;
	private t = 0;
	private chantCd = 1.2;
	private bleatCd = 3.5;

	constructor() {
		this.group.name = 'prayerRoom';
		this.group.position.copy(this.pos);
		this.build();
		this.buildAyatollahs();
		this.buildGoat();
	}

	/** Wall AABBs for CollisionWorld — back + sides solid, south face open. */
	getColliders(): { minX: number; maxX: number; minZ: number; maxZ: number; label: string }[] {
		const cx = this.pos.x;
		const cz = this.pos.z;
		return [
			{ minX: cx - 2.85, maxX: cx + 2.85, minZ: cz - 2.2, maxZ: cz - 1.85, label: 'prayer_back' },
			{ minX: cx - 2.85, maxX: cx - 2.55, minZ: cz - 2.2, maxZ: cz + 2.1, label: 'prayer_w' },
			{ minX: cx + 2.55, maxX: cx + 2.85, minZ: cz - 2.2, maxZ: cz + 2.1, label: 'prayer_e' },
		];
	}

	/** Call after user gesture so AudioContext unlocks */
	ensureAudio(): void {
		if (this.audioStarted) return;
		this.audioStarted = true;

		const stoppers: Array<() => void> = [];

		// ── Allahu Trapbar (looped mp3, spatial) ──
		void spatial
			.playAt(
				TRAPBAR_URL,
				{ x: this.pos.x, y: 1.4, z: this.pos.z },
				{ volume: 0.78, k: 0.038, maxDistance: 28, loop: true },
			)
			.then((src) => {
				if (src) stoppers.push(() => src.stop());
			});

		// Soft crowd chants under the trap beat
		const chants = spatial.startLoopAt(
			{ x: this.pos.x, y: 1.3, z: this.pos.z },
			(ctx, dest) => startAllahuLoop(ctx, dest),
			{ volume: 0.28, k: 0.05, maxDistance: 20 },
		);
		stoppers.push(() => chants.stop());

		this.stopAudio = () => {
			for (const s of stoppers) s();
		};
	}

	update(dt: number, listener: THREE.Vector3): void {
		void listener;
		this.t += dt;
		this.chantCd -= dt;
		this.bleatCd -= dt;

		for (let i = 0; i < this.ayatollahs.length; i++) {
			const a = this.ayatollahs[i];
			const phase = (a.userData.phase as number) ?? i;
			a.position.y = (a.userData.baseY as number) + Math.sin(this.t * 1.1 + phase) * 0.012;
			if (a.userData.bow) {
				const bow = Math.sin(this.t * 0.55 + phase) * 0.08;
				a.rotation.x = 0.15 + Math.max(0, bow);
			}
			// Bubble lifetime
			const life = a.userData.speechLife as number;
			if (life > 0) {
				a.userData.speechLife = life - dt;
				if (a.userData.speechLife <= 0) {
					const sp = a.userData.speech as THREE.Sprite | undefined;
					if (sp) sp.visible = false;
				}
			}
		}

		// Goat idle: head bob + occasional bleat bubble
		if (this.goat) {
			const head = this.goat.userData.head as THREE.Object3D | undefined;
			if (head) {
				head.rotation.x = Math.sin(this.t * 2.4) * 0.12;
				head.rotation.y = Math.sin(this.t * 0.7) * 0.18;
			}
			this.goat.position.y =
				(this.goat.userData.baseY as number) + Math.sin(this.t * 3.2) * 0.01;
			const life = this.goat.userData.speechLife as number;
			if (life > 0) {
				this.goat.userData.speechLife = life - dt;
				if (this.goat.userData.speechLife <= 0) {
					const sp = this.goat.userData.speech as THREE.Sprite | undefined;
					if (sp) sp.visible = false;
				}
			}
			if (this.bleatCd <= 0) {
				this.bleatCd = 4 + Math.random() * 5;
				const lines = ['MEEEH', 'Mèèèh!', '🐐', 'Allahu… mèèh', 'Trapbar!!'];
				this.showBubble(
					this.goat,
					lines[Math.floor(Math.random() * lines.length)],
				);
			}
		}

		// Everyone chants — staggered bubbles so the room is full of Allahu Akbar
		if (this.chantCd <= 0) {
			this.chantCd = 0.55 + Math.random() * 0.75;
			const n = Math.min(
				this.ayatollahs.length,
				2 + Math.floor(Math.random() * this.ayatollahs.length),
			);
			const order = this.ayatollahs
				.map((_, i) => i)
				.sort(() => Math.random() - 0.5)
				.slice(0, n);
			for (let k = 0; k < order.length; k++) {
				const a = this.ayatollahs[order[k]];
				const line = CHANTS[Math.floor(Math.random() * CHANTS.length)];
				// slight stagger so they cascade
				window.setTimeout(() => this.showBubble(a, line), k * 90);
			}
		}
	}

	dispose(): void {
		this.stopAudio?.();
	}

	private showBubble(fig: THREE.Group, text: string): void {
		const sp = fig.userData.speech as THREE.Sprite | undefined;
		const ctx = fig.userData.speechCtx as CanvasRenderingContext2D | undefined;
		const tex = fig.userData.speechTex as THREE.CanvasTexture | undefined;
		if (!sp || !ctx || !tex) return;
		const w = 320;
		const h = 80;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = 'rgba(27,94,32,0.94)';
		ctx.strokeStyle = '#ffd700';
		ctx.lineWidth = 5;
		roundRect(ctx, 8, 4, w - 16, h - 18, 12);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(w * 0.45, h - 14);
		ctx.lineTo(w * 0.5, h - 2);
		ctx.lineTo(w * 0.55, h - 14);
		ctx.closePath();
		ctx.fillStyle = 'rgba(27,94,32,0.94)';
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#fffde7';
		ctx.font = 'bold 26px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2 - 6);
		tex.needsUpdate = true;
		sp.visible = true;
		fig.userData.speechLife = 2.2 + Math.random() * 0.9;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private build(): void {
		// Small quiet room shell
		const wall = this.track(
			new THREE.MeshStandardMaterial({ color: 0xe8e4d9, roughness: 0.9 }),
		);
		const floor = new THREE.Mesh(
			new THREE.BoxGeometry(5.5, 0.08, 4.2),
			this.track(new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.85 })),
		);
		floor.position.y = 0.04;
		this.group.add(floor);

		// three walls (open to mall corridor on +X toward center)
		const back = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 0.15), wall);
		back.position.set(0, 1.6, -2.0);
		this.group.add(back);
		const left = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 4.2), wall);
		left.position.set(-2.7, 1.6, 0);
		this.group.add(left);
		const right = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 4.2), wall);
		right.position.set(2.7, 1.6, 0);
		this.group.add(right);

		// green carpet strip
		const carpet = new THREE.Mesh(
			new THREE.BoxGeometry(4.2, 0.03, 2.8),
			this.track(new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.95 })),
		);
		carpet.position.set(0, 0.1, -0.2);
		this.group.add(carpet);

		// prayer mats (enough for the ayatollahs)
		for (let i = 0; i < 4; i++) {
			const mat = new THREE.Mesh(
				new THREE.BoxGeometry(0.85, 0.02, 1.35),
				this.track(new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 })),
			);
			mat.position.set(-1.45 + i * 0.95, 0.12, -0.35);
			this.group.add(mat);
		}

		// soft lamp
		const lamp = new THREE.PointLight(0xffe0b2, 6, 8, 2);
		lamp.position.set(0, 2.6, 0);
		this.group.add(lamp);

		// sign
		const c = document.createElement('canvas');
		c.width = 320;
		c.height = 96;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#1b5e20';
		ctx.fillRect(0, 0, 320, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 26px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('GEBEDSRUIMTE', 160, 40);
		ctx.font = '13px system-ui';
		ctx.fillText('Allahu Trapbar · geit · wudu ernaast', 160, 70);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(2.2, 0.65),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, 2.8, 2.15);
		this.group.add(sign);
	}

	/**
	 * Eervolle ayatollahs + congregants — all chant Allahu Akbar.
	 */
	private buildAyatollahs(): void {
		const roster: {
			name: string;
			title: string;
			x: number;
			z: number;
			yaw: number;
			turban: number;
			bow: boolean;
		}[] = [
			{
				name: 'Ayatollah Karim',
				title: 'Eervol · imam',
				x: -1.4,
				z: -0.45,
				yaw: 0,
				turban: 0x111111,
				bow: true,
			},
			{
				name: 'Ayatollah Hassan',
				title: 'Eervol · wijsheid',
				x: -0.35,
				z: -0.4,
				yaw: 0.08,
				turban: 0xf5f5f5,
				bow: true,
			},
			{
				name: 'Ayatollah Nouri',
				title: 'Eervol · sabr',
				x: 0.7,
				z: -0.5,
				yaw: -0.06,
				turban: 0x1a1a1a,
				bow: false,
			},
			{
				name: 'Ayatollah Reza',
				title: 'Eervol · respect',
				x: 1.55,
				z: -0.35,
				yaw: 0.04,
				turban: 0xeeeeee,
				bow: true,
			},
			// Extra congregants — full room chant
			{
				name: 'Broeder Yusuf',
				title: 'Gemeente',
				x: -1.6,
				z: 0.85,
				yaw: 0.1,
				turban: 0x2e7d32,
				bow: true,
			},
			{
				name: 'Broeder Ali',
				title: 'Gemeente',
				x: -0.5,
				z: 0.95,
				yaw: -0.05,
				turban: 0x1565c0,
				bow: true,
			},
			{
				name: 'Broeder Omar',
				title: 'Gemeente',
				x: 0.65,
				z: 0.9,
				yaw: 0.12,
				turban: 0x6a1b9a,
				bow: false,
			},
			{
				name: 'Broeder Ibrahim',
				title: 'Gemeente',
				x: 1.65,
				z: 0.8,
				yaw: -0.08,
				turban: 0xbf360c,
				bow: true,
			},
		];

		// More mats for the back row
		for (let i = 0; i < 4; i++) {
			const mat = new THREE.Mesh(
				new THREE.BoxGeometry(0.85, 0.02, 1.15),
				this.track(new THREE.MeshStandardMaterial({ color: 0x33691e, roughness: 0.9 })),
			);
			mat.position.set(-1.55 + i * 1.0, 0.12, 0.95);
			this.group.add(mat);
		}

		for (let i = 0; i < roster.length; i++) {
			const r = roster[i];
			const fig = this.makeAyatollah(r.name, r.title, r.turban);
			fig.position.set(r.x, 0.12, r.z);
			fig.rotation.y = r.yaw;
			fig.userData.baseY = 0.12;
			fig.userData.phase = i * 1.3;
			fig.userData.bow = r.bow;
			this.group.add(fig);
			this.ayatollahs.push(fig);
		}
	}

	/** Low-poly goat standing in front of the ayatollah row */
	private buildGoat(): void {
		const g = new THREE.Group();
		const fur = this.track(
			new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 0.92 }),
		);
		const dark = this.track(
			new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.85 }),
		);
		const hornM = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xefebe9,
				roughness: 0.55,
				metalness: 0.05,
			}),
		);
		const black = this.track(new THREE.MeshBasicMaterial({ color: 0x111111 }));

		// Body
		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.38, 4, 8), fur);
		body.rotation.z = Math.PI / 2;
		body.position.set(0, 0.42, 0);
		g.add(body);

		// Chest fluff
		const chest = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), fur);
		chest.position.set(0.22, 0.4, 0);
		chest.scale.set(1, 0.9, 0.85);
		g.add(chest);

		// Legs
		for (const [lx, lz] of [
			[0.16, 0.1],
			[0.16, -0.1],
			[-0.16, 0.1],
			[-0.16, -0.1],
		] as const) {
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.34, 6), dark);
			leg.position.set(lx, 0.17, lz);
			g.add(leg);
			const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.07), black);
			hoof.position.set(lx, 0.02, lz);
			g.add(hoof);
		}

		// Head group (bobs in update)
		const head = new THREE.Group();
		head.position.set(0.38, 0.58, 0);
		const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), fur);
		skull.scale.set(1.15, 0.95, 0.9);
		head.add(skull);
		// Snout
		const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.1, 3, 6), fur);
		snout.rotation.z = Math.PI / 2;
		snout.position.set(0.12, -0.02, 0);
		head.add(snout);
		// Nose
		const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), black);
		nose.position.set(0.2, -0.01, 0);
		head.add(nose);
		// Eyes
		for (const sz of [-1, 1] as const) {
			const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), black);
			eye.position.set(0.08, 0.04, sz * 0.07);
			head.add(eye);
		}
		// Ears
		for (const sz of [-1, 1] as const) {
			const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 5), fur);
			ear.position.set(0.02, 0.08, sz * 0.12);
			ear.rotation.z = sz * 0.9;
			ear.rotation.x = -0.4;
			head.add(ear);
		}
		// Curved horns
		for (const sz of [-1, 1] as const) {
			const horn = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.22, 6), hornM);
			horn.position.set(-0.02, 0.16, sz * 0.06);
			horn.rotation.z = -0.55;
			horn.rotation.x = sz * 0.35;
			head.add(horn);
		}
		// Chin beard
		const beard = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 5), fur);
		beard.position.set(0.1, -0.14, 0);
		beard.rotation.x = Math.PI;
		head.add(beard);
		g.add(head);
		g.userData.head = head;

		// Short tail
		const tail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), fur);
		tail.position.set(-0.28, 0.48, 0);
		g.add(tail);

		// Rope / stake so it "belongs" to the room
		const stake = new THREE.Mesh(
			new THREE.CylinderGeometry(0.02, 0.025, 0.55, 6),
			this.track(
				new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.8 }),
			),
		);
		stake.position.set(-0.55, 0.28, 0.25);
		g.add(stake);
		const rope = new THREE.Mesh(
			new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4),
			this.track(
				new THREE.MeshStandardMaterial({ color: 0xa1887f, roughness: 0.9 }),
			),
		);
		rope.position.set(-0.22, 0.38, 0.12);
		rope.rotation.z = Math.PI / 2.4;
		rope.rotation.y = 0.3;
		g.add(rope);

		// Name plate
		const plate = this.makeNamePlate('Geit Qurban', 'voor de ayatollahs');
		plate.position.set(0, 1.05, 0);
		plate.scale.set(1.0, 0.24, 1);
		g.add(plate);

		// Speech bubble
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
		speech.scale.set(1.6, 0.4, 1);
		speech.position.set(0, 1.25, 0);
		speech.visible = false;
		g.add(speech);
		g.userData.speech = speech;
		g.userData.speechCtx = speechCtx;
		g.userData.speechTex = speechTex;
		g.userData.speechLife = 0;

		// In front of front row (ayatollahs at z≈−0.4, congregants at z≈0.9)
		g.position.set(0.1, 0.12, 1.55);
		g.rotation.y = Math.PI; // face the ayatollahs
		g.userData.baseY = 0.12;
		this.group.add(g);
		this.goat = g;
	}

	private makeAyatollah(name: string, title: string, turbanColor: number): THREE.Group {
		const g = new THREE.Group();
		const skin = this.track(
			new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.88 }),
		);
		const robe = this.track(
			new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
		);
		const beardM = this.track(
			new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.95 }),
		);
		const turbanM = this.track(
			new THREE.MeshStandardMaterial({ color: turbanColor, roughness: 0.85 }),
		);

		// Seated pose: lower body on mat
		const hips = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), robe);
		hips.scale.set(1.15, 0.55, 1.0);
		hips.position.set(0, 0.28, 0.02);
		g.add(hips);

		// Legs folded forward under robe
		const lap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.4), robe);
		lap.position.set(0, 0.18, 0.22);
		g.add(lap);

		// Torso / abaya
		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), robe);
		torso.position.set(0, 0.72, 0);
		g.add(torso);

		// Wide sleeves
		for (const side of [-1, 1] as const) {
			const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 3, 6), robe);
			sleeve.position.set(side * 0.28, 0.65, 0.08);
			sleeve.rotation.z = side * 0.55;
			sleeve.rotation.x = 0.35;
			g.add(sleeve);
			const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), skin);
			hand.position.set(side * 0.38, 0.48, 0.18);
			g.add(hand);
		}

		// Head
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skin);
		head.position.set(0, 1.15, 0.02);
		g.add(head);

		// White beard — full, dignified
		const beard = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.38, 8), beardM);
		beard.position.set(0, 0.92, 0.1);
		beard.rotation.x = Math.PI;
		g.add(beard);
		const moustache = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.05), beardM);
		moustache.position.set(0, 1.08, 0.13);
		g.add(moustache);

		// Turban (amama) — layered
		const turbanBase = new THREE.Mesh(
			new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
			turbanM,
		);
		turbanBase.position.set(0, 1.22, 0);
		g.add(turbanBase);
		const turbanTop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), turbanM);
		turbanTop.position.set(0, 1.32, -0.02);
		turbanTop.scale.set(1.05, 0.7, 1.05);
		g.add(turbanTop);

		// Soft closed eyes (prayer)
		const lid = this.track(new THREE.MeshBasicMaterial({ color: 0x2c1810 }));
		for (const sx of [-1, 1] as const) {
			const eye = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.02), lid);
			eye.position.set(sx * 0.05, 1.17, 0.13);
			g.add(eye);
		}

		// Name plate — eervol
		const plate = this.makeNamePlate(name, title);
		plate.position.set(0, 1.65, 0.05);
		plate.scale.set(1.15, 0.28, 1);
		g.add(plate);

		// Speech bubble (Allahu Akbar)
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
		speech.position.set(0, 2.05, 0.1);
		speech.visible = false;
		g.add(speech);
		g.userData.speech = speech;
		g.userData.speechCtx = speechCtx;
		g.userData.speechTex = speechTex;
		g.userData.speechLife = 0;

		return g;
	}

	private makeNamePlate(name: string, title: string): THREE.Sprite {
		const c = document.createElement('canvas');
		c.width = 320;
		c.height = 80;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = 'rgba(27,94,32,0.88)';
		ctx.fillRect(0, 0, 320, 80);
		ctx.strokeStyle = '#a5d6a7';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 314, 74);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(name, 160, 32);
		ctx.fillStyle = '#c8e6c9';
		ctx.font = '14px system-ui,sans-serif';
		ctx.fillText(title, 160, 56);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Sprite(
			new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
		);
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

/** Soft ambient pad + slow Hijaz-ish melody — room "gebedsmuziek". */
function startPrayerMusic(
	ctx: AudioContext,
	dest: AudioNode,
): { stop: () => void } {
	const master = ctx.createGain();
	master.gain.value = 0.9;
	master.connect(dest);

	// Warm lowpass
	const lp = ctx.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.value = 1400;
	lp.Q.value = 0.7;
	lp.connect(master);

	// Continuous drone chord (root + fifth + octave)
	const drones: OscillatorNode[] = [];
	const droneGains: GainNode[] = [];
	const roots = [110, 165, 220, 330]; // A2 cluster — calm
	for (let i = 0; i < roots.length; i++) {
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = i % 2 === 0 ? 'sine' : 'triangle';
		o.frequency.value = roots[i];
		g.gain.value = i === 0 ? 0.07 : 0.035;
		o.connect(g);
		g.connect(lp);
		o.start();
		drones.push(o);
		droneGains.push(g);
	}

	// Soft shimmer LFO on drone volume
	const lfo = ctx.createOscillator();
	const lfoG = ctx.createGain();
	lfo.type = 'sine';
	lfo.frequency.value = 0.08;
	lfoG.gain.value = 0.012;
	lfo.connect(lfoG);
	for (const g of droneGains) lfoG.connect(g.gain);
	lfo.start();

	// Slow melodic phrase (Hijaz-flavoured: A Bb C# D E)
	const scale = [220, 233, 277, 294, 330, 349, 415, 440];
	let alive = true;
	let melTimer: number | null = null;
	const melody = () => {
		if (!alive) return;
		const steps = 6 + Math.floor(Math.random() * 5);
		let t0 = ctx.currentTime + 0.05;
		let noteIdx = 4;
		for (let i = 0; i < steps; i++) {
			noteIdx = Math.max(
				0,
				Math.min(scale.length - 1, noteIdx + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))),
			);
			const freq = scale[noteIdx];
			const dur = 0.45 + Math.random() * 0.55;
			const o = ctx.createOscillator();
			const g = ctx.createGain();
			const f = ctx.createBiquadFilter();
			o.type = 'sine';
			o.frequency.setValueAtTime(freq, t0);
			// slight portamento
			if (i > 0) {
				o.frequency.setValueAtTime(scale[Math.max(0, noteIdx - 1)], t0);
				o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.08);
			}
			f.type = 'lowpass';
			f.frequency.value = 1800;
			g.gain.setValueAtTime(0.0001, t0);
			g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.08);
			g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
			o.connect(f);
			f.connect(g);
			g.connect(lp);
			o.start(t0);
			o.stop(t0 + dur + 0.05);
			t0 += dur * 0.88;
		}
		melTimer = window.setTimeout(melody, 2800 + Math.random() * 2200);
	};
	melody();

	// Soft "bell" accents every few bars
	let bellTimer: number | null = null;
	const bell = () => {
		if (!alive) return;
		const t0 = ctx.currentTime + 0.02;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime(660, t0);
		o.frequency.exponentialRampToValueAtTime(440, t0 + 1.2);
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(0.04, t0 + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
		o.connect(g);
		g.connect(lp);
		o.start(t0);
		o.stop(t0 + 1.5);
		bellTimer = window.setTimeout(bell, 5000 + Math.random() * 4000);
	};
	bell();

	return {
		stop: () => {
			alive = false;
			if (melTimer !== null) clearTimeout(melTimer);
			if (bellTimer !== null) clearTimeout(bellTimer);
			try {
				lfo.stop();
				for (const o of drones) o.stop();
			} catch {
				/* */
			}
		},
	};
}

/**
 * Multi-voice "Allahu Akbar" formant-ish chant loop.
 * Syllables: Al-la-hu · Ak-bar  (crowd layer stacks slightly detuned).
 */
function startAllahuLoop(
	ctx: AudioContext,
	dest: AudioNode,
): { stop: () => void } {
	let alive = true;
	let timer: number | null = null;

	/** One syllabic "voice" with formant filters */
	const voice = (
		t0: number,
		basePitch: number,
		vol: number,
		detuneCents: number,
	) => {
		// Syllable plan: [pitch mult, formant F1, formant F2, duration]
		// Al- la- hu  Ak- bar
		const syl: [number, number, number, number][] = [
			[1.0, 700, 1200, 0.22], // Al
			[0.95, 500, 900, 0.28], // la
			[1.12, 350, 800, 0.38], // hu
			[0.05, 400, 900, 0.12], // rest
			[1.05, 700, 1300, 0.24], // Ak
			[0.9, 600, 1000, 0.48], // bar
		];
		let t = t0;
		for (const [pm, f1, f2, dur] of syl) {
			if (pm < 0.1) {
				t += dur;
				continue;
			}
			const fund = basePitch * pm * Math.pow(2, detuneCents / 1200);
			// Carrier saw through formant bandpasses ≈ vowel
			const o = ctx.createOscillator();
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(fund, t);

			const bp1 = ctx.createBiquadFilter();
			bp1.type = 'bandpass';
			bp1.frequency.setValueAtTime(f1, t);
			bp1.Q.value = 6;
			const bp2 = ctx.createBiquadFilter();
			bp2.type = 'bandpass';
			bp2.frequency.setValueAtTime(f2, t);
			bp2.Q.value = 5;

			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
			g.gain.exponentialRampToValueAtTime(vol * 0.7, t + dur * 0.55);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

			const merge = ctx.createGain();
			merge.gain.value = 0.55;
			o.connect(bp1);
			o.connect(bp2);
			bp1.connect(merge);
			bp2.connect(merge);
			merge.connect(g);
			g.connect(dest);

			o.start(t);
			o.stop(t + dur + 0.03);
			t += dur * 0.92;
		}
	};

	const phrase = () => {
		if (!alive) return;
		const t0 = ctx.currentTime + 0.03;
		// Lead voice + crowd (detuned copies) = "iedereen"
		const base = 145 + Math.random() * 25; // baritone-ish
		voice(t0, base, 0.11, 0);
		voice(t0 + 0.03, base * 1.01, 0.07, 12);
		voice(t0 + 0.06, base * 0.99, 0.06, -18);
		voice(t0 + 0.02, base * 1.5, 0.04, 7); // higher harmony
		// Echo call from "other side of room"
		if (Math.random() < 0.65) {
			voice(t0 + 1.85, base * 0.96, 0.08, -8);
			voice(t0 + 1.9, base * 1.02, 0.05, 15);
		}
		// Dense burst — full room shouts together
		if (Math.random() < 0.4) {
			const burst = t0 + 3.6;
			for (let i = 0; i < 5; i++) {
				voice(burst + i * 0.04, base * (0.95 + i * 0.03), 0.05, (i - 2) * 10);
			}
		}
		timer = window.setTimeout(phrase, 4200 + Math.random() * 1800);
	};
	phrase();

	return {
		stop: () => {
			alive = false;
			if (timer !== null) clearTimeout(timer);
		},
	};
}
