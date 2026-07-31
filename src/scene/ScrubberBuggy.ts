import * as THREE from 'three';
import type { CollisionWorld } from '../physics/Collision';

/** Arcade drive input from the player */
export type DriveInput = {
	/** -1..1 forward (W/S) */
	throttle: number;
	/** -1..1 steer left/right (A/D or Q/E) */
	steer: number;
	/** Shift = turbo scrub */
	boost: boolean;
};

const PARK = new THREE.Vector3(10, 0, 14);
const RADIUS = 0.9;
const MAX_SPEED = 11.5;
const MAX_BOOST = 16.5;
const ACCEL = 18;
const BRAKE = 22;
const FRICTION = 6;
const TURN_RATE = 2.4; // rad/s at full steer when moving

/**
 * Empty ride-on floor scrubber — same class of buggy Wei Chen drives,
 * parked for the player to hop in and race the mall corridors.
 */
export class ScrubberBuggy {
	readonly group = new THREE.Group();
	readonly pos = new THREE.Vector3().copy(PARK);
	readonly radius = RADIUS;
	ridden = false;
	private world: CollisionWorld;
	private mesh: THREE.Group;
	private materials: THREE.Material[] = [];
	private wheels: THREE.Object3D[] = [];
	private brush!: THREE.Object3D;
	private wetSign!: THREE.Group;
	private yaw = Math.PI; // face atrium center-ish
	private speed = 0;
	private parkPos = PARK.clone();
	private label!: THREE.Sprite;

	constructor(world: CollisionWorld) {
		this.world = world;
		this.group.name = 'scrubberBuggy';
		this.mesh = this.build();
		this.mesh.position.copy(this.parkPos);
		this.mesh.rotation.y = this.yaw;
		this.group.add(this.mesh);
		this.pos.copy(this.parkPos);
	}

	distanceTo(p: THREE.Vector3): number {
		return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
	}

	/** Eye / camera seat */
	getSeatPosition(): THREE.Vector3 {
		// Sit slightly above seat, looking forward
		const fx = Math.sin(this.yaw);
		const fz = Math.cos(this.yaw);
		return new THREE.Vector3(this.pos.x - fx * 0.05, this.pos.y + 1.35, this.pos.z - fz * 0.05);
	}

	get heading(): number {
		return this.yaw;
	}

	get statusLine(): string {
		if (this.ridden) {
			const kmh = Math.abs(this.speed) * 3.6;
			return `RACET · ${kmh.toFixed(0)} km/u${Math.abs(this.speed) > MAX_SPEED + 0.5 ? ' · TURBO' : ''}`;
		}
		return 'leeg · E = instappen & racen';
	}

	board(): void {
		this.ridden = true;
		this.speed = 0;
		if (this.label) {
			this.paintLabel('JIJ · SCHOONMAAK RACER', '#b71c1c');
		}
	}

	/** Park where you got out */
	release(): THREE.Vector3 {
		this.ridden = false;
		this.speed = 0;
		this.parkPos.set(this.pos.x, 0, this.pos.z);
		// Step out to the left of the buggy
		const leftX = Math.cos(this.yaw);
		const leftZ = -Math.sin(this.yaw);
		const exit = new THREE.Vector3(this.pos.x + leftX * 1.4, 0, this.pos.z + leftZ * 1.4);
		const fixed = this.world.resolveCircle(exit.x, exit.z, 0.5, 0.4, 3, true);
		exit.x = fixed.x;
		exit.z = fixed.z;
		if (this.label) {
			this.paintLabel('SCHOONMAAK BUGGY · E', '#1565c0');
		}
		return exit;
	}

	/**
	 * Idle bob / brush when parked, or full arcade drive when ridden.
	 * @returns seat world pos when ridden (for camera stick)
	 */
	update(dt: number, input?: DriveInput): THREE.Vector3 | null {
		if (!this.ridden) {
			// Idle: slow brush spin so it reads as "ready"
			if (this.brush) this.brush.rotation.y += dt * 2.5;
			if (this.wetSign) {
				this.wetSign.position.y = 0.35 + Math.sin(performance.now() * 0.006) * 0.015;
			}
			return null;
		}

		const throttle = input?.throttle ?? 0;
		const steer = input?.steer ?? 0;
		const boost = !!input?.boost;
		const maxSp = boost ? MAX_BOOST : MAX_SPEED;

		// Arcade accel / brake
		if (Math.abs(throttle) > 0.05) {
			const want = throttle * maxSp;
			const rate =
				(Math.sign(throttle) === Math.sign(this.speed) || Math.abs(this.speed) < 0.5 ? ACCEL : BRAKE) *
				(boost ? 1.25 : 1);
			if (this.speed < want) this.speed = Math.min(want, this.speed + rate * dt);
			else this.speed = Math.max(want, this.speed - rate * dt);
		} else {
			// Coast friction
			if (this.speed > 0) this.speed = Math.max(0, this.speed - FRICTION * dt);
			else this.speed = Math.min(0, this.speed + FRICTION * dt);
		}

		// Steer more when moving; allow pivot crawl
		const steerAuth = Math.max(0.35, Math.min(1, Math.abs(this.speed) / 4));
		if (Math.abs(steer) > 0.05) {
			const dir = this.speed >= -0.15 ? 1 : -1; // reverse steering when reversing hard
			this.yaw += steer * TURN_RATE * steerAuth * dir * dt * (boost ? 1.15 : 1);
		}

		// Integrate
		const fx = Math.sin(this.yaw);
		const fz = Math.cos(this.yaw);
		let nx = this.pos.x + fx * this.speed * dt;
		let nz = this.pos.z + fz * this.speed * dt;

		// Ground floor only — clamp Y via ground height (garages etc. still ok)
		const gy = this.world.groundHeightAt(nx, nz, this.pos.y + 0.5, 2);
		// Stay mostly on V0 / P1, not roof racing
		const feetY = gy < 10 ? gy : this.pos.y;

		const hit = this.world.resolveCircle(nx, nz, feetY + 0.5, RADIUS, 4, true);
		// Wall scrape kills speed
		const scraped = Math.hypot(hit.x - nx, hit.z - nz) > 0.02;
		if (scraped) this.speed *= 0.55;
		nx = hit.x;
		nz = hit.z;

		this.pos.set(nx, feetY, nz);
		this.mesh.position.set(nx, feetY, nz);
		this.mesh.rotation.y = this.yaw;

		// Wheels + brush spin with speed
		const spin = this.speed * dt * 1.8;
		for (const w of this.wheels) w.rotation.x += spin;
		if (this.brush) this.brush.rotation.y += dt * (6 + Math.abs(this.speed) * 1.2);
		if (this.wetSign) {
			this.wetSign.position.y = 0.35 + Math.sin(performance.now() * 0.01) * 0.03;
			this.wetSign.rotation.z = THREE.MathUtils.clamp(this.speed * 0.01, -0.15, 0.15);
		}

		// Camera seat + slight look lean
		const seat = this.getSeatPosition();
		return seat;
	}

	private paintLabel(text: string, bg: string): void {
		const c = document.createElement('canvas');
		c.width = 320;
		c.height = 64;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 320, 64);
		ctx.strokeStyle = '#ffeb3b';
		ctx.lineWidth = 5;
		ctx.strokeRect(3, 3, 314, 58);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 22px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 160, 32);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const mat = this.label.material as THREE.SpriteMaterial;
		mat.map?.dispose();
		mat.map = tex;
		mat.needsUpdate = true;
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private build(): THREE.Group {
		const g = new THREE.Group();

		const yellow = this.track(new THREE.MeshStandardMaterial({ color: 0xffc107, roughness: 0.55, metalness: 0.2 }));
		const blue = this.track(new THREE.MeshStandardMaterial({ color: 0x0d47a1, roughness: 0.65 }));
		const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.7, metalness: 0.3 }));
		const grey = this.track(new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.4, roughness: 0.45 }));
		const rubber = this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
		const green = this.track(
			new THREE.MeshStandardMaterial({
				color: 0x00e676,
				emissive: 0x00c853,
				emissiveIntensity: 0.35,
				roughness: 0.5,
			}),
		);

		// Chassis — same proportions as Wei's scrubber
		const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 1.35), yellow);
		body.position.set(0, 0.42, 0);
		g.add(body);
		const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 1.36), blue);
		stripe.position.set(0, 0.55, 0);
		g.add(stripe);

		// Empty seat
		const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.35), dark);
		seat.position.set(0, 0.72, -0.15);
		g.add(seat);
		const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.08), dark);
		backrest.position.set(0, 0.95, -0.3);
		g.add(backrest);
		// "VACANT" cushion pip
		const vacant = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), green);
		vacant.position.set(0, 0.82, -0.15);
		g.add(vacant);

		// Steering
		const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), grey);
		col.position.set(0, 0.85, 0.35);
		col.rotation.x = 0.35;
		g.add(col);
		const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14), rubber);
		wheel.position.set(0, 1.05, 0.48);
		wheel.rotation.x = Math.PI / 2.5;
		g.add(wheel);

		// Scrub deck + brush
		const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.12, 16), grey);
		deck.position.set(0, 0.12, 0.55);
		g.add(deck);
		this.brush = new THREE.Mesh(
			new THREE.CylinderGeometry(0.34, 0.34, 0.06, 16),
			this.track(new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.85 })),
		);
		this.brush.position.set(0, 0.06, 0.55);
		g.add(this.brush);
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

		// Tank
		const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.4), blue);
		tank.position.set(0, 0.7, -0.55);
		g.add(tank);
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), grey);
		cap.position.set(0, 0.96, -0.55);
		g.add(cap);

		// Wheels
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

		// Side plates
		const plate = this.makePlate('PLAYER RENTAL', '#0d47a1', '#ffeb3b', 256, 64);
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

		// Number racing stripe "88"
		const num = this.makePlate('88', '#b71c1c', '#fff', 128, 128);
		const numMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(0.35, 0.35),
			this.track(new THREE.MeshBasicMaterial({ map: num, toneMapped: false })),
		);
		numMesh.position.set(0, 0.75, 0.68);
		g.add(numMesh);

		// Floating label
		this.label = this.makeSprite('SCHOONMAAK BUGGY · E', '#1565c0', 280, 48);
		this.label.position.set(0, 2.0, 0);
		this.label.scale.set(2.0, 0.36, 1);
		g.add(this.label);

		// Wet floor sign
		this.wetSign = new THREE.Group();
		this.wetSign.position.set(0, 0.35, -1.05);
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
		const wetL = wetBoard.clone();
		wetL.position.set(0, 0.2, -0.08);
		wetL.rotation.x = -0.35;
		const wetR = wetBoard.clone();
		wetR.position.set(0, 0.2, 0.08);
		wetR.rotation.x = 0.35;
		this.wetSign.add(wetL, wetR);
		g.add(this.wetSign);

		// Beacon light
		const beacon = new THREE.PointLight(0xffc107, 2.5, 8, 2);
		beacon.position.set(0, 1.3, -0.55);
		g.add(beacon);

		return g;
	}

	private makePlate(text: string, bg: string, fg: string, w: number, h: number): THREE.CanvasTexture {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = fg;
		ctx.font = `bold ${Math.floor(h * 0.28)}px system-ui,sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const lines = text.split('\n');
		lines.forEach((line, i) => {
			ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h * 0.32));
		});
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}

	private makeSprite(text: string, bg: string, w: number, h: number): THREE.Sprite {
		const tex = this.makePlate(text, bg, '#fff', w, h);
		return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
	}
}
