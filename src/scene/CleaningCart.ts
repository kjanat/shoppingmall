import * as THREE from 'three';
import { spatial } from '@/audio/SpatialAudio';
import { levelAt } from '@/data/levels';
import type { CollisionWorld } from '@/physics/Collision';
import { ctx2d } from '@/util/dom';
import { fitText, labelCanvas, labelTexture } from '@/util/label';
import { at, pick } from '@/util/rand';
import { tagLevelCulled } from '@/util/visibility';

/**
 * Pre-generated ElevenLabs Chinese scolds. Straight from the manifest the
 * generator writes next to the mp3s, so the list can't drift from the files.
 */
import WEI_YELLS from '$/public/voices/wei/manifest.json' with { type: 'json' };

/**
 * Ride-on floor scrubber with Chinese cleaner Wei Chen —
 * always on duty, slow patrol across floor 0.
 * Pre-baked ElevenLabs Chinese yells when you block the cart.
 */
export class CleaningCart {
	readonly group = new THREE.Group();
	readonly pos = new THREE.Vector3();
	/** Solid hit radius for player / walls (scrubber chassis) */
	readonly radius = 0.85;
	private mesh: THREE.Group;
	private t = 0;
	private i = 0;
	private path: THREE.Vector3[] = [];
	private pathDir = 1;
	private world: CollisionWorld;
	private materials: THREE.Material[] = [];
	private wheels: THREE.Object3D[] = [];
	private brush!: THREE.Object3D;
	private wetSign!: THREE.Group;
	private speech!: THREE.Sprite;
	private speechTex!: THREE.CanvasTexture;
	private speechCtx!: CanvasRenderingContext2D;
	private speechLife = 0;
	private chatCd = 8;
	/** cooldown after an angry yell */
	private yellCd = 0;
	private lastYellIdx = -1;
	private speaking = false;
	/** how long player has been in scold range this stretch */
	private nearT = 0;
	/** true when cart had to shove away from player this frame */
	private blockedThisFrame = false;
	private audioEl: HTMLAudioElement | null = null;
	/** optional UI hook */
	private onYell: ((label: string) => void) | null = null;
	private tmpFwd = new THREE.Vector3();
	private tmpTo = new THREE.Vector3();

	constructor(world: CollisionWorld) {
		this.world = world;
		this.mesh = this.build();
		this.group.add(this.mesh);
		this.group.name = 'cleaningCart';
		this.resetPath();
		const start = at(this.path, 0);
		this.mesh.position.copy(start);
		this.pos.copy(start);
		// Warm browser cache so first scold isn't silent
		this.preloadClips();
	}

	setYellCallback(cb: (label: string) => void): void {
		this.onYell = cb;
	}

	/** Call after first user gesture so AudioContext is free */
	ensureAudio(): void {
		spatial.ensure();
	}

	/**
	 * @param playerPos world position of player (camera)
	 */
	update(dt: number, playerPos?: THREE.Vector3): void {
		if (this.path.length < 2) return;

		// Slow scrubbing pace
		this.t += dt * 0.28;
		if (this.t >= 1) {
			this.t = 0;
			this.i += this.pathDir;
			if (this.i >= this.path.length - 1) {
				this.i = this.path.length - 1;
				this.pathDir = -1;
			} else if (this.i <= 0) {
				this.i = 0;
				this.pathDir = 1;
				// Occasional route swap when looping back
				if (Math.random() < 0.35) this.resetPath(true);
			}
		}

		const cur = at(this.path, this.i);
		const next = this.path[this.i + this.pathDir] ?? cur;
		const p = cur.clone().lerp(next, this.t);
		// Ground-floor scrubber only
		p.y = 0;

		// Soft hunt: even a little in the way → drift onto your path
		let hunting = false;
		let huntYaw: number | null = null;
		if (playerPos && levelAt(playerPos.y) === 'v0') {
			const dx = playerPos.x - p.x;
			const dz = playerPos.z - p.z;
			const dist = Math.hypot(dx, dz);
			if (dist > 0.8 && dist < 16) {
				// Stronger when closer / slightly blocking the corridor
				const near = 1 - Math.min(1, dist / 16);
				const pull = 0.12 + near * 0.55; // up to ~0.67 blend toward player
				p.x += dx * pull * dt * 1.35;
				p.z += dz * pull * dt * 1.35;
				hunting = true;
				huntYaw = Math.atan2(dx, dz);
				// Slightly faster scrub when chasing a nuisance
				this.t += dt * 0.12 * near;
			}
		}

		// Wall / store collision for the scrubber body
		const r = this.world.resolveCircle(p.x, p.z, 0.5, this.radius, 4, true);
		p.x = r.x;
		p.z = r.z;

		this.blockedThisFrame = false;
		// Don't drive through the player — bounce the cart back a bit
		if (playerPos && levelAt(playerPos.y) === 'v0') {
			const sep = this.world.separate(p.x, p.z, playerPos.x, playerPos.z, this.radius + 0.45);
			const pushX = (sep.ax - p.x) * 0.9;
			const pushZ = (sep.az - p.z) * 0.9;
			if (pushX * pushX + pushZ * pushZ > 1e-8) {
				this.blockedThisFrame = true;
				p.x += pushX;
				p.z += pushZ;
				// Stall while blocked so he keeps yelling in place
				this.t = Math.max(0, this.t - dt * 0.5);
				const wr = this.world.resolveCircle(p.x, p.z, 0.5, this.radius, 2, true);
				p.x = wr.x;
				p.z = wr.z;
			}
		}

		this.mesh.position.set(p.x, p.y, p.z);
		this.pos.copy(this.mesh.position);

		const dir = next.clone().sub(cur);
		let yaw = this.mesh.rotation.y;
		if (hunting && huntYaw !== null) {
			yaw = huntYaw;
		} else if (dir.lengthSq() > 0.01) {
			yaw = Math.atan2(dir.x, dir.z);
		}
		let dy = yaw - this.mesh.rotation.y;
		while (dy > Math.PI) dy -= Math.PI * 2;
		while (dy < -Math.PI) dy += Math.PI * 2;
		this.mesh.rotation.y += dy * Math.min(1, dt * (hunting ? 5.5 : 4));

		// Spin wheels + scrub brush
		const spin = dt * 8;
		for (const w of this.wheels) w.rotation.x += spin;
		if (this.brush) this.brush.rotation.y += dt * 10;

		// Wet-floor sign bobs behind
		if (this.wetSign) {
			this.wetSign.position.y = 0.35 + Math.sin(performance.now() * 0.008) * 0.02;
		}

		this.yellCd = Math.max(0, this.yellCd - dt);
		this.chatCd -= dt;
		if (this.speechLife > 0) {
			this.speechLife -= dt;
			if (this.speechLife <= 0) this.speech.visible = false;
		}

		// Track proximity for "you keep standing there" yells
		if (playerPos && this.isPlayerInWay(playerPos)) {
			this.nearT += dt;
		} else {
			this.nearT = 0;
		}

		// Scold if: hard collision, or standing in the way ~0.35s
		if (playerPos && this.yellCd <= 0 && !this.speaking) {
			const shouldYell = this.blockedThisFrame || this.nearT >= 0.35 || this.isPlayerInWay(playerPos);
			if (shouldYell && (this.blockedThisFrame || this.nearT >= 0.35 || this.distTo(playerPos) < 2.8)) {
				void this.yellAtPlayer(playerPos);
			}
		}

		// Quiet ambient mutter (bubble only) when nobody in the way
		if (!this.speaking && this.speechLife <= 0 && this.chatCd <= 0 && this.yellCd <= 0 && this.nearT <= 0) {
			this.chatCd = 12 + Math.random() * 16;
			this.say(pick(['小心！地滑…', '慢慢走…', '又有炸鸡屑…', '我在工作!', '不好意思，借光', '地滑 地滑']), false);
		}
	}

	private distTo(player: THREE.Vector3): number {
		return Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
	}

	/** Same floor + close enough that Wei cares */
	private isPlayerInWay(player: THREE.Vector3): boolean {
		// Camera sits ~1.6m; floor 0 is y < ~4
		if (levelAt(player.y) !== 'v0') return false;
		const dist = this.distTo(player);
		if (dist > 5.5) return false;
		// Always angry when basically on top of the cart
		if (dist < 2.6) return true;
		// Wider cone: in front or just beside the path
		const yaw = this.mesh.rotation.y;
		this.tmpFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
		this.tmpTo.set(player.x - this.pos.x, 0, player.z - this.pos.z);
		if (this.tmpTo.lengthSq() < 1e-6) return true;
		this.tmpTo.normalize();
		const ahead = this.tmpFwd.dot(this.tmpTo);
		// ~130° front cone
		return ahead > -0.35;
	}

	private preloadClips(): void {
		for (const line of WEI_YELLS) {
			const a = new Audio(line.file);
			a.preload = 'auto';
			// touch load without playing
			a.load();
		}
	}

	private async yellAtPlayer(playerPos: THREE.Vector3): Promise<void> {
		this.yellCd = 3.5 + Math.random() * 2.5;
		this.speaking = true;
		this.nearT = 0;
		// pick a clip we didn't just use
		let idx = Math.floor(Math.random() * WEI_YELLS.length);
		if (idx === this.lastYellIdx && WEI_YELLS.length > 1) {
			idx = (idx + 1 + Math.floor(Math.random() * (WEI_YELLS.length - 1))) % WEI_YELLS.length;
		}
		this.lastYellIdx = idx;
		const line = at(WEI_YELLS, idx);
		this.say(line.label, true);
		this.onYell?.(line.label);

		// One voice only (was double: HTMLAudio + spatial)
		const d = this.distTo(playerPos);
		const vol = Math.max(0.5, Math.min(1, 1.1 - d * 0.07));
		try {
			spatial.ensure();
			const src = await spatial.playAt(
				line.file,
				{ x: this.pos.x, y: this.pos.y + 1.5, z: this.pos.z },
				{ volume: vol, k: 0.035, maxDistance: 24, refDistance: 2.5 },
			);
			if (!src) {
				// Fallback if fetch/decode fails — still only one path
				if (this.audioEl) {
					this.audioEl.pause();
					this.audioEl = null;
				}
				const el = new Audio(line.file);
				this.audioEl = el;
				el.volume = vol;
				await el.play();
			}
		} catch {
			/* autoplay blocked until user gesture */
		}

		window.setTimeout(() => {
			this.speaking = false;
		}, 2500);
	}

	private say(text: string, angry: boolean): void {
		const ctx = this.speechCtx;
		const w = 280;
		const h = 72;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = angry ? 'rgba(183,28,28,0.95)' : 'rgba(255,255,255,0.95)';
		ctx.strokeStyle = angry ? '#ffeb3b' : '#1565c0';
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.roundRect?.(8, 4, w - 16, h - 16, 10);
		if (!ctx.roundRect) {
			ctx.rect(8, 4, w - 16, h - 16);
		}
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = angry ? '#ffeb3b' : '#0d47a1';
		fitText(ctx, text, { x: 14, y: 6, w: w - 28, h: h - 26 }, { size: 20 });
		this.speechTex.needsUpdate = true;
		this.speech.visible = true;
		this.speechLife = angry ? 3.2 : 2.4;
	}

	private resetPath(keepPos = false): void {
		const routes = [
			[
				new THREE.Vector3(-22, 0, 12),
				new THREE.Vector3(-10, 0, 10),
				new THREE.Vector3(0, 0, 8),
				new THREE.Vector3(12, 0, 10),
				new THREE.Vector3(22, 0, 6),
				new THREE.Vector3(20, 0, -6),
				new THREE.Vector3(6, 0, -10),
				new THREE.Vector3(-8, 0, -8),
				new THREE.Vector3(-20, 0, -4),
				new THREE.Vector3(-24, 0, 6),
			],
			[
				new THREE.Vector3(-26, 0, 14),
				new THREE.Vector3(-14, 0, 12),
				new THREE.Vector3(-4, 0, 14),
				new THREE.Vector3(8, 0, 12),
				new THREE.Vector3(18, 0, 8),
				new THREE.Vector3(14, 0, 0),
				new THREE.Vector3(4, 0, -6),
				new THREE.Vector3(-10, 0, 0),
				new THREE.Vector3(-18, 0, 8),
			],
			[
				new THREE.Vector3(-12, 0, 6),
				new THREE.Vector3(0, 0, 4),
				new THREE.Vector3(12, 0, 6),
				new THREE.Vector3(16, 0, -4),
				new THREE.Vector3(0, 0, -8),
				new THREE.Vector3(-16, 0, -6),
				new THREE.Vector3(-20, 0, 2),
			],
		];
		const next = pick(routes);
		if (keepPos && this.path.length) {
			// Start new route from nearest waypoint
			let best = 0;
			let bestD = Infinity;
			const p = this.mesh.position;
			next.forEach((wp, i) => {
				const d = p.distanceToSquared(wp);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			});
			this.i = best;
			this.pathDir = best >= next.length - 1 ? -1 : 1;
		} else {
			this.i = 0;
			this.pathDir = 1;
		}
		this.path = next;
		this.t = 0;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private build(): THREE.Group {
		const g = new THREE.Group();

		const yellow = this.track(new THREE.MeshStandardMaterial({ color: 0xffc107, roughness: 0.55, metalness: 0.2 }));
		const blue = this.track(new THREE.MeshStandardMaterial({ color: 0x1565c0, roughness: 0.65 }));
		const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.7, metalness: 0.3 }));
		const grey = this.track(new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.4, roughness: 0.45 }));
		const rubber = this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
		const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.85 }));
		const hairM = this.track(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
		const uni = this.track(new THREE.MeshStandardMaterial({ color: 0x00695c, roughness: 0.75 }));

		// ── Ride-on scrubber chassis ──
		const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 1.35), yellow);
		body.position.set(0, 0.42, 0);
		g.add(body);
		// Blue service stripe
		const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 1.36), blue);
		stripe.position.set(0, 0.55, 0);
		g.add(stripe);

		// Seat
		const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.35), dark);
		seat.position.set(0, 0.72, -0.15);
		g.add(seat);
		const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.08), dark);
		backrest.position.set(0, 0.95, -0.3);
		g.add(backrest);

		// Steering column + wheel
		const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), grey);
		col.position.set(0, 0.85, 0.35);
		col.rotation.x = 0.35;
		g.add(col);
		const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14), rubber);
		wheel.position.set(0, 1.05, 0.48);
		wheel.rotation.x = Math.PI / 2.5;
		g.add(wheel);

		// Front scrub deck + spinning brush
		const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.12, 16), grey);
		deck.position.set(0, 0.12, 0.55);
		g.add(deck);
		this.brush = new THREE.Mesh(
			new THREE.CylinderGeometry(0.34, 0.34, 0.06, 16),
			this.track(new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.85 })),
		);
		this.brush.position.set(0, 0.06, 0.55);
		g.add(this.brush);
		// Brush bristle marks
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			const br = new THREE.Mesh(
				new THREE.BoxGeometry(0.28, 0.02, 0.04),
				this.track(new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.9 })),
			);
			br.position.set(Math.cos(a) * 0.05, 0.04, 0.55 + Math.sin(a) * 0.05);
			br.rotation.y = a;
			this.brush.add(br);
		}

		// Water tank behind
		const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.4), blue);
		tank.position.set(0, 0.7, -0.55);
		g.add(tank);
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), grey);
		cap.position.set(0, 0.96, -0.55);
		g.add(cap);

		// Wheels (4)
		const wgeo = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 12);
		const spots: [number, number, number][] = [
			[-0.42, 0.14, 0.4],
			[0.42, 0.14, 0.4],
			[-0.42, 0.14, -0.45],
			[0.42, 0.14, -0.45],
		];
		for (const [x, y, z] of spots) {
			const w = new THREE.Mesh(wgeo, rubber);
			w.rotation.z = Math.PI / 2;
			w.position.set(x, y, z);
			g.add(w);
			this.wheels.push(w);
		}

		// Side “SCHOONMAAK / 清洁” plate
		const plate = this.makePlate('清洁 CLEANING', '#1565c0', '#ffeb3b', 256, 64);
		const plateMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.7, 0.18),
			this.track(new THREE.MeshBasicMaterial({ map: plate, toneMapped: false })),
		);
		plateMesh.position.set(0.49, 0.55, 0.1);
		plateMesh.rotation.y = Math.PI / 2;
		g.add(plateMesh);
		const plate2 = plateMesh.clone();
		plate2.position.x = -0.49;
		plate2.rotation.y = -Math.PI / 2;
		g.add(plate2);

		// ── Cleaner Wei Chen sitting ──
		const person = new THREE.Group();
		person.position.set(0, 0.72, -0.12);

		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 3, 6), uni);
		const legR = legL.clone();
		legL.position.set(-0.1, 0.15, 0.05);
		legL.rotation.x = 1.1;
		legR.position.set(0.1, 0.15, 0.05);
		legR.rotation.x = 1.1;
		person.add(legL, legR);

		const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.35, 4, 8), uni);
		torso.position.y = 0.55;
		person.add(torso);

		// Reflective vest stripes
		const vest = new THREE.Mesh(
			new THREE.BoxGeometry(0.34, 0.12, 0.28),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xffeb3b,
					emissive: 0x665500,
					emissiveIntensity: 0.25,
					roughness: 0.6,
				}),
			),
		);
		vest.position.set(0, 0.6, 0.02);
		person.add(vest);

		const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), skin);
		head.position.y = 0.95;
		person.add(head);

		// Short black hair
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
		hair.position.set(0, 1.0, -0.01);
		person.add(hair);

		// Eyes
		const eyeM = this.track(new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
		const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeM);
		const e2 = e1.clone();
		e1.position.set(-0.045, 0.97, 0.12);
		e2.position.set(0.045, 0.97, 0.12);
		person.add(e1, e2);

		// Optional face mask (common)
		const mask = new THREE.Mesh(
			new THREE.BoxGeometry(0.14, 0.07, 0.04),
			this.track(new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 })),
		);
		mask.position.set(0, 0.9, 0.12);
		person.add(mask);

		// Arms on wheel
		const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.28, 3, 5), skin);
		armL.position.set(-0.2, 0.55, 0.25);
		armL.rotation.x = -0.9;
		armL.rotation.z = 0.3;
		const armR = armL.clone();
		armR.position.x = 0.2;
		armR.rotation.z = -0.3;
		person.add(armL, armR);

		// Hands on wheel
		const handL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), skin);
		handL.position.set(-0.12, 0.95, 0.42);
		const handR = handL.clone();
		handR.position.x = 0.12;
		person.add(handL, handR);

		g.add(person);

		// Name plate
		const name = this.makeSprite('WEI CHEN · 清洁工', '#00695c', 220, 44);
		name.position.set(0, 2.05, 0);
		name.scale.set(1.5, 0.32, 1);
		g.add(name);
		tagLevelCulled(name);

		// Speech bubble
		const { canvas: sc, ctx: speechCtx } = labelCanvas(280, 72);
		this.speechCtx = speechCtx;
		this.speechTex = labelTexture(sc);
		this.speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: this.speechTex,
				transparent: true,
				depthTest: true,
			}),
		);
		this.speech.scale.set(1.7, 0.44, 1);
		this.speech.position.set(0, 2.4, 0);
		this.speech.visible = false;
		// The bubble's own `visible` is the say/expire timer's, so the deck cull
		// gets a holder to switch instead of fighting over the same flag.
		const speechHolder = new THREE.Group();
		speechHolder.add(this.speech);
		g.add(speechHolder);
		tagLevelCulled(speechHolder);

		// Trailing wet-floor A-sign (hinged behind cart)
		this.wetSign = new THREE.Group();
		this.wetSign.position.set(0, 0.35, -1.05);
		const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 5), grey);
		signPole.position.y = -0.1;
		this.wetSign.add(signPole);
		const wetTex = this.makePlate('⚠ WET FLOOR\n小心地滑', '#ffeb3b', '#111', 256, 160);
		const wetBoard = new THREE.Mesh(
			new THREE.PlaneGeometry(0.55, 0.45),
			this.track(
				new THREE.MeshBasicMaterial({
					map: wetTex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
		wetBoard.position.y = 0.2;
		// tent shape: two planes
		const wetL = wetBoard.clone();
		wetL.position.z = -0.08;
		wetL.rotation.x = -0.35;
		const wetR = wetBoard.clone();
		wetR.position.z = 0.08;
		wetR.rotation.x = 0.35;
		this.wetSign.add(wetL, wetR);
		g.add(this.wetSign);

		// Mop sticking out the side
		const mopStick = new THREE.Mesh(
			new THREE.CylinderGeometry(0.015, 0.018, 1.1, 5),
			this.track(new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 })),
		);
		mopStick.position.set(0.55, 0.9, -0.2);
		mopStick.rotation.z = 0.25;
		mopStick.rotation.x = -0.3;
		g.add(mopStick);
		const mopHead = new THREE.Mesh(
			new THREE.SphereGeometry(0.12, 8, 6),
			this.track(new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.95 })),
		);
		mopHead.scale.set(1, 0.5, 1.2);
		mopHead.position.set(0.7, 0.45, 0.15);
		g.add(mopHead);

		return g;
	}

	private makePlate(text: string, bg: string, fg: string, w: number, h: number): THREE.CanvasTexture {
		const { canvas: c, ctx } = labelCanvas(w, h);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);
		ctx.strokeStyle = fg;
		ctx.lineWidth = 6;
		ctx.strokeRect(4, 4, w - 8, h - 8);
		ctx.fillStyle = fg;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const lines = text.split('\n');
		const fs = lines.length > 1 ? Math.floor(h * 0.28) : Math.floor(h * 0.38);
		ctx.font = `bold ${fs}px system-ui`;
		lines.forEach((line, i) => {
			const y = h / 2 + (i - (lines.length - 1) / 2) * (fs + 4);
			ctx.fillText(line, w / 2, y);
		});
		const tex = labelTexture(c);
		return tex;
	}

	private makeSprite(text: string, bg: string, w: number, h: number): THREE.Sprite {
		const { canvas: c, ctx } = labelCanvas(w, h);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#fff';
		ctx.font = `bold ${Math.floor(h * 0.4)}px system-ui`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2);
		const tex = labelTexture(c);
		return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
	}
}
