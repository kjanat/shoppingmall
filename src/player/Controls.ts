import type { PerspectiveCamera } from 'three';
import { Euler, Vector3 } from 'three';
import { ATRIUM_VOID, MALL_SHELL } from '#/data/layout';
import type { LevelId } from '#/data/levels';
import { levelAt } from '#/data/levels';
import type { CollisionWorld } from '#/physics/Collision';
import { WALK_STEP } from '#/physics/Collision';
import {
	AIR_STEP,
	CROUCH_EYE,
	CROUCH_HEADROOM,
	CROUCH_LEG_TUCK,
	CROUCH_RATE,
	CROUCH_SPEED,
	EYE,
	GRAVITY,
	GROUND_FOLLOW_RATE,
	GROUND_SNAP_EPSILON,
	JUMP_V,
	PLAYER_RADIUS,
	RUN_SPEED,
	STANCE_SETTLE,
	STAND_HEADROOM,
	WALK_SPEED,
} from '#/player/constants';
import { CITY_BOUNDS, outsideMallFootprint } from '#/scene/city/cityPlan';
import { isTypingTarget } from '#/util/dom';
import { clamp, ease, half, lerp } from '#/util/math';

const ACCEL = 46;
const FRICTION = 26;
const AIR_ACCEL = 9;
/**
 * Extra vaart vooruit op het moment van afzetten (m/s). Rennend springen komt
 * daarmee op 5,3 m/s en over de 0,61 s dat de sprong duurt op 3,2 m grond: een
 * verspringende amateur haalt dat, een staande sprong nooit.
 */
const JUMP_LUNGE = 0.8;
/** Waterdiepte waarbij je maximaal geremd bent: borstdiep. */
const WADE_DEEP = 1.15;
/** Wat er van je loopsnelheid over is als je tot je borst in het water staat. */
const WADE_SPEED = 0.45;
/** Zo ver zakt je ooghoogte dan weg. Meer en je kijkt door de waterspiegel heen. */
const WADE_SINK = 0.22;
const PITCH_MAX = 1.45;
/** rad per pixel */
const LOCK_SENS = 0.0022;
const DRAG_SENS = 0.003;
const TOUCH_SENS = 0.0045;
const STICK_MAX = 64;
/** keyboard turning, rad/s */
const TURN_SPEED = 2.2;
const PITCH_SPEED = 1.2;
/** Rennend draai je sneller: keer de toets-draaisnelheid hiermee. */
const SPRINT_TURN_SCALE = 1.5;
/** Rijdend kijk je minder ver omlaag en omhoog dan lopend, als fractie van PITCH_MAX. */
const DRIVE_PITCH_DOWN = 0.7;
const DRIVE_PITCH_UP = 0.55;

/** Analoge kijkstick: kleiner dan dit is trillen, geen duw. */
const LOOK_STICK_DEADZONE = 0.15;
/** Toetsen-stuur onder dit niveau telt als geen stuur, en de stick neemt het over. */
const KEY_STEER_EPSILON = 0.05;
/** Onder deze wenslengte sta je stil; erboven loopt de bob en telt de looprichting. */
const MOVE_EPSILON = 0.01;
/** Loop je op de analoge stick, dan is dit de minimale duw zodat half indrukken niet kruipt. */
const MIN_ANALOG_PUSH = 0.4;
/** Touch: het linkerdeel van het scherm is de rijstick, de rest kijkt rond. */
const TOUCH_DRIVE_ZONE = 0.4;

/** Landingsknik: hoe diep de camera zakt per m/s inslag, en de bovengrens eraan (m). */
const LAND_DIP_PER_SPEED = 0.014;
const LAND_DIP_MAX = 0.16;
/** Loop-bob: hieronder geen bob (m/s), basisfrequentie en hoeveel de pas hem versnelt (1/s), en de uitslag (m). */
const BOB_MIN_SPEED = 0.3;
const BOB_BASE_FREQ = 5.5;
const BOB_SPEED_FREQ = 1.15;
const BOB_AMPLITUDE = 0.055;
/** Hoe snel bob, landingsknik, zijhelling en het wegzakken in water terugveren (1/s). */
const BOB_SETTLE_RATE = 8;
const DIP_SETTLE_RATE = 7;
const LEAN_RATE = 6;
const SINK_RATE = 8;
/** Zijwaartse helling tijdens strafen, rennend en lopend (rad). */
const LEAN_SPRINT = 0.02;
const LEAN_WALK = 0.013;

/** Drone en heli: topsnelheid (m/s), hoe traag ze die halen (1/s), en de stijg/daalsnelheid (m/s). */
const FLIGHT_DRONE = { speed: 9, accel: 3.5, vSpeed: 6 } as const;
const FLIGHT_HELI = { speed: 15, accel: 1.6, vSpeed: 7.5 } as const;
/** Boven deze voethoogte ben je vrij van de mall en geldt alleen de wereldrand (m). */
const FLIGHT_ABOVE_MALL_Y = 14.2;
/** Botsingsstraal van het vliegende stoeltje (m). */
const FLIGHT_RADIUS = 0.7;
/** Zoveel smaller dan het atriumgat blijft de drone eronder vrij van de rand (m). */
const VOID_INSET = 0.6;
/** Binnen de mall onder deze hoogte drukt het plafond je omlaag; het atriumgat en buiten laten je door (m). */
const FLIGHT_CEILING_TRIGGER_Y = 13.4;
const FLIGHT_MALL_CEILING = 12.6;
const FLIGHT_SKY_CEILING = 55;
/** Grove grondstap terwijl je vliegt (m). */
const FLIGHT_GROUND_STEP = 2.5;
/** Zo hoog blijf je boven de vloer of de waterspiegel zweven (m). */
const FLIGHT_FLOOR_CLEARANCE = 0.45;
/** Ooghoogte in het stoeltje (m). */
const FLIGHT_EYE = 0.55;
/** Het stoeltje rolt mee met de zijsnelheid (rad per m/s). */
const FLIGHT_BANK = 0.004;

/**
 * How you steer. `turnWithKeys` is the no-mouse mode: A/D (and ←/→) swing the
 * whole camera like a tank instead of side-stepping.
 */
interface ControlSettings {
	turnWithKeys: boolean;
	mouseLook: boolean;
	/** 0 = left button, 2 = right button (left-handed mice) */
	lookButton: 0 | 2;
	sensitivity: number;
	invertY: boolean;
}

const DEFAULT_SETTINGS: ControlSettings = {
	turnWithKeys: false,
	mouseLook: true,
	lookButton: 0,
	sensitivity: 1,
	invertY: false,
};

/**
 * GTA-style first-person controller: click to capture the mouse, WASD to walk,
 * Shift to run, Space to hop. Nothing orbits a centre point — yaw/pitch are the
 * only camera state, so the view always sits behind the player's eyes.
 *
 * Escalator and stairs are ramps here (see CollisionWorld.groundHeightAt), so you
 * can actually reach floor 1 on foot instead of circling the ground floor.
 */
class PlayerControls {
	enabled = true;
	locked = false;
	settings: ControlSettings = { ...DEFAULT_SETTINGS };
	onLockChange: ((locked: boolean) => void) | null = null;

	private cam: PerspectiveCamera;
	private dom: HTMLElement;
	private world: CollisionWorld;

	private keys = new Set<string>();
	private yaw = 0;
	private pitch = 0;
	private vel = new Vector3();
	private vy = 0;
	private grounded = true;
	private feetY = 0;
	private bobT = 0;
	private bob = 0;
	private dip = 0;
	private lean = 0;
	/** Water boven de voeten (m) en hoe ver de camera daarvoor al gezakt is. */
	private wade = 0;
	private sink = 0;
	/**
	 * Hoe diep de knieën gebogen zijn: 0 is rechtop, 1 is volledig gehurkt.
	 *
	 * Eén waarde stuurt de ooghoogte, de loopsnelheidsdrempel en de vrije hoogte die
	 * je nodig hebt. Twee losse waarden lieten je halverwege het strekken al een spleet
	 * in lopen waar je hoofd nog niet in paste.
	 */
	private stance = 0;
	private crouched = false;

	/**
	 * Ligt er een E-actie klaar (liftknop, instappen, glijbaan)? App weet dat en
	 * zet het hier neer. Zolang het aan staat draait E niet mee, anders zwaait je
	 * beeld weg op het moment dat je de knop indrukt.
	 */
	private interactOnE = false;

	private dragging = false;
	private lastX = 0;
	private lastY = 0;
	/** touch: analog stick + look finger */
	private stickId = -1;
	private lookId = -1;
	private stickOx = 0;
	private stickOz = 0;
	private axisX = 0;
	private axisY = 0;
	private jumpQueued = false;

	constructor(camera: PerspectiveCamera, dom: HTMLElement, world: CollisionWorld) {
		this.cam = camera;
		this.dom = dom;
		this.world = world;
		this.syncFromCamera();

		globalThis.addEventListener('keydown', this.onKeyDown);
		globalThis.addEventListener('keyup', this.onKeyUp);
		globalThis.addEventListener('blur', this.onBlur);
		this.dom.addEventListener('pointerdown', this.onPointerDown);
		this.dom.addEventListener('contextmenu', this.onContextMenu);
		globalThis.addEventListener('pointerup', this.onPointerUp);
		globalThis.addEventListener('pointercancel', this.onPointerUp);
		globalThis.addEventListener('pointermove', this.onPointerMove);
		document.addEventListener('pointerlockchange', this.onLockChangeEvent);
	}

	/** Swap control scheme at runtime; releases the mouse if look is turned off. */
	applySettings(next: Partial<ControlSettings>): void {
		this.settings = { ...this.settings, ...next };
		if (!this.settings.mouseLook) this.releaseLook();
	}

	/** App meldt per frame of E hier iets doet; veert vanzelf terug als je wegkijkt. */
	setInteractOnE(available: boolean): void {
		this.interactOnE = available;
	}

	dispose(): void {
		globalThis.removeEventListener('keydown', this.onKeyDown);
		globalThis.removeEventListener('keyup', this.onKeyUp);
		globalThis.removeEventListener('blur', this.onBlur);
		this.dom.removeEventListener('pointerdown', this.onPointerDown);
		this.dom.removeEventListener('contextmenu', this.onContextMenu);
		globalThis.removeEventListener('pointerup', this.onPointerUp);
		globalThis.removeEventListener('pointercancel', this.onPointerUp);
		globalThis.removeEventListener('pointermove', this.onPointerMove);
		document.removeEventListener('pointerlockchange', this.onLockChangeEvent);
	}

	get heading(): number {
		return this.yaw;
	}

	/**
	 * Which deck the player is standing on (for the minimap). Gemeten vanaf de
	 * waterlijn: in het dakbad hangen je voeten onder de dakplaat, maar je staat
	 * nog steeds op het dak.
	 */
	get level(): LevelId {
		return levelAt(this.feetY + this.wade);
	}

	/**
	 * Drone-vlucht: geen zwaartekracht, Space = stijgen, Shift = dalen, WASD
	 * horizontaal. Binnen de mall gelden de muren en het plafond; boven het
	 * atrium (of buiten de muren) mag je omhoog de stad in.
	 */
	flying = false;
	/** Drone = wendbaar; heli = zwaarder en sneller (flight-sim-gevoel). */
	flightProfile: 'drone' | 'heli' = 'drone';
	/**
	 * Riding a ground vehicle (scrubber buggy). Walk physics off;
	 * only look + drive input axes are active.
	 */
	driving = false;

	/** True while feet are on a surface (belts only convey grounded players). */
	get isGrounded(): boolean {
		return this.grounded;
	}

	/** Feet height in world units. */
	get feetHeight(): number {
		return this.feetY;
	}

	/** Camera height above the feet right now, between the standing and crouching profiles. */
	get eyeHeight(): number {
		return lerp(EYE, CROUCH_EYE, this.stance);
	}

	get unclamped(): boolean {
		return outsideMallFootprint(this.feetY);
	}

	/**
	 * Uit de geometrie stappen waar je in staat, zonder een stap te zetten.
	 *
	 * Wie op een opgeslagen punt terugkomt of ergens heen gezet wordt kan in een muur
	 * of in een voertuig belanden, en daar loop je niet meer uit: elke stap wordt
	 * teruggeduwd naar waar je al klem stond.
	 */
	unstick(): void {
		const p = this.cam.position;
		const los = this.world.unstickBody(p.x, p.z, this.feetY, this.unclamped, PLAYER_RADIUS);
		if (los.x === p.x && los.z === p.z) return;
		p.x = los.x;
		p.z = los.z;
		this.syncFromCamera();
	}

	/**
	 * Aanrijding: de auto zet je in beweging en de zwaartekracht doet de rest.
	 * Geen schade-systeem — je vliegt, je landt, je staat weer op.
	 */
	launch(vx: number, vz: number, vy: number): void {
		if (this.flying || this.driving || this.elevFloorY !== null) return;
		this.vel.x = vx;
		this.vel.z = vz;
		this.vy = vy;
		this.grounded = false;
	}

	/**
	 * Glass elevator ride mode. While set, gravity + groundHeightAt are ignored
	 * so the cabin can carry you between floors without stuttering.
	 * Pass `null` to disembark.
	 */
	private elevFloorY: number | null = null;

	setElevatorRide(cabinFloorY: number | null): void {
		this.elevFloorY = cabinFloorY;
		if (cabinFloorY !== null) {
			this.feetY = cabinFloorY;
			this.vy = 0;
			this.grounded = true;
			this.jumpQueued = false;
			this.cam.position.y = cabinFloorY + this.eyeHeight + this.bob - this.dip;
		}
	}

	get isRidingElevator(): boolean {
		return this.elevFloorY !== null;
	}

	/** @deprecated use setElevatorRide */
	snapToElevator(cabinFloorY: number): void {
		this.setElevatorRide(cabinFloorY);
	}

	/**
	 * Past het hoofd op (x, z)?
	 *
	 * De eis loopt met de knieën mee in plaats van met de houding die je wilt: zou hij
	 * meteen op de gehurkte waarde springen, dan kruipt een lichaam dat nog half
	 * gestrekt is een spleet in waar het niet in past.
	 */
	private fits(x: number, z: number): boolean {
		return this.world.headroomAt(x, z, this.feetY) >= lerp(STAND_HEADROOM, CROUCH_HEADROOM, this.stance);
	}

	/** External displacement (moving walkway) — applied through collision. */
	nudge(dx: number, dz: number): void {
		const p = this.cam.position;
		const solved = this.world.resolveCircle(
			p.x + dx,
			p.z + dz,
			this.feetY,
			PLAYER_RADIUS,
			2,
			true,
			!this.grounded,
			this.unclamped,
		);
		if (!this.fits(solved.x, solved.z)) return;
		p.x = solved.x;
		p.z = solved.z;
	}

	/** Adopt whatever the cinematic camera ended on. */
	syncFromCamera(): void {
		const e = new Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
		this.yaw = e.y;
		this.pitch = clamp(e.x, -PITCH_MAX, PITCH_MAX);
		this.feetY = this.world.groundHeightAt(this.cam.position.x, this.cam.position.z, this.cam.position.y - this.eyeHeight);
		this.vel.set(0, 0, 0);
		this.vy = 0;
		this.grounded = true;
		this.bob = 0;
		this.dip = 0;
		this.wade = 0;
		this.sink = 0;
		this.stance = 0;
		this.crouched = false;
		this.keys.clear();
		this.axisX = 0;
		this.axisY = 0;
	}

	/** Turn to face a world point without moving (used on arrival). */
	lookAtPoint(p: Vector3): void {
		const dx = p.x - this.cam.position.x;
		const dz = p.z - this.cam.position.z;
		if (dx * dx + dz * dz > 1e-4) this.yaw = Math.atan2(-dx, -dz);
		const dy = p.y - this.cam.position.y;
		const flat = Math.hypot(dx, dz);
		this.pitch = clamp(Math.atan2(dy, Math.max(0.001, flat)), -PITCH_MAX, PITCH_MAX);
	}

	releaseLook(): void {
		if (document.pointerLockElement) document.exitPointerLock();
		this.dragging = false;
	}

	/**
	 * Axes for vehicle arcade drive (scrubber buggy).
	 * throttle: W/S, steer: A/D (or Q/E), boost: Shift.
	 */
	getDriveInput(): {
		throttle: number;
		steer: number;
		boost: boolean;
	} {
		let throttle = this.axisY;
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1;
		let steer = 0;
		// A/D (+ arrows). Q also steers left; E is reserved for exit vehicle.
		if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) {
			steer += 1;
		}
		if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
			steer -= 1;
		}
		// stick X as steer when no keys
		if (Math.abs(steer) < KEY_STEER_EPSILON) steer = -this.axisX;
		return {
			throttle: clamp(throttle, -1, 1),
			steer: clamp(steer, -1, 1),
			boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
		};
	}

	/** Snap look yaw to vehicle heading (call on board / each frame optional) */
	setHeading(yaw: number): void {
		this.yaw = yaw;
		this.wrapYaw();
	}

	/** While driving: pitch look only; yaw is forced to vehicle heading by App */
	private updateDriveLook(dt: number): void {
		let tilt = 0;
		if (this.keys.has('KeyR')) tilt += 1;
		if (this.keys.has('KeyF')) tilt -= 1;
		if (tilt !== 0) {
			this.pitch = clamp(this.pitch + tilt * PITCH_SPEED * dt, -PITCH_MAX * DRIVE_PITCH_DOWN, PITCH_MAX * DRIVE_PITCH_UP);
		}
		// Mouse look still adjusts pitch via pointermove (yaw ignored while driving)
		this.cam.rotation.order = 'YXZ';
		this.cam.rotation.set(this.pitch, this.yaw, 0);
		this.vel.set(0, 0, 0);
		this.vy = 0;
		this.grounded = true;
		this.jumpQueued = false;
		this.wade = 0;
		this.stance = 0;
		this.crouched = false;
	}

	update(dt: number): void {
		if (!this.enabled) return;
		if (this.flying) {
			this.updateFlight(dt);
			return;
		}
		// Ground vehicle: look only — ScrubberBuggy owns translation
		if (this.driving) {
			this.updateDriveLook(dt);
			return;
		}

		const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
		const p = this.cam.position;
		// Waden: één afgeleide waarde stuurt zowel de rem als hoe diep je wegzakt
		this.wade = this.world.waterDepthAt(p.x, p.z, this.feetY);
		const wadeT = Math.min(1, this.wade / WADE_DEEP);

		// ── Hurken ───────────────────────────────────────────
		// Ctrl buigt de knieën, en wie onder iets laags staat blijft gebogen tot er
		// weer een staande hoogte boven hem is: strekken onder een plaat zet je hoofd
		// erin. De stand loopt met `ease` en klapt op zijn eindwaarde, want de sprong
		// vraagt of de knieën écht gestrekt zijn en "bijna" is daar geen antwoord op.
		const wantsCrouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
		this.crouched = wantsCrouch || this.world.headroomAt(p.x, p.z, this.feetY) < STAND_HEADROOM;
		const stanceTarget = this.crouched ? 1 : 0;
		const eased = ease(this.stance, stanceTarget, CROUCH_RATE, dt);
		this.stance = Math.abs(stanceTarget - eased) < STANCE_SETTLE ? stanceTarget : eased;

		// ── Steering ─────────────────────────────────────────
		// Q always turns, so a mouseless player is never stuck facing one way. E doet
		// dat ook, maar wijkt voor de interactie zodra er een knop klaarligt.
		let turn = 0;
		if (this.keys.has('KeyQ')) turn += 1;
		if (this.keys.has('KeyE') && !this.interactOnE) turn -= 1;
		let fwd = this.axisY;
		let strafe = this.axisX;
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;

		const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
		const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
		if (this.settings.turnWithKeys) {
			// Tank mode: left/right swing the view instead of side-stepping
			if (right) turn -= 1;
			if (left) turn += 1;
		} else {
			if (right) strafe += 1;
			if (left) strafe -= 1;
		}

		if (turn !== 0) {
			this.yaw += turn * TURN_SPEED * (sprint ? SPRINT_TURN_SCALE : 1) * dt;
			this.wrapYaw();
		}
		// R/F tilt, for people who never touch the mouse
		let tilt = 0;
		if (this.keys.has('KeyR')) tilt += 1;
		if (this.keys.has('KeyF')) tilt -= 1;
		if (tilt !== 0) {
			this.pitch = clamp(this.pitch + tilt * PITCH_SPEED * dt, -PITCH_MAX, PITCH_MAX);
		}

		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);

		// Wish direction in world space (forward = where you look)
		let wx = 0;
		let wz = 0;
		fwd = clamp(fwd, -1, 1);
		strafe = clamp(strafe, -1, 1);

		wx = -sin * fwd + cos * strafe;
		wz = -cos * fwd - sin * strafe;
		const wishLen = Math.hypot(wx, wz);
		const moving = wishLen > MOVE_EPSILON;
		if (moving) {
			wx /= wishLen;
			wz /= wishLen;
		}

		const gait = this.crouched ? CROUCH_SPEED : sprint ? RUN_SPEED : WALK_SPEED;
		const speed = gait * clamp(wishLen, moving ? MIN_ANALOG_PUSH : 0, 1) * (1 - (1 - WADE_SPEED) * wadeT);
		const tx = wx * speed;
		const tz = wz * speed;
		const rate = (moving ? (this.grounded ? ACCEL : AIR_ACCEL) : FRICTION) * dt;
		const dvx = tx - this.vel.x;
		const dvz = tz - this.vel.z;
		const dvl = Math.hypot(dvx, dvz);
		if (dvl > 1e-5) {
			const s = Math.min(1, rate / dvl);
			this.vel.x += dvx * s;
			this.vel.z += dvz * s;
		}

		// ── Jump first so the same frame can clear the atrium void barrier ──
		// No jumping while riding the lift — would eject you mid-shaft. Gehurkt springt
		// hij evenmin: eerst strekken, en pas als dat gelukt is telt de volle JUMP_V.
		// Anders is een kruipgat een trampoline die je er bovenop zet.
		if (this.jumpQueued && this.grounded && this.elevFloorY === null && this.stance === 0) {
			this.vy = JUMP_V;
			this.grounded = false;
			// Wie al loopt zet zich af, wie stilstaat springt recht omhoog.
			if (moving) {
				this.vel.x += wx * JUMP_LUNGE;
				this.vel.z += wz * JUMP_LUNGE;
			}
		}
		this.jumpQueued = false;

		// ── Horizontal move + collision ──────────────────────
		// In de lucht gehurkt trekt de benen in: de onderkant van het lichaam telt
		// `airLift` hoger mee, dus je haalt over een kerb die staand net te hoog is en
		// landt er bovenop. Op de grond nul, en staand blijft het nul, dus de gewone
		// sprong en de balustradesprong veranderen niet.
		const airLift = this.grounded ? 0 : this.stance * CROUCH_LEG_TUCK;
		const wantX = p.x + this.vel.x * dt;
		const wantZ = p.z + this.vel.z * dt;
		const solved = this.world.resolveCircle(
			wantX,
			wantZ,
			this.feetY + airLift,
			PLAYER_RADIUS,
			3,
			true,
			!this.grounded && this.elevFloorY === null,
			this.unclamped,
		);
		// De dozen houden je lichaam tegen; wat er bóven je hangt niet, want een balk
		// van anderhalve meter hoog raakt je voeten nergens. Rechtop loop je er daarom
		// niet onderdoor en gehurkt wel.
		const fits = this.fits(solved.x, solved.z);
		const nextX = fits ? solved.x : p.x;
		const nextZ = fits ? solved.z : p.z;
		// Bleed off speed we lost to a wall so you slide instead of juddering
		if (dt > 0) {
			this.vel.x = (nextX - p.x) / dt;
			this.vel.z = (nextZ - p.z) / dt;
		}
		p.x = nextX;
		p.z = nextZ;

		// ── Vertical: elevator ride OR ramps/gravity ─────────
		if (this.elevFloorY === null) {
			// Airborne gets a looser step so hopping on the escalator doesn't snap you
			// onto the deck above.
			const ground = this.world.groundHeightAt(p.x, p.z, this.feetY + airLift, this.grounded ? WALK_STEP : AIR_STEP);

			if (this.grounded) {
				// Van een rand aflopen is een val, geen ease-glijbaan: zakt de grond verder weg
				// dan een loopstap, laat dan eerst los en laat de zwaartekracht het doen. Deed de
				// ease dat, dan rukte hij je in één frame omlaag en schoof de sub-dakhoge muur je
				// het gebouw in. Binnen een stap volgt hij het vlak nog wel: snappy op hellingen.
				if (this.feetY - ground > WALK_STEP) {
					this.grounded = false;
					this.vy = 0;
				} else {
					const near = Math.abs(ground - this.feetY);
					const gevolgd = near < GROUND_SNAP_EPSILON ? ground : ease(this.feetY, ground, GROUND_FOLLOW_RATE, dt);
					// Een staande stap is hoogstens WALK_STEP hoog. Antwoordt de grond in één frame
					// meters hoger — een dakplaat of dicht luik dat de vlucht eronder overschaduwt —
					// dan plak je er niet bovenop: dat was de snap-loop op de geheime trap. Omlaag
					// blijft ongemoeid, dat is de klifval hierboven.
					this.feetY = Math.min(gevolgd, this.feetY + WALK_STEP);
				}
			} else {
				this.vy -= GRAVITY * dt;
				this.feetY += this.vy * dt;
				if (this.feetY <= ground) {
					this.dip = Math.min(LAND_DIP_MAX, Math.abs(this.vy) * LAND_DIP_PER_SPEED);
					this.feetY = ground;
					this.vy = 0;
					this.grounded = true;
				}
			}
		} else {
			// Glued to cabin — no groundHeightAt fight mid-shaft
			this.feetY = this.elevFloorY;
			this.vy = 0;
			this.grounded = true;
		}

		// ── Head bob / landing dip / strafe lean ─────────────
		const sp = Math.hypot(this.vel.x, this.vel.z);
		if (this.grounded && sp > BOB_MIN_SPEED) {
			this.bobT += dt * (BOB_BASE_FREQ + sp * BOB_SPEED_FREQ);
			const amp = Math.min(1, sp / RUN_SPEED) * BOB_AMPLITUDE;
			this.bob = Math.sin(this.bobT * 2) * amp;
		} else {
			this.bob = ease(this.bob, 0, BOB_SETTLE_RATE, dt);
		}
		this.dip = ease(this.dip, 0, DIP_SETTLE_RATE, dt);
		this.lean = ease(this.lean, strafe * (sprint ? LEAN_SPRINT : LEAN_WALK), LEAN_RATE, dt);
		this.sink = ease(this.sink, wadeT * WADE_SINK, SINK_RATE, dt);

		p.y = this.feetY + this.eyeHeight + this.bob - this.dip - this.sink;

		this.cam.rotation.order = 'YXZ';
		this.cam.rotation.set(this.pitch, this.yaw, -this.lean);
	}

	// ── input ──────────────────────────────────────────────
	private onKeyDown = (e: KeyboardEvent): void => {
		if (isTypingTarget(e.target)) return;
		if (e.code === 'Space') {
			e.preventDefault();
			// A focused HUD button would otherwise eat the jump
			(document.activeElement as HTMLElement | null)?.blur?.();
			if (this.enabled) this.jumpQueued = true;
		}
		this.keys.add(e.code);
	};

	private onKeyUp = (e: KeyboardEvent): void => {
		this.keys.delete(e.code);
	};

	/** Alt-tab away mid-sprint shouldn't leave you running forever. */
	private onBlur = (): void => {
		this.keys.clear();
		this.dragging = false;
		this.axisX = 0;
		this.axisY = 0;
		this.stickId = -1;
		this.lookId = -1;
	};

	private onLockChangeEvent = (): void => {
		const locked = document.pointerLockElement === this.dom;
		if (locked === this.locked) return;
		this.locked = locked;
		this.onLockChange?.(locked);
	};

	private onPointerDown = (e: PointerEvent): void => {
		if (!this.enabled) return;

		if (e.pointerType === 'touch') {
			// Left third drives, the rest looks around
			if (e.clientX < window.innerWidth * TOUCH_DRIVE_ZONE && this.stickId === -1) {
				this.stickId = e.pointerId;
				this.stickOx = e.clientX;
				this.stickOz = e.clientY;
			} else if (this.lookId === -1) {
				this.lookId = e.pointerId;
				this.lastX = e.clientX;
				this.lastY = e.clientY;
			}
			return;
		}

		if (!this.settings.mouseLook) return;
		if (e.button !== this.settings.lookButton) return;
		if (!this.locked) {
			// Capture the mouse like a real FPS; drag-look is the fallback
			this.dom.requestPointerLock?.();
		}
		this.dragging = true;
		this.lastX = e.clientX;
		this.lastY = e.clientY;
	};

	/** Right-button look needs the browser menu out of the way. */
	private onContextMenu = (e: Event): void => {
		if (this.settings.lookButton === 2 && this.settings.mouseLook) e.preventDefault();
	};

	private onPointerUp = (e: PointerEvent): void => {
		if (e.pointerId === this.stickId) {
			this.stickId = -1;
			this.axisX = 0;
			this.axisY = 0;
			return;
		}
		if (e.pointerId === this.lookId) {
			this.lookId = -1;
			return;
		}
		this.dragging = false;
	};

	private onPointerMove = (e: PointerEvent): void => {
		if (!this.enabled) return;

		if (e.pointerId === this.stickId) {
			const dx = clamp((e.clientX - this.stickOx) / STICK_MAX, -1, 1);
			const dy = clamp((e.clientY - this.stickOz) / STICK_MAX, -1, 1);
			this.axisX = Math.abs(dx) < LOOK_STICK_DEADZONE ? 0 : dx;
			this.axisY = Math.abs(dy) < LOOK_STICK_DEADZONE ? 0 : -dy;
			return;
		}

		if (!this.settings.mouseLook) return;

		let dx: number;
		let dy: number;
		let sens: number;
		if (this.locked) {
			dx = e.movementX;
			dy = e.movementY;
			sens = LOCK_SENS;
		} else if (e.pointerId === this.lookId) {
			dx = e.clientX - this.lastX;
			dy = e.clientY - this.lastY;
			this.lastX = e.clientX;
			this.lastY = e.clientY;
			sens = TOUCH_SENS;
		} else if (this.dragging) {
			dx = e.clientX - this.lastX;
			dy = e.clientY - this.lastY;
			this.lastX = e.clientX;
			this.lastY = e.clientY;
			sens = DRAG_SENS;
		} else {
			return;
		}

		const s = this.settings;
		// Driving: pitch only — yaw is locked to the buggy heading
		if (!this.driving) {
			this.yaw -= dx * sens * s.sensitivity;
			this.wrapYaw();
		}
		this.pitch -= dy * sens * s.sensitivity * (s.invertY ? -1 : 1);
		this.pitch = clamp(this.pitch, -PITCH_MAX, PITCH_MAX);
	};

	/** Drone-vlucht: traag versnellen, muren tellen binnen, plafond via clamp. */
	private updateFlight(dt: number): void {
		// Kijken werkt zoals altijd (muis / Q / R-F). E draait hier nooit: vliegend
		// is E de uitstapknop, dus App meldt hem altijd als interactie.
		let turn = 0;
		if (this.keys.has('KeyQ')) turn += 1;
		if (this.keys.has('KeyE') && !this.interactOnE) turn -= 1;
		if (this.settings.turnWithKeys) {
			if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) turn -= 1;
			if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) turn += 1;
		}
		if (turn !== 0) {
			this.yaw += turn * TURN_SPEED * dt;
			this.wrapYaw();
		}

		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);
		let fwd = 0;
		let strafe = 0;
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
		if (!this.settings.turnWithKeys) {
			if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
			if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
		}
		let vert = 0;
		if (this.keys.has('Space')) vert += 1;
		if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) vert -= 1;

		// Heli: hogere topsnelheid maar trage respons (massa); drone: direct
		const heli = this.flightProfile === 'heli';
		const fp = heli ? FLIGHT_HELI : FLIGHT_DRONE;
		const tx = (-sin * fwd + cos * strafe) * fp.speed;
		const tz = (-cos * fwd - sin * strafe) * fp.speed;
		this.vel.x = ease(this.vel.x, tx, fp.accel, dt);
		this.vel.z = ease(this.vel.z, tz, fp.accel, dt);
		this.vy = ease(this.vy, vert * fp.vSpeed, fp.accel, dt);

		const p = this.cam.position;
		const wantX = p.x + this.vel.x * dt;
		const wantZ = p.z + this.vel.z * dt;

		const aboveMall = this.feetY > FLIGHT_ABOVE_MALL_Y;
		if (aboveMall) {
			// Vrije stadslucht — geen mall-collision, wel de wereldrand
			p.x = clamp(wantX, CITY_BOUNDS.minX, CITY_BOUNDS.maxX);
			p.z = clamp(wantZ, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ);
		} else {
			const solved = this.world.resolveCircle(wantX, wantZ, this.feetY, FLIGHT_RADIUS, 3, true, true, true);
			p.x = solved.x;
			p.z = solved.z;
		}

		// Verticaal: binnen de mall onder het plafond blijven, behalve boven het
		// atrium-gat of buiten de muren — daar mag je omhoog de stad in.
		this.feetY += this.vy * dt;
		const insideMall = Math.abs(p.x) < half(MALL_SHELL.width) && Math.abs(p.z) < half(MALL_SHELL.depth);
		const overVoid = Math.abs(p.x) < half(ATRIUM_VOID.width) - VOID_INSET && Math.abs(p.z) < half(ATRIUM_VOID.depth) - VOID_INSET;
		const ceiling = insideMall && !overVoid && this.feetY < FLIGHT_CEILING_TRIGGER_Y ? FLIGHT_MALL_CEILING : FLIGHT_SKY_CEILING;
		const g = this.world.groundHeightAt(p.x, p.z, this.feetY, FLIGHT_GROUND_STEP);
		// Boven het dakbad is de waterspiegel de bodem: de badbodem ligt onder de
		// dekplaat, dus daarop klemmen zet de drone middenin het dakbeton.
		const floor = g + this.world.waterDepthAt(p.x, p.z, g) + FLIGHT_FLOOR_CLEARANCE;
		this.feetY = clamp(this.feetY, floor, ceiling);

		p.y = this.feetY + FLIGHT_EYE; // ooghoogte in het stoeltje
		this.cam.rotation.order = 'YXZ';
		this.cam.rotation.set(this.pitch, this.yaw, -this.vel.x * FLIGHT_BANK);
		this.grounded = false;
		this.wade = 0;
		this.stance = 0;
		this.crouched = false;
	}

	/** Keep yaw in ±π so the minimap needle never wraps oddly. */
	private wrapYaw(): void {
		if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
		else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
	}
}

export { EYE } from '#/player/constants';
export { DEFAULT_SETTINGS, PlayerControls };
export type { ControlSettings };
