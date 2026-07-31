import { speakLine } from '@/audio/ElevenVoice';
import { at, pick } from '@/util/rand';
import * as THREE from 'three';

/** Parking garage deck */
const FLOOR_B = -6.0;
const FLOOR0 = 0.05;
const FLOOR1 = 6.05;
/** Roof deck (matches Helipad.ROOF_Y / Collision ROOF_H) */
const FLOOR2 = 13.95;
/** P1 → V0 → V1 → dak → back down */
const STOPS = [FLOOR_B, FLOOR0, FLOOR1, FLOOR2] as const;
const CABIN_H = 2.55;
const CABIN_W = 2.0;
const CABIN_D = 2.0;
const SPEED = 1.85; // m/s vertical
/** Daniel — firm male (liftman energy) */
const HANS_VOICE = 'onwK4e9ZLuTAKqWW03F9';

const HANS_GREET = [
	'Goedemorgen. Welke verdieping mag het zijn?',
	'Instappen alstublieft. Ik rijd zo.',
	'Mooie glazen lift, hè? Niet tegen de ruit leunen.',
	'Stap in. Garage, winkels of dak — Hans regelt het.',
];
const HANS_LINES: Record<0 | 1 | 2 | 3, string[]> = {
	0: ["Parkeergarage. Let op auto's.", 'P1 garage. Ticket bij de kiosk.', 'Ondergronds. Lift terug is hier.'],
	1: ['Begane grond. Let op de stap.', 'Begane grond. Deuren open.', 'Begane grond. Prettige dag verder.'],
	2: [
		'Verdieping één. Kruidvat is links.',
		'Eerste verdieping. Deuren open.',
		'Verdieping één. Food court op het balkon.',
	],
	3: ['Dak. Helipad en frisse lucht.', 'Dak. Niet van de rand vallen.', 'Dakterras. Helikopter is die kant op.'],
};

/**
 * Transparent glass elevator with liftman Hans.
 * Empty: auto-cycles. With a rider: holds doors open until requestFloor().
 * Hans greets / announces floors (ElevenLabs when credits allow).
 */
export class GlassElevator {
	readonly group = new THREE.Group();
	/** Shaft center XZ */
	readonly pos = new THREE.Vector3(16, 0, -8);
	private materials: THREE.Material[] = [];
	private cabin = new THREE.Group();
	private cabinFloor!: THREE.Mesh;
	private liftman!: THREE.Group;
	private doorL!: THREE.Mesh;
	private doorR!: THREE.Mesh;
	private cabinY = FLOOR0;
	private targetY = FLOOR0;
	/** wait at floor before next trip */
	private waitT = 2.5;
	private t = 0;
	/** index into STOPS — start at V0 */
	private stopIdx = 1;
	/** +1 up, -1 down (empty auto mode) */
	private travelDir = 1;
	/** When true, doors stay open until player picks a floor */
	private holdForCall = false;
	private moving = false;
	private signSprite!: THREE.Sprite;
	private signTex!: THREE.CanvasTexture;
	private signCtx!: CanvasRenderingContext2D;
	private speech!: THREE.Sprite;
	private speechTex!: THREE.CanvasTexture;
	private speechCtx!: CanvasRenderingContext2D;
	private speechLife = 0;
	private wasInside = false;
	private speakCd = 0;
	private speaking = false;
	private onLine: ((text: string) => void) | null = null;
	/** Meshes you can look at + press E (Hans, call buttons, cabin panel) */
	private interactables: THREE.Object3D[] = [];
	private raycaster = new THREE.Raycaster();
	private ndc = new THREE.Vector2(0, 0); // screen center (FPS look)
	/** Glowing roof call buttons (pulse in update) */
	private roofCallBtns: THREE.Mesh[] = [];

	constructor() {
		this.group.name = 'glassElevator';
		this.group.position.set(this.pos.x, 0, this.pos.z);
		this.buildShaft();
		this.buildCabin();
		this.buildLiftman();
		this.buildSigns();
		this.cabin.position.y = this.cabinY;
		this.group.add(this.cabin);
	}

	setLineCallback(cb: (text: string) => void): void {
		this.onLine = cb;
	}

	/** Current stop index 0=P1 … 3=DAK */
	get currentStop(): number {
		return this.stopIdx;
	}

	get isMoving(): boolean {
		return this.moving;
	}

	/** Doors open and waiting for a floor pick (or empty auto-wait) */
	get doorsOpen(): boolean {
		return !this.moving && this.waitT > 0;
	}

	/**
	 * Player picked a floor from Hans' menu.
	 * @returns false if already there or invalid
	 */
	requestFloor(stopIdx: number): boolean {
		const stopY = STOPS[stopIdx];
		if (stopY === undefined) return false;
		if (Math.abs(stopY - this.cabinY) < 0.2) {
			this.hansSay('Je bent er al, baas.', true);
			return false;
		}
		this.stopIdx = stopIdx;
		this.targetY = stopY;
		this.holdForCall = false;
		this.waitT = 0;
		this.moving = true;
		const labels = [
			'Naar de parkeergarage. Deuren sluiten.',
			'Naar begane grond. Deuren sluiten.',
			'Naar verdieping één. Deuren sluiten.',
			'Naar het dak. Deuren sluiten.',
		];
		this.hansSay(labels[stopIdx] ?? 'Deuren sluiten.', true);
		return true;
	}

	/** Keep doors open while rider is choosing (called from App when menu is up) */
	holdForPassenger(hold: boolean): void {
		this.holdForCall = hold;
		if (hold && !this.moving) this.waitT = Math.max(this.waitT, 1);
	}

	/** World Y of the cabin floor (player stands here) */
	get cabinFloorY(): number {
		return this.cabinY + 0.08;
	}

	/** True if feet XZ are inside the cabin footprint */
	contains(x: number, z: number, margin = 0.15): boolean {
		const hx = CABIN_W * 0.5 - margin;
		const hz = CABIN_D * 0.5 - margin;
		return Math.abs(x - this.pos.x) <= hx && Math.abs(z - this.pos.z) <= hz;
	}

	/** Result of looking at elevator controls (FPS reticle). */
	getLookHit(
		camera: THREE.PerspectiveCamera,
		maxDist = 5.5,
	): { kind: 'hans' | 'panel' | 'call'; floorIdx?: number } | null {
		this.raycaster.setFromCamera(this.ndc, camera);
		this.raycaster.far = maxDist;
		const hits = this.raycaster.intersectObjects(this.interactables, true);
		for (const h of hits) {
			let o: THREE.Object3D | null = h.object;
			while (o) {
				const k = o.userData['elevInteract'];
				if (k === 'call') {
					return { kind: 'call', floorIdx: o.userData['elevFloor'] };
				}
				if (k === 'hans') return { kind: 'hans' };
				if (k === 'panel') return { kind: 'panel' };
				o = o.parent;
			}
		}
		// Fallback: in cabin facing roughly toward Hans
		const cam = camera.position;
		if (!this.contains(cam.x, cam.z, 0.2)) return null;
		if (Math.abs(cam.y - (this.cabinY + 1.6)) > 2.5) return null;
		const forward = new THREE.Vector3();
		camera.getWorldDirection(forward);
		forward.y = 0;
		if (forward.lengthSq() < 1e-4) return { kind: 'hans' };
		forward.normalize();
		const hansWorld = new THREE.Vector3();
		this.liftman.getWorldPosition(hansWorld);
		const toHans = hansWorld.clone().sub(cam);
		toHans.y = 0;
		if (toHans.lengthSq() < 0.01) return { kind: 'hans' };
		toHans.normalize();
		if (forward.dot(toHans) > 0.35) return { kind: 'hans' };
		return null;
	}

	isLookingAtControls(camera: THREE.PerspectiveCamera, maxDist = 4.2): boolean {
		return this.getLookHit(camera, maxDist) !== null;
	}

	/**
	 * Summon cabin to a landing (outside call button).
	 * Does not open the destination menu — just brings Hans here.
	 */
	callToFloor(stopIdx: number): boolean {
		const stopY = STOPS[stopIdx];
		if (stopY === undefined) return false;
		// Already here and idle → open doors
		if (!this.moving && Math.abs(stopY - this.cabinY) < 0.25) {
			this.waitT = Math.max(this.waitT, 3);
			this.holdForCall = false;
			this.hansSay(pick(HANS_LINES[stopIdx as 0 | 1 | 2 | 3]), true);
			return true;
		}
		this.stopIdx = stopIdx;
		this.targetY = stopY;
		this.holdForCall = false;
		this.waitT = 0;
		this.moving = true;
		const names = ['parkeergarage', 'begane grond', 'verdieping één', 'dak'];
		this.hansSay(`Ik kom eraan — ${names[stopIdx]}.`, true);
		return true;
	}

	private tagInteract(obj: THREE.Object3D, kind: string, floorIdx?: number): void {
		obj.userData['elevInteract'] = kind;
		if (floorIdx !== undefined) obj.userData['elevFloor'] = floorIdx;
		obj.traverse((c) => {
			c.userData['elevInteract'] = kind;
			if (floorIdx !== undefined) c.userData['elevFloor'] = floorIdx;
		});
		this.interactables.push(obj);
	}

	/**
	 * Shaft volume for CollisionWorld.
	 * climbable: true → player (climb) can walk in; sims (no climb) bounce off all floors.
	 * No solid Hans — he's pure mesh so you don't clip-fight the liftman.
	 */
	getColliders(): {
		minX: number;
		maxX: number;
		minZ: number;
		maxZ: number;
		label: string;
		climbable?: boolean;
		minY?: number;
		maxY?: number;
	}[] {
		const cx = this.pos.x;
		const cz = this.pos.z;
		const half = 1.05;
		return [
			// Full shaft plug P1→dak: blocks sims walking through walls/glass
			{
				minX: cx - half,
				maxX: cx + half,
				minZ: cz - half,
				maxZ: cz + half,
				minY: -7.5,
				maxY: 16.5,
				label: 'elev_shaft',
				climbable: true,
			},
		];
	}

	/**
	 * @param playerPos optional — Hans only talks when you're near / inside
	 */
	update(dt: number, playerPos?: THREE.Vector3): void {
		this.t += dt;
		this.speakCd = Math.max(0, this.speakCd - dt);
		if (this.speechLife > 0) {
			this.speechLife -= dt;
			if (this.speechLife <= 0 && this.speech) this.speech.visible = false;
		}
		// Pulse dak call buttons so you can't miss them
		const pulse = 0.75 + 0.45 * Math.sin(this.t * 4.2);
		const scale = 1 + 0.12 * Math.sin(this.t * 3.1);
		for (const btn of this.roofCallBtns) {
			const mat = btn.material as THREE.MeshStandardMaterial;
			if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = pulse;
			btn.scale.setScalar(scale);
		}

		const inside =
			!!playerPos && this.contains(playerPos.x, playerPos.z) && Math.abs(playerPos.y - (this.cabinY + 1.6)) < 2.2;
		const near =
			!!playerPos &&
			Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z) < 5.5 &&
			Math.abs(playerPos.y - (this.cabinY + 1.6)) < 3.5;

		// Board: soft greet, hold still — NO menu / focus steal (E opens menu)
		if (inside && !this.wasInside) {
			this.hansSay(pick(HANS_GREET), false); // bubble only until they talk to Hans
			this.holdForCall = true;
			this.waitT = Math.max(this.waitT, 2);
			this.moving = false;
		}
		if (!inside && this.wasInside) {
			// Passenger left — resume empty auto-cycle after a short dwell
			this.holdForCall = false;
			if (!this.moving) this.waitT = Math.max(this.waitT, 2.5);
		}
		this.wasInside = inside;

		// Wait with doors open, or travel
		if (!this.moving) {
			// Doors open
			this.doorL.position.x = THREE.MathUtils.lerp(this.doorL.position.x, -0.95, 0.12);
			this.doorR.position.x = THREE.MathUtils.lerp(this.doorR.position.x, 0.95, 0.12);

			if (this.holdForCall || inside) {
				// Rider aboard — stay put until they pick a floor (or leave)
				this.waitT = Math.max(this.waitT, 0.5);
			} else {
				this.waitT -= dt;
				if (this.waitT <= 0) {
					// Empty auto-cycle only when nobody is riding
					const next = this.stopIdx + this.travelDir;
					if (next >= STOPS.length - 1) this.travelDir = -1;
					if (next <= 0) this.travelDir = 1;
					this.stopIdx = THREE.MathUtils.clamp(this.stopIdx + this.travelDir, 0, STOPS.length - 1);
					this.targetY = at(STOPS, this.stopIdx);
					this.moving = true;
				}
			}
		} else {
			// Doors closed while moving
			this.doorL.position.x = THREE.MathUtils.lerp(this.doorL.position.x, -0.42, 0.15);
			this.doorR.position.x = THREE.MathUtils.lerp(this.doorR.position.x, 0.42, 0.15);
			const dir = Math.sign(this.targetY - this.cabinY);
			if (dir !== 0) {
				this.cabinY += dir * SPEED * dt;
				if ((dir > 0 && this.cabinY >= this.targetY) || (dir < 0 && this.cabinY <= this.targetY)) {
					this.cabinY = this.targetY;
					this.moving = false;
					this.waitT = 3.2 + Math.random() * 1.5;
					this.stopIdx = this.nearestStopIdx(this.cabinY);
					if (inside || near) {
						const floor = this.stopIdx as 0 | 1 | 2 | 3;
						this.hansSay(pick(HANS_LINES[floor]), true);
						// Offer next choice if still aboard
						if (inside) this.holdForCall = true;
					}
				}
			} else {
				this.moving = false;
			}
		}

		this.cabin.position.y = this.cabinY;

		// Liftman idle + face player a bit when they're in cabin
		if (this.liftman) {
			this.liftman.position.y = 0.02 + Math.sin(this.t * 1.4) * 0.015;
			const face = inside ? Math.PI * 0.15 : Math.PI;
			this.liftman.rotation.y = THREE.MathUtils.lerp(
				this.liftman.rotation.y,
				face + Math.sin(this.t * 0.4) * 0.08,
				0.08,
			);
		}

		// Floor indicator
		const fl = this.cabinY < -2 ? 'P1' : this.cabinY > 10 ? 'DAK' : this.cabinY > 3 ? 'V1' : 'V0';
		this.paintSign(fl, this.waitT > 0 ? 'OPEN' : '▲▼');
	}

	private nearestStopIdx(y: number): number {
		let best = 0;
		let bestD = Infinity;
		STOPS.forEach((stopY, i) => {
			const d = Math.abs(stopY - y);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		return best;
	}

	/** Bubble always; ElevenLabs when quota allows (no browser robot voice). */
	private hansSay(text: string, withVoice: boolean): void {
		this.showBubble(text);
		this.onLine?.(text);
		if (!withVoice || this.speakCd > 0 || this.speaking) return;
		this.speakCd = 4.5;
		this.speaking = true;
		void speakLine(text, {
			voiceId: HANS_VOICE,
			lang: 'nl',
			volume: 0.9,
			allowBrowser: false,
			interrupt: true,
		}).finally(() => {
			this.speaking = false;
		});
	}

	private showBubble(text: string): void {
		if (!this.speechCtx) return;
		const ctx = this.speechCtx;
		const w = 320;
		const h = 80;
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = 'rgba(13,21,69,0.94)';
		ctx.strokeStyle = '#ffd700';
		ctx.lineWidth = 3;
		ctx.beginPath();
		if (ctx.roundRect) ctx.roundRect(6, 4, w - 12, h - 16, 10);
		else ctx.rect(6, 4, w - 12, h - 16);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#ffeb3b';
		ctx.font = 'bold 16px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		// wrap ~2 lines
		const words = text.split(' ');
		let l1 = '';
		let l2 = '';
		for (const word of words) {
			const t = (l1 ? `${l1} ` : '') + word;
			if (ctx.measureText(t).width < 290 && !l2) l1 = t;
			else l2 = (l2 ? `${l2} ` : '') + word;
		}
		if (l2) {
			ctx.fillText(l1.slice(0, 42), w / 2, h / 2 - 12);
			ctx.fillText(l2.slice(0, 42), w / 2, h / 2 + 10);
		} else {
			ctx.fillText(l1.slice(0, 44), w / 2, h / 2 - 2);
		}
		this.speechTex.needsUpdate = true;
		this.speech.visible = true;
		this.speechLife = 3.4;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private buildShaft(): void {
		const chrome = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xb0bec5,
				metalness: 0.85,
				roughness: 0.25,
			}),
		);
		const glass = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xa8d4f0,
				transparent: true,
				opacity: 0.18,
				roughness: 0.05,
				metalness: 0.1,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);

		// Full-height corner posts (garage → roof)
		const postBottom = FLOOR_B - 0.2;
		const postTop = FLOOR2 + 3.0;
		const postH = postTop - postBottom;
		const postMid = (postTop + postBottom) / 2;
		for (const [sx, sz] of [
			[-1.1, -1.1],
			[1.1, -1.1],
			[-1.1, 1.1],
			[1.1, 1.1],
		] as const) {
			const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, postH, 0.12), chrome);
			post.position.set(sx, postMid, sz);
			this.group.add(post);
		}

		// Glass shaft panels (N, W, E) — open south for boarding all floors
		for (const [x, z, w, d] of [
			[0, -1.12, 2.15, 0.04],
			[-1.12, 0, 0.04, 2.15],
			[1.12, 0, 0.04, 2.15],
		] as const) {
			const panel = new THREE.Mesh(new THREE.BoxGeometry(w, postH - 0.4, d), glass);
			panel.position.set(x, postMid, z);
			this.group.add(panel);
		}

		// Floor plates at landings P1 / V0 / V1 / dak
		const padMat = this.track(new THREE.MeshStandardMaterial({ color: 0x37474f, metalness: 0.4, roughness: 0.5 }));
		const roofPadMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x546e7a,
				metalness: 0.5,
				roughness: 0.45,
			}),
		);
		const garagePadMat = this.track(new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.85 }));
		const stopYs = [FLOOR_B, FLOOR0, FLOOR1, FLOOR2];
		const codes = ['P1', 'V0', 'V1', 'DAK'];
		stopYs.forEach((y, floorIdx) => {
			const isRoof = y > 10;
			const isGarage = y < -1;
			const pad = new THREE.Mesh(
				new THREE.BoxGeometry(isRoof || isGarage ? 5.5 : 2.6, 0.12, isRoof || isGarage ? 5.5 : 1.0),
				isRoof ? roofPadMat : isGarage ? garagePadMat : padMat,
			);
			pad.position.set(0, y + 0.02, isRoof || isGarage ? 0.6 : 1.55);
			this.group.add(pad);

			if (isRoof) {
				// Two stations: at shaft + midway to helipad (helipad is ~24 m north)
				this.buildRoofCallStation(floorIdx, 2.6, 2.8, true);
				this.buildRoofCallStation(floorIdx, 2.0, 12.5, false);
				this.buildRoofWalkway();
			} else {
				// Compact landing call plate (P1 / V0 / V1)
				const btn = new THREE.Mesh(
					new THREE.BoxGeometry(0.32, 0.5, 0.14),
					this.track(
						new THREE.MeshStandardMaterial({
							color: isGarage ? 0x42a5f5 : 0xffc107,
							emissive: isGarage ? 0x1565c0 : 0xaa8800,
							emissiveIntensity: 0.55,
							metalness: 0.3,
						}),
					),
				);
				btn.position.set(1.4, y + 1.25, 1.2);
				this.group.add(btn);
				this.tagInteract(btn, 'call', floorIdx);
				const label = this.makeCallSign(at(codes, floorIdx), 1.1, 0.55);
				label.position.set(1.4, y + 1.75, 1.28);
				this.group.add(label);
				this.tagInteract(label, 'call', floorIdx);
			}
		});

		// Soft light in shaft
		const light = new THREE.PointLight(0xe3f2fd, 2.2, 14, 2);
		light.position.set(0, 7, 0);
		this.group.add(light);
		const roofLight = new THREE.PointLight(0x00e676, 5, 18, 2);
		roofLight.position.set(2.2, FLOOR2 + 2.5, 2.5);
		this.group.add(roofLight);
	}

	/** Painted path from helipad approach → lift hatch */
	private buildRoofWalkway(): void {
		const paint = this.track(
			new THREE.MeshBasicMaterial({
				color: 0xffc107,
				toneMapped: false,
				transparent: true,
				opacity: 0.92,
			}),
		);
		// Strip along +Z (toward helipad)
		const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 14), paint);
		strip.position.set(2.2, FLOOR2 + 0.04, 7.5);
		this.group.add(strip);
		// Chevrons pointing to shaft
		for (let i = 0; i < 5; i++) {
			const chev = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.35), paint);
			chev.position.set(2.2, FLOOR2 + 0.06, 3 + i * 2.4);
			this.group.add(chev);
		}
		const arrow = this.makeCallSign('↓  LIFT / HANS  ↓', 3.2, 0.7);
		arrow.position.set(2.2, FLOOR2 + 0.08, 13.5);
		arrow.rotation.x = -Math.PI / 2;
		this.group.add(arrow);
	}

	/**
	 * Tall green call pedestal on the dak.
	 * @param localX/localZ relative to shaft center (group origin)
	 */
	private buildRoofCallStation(floorIdx: number, localX: number, localZ: number, primary: boolean): void {
		const station = new THREE.Group();
		station.position.set(localX, FLOOR2, localZ);

		const metal = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x263238,
				metalness: 0.55,
				roughness: 0.4,
			}),
		);
		const green = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00e676,
				emissive: 0x00c853,
				emissiveIntensity: 1.1,
				metalness: 0.15,
				roughness: 0.3,
			}),
		);
		const redFrame = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xc62828,
				emissive: 0x8b0000,
				emissiveIntensity: 0.35,
				metalness: 0.4,
				roughness: 0.4,
			}),
		);

		// Wide base plinth
		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.3, 14), metal);
		base.position.y = 0.15;
		station.add(base);
		const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 10), metal);
		pole.position.y = 1.45;
		station.add(pole);

		// Housing box so it reads as a CONTROL PANEL, not a ball
		const housing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.55), redFrame);
		housing.position.y = 2.85;
		station.add(housing);

		// Giant mushroom push-button (the actual "knop")
		const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.28, 20), green);
		btn.position.set(0, 2.95, 0.22);
		btn.rotation.x = Math.PI / 2;
		station.add(btn);
		this.tagInteract(btn, 'call', floorIdx);
		this.tagInteract(housing, 'call', floorIdx);
		this.roofCallBtns.push(btn);

		// Dome cap on button
		const dome = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), green);
		dome.position.set(0, 2.95, 0.36);
		dome.rotation.x = Math.PI / 2;
		station.add(dome);
		this.tagInteract(dome, 'call', floorIdx);
		this.roofCallBtns.push(dome);

		// GEEN beacon-PointLight (emissive dome gloeit al — en elke light telt op
		// de Pi) en GEEN ring van vier dezelfde borden: dat was de bordenspam op
		// het dak. Eén bescheiden bordje aan de instapkant + één zwevend label.
		const sign = this.makeCallSign('GROENE KNOP · E', 1.6, 0.55);
		sign.position.set(0, 1.7, 0.7);
		station.add(sign);
		this.tagInteract(sign, 'call', floorIdx);

		const sp = this.makeCallSprite(primary ? '🟢 LIFT · E' : '🟢 ROEP LIFT · E');
		sp.position.set(0, 3.9, 0);
		sp.scale.set(2.4, 0.65, 1);
		station.add(sp);
		this.tagInteract(sp, 'call', floorIdx);

		// Yellow hazard ring
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(1.0, 0.05, 6, 28),
			this.track(
				new THREE.MeshStandardMaterial({
					color: 0xffc107,
					metalness: 0.6,
					roughness: 0.3,
					emissive: 0xaa8800,
					emissiveIntensity: 0.25,
				}),
			),
		);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = 0.32;
		station.add(ring);

		this.group.add(station);
	}

	private makeCallSign(text: string, w: number, h: number): THREE.Mesh {
		const c = document.createElement('canvas');
		c.width = 512;
		c.height = 160;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#0d47a1';
		ctx.fillRect(0, 0, 512, 160);
		ctx.strokeStyle = '#ffd700';
		ctx.lineWidth = 10;
		ctx.strokeRect(6, 6, 500, 148);
		ctx.fillStyle = '#ffd700';
		ctx.font = 'bold 42px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 80);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Mesh(
			new THREE.PlaneGeometry(w, h),
			this.track(
				new THREE.MeshBasicMaterial({
					map: tex,
					side: THREE.DoubleSide,
					toneMapped: false,
				}),
			),
		);
	}

	private makeCallSprite(text: string): THREE.Sprite {
		const c = document.createElement('canvas');
		c.width = 512;
		c.height = 128;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = 'rgba(0,100,0,0.92)';
		ctx.fillRect(0, 0, 512, 128);
		ctx.strokeStyle = '#ffd700';
		ctx.lineWidth = 8;
		ctx.strokeRect(4, 4, 504, 120);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 40px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 256, 64);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: tex,
				transparent: true,
				depthTest: false,
				toneMapped: false,
			}),
		);
	}

	private buildCabin(): void {
		const chrome = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xcfd8dc,
				metalness: 0.7,
				roughness: 0.3,
			}),
		);
		const glass = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xb3e5fc,
				transparent: true,
				opacity: 0.28,
				roughness: 0.08,
				metalness: 0.15,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		const floorMat = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x455a64,
				metalness: 0.45,
				roughness: 0.4,
			}),
		);

		// Floor
		this.cabinFloor = new THREE.Mesh(new THREE.BoxGeometry(CABIN_W - 0.1, 0.1, CABIN_D - 0.1), floorMat);
		this.cabinFloor.position.y = 0.05;
		this.cabin.add(this.cabinFloor);

		// Ceiling
		const ceil = new THREE.Mesh(new THREE.BoxGeometry(CABIN_W - 0.1, 0.08, CABIN_D - 0.1), chrome);
		ceil.position.y = CABIN_H;
		this.cabin.add(ceil);
		const lamp = new THREE.PointLight(0xfff8e1, 3.5, 4, 2);
		lamp.position.set(0, CABIN_H - 0.15, 0);
		this.cabin.add(lamp);

		// Glass walls (N, W, E) + frame
		const wallH = CABIN_H - 0.2;
		const mkWall = (w: number, d: number, x: number, z: number) => {
			const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), glass);
			m.position.set(x, wallH / 2 + 0.1, z);
			this.cabin.add(m);
		};
		mkWall(CABIN_W - 0.15, 0.04, 0, -CABIN_D / 2 + 0.05);
		mkWall(0.04, CABIN_D - 0.15, -CABIN_W / 2 + 0.05, 0);
		mkWall(0.04, CABIN_D - 0.15, CABIN_W / 2 - 0.05, 0);

		// Sliding glass doors (south = boarding)
		this.doorL = new THREE.Mesh(new THREE.BoxGeometry(0.9, wallH - 0.1, 0.05), glass);
		this.doorL.position.set(-0.42, wallH / 2 + 0.1, CABIN_D / 2 - 0.04);
		this.cabin.add(this.doorL);
		this.doorR = this.doorL.clone();
		this.doorR.position.x = 0.42;
		this.cabin.add(this.doorR);

		// Handrail
		const rail = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 16, Math.PI), chrome);
		rail.rotation.x = Math.PI / 2;
		rail.position.set(0, 1.1, -0.75);
		this.cabin.add(rail);

		// Control panel (look + E)
		const panel = new THREE.Mesh(
			new THREE.BoxGeometry(0.32, 0.6, 0.1),
			this.track(new THREE.MeshStandardMaterial({ color: 0x263238, metalness: 0.5, roughness: 0.4 })),
		);
		panel.position.set(0.75, 1.25, -0.85);
		this.cabin.add(panel);
		this.tagInteract(panel, 'panel');
		for (let i = 0; i < 4; i++) {
			const b = new THREE.Mesh(
				new THREE.CircleGeometry(0.045, 10),
				this.track(
					new THREE.MeshStandardMaterial({
						color: i === 0 ? 0x42a5f5 : i === 3 ? 0x00e676 : 0xffc107,
						emissive: i === 0 ? 0x1565c0 : i === 3 ? 0x00c853 : 0xaa8800,
						emissiveIntensity: 0.5,
					}),
				),
			);
			b.position.set(0.75, 1.5 - i * 0.14, -0.78);
			this.cabin.add(b);
			this.tagInteract(b, 'panel');
		}
	}

	/** Liftman — uniform, cap; tucked in back corner so you don't stand inside him */
	private buildLiftman(): void {
		const g = new THREE.Group();
		// NW corner of cabin, clear of boarding path (+Z open side)
		g.position.set(-0.62, 0.02, -0.62);
		g.rotation.y = Math.PI * 0.75;

		const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.85 }));
		const uni = this.track(new THREE.MeshStandardMaterial({ color: 0x1a237e, roughness: 0.7 }));
		const pants = this.track(new THREE.MeshStandardMaterial({ color: 0x0d1545, roughness: 0.8 }));
		const gold = this.track(
			new THREE.MeshStandardMaterial({
				color: 0xffd700,
				metalness: 0.7,
				roughness: 0.3,
			}),
		);
		const hairM = this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));

		const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 3, 6), pants);
		const legR = legL.clone();
		legL.position.set(-0.09, 0.38, 0);
		legR.position.set(0.09, 0.38, 0);
		g.add(legL, legR);

		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 8), uni);
		body.position.y = 1.0;
		g.add(body);

		// Gold buttons
		for (let i = 0; i < 3; i++) {
			const btn = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), gold);
			btn.position.set(0, 1.15 - i * 0.12, 0.17);
			g.add(btn);
		}

		const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skin);
		head.position.y = 1.5;
		g.add(head);
		const hair = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM);
		hair.position.set(0, 1.56, -0.01);
		g.add(hair);

		// Cap
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.1, 12), uni);
		cap.position.set(0, 1.68, 0);
		g.add(cap);
		const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.12), uni);
		brim.position.set(0, 1.64, 0.12);
		g.add(brim);
		const badge = new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), gold);
		badge.position.set(0, 1.7, 0.17);
		g.add(badge);

		// Moustache
		const stache = new THREE.Mesh(
			new THREE.BoxGeometry(0.1, 0.02, 0.03),
			this.track(new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 })),
		);
		stache.position.set(0, 1.44, 0.13);
		g.add(stache);

		// Name plate
		const c = document.createElement('canvas');
		c.width = 256;
		c.height = 64;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = 'rgba(13,21,69,0.9)';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#ffd700';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('HANS · Liftman', 128, 28);
		ctx.font = '14px system-ui';
		ctx.fillText('Glazen lift · V0 ↔ V1', 128, 50);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
		sp.scale.set(1.2, 0.3, 1);
		sp.position.set(0, 2.05, 0);
		g.add(sp);

		// Speech bubble
		const sc = document.createElement('canvas');
		sc.width = 320;
		sc.height = 80;
		this.speechCtx = sc.getContext('2d')!;
		this.speechTex = new THREE.CanvasTexture(sc);
		this.speechTex.colorSpace = THREE.SRGBColorSpace;
		this.speech = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: this.speechTex,
				transparent: true,
				depthTest: false,
			}),
		);
		this.speech.scale.set(1.6, 0.4, 1);
		this.speech.position.set(0, 2.45, 0.1);
		this.speech.visible = false;
		g.add(this.speech);

		this.liftman = g;
		this.cabin.add(g);
		// Whole liftman is an E-target (look at Hans)
		this.tagInteract(g, 'hans');
	}

	private buildSigns(): void {
		// Overhead shaft sign
		const c = document.createElement('canvas');
		c.width = 384;
		c.height = 96;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#0d47a1';
		ctx.fillRect(0, 0, 384, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('GLAZEN LIFT', 192, 40);
		ctx.font = '16px system-ui';
		ctx.fillText('P1 · V0 · V1 · DAK · Hans', 192, 72);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const board = new THREE.Mesh(
			new THREE.PlaneGeometry(2.4, 0.6),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		board.position.set(0, 3.4, 1.2);
		this.group.add(board);

		// Cabin floor display
		const sc = document.createElement('canvas');
		sc.width = 256;
		sc.height = 96;
		this.signCtx = sc.getContext('2d')!;
		this.signTex = new THREE.CanvasTexture(sc);
		this.signTex.colorSpace = THREE.SRGBColorSpace;
		this.signSprite = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: this.signTex,
				transparent: true,
				depthTest: false,
			}),
		);
		this.signSprite.scale.set(0.9, 0.34, 1);
		this.signSprite.position.set(0, 2.35, 0.2);
		this.cabin.add(this.signSprite);
		this.paintSign('V0', 'OPEN');
	}

	private paintSign(floor: string, state: string): void {
		const ctx = this.signCtx;
		ctx.fillStyle = '#111';
		ctx.fillRect(0, 0, 256, 96);
		ctx.fillStyle = '#00e676';
		ctx.font = 'bold 40px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText(floor, 90, 58);
		ctx.fillStyle = '#ffc107';
		ctx.font = 'bold 22px system-ui';
		ctx.fillText(state, 180, 58);
		this.signTex.needsUpdate = true;
	}
}
