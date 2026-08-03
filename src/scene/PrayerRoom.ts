import * as THREE from 'three';
import { spatial } from '@/audio/SpatialAudio';
import { fitText, labelCanvas, labelTexture } from '@/util/label';
import { at, pick } from '@/util/rand';
import { tagLevelCulled } from '@/util/visibility';

/** Chant lines shown above everyone in the room */
const CHANTS = ['Allahu Akbar!', 'Allahu Akbar!!', 'الله أكبر', 'Allahu Trapbar!', 'ALLAHU AKBAR'];

/** Allahu Trapbar clean instrumental (same track family as YT XoX5cxsN5-U) */
const TRAPBAR_URL = '/prayer-music/allahu_trapbar.mp3';
/** Estimated BPM of allahu_trapbar.mp3 (onset autocorrelation) */
const TRAP_BPM = 108;
const TRAP_BEAT = 60 / TRAP_BPM;
/** Full sit↔doggy phrase length in beats (4 bars) */
const POSE_PHRASE_BEATS = 16;

/**
 * The Screaming Sheep (Original Upload) — classic goat/sheep scream meme
 * @see https://www.youtube.com/watch?v=SIaFtAKnqBU
 */
const GOAT_SCREAMS = [
	'/prayer-music/goat_scream_hit2.mp3',
	'/prayer-music/goat_scream_intro.mp3',
	'/prayer-music/goat_scream_main.mp3',
	'/prayer-music/goat_scream_original.mp3',
	'/prayer-music/goat_scream_punch.mp3',
];

/**
 * Gebedsruimte — Allahu Trapbar loop + full-room chants + sacrificial goat mascot.
 * Prayer poses lock to the trapbar BPM / playback clock.
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
	private bleatCd = 2.2;
	private lastScreamIdx = -1;
	private screaming = false;
	/** Trapbar media — playback time drives poses */
	private trapSrc: {
		getPlaybackTime: () => number;
		duration: number;
		createAnalyser: (n?: number) => AnalyserNode;
		element?: HTMLAudioElement;
	} | null = null;
	private trapAnalyser: AnalyserNode | null = null;
	private trapFreq = new Uint8Array(128);
	private lastBeat = -1;

	constructor() {
		this.group.name = 'prayerRoom';
		this.group.position.copy(this.pos);
		this.build();
		this.buildAyatollahs();
		this.buildGoat();
		// McD wrappers + energy-drink cans — only in this room (not mall-wide)
		this.buildFloorLitter();
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
		spatial.ensure();

		// ── Allahu Trapbar via HTMLAudio + HRTF ──
		// MediaElement is more reliable than decodeAudioData for long loops,
		// and currentTime is the ground truth for pose sync.
		const el = new Audio(TRAPBAR_URL);
		el.loop = true;
		el.preload = 'metadata';
		el.crossOrigin = 'anonymous';

		const se = spatial.attachElementAt(
			el,
			{ x: this.pos.x, y: 1.5, z: this.pos.z },
			{
				// Loud enough to hear from atrium; soft falloff
				volume: 1.0,
				k: 0.012,
				maxDistance: 52,
				refDistance: 3.5,
			},
		);
		this.trapSrc = se;
		try {
			this.trapAnalyser = se.createAnalyser(256);
			this.trapFreq = new Uint8Array(this.trapAnalyser.frequencyBinCount);
		} catch {
			this.trapAnalyser = null;
		}

		const tryPlay = () => {
			void el.play().catch((err) => {
				console.warn('[PrayerRoom] trapbar play blocked:', err);
			});
		};
		if (el.readyState >= 2) tryPlay();
		else el.addEventListener('canplay', tryPlay, { once: true });
		// Extra kick after a tick (iOS / delayed unlock)
		window.setTimeout(tryPlay, 120);

		// Soft crowd chants under the trap beat
		const chants = spatial.startLoopAt({ x: this.pos.x, y: 1.3, z: this.pos.z }, (ctx, dest) => startAllahuLoop(ctx, dest), {
			volume: 0.28,
			k: 0.04,
			maxDistance: 28,
		});

		this.stopAudio = () => {
			el.pause();
			el.removeAttribute('src');
			el.load();
			this.trapSrc = null;
			this.trapAnalyser = null;
			chants.stop();
		};

		// Immediate first scream so you hear The Screaming Sheep original
		window.setTimeout(() => this.playGoatScream(), 600);
	}

	/** Seconds into the trapbar loop (or free-run clock before audio ready) */
	private musicTime(): number {
		const t = this.trapSrc?.getPlaybackTime() ?? -1;
		if (t >= 0) return t;
		return this.t;
	}

	/** Bass energy 0..1 from trapbar analyser (kick proxy) */
	private bassEnergy(): number {
		if (!this.trapAnalyser) return 0;
		this.trapAnalyser.getByteFrequencyData(this.trapFreq);
		// Low bins ≈ kick / 808
		let s = 0;
		const n = Math.min(8, this.trapFreq.length);
		for (let i = 0; i < n; i++) s += this.trapFreq[i] ?? 0;
		return Math.min(1, (s / n / 255) * 1.4);
	}

	/**
	 * Pose blend 0=kleermakerszit … 1=doggy, locked to trapbar bars.
	 * Phrase = 16 beats (4 bars): sit · rise · doggy · fall.
	 * personOffsetBeats keeps them on-grid but staggered by half-bars.
	 */
	private poseBlendFor(beat: number, personOffsetBeats: number, bass: number): number {
		const phrase = (((beat + personOffsetBeats) % POSE_PHRASE_BEATS) + POSE_PHRASE_BEATS) % POSE_PHRASE_BEATS;
		let base: number;
		if (phrase < 6) {
			base = 0; // bars 1–1.5: sit
		} else if (phrase < 8) {
			// half-bar rise into doggy (1 bar)
			const u = (phrase - 6) / 2;
			base = u * u * (3 - 2 * u);
		} else if (phrase < 14) {
			base = 1; // doggy
		} else {
			const u = (phrase - 14) / 2;
			base = 1 - u * u * (3 - 2 * u);
		}
		// Kick thrusts while doggy-ish
		const beatFrac = ((beat % 1) + 1) % 1;
		const kickPulse = Math.exp(-beatFrac * 10); // sharp on every beat
		const thrust = base > 0.35 ? kickPulse * (0.1 + bass * 0.22) : bass * 0.04;
		return Math.min(1, base + thrust);
	}

	/** The Screaming Sheep (SIaFtAKnqBU) — spatial at goat */
	private playGoatScream(): void {
		if (!this.audioStarted || this.screaming) return;
		let idx = Math.floor(Math.random() * GOAT_SCREAMS.length);
		if (idx === this.lastScreamIdx && GOAT_SCREAMS.length > 1) {
			idx = (idx + 1) % GOAT_SCREAMS.length;
		}
		this.lastScreamIdx = idx;
		const url = at(GOAT_SCREAMS, idx);
		this.screaming = true;

		const gx = this.pos.x + (this.goat?.position.x ?? 0);
		const gy = this.pos.y + 0.7;
		const gz = this.pos.z + (this.goat?.position.z ?? 1.55);

		void spatial
			.playAt(
				url,
				{ x: gx, y: gy, z: gz },
				{
					volume: 0.95,
					k: 0.028,
					maxDistance: 32,
					refDistance: 2,
				},
			)
			.finally(() => {
				// full original is ~6s; shorter cuts free earlier via max
				const unlockMs = url.includes('original') ? 6500 : 2000;
				window.setTimeout(() => {
					this.screaming = false;
				}, unlockMs);
			});
	}

	update(dt: number, listener: THREE.Vector3): void {
		void listener;
		this.t += dt;
		this.bleatCd -= dt;

		// ── Music clock (trapbar) ────────────────────────────
		const musicT = this.musicTime();
		const beat = musicT / TRAP_BEAT;
		const bass = this.bassEnergy();
		const beatIdx = Math.floor(beat);

		// Bubbles + Allahu on the downbeat of every bar (beat 0 of 4)
		const newBeat = beatIdx !== this.lastBeat;
		if (newBeat) {
			this.lastBeat = beatIdx;
			const onBar = beatIdx % 4 === 0;
			const onDrop = beatIdx % POSE_PHRASE_BEATS === 8; // enter doggy section
			if (onBar || onDrop) {
				// Staggered cascade of "Allahu Akbar" on the bar
				const n = onDrop ? this.ayatollahs.length : 2 + Math.floor(Math.random() * 3);
				const order = this.ayatollahs
					.map((_, i) => i)
					.sort(() => Math.random() - 0.5)
					.slice(0, n);
				order.forEach((ayatollahIndex, k) => {
					const a = this.ayatollahs[ayatollahIndex];
					if (!a) return;
					const line = onDrop ? 'Allahu Trapbar!' : pick(CHANTS);
					// 16th-note cascade within the bar
					window.setTimeout(() => this.showBubble(a, line), k * (TRAP_BEAT * 250));
				});
			}
			// Goat on phrase start / drop
			if (
				this.goat &&
				this.bleatCd <= 0 &&
				(beatIdx % POSE_PHRASE_BEATS === 0 || beatIdx % POSE_PHRASE_BEATS === 8) &&
				Math.random() < 0.55
			) {
				this.bleatCd = TRAP_BEAT * 12;
				this.showBubble(this.goat, pick(['MEEEH!!!', '🐐 on beat', 'Allahu… mèèh', 'Trapbar!!']));
				if (this.audioStarted) this.playGoatScream();
			}
		}

		this.ayatollahs.forEach((a, i) => {
			const phase = a.userData['phase'] ?? i;
			// Half-bar offsets so the row ripples but stays on the grid
			const offsetBeats = (i % 4) * 2 + (phase % 1) * 0.15;
			const blend = this.poseBlendFor(beat, offsetBeats, bass);
			this.applyPrayerPose(a, blend);

			const baseY = a.userData['baseY'] ?? 0.12;
			// Kick-dip hips on the beat while doggy
			const beatFrac = ((beat % 1) + 1) % 1;
			const kickDip = blend * Math.exp(-beatFrac * 9) * 0.05;
			a.position.y = baseY + Math.sin(this.t * 1.1 + phase) * 0.006 - blend * 0.06 - kickDip;
			// Bubble lifetime
			const life = a.userData['speechLife'] ?? 0;
			if (life > 0) {
				a.userData['speechLife'] = life - dt;
				if (life - dt <= 0) {
					const sp = a.userData['speech'] as THREE.Sprite | undefined;
					if (sp) sp.visible = false;
				}
			}
		});

		// Goat idle: head bob + occasional bleat bubble
		if (this.goat) {
			const goat = this.goat;
			const head = goat.userData['head'] as THREE.Object3D | undefined;
			if (head) {
				head.rotation.x = Math.sin(this.t * 2.4) * 0.12;
				head.rotation.y = Math.sin(this.t * 0.7) * 0.18;
			}
			goat.position.y = (goat.userData['baseY'] ?? 0) + Math.sin(this.t * 3.2) * 0.01;
			const life = goat.userData['speechLife'] ?? 0;
			if (life > 0) {
				goat.userData['speechLife'] = life - dt;
				if (life - dt <= 0) {
					const sp = goat.userData['speech'] as THREE.Sprite | undefined;
					if (sp) sp.visible = false;
				}
			}
		}
		// Chants + goat are beat-locked to the trapbar clock above
	}

	dispose(): void {
		this.stopAudio?.();
	}

	private showBubble(fig: THREE.Group, text: string): void {
		const sp = fig.userData['speech'] as THREE.Sprite | undefined;
		const ctx = fig.userData['speechCtx'] as CanvasRenderingContext2D | undefined;
		const tex = fig.userData['speechTex'] as THREE.CanvasTexture | undefined;
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
		fitText(ctx, text, { x: 14, y: 8, w: w - 28, h: h - 30 }, { size: 26 });
		tex.needsUpdate = true;
		sp.visible = true;
		fig.userData['speechLife'] = 2.2 + Math.random() * 0.9;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private build(): void {
		// Small quiet room shell
		const wall = this.track(new THREE.MeshLambertMaterial({ color: 0xe8e4d9 }));
		const floor = new THREE.Mesh(
			new THREE.BoxGeometry(5.5, 0.08, 4.2),
			this.track(new THREE.MeshLambertMaterial({ color: 0xc4a574 })),
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
			this.track(new THREE.MeshLambertMaterial({ color: 0x1b5e20 })),
		);
		carpet.position.set(0, 0.1, -0.2);
		this.group.add(carpet);

		// prayer mats (enough for the ayatollahs)
		for (let i = 0; i < 4; i++) {
			const mat = new THREE.Mesh(
				new THREE.BoxGeometry(0.85, 0.02, 1.35),
				this.track(new THREE.MeshLambertMaterial({ color: 0x2e7d32 })),
			);
			mat.position.set(-1.45 + i * 0.95, 0.12, -0.35);
			this.group.add(mat);
		}

		// soft lamp
		const lamp = new THREE.PointLight(0xffe0b2, 6, 8, 2);
		lamp.position.set(0, 2.6, 0);
		this.group.add(lamp);

		// sign
		const { canvas: c, ctx } = labelCanvas(320, 96);
		ctx.fillStyle = '#1b5e20';
		ctx.fillRect(0, 0, 320, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 26px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('GEBEDSRUIMTE', 160, 40);
		ctx.font = '13px system-ui';
		ctx.fillText('Allahu Trapbar · geit · wudu ernaast', 160, 70);
		const tex = labelTexture(c);
		const sign = new THREE.Mesh(
			new THREE.PlaneGeometry(2.2, 0.65),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		sign.position.set(0, 2.8, 2.15);
		this.group.add(sign);

		// Qibla arrow + Mecca post-its on the walls
		this.buildQiblaAndPostits();
	}

	/**
	 * Fast-food chaos only among the congregation: McD bags, fries, cups,
	 * crushed Red Bull / Monster / generic cans on the mats and floor.
	 */
	private buildFloorLitter(): void {
		const rng = (s: number) => {
			// tiny deterministic hash so reloads look the same
			const x = Math.sin(s * 127.1) * 43758.5453;
			return x - Math.floor(x);
		};

		// McD bag
		const makeBag = (seed: number): THREE.Group => {
			const g = new THREE.Group();
			const red = this.track(new THREE.MeshLambertMaterial({ color: 0xda291c }));
			const yellow = this.track(new THREE.MeshLambertMaterial({ color: 0xffc72c }));
			const bag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.12), red);
			bag.position.y = 0.14;
			g.add(bag);
			// M arch as two yellow half-circles-ish boxes
			const m1 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 4, 8, Math.PI), yellow);
			m1.position.set(-0.03, 0.18, 0.065);
			m1.rotation.x = Math.PI;
			const m2 = m1.clone();
			m2.position.x = 0.03;
			g.add(m1, m2);
			g.rotation.set((rng(seed) - 0.5) * 0.4, rng(seed + 1) * Math.PI * 2, (rng(seed + 2) - 0.5) * 0.5);
			return g;
		};

		// Fries carton
		const makeFries = (seed: number): THREE.Group => {
			const g = new THREE.Group();
			const red = this.track(new THREE.MeshLambertMaterial({ color: 0xc62828 }));
			const fryM = this.track(new THREE.MeshLambertMaterial({ color: 0xffc107 }));
			const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.1), red);
			box.position.y = 0.07;
			g.add(box);
			for (let i = 0; i < 5; i++) {
				const f = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.12, 0.018), fryM);
				f.position.set((rng(seed + i * 3) - 0.5) * 0.08, 0.16 + rng(seed + i) * 0.04, (rng(seed + i * 5) - 0.5) * 0.06);
				f.rotation.z = (rng(seed + i * 7) - 0.5) * 0.4;
				g.add(f);
			}
			g.rotation.y = rng(seed + 9) * Math.PI * 2;
			g.rotation.z = (rng(seed + 10) - 0.5) * 0.6;
			return g;
		};

		// Soft drink cup + straw
		const makeCup = (seed: number): THREE.Group => {
			const g = new THREE.Group();
			const red = this.track(new THREE.MeshLambertMaterial({ color: 0xb71c1c }));
			const lidM = this.track(new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
			const strawM = this.track(new THREE.MeshLambertMaterial({ color: 0xf5f5f5 }));
			const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.16, 10), red);
			cup.position.y = 0.08;
			g.add(cup);
			const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), lidM);
			lid.position.y = 0.17;
			g.add(lid);
			const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5), strawM);
			straw.position.set(0.02, 0.24, 0);
			straw.rotation.z = 0.15;
			g.add(straw);
			// tip over sometimes
			if (rng(seed) > 0.45) {
				g.rotation.z = Math.PI / 2 + (rng(seed + 1) - 0.5) * 0.3;
				g.position.y = 0.05;
			}
			g.rotation.y = rng(seed + 2) * Math.PI * 2;
			return g;
		};

		// Burger wrapper (flat crumpled disc/box)
		const makeWrapper = (seed: number): THREE.Mesh => {
			const paper = this.track(
				new THREE.MeshLambertMaterial({
					color: rng(seed) > 0.5 ? 0xfff8e1 : 0xffecb3,
				}),
			);
			const w = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.14), paper);
			w.rotation.y = rng(seed) * Math.PI * 2;
			w.rotation.z = (rng(seed + 1) - 0.5) * 0.4;
			w.position.y = 0.02;
			return w;
		};

		// Energy / soda can
		type CanKind = 'redbull' | 'monster' | 'cola' | 'fanta' | 'generic';
		const canColors: Record<CanKind, { body: number; accent: number; label: string }> = {
			redbull: { body: 0x0033a0, accent: 0xc8102e, label: 'RED BULL' },
			monster: { body: 0x111111, accent: 0x78be20, label: 'MONSTER' },
			cola: { body: 0xb71c1c, accent: 0xffffff, label: 'COLA' },
			fanta: { body: 0xef6c00, accent: 0xffe082, label: 'FANTA' },
			generic: { body: 0x546e7a, accent: 0xcfd8dc, label: 'ENERGY' },
		};
		const makeCan = (seed: number, kind: CanKind): THREE.Group => {
			const g = new THREE.Group();
			const col = canColors[kind];
			const body = new THREE.Mesh(
				new THREE.CylinderGeometry(0.035, 0.035, 0.13, 12),
				this.track(
					new THREE.MeshLambertMaterial({
						color: col.body,
					}),
				),
			);
			body.position.y = 0.065;
			g.add(body);
			const rim = new THREE.Mesh(
				new THREE.CylinderGeometry(0.036, 0.036, 0.015, 12),
				this.track(
					new THREE.MeshLambertMaterial({
						color: 0xc0c0c0,
					}),
				),
			);
			rim.position.y = 0.13;
			g.add(rim);
			// Label stripe
			const stripe = new THREE.Mesh(
				new THREE.BoxGeometry(0.072, 0.05, 0.01),
				this.track(
					new THREE.MeshLambertMaterial({
						color: col.accent,
					}),
				),
			);
			stripe.position.set(0, 0.07, 0.032);
			g.add(stripe);
			// Crushed / lying
			const crushed = rng(seed) > 0.55;
			if (crushed) {
				g.scale.set(1.15, 0.45, 1.1);
				g.rotation.z = Math.PI / 2 + (rng(seed + 3) - 0.5) * 0.4;
				g.position.y = 0.03;
			} else if (rng(seed + 4) > 0.5) {
				g.rotation.z = Math.PI / 2;
				g.position.y = 0.035;
			}
			g.rotation.y = rng(seed + 5) * Math.PI * 2;
			void col.label;
			return g;
		};

		// Scatter inside room footprint (local space)
		const spots: { x: number; z: number }[] = [];
		for (let i = 0; i < 55; i++) {
			spots.push({
				x: (rng(i * 1.7) - 0.5) * 4.6,
				z: (rng(i * 2.3 + 9) - 0.5) * 3.4,
			});
		}
		// Extra pile near goat / entrance
		for (let i = 0; i < 12; i++) {
			spots.push({
				x: (rng(100 + i) - 0.5) * 1.2,
				z: 1.2 + rng(110 + i) * 0.7,
			});
		}

		const kinds: CanKind[] = ['redbull', 'redbull', 'monster', 'cola', 'fanta', 'generic', 'redbull'];

		spots.forEach(({ x, z }, i) => {
			const roll = rng(i * 11.3);
			let item: THREE.Object3D;
			if (roll < 0.22) item = makeBag(i);
			else if (roll < 0.4) item = makeFries(i + 50);
			else if (roll < 0.55) item = makeCup(i + 90);
			else if (roll < 0.68) item = makeWrapper(i + 130);
			else item = makeCan(i + 170, at(kinds, i));

			item.position.x += x;
			item.position.z += z;
			// Rest on carpet / floor
			if (!item.position.y) item.position.y = 0.02;
			item.position.y += 0.11; // above floor slab
			// Slight sink into mat look
			item.position.y += rng(i + 200) * 0.02;
			this.group.add(item);
		});

		// Dedicated Red Bull pyramid near back wall
		for (let row = 0; row < 3; row++) {
			for (let c = 0; c < 3 - row; c++) {
				const can = makeCan(400 + row * 10 + c, 'redbull');
				can.position.set(-1.8 + c * 0.09 + row * 0.04, 0.13 + row * 0.12, -1.55);
				can.rotation.set(0, 0, 0);
				can.scale.set(1, 1, 1);
				this.group.add(can);
			}
		}
	}

	/**
	 * Sticky notes + qibla pointer — Mecca direction (SE from mall NW corner),
	 * hajj reminders, trapbar schedule, goat memo…
	 */
	private buildQiblaAndPostits(): void {
		// Qibla board on back wall (toward “Mecca” — SE-ish in our joke map)
		const qibla = this.makePostIt(['🕋 QIBLA', '→ MEKKA', 'zuidoost', '(ongeveer)'], '#fffde7', '#b71c1c', 1.1, 0.95);
		qibla.position.set(-0.9, 2.15, -1.91);
		this.group.add(qibla);

		// Big arrow under qibla
		const arrow = this.makePostIt(['↘↘↘', 'DIT KANT OP', 'Kaaba vibes'], '#ffecb3', '#e65100', 0.85, 0.7);
		arrow.position.set(0.15, 1.85, -1.91);
		arrow.rotation.z = -0.08;
		this.group.add(arrow);

		type Note = {
			lines: string[];
			bg: string;
			fg: string;
			x: number;
			y: number;
			z: number;
			ry: number;
			rz: number;
			w: number;
			h: number;
		};
		const notes: Note[] = [
			// Back wall scatter
			{
				lines: ['MEKKA', 'is die kant', 'niet de', 'Kruidvat'],
				bg: '#e3f2fd',
				fg: '#0d47a1',
				x: 1.2,
				y: 2.35,
				z: -1.91,
				ry: 0,
				rz: 0.12,
				w: 0.72,
				h: 0.72,
			},
			{
				lines: ['Hajj', '2026?', 'save €€€'],
				bg: '#fce4ec',
				fg: '#880e4f',
				x: -1.85,
				y: 1.55,
				z: -1.91,
				ry: 0,
				rz: -0.15,
				w: 0.65,
				h: 0.6,
			},
			{
				lines: ['Zemzem', 'uit de', 'automaat', '€1,50'],
				bg: '#e8f5e9',
				fg: '#1b5e20',
				x: 1.9,
				y: 1.7,
				z: -1.91,
				ry: 0,
				rz: 0.06,
				w: 0.68,
				h: 0.68,
			},
			// Left wall
			{
				lines: ['📿 tasbih', 'kwijt bij', 'food court'],
				bg: '#fff9c4',
				fg: '#f57f17',
				x: -2.61,
				y: 2.2,
				z: -0.8,
				ry: Math.PI / 2,
				rz: 0.1,
				w: 0.7,
				h: 0.65,
			},
			{
				lines: ['Allahu', 'Trapbar', 'volume', 'MAX'],
				bg: '#f3e5f5',
				fg: '#4a148c',
				x: -2.61,
				y: 1.75,
				z: 0.4,
				ry: Math.PI / 2,
				rz: -0.18,
				w: 0.7,
				h: 0.7,
			},
			{
				lines: ['Geit Qurban', 'niet', 'aaien', '(bijt)'],
				bg: '#efebe9',
				fg: '#3e2723',
				x: -2.61,
				y: 1.35,
				z: 1.2,
				ry: Math.PI / 2,
				rz: 0.05,
				w: 0.65,
				h: 0.65,
			},
			// Right wall
			{
				lines: ['Wudu', '→ WC', 'ernaast', 'voeten!'],
				bg: '#e0f7fa',
				fg: '#006064',
				x: 2.61,
				y: 2.1,
				z: -0.6,
				ry: -Math.PI / 2,
				rz: -0.1,
				w: 0.68,
				h: 0.68,
			},
			{
				lines: ['Kleermakerszit', '↔ doggy', 'op de beat', '108 BPM'],
				bg: '#ffe0b2',
				fg: '#e65100',
				x: 2.61,
				y: 1.6,
				z: 0.5,
				ry: -Math.PI / 2,
				rz: 0.14,
				w: 0.78,
				h: 0.78,
			},
			{
				lines: ['Telefoon', 'stil SVP', '(behalve', 'trapbar)'],
				bg: '#c8e6c9',
				fg: '#1b5e20',
				x: 2.61,
				y: 1.25,
				z: 1.3,
				ry: -Math.PI / 2,
				rz: -0.07,
				w: 0.7,
				h: 0.7,
			},
			// Over entrance (facing corridor, +Z)
			{
				lines: ['🕌', 'SCHOENEN', 'UIT', 'pls'],
				bg: '#ffcdd2',
				fg: '#b71c1c',
				x: -1.4,
				y: 2.4,
				z: 2.08,
				ry: Math.PI,
				rz: 0.08,
				w: 0.7,
				h: 0.7,
			},
			{
				lines: ['MEKKA', '4500 km', 'die kant', '✈️'],
				bg: '#fff8e1',
				fg: '#ff6f00',
				x: 1.3,
				y: 2.35,
				z: 2.08,
				ry: Math.PI,
				rz: -0.12,
				w: 0.75,
				h: 0.72,
			},
			{
				lines: ['No selfies', 'met de', 'ayatollahs', 'thx'],
				bg: '#e1bee7',
				fg: '#4a148c',
				x: 0.0,
				y: 1.55,
				z: 2.08,
				ry: Math.PI,
				rz: 0.04,
				w: 0.72,
				h: 0.7,
			},
		];

		for (const n of notes) {
			const mesh = this.makePostIt(n.lines, n.bg, n.fg, n.w, n.h);
			mesh.position.set(n.x, n.y, n.z);
			mesh.rotation.y = n.ry;
			mesh.rotation.z = n.rz;
			this.group.add(mesh);
		}

		// Cork strip under post-its on back wall
		const cork = new THREE.Mesh(
			new THREE.BoxGeometry(4.8, 1.4, 0.04),
			this.track(
				new THREE.MeshLambertMaterial({
					color: 0xc4a574,
				}),
			),
		);
		cork.position.set(0, 1.95, -1.94);
		this.group.add(cork);
	}

	/** Classic sticky note: paper color + sharpie text + slight curl shadow */
	private makePostIt(lines: string[], bg: string, fg: string, worldW: number, worldH: number): THREE.Mesh {
		const { canvas: c, ctx } = labelCanvas(256, 256);
		// Paper
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 256, 256);
		// Soft shadow edge
		ctx.fillStyle = 'rgba(0,0,0,0.08)';
		ctx.fillRect(0, 240, 256, 16);
		// Pin / tape
		ctx.fillStyle = 'rgba(255,255,255,0.55)';
		ctx.fillRect(100, 4, 56, 14);
		ctx.strokeStyle = 'rgba(0,0,0,0.12)';
		ctx.lineWidth = 2;
		ctx.strokeRect(4, 4, 248, 248);
		// Text
		ctx.fillStyle = fg;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const n = lines.length;
		const fs = n <= 2 ? 36 : n === 3 ? 30 : 26;
		ctx.font = `bold ${fs}px "Comic Sans MS", "Segoe Print", system-ui, sans-serif`;
		lines.forEach((line, i) => {
			const y = 128 + (i - (n - 1) / 2) * (fs + 8);
			ctx.fillText(line, 128, y);
		});
		const tex = labelTexture(c);
		return new THREE.Mesh(
			new THREE.PlaneGeometry(worldW, worldH),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					toneMapped: false,
					side: THREE.DoubleSide,
				}),
			),
		);
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
				this.track(new THREE.MeshLambertMaterial({ color: 0x33691e })),
			);
			mat.position.set(-1.55 + i * 1.0, 0.12, 0.95);
			this.group.add(mat);
		}

		roster.forEach((r, i) => {
			const fig = this.makeAyatollah(r.name, r.title, r.turban);
			fig.position.set(r.x, 0.12, r.z);
			fig.rotation.y = r.yaw;
			fig.userData['baseY'] = 0.12;
			fig.userData['phase'] = i * 1.3;
			fig.userData['bow'] = r.bow;
			this.group.add(fig);
			this.ayatollahs.push(fig);
		});
	}

	/** Low-poly goat standing in front of the ayatollah row */
	private buildGoat(): void {
		const g = new THREE.Group();
		const fur = this.track(new THREE.MeshLambertMaterial({ color: 0xd7ccc8 }));
		const dark = this.track(new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
		const hornM = this.track(
			new THREE.MeshLambertMaterial({
				color: 0xefebe9,
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
		g.userData['head'] = head;

		// Short tail
		const tail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), fur);
		tail.position.set(-0.28, 0.48, 0);
		g.add(tail);

		// Rope / stake so it "belongs" to the room
		const stake = new THREE.Mesh(
			new THREE.CylinderGeometry(0.02, 0.025, 0.55, 6),
			this.track(new THREE.MeshLambertMaterial({ color: 0x6d4c41 })),
		);
		stake.position.set(-0.55, 0.28, 0.25);
		g.add(stake);
		const rope = new THREE.Mesh(
			new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4),
			this.track(new THREE.MeshLambertMaterial({ color: 0xa1887f })),
		);
		rope.position.set(-0.22, 0.38, 0.12);
		rope.rotation.z = Math.PI / 2.4;
		rope.rotation.y = 0.3;
		g.add(rope);

		// Name plate
		const plate = this.makeNamePlate('Geit Qurban', 'Screaming Sheep · original');
		plate.position.set(0, 1.05, 0);
		plate.scale.set(1.0, 0.24, 1);
		g.add(plate);
		tagLevelCulled(plate);

		// Speech bubble
		const { canvas: sc, ctx: speechCtx } = labelCanvas(320, 80);
		const speechTex = labelTexture(sc);
		const speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: speechTex,
				transparent: true,
				depthTest: true,
			}),
		);
		speech.scale.set(1.6, 0.4, 1);
		speech.visible = false;
		// The anchor carries the deck culling, not the sprite: `speech.visible`
		// is the bubble's own lifetime and cullByLevel would overwrite it.
		const speechAnchor = new THREE.Group();
		speechAnchor.position.set(0, 1.25, 0);
		speechAnchor.add(speech);
		g.add(speechAnchor);
		tagLevelCulled(speechAnchor);
		g.userData['speech'] = speech;
		g.userData['speechCtx'] = speechCtx;
		g.userData['speechTex'] = speechTex;
		g.userData['speechLife'] = 0;

		// In front of front row (ayatollahs at z≈−0.4, congregants at z≈0.9)
		g.position.set(0.1, 0.12, 1.55);
		g.rotation.y = Math.PI; // face the ayatollahs
		g.userData['baseY'] = 0.12;
		this.group.add(g);
		this.goat = g;
	}

	/**
	 * blend 0 = kleermakerszit (cross-legged sit), 1 = doggy (all fours).
	 * Uses rig parts stored on userData.
	 */
	private applyPrayerPose(fig: THREE.Group, blend: number): void {
		const rig = fig.userData['rig'] as
			| {
					hips: THREE.Object3D;
					torso: THREE.Object3D;
					headG: THREE.Object3D;
					lap: THREE.Object3D;
					armL: THREE.Object3D;
					armR: THREE.Object3D;
					legL: THREE.Object3D;
					legR: THREE.Object3D;
					handL: THREE.Object3D;
					handR: THREE.Object3D;
					plate: THREE.Object3D;
					speech: THREE.Object3D;
			  }
			| undefined;
		if (!rig) return;
		const t = THREE.MathUtils.clamp(blend, 0, 1);
		const L = (a: number, b: number) => a + (b - a) * t;

		// Root pitch: sit upright → body over the mat (doggy)
		fig.rotation.x = L(0.05, 0.95);

		// Hips
		rig.hips.position.set(0, L(0.28, 0.22), L(0.02, -0.05));
		rig.hips.rotation.x = L(0, 0.15);
		rig.hips.scale.set(L(1.15, 1.0), L(0.55, 0.7), L(1.0, 1.1));

		// Lap only in sit (fade out for doggy)
		rig.lap.visible = t < 0.85;
		rig.lap.position.set(0, L(0.18, 0.12), L(0.22, -0.1));
		rig.lap.scale.setScalar(L(1, 0.2));

		// Torso
		rig.torso.position.set(0, L(0.72, 0.55), L(0, 0.28));
		rig.torso.rotation.x = L(0, -0.35);

		// Head follows torso a bit
		rig.headG.position.set(0, L(1.15, 0.95), L(0.02, 0.45));
		rig.headG.rotation.x = L(0.1, -0.55);

		// Arms: sleeves down in sit → planted forward as front legs in doggy
		rig.armL.position.set(L(-0.28, -0.22), L(0.65, 0.35), L(0.08, 0.42));
		rig.armR.position.set(L(0.28, 0.22), L(0.65, 0.35), L(0.08, 0.42));
		rig.armL.rotation.set(L(0.35, 1.15), 0, L(-0.55, -0.2));
		rig.armR.rotation.set(L(0.35, 1.15), 0, L(0.55, 0.2));
		rig.handL.position.set(L(-0.38, -0.22), L(0.48, 0.12), L(0.18, 0.62));
		rig.handR.position.set(L(0.38, 0.22), L(0.48, 0.12), L(0.18, 0.62));

		// Legs: folded sit → extended back knees for doggy
		rig.legL.position.set(L(-0.12, -0.14), L(0.2, 0.28), L(0.05, -0.35));
		rig.legR.position.set(L(0.12, 0.14), L(0.2, 0.28), L(0.05, -0.35));
		rig.legL.rotation.set(L(0.9, -0.55), 0, L(0.4, 0.15));
		rig.legR.rotation.set(L(0.9, -0.55), 0, L(-0.4, -0.15));
		rig.legL.scale.set(1, L(0.7, 1.1), 1);
		rig.legR.scale.set(1, L(0.7, 1.1), 1);

		// Labels float above whatever pose
		rig.plate.position.set(0, L(1.65, 1.35), L(0.05, 0.2));
		rig.speech.position.set(0, L(2.05, 1.7), L(0.1, 0.25));
	}

	private makeAyatollah(name: string, title: string, turbanColor: number): THREE.Group {
		const g = new THREE.Group();
		const skin = this.track(new THREE.MeshLambertMaterial({ color: 0xc68642 }));
		const robe = this.track(new THREE.MeshLambertMaterial({ color: 0x141414 }));
		const beardM = this.track(new THREE.MeshLambertMaterial({ color: 0xf5f5f5 }));
		const turbanM = this.track(new THREE.MeshLambertMaterial({ color: turbanColor }));

		// Hips
		const hips = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), robe);
		hips.scale.set(1.15, 0.55, 1.0);
		hips.position.set(0, 0.28, 0.02);
		g.add(hips);

		// Lap (sit-only silhouette)
		const lap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.4), robe);
		lap.position.set(0, 0.18, 0.22);
		g.add(lap);

		// Legs (folded sit → rear doggy)
		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 3, 6), robe);
		const legR = legL.clone();
		legL.position.set(-0.12, 0.2, 0.05);
		legR.position.set(0.12, 0.2, 0.05);
		legL.rotation.x = 0.9;
		legR.rotation.x = 0.9;
		legL.rotation.z = 0.4;
		legR.rotation.z = -0.4;
		g.add(legL, legR);

		// Torso
		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), robe);
		torso.position.set(0, 0.72, 0);
		g.add(torso);

		// Arms
		const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 3, 6), robe);
		const armR = armL.clone();
		armL.position.set(-0.28, 0.65, 0.08);
		armR.position.set(0.28, 0.65, 0.08);
		armL.rotation.z = -0.55;
		armR.rotation.z = 0.55;
		armL.rotation.x = 0.35;
		armR.rotation.x = 0.35;
		g.add(armL, armR);
		const handL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), skin);
		const handR = handL.clone();
		handL.position.set(-0.38, 0.48, 0.18);
		handR.position.set(0.38, 0.48, 0.18);
		g.add(handL, handR);

		// Head group (moves as unit)
		const headG = new THREE.Group();
		headG.position.set(0, 1.15, 0.02);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skin);
		headG.add(head);
		const beard = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.38, 8), beardM);
		beard.position.set(0, -0.23, 0.08);
		beard.rotation.x = Math.PI;
		headG.add(beard);
		const moustache = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.05), beardM);
		moustache.position.set(0, -0.07, 0.11);
		headG.add(moustache);
		const turbanBase = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), turbanM);
		turbanBase.position.set(0, 0.07, -0.02);
		headG.add(turbanBase);
		const turbanTop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), turbanM);
		turbanTop.position.set(0, 0.17, -0.04);
		turbanTop.scale.set(1.05, 0.7, 1.05);
		headG.add(turbanTop);
		const lid = this.track(new THREE.MeshBasicMaterial({ color: 0x2c1810 }));
		for (const sx of [-1, 1] as const) {
			const eye = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.02), lid);
			eye.position.set(sx * 0.05, 0.02, 0.13);
			headG.add(eye);
		}
		g.add(headG);

		// Name plate
		const plate = this.makeNamePlate(name, title);
		plate.position.set(0, 1.65, 0.05);
		plate.scale.set(1.15, 0.28, 1);
		g.add(plate);
		tagLevelCulled(plate);

		// Speech bubble
		const { canvas: sc, ctx: speechCtx } = labelCanvas(320, 80);
		const speechTex = labelTexture(sc);
		const speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: speechTex,
				transparent: true,
				depthTest: true,
			}),
		);
		speech.scale.set(1.9, 0.48, 1);
		speech.visible = false;
		// The anchor carries the deck culling, not the sprite: `speech.visible`
		// is the bubble's own lifetime and cullByLevel would overwrite it. The
		// pose rig drives the anchor, so the bubble still rides the pose.
		const speechAnchor = new THREE.Group();
		speechAnchor.position.set(0, 2.05, 0.1);
		speechAnchor.add(speech);
		g.add(speechAnchor);
		tagLevelCulled(speechAnchor);
		g.userData['speech'] = speech;
		g.userData['speechCtx'] = speechCtx;
		g.userData['speechTex'] = speechTex;
		g.userData['speechLife'] = 0;
		g.userData['rig'] = {
			hips,
			torso,
			headG,
			lap,
			armL,
			armR,
			legL,
			legR,
			handL,
			handR,
			plate,
			speech: speechAnchor,
		};

		return g;
	}

	private makeNamePlate(name: string, title: string): THREE.Sprite {
		const { canvas: c, ctx } = labelCanvas(320, 80);
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
		const tex = labelTexture(c);
		return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
	}
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/**
 * Multi-voice "Allahu Akbar" formant-ish chant loop.
 * Syllables: Al-la-hu · Ak-bar  (crowd layer stacks slightly detuned).
 */
function startAllahuLoop(ctx: AudioContext, dest: AudioNode): { stop: () => void } {
	let alive = true;
	let timer: number | null = null;

	/** One syllabic "voice" with formant filters */
	const voice = (t0: number, basePitch: number, vol: number, detuneCents: number) => {
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
			const fund = basePitch * pm * 2 ** (detuneCents / 1200);
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
