import * as THREE from 'three';
import { type LitMaterial, lit } from '@/render/material';
import { labelCanvas, labelTexture } from '@/util/label';
import { ROOF_Y } from './Helipad';

type HeliState = 'parked' | 'spinup' | 'takeoff' | 'cruise' | 'approach' | 'land' | 'spindown';

const CRUISE_Y = ROOF_Y + 9;
const CRUISE_R = 34;
const CRUISE_SPEED = 0.35; // rad/s ≈ 12 m/s over de cirkel
const LAPS = 2;

/**
 * De helikopter die bij de helipad hoort. Volautomatische cyclus:
 * geparkeerd → rotors op toeren → verticale takeoff → rondjes boven de mall →
 * aanvliegen → landen → uitdraaien. Kijk vanaf het dak (secret stairs, V1 oost).
 */
export class Helicopter {
	readonly group = new THREE.Group();
	state: HeliState = 'parked';
	private body = new THREE.Group();
	private mainRotor = new THREE.Group();
	private tailRotor!: THREE.Mesh;
	private materials: THREE.Material[] = [];
	private pad: THREE.Vector3;
	private rotorSpeed = 0;
	private stateT = 0;
	private cruiseA = 0;
	/** wereld-positie tijdens de vlucht */
	private pos = new THREE.Vector3();

	constructor(padCenter: THREE.Vector3) {
		this.group.name = 'helicopter';
		this.pad = padCenter.clone();
		this.pos.copy(this.pad);
		this.build();
		this.group.add(this.body);
		this.body.position.copy(this.pad);
	}

	/** Jij aan de stick — de automatische cyclus pauzeert. */
	occupied = false;

	/** Afstand speler → heli (voor instappen op het dak). */
	distanceTo(p: THREE.Vector3): number {
		return this.body.position.distanceTo(p);
	}

	/** Instappen kan alleen als hij (bijna) stilstaat op het pad. */
	get boardable(): boolean {
		return !this.occupied && (this.state === 'parked' || this.state === 'spindown' || this.state === 'spinup');
	}

	board(): void {
		this.occupied = true;
		this.rotorSpeed = 30;
		this.prevCam.copy(this.body.position);
		this.prevYaw = this.body.rotation.y - Math.PI / 2;
	}

	/** Cockpitpositie voor het instappen (camera gaat hierheen). */
	getSeatPosition(): THREE.Vector3 {
		return this.body.position.clone().add(new THREE.Vector3(0, 0.9, 0));
	}

	/** Uitstappen: waar je ook bent, hij vliegt zelf terug naar het pad. */
	release(): void {
		this.occupied = false;
		this.pos.copy(this.body.position);
		this.next('approach');
	}

	private prevCam = new THREE.Vector3();
	private prevYaw = 0;

	/**
	 * Tijdens jouw vlucht: cockpit om de camera heen (neus wijst lokaal +X),
	 * met flight-sim-gedrag: neus duikt bij snelheid, banken in de bocht.
	 */
	followCamera(cam: THREE.PerspectiveCamera, dt: number): void {
		const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
		const yaw = e.y + Math.PI / 2; // lokaal +X = kijkrichting
		const safeDt = Math.max(dt, 1e-4);

		// Snelheid + bochtsnelheid voor de attitude
		const vx = (cam.position.x - this.prevCam.x) / safeDt;
		const vz = (cam.position.z - this.prevCam.z) / safeDt;
		this.prevCam.copy(cam.position);
		let yawRate = (yaw - this.prevYaw) / safeDt;
		if (yawRate > Math.PI * 6) yawRate = 0; // teleport/instap-spike negeren
		if (yawRate < -Math.PI * 6) yawRate = 0;
		this.prevYaw = yaw;

		const fwdSpeed = vx * Math.cos(yaw) - vz * Math.sin(yaw);
		// Neus omlaag bij vooruit, banken met de bocht — traag gedempt, sim-feel
		const wantPitch = THREE.MathUtils.clamp(-fwdSpeed * 0.022, -0.32, 0.18);
		const wantBank = THREE.MathUtils.clamp(-yawRate * 0.28, -0.42, 0.42);
		this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, wantPitch, Math.min(1, dt * 2.4));
		this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, wantBank, Math.min(1, dt * 2.4));
		this.body.rotation.y = yaw;

		// camera zit in het cockpitglas: 1.0 naar voren, 0.85 boven de romp-origin
		const fx = Math.cos(yaw);
		const fz = -Math.sin(yaw);
		this.body.position.set(cam.position.x - fx * 1.0, cam.position.y - 0.85, cam.position.z - fz * 1.0);
		this.pos.copy(this.body.position);
		this.mainRotor.rotation.y += 30 * dt;
		this.tailRotor.rotation.x += 120 * dt;
	}

	/** Voor het dashboard. */
	get statusLine(): string {
		if (this.occupied) return 'JIJ vliegt — E = uitstappen';
		switch (this.state) {
			case 'parked':
				return 'geparkeerd op het dak';
			case 'spinup':
			case 'takeoff':
				return 'rotors op toeren — takeoff!';
			case 'cruise':
				return 'vliegt rondjes boven de mall';
			case 'approach':
			case 'land':
				return 'in de landing';
			default:
				return 'draait uit';
		}
	}

	update(dt: number): void {
		this.stateT += dt;

		switch (this.state) {
			case 'parked':
				this.rotorSpeed = THREE.MathUtils.lerp(this.rotorSpeed, 0.8, dt * 0.5);
				if (this.stateT > 18) this.next('spinup');
				break;

			case 'spinup':
				this.rotorSpeed = THREE.MathUtils.lerp(this.rotorSpeed, 28, dt * 1.2);
				if (this.stateT > 3.2) this.next('takeoff');
				break;

			case 'takeoff': {
				this.rotorSpeed = 30;
				this.pos.y = THREE.MathUtils.lerp(this.pos.y, CRUISE_Y, dt * 0.9);
				// zachte drift richting de cruisecirkel
				if (CRUISE_Y - this.pos.y < 0.6) {
					this.cruiseA = Math.atan2(this.pos.z, this.pos.x);
					this.next('cruise');
				}
				break;
			}

			case 'cruise': {
				this.rotorSpeed = 26;
				this.cruiseA += CRUISE_SPEED * dt;
				const r = THREE.MathUtils.lerp(Math.hypot(this.pos.x, this.pos.z), CRUISE_R, dt * 0.8);
				this.pos.x = Math.cos(this.cruiseA) * r;
				this.pos.z = Math.sin(this.cruiseA) * r;
				this.pos.y = CRUISE_Y + Math.sin(this.stateT * 0.7) * 0.6;
				// neus in de vliegrichting, banking in de bocht
				this.body.rotation.y = -this.cruiseA - Math.PI / 2;
				this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -0.16, dt * 2);
				if (this.stateT > (LAPS * Math.PI * 2) / CRUISE_SPEED) this.next('approach');
				break;
			}

			case 'approach': {
				this.rotorSpeed = 24;
				// glijvlucht terug naar boven het pad
				this.pos.x = THREE.MathUtils.lerp(this.pos.x, this.pad.x, dt * 0.8);
				this.pos.z = THREE.MathUtils.lerp(this.pos.z, this.pad.z, dt * 0.8);
				this.pos.y = THREE.MathUtils.lerp(this.pos.y, this.pad.y + 5, dt * 0.7);
				this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, 0, dt * 2);
				const dx = this.pos.x - this.pad.x;
				const dz = this.pos.z - this.pad.z;
				if (dx * dx + dz * dz < 0.3) this.next('land');
				break;
			}

			case 'land':
				this.rotorSpeed = 18;
				this.pos.y = THREE.MathUtils.lerp(this.pos.y, this.pad.y, dt * 0.8);
				if (this.pos.y - this.pad.y < 0.05) {
					this.pos.y = this.pad.y;
					this.next('spindown');
				}
				break;

			case 'spindown':
				this.rotorSpeed = THREE.MathUtils.lerp(this.rotorSpeed, 0.8, dt * 0.7);
				this.body.rotation.y = THREE.MathUtils.lerp(this.body.rotation.y, 0, dt);
				if (this.stateT > 6) this.next('parked');
				break;
		}

		this.body.position.copy(this.pos);
		this.mainRotor.rotation.y += this.rotorSpeed * dt;
		this.tailRotor.rotation.x += this.rotorSpeed * 4.2 * dt;
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
	}

	private next(s: HeliState): void {
		this.state = s;
		this.stateT = 0;
	}

	private mat(color: number, roughness = 0.5, metalness = 0.4): LitMaterial {
		const m = lit({ color, roughness, metalness });
		this.materials.push(m);
		return m;
	}

	private build(): void {
		const hull = this.mat(0xc62828, 0.35, 0.55); // mall-rood
		const dark = this.mat(0x263238, 0.5, 0.5);
		const glassMat = lit({
			color: 0x9ad4f5,
			roughness: 0.12,
			metalness: 0.2,
			transparent: true,
			opacity: 0.7,
		});
		this.materials.push(glassMat);

		// Romp
		const fuselage = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 14), hull);
		fuselage.scale.set(1.7, 0.95, 0.95);
		fuselage.position.y = 1.25;
		fuselage.castShadow = true;
		this.body.add(fuselage);

		// Cockpitglas
		const glass = new THREE.Mesh(new THREE.SphereGeometry(0.82, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), glassMat);
		glass.rotation.z = -Math.PI / 2;
		glass.position.set(1.05, 1.35, 0);
		this.body.add(glass);

		// Staartboom + vinnen
		const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 3.4, 10), hull);
		boom.rotation.z = Math.PI / 2;
		boom.position.set(-2.6, 1.45, 0);
		this.body.add(boom);
		const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.08), hull);
		fin.position.set(-4.2, 1.85, 0);
		fin.rotation.z = -0.25;
		this.body.add(fin);
		const hstab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 1.3), dark);
		hstab.position.set(-3.4, 1.6, 0);
		this.body.add(hstab);

		// Skids
		for (const side of [-1, 1] as const) {
			const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.0, 8), dark);
			skid.rotation.z = Math.PI / 2;
			skid.position.set(0.1, 0.12, side * 0.75);
			this.body.add(skid);
			for (const sx of [-0.8, 0.9]) {
				const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.75, 6), dark);
				strut.position.set(sx, 0.5, side * 0.72);
				strut.rotation.x = side * 0.25;
				this.body.add(strut);
			}
		}

		// Hoofdrotor
		this.mainRotor.position.set(0.1, 2.35, 0);
		const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.35, 8), dark);
		this.mainRotor.add(hub);
		const bladeGeo = new THREE.BoxGeometry(5.6, 0.05, 0.32);
		for (const a of [0, Math.PI / 2]) {
			const blade = new THREE.Mesh(bladeGeo, dark);
			blade.rotation.y = a;
			blade.position.y = 0.12;
			this.mainRotor.add(blade);
		}
		this.body.add(this.mainRotor);

		// Staartrotor
		this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.14), dark);
		this.tailRotor.position.set(-4.15, 1.5, 0.14);
		this.body.add(this.tailRotor);

		// Kenteken als GEBOGEN decal op de romp — een bolsegment met iets grotere
		// radius, als kind van de fuselage zodat het de schaal (1.7, .95, .95)
		// meekrijgt. Het oude platte bordje sneed dwars door de gebogen romp.
		const { canvas: c, ctx } = labelCanvas(512, 192);
		ctx.clearRect(0, 0, 512, 192);
		// wit plaatje met afgeronde hoeken + rode bies
		const r = 26;
		ctx.beginPath();
		ctx.moveTo(40 + r, 30);
		ctx.arcTo(472, 30, 472, 162, r);
		ctx.arcTo(472, 162, 40, 162, r);
		ctx.arcTo(40, 162, 40, 30, r);
		ctx.arcTo(40, 30, 472, 30, r);
		ctx.closePath();
		ctx.fillStyle = '#f7f7f2';
		ctx.fill();
		ctx.lineWidth = 8;
		ctx.strokeStyle = '#8e1b1b';
		ctx.stroke();
		ctx.fillStyle = '#b71c1c';
		ctx.font = '800 64px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('PRAIRIE 1', 256, 82);
		ctx.fillStyle = '#5c6066';
		ctx.font = '700 26px system-ui,sans-serif';
		ctx.fillText('MALL AIR · PRAIRIE LAKES', 256, 134);
		const tex = labelTexture(c);
		tex.anisotropy = 4;
		const stickerMat = new THREE.MeshBasicMaterial({
			map: tex,
			transparent: true,
			toneMapped: false,
		});
		this.materials.push(stickerMat);

		// Patch rond phi=π/2 kijkt +Z; radius 1.07 zweeft ~2 cm boven de huid
		const patchGeo = new THREE.SphereGeometry(1.07, 16, 10, Math.PI / 2 - 0.42, 0.84, Math.PI / 2 - 0.3, 0.6);
		for (const side of [-1, 1] as const) {
			const decal = new THREE.Mesh(patchGeo, stickerMat);
			// spiegelzijde: draai het segment naar −Z, tekst blijft leesbaar
			if (side === -1) decal.rotation.y = Math.PI;
			fuselage.add(decal);
		}
	}
}
