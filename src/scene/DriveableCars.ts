import type { Material, Object3D } from 'three';
import {
	BoxGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	Vector3,
} from 'three';
import { STANDING_PEDESTRIAN } from '#/data/character';
import { level, levelAt } from '#/data/levels';
import type { DriveableHandling, DriveableKind, DriveableSpot } from '#/data/world';
import { DRIVEABLE_HANDLING, DRIVEABLE_SPOTS, RENTAL_CAR_SPEC } from '#/data/world';
import type { CollisionWorld } from '#/physics/Collision';
import type { VehicleGroundState } from '#/physics/VehicleGround';
import { LANDING_GRIP, stepVehicleGround } from '#/physics/VehicleGround';
import { GRAVITY } from '#/player/constants';
import { lit } from '#/render/material';
import type { Barriers } from '#/scene/city/Barriers';
import { outsideMallFootprint } from '#/scene/city/cityPlan';
import { motorcycleMesh } from '#/scene/Motorcycles';
import { labelCanvas, labelTexture } from '#/util/label';
import { clamp, ease } from '#/util/math';
import { GARAGE_Y } from './ParkingGarage';
import type { DriveInput, VehicleRide } from './ScrubberBuggy';

interface CarSlot {
	mesh: Group;
	/** world position of parked vehicle */
	park: Vector3;
	yaw: number;
	color: number;
	name: string;
	/** currently the player vehicle */
	active: boolean;
	wheels: Object3D[];
	label: Sprite;
	kind: DriveableKind;
	/** Hoe hard hij trekt, remt, stuurt en hangt. Uit het wereldmodel, per soort. */
	handling: DriveableHandling;
}

/** Hoe snel de carrosserie de gemeten helling aanneemt. Direct is een schok bij elke naad. */
const PITCH_EASE = 9;
/** Hoe snel de motor naar zijn balanshoek toe leunt. Direct springt de leun bij elke stuurcorrectie. */
const LEAN_EASE = 7;
/** Boven dit loopvlak hoort een huurvoertuig niet; het rijdt de garage en de stad, geen daken. */
const CEILING = 10;

/**
 * Player-driveable vehicles parked in P1: the rental cars and the motorcycle. Hop in
 * with E, race the garage, take the west exit ramp into the outdoor city ring.
 */
export class DriveableCars {
	readonly group = new Group();
	ridden = false;
	private world: CollisionWorld;
	private readonly barriers: Barriers;
	private materials: Material[] = [];
	private cars: CarSlot[] = [];
	private active: CarSlot | null = null;
	private yaw = 0;
	private speed = 0;
	private pos = new Vector3();
	/** Hoogte, valsnelheid en of hij op de grond staat; `stepVehicleGround` schrijft erin. */
	private readonly ground: VehicleGroundState = { y: GARAGE_Y, vy: 0, grounded: true };
	/** Hoe schuin hij nu staat; loopt achter de gemeten helling aan, dus geen knik aan de voet van de helling. */
	private pitch = 0;
	/** Hoe ver de motor nu in de bocht hangt; loopt eased naar de balanshoek toe. De auto rolt niet via deze staat. */
	private lean = 0;
	private wheels: Object3D[] = [];
	/** Van het voertuig waar hij nu op zit; buiten een rit die van de auto. */
	private handling: DriveableHandling = DRIVEABLE_HANDLING.car;

	constructor(world: CollisionWorld, barriers: Barriers) {
		this.world = world;
		this.barriers = barriers;
		this.group.name = 'driveableCars';
		// World-space group (not parented under parking) so we can leave the garage
		for (const s of DRIVEABLE_SPOTS) {
			this.cars.push(this.spawn(s));
		}
	}

	get activeName(): string {
		return this.active?.name ?? '—';
	}

	/** Waar de speler op zit, of null als hij te voet is. De UI kiest er zijn woorden bij. */
	get activeKind(): DriveableKind | null {
		return this.active?.kind ?? null;
	}

	get heading(): number {
		return this.yaw;
	}

	get speedKmh(): number {
		return Math.abs(this.speed) * 3.6;
	}

	get statusLine(): string {
		if (this.ridden && this.active) {
			const turbo = Math.abs(this.speed) > this.handling.maxSpeed + 1 ? ' · TURBO' : '';
			const where = levelAt(this.pos.y) === 'p1' ? level('p1').code : 'STAD';
			return `${this.active.name} · ${this.speedKmh.toFixed(0)} km/u · ${where}${turbo}`;
		}
		return `${this.cars.length} huurvoertuigen · E = instappen (P1)`;
	}

	/** Nearest free car within range (world pos) */
	nearestCar(player: Vector3, maxDist = 4.2): CarSlot | null {
		if (this.ridden) return null;
		let best: CarSlot | null = null;
		let bestD = maxDist;
		for (const c of this.cars) {
			if (c.active) continue;
			const d = Math.hypot(player.x - c.park.x, player.z - c.park.z);
			// Must be near basement height or car is outdoors parked
			const dy = Math.abs(player.y - (c.park.y + 1.2));
			if (dy > 3.5) continue;
			if (d < bestD) {
				bestD = d;
				best = c;
			}
		}
		return best;
	}

	distanceToNearest(player: Vector3): number {
		const c = this.nearestCar(player, 99);
		if (!c) return 999;
		return Math.hypot(player.x - c.park.x, player.z - c.park.z);
	}

	/**
	 * Rijden is camera-vooruit: −(sin, cos), zoals Controls rekent en zoals de
	 * buggy al gerepareerd is. Met +(sin, cos) keek je uit de achterruit. De
	 * mesh-neus is lokaal +z, dus de carrosserie draait π ten opzichte van de
	 * rij-yaw; board() en release() rekenen op die grens om.
	 */
	getSeatPosition(): Vector3 {
		const fx = -Math.sin(this.yaw);
		const fz = -Math.cos(this.yaw);
		const { seatBack, seatHeight } = this.handling;
		// De stoel staat in het voertuig, dus hij kantelt mee: de helling op zakt hij naar
		// achteren in plaats van kaarsrecht boven het wegdek te blijven zweven.
		const achter = seatBack + seatHeight * Math.sin(this.pitch);
		return new Vector3(this.pos.x - fx * achter, this.pos.y + seatHeight * Math.cos(this.pitch), this.pos.z - fz * achter);
	}

	board(car?: CarSlot): boolean {
		const c = car ?? this.cars.find((x) => !x.active) ?? null;
		if (!c || this.ridden) return false;
		this.active = c;
		c.active = true;
		this.ridden = true;
		this.handling = c.handling;
		this.pos.copy(c.mesh.position);
		this.yaw = c.mesh.rotation.y - Math.PI;
		this.speed = 0;
		this.pitch = 0;
		this.lean = 0;
		this.ground.y = this.pos.y;
		this.ground.vy = 0;
		this.ground.grounded = true;
		this.wheels = c.wheels;
		this.world.boundsMode = 'city';
		// Het naambord is voor omstanders bij een geparkeerd voertuig; op de motor
		// hangt het anders op ooghoogte recht voor de rijder.
		c.label.visible = false;
		return true;
	}

	/** Waar deze rit staat, of null als er niemand rijdt. Genoeg om hem terug te zetten. */
	get ride(): VehicleRide | null {
		if (!(this.ridden && this.active)) return null;
		return { id: this.active.name, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, speed: this.speed };
	}

	/**
	 * Zet een onderbroken rit terug: dezelfde auto, dezelfde plek, dezelfde vaart.
	 *
	 * Een edit tijdens het rijden herbouwt de wereld en daarmee elke auto hier, dus
	 * na de herbouw wees de instapstand naar een slot dat niet meer bestond.
	 */
	resume(state: VehicleRide): boolean {
		const slot = this.cars.find((car) => car.name === state.id);
		if (!slot) return false;
		slot.mesh.position.set(state.x, state.y, state.z);
		slot.mesh.rotation.set(0, state.yaw + Math.PI, 0);
		if (!this.board(slot)) return false;
		this.speed = state.speed;
		return true;
	}

	/** Zet een uitgestapt voertuig na HMR terug zonder de speler opnieuw te laten instappen. */
	restoreParked(state: VehicleRide): boolean {
		const slot = this.cars.find((car) => car.name === state.id);
		if (!slot) return false;
		slot.active = false;
		slot.park.set(state.x, state.y, state.z);
		slot.yaw = state.yaw + Math.PI;
		slot.mesh.position.copy(slot.park);
		slot.mesh.rotation.set(0, slot.yaw, 0);
		this.paintLabel(slot, `${slot.name} · E`, '#0d47a1');
		return true;
	}

	/** Exit car, park here; returns world feet spawn */
	release(): Vector3 {
		const c = this.active;
		this.ridden = false;
		this.speed = 0;
		if (c) {
			c.active = false;
			c.park.copy(this.pos);
			c.yaw = this.yaw + Math.PI;
			c.mesh.position.copy(this.pos);
			// Weer rechtop: de rol- en tuimelstand van de laatste frame bleven staan, en
			// een motor die met een halve radiaal slagzij geparkeerd wordt ligt op straat.
			c.mesh.rotation.set(0, this.yaw + Math.PI, 0);
			c.label.visible = true;
			this.paintLabel(c, `${c.name} · E`, '#0d47a1');
		}
		const leftX = -Math.cos(this.yaw);
		const leftZ = Math.sin(this.yaw);
		const exit = new Vector3(this.pos.x + leftX * 2.2, this.pos.y, this.pos.z + leftZ * 2.2);
		const gY = this.world.groundHeightAt(exit.x, exit.z, this.pos.y + 0.5, 3);
		exit.y = gY;
		// De klem hoort bij het voertuig en gaat met de rit weer aan, maar het uitstappunt
		// krijgt dezelfde vrijstelling als de speler te voet. Zonder die vlag trok deze
		// resolveCircle een uitstappunt op straat de footprint in: buiten op de motor
		// uitstappen zette je elf meter verderop tegen de zuidrand. `boundsMode` is van de
		// hele gedeelde wereld, dus die op 'city' laten staan laat elke sim de mall uit.
		const buiten = outsideMallFootprint(gY);
		this.world.boundsMode = 'mall';
		const fixed = this.world.resolveCircle(exit.x, exit.z, gY + 1, 0.45, 3, true, false, buiten);
		exit.x = fixed.x;
		exit.z = fixed.z;
		this.active = null;
		this.wheels = [];
		return exit;
	}

	/**
	 * Drive physics. Seat world pos when ridden.
	 */
	update(dt: number, input?: DriveInput): Vector3 | null {
		if (!(this.ridden && this.active)) return null;

		const handling = this.handling;
		const throttle = input?.throttle ?? 0;
		const steer = input?.steer ?? 0;
		const boost = !!input?.boost;
		const maxSp = boost ? handling.boostSpeed : handling.maxSpeed;

		if (Math.abs(throttle) > 0.05) {
			const want = throttle * maxSp;
			const rate =
				(Math.sign(throttle) === Math.sign(this.speed) || Math.abs(this.speed) < 0.4 ? handling.accel : handling.brake) *
				(boost ? 1.2 : 1);
			if (this.speed < want) this.speed = Math.min(want, this.speed + rate * dt);
			else this.speed = Math.max(want, this.speed - rate * dt);
		} else if (this.speed > 0) this.speed = Math.max(0, this.speed - handling.friction * dt);
		else this.speed = Math.min(0, this.speed + handling.friction * dt);

		const yawBefore = this.yaw;
		const steerAuth = clamp(Math.abs(this.speed) / 5, 0.25, 1);
		if (Math.abs(steer) > 0.05) {
			const dir = this.speed >= -0.2 ? 1 : -1;
			this.yaw += steer * handling.turnRate * steerAuth * dir * dt;
		}

		const fx = -Math.sin(this.yaw);
		const fz = -Math.cos(this.yaw);
		let nx = this.pos.x + fx * this.speed * dt;
		let nz = this.pos.z + fz * this.speed * dt;

		// Verticaal precies zoals de schrobmachine: staand volgt hij het wegdek, en van
		// een rand af is het een boog met dezelfde GRAVITY als de speler. De eigen
		// hellingformule die hier stond was een tweede kopie van de uitrit, en zette de
		// auto aan de mond van de geul zonder boog op straatniveau.
		if (stepVehicleGround(this.world, this.ground, nx, nz, dt, { floorOverride: null, ceiling: CEILING })) {
			this.speed *= LANDING_GRIP;
		}
		const gy = this.ground.y;

		// Hij meldt zich bij elke slagboom waar hij op afrijdt; welke opengaat staat op
		// de boom en niet hier.
		this.barriers.approach(nx, nz, 'player-vehicle');

		// Op wielen, niet te voet: de trap en de roltrap houden hem tegen, de lift en de
		// uitritramp laten hem door, uit de poorten van elke doorgang.
		const hit = this.world.resolveCircle(nx, nz, gy + 0.6, handling.radius, 4, false, !this.ground.grounded, true, true, {
			feetY: gy,
			height: STANDING_PEDESTRIAN.requiredHeadroom,
		});
		const scraped = Math.hypot(hit.x - nx, hit.z - nz) > 0.04;
		if (scraped) this.speed *= 0.55;
		nx = hit.x;
		nz = hit.z;

		// De helling onder de wielen, over de asafstand: één hoogte onder het hart is
		// geen helling, en daarom reed hij de garagehelling kaarsrecht op.
		const gemeten = this.ground.grounded ? this.world.surfacePitchAt(nx, nz, gy, fx, fz, handling.wheelbase) : this.pitch;
		this.pitch = ease(this.pitch, gemeten, PITCH_EASE, dt);

		// Hangen in de bocht. De motor legt zich in de balanshoek van de bocht, atan(v·ω/g),
		// waar de zijwaartse versnelling en de zwaartekracht in evenwicht komen, en loopt eased
		// naar die hoek toe zodat een stuurcorrectie geen schok is. De oude leun hing aan de
		// stuuruitslag (steer·vaart) en bleef in een echte bocht ver onder de hoek die de vaart
		// vroeg. De auto rolt nog wel direct op zijn veren, per stuur en vaart, de andere kant op.
		let lean: number;
		if (this.active.kind === 'motorcycle') {
			const yawRate = dt > 0 ? (this.yaw - yawBefore) / dt : 0;
			const doel = clamp(Math.atan2(this.speed * yawRate, GRAVITY), -handling.maxLean, handling.maxLean);
			this.lean = ease(this.lean, doel, LEAN_EASE, dt);
			// Lokaal +x is de linkerflank van de rijder, dus een positieve rol om de neusas
			// tilt die flank omhoog; de balanshoek van een linkerbocht is positief en moet
			// hem juist laten zakken. Zonder dit minteken hing de motor de bocht uit.
			lean = -this.lean;
		} else {
			lean = clamp(steer * Math.abs(this.speed) * (handling.leanPerSteerSpeed ?? 0), -handling.maxLean, handling.maxLean);
		}
		this.pos.set(nx, gy, nz);
		const mesh = this.active.mesh;
		mesh.position.copy(this.pos);
		mesh.rotation.set(-this.pitch, this.yaw + Math.PI, lean);

		const spin = this.speed * dt * 1.4;
		for (const w of this.wheels) w.rotation.x += spin;

		return this.getSeatPosition();
	}

	private spawn(s: DriveableSpot): CarSlot {
		const mesh = s.kind === 'motorcycle' ? motorcycleMesh(s.color, (m) => this.track(m)) : this.makeCar(s.color);
		const park = new Vector3(s.x, s.y, s.z);
		mesh.position.copy(park);
		mesh.rotation.y = s.yaw;
		const wheels: Object3D[] = [];
		mesh.traverse((o) => {
			if (o.userData['isWheel']) wheels.push(o);
		});
		const label = this.makeLabel(`${s.name} · E`, '#0d47a1');
		label.position.set(0, 1.85, 0);
		mesh.add(label);
		this.group.add(mesh);
		return {
			mesh,
			park: park.clone(),
			yaw: s.yaw,
			color: s.color,
			name: s.name,
			active: false,
			wheels,
			label,
			kind: s.kind,
			handling: DRIVEABLE_HANDLING[s.kind],
		};
	}

	private paintLabel(c: CarSlot, text: string, bg: string): void {
		const { canvas, ctx } = labelCanvas(320, 64);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 320, 64);
		ctx.strokeStyle = '#ffc107';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 314, 58);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 160, 32);
		const tex = labelTexture(canvas);
		const mat = c.label.material as SpriteMaterial;
		mat.map?.dispose();
		mat.map = tex;
		mat.needsUpdate = true;
	}

	private makeLabel(text: string, bg: string): Sprite {
		const { canvas, ctx } = labelCanvas(320, 64);
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, 320, 64);
		ctx.strokeStyle = '#ffc107';
		ctx.lineWidth = 4;
		ctx.strokeRect(3, 3, 314, 58);
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 20px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 160, 32);
		const tex = labelTexture(canvas);
		const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
		sp.scale.set(2.4, 0.5, 1);
		return sp;
	}

	private makeCar(color: number): Group {
		const g = new Group();
		const bodyM = this.track(lit({ color, roughness: 0.4, metalness: 0.4 }));
		const dark = this.track(lit({ color: 0x111111, roughness: 0.7, metalness: 0.4 }));
		const glass = this.track(
			lit({
				color: 0x90caf9,
				transparent: true,
				opacity: 0.5,
				roughness: 0.15,
			}),
		);
		const { body: bodySpec } = RENTAL_CAR_SPEC;
		const body = new Mesh(new BoxGeometry(bodySpec.width, bodySpec.height, bodySpec.length), bodyM);
		body.position.y = bodySpec.centerY;
		g.add(body);
		const cabin = new Mesh(new BoxGeometry(1.7, 0.45, 2.1), glass);
		cabin.position.set(0, 0.95, -0.2);
		g.add(cabin);
		// Bumper stripe "RENTAL"
		const stripe = new Mesh(
			new BoxGeometry(1.7, 0.08, 0.05),
			this.track(
				lit({
					color: 0xffc107,
					emissive: 0xaa8800,
					emissiveIntensity: 0.3,
				}),
			),
		);
		stripe.position.set(0, 0.45, 2.1);
		g.add(stripe);
		// Headlights
		const lampM = this.track(new MeshBasicMaterial({ color: 0xfff59d, toneMapped: false }));
		for (const lz of [-0.55, 0.55]) {
			const lamp = new Mesh(new SphereGeometry(0.1, 8, 6), lampM);
			lamp.position.set(lz, 0.5, 2.05);
			g.add(lamp);
		}
		// Wheels
		for (const [wx, wz] of [
			[-0.9, 1.25],
			[0.9, 1.25],
			[-0.9, -1.25],
			[0.9, -1.25],
		] as const) {
			const w = new Mesh(new CylinderGeometry(0.32, 0.32, 0.24, 12), dark);
			w.rotation.z = Math.PI / 2;
			w.position.set(wx, 0.32, wz);
			w.userData['isWheel'] = true;
			g.add(w);
		}
		return g;
	}

	private track<T extends Material>(m: T): T {
		this.materials.push(m);
		return m;
	}
}
