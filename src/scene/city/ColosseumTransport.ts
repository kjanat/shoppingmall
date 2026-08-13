import * as THREE from 'three';
import { ENTRANCE_SPEC } from '#/data/world';
import { lit } from '#/render/material';
import { CITY_GROUND_Y, COLOSSEUM_PLAN, ENTRANCE_CARPET } from '#/scene/city/cityPlan';
import { backToBackLabel, fitText, labelCanvas, labelTexture } from '#/util/label';
import { clamp01, half } from '#/util/math';

export type ColosseumStop = 'mall' | 'colosseum';

type TransportState =
	| { kind: 'stopped'; stop: ColosseumStop; remaining: number }
	| { kind: 'travelling'; from: ColosseumStop; to: ColosseumStop; distance: number };

const TRAVEL_SPEED = 18;
const STOP_SECONDS = 5;
const BOARD_DEPART_SECONDS = 0.6;
const BOARD_RADIUS = 4.5;
const SEAT_HEIGHT = 1.55;
const SEAT_BACK = -0.25;
const EXIT_SIDE = 2.2;
const CARRIAGE_CARPET_CLEARANCE = 1.5;

export const COLOSSEUM_TRANSPORT_STOPS = {
	mall: {
		x: ENTRANCE_CARPET.minX + half(ENTRANCE_SPEC.carpet.width),
		y: CITY_GROUND_Y + 0.1,
		z: ENTRANCE_CARPET.maxZ + CARRIAGE_CARPET_CLEARANCE,
	},
	colosseum: {
		x: COLOSSEUM_PLAN.x,
		y: CITY_GROUND_Y + 0.1,
		z: COLOSSEUM_PLAN.z - COLOSSEUM_PLAN.radiusZ - 10,
	},
} as const;

/**
 * ColosseumTransport — Roman Chariot Express Shuttle connecting
 * the Shopping Mall Main Entrance Plaza directly to the Mega Colosseum Arena.
 */
export class ColosseumTransport {
	readonly group = new THREE.Group();

	private readonly materials: THREE.Material[] = [];
	private readonly geometries: THREE.BufferGeometry[] = [];
	private readonly textures: THREE.Texture[] = [];
	private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);

	private chariotMesh: THREE.Group;
	private pos = new THREE.Vector3();
	private state: TransportState = { kind: 'stopped', stop: 'mall', remaining: STOP_SECONDS };
	private passenger = false;
	private readonly routeLength: number;
	private heading = 0;

	// Key stops along the route
	private readonly stopMall = new THREE.Vector3(
		COLOSSEUM_TRANSPORT_STOPS.mall.x,
		COLOSSEUM_TRANSPORT_STOPS.mall.y,
		COLOSSEUM_TRANSPORT_STOPS.mall.z,
	);
	private readonly stopColosseum = new THREE.Vector3(
		COLOSSEUM_TRANSPORT_STOPS.colosseum.x,
		COLOSSEUM_TRANSPORT_STOPS.colosseum.y,
		COLOSSEUM_TRANSPORT_STOPS.colosseum.z,
	);

	constructor() {
		this.group.name = 'colosseum_transport';
		this.geometries.push(this.unitBox);
		this.routeLength = this.stopMall.distanceTo(this.stopColosseum);

		this.chariotMesh = this.buildChariot();
		this.pos.copy(this.stopMall);
		this.chariotMesh.position.copy(this.pos);
		this.group.add(this.chariotMesh);

		this.buildStops();
		this.orientToward('colosseum');
	}

	update(dt: number): void {
		if (this.state.kind === 'stopped') {
			this.state.remaining -= dt;
			if (this.state.remaining <= 0) {
				const to = this.otherStop(this.state.stop);
				this.state = { kind: 'travelling', from: this.state.stop, to, distance: 0 };
				this.orientToward(to);
			}
		} else {
			this.state.distance += TRAVEL_SPEED * dt;
			const progress = clamp01(this.state.distance / this.routeLength);
			this.pos.lerpVectors(this.stopPosition(this.state.from), this.stopPosition(this.state.to), progress);
			if (progress === 1) {
				const stop = this.state.to;
				this.state = { kind: 'stopped', stop, remaining: STOP_SECONDS };
				this.pos.copy(this.stopPosition(stop));
			}
		}
		this.chariotMesh.position.copy(this.pos);
	}

	get ridden(): boolean {
		return this.passenger;
	}

	get currentStop(): ColosseumStop | null {
		return this.state.kind === 'stopped' ? this.state.stop : null;
	}

	get destination(): ColosseumStop {
		return this.state.kind === 'stopped' ? this.otherStop(this.state.stop) : this.state.to;
	}

	distanceTo(point: THREE.Vector3): number {
		return Math.hypot(point.x - this.pos.x, point.z - this.pos.z);
	}

	isBoardable(point: THREE.Vector3): boolean {
		return !this.passenger && this.state.kind === 'stopped' && this.distanceTo(point) < BOARD_RADIUS;
	}

	board(point: THREE.Vector3): boolean {
		if (!this.isBoardable(point) || this.state.kind !== 'stopped') return false;
		this.passenger = true;
		this.state.remaining = BOARD_DEPART_SECONDS;
		return true;
	}

	seatPosition(out: THREE.Vector3): THREE.Vector3 {
		out.set(Math.sin(this.heading) * SEAT_BACK, SEAT_HEIGHT, Math.cos(this.heading) * SEAT_BACK);
		return out.add(this.pos);
	}

	release(out: THREE.Vector3): THREE.Vector3 | null {
		if (!this.passenger || this.state.kind !== 'stopped') return null;
		this.passenger = false;
		out.set(Math.cos(this.heading) * EXIT_SIDE, CITY_GROUND_Y, -Math.sin(this.heading) * EXIT_SIDE);
		return out.add(this.pos);
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
		for (const g of this.geometries) g.dispose();
		for (const t of this.textures) t.dispose();
	}

	private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
		const m = new THREE.Mesh(this.unitBox, mat);
		m.scale.set(w, h, d);
		m.position.set(x, y, z);
		m.castShadow = true;
		m.receiveShadow = true;
		return m;
	}

	private buildChariot(): THREE.Group {
		const chariot = new THREE.Group();

		const goldMat = lit({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
		const redMat = lit({ color: 0x990000, roughness: 0.6 });
		const woodMat = lit({ color: 0x5c4033, roughness: 0.8 });
		const whiteHorseMat = lit({ color: 0xf0ede6, roughness: 0.7 });
		this.materials.push(goldMat, redMat, woodMat, whiteHorseMat);

		// Chariot Body Carriage
		const body = this.box(1.8, 0.9, 2.2, goldMat, 0, 0.65, 0);
		chariot.add(body);

		const interior = this.box(1.6, 0.7, 1.8, redMat, 0, 0.75, 0);
		chariot.add(interior);

		// Large Spoke Wheels
		const wheelL = this.box(0.15, 1.2, 1.2, woodMat, -1.0, 0.6, 0);
		const wheelR = this.box(0.15, 1.2, 1.2, woodMat, 1.0, 0.6, 0);
		chariot.add(wheelL, wheelR);

		// Reins Beam
		const beam = this.box(0.15, 0.15, 3.2, woodMat, 0, 0.6, 2.0);
		chariot.add(beam);

		// Two Majestic Sculpted White Horses
		for (const side of [-0.8, 0.8]) {
			const horseGroup = new THREE.Group();
			horseGroup.position.set(side, 0, 3.4);

			// Torso
			const horseBody = this.box(0.7, 0.9, 1.8, whiteHorseMat, 0, 0.95, 0);
			// Legs
			const legFL = this.box(0.2, 0.8, 0.2, whiteHorseMat, -0.22, 0.4, 0.6);
			const legFR = this.box(0.2, 0.8, 0.2, whiteHorseMat, 0.22, 0.4, 0.6);
			const legBL = this.box(0.2, 0.8, 0.2, whiteHorseMat, -0.22, 0.4, -0.6);
			const legBR = this.box(0.2, 0.8, 0.2, whiteHorseMat, 0.22, 0.4, -0.6);
			// Neck & Head
			const neck = this.box(0.4, 0.9, 0.4, whiteHorseMat, 0, 1.6, 0.7);
			neck.rotation.x = -Math.PI / 6;

			horseGroup.add(horseBody, legFL, legFR, legBL, legBR, neck);
			chariot.add(horseGroup);
		}

		return chariot;
	}

	private buildStops(): void {
		const signMat = lit({ color: 0x4a2e18, roughness: 0.8 });
		this.materials.push(signMat);

		// Mall Stop Sign
		const { canvas, ctx } = labelCanvas(512, 96);
		ctx.fillStyle = '#1b263b';
		ctx.fillRect(0, 0, 512, 96);
		ctx.fillStyle = '#e0a96d';
		fitText(ctx, 'COLOSSEUM EXPRESS CHARIOT', { x: 12, y: 12, w: 488, h: 72 }, { size: 32, maxLines: 1 });

		const tex = labelTexture(canvas);
		this.textures.push(tex);

		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
		this.materials.push(mat);

		const geo = new THREE.PlaneGeometry(8, 1.5);
		this.geometries.push(geo);

		const sign = backToBackLabel(geo, mat);
		sign.position.set(this.stopMall.x, 3.2, this.stopMall.z - 2.5);
		this.group.add(sign);

		const colosseumSign = backToBackLabel(geo, mat);
		colosseumSign.position.set(this.stopColosseum.x, 3.2, this.stopColosseum.z - 2.5);
		this.group.add(colosseumSign);
	}

	private stopPosition(stop: ColosseumStop): THREE.Vector3 {
		return stop === 'mall' ? this.stopMall : this.stopColosseum;
	}

	private otherStop(stop: ColosseumStop): ColosseumStop {
		return stop === 'mall' ? 'colosseum' : 'mall';
	}

	private orientToward(stop: ColosseumStop): void {
		const target = this.stopPosition(stop);
		this.heading = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
		this.chariotMesh.rotation.y = this.heading;
	}
}
