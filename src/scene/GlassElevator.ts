import * as THREE from 'three';
import { speakLine } from '@/audio/ElevenVoice';
import { LEVELS, type LevelId, level, levelAt, levelAtIndex, levelIndex, levelY } from '@/data/levels';
import { EYE } from '@/player/Controls';
import { fitText, labelCanvas, labelTexture } from '@/util/label';
import { pick } from '@/util/rand';
import { tagLevelCulled } from '@/util/visibility';

const FLOOR_B = levelY('p1');
const FLOOR0 = levelY('v0');

const FLOOR2 = levelY('roof');
const CABIN_H = 2.55;
const CABIN_W = 2.0;
const CABIN_D = 2.0;
const SPEED = 1.85; // m/s vertical

/** Halve breedte van het plein op dak en garage, rond het hart van de schacht. */
const PAD_HALF = 2.75;
/** Speling tussen de cabine en de rand van het schachtgat in dat plein. */
const SHAFT_GAP = 0.12;

/**
 * Het plein op dak en garage, met het schachtgat erin. Het gat volgt de
 * cabinemaat plus speling: wordt de cabine ooit breder, dan groeit het gat mee in
 * plaats van dat de cabine er weer doorheen begint te snijden.
 */
function padWithShaftHole(): THREE.ExtrudeGeometry {
	const shape = new THREE.Shape();
	shape.moveTo(-PAD_HALF, -PAD_HALF);
	shape.lineTo(PAD_HALF, -PAD_HALF);
	shape.lineTo(PAD_HALF, PAD_HALF);
	shape.lineTo(-PAD_HALF, PAD_HALF);
	shape.closePath();
	const hx = CABIN_W / 2 + SHAFT_GAP;
	const hz = CABIN_D / 2 + SHAFT_GAP;
	const hole = new THREE.Path();
	hole.moveTo(-hx, -hz);
	hole.lineTo(hx, -hz);
	hole.lineTo(hx, hz);
	hole.lineTo(-hx, hz);
	hole.closePath();
	shape.holes.push(hole);
	const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
	// Extrusie gaat +Z; leg hem plat en zet de bovenkant op y 0.
	geo.rotateX(-Math.PI / 2);
	// Zelfde dikte en zelfde loopvlak als de Box die hij vervangt.
	geo.translate(0, -0.06, 0);
	return geo;
}

// Roeppaal op het dak. Knop op borsthoogte: net onder ooghoogte, zodat je hem in
// je blikveld hebt zonder omhoog te kijken en zonder dat de paal het dek opvreet.
const CALL_BTN_Y = EYE - 0.42;
const CALL_BASE_R = 0.22;
const CALL_BASE_H = 0.14;
const CALL_POLE_R = 0.075;
/** Behuizing is de paal plus marge: een paneeltje, geen kast. */
const CALL_HOUSING_W = (CALL_POLE_R + 0.085) * 2;
const CALL_HOUSING_H = 0.4;
const CALL_HOUSING_D = 0.18;
const CALL_BTN_R = CALL_HOUSING_W * 0.3;
/** Bovenkant behuizing: alles wat erboven hangt wordt hiervan afgeleid. */
const CALL_TOP = CALL_BTN_Y + CALL_HOUSING_H / 2;

// Canvasmaat van bord en zwevend label. De mesh erft deze verhouding, dus het
// staat hier één keer: een tweede kopie bij de aanroeper rekt de tekst zodra
// iemand het canvas verandert.
const CALL_SIGN_TEX_W = 512;
const CALL_SIGN_TEX_H = 160;
const CALL_SPRITE_TEX_W = 512;
const CALL_SPRITE_TEX_H = 128;

/** Daniel — firm male (liftman energy) */
const HANS_VOICE = 'onwK4e9ZLuTAKqWW03F9';

const HANS_GREET = [
	'Goedemorgen. Welke verdieping mag het zijn?',
	'Instappen alstublieft. Ik rijd zo.',
	'Mooie glazen lift, hè? Niet tegen de ruit leunen.',
	'Stap in. Garage, winkels of dak — Hans regelt het.',
];
const HANS_LINES: Record<LevelId, string[]> = {
	p1: ["Parkeergarage. Let op auto's.", 'P1 garage. Ticket bij de kiosk.', 'Ondergronds. Lift terug is hier.'],
	v0: ['Begane grond. Let op de stap.', 'Begane grond. Deuren open.', 'Begane grond. Prettige dag verder.'],
	v1: ['Verdieping één. Kruidvat is links.', 'Eerste verdieping. Deuren open.', 'Verdieping één. Food court op het balkon.'],
	roof: ['Dak. Helipad en frisse lucht.', 'Dak. Niet van de rand vallen.', 'Dakterras. Helikopter is die kant op.'],
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
	private stop: LevelId = 'v0';
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

	get currentStop(): LevelId {
		return this.stop;
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
	requestFloor(id: LevelId): boolean {
		const stopY = levelY(id);
		if (Math.abs(stopY - this.cabinY) < 0.2) {
			this.hansSay('Je bent er al, baas.', true);
			return false;
		}
		this.stop = id;
		this.targetY = stopY;
		this.holdForCall = false;
		this.waitT = 0;
		this.moving = true;
		this.hansSay(`Naar ${level(id).name.toLowerCase()}. Deuren sluiten.`, true);
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
	getLookHit(camera: THREE.PerspectiveCamera, maxDist = 5.5): { kind: 'hans' | 'panel' | 'call'; level?: LevelId } | null {
		this.raycaster.setFromCamera(this.ndc, camera);
		this.raycaster.far = maxDist;
		const hits = this.raycaster.intersectObjects(this.interactables, true);
		for (const h of hits) {
			let o: THREE.Object3D | null = h.object;
			while (o) {
				const k = o.userData['elevInteract'];
				if (k === 'call') {
					return { kind: 'call', level: o.userData['elevFloor'] as LevelId };
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
	callToFloor(id: LevelId): boolean {
		const stopY = levelY(id);
		// Already here and idle → open doors
		if (!this.moving && Math.abs(stopY - this.cabinY) < 0.25) {
			this.waitT = Math.max(this.waitT, 3);
			this.holdForCall = false;
			this.hansSay(pick(HANS_LINES[id]), true);
			return true;
		}
		this.stop = id;
		this.targetY = stopY;
		this.holdForCall = false;
		this.waitT = 0;
		this.moving = true;
		this.hansSay(`Ik kom eraan — ${level(id).name.toLowerCase()}.`, true);
		return true;
	}

	private tagInteract(obj: THREE.Object3D, kind: string, id?: LevelId): void {
		obj.userData['elevInteract'] = kind;
		if (id !== undefined) obj.userData['elevFloor'] = id;
		obj.traverse((c) => {
			c.userData['elevInteract'] = kind;
			if (id !== undefined) c.userData['elevFloor'] = id;
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
			const mat = btn.material as THREE.MeshLambertMaterial;
			if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = pulse;
			btn.scale.setScalar(scale);
		}

		const inside = !!playerPos && this.contains(playerPos.x, playerPos.z) && Math.abs(playerPos.y - (this.cabinY + 1.6)) < 2.2;
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
					const next = levelIndex(this.stop) + this.travelDir;
					if (next >= LEVELS.length - 1) this.travelDir = -1;
					if (next <= 0) this.travelDir = 1;
					const i = THREE.MathUtils.clamp(levelIndex(this.stop) + this.travelDir, 0, LEVELS.length - 1);
					this.stop = levelAtIndex(i) ?? this.stop;
					this.targetY = levelY(this.stop);
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
					this.stop = levelAt(this.cabinY);
					if (inside || near) {
						this.hansSay(pick(HANS_LINES[this.stop]), true);
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
			this.liftman.rotation.y = THREE.MathUtils.lerp(this.liftman.rotation.y, face + Math.sin(this.t * 0.4) * 0.08, 0.08);
		}

		// Floor indicator
		const fl = this.cabinY < -2 ? 'P1' : this.cabinY > 10 ? 'DAK' : this.cabinY > 3 ? 'V1' : 'V0';
		this.paintSign(fl, this.waitT > 0 ? 'OPEN' : '▲▼');
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
		fitText(ctx, text, { x: 14, y: 8, w: w - 28, h: h - 28 }, { size: 16 });
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
			new THREE.MeshLambertMaterial({
				color: 0xb0bec5,
			}),
		);
		const glass = this.track(
			new THREE.MeshLambertMaterial({
				color: 0xa8d4f0,
				transparent: true,
				opacity: 0.18,
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
		const padMat = this.track(new THREE.MeshLambertMaterial({ color: 0x37474f }));
		const roofPadMat = this.track(
			new THREE.MeshLambertMaterial({
				color: 0x546e7a,
			}),
		);
		const garagePadMat = this.track(new THREE.MeshLambertMaterial({ color: 0x455a64 }));
		for (const { id, y, code } of LEVELS) {
			const isRoof = id === 'roof';
			const isGarage = id === 'p1';
			// Dak en garage krijgen een plein van 5.5 rond de schacht in plaats van
			// een smal perron ervoor. Dat plein ligt dus PAL over de cabine heen, dus
			// er moet een gat in: zonder dat gat rijd je op weg naar boven dwars door
			// een dichte plaat en zie je hem door je hoofd gaan. Het gat komt uit de
			// cabinemaat, zodat het niet los kan lopen als die verandert.
			const wide = isRoof || isGarage;
			const pad = wide
				? new THREE.Mesh(padWithShaftHole(), isRoof ? roofPadMat : garagePadMat)
				: new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.0), padMat);
			pad.position.set(0, y + 0.02, wide ? 0 : 1.55);
			this.group.add(pad);

			if (isRoof) {
				// Eén roeppaal, bij de schacht. De tweede stond halverwege de helipad-route
				// om het lopen te bekorten, maar op het dak laat App E al op ruime afstand van
				// de schacht werken (die radius hoort daar, niet nog eens hier) en de gele
				// streep plus het pijlbord wijzen de weg. Die paal was dus alleen massa.
				this.buildRoofCallStation(id, 2.6, 2.8);
				this.buildRoofWalkway();
			} else {
				// Compact landing call plate (P1 / V0 / V1)
				const btn = new THREE.Mesh(
					new THREE.BoxGeometry(0.32, 0.5, 0.14),
					this.track(
						new THREE.MeshLambertMaterial({
							color: isGarage ? 0x42a5f5 : 0xffc107,
							emissive: isGarage ? 0x1565c0 : 0xaa8800,
							emissiveIntensity: 0.55,
						}),
					),
				);
				btn.position.set(1.4, y + 1.25, 1.2);
				this.group.add(btn);
				this.tagInteract(btn, 'call', id);
				const label = this.makeCallSign(code, 1.1, 0.55);
				label.position.set(1.4, y + 1.75, 1.28);
				this.group.add(label);
				this.tagInteract(label, 'call', id);
			}
		}

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
	 * Slanke roeppaal op het dak: knop op borsthoogte, instapkant is +Z.
	 * @param localX/localZ relative to shaft center (group origin)
	 */
	private buildRoofCallStation(id: LevelId, localX: number, localZ: number): void {
		const station = new THREE.Group();
		station.position.set(localX, FLOOR2, localZ);

		const metal = this.track(
			new THREE.MeshLambertMaterial({
				color: 0x263238,
			}),
		);
		const green = this.track(
			new THREE.MeshLambertMaterial({
				color: 0x00e676,
				emissive: 0x00c853,
				emissiveIntensity: 1.1,
			}),
		);
		const redFrame = this.track(
			new THREE.MeshLambertMaterial({
				color: 0xc62828,
				emissive: 0x8b0000,
				emissiveIntensity: 0.35,
			}),
		);

		// Lage voetplaat: markeert de plek, is geen obstakel om overheen te struikelen
		const base = new THREE.Mesh(new THREE.CylinderGeometry(CALL_BASE_R, CALL_BASE_R + 0.06, CALL_BASE_H, 14), metal);
		base.position.y = CALL_BASE_H / 2;
		station.add(base);
		const pole = new THREE.Mesh(new THREE.CylinderGeometry(CALL_POLE_R, CALL_POLE_R + 0.02, CALL_BTN_Y, 10), metal);
		pole.position.y = CALL_BTN_Y / 2;
		station.add(pole);

		// Housing box so it reads as a CONTROL PANEL, not a ball
		const housing = new THREE.Mesh(new THREE.BoxGeometry(CALL_HOUSING_W, CALL_HOUSING_H, CALL_HOUSING_D), redFrame);
		housing.position.y = CALL_BTN_Y;
		station.add(housing);

		// Paddenstoelknop steekt net uit het paneel, genoeg om te zien dat je hem indrukt
		const face = CALL_HOUSING_D / 2;
		const btn = new THREE.Mesh(new THREE.CylinderGeometry(CALL_BTN_R, CALL_BTN_R + 0.01, 0.08, 20), green);
		btn.position.set(0, CALL_BTN_Y, face + 0.01);
		btn.rotation.x = Math.PI / 2;
		station.add(btn);
		this.tagInteract(btn, 'call', id);
		this.tagInteract(housing, 'call', id);
		this.roofCallBtns.push(btn);

		// Dome cap on button
		const dome = new THREE.Mesh(new THREE.SphereGeometry(CALL_BTN_R, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), green);
		dome.position.set(0, CALL_BTN_Y, face + 0.05);
		dome.rotation.x = Math.PI / 2;
		station.add(dome);
		this.tagInteract(dome, 'call', id);
		this.roofCallBtns.push(dome);

		// GEEN beacon-PointLight (emissive dome gloeit al — en elke light telt op
		// de Pi) en GEEN ring van vier dezelfde borden: dat was de bordenspam op
		// het dak. Eén bescheiden bordje aan de instapkant + één zwevend label.
		const signW = CALL_HOUSING_W * 2.2;
		const signH = signW * (CALL_SIGN_TEX_H / CALL_SIGN_TEX_W);
		const sign = this.makeCallSign('GROENE KNOP · E', signW, signH);
		sign.position.set(0, CALL_BTN_Y - CALL_HOUSING_H / 2 - signH / 2 - 0.04, CALL_POLE_R + 0.02);
		station.add(sign);
		this.tagInteract(sign, 'call', id);

		// Enige roeppaal op het dak, dus het label moet van de helipad-kant al opvallen:
		// het blijft breed, maar het hangt nu net boven de behuizing in plaats van los
		// in de lucht op een hoogte die uit de oude paal volgde.
		const spriteW = 2.0;
		const spriteH = spriteW * (CALL_SPRITE_TEX_H / CALL_SPRITE_TEX_W);
		const sp = this.makeCallSprite('🟢 LIFT · E');
		sp.position.set(0, CALL_TOP + 0.09 + spriteH / 2, 0);
		sp.scale.set(spriteW, spriteH, 1);
		station.add(sp);
		this.tagInteract(sp, 'call', id);
		// The station is bolted to the dak, unlike the cabin, so it can be culled
		tagLevelCulled(sp);

		// Gele ring om de voet: laag genoeg om als vloermarkering te lezen, maar net hoger
		// dan de streep en de chevrons uit buildRoofWalkway, anders z-fighten ze.
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(CALL_BASE_R * 2.3, 0.035, 6, 24),
			this.track(
				new THREE.MeshLambertMaterial({
					color: 0xffc107,
					emissive: 0xaa8800,
					emissiveIntensity: 0.25,
				}),
			),
		);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = 0.11;
		station.add(ring);

		this.group.add(station);
	}

	private makeCallSign(text: string, w: number, h: number): THREE.Mesh {
		const cw = CALL_SIGN_TEX_W;
		const ch = CALL_SIGN_TEX_H;
		const { canvas: c, ctx } = labelCanvas(cw, ch);
		ctx.fillStyle = '#0d47a1';
		ctx.fillRect(0, 0, cw, ch);
		ctx.strokeStyle = '#ffd700';
		ctx.lineWidth = 10;
		ctx.strokeRect(6, 6, cw - 12, ch - 12);
		ctx.fillStyle = '#ffd700';
		ctx.font = 'bold 42px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, cw / 2, ch / 2);
		const tex = labelTexture(c);
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
		const cw = CALL_SPRITE_TEX_W;
		const ch = CALL_SPRITE_TEX_H;
		const { canvas: c, ctx } = labelCanvas(cw, ch);
		ctx.fillStyle = 'rgba(0,100,0,0.92)';
		ctx.fillRect(0, 0, cw, ch);
		ctx.strokeStyle = '#ffd700';
		ctx.lineWidth = 8;
		ctx.strokeRect(4, 4, cw - 8, ch - 8);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 40px system-ui';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, cw / 2, ch / 2);
		const tex = labelTexture(c);
		return new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: tex,
				transparent: true,
				depthTest: true,
				toneMapped: false,
			}),
		);
	}

	private buildCabin(): void {
		const chrome = this.track(
			new THREE.MeshLambertMaterial({
				color: 0xcfd8dc,
			}),
		);
		const glass = this.track(
			new THREE.MeshLambertMaterial({
				color: 0xb3e5fc,
				transparent: true,
				opacity: 0.28,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		const floorMat = this.track(
			new THREE.MeshLambertMaterial({
				color: 0x455a64,
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
			this.track(new THREE.MeshLambertMaterial({ color: 0x263238 })),
		);
		panel.position.set(0.75, 1.25, -0.85);
		this.cabin.add(panel);
		this.tagInteract(panel, 'panel');
		for (let i = 0; i < 4; i++) {
			const b = new THREE.Mesh(
				new THREE.CircleGeometry(0.045, 10),
				this.track(
					new THREE.MeshLambertMaterial({
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

		const skin = this.track(new THREE.MeshLambertMaterial({ color: 0xc68642 }));
		const uni = this.track(new THREE.MeshLambertMaterial({ color: 0x1a237e }));
		const pants = this.track(new THREE.MeshLambertMaterial({ color: 0x0d1545 }));
		const gold = this.track(
			new THREE.MeshLambertMaterial({
				color: 0xffd700,
			}),
		);
		const hairM = this.track(new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));

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
			this.track(new THREE.MeshLambertMaterial({ color: 0x3e2723 })),
		);
		stache.position.set(0, 1.44, 0.13);
		g.add(stache);

		// Name plate
		const { canvas: c, ctx } = labelCanvas(256, 64);
		ctx.fillStyle = 'rgba(13,21,69,0.9)';
		ctx.fillRect(0, 0, 256, 64);
		ctx.fillStyle = '#ffd700';
		ctx.font = 'bold 22px system-ui';
		ctx.textAlign = 'center';
		fitText(ctx, 'HANS · Liftman', { x: 10, y: 6, w: 236, h: 26 }, { size: 22 });
		fitText(
			ctx,
			`Glazen lift · ${LEVELS.map((l) => l.code).join(' · ')}`,
			{ x: 8, y: 36, w: 240, h: 22 },
			{ size: 14, weight: '500', maxLines: 1 },
		);
		const tex = labelTexture(c);
		const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
		sp.scale.set(1.2, 0.3, 1);
		sp.position.set(0, 2.05, 0);
		g.add(sp);

		// Speech bubble
		const { canvas: sc, ctx: speechCtx } = labelCanvas(320, 80);
		this.speechCtx = speechCtx;
		this.speechTex = labelTexture(sc);
		// depthTest stays off: the bubble sits 2.47 m up in a 2.55 m cabin, so the
		// chrome ceiling would slice the top line off for everyone riding along
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
		const { canvas: c, ctx } = labelCanvas(384, 96);
		ctx.fillStyle = '#0d47a1';
		ctx.fillRect(0, 0, 384, 96);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 28px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('GLAZEN LIFT', 192, 40);
		ctx.font = '16px system-ui';
		ctx.fillText('P1 · V0 · V1 · DAK · Hans', 192, 72);
		const tex = labelTexture(c);
		const board = new THREE.Mesh(
			new THREE.PlaneGeometry(2.4, 0.6),
			this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
		);
		board.position.set(0, 3.4, 1.2);
		this.group.add(board);

		// Cabin floor display
		const { canvas: sc, ctx: __ctx } = labelCanvas(256, 96);
		this.signCtx = __ctx;
		this.signTex = labelTexture(sc);
		this.signSprite = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: this.signTex,
				transparent: true,
				depthTest: true,
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
