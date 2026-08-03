import * as THREE from 'three';
import { labelCanvas, labelTexture } from '@/util/label';

/**
 * Passagiersdrone — stap in (E) en vlieg. De camera zit in het bolletje;
 * dit ding tekent het frame om je heen en volgt de camera met tilt.
 * Space = stijgen, Shift = dalen, omhoog door het atrium-gat = de stad in.
 */
export class Drone {
	readonly group = new THREE.Group();
	/** Parkeerplek op de begane grond, oost van de fontein */
	readonly parkPos = new THREE.Vector3(10, 0, 4);
	occupied = false;
	private body = new THREE.Group();
	private rotors: THREE.Group[] = [];
	private materials: THREE.Material[] = [];
	private rotorSpeed = 2;
	private prevCam = new THREE.Vector3();

	constructor() {
		this.group.name = 'drone';
		this.build();
		this.group.add(this.body);
		this.parkAt(this.parkPos);
	}

	get statusLine(): string {
		return this.occupied ? 'in de lucht — met jou erin' : 'staat klaar bij de fontein (E)';
	}

	/** Afstand speler → drone (voor de E-hint). */
	distanceTo(p: THREE.Vector3): number {
		return this.body.position.distanceTo(p);
	}

	parkAt(p: THREE.Vector3): void {
		this.occupied = false;
		this.parkPos.copy(p);
		this.body.position.set(p.x, p.y + 0.55, p.z);
		this.body.rotation.set(0, this.body.rotation.y, 0);
	}

	board(): void {
		this.occupied = true;
		this.prevCam.copy(this.body.position);
	}

	/** Tijdens de vlucht: om de camera heen hangen, kantelen met de beweging. */
	followCamera(cam: THREE.PerspectiveCamera, dt: number): void {
		if (!this.occupied) {
			this.rotorSpeed = THREE.MathUtils.lerp(this.rotorSpeed, 2, dt);
			for (const r of this.rotors) r.rotation.y += this.rotorSpeed * dt;
			return;
		}
		this.rotorSpeed = THREE.MathUtils.lerp(this.rotorSpeed, 26, dt * 2);
		const vx = (cam.position.x - this.prevCam.x) / Math.max(dt, 1e-4);
		const vz = (cam.position.z - this.prevCam.z) / Math.max(dt, 1e-4);
		this.prevCam.copy(cam.position);

		this.body.position.set(cam.position.x, cam.position.y - 0.35, cam.position.z);
		const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
		// +π: de camera kijkt langs −z; zonder de flip hing de rugleuning van het
		// stoeltje pal vóór je gezicht en keek je tegen de verkeerde kant aan.
		this.body.rotation.y = e.y + Math.PI;
		// naar voren hangen bij snelheid, opzij in de bocht (assen mee-geflipt)
		const fwd = -(vx * Math.sin(e.y) + vz * Math.cos(e.y));
		const side = vx * Math.cos(e.y) - vz * Math.sin(e.y);
		this.body.rotation.x = THREE.MathUtils.clamp(-fwd * 0.02, -0.3, 0.3);
		this.body.rotation.z = THREE.MathUtils.clamp(side * 0.02, -0.3, 0.3);

		for (const r of this.rotors) r.rotation.y += this.rotorSpeed * dt;
	}

	dispose(): void {
		for (const m of this.materials) m.dispose();
	}

	private mat(color: number): THREE.MeshLambertMaterial {
		const m = new THREE.MeshLambertMaterial({ color });
		this.materials.push(m);
		return m;
	}

	private build(): void {
		const frame = this.mat(0x1e88e5); // mall-blauw
		const dark = this.mat(0x263238);
		const glass = new THREE.MeshLambertMaterial({
			color: 0xbfe3f7,
			transparent: true,
			opacity: 0.35,
			side: THREE.DoubleSide,
		});
		this.materials.push(glass);

		// Stoel-pod: open bol zodat je er als speler doorheen kunt kijken
		const pod = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.5), glass);
		pod.position.y = 0.35;
		this.body.add(pod);
		const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.55), dark);
		seat.position.y = -0.15;
		this.body.add(seat);
		const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.09), dark);
		back.position.set(0, 0.12, -0.3);
		this.body.add(back);

		// Onderstel-ring + vier armen met rotors
		const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 8, 20), frame);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = -0.25;
		this.body.add(ring);

		const bladeGeo = new THREE.BoxGeometry(0.85, 0.02, 0.09);
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const arm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.12), frame);
			arm.position.set(Math.cos(a) * 0.85, -0.05, Math.sin(a) * 0.85);
			arm.rotation.y = -a;
			this.body.add(arm);

			const rotor = new THREE.Group();
			rotor.position.set(Math.cos(a) * 1.3, 0.05, Math.sin(a) * 1.3);
			const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), dark);
			rotor.add(hub);
			for (const b of [0, Math.PI / 2]) {
				const blade = new THREE.Mesh(bladeGeo, dark);
				blade.rotation.y = b;
				rotor.add(blade);
			}
			// beschermring om de rotor
			const guard = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 16), frame);
			guard.rotation.x = Math.PI / 2;
			rotor.add(guard);
			this.body.add(rotor);
			this.rotors.push(rotor);
		}

		// Pootjes
		for (const side of [-1, 1] as const) {
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6), dark);
			leg.position.set(side * 0.45, -0.5, 0);
			this.body.add(leg);
			const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), dark);
			foot.rotation.x = Math.PI / 2;
			foot.position.set(side * 0.45, -0.72, 0);
			this.body.add(foot);
		}

		// TAXI-bordje erboven — het is tenslotte openbaar vervoer
		const { canvas: c, ctx } = labelCanvas(128, 48);
		ctx.fillStyle = '#ffd400';
		ctx.fillRect(0, 0, 128, 48);
		ctx.fillStyle = '#111';
		ctx.font = '700 26px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('DRONE', 64, 26);
		const tex = labelTexture(c);
		const signMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
		this.materials.push(signMat);
		const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.2), signMat);
		sign.position.y = 0.95;
		this.body.add(sign);
	}
}
