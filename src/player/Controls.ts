import * as THREE from 'three';
import { type LevelId, levelAt } from '@/data/levels';
import type { CollisionWorld } from '@/physics/Collision';

export const EYE = 1.68;

const WALK = 4.4;
const RUN = 8.4;
const ACCEL = 46;
const FRICTION = 26;
const AIR_ACCEL = 9;
const GRAVITY = 24;
/** High enough to clear the floor-1 balustrade into the atrium void */
const JUMP_V = 7.4;
const RADIUS = 0.4;
const PITCH_MAX = 1.45;
/** rad per pixel */
const LOCK_SENS = 0.0022;
const DRAG_SENS = 0.003;
const TOUCH_SENS = 0.0045;
const STICK_MAX = 64;
/** keyboard turning, rad/s */
const TURN_SPEED = 2.2;
const PITCH_SPEED = 1.2;

/**
 * How you steer. `turnWithKeys` is the no-mouse mode: A/D (and ←/→) swing the
 * whole camera like a tank instead of side-stepping.
 */
export type ControlSettings = {
	turnWithKeys: boolean;
	mouseLook: boolean;
	/** 0 = left button, 2 = right button (left-handed mice) */
	lookButton: 0 | 2;
	sensitivity: number;
	invertY: boolean;
};

export const DEFAULT_SETTINGS: ControlSettings = {
	turnWithKeys: false,
	mouseLook: true,
	lookButton: 0,
	sensitivity: 1,
	invertY: false,
};

function isTypingTarget(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el?.tagName) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/**
 * GTA-style first-person controller: click to capture the mouse, WASD to walk,
 * Shift to run, Space to hop. Nothing orbits a centre point — yaw/pitch are the
 * only camera state, so the view always sits behind the player's eyes.
 *
 * Escalator and stairs are ramps here (see CollisionWorld.groundHeightAt), so you
 * can actually reach floor 1 on foot instead of circling the ground floor.
 */
export class PlayerControls {
	enabled = true;
	locked = false;
	settings: ControlSettings = { ...DEFAULT_SETTINGS };
	onLockChange: ((locked: boolean) => void) | null = null;

	private cam: THREE.PerspectiveCamera;
	private dom: HTMLElement;
	private world: CollisionWorld;

	private keys = new Set<string>();
	private yaw = 0;
	private pitch = 0;
	private vel = new THREE.Vector3();
	private vy = 0;
	private grounded = true;
	private feetY = 0;
	private bobT = 0;
	private bob = 0;
	private dip = 0;
	private lean = 0;

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

	constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, world: CollisionWorld) {
		this.cam = camera;
		this.dom = dom;
		this.world = world;
		this.syncFromCamera();

		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);
		this.dom.addEventListener('pointerdown', this.onPointerDown);
		this.dom.addEventListener('contextmenu', this.onContextMenu);
		window.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('pointercancel', this.onPointerUp);
		window.addEventListener('pointermove', this.onPointerMove);
		document.addEventListener('pointerlockchange', this.onLockChangeEvent);
	}

	/** Swap control scheme at runtime; releases the mouse if look is turned off. */
	applySettings(next: Partial<ControlSettings>): void {
		this.settings = { ...this.settings, ...next };
		if (!this.settings.mouseLook) this.releaseLook();
	}

	dispose(): void {
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		this.dom.removeEventListener('pointerdown', this.onPointerDown);
		this.dom.removeEventListener('contextmenu', this.onContextMenu);
		window.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('pointercancel', this.onPointerUp);
		window.removeEventListener('pointermove', this.onPointerMove);
		document.removeEventListener('pointerlockchange', this.onLockChangeEvent);
	}

	get heading(): number {
		return this.yaw;
	}

	/** Which deck the player is standing on (for the minimap). */
	get level(): LevelId {
		return levelAt(this.feetY);
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
			this.cam.position.y = cabinFloorY + EYE + this.bob - this.dip;
		}
	}

	get isRidingElevator(): boolean {
		return this.elevFloorY !== null;
	}

	/** @deprecated use setElevatorRide */
	snapToElevator(cabinFloorY: number): void {
		this.setElevatorRide(cabinFloorY);
	}

	/** External displacement (moving walkway) — applied through collision. */
	nudge(dx: number, dz: number): void {
		const p = this.cam.position;
		const solved = this.world.resolveCircle(p.x + dx, p.z + dz, this.feetY, RADIUS, 2, true, !this.grounded);
		p.x = solved.x;
		p.z = solved.z;
	}

	/** Adopt whatever the cinematic camera ended on. */
	syncFromCamera(): void {
		const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
		this.yaw = e.y;
		this.pitch = THREE.MathUtils.clamp(e.x, -PITCH_MAX, PITCH_MAX);
		this.feetY = this.world.groundHeightAt(this.cam.position.x, this.cam.position.z, this.cam.position.y - EYE);
		this.vel.set(0, 0, 0);
		this.vy = 0;
		this.grounded = true;
		this.bob = 0;
		this.dip = 0;
		this.keys.clear();
		this.axisX = 0;
		this.axisY = 0;
	}

	/** Turn to face a world point without moving (used on arrival). */
	lookAtPoint(p: THREE.Vector3): void {
		const dx = p.x - this.cam.position.x;
		const dz = p.z - this.cam.position.z;
		if (dx * dx + dz * dz > 1e-4) this.yaw = Math.atan2(-dx, -dz);
		const dy = p.y - this.cam.position.y;
		const flat = Math.hypot(dx, dz);
		this.pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(0.001, flat)), -PITCH_MAX, PITCH_MAX);
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
		if (Math.abs(steer) < 0.05) steer = -this.axisX;
		return {
			throttle: THREE.MathUtils.clamp(throttle, -1, 1),
			steer: THREE.MathUtils.clamp(steer, -1, 1),
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
			this.pitch = THREE.MathUtils.clamp(this.pitch + tilt * PITCH_SPEED * dt, -PITCH_MAX * 0.7, PITCH_MAX * 0.55);
		}
		// Mouse look still adjusts pitch via pointermove (yaw ignored while driving)
		this.cam.rotation.order = 'YXZ';
		this.cam.rotation.set(this.pitch, this.yaw, 0);
		this.vel.set(0, 0, 0);
		this.vy = 0;
		this.grounded = true;
		this.jumpQueued = false;
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

		// ── Steering ─────────────────────────────────────────
		// Q/E always turn, so a mouseless player is never stuck facing one way.
		let turn = 0;
		if (this.keys.has('KeyQ')) turn += 1;
		if (this.keys.has('KeyE')) turn -= 1;
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
			this.yaw += turn * TURN_SPEED * (sprint ? 1.5 : 1) * dt;
			this.wrapYaw();
		}
		// R/F tilt, for people who never touch the mouse
		let tilt = 0;
		if (this.keys.has('KeyR')) tilt += 1;
		if (this.keys.has('KeyF')) tilt -= 1;
		if (tilt !== 0) {
			this.pitch = THREE.MathUtils.clamp(this.pitch + tilt * PITCH_SPEED * dt, -PITCH_MAX, PITCH_MAX);
		}

		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);

		// Wish direction in world space (forward = where you look)
		let wx = 0;
		let wz = 0;
		fwd = THREE.MathUtils.clamp(fwd, -1, 1);
		strafe = THREE.MathUtils.clamp(strafe, -1, 1);

		wx = -sin * fwd + cos * strafe;
		wz = -cos * fwd - sin * strafe;
		const wishLen = Math.hypot(wx, wz);
		const moving = wishLen > 0.01;
		if (moving) {
			wx /= wishLen;
			wz /= wishLen;
		}

		const speed = (sprint ? RUN : WALK) * Math.min(1, Math.max(wishLen, moving ? 0.4 : 0));
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
		// No jumping while riding the lift — would eject you mid-shaft.
		if (this.jumpQueued && this.grounded && this.elevFloorY === null) {
			this.vy = JUMP_V;
			this.grounded = false;
			// Small forward boost so a standing hop still carries you over the rail
			if (moving) {
				this.vel.x += wx * 1.6;
				this.vel.z += wz * 1.6;
			}
		}
		this.jumpQueued = false;

		// ── Horizontal move + collision ──────────────────────
		const p = this.cam.position;
		const wantX = p.x + this.vel.x * dt;
		const wantZ = p.z + this.vel.z * dt;
		const solved = this.world.resolveCircle(
			wantX,
			wantZ,
			this.feetY,
			RADIUS,
			3,
			true,
			!this.grounded && this.elevFloorY === null,
		);
		// Bleed off speed we lost to a wall so you slide instead of juddering
		if (dt > 0) {
			this.vel.x = (solved.x - p.x) / dt;
			this.vel.z = (solved.z - p.z) / dt;
		}
		p.x = solved.x;
		p.z = solved.z;

		// ── Vertical: elevator ride OR ramps/gravity ─────────
		if (this.elevFloorY !== null) {
			// Glued to cabin — no groundHeightAt fight mid-shaft
			this.feetY = this.elevFloorY;
			this.vy = 0;
			this.grounded = true;
		} else {
			// Airborne gets a looser step so hopping on the escalator doesn't snap you
			// onto the deck above.
			const ground = this.world.groundHeightAt(p.x, p.z, this.feetY, this.grounded ? 0.5 : 2.5);

			if (this.grounded) {
				// Follow the surface: snappy on ramps, instant on flat ground
				const near = Math.abs(ground - this.feetY);
				this.feetY = near < 0.02 ? ground : THREE.MathUtils.lerp(this.feetY, ground, Math.min(1, 22 * dt));
				if (this.feetY - ground > 0.9) {
					this.grounded = false;
					this.vy = 0;
				}
			} else {
				this.vy -= GRAVITY * dt;
				this.feetY += this.vy * dt;
				if (this.feetY <= ground) {
					this.dip = Math.min(0.16, Math.abs(this.vy) * 0.014);
					this.feetY = ground;
					this.vy = 0;
					this.grounded = true;
				}
			}
		}

		// ── Head bob / landing dip / strafe lean ─────────────
		const sp = Math.hypot(this.vel.x, this.vel.z);
		if (this.grounded && sp > 0.3) {
			this.bobT += dt * (5.5 + sp * 1.15);
			const amp = Math.min(1, sp / RUN) * 0.055;
			this.bob = Math.sin(this.bobT * 2) * amp;
		} else {
			this.bob = THREE.MathUtils.lerp(this.bob, 0, Math.min(1, 8 * dt));
		}
		this.dip = THREE.MathUtils.lerp(this.dip, 0, Math.min(1, 7 * dt));
		this.lean = THREE.MathUtils.lerp(this.lean, strafe * (sprint ? 0.02 : 0.013), Math.min(1, 6 * dt));

		p.y = this.feetY + EYE + this.bob - this.dip;

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
			if (e.clientX < window.innerWidth * 0.4 && this.stickId === -1) {
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
			const dx = THREE.MathUtils.clamp((e.clientX - this.stickOx) / STICK_MAX, -1, 1);
			const dy = THREE.MathUtils.clamp((e.clientY - this.stickOz) / STICK_MAX, -1, 1);
			this.axisX = Math.abs(dx) < 0.15 ? 0 : dx;
			this.axisY = Math.abs(dy) < 0.15 ? 0 : -dy;
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
		this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_MAX, PITCH_MAX);
	};

	/** Drone-vlucht: traag versnellen, muren tellen binnen, plafond via clamp. */
	private updateFlight(dt: number): void {
		// Kijken werkt zoals altijd (muis / Q-E / R-F)
		let turn = 0;
		if (this.keys.has('KeyQ')) turn += 1;
		if (this.keys.has('KeyE')) turn -= 1;
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
		const speed = heli ? 15 : 9;
		const accel = heli ? 1.6 : 3.5;
		const vSpeed = heli ? 7.5 : 6;
		const tx = (-sin * fwd + cos * strafe) * speed;
		const tz = (-cos * fwd - sin * strafe) * speed;
		this.vel.x = THREE.MathUtils.lerp(this.vel.x, tx, Math.min(1, dt * accel));
		this.vel.z = THREE.MathUtils.lerp(this.vel.z, tz, Math.min(1, dt * accel));
		this.vy = THREE.MathUtils.lerp(this.vy, vert * vSpeed, Math.min(1, dt * accel));

		const p = this.cam.position;
		const wantX = p.x + this.vel.x * dt;
		const wantZ = p.z + this.vel.z * dt;

		const aboveMall = this.feetY > 14.2;
		if (aboveMall) {
			// Vrije stadslucht — geen mall-collision, wel de wereldrand
			p.x = THREE.MathUtils.clamp(wantX, -95, 95);
			p.z = THREE.MathUtils.clamp(wantZ, -75, 75);
		} else {
			const solved = this.world.resolveCircle(wantX, wantZ, this.feetY, 0.7, 3, true, true);
			p.x = solved.x;
			p.z = solved.z;
		}

		// Verticaal: binnen de mall onder het plafond blijven, behalve boven het
		// atrium-gat of buiten de muren — daar mag je omhoog de stad in.
		this.feetY += this.vy * dt;
		const insideMall = Math.abs(p.x) < 36.5 && Math.abs(p.z) < 24.5;
		const overVoid = Math.abs(p.x) < 7.4 && Math.abs(p.z) < 5.4;
		const ceiling = insideMall && !overVoid && this.feetY < 13.4 ? 12.6 : 55;
		const floor = insideMall ? this.world.groundHeightAt(p.x, p.z, this.feetY, 2.5) + 0.45 : 0.45;
		this.feetY = THREE.MathUtils.clamp(this.feetY, floor, ceiling);

		p.y = this.feetY + 0.55; // ooghoogte in het stoeltje
		this.cam.rotation.order = 'YXZ';
		this.cam.rotation.set(this.pitch, this.yaw, -this.vel.x * 0.004);
		this.grounded = false;
	}

	/** Keep yaw in ±π so the minimap needle never wraps oddly. */
	private wrapYaw(): void {
		if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
		else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
	}
}
